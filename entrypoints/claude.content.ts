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
        .map(({ el, role }) => ({ role, text: getCleanText(el) }))
        .filter((m) => m.text.length > 0);

      if (messages.length >= 2) return { messages };
    }
  }

  // --- Strategy 2: Copy-button anchor for each AI message ---
  const copyBtns = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button[aria-label*="copy" i], button[title*="copy" i], button[data-testid*="copy" i]'
    )
  );

  if (copyBtns.length > 0) {
    const messages: ConversationMessage[] = [];

    for (const btn of copyBtns) {
      const aiBox = findAIMessageBox(btn);
      if (!aiBox) continue;

      const answer = getTextExcludingBranch(aiBox, btn);
      if (!answer) continue;

      const userBox = getPrecedingElement(aiBox);
      const question = userBox ? getCleanText(userBox) : '';

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

  return {
    error: 'Could not find a conversation. Make sure you are on a Claude chat page with at least one response.',
  };
}

// ─── DOM helpers ────────────────────────────────────────────────────────────

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
 * Extract clean readable text from an element.
 *
 * IMPORTANT: clone must be attached to the live document before innerText —
 * on detached nodes it falls back to textContent which includes <script>/<style> text.
 * Using position:fixed off-screen (NOT visibility:hidden, which would make innerText empty).
 */
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
    .replace(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi, '')                          // timestamps: 23:45, 11:30 AM
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')                                       // counters: 2 / 2
    .replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi, '') // dates: 10 Apr, 5 January
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/gi, '') // dates: Apr 10, January 5
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  document.body.removeChild(clone);
  return text;
}
