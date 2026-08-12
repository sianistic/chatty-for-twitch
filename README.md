<p align="center">
  <img src="assets/chatty-logo.png" alt="Chatty logo" width="152">
</p>

<h1 align="center">Chatty for Twitch</h1>

<p align="center">
  A fast, compact, and customizable Twitch chat experience with 7TV emotes and native Twitch controls.
</p>

> [!NOTE]
> Chatty is an unofficial community extension. It is not affiliated with or endorsed by Twitch, 7TV, Chatterino, or the Chatty desktop client.

## What Chatty does

Chatty replaces the visible message stream on Twitch channel pages while keeping
Twitch's authenticated composer, Channel Points, user cards, moderation actions,
and Predictions interfaces in control of account-sensitive actions.

### Chat and emotes

- Dense chat layout with optional timestamps, compact spacing, Twitch badges,
  username colors, and a configurable font size
- Global and channel-specific 7TV emotes, including messages already visible
  when the emote set finishes loading
- 7TV autocomplete after two matching letters, with keyboard navigation
- Detailed hover cards for emotes and higher-resolution Twitch badge previews
- Custom username and phrase highlights, plus automatic mention highlighting
- Clickable links, visible filtered messages, pinned messages, and
  Channel Point reward styling
- A virtualized message list that keeps long and fast-moving chats responsive

### Native Twitch interactions

- Send messages through Twitch's real authenticated composer
- Click usernames to open Twitch's user cards
- Hover a message to reveal a larger reply button
- See the immediate parent of an incoming reply and open Chatty's
  loaded-message thread view
- Use moderator quick actions that send Twitch's native delete, timeout, and ban
  commands when Twitch exposes moderator access
- Keep Twitch's native Channel Points control available for claiming and spending
- Mirror active Predictions, then open Twitch's native interface to vote,
  confirm a wager, or view results

### Optional automation

- Automatically claim available Channel Points bonuses
- Monitor selected Twitch channels and open them once when they transition from
  offline to live
- Focus and refresh an already-open matching channel instead of opening a
  duplicate tab

Both automation features are disabled by default.

## Installation

### Chrome Web Store

The store listing is being prepared. Its link will be added here after Google
approves the first release.

### Load the unpacked extension

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or Brave, or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder containing `manifest.json`.
6. Open or refresh a Twitch channel page.

After changing local extension files, click **Reload** on the extensions page
and refresh the Twitch tab. Pulling or downloading new files does not reload an
already-running unpacked extension automatically.

## Using Chatty

The toolbar popup enables or disables the replacement chat. The settings button
in Chatty's header controls timestamps, density, font size, retained-message
count, highlight rules, highlight colors, point claiming, and live-channel
monitoring.

Chatty deliberately delegates chat sending, Channel Point spending, user cards,
moderation commands, and Prediction participation to Twitch's own authenticated
controls. It does not request Twitch credentials or use private Twitch APIs.

## Privacy and permissions

Chatty processes the Twitch chat content already displayed in your browser so it
can render the replacement interface. Chat messages are kept only in memory and
are not sent to the developer or saved as chat history.

Settings are saved with browser storage. Chatty requests public emote and channel
status data from 7TV and DecAPI over HTTPS. It contains no analytics, advertising,
tracking, or remotely hosted executable code.

See the full [Privacy Policy](PRIVACY.md) and the
[Chrome Web Store submission guide](docs/CHROME_WEB_STORE.md) for exact data and
permission disclosures.

## Development

Requirements: Node.js 20 or newer and PowerShell on Windows.

```powershell
npm install
npm test
npm run package
```

The release archive is written to
[`dist/chatty-for-twitch.zip`](dist/chatty-for-twitch.zip). Upload that ZIP to
the Chrome Web Store; do not ZIP the repository root manually.

## Compatibility and limitations

- Chatty supports Chromium browsers through Manifest V3.
- Twitch regularly changes its internal page structure. Chatty has fallback
  selectors and integration tests, but a future redesign may require an update.
- The thread drawer can show only reply messages currently retained by Chatty.
- Channel-specific 7TV emotes are unavailable when a channel has no 7TV set.
- Point spending and Prediction voting require Twitch to expose those controls
  for the signed-in account and channel.

## Support

Report reproducible problems through
[GitHub Issues](https://github.com/sianistic/chatty-for-twitch/issues). Include
the browser version, Chatty version, Twitch channel, and steps that trigger the
problem. Do not include passwords, cookies, access tokens, or other private
account information.

Twitch is a trademark of Twitch Interactive, Inc. 7TV belongs to its respective
owners.
