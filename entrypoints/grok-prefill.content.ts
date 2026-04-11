/**
 * Grok.com content script — reads the stored prompt from chrome.storage.local
 * and fills the input textarea. If auto-submit is enabled it also clicks Send.
 */

export default defineContentScript({
  matches: ['https://grok.com/*'],

  async main() {
    const stored = await chrome.storage.local.get('crossAiPrompt');
    const prompt: string | undefined = stored.crossAiPrompt;
    if (!prompt) return;

    // Clear immediately to avoid re-filling on subsequent page navigations
    await chrome.storage.local.remove('crossAiPrompt');

    const el = await waitForInput(6000);
    if (!el) return;

    fillInput(el, prompt);

    const { autoSubmit } = await chrome.storage.sync.get('autoSubmit');
    if (autoSubmit) {
      await submit(el);
    }
  },
});

/**
 * Poll until the text input appears in the DOM (Grok is a React SPA that
 * mounts its input after hydration). Resolves to null on timeout.
 */
function waitForInput(timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const el = findInput();
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      requestAnimationFrame(attempt);
    }

    attempt();
  });
}

function findInput(): HTMLElement | null {
  // Ordered by specificity: prefer explicit selectors, fall back broadly
  const selectors = [
    'textarea[placeholder]',
    'div[contenteditable="true"][aria-label]',
    'div[contenteditable="true"]',
    'textarea',
  ];

  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    // Make sure the element is actually visible and interactive
    if (el && isVisible(el)) return el;
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Submit the prompt. Tries two strategies in order:
 *
 * 1. Enter keydown on the input — most React chat UIs (including Grok) handle
 *    submission this way, making it the most reliable approach.
 * 2. Click a visible, enabled send button — fallback for UIs that use a form.
 *
 * A short delay before firing gives React time to process the filled value and
 * enable the send button / activate the Enter handler.
 */
async function submit(_inputEl: HTMLElement): Promise<void> {
  // Wait for Tiptap to process the inserted text and enable the submit button.
  const btn = await waitForSubmitButton(3000);
  btn?.click();
}

function waitForSubmitButton(timeoutMs: number): Promise<HTMLButtonElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const btn = findSubmitButton();
      if (btn) { resolve(btn); return; }
      if (Date.now() >= deadline) { resolve(null); return; }
      requestAnimationFrame(attempt);
    }

    attempt();
  });
}

function findSubmitButton(): HTMLButtonElement | null {
  const selectors = [
    'button[type="submit"][aria-label="Submit"]',
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
  ];

  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLButtonElement>(sel))) {
      if (isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') return el;
    }
  }
  return null;
}


/**
 * Fill a textarea or contenteditable with the given text in a way that
 * React's synthetic event system picks up (so the send button activates).
 */
function fillInput(el: HTMLElement, text: string) {
  el.focus();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // For controlled React inputs, set value via the native input value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, text);
    } else {
      el.value = text;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Tiptap / ProseMirror contenteditable — setting textContent bypasses the
    // editor's internal document model and leaves it unaware of the change.
    // execCommand('insertText') goes through the browser's editing pipeline,
    // which Tiptap hooks into, so its state (and the send button) updates correctly.
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }
}
