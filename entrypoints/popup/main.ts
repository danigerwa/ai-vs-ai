import type { ConversationMessage, ExtractionResult } from '../claude.content';

interface PromptMode {
  id: string;
  name: string;
  prompt: string;
}

type SendScope = 'full' | 'last-n' | 'latest-assistant' | 'latest-with-context';

const DEFAULT_PROMPT_MODES: PromptMode[] = [
  {
    id: 'fact-check',
    name: 'Fact-check',
    prompt:
      `Here is a full conversation between a User and {AI}. ` +
      `Fact-check the whole thread — identify any inaccuracies, gaps, or overconfidence in {AI}'s responses.`,
  },
  {
    id: 'harsh-critique',
    name: 'Harsh critique',
    prompt:
      `Here is a full conversation between a User and {AI}. ` +
      `Critique the whole thread aggressively. Point out weak reasoning, unsupported claims, missing caveats, and places where {AI} sounds more confident than justified.`,
  },
  {
    id: 'counterargument',
    name: 'Counterargument',
    prompt:
      `Here is a full conversation between a User and {AI}. ` +
      `Challenge the main claims in {AI}'s responses. Present the strongest counterarguments, alternative interpretations, and overlooked tradeoffs.`,
  },
  {
    id: 'better-answer',
    name: 'Better answer',
    prompt:
      `Here is a full conversation between a User and {AI}. ` +
      `Review the thread, briefly note what {AI} got wrong or missed, then write a better final answer for the user.`,
  },
];

const LEGACY_PROMPT_PREFIX_KEY = 'critiquePromptPrefix';
const PROMPT_MODES_KEY = 'promptModes';
const ACTIVE_PROMPT_MODE_KEY = 'activePromptModeId';
const SEND_SCOPE_KEY = 'sendScope';
const LAST_N_MESSAGES_KEY = 'lastNMessages';
const AUTO_SUBMIT_KEY = 'autoSubmit';
const DEFAULT_LAST_N_MESSAGES = 6;

function cloneDefaultPromptModes(): PromptMode[] {
  return DEFAULT_PROMPT_MODES.map((mode) => ({ ...mode }));
}

function getDefaultModeById(id: string): PromptMode | undefined {
  return DEFAULT_PROMPT_MODES.find((mode) => mode.id === id);
}

function sanitizeModes(value: unknown): PromptMode[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const modes: PromptMode[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';

    if (!id || !name || !prompt || seen.has(id)) continue;

    seen.add(id);
    modes.push({ id, name, prompt });
  }

  return modes;
}

async function getPromptModes(): Promise<PromptMode[]> {
  const stored = await chrome.storage.sync.get([
    PROMPT_MODES_KEY,
    LEGACY_PROMPT_PREFIX_KEY,
  ]);
  const savedModes = sanitizeModes(stored[PROMPT_MODES_KEY]);
  if (savedModes.length > 0) return savedModes;

  const modes = cloneDefaultPromptModes();
  const legacyPrompt = stored[LEGACY_PROMPT_PREFIX_KEY];
  if (typeof legacyPrompt === 'string' && legacyPrompt.trim()) {
    modes[0] = { ...modes[0], prompt: legacyPrompt.trim() };
  }

  await chrome.storage.sync.set({ [PROMPT_MODES_KEY]: modes });
  return modes;
}

async function savePromptModes(modes: PromptMode[]): Promise<void> {
  await chrome.storage.sync.set({ [PROMPT_MODES_KEY]: modes });
}

async function getActivePromptModeId(modes?: PromptMode[]): Promise<string> {
  const availableModes = modes ?? (await getPromptModes());
  const stored = await chrome.storage.sync.get(ACTIVE_PROMPT_MODE_KEY);
  const activeId = stored[ACTIVE_PROMPT_MODE_KEY];

  if (
    typeof activeId === 'string' &&
    availableModes.some((mode) => mode.id === activeId)
  ) {
    return activeId;
  }

  const fallbackId = availableModes[0]?.id ?? DEFAULT_PROMPT_MODES[0].id;
  await chrome.storage.sync.set({ [ACTIVE_PROMPT_MODE_KEY]: fallbackId });
  return fallbackId;
}

async function saveActivePromptModeId(id: string): Promise<void> {
  await chrome.storage.sync.set({ [ACTIVE_PROMPT_MODE_KEY]: id });
}

async function getActivePromptMode(): Promise<PromptMode> {
  const modes = await getPromptModes();
  const activeId = await getActivePromptModeId(modes);
  return getModeById(modes, activeId) ?? modes[0] ?? cloneDefaultPromptModes()[0];
}

function getModeById(modes: PromptMode[], id: string): PromptMode | undefined {
  return modes.find((mode) => mode.id === id);
}

function formatModePrompt(prompt: string, aiLabel = 'Claude'): string {
  return prompt.replace(/\{AI\}/g, aiLabel);
}

function createModeId(name: string, existingModes: PromptMode[]): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-mode';

  let candidate = base;
  let counter = 2;

  while (existingModes.some((mode) => mode.id === candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

async function getAutoSubmit(): Promise<boolean> {
  const stored = await chrome.storage.sync.get(AUTO_SUBMIT_KEY);
  return stored[AUTO_SUBMIT_KEY] === true;
}

async function saveAutoSubmit(value: boolean): Promise<void> {
  await chrome.storage.sync.set({ [AUTO_SUBMIT_KEY]: value });
}

async function getSendScope(): Promise<SendScope> {
  const stored = await chrome.storage.sync.get(SEND_SCOPE_KEY);
  const scope = stored[SEND_SCOPE_KEY];

  if (
    scope === 'full' ||
    scope === 'last-n' ||
    scope === 'latest-assistant' ||
    scope === 'latest-with-context'
  ) {
    return scope;
  }

  await chrome.storage.sync.set({ [SEND_SCOPE_KEY]: 'full' });
  return 'full';
}

async function saveSendScope(value: SendScope): Promise<void> {
  await chrome.storage.sync.set({ [SEND_SCOPE_KEY]: value });
}

async function getLastNMessages(): Promise<number> {
  const stored = await chrome.storage.sync.get(LAST_N_MESSAGES_KEY);
  const value = Number(stored[LAST_N_MESSAGES_KEY]);

  if (Number.isInteger(value) && value >= 2 && value <= 50) {
    return value;
  }

  await chrome.storage.sync.set({ [LAST_N_MESSAGES_KEY]: DEFAULT_LAST_N_MESSAGES });
  return DEFAULT_LAST_N_MESSAGES;
}

async function saveLastNMessages(value: number): Promise<void> {
  const sanitized = Math.max(2, Math.min(50, Math.round(value)));
  await chrome.storage.sync.set({ [LAST_N_MESSAGES_KEY]: sanitized });
}

function getLastAssistantIndex(messages: ConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') return index;
  }

  return -1;
}

function selectMessages(
  messages: ConversationMessage[],
  scope: SendScope,
  lastNMessages: number
): ConversationMessage[] {
  if (messages.length <= 1) return messages;

  if (scope === 'full') {
    return messages;
  }

  if (scope === 'last-n') {
    return messages.slice(-Math.max(2, lastNMessages));
  }

  const latestAssistantIndex = getLastAssistantIndex(messages);
  if (latestAssistantIndex === -1) {
    return scope === 'last-n' ? messages.slice(-Math.max(2, lastNMessages)) : messages;
  }

  if (scope === 'latest-assistant') {
    return [messages[latestAssistantIndex]];
  }

  const startIndex = Math.max(0, latestAssistantIndex - 3);
  return messages.slice(startIndex, latestAssistantIndex + 1);
}

function formatPrompt(prefix: string, messages: ConversationMessage[], aiLabel = 'Claude'): string {
  const resolvedPrefix = formatModePrompt(prefix, aiLabel);

  const thread = messages
    .map((m) => `${m.role === 'user' ? 'User' : aiLabel}: ${m.text}`)
    .join('\n\n');

  return `${resolvedPrefix}\n\n${thread}`;
}

function setStatus(msg: string, type: 'loading' | 'error' | '' = '', id = 'status') {
  const el = document.getElementById(id)!;
  el.textContent = msg;
  el.className = `status ${type}`;
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function sendToDestination(destination: 'grok' | 'chatgpt' | 'claude' | 'gemini', statusId = 'status', aiLabel?: string) {
  setStatus('Extracting conversation…', 'loading', statusId);

  const tab = await getCurrentTab();
  if (!tab?.id) {
    setStatus('No active tab found.', 'error', statusId);
    return;
  }

  let response: ExtractionResult;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONVERSATION' });
  } catch {
    setStatus('Could not reach page. Reload the tab and try again.', 'error', statusId);
    return;
  }

  if (response.error || !response.messages?.length) {
    setStatus(response.error ?? 'Could not find a conversation on this page.', 'error', statusId);
    return;
  }

  const [activeMode, sendScope, lastNMessages] = await Promise.all([
    getActivePromptMode(),
    getSendScope(),
    getLastNMessages(),
  ]);
  const selectedMessages = selectMessages(response.messages, sendScope, lastNMessages);
  const resolvedAiLabel = aiLabel ?? response.aiLabel ?? 'Claude';
  const prompt = formatPrompt(activeMode.prompt, selectedMessages, resolvedAiLabel);
  await chrome.storage.local.set({ crossAiPrompt: prompt });

  if (destination === 'grok') {
    chrome.tabs.create({ url: 'https://grok.com/' });
  } else if (destination === 'chatgpt') {
    chrome.tabs.create({ url: 'https://chatgpt.com/' });
  } else if (destination === 'claude') {
    chrome.tabs.create({ url: 'https://claude.ai/new' });
  } else if (destination === 'gemini') {
    chrome.tabs.create({ url: 'https://gemini.google.com/app' });
  }

  setStatus('Opening…', '', statusId);
  setTimeout(() => window.close(), 800);
}

document.addEventListener('DOMContentLoaded', async () => {
  let promptModes = await getPromptModes();
  let activeModeId = await getActivePromptModeId(promptModes);
  let sendScope = await getSendScope();
  let lastNMessages = await getLastNMessages();

  const tab = await getCurrentTab();
  const isOnClaude = tab?.url?.includes('claude.ai');
  const isOnChatGPT = tab?.url?.includes('chatgpt.com');
  const isOnGrok = tab?.url?.includes('grok.com');
  const isOnGemini = tab?.url?.includes('gemini.google.com');

  const mainContent = document.getElementById('main-content')!;
  const chatgptContent = document.getElementById('chatgpt-content')!;
  const grokContent = document.getElementById('grok-content')!;
  const geminiContent = document.getElementById('gemini-content')!;
  const notSupported = document.getElementById('not-supported')!;
  const settingsPanel = document.getElementById('settings-panel')!;
  const modeBar = document.getElementById('mode-bar')!;
  const modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
  const scopeBar = document.getElementById('scope-bar')!;
  const scopeSelect = document.getElementById('scope-select') as HTMLSelectElement;
  const lastNWrap = document.getElementById('last-n-wrap')!;
  const lastNInput = document.getElementById('last-n-input') as HTMLInputElement;
  const settingsModeSelect = document.getElementById('mode-select-settings') as HTMLSelectElement;
  const modeNameInput = document.getElementById('mode-name') as HTMLInputElement;
  const promptTextarea = document.getElementById('prompt-prefix') as HTMLTextAreaElement;
  const btnAddMode = document.getElementById('btn-add-mode') as HTMLButtonElement;
  const btnDeleteMode = document.getElementById('btn-delete-mode') as HTMLButtonElement;
  const btnResetMode = document.getElementById('btn-reset-mode') as HTMLButtonElement;
  const btnResetAllModes = document.getElementById('btn-reset-all-modes') as HTMLButtonElement;
  const modeEditorHint = document.getElementById('mode-editor-hint')!;

  // Track which content panel was active before opening settings
  let activePanel: HTMLElement = mainContent;

  function getActiveMode(): PromptMode {
    return getModeById(promptModes, activeModeId) ?? promptModes[0];
  }

  function syncModeSelect(): void {
    const selectedId = activeModeId;
    modeSelect.innerHTML = '';
    settingsModeSelect.innerHTML = '';

    for (const mode of promptModes) {
      const quickOption = document.createElement('option');
      quickOption.value = mode.id;
      quickOption.textContent = mode.name;
      quickOption.selected = mode.id === selectedId;
      modeSelect.appendChild(quickOption);

      const settingsOption = document.createElement('option');
      settingsOption.value = mode.id;
      settingsOption.textContent = mode.name;
      settingsOption.selected = mode.id === selectedId;
      settingsModeSelect.appendChild(settingsOption);
    }
  }

  function syncModeEditor(): void {
    const activeMode = getActiveMode();
    const isBuiltIn = Boolean(getDefaultModeById(activeMode.id));

    modeNameInput.value = activeMode.name;
    promptTextarea.value = activeMode.prompt;
    modeEditorHint.textContent = isBuiltIn
      ? 'Built-in mode. You can edit it and reset it later.'
      : 'Custom mode. Rename it, edit it, or delete it.';
    btnDeleteMode.disabled = isBuiltIn;
    btnResetMode.disabled = !isBuiltIn;
  }

  function syncScopeControls(): void {
    scopeSelect.value = sendScope;
    lastNInput.value = String(lastNMessages);
    lastNWrap.style.display = sendScope === 'last-n' ? 'flex' : 'none';
  }

  async function persistModes(nextModes: PromptMode[], nextActiveModeId = activeModeId): Promise<void> {
    promptModes = nextModes;
    activeModeId = nextActiveModeId;
    await Promise.all([
      savePromptModes(promptModes),
      saveActivePromptModeId(activeModeId),
    ]);
    syncModeSelect();
    syncModeEditor();
  }

  async function updateCurrentMode(updater: (mode: PromptMode) => PromptMode): Promise<void> {
    const nextModes = promptModes.map((mode) =>
      mode.id === activeModeId ? updater(mode) : mode
    );
    await persistModes(nextModes);
  }

  syncModeSelect();
  syncModeEditor();
  syncScopeControls();

  if (isOnClaude) {
    mainContent.style.display = 'block';
    activePanel = mainContent;
  } else if (isOnChatGPT) {
    chatgptContent.style.display = 'block';
    activePanel = chatgptContent;
  } else if (isOnGrok) {
    grokContent.style.display = 'block';
    activePanel = grokContent;
  } else if (isOnGemini) {
    geminiContent.style.display = 'block';
    activePanel = geminiContent;
  } else {
    notSupported.style.display = 'block';
    document.getElementById('btn-settings')!.style.display = 'none';
    modeBar.style.display = 'none';
    scopeBar.style.display = 'none';
    return;
  }

  modeBar.style.display = 'block';
  scopeBar.style.display = 'block';

  document.getElementById('btn-grok')!.addEventListener('click', () => {
    sendToDestination('grok');
  });

  document.getElementById('btn-chatgpt')!.addEventListener('click', () => {
    sendToDestination('chatgpt');
  });

  document.getElementById('btn-gemini')!.addEventListener('click', () => {
    sendToDestination('gemini');
  });

  document.getElementById('btn-grok-from-chatgpt')!.addEventListener('click', () => {
    sendToDestination('grok', 'status-chatgpt');
  });

  document.getElementById('btn-claude')!.addEventListener('click', () => {
    sendToDestination('claude', 'status-chatgpt');
  });

  document.getElementById('btn-gemini-from-chatgpt')!.addEventListener('click', () => {
    sendToDestination('gemini', 'status-chatgpt');
  });

  document.getElementById('btn-claude-from-grok')!.addEventListener('click', () => {
    sendToDestination('claude', 'status-grok', 'Grok');
  });

  document.getElementById('btn-chatgpt-from-grok')!.addEventListener('click', () => {
    sendToDestination('chatgpt', 'status-grok', 'Grok');
  });

  document.getElementById('btn-gemini-from-grok')!.addEventListener('click', () => {
    sendToDestination('gemini', 'status-grok', 'Grok');
  });

  document.getElementById('btn-claude-from-gemini')!.addEventListener('click', () => {
    sendToDestination('claude', 'status-gemini', 'Gemini');
  });

  document.getElementById('btn-chatgpt-from-gemini')!.addEventListener('click', () => {
    sendToDestination('chatgpt', 'status-gemini', 'Gemini');
  });

  document.getElementById('btn-grok-from-gemini')!.addEventListener('click', () => {
    sendToDestination('grok', 'status-gemini', 'Gemini');
  });

  // Settings toggle
  const btnSettings = document.getElementById('btn-settings')!;
  const btnBack = document.getElementById('btn-back')!;
  const autoSubmitToggle = document.getElementById('auto-submit-toggle') as HTMLInputElement;

  btnSettings.addEventListener('click', async () => {
    const autoSubmit = await getAutoSubmit();
    autoSubmitToggle.checked = autoSubmit;
    syncModeSelect();
    syncModeEditor();
    activePanel.style.display = 'none';
    modeBar.style.display = 'none';
    scopeBar.style.display = 'none';
    settingsPanel.style.display = 'flex';
  });

  btnBack.addEventListener('click', () => {
    settingsPanel.style.display = 'none';
    modeBar.style.display = 'block';
    scopeBar.style.display = 'block';
    activePanel.style.display = 'block';
  });

  modeSelect.addEventListener('change', async () => {
    activeModeId = modeSelect.value;
    await saveActivePromptModeId(activeModeId);
    syncModeSelect();
    syncModeEditor();
  });

  settingsModeSelect.addEventListener('change', async () => {
    activeModeId = settingsModeSelect.value;
    await saveActivePromptModeId(activeModeId);
    syncModeSelect();
    syncModeEditor();
  });

  scopeSelect.addEventListener('change', async () => {
    sendScope = scopeSelect.value as SendScope;
    await saveSendScope(sendScope);
    syncScopeControls();
  });

  lastNInput.addEventListener('change', async () => {
    const nextValue = Number(lastNInput.value);
    lastNMessages = Number.isFinite(nextValue) ? Math.max(2, Math.min(50, Math.round(nextValue))) : DEFAULT_LAST_N_MESSAGES;
    await saveLastNMessages(lastNMessages);
    syncScopeControls();
  });

  modeNameInput.addEventListener('input', () => {
    void updateCurrentMode((mode) => ({
      ...mode,
      name: modeNameInput.value.trim() || 'Untitled mode',
    }));
  });

  promptTextarea.addEventListener('input', () => {
    const fallbackPrompt = getDefaultModeById(activeModeId)?.prompt ?? 'Review this conversation.';
    void updateCurrentMode((mode) => ({
      ...mode,
      prompt: promptTextarea.value.trim() || fallbackPrompt,
    }));
  });

  btnAddMode.addEventListener('click', () => {
    const nextMode: PromptMode = {
      id: createModeId('Custom mode', promptModes),
      name: 'Custom mode',
      prompt:
        `Here is a full conversation between a User and {AI}. ` +
        `Review the thread according to this mode and explain your reasoning clearly.`,
    };

    void persistModes([...promptModes, nextMode], nextMode.id);
  });

  btnDeleteMode.addEventListener('click', () => {
    if (getDefaultModeById(activeModeId)) return;

    const nextModes = promptModes.filter((mode) => mode.id !== activeModeId);
    const nextActiveModeId = nextModes[0]?.id ?? DEFAULT_PROMPT_MODES[0].id;
    void persistModes(nextModes, nextActiveModeId);
  });

  btnResetMode.addEventListener('click', () => {
    const defaultMode = getDefaultModeById(activeModeId);
    if (!defaultMode) return;

    void updateCurrentMode(() => ({ ...defaultMode }));
  });

  btnResetAllModes.addEventListener('click', () => {
    if (!window.confirm('Reset all comparison modes to the original defaults?')) return;

    void persistModes(cloneDefaultPromptModes(), DEFAULT_PROMPT_MODES[0].id);
  });

  autoSubmitToggle.addEventListener('change', () => {
    saveAutoSubmit(autoSubmitToggle.checked);
  });
});
