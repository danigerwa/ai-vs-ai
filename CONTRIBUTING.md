# Contributing

Thanks for helping with AI vs AI.

## Good First Contributions

- Fix a broken parser after an AI site changes its markup
- Update a prefill selector when the destination input changes
- Improve popup copy or settings UX
- Add docs, screenshots, or demo assets

## Local Setup

```bash
npm install
npm run dev
```

For production-style output:

```bash
npm run zip
```

Load `.output/chrome-mv3` as an unpacked extension in `chrome://extensions`.

## If Conversation Parsing Breaks

This extension relies on the HTML structure of third-party AI chat apps. Breakages are expected from time to time.

If you notice that messages are no longer extracted correctly:

1. Open an issue with the affected site, browser, and screenshots.
2. If you already know the fix, open a PR directly.

Please mention:

- which site broke
- what changed in the DOM, if you know
- whether the failure is in extraction or prefill
- a before/after screenshot if possible

## Parser Change Guidelines

- Prefer the most stable selectors first, such as semantic attributes
- Add new fallback strategies at the end
- Keep the `messages.length >= 2` guard before returning a successful extraction
- Keep duplicated helper behavior in sync across content scripts when fixing shared logic

## Pull Requests

Small, focused PRs are easiest to review.

Before opening a PR:

1. Run `npm run zip`
2. Manually verify the affected source and destination flows
3. Update the README if user-facing behavior changed

If your PR fixes a parser breakage, include:

- the affected site
- the selector or DOM strategy you changed
- a short description of how you validated it
