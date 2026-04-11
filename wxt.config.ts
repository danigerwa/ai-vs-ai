import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'AI vs AI',
    description: 'Get a second opinion on AI answers',
    permissions: ['storage', 'tabs'],
    browser_specific_settings: {
      gecko: {
        id: 'ai-vs-ai@extension',
        strict_min_version: '109.0',
      },
    },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    action: {
      default_title: 'AI vs AI',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
    },
  },
});
