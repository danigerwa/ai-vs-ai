/**
 * Gemini prefill content script — reads the stored prompt from
 * chrome.storage.local and fills Gemini's input editor.
 * If auto-submit is enabled it also clicks Send.
 */

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],

  async main() {
    const stored = await chrome.storage.local.get('crossAiPrompt');
    const prompt: string | undefined = stored.crossAiPrompt;
    if (!prompt) return;

    // Clear immediately to avoid re-filling on subsequent navigations
    await chrome.storage.local.remove('crossAiPrompt');

    const el = await waitForInput(8000);
    if (!el) return;

    fillInput(el, prompt);

    const { autoSubmit } = await chrome.storage.sync.get('autoSubmit');
    if (autoSubmit) {
      await submit();
    }
  },
});

function waitForInput(timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const el = findInput();
      if (el) { resolve(el); return; }
      if (Date.now() >= deadline) { resolve(null); return; }
      requestAnimationFrame(attempt);
    }

    attempt();
  });
}

function findInput(): HTMLElement | null {
  const selectors = [
    // Gemini uses a rich-textarea Angular component with a contenteditable inside
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][aria-label]',
    'div[contenteditable="true"]',
    'textarea[aria-label]',
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
    'button[aria-label="Send message"]',
    'button[mattooltip="Send message"]',
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

function fillInput(el: HTMLElement, text: string) {
  el.focus();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ??
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, text);
    } else {
      el.value = text;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Contenteditable (Gemini uses Angular's rich-textarea with contenteditable)
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }
}
