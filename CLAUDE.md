# AI vs AI — Developer Guide

Browser extension that lets users cross-check an AI conversation by sending it to a competing AI for fact-checking or critique.

## Commands

```bash
npm run dev      # dev server with HMR (Chrome by default)
npm run build    # production build → .output/
npm run zip      # production zip for store submission
```

No test suite yet. Manual testing requires loading the unpacked `.output/chrome-mv3` directory in `chrome://extensions`.

## Architecture

### Framework
[WXT](https://wxt.dev/) (Web Extension Toolkit) wrapping Manifest V3. TypeScript throughout — no React, no UI framework. Plain DOM manipulation in the popup.

### Entrypoints

| File | Role |
|---|---|
| `entrypoints/{platform}.content.ts` | Injected into the AI site; listens for `GET_CONVERSATION` message, extracts & returns the thread |
| `entrypoints/{platform}-prefill.content.ts` | Injected into destination AI site; reads `crossAiPrompt` from `chrome.storage.local` and fills the input |
| `entrypoints/popup/main.ts` | Popup orchestration: send message → get conversation → format prompt → store → open tab |
| `entrypoints/popup/index.html` | Popup HTML; one content panel per source AI + shared settings panel |

**Supported platforms**: `claude` (claude.ai), `chatgpt` (chatgpt.com), `gemini` (gemini.google.com), `grok` (grok.com)

### Data flow

```
User clicks popup button
  → popup sends GET_CONVERSATION to active tab's content script
  → content script extracts thread, returns { messages, aiLabel }
  → popup formats prompt, writes crossAiPrompt to chrome.storage.local
  → popup opens new tab on destination AI site
  → destination prefill content script reads & clears crossAiPrompt, fills input
  → if autoSubmit enabled, clicks the send button
```

### Storage

| Key | Store | Description |
|---|---|---|
| `crossAiPrompt` | `chrome.storage.local` | One-shot prompt passed to the destination tab; cleared on first read |
| `critiquePromptPrefix` | `chrome.storage.sync` | User-editable prompt template; `{AI}` is replaced with the source AI name |
| `autoSubmit` | `chrome.storage.sync` | Boolean; auto-clicks send after prefill |

### Shared types

`ConversationMessage` and `ExtractionResult` are defined and exported from `entrypoints/claude.content.ts`. All other content scripts import from there:

```ts
import type { ConversationMessage, ExtractionResult } from './claude.content';
```

Do not redefine these types elsewhere.

## Extraction strategies

Each `{platform}.content.ts` tries strategies in order from most to least stable:

1. **Semantic attributes** — `data-testid`, `data-message-author-role`, Angular custom elements (`<user-query>`, `<model-response>`)
2. **Copy-button anchor** (Claude only) — walks up the DOM from the copy button to find the AI message container
3. **CSS alignment heuristic** (Grok only) — `getComputedStyle(el).alignItems` to distinguish user (flex-end) vs AI (flex-start) bubbles

Always add new strategies at the end and guard them with a `messages.length >= 2` check before returning.

### `getCleanText()` contract

- Clone → strip noise (`button, svg, script, style, noscript, time, [role="img"], [aria-hidden="true"]`) → attach off-screen with `position:fixed;left:-9999px` → read `innerText` → remove timestamps & counters → detach.
- **Must** attach to the live document before reading `innerText`; detached nodes fall back to `textContent` which includes `<script>`/`<style>` tag content.
- **Do not** use `visibility:hidden` — `innerText` returns empty string on hidden elements.

## Prefill scripts

Each `{platform}-prefill.content.ts` follows the same structure:

1. Read & immediately delete `crossAiPrompt` from `chrome.storage.local`
2. Poll for the input element using `requestAnimationFrame` (not `setInterval`) until found or timeout
3. Fill via `fillInput()`: native value setter + synthetic `input`/`change` events for `<textarea>`, or `execCommand('selectAll') + execCommand('insertText')` for `contenteditable`
4. If `autoSubmit`, poll for an enabled send button and click it

Input selector priority: most-specific first (e.g. `#prompt-textarea`) → generic `div[contenteditable="true"]` → `textarea`. Always check `isVisible()`.

## Adding a new AI platform

1. Create `entrypoints/{platform}.content.ts` — implement `extractConversation()` returning `ExtractionResult` with `aiLabel` set; import types from `claude.content`
2. Create `entrypoints/{platform}-prefill.content.ts` — copy the prefill pattern; implement `findInput()` and `findSubmitButton()` for the site
3. Add `{platform}` to the `destination` union type in `popup/main.ts`
4. Add the new tab URL in `sendToDestination()`
5. Add a content panel `<div id="{platform}-content">` with buttons in `popup/index.html`
6. Wire up buttons in `popup/main.ts` DOMContentLoaded handler

## Known patterns & pitfalls

- **Duplicate helpers**: `getCleanText`, `fillInput`, `waitForInput`, `waitForSubmitButton`, `isVisible` are copy-pasted across files. This is intentional — content scripts run in isolation and can't share a module without a background script or bundler workaround. Keep them in sync when fixing bugs.
- **`role` field on `ConversationMessage`**: Currently a union of `'user' | 'claude' | 'chatgpt'`. Non-Claude AI responses use `'chatgpt'` as a catch-all. The `aiLabel` field in `ExtractionResult` carries the display name. Keep this distinction in mind when reading the role.
- **Popup panel visibility**: Each platform panel is hidden by default (`display: none`); only the matching one is shown. The settings panel overlays the active panel. State tracking (`activePanel`) is in-memory only — popup closes and resets on each use.
- **No background service worker**: All logic runs in popup + content scripts. No persistent background page.
- **MV3 `chrome.tabs.sendMessage`**: Returns a promise that rejects if no content script is listening (e.g., wrong page or script not yet injected). Always wrap in try/catch.
