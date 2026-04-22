/**
 * Claude.ai content script — extracts the full conversation thread.
 *
 * Extraction strategy (most → least stable):
 *
 * 1. data-testid attributes — merge user + AI turns, sort by DOM position
 * 2. Copy-button anchor — find all AI message boxes, reconstruct pairs
 *
 * Key fix: cloned elements must be attached to the live document before calling
 * innerText — detached nodes fall back to textContent which includes <script>
 * and <style> tag text.
 */

export default defineContentScript({
  matches: ['https://claude.ai/*'],

  main() {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_CONVERSATION') {
        sendResponse(extractConversation());
        return true;
      }
    });
  },
});

export interface ConversationMessage {
  role: 'user' | 'claude' | 'chatgpt';
  text: string;
}

export interface ExtractionResult {
  messages?: ConversationMessage[];
  error?: string;
  aiLabel?: string;
}

const TESTID_PAIRS: [string, string][] = [
  ['[data-testid="human-turn"]', '[data-testid="ai-turn"]'],
  ['[data-testid*="human-turn"]', '[data-testid*="ai-turn"]'],
  ['[data-testid="user-message"]', '[data-testid="assistant-message"]'],
  ['[data-testid*="user"]', '[data-testid*="assistant"]'],
];

function extractConversation(): ExtractionResult {
  // --- Strategy 1: data-testid ---
  for (const [userSel, aiSel] of TESTID_PAIRS) {
    const userEls = Array.from(document.querySelectorAll<HTMLElement>(userSel));
    const aiEls = Array.from(document.querySelectorAll<HTMLElement>(aiSel));
    if (userEls.length && aiEls.length) {
      const tagged = [
        ...userEls.map((el) => ({ el, role: 'user' as const })),
        ...aiEls.map((el) => ({ el, role: 'claude' as const })),
      ].sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );

      const messages = tagged
        .map(({ el, role }) => ({ role, text: getCleanText(getContentElement(el)) }))
        .filter((m) => m.text.length > 0);

      if (messages.length >= 2) return { messages };
    }
  }

  // --- Strategy 2: .font-claude-response direct query ---
  // Query the AI response containers directly instead of navigating from copy buttons.
  // Copy buttons live OUTSIDE .font-claude-response in the current Claude HTML, so the
  // old btn.closest('.font-claude-response') path was always null, causing findAIMessageBox
  // to walk up to an outer container that included sr-only turn labels as children.
  const claudeResponses = Array.from(
    document.querySelectorAll<HTMLElement>('.font-claude-response')
  );

  if (claudeResponses.length > 0) {
    const messages: ConversationMessage[] = [];

    for (const response of claudeResponses) {
      // .font-claude-response does NOT contain the sr-only "Claude responded:" h2 —
      // that h2 is a sibling. Tool-use sr-only spans inside it are stripped as descendants.
      const answer = getCleanText(response);
      if (!answer) continue;

      const userBox = findUserTurnBeforeClaudeResponse(response);
      // Guard: never treat content inside a .font-claude-response as a user message.
      const question =
        userBox && !userBox.closest('.font-claude-response') ? getCleanText(userBox) : '';

      if (question) messages.push({ role: 'user', text: question });
      messages.push({ role: 'claude', text: answer });
    }

    // De-duplicate: adjacent same-role messages with identical text can appear
    // if the DOM has repeated elements. Keep unique entries in order.
    const deduped = messages.filter(
      (m, i) => i === 0 || !(m.role === messages[i - 1].role && m.text === messages[i - 1].text)
    );

    if (deduped.length >= 2) return { messages: deduped };
  }

  // --- Strategy 3: Copy-button anchor for each AI message (fallback) ---
  const copyBtns = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button[aria-label*="copy" i], button[title*="copy" i], button[data-testid*="copy" i]'
    )
  );

  if (copyBtns.length > 0) {
    const messages: ConversationMessage[] = [];
    const seenBoxes = new Set<HTMLElement>();

    for (const btn of copyBtns) {
      const responseContainer = btn.closest<HTMLElement>('.font-claude-response');
      const aiBox = responseContainer ?? findAIMessageBox(btn);
      if (!aiBox) continue;

      if (seenBoxes.has(aiBox)) continue;
      seenBoxes.add(aiBox);

      const answer = responseContainer
        ? getCleanText(aiBox)
        : getTextExcludingBranch(aiBox, btn);
      if (!answer) continue;

      const userBox = responseContainer
        ? findUserTurnBeforeClaudeResponse(responseContainer)
        : getPrecedingElement(aiBox);

      const question =
        userBox && !userBox.closest('.font-claude-response') ? getCleanText(userBox) : '';

      if (question) messages.push({ role: 'user', text: question });
      messages.push({ role: 'claude', text: answer });
    }

    const deduped = messages.filter(
      (m, i) => i === 0 || !(m.role === messages[i - 1].role && m.text === messages[i - 1].text)
    );

    if (deduped.length >= 2) return { messages: deduped };
  }

  return {
    error: 'Could not find a conversation. Make sure you are on a Claude chat page with at least one response.',
  };
}

// ─── DOM helpers ────────────────────────────────────────────────────────────

/**
 * Within a turn container, try to find the inner element that holds only the
 * message prose — skipping role labels, avatars, and tool-use blocks that live
 * as siblings in the outer container.
 *
 * Try progressively narrower selectors; fall back to the container itself so
 * extraction always has something to work with.
 */
function getContentElement(turn: HTMLElement): HTMLElement {
  const CONTENT_SELECTORS = [
    // Claude.ai prose containers
    '.font-claude-message',
    '.font-user-message',
    '[class*="prose"]',
    // Generic prose/markdown containers used by several platforms
    '.prose',
    '.markdown',
    '.markdown-body',
    '[class*="message-content"]',
    '[class*="MessageContent"]',
    '[class*="chat-message"]',
  ];

  for (const sel of CONTENT_SELECTORS) {
    const found = turn.querySelector<HTMLElement>(sel);
    if (found && found.textContent && found.textContent.trim().length > 0) {
      return found;
    }
  }

  return turn;
}

/**
 * Walk up from the copy button until we find an element whose children include
 * both a copy-button branch AND a text-containing non-copy branch.
 * The first match (closest to the button) is the AI message container.
 */
function findAIMessageBox(copyBtn: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = copyBtn.parentElement;

  for (let depth = 0; depth < 10 && el && el !== document.body; depth++) {
    const kids = Array.from(el.children) as HTMLElement[];
    const copyBranch = kids.find((k) => k === copyBtn || k.contains(copyBtn));
    // threshold > 0: catches short answers ("Paris.") while action-bar buttons
    // typically have empty textContent (SVG-only icons)
    const textBranch = kids.find(
      (k) => k !== copyBranch && (k.textContent ?? '').trim().length > 0
    );
    if (copyBranch && textBranch) return el;
    el = el.parentElement;
  }
  return null;
}

/** Extract text from a container, skipping the branch that holds the copy button. */
function getTextExcludingBranch(container: HTMLElement, copyBtn: HTMLElement): string {
  const parts: string[] = [];
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (child !== copyBtn && !child.contains(copyBtn)) {
      const text = getCleanText(child);
      if (text.length > 0) parts.push(text);
    }
  }
  return parts.join('\n\n').trim();
}

/** Return the element that immediately precedes aiBox in the DOM. */
function getPrecedingElement(aiBox: HTMLElement): HTMLElement | null {
  const prev = aiBox.previousElementSibling as HTMLElement | null;
  if (prev) return prev;
  return aiBox.parentElement?.previousElementSibling as HTMLElement | null;
}

/**
 * Walk up from a .font-claude-response element until we find a previous sibling
 * that is not itself (and doesn't contain) another .font-claude-response — that
 * sibling is the user turn preceding this Claude response.
 */
function findUserTurnBeforeClaudeResponse(claudeEl: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = claudeEl;
  for (let depth = 0; depth < 15 && el && el !== document.body; depth++) {
    const prev = el.previousElementSibling as HTMLElement | null;
    if (
      prev &&
      !prev.classList.contains('font-claude-response') &&
      !prev.classList.contains('sr-only') &&   // skip accessibility-only turn labels
      !prev.querySelector('.font-claude-response')
    ) {
      return prev;
    }
    el = el.parentElement;
  }
  return null;
}

// Block-level HTML tags that should produce a newline break in plain text.
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TR', 'UL',
]);

/**
 * Recursively convert a DOM node to plain text.
 * Block elements get newlines; <br> becomes \n; <pre> preserves verbatim content.
 * Does not depend on CSS rendering or document attachment.
 */
function nodeToText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return '\n';
  if (el.tagName === 'PRE') return '\n' + (el.textContent ?? '') + '\n';
  const inner = Array.from(el.childNodes).map(nodeToText).join('');
  return BLOCK_TAGS.has(el.tagName) ? '\n' + inner + '\n' : inner;
}

/**
 * Extract clean readable text from an element.
 * Strips noise elements, then walks the DOM explicitly to produce newlines
 * at block boundaries — independent of CSS rendering context.
 */
function getCleanText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;

  clone
    .querySelectorAll(
      // .sr-only = Tailwind screen-reader-only class: visually hidden but in the DOM.
      // Claude uses it for turn labels ("You said:", "Claude responded:") and tool-use
      // status spans ("Loaded tools, used a tool") — all UI chrome, not message content.
      'button, svg, script, style, noscript, time, [role="img"], [aria-hidden="true"], .sr-only'
    )
    .forEach((n) => n.remove());

  const raw = nodeToText(clone)
    .replace(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi, '')                          // timestamps: 23:45, 11:30 AM
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')                                       // counters: 2 / 2
    .replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi, '') // dates: 10 Apr, 5 January
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/gi, '') // dates: Apr 10, January 5
    // Strip UI captions injected by Claude's interface into turn containers
    .replace(/^You said:\s*\n?/, '')
    .replace(/^Claude responded:\s*\n?/, '')
    // Strip tool-use indicator lines ("Loaded tools, used a tool", "Used 2 tools", etc.)
    .replace(/^(?:Loaded \d+|Used \d+|Loaded) tools?[^\n]*\n?/gim, '');

  // Remove consecutive duplicate paragraphs — these arise when a tool-use preview
  // repeats the same text that appears in the final response below it.
  return raw
    .split(/\n{2,}/)
    .filter((p, i, arr) => i === 0 || p.trim() !== arr[i - 1].trim())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
