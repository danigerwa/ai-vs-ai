/**
 * Grok.com content script — extracts the full conversation thread.
 *
 * Extraction strategy (most → least stable):
 *
 * 1. data-message-author-role attributes (same pattern as ChatGPT)
 * 2. data-testid / class patterns specific to Grok
 * 3. CSS alignment heuristic: user messages are right-aligned (Tailwind justify-end / ml-auto)
 * 4. Aria-label patterns
 */

import type { ConversationMessage, ExtractionResult } from './claude.content';

export default defineContentScript({
  matches: ['https://grok.com/*'],

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
  // Strategy 1: .message-bubble elements — parent alignment determines role.
  // Uses both class name AND computed style so it survives Tailwind class renames.
  const bubbles = Array.from(document.querySelectorAll<HTMLElement>('.message-bubble'));
  if (bubbles.length >= 2) {
    const messages = bubbles
      .map((el): ConversationMessage | null => {
        const parentEl = el.parentElement;
        const parentCls = (parentEl?.className ?? '').toString();
        const isUserAligned =
          parentCls.includes('items-end') ||
          (parentEl ? getComputedStyle(parentEl).alignItems === 'flex-end' : false);
        const role: ConversationMessage['role'] = isUserAligned ? 'user' : 'chatgpt';
        const text = getCleanText(el);
        if (!text) return null;
        return { role, text };
      })
      .filter((m): m is ConversationMessage => m !== null && m.text.length > 0);

    const hasUser = messages.some((m) => m.role === 'user');
    const hasAI   = messages.some((m) => m.role === 'chatgpt');
    if (messages.length >= 2 && hasUser && hasAI) return { messages, aiLabel: 'Grok' };
  }

  // Strategy 2: data-message-author-role (in case Grok adds it later)
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
    if (messages.length >= 2) return { messages, aiLabel: 'Grok' };
  }

  // Strategy 3: Structural flex-alignment heuristic — class-name-independent.
  // Looks for a container whose direct children split into right-aligned (user)
  // and left-aligned (AI) groups via getComputedStyle. Survives full CSS rewrites.
  const structural = extractByStructure();
  if (structural) return { messages: structural, aiLabel: 'Grok' };

  return {
    error: 'Could not find a conversation. Make sure you are on a Grok chat page with at least one response.',
  };
}

/**
 * Scan common conversation-container selectors and look for a parent element
 * whose direct children split into flex-end (user) and flex-start (AI) groups.
 * Independent of any class or attribute naming conventions.
 */
function extractByStructure(): ConversationMessage[] | null {
  const visited = new WeakSet<Element>();

  const tryParent = (parent: Element): ConversationMessage[] | null => {
    if (visited.has(parent)) return null;
    visited.add(parent);

    const typed = (Array.from(parent.children) as HTMLElement[]).flatMap((child) => {
      const text = (child.textContent ?? '').trim();
      if (text.length < 10) return [];
      const align = getComputedStyle(child).alignItems;
      if (align !== 'flex-end' && align !== 'flex-start') return [];
      return [{ el: child, isUser: align === 'flex-end' }];
    });

    if (typed.length < 2) return null;
    if (!typed.some((t) => t.isUser) || !typed.some((t) => !t.isUser)) return null;

    const messages = typed
      .map(({ el, isUser }) => ({
        role: isUser ? ('user' as const) : ('chatgpt' as const),
        text: getCleanText(el),
      }))
      .filter((m) => m.text.length > 0);

    return messages.length >= 2 ? messages : null;
  };

  for (const sel of ['main', '[role="main"]', 'section', '[class*="conversation"]', '[class*="messages"]', '[class*="chat"]']) {
    for (const container of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const result = tryParent(container);
      if (result) return result;
      // Also try one level deeper — the conversation list is often a child of <main>
      for (const child of Array.from(container.children)) {
        const r = tryParent(child);
        if (r) return r;
      }
    }
  }

  return null;
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
