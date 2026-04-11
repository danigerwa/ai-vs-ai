/**
 * Claude.ai prefill content script — reads the stored prompt from
 * chrome.storage.local and fills the input editor. If auto-submit is enabled
 * it also clicks Send.
 */

export default defineContentScript({
  matches: ['https://claude.ai/*'],

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
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"][aria-placeholder]',
    'div[contenteditable="true"]',
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
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
    'button[type="submit"]',
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
    // ProseMirror/contenteditable — execCommand goes through the browser
    // editing pipeline so the framework picks up the change.
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }
}
