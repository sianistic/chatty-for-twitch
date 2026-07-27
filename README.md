<p align="center">
  <img src="assets/chatty-logo.png" alt="Chatty logo" width="160">
</p>

# Chatty for Twitch

A lightweight Manifest V3 browser extension that replaces Twitch's message
stream with a dense, Chatterino-inspired view.

## Features

- Compact messages, timestamps, Twitch badges, and username colors
- Global and channel-specific 7TV emotes
- Startup hydration so messages already on screen gain 7TV emotes after loading
- Rich emote hover cards with provider, creator, animation, and emote ID details
- Twitch badge hover cards with the full badge label and provider
- 7TV autocomplete after two matching letters, with keyboard navigation
- Custom highlights by username or phrase
- Automatic mention highlighting
- Click a username to open Twitch's native user card
- Twitch's real authenticated Slate composer remains visible and fully functional
- Channel-point reward messages receive a distinct style
- Twitch's native bottom-left points balance is always visible and opens the
  authenticated rewards picker for viewing and spending
- Manual bonus-point claiming and optional automatic bonus claiming
- Optional live-channel monitoring that opens selected channels when they
  transition from offline to live
- Reward confirmations, chat sending, and point spending remain authenticated
  and handled by Twitch

## Install in Chrome, Edge, Brave, or another Chromium browser

1. Open the browser's extensions page (`chrome://extensions` in Chrome or
   `edge://extensions` in Edge).
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project folder (the folder containing `manifest.json`).
5. Open or reload a Twitch channel.

The extension popup can turn the replacement on or off. Use the settings button
in the Twitch chat header to edit highlights. Its **Automation** tab controls
automatic point claims and live-channel opening.

## Why point spending uses Twitch's native picker

Twitch's documented Channel Points API lets broadcasters and authorized apps
manage custom rewards and redemptions; it does not provide a supported
viewer-facing API for an extension to spend a viewer's points. Chatty therefore
opens Twitch's own picker instead of reading credentials or calling private,
fragile endpoints.

## Privacy

Chatty stores settings in browser sync storage. It does not collect Twitch
credentials or transmit chat history. To resolve a channel's numeric Twitch ID,
the background worker requests `decapi.me/twitch/id/<channel>`; it then requests
that channel's public emote set and the global set from `7tv.io`.

When live-channel opening is enabled, the worker also requests
`decapi.me/twitch/uptime/<channel>` at the selected interval. Only the last
offline/live state is stored locally. A tab opens once on an offline-to-live
transition, not on every poll.

## Development

```powershell
npm install
npm test
npm run package
```

The packaged extension is written to `dist/chatty-for-twitch.zip`.

## Compatibility note

Twitch regularly changes its internal HTML. Chatty uses several fallback
selectors, but a future Twitch redesign may require selector updates in
`src/content.js`.
