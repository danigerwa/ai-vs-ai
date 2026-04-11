/**
 * ChatGPT content script — reads the stored prompt from chrome.storage.local
 * and fills the input textarea. If auto-submit is enabled it also clicks Send.
 */

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

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
      await submit();
    }
  },
});

/**
 * Poll until the text input appears in the DOM (ChatGPT is a React SPA that
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
  const selectors = [
    'div[contenteditable="true"][id="prompt-textarea"]',
    'div[contenteditable="true"]',
    'textarea[id="prompt-textarea"]',
    'textarea[placeholder]',
    'textarea',
  ];

  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Submit the prompt by waiting for the send button to become enabled and clicking it.
 */
async function submit(): Promise<void> {
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
    'button[data-testid="send-button"]',
    'button[aria-label*="send" i]',
    'button[type="submit"]',
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
    // contenteditable — use execCommand to go through the browser editing pipeline
    // so React/the editor picks up the change and enables the send button.
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }
}
