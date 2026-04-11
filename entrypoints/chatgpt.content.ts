/**
 * ChatGPT content script — extracts the full conversation thread.
 *
 * Extraction strategy (most → least stable):
 *
 * 1. data-message-author-role attributes — most reliable, present on message containers
 * 2. article elements with conversation-turn test IDs — fallback
 */

import type { ConversationMessage, ExtractionResult } from './claude.content';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

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
  // Strategy 1: data-message-author-role attributes
  const messageEls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-author-role]')
  );

  if (messageEls.length >= 2) {
    const messages = messageEls
      .map((el): ConversationMessage | null => {
        const attr = el.getAttribute('data-message-author-role');
        const text = getCleanText(el);
        if (!text || !attr) return null;
        const role: ConversationMessage['role'] = attr === 'user' ? 'user' : 'chatgpt';
        return { role, text };
      })
      .filter((m): m is ConversationMessage => m !== null && m.text.length > 0);

    if (messages.length >= 2) return { messages, aiLabel: 'ChatGPT' };
  }

  // Strategy 2: articles with conversation-turn test IDs
  const articles = Array.from(
    document.querySelectorAll<HTMLElement>('article[data-testid*="conversation-turn"]')
  );

  if (articles.length >= 2) {
    const messages: ConversationMessage[] = [];

    for (const article of articles) {
      const authorEl = article.querySelector<HTMLElement>('[data-message-author-role]');
      const attr = authorEl?.getAttribute('data-message-author-role');
      if (!attr) continue;

      const contentEl = article.querySelector<HTMLElement>(
        '[data-message-author-role] > div, .markdown, .whitespace-pre-wrap'
      ) ?? article;

      const text = getCleanText(contentEl);
      if (!text) continue;

      const role: ConversationMessage['role'] = attr === 'user' ? 'user' : 'chatgpt';
      messages.push({ role, text });
    }

    if (messages.length >= 2) return { messages, aiLabel: 'ChatGPT' };
  }

  return {
    error: 'Could not find a conversation. Make sure you are on a ChatGPT chat page with at least one response.',
  };
}

function getCleanText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;

  clone
    .querySelectorAll(
      'button, svg, script, style, noscript, time, [role="img"], [aria-hidden="true"]'
    )
    .forEach((n) => n.remove());

  clone.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;';
  document.body.appendChild(clone);

  const text = (clone.innerText ?? '')
    .replace(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  document.body.removeChild(clone);
  return text;
}
