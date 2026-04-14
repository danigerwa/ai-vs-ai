/**
 * Gemini content script — extracts the full conversation thread.
 *
 * Extraction strategy (most → least stable):
 *
 * 1. Angular custom elements: <user-query> and <model-response>
 * 2. data-message-* attributes
 * 3. Class-based heuristics: .query-content / .response-content
 */

import type { ConversationMessage, ExtractionResult } from './claude.content';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],

  main() {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_CONVERSATION') {
        sendResponse(extractConversation());
        return true;
      }
    });
  },
});

function extractConversation(): ExtractionResult {
  // Strategy 1: Angular custom elements <user-query> and <model-response>
  const userEls = Array.from(document.querySelectorAll<HTMLElement>('user-query'));
  const aiEls = Array.from(document.querySelectorAll<HTMLElement>('model-response'));

  if (userEls.length && aiEls.length) {
    const tagged = [
      ...userEls.map((el) => ({ el, role: 'user' as const })),
      ...aiEls.map((el) => ({ el, role: 'chatgpt' as const })),
    ].sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );

    const messages = tagged
      .map(({ el, role }) => ({ role, text: getCleanText(el) }))
      .filter((m) => m.text.length > 0);

    if (messages.length >= 2) return { messages, aiLabel: 'Gemini' };
  }

  // Strategy 2: .query-content / .response-content class names
  const queryEls = Array.from(document.querySelectorAll<HTMLElement>('.query-content, .user-query-content'));
  const responseEls = Array.from(document.querySelectorAll<HTMLElement>('.response-content, .model-response-text'));

  if (queryEls.length && responseEls.length) {
    const tagged = [
      ...queryEls.map((el) => ({ el, role: 'user' as const })),
      ...responseEls.map((el) => ({ el, role: 'chatgpt' as const })),
    ].sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );

    const messages = tagged
      .map(({ el, role }) => ({ role, text: getCleanText(el) }))
      .filter((m) => m.text.length > 0);

    if (messages.length >= 2) return { messages, aiLabel: 'Gemini' };
  }

  // Strategy 3: data-message-author-role
  const byRole = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role]'));
  if (byRole.length >= 2) {
    const messages = byRole
      .map((el): ConversationMessage | null => {
        const attr = el.getAttribute('data-message-author-role');
        const text = getCleanText(el);
        if (!text || !attr) return null;
        return { role: attr === 'user' ? 'user' : 'chatgpt', text };
      })
      .filter((m): m is ConversationMessage => m !== null && m.text.length > 0);

    if (messages.length >= 2) return { messages, aiLabel: 'Gemini' };
  }

  return {
    error: 'Could not find a conversation. Make sure you are on a Gemini chat page with at least one response.',
  };
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TR', 'UL',
]);

function nodeToText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return '\n';
  if (el.tagName === 'PRE') return '\n' + (el.textContent ?? '') + '\n';
  const inner = Array.from(el.childNodes).map(nodeToText).join('');
  return BLOCK_TAGS.has(el.tagName) ? '\n' + inner + '\n' : inner;
}

function getCleanText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;

  clone
    .querySelectorAll(
      'button, svg, script, style, noscript, time, [role="img"], [aria-hidden="true"]'
    )
    .forEach((n) => n.remove());

  return nodeToText(clone)
    .replace(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
