# AI vs AI

Browser extension for sending a conversation from one AI chat app to another AI for fact-checking, critique, counterarguments, or a better answer.

## Demo

<video src="https://github.com/user-attachments/assets/40721d73-7272-40d1-8e06-4e2f4f85fa9e" controls width="100%"></video>

It currently supports:

- Source chats: Claude, ChatGPT, Gemini, Grok
- Destination chats: Claude, ChatGPT, Gemini, Grok
- Browser targets: Chromium-based browsers (Chrome, Brave, Edge) and Firefox

## Why This Exists

The idea came from [this post on X](https://x.com/danigerwa/status/2042704073078575287).

AI tools are useful, but they can be overconfident, incomplete, or just wrong. AI vs AI makes it easy to grab the current conversation and ask a competing model to review it without manually copying and pasting the whole thread.

## Features

- Extract the current conversation from supported AI chat pages
- Send the full thread or a smaller slice of it
- Choose between built-in comparison modes like fact-checking and harsh critique
- Create your own prompt modes
- Prefill the destination AI automatically
- Optionally auto-submit after prefill

## Privacy

AI vs AI does not collect, transmit, or store any data outside your own machine.

- **No analytics.** The extension has no telemetry, crash reporting, or usage tracking of any kind.
- **No external servers.** The extension makes no network requests of its own. The only outbound connections your browser makes are the ones you already make by visiting Claude, ChatGPT, Gemini, or Grok directly.
- **Local storage only.** The extracted conversation is written to `chrome.storage.local` as a one-shot value and deleted the moment the destination tab reads it. Your custom prompt modes and settings are stored in `chrome.storage.sync`, which is local to your browser profile (and synced by Chrome's own account sync if you have that enabled — that is controlled entirely by your browser, not by this extension).
- **No background processes.** There is no persistent background service worker. Nothing runs between your interactions with the popup.

The extension only reads page content from AI chat sites you explicitly visit and only when you click the popup button.

## Install From GitHub

The extension is not in any browser store right now. The intended install path is GitHub.

### Option 1: Install from a GitHub Release

This is the easiest option once releases are published.

Do not use GitHub's default source-code ZIP from the green **Code** button for installation. That archive contains the source repo, not the built extension.

1. Open the repository's [Releases](../../releases) page.
2. Download the appropriate zip for your browser:
   - Chrome, Brave, or Edge: `ai-vs-ai-<version>-chrome.zip`
   - Firefox: `ai-vs-ai-<version>-firefox.zip`
3. Unzip it somewhere on your machine.

**Chrome / Brave / Edge:**

4. Open `chrome://extensions`.
5. Turn on **Developer mode**.
6. Click **Load unpacked**.
7. Select the folder you just extracted. It should contain `manifest.json` at its top level.

**Firefox:**

4. Open `about:debugging#/runtime/this-firefox`.
5. Click **Load Temporary Add-on**.
6. Select the `manifest.json` file inside the folder you extracted.

After that, the extension should appear in your browser toolbar.

### Option 2: Build It Yourself

If you want the latest code from `main` before a release exists:

**Chrome:**
```bash
npm install
npm run zip
```

**Firefox:**
```bash
npm install
npm run zip:firefox
```

The build output will be created in:

| Browser | Unpacked | Zip |
|---|---|---|
| Chrome | `.output/chrome-mv3` | `.output/ai-vs-ai-<version>-chrome.zip` |
| Firefox | `.output/firefox-mv3` | `.output/ai-vs-ai-<version>-firefox.zip` |

To install the unpacked Chrome build:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `.output/chrome-mv3`.

To install the unpacked Firefox build:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` inside `.output/firefox-mv3`.

## Usage

1. Open a supported source AI chat page.
2. Click the AI vs AI extension icon.
3. Pick the destination AI.
4. The extension extracts the conversation, stores a one-shot prompt, opens the destination AI, and prefills the input.
5. If **Auto-submit** is enabled, it also clicks send for you.

## Comparison Modes

Built-in modes:

- Fact-check
- Harsh critique
- Counterargument
- Better answer

You can also:

- edit built-in modes
- create custom modes
- reset a single built-in mode
- reset all modes

## Send Scope

You can choose how much context gets forwarded:

- Full conversation
- Last N messages
- Latest assistant answer
- Latest answer + context

## Supported Sites

The current codebase supports these chat sites:

- `claude.ai`
- `chatgpt.com`
- `gemini.google.com`
- `grok.com`

If a site changes its HTML structure, extraction or prefill may stop working until the selectors are updated.

## When Something Breaks

This project depends on the DOM structure of third-party AI chat apps, so breakages can happen when those apps ship UI changes.

Common symptoms:

- the popup says it could not find a conversation
- only part of the thread is extracted
- the destination page opens but the prompt is not inserted
- auto-submit stops clicking the send button

If that happens:

1. Reload the source tab and try again.
2. Make sure you are on a supported chat page with a visible conversation.
3. Check whether the same problem still happens after reinstalling the latest GitHub build.
4. If it is still broken, please open an issue or submit a PR.

### Reporting a Breakage

Please include:

- which site broke, for example Claude or ChatGPT
- whether extraction failed or prefill failed
- the browser, version, and whether it is Chrome or Firefox
- a screenshot or screen recording if possible
- any visible error message from the extension popup
- whether the problem started after the site changed its UI

If you are comfortable debugging DOM changes, PRs are very welcome.

## Development

### Requirements

- Node.js 20+ recommended
- npm
- Chrome, Brave, or Edge and/or Firefox for manual testing

### Local commands

```bash
npm run dev              # Chrome dev server with HMR
npm run dev:firefox      # Firefox dev server with HMR
npm run build            # production build for Chrome
npm run build:firefox    # production build for Firefox
npm run zip              # Chrome zip for store/release
npm run zip:firefox      # Firefox zip for store/release
```

### Manual testing

There is no automated test suite yet.

**Chrome:**

1. Load the unpacked extension from `.output/chrome-mv3`
2. Open supported AI chat pages
3. Verify extraction from the source site
4. Verify prefill on the destination site
5. Verify auto-submit only when intended

**Firefox:**

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and select `.output/firefox-mv3/manifest.json`
3. Follow the same verification steps as Chrome

## CI and Releases

GitHub Actions is set up to:

- build both the Chrome and Firefox extensions on pushes and pull requests
- upload unpacked builds and zips as workflow artifacts for both browsers
- attach both zips to tagged releases

For public installs, GitHub Releases are the important part. Actions artifacts are mainly useful for testing branches and pull requests.

Recommended release flow:

1. Bump `package.json` version.
2. Push a tag like `v0.1.0`.
3. GitHub Actions builds both extensions.
4. The workflow publishes `ai-vs-ai-0.1.0-chrome.zip` and `ai-vs-ai-0.1.0-firefox.zip` to GitHub Releases.

That gives people a direct download from GitHub without needing the browser stores.

## Repository Structure

```text
entrypoints/
  *.content.ts            Source-site extraction scripts
  *-prefill.content.ts    Destination-site prefill scripts
  popup/                  Popup UI and orchestration
```

Important generated directories:

- `.output/` build artifacts
- `.wxt/` WXT generated files

## Contributing

Bug reports and PRs are welcome, especially for parser fixes when supported AI sites change their markup.

If you want to work on a fix, start with [CONTRIBUTING.md](./CONTRIBUTING.md).
