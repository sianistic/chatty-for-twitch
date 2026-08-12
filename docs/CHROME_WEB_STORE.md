# Chrome Web Store Submission Guide

This file contains the release-specific copy and declarations for Chatty for
Twitch 0.9.1. Keep the dashboard answers, store description, privacy policy,
and actual extension behavior consistent.

## Upload package

Run:

```powershell
npm install
npm test
npm run package
```

Upload `dist/chatty-for-twitch.zip`. The archive contains `manifest.json`,
`assets/`, and `src/` at its root. Do not upload the complete Git repository.

## Store listing

**Name**

Chatty for Twitch

**Category**

Social & Communication

**Summary**

A compact, customizable Twitch chat with 7TV emotes, highlights, replies, and native Twitch controls.

**Detailed description**

```text
Chatty replaces Twitch's visible message stream with a compact, customizable chat while keeping account-sensitive actions inside Twitch's authenticated interface.

Features:
• Global and channel-specific 7TV emotes
• Two-letter 7TV autocomplete and detailed emote hover information
• Compact messages, timestamps, Twitch badges, and username colors
• Custom username, phrase, and mention highlights
• Clickable links, pinned messages, reply previews, and loaded-message threads
• Native Twitch message sending, user cards, replies, Channel Points, and Predictions
• Moderator delete, timeout, and ban shortcuts when available
• Virtualized chat rendering for busy channels
• Optional Channel Points bonus claiming
• Optional live-channel monitoring that opens a channel once when it goes live

Automation is off by default. Chatty does not request Twitch credentials, include analytics or ads, sell user data, or execute remotely hosted code.

Chatty is an unofficial community extension and is not affiliated with or endorsed by Twitch, 7TV, Chatterino, or the Chatty desktop client.

Twitch Channel Points used in Predictions are non-purchasable, have no monetary value, and cannot be redeemed for cash or prizes of value. Prediction participation and confirmation remain in Twitch's own interface.
```

**Homepage URL**

https://github.com/sianistic/chatty-for-twitch

**Support URL**

https://github.com/sianistic/chatty-for-twitch/issues

**Privacy policy URL**

https://github.com/sianistic/chatty-for-twitch/blob/main/PRIVACY.md

The privacy URL will work after the pull request containing `PRIVACY.md` is
merged into `main`.

## Privacy practices

**Single purpose**

```text
Provide a compact, customizable Twitch chat interface and directly related Twitch chat-access features while delegating authenticated actions to Twitch.
```

**Permission justifications**

`storage`

```text
Stores the user's Chatty appearance, highlight, message-limit, and optional automation settings. Local storage also remembers the last online/offline state of user-selected channels so live monitoring opens a channel only once per transition.
```

`alarms`

```text
Schedules periodic status checks only when the user enables live-channel monitoring and configures at least one channel. The alarm is cleared when the feature is disabled.
```

`https://www.twitch.tv/*`

```text
Limits Chatty's content script to Twitch pages, lets it read and replace the on-page chat presentation, delegates account-sensitive actions to Twitch's existing controls, and lets optional live-channel automation identify, focus, refresh, or open matching Twitch channel tabs.
```

`https://7tv.io/*`

```text
Fetches public global and channel-specific 7TV emote metadata. Chatty sends no Twitch credential or chat message to 7TV.
```

`https://decapi.me/*`

```text
Sends the current public Twitch channel name to resolve its numeric channel ID for 7TV. When the user enables live-channel monitoring, it also checks the configured public channel names for live status.
```

**Remote code**

Select **No, I am not using remote code**. All executable JavaScript and CSS is
inside the uploaded package. 7TV and DecAPI responses are treated as public data,
not executable logic.

**Data disclosures**

Disclose the categories that the extension processes, including when processing
is local:

- personally identifiable information: public Twitch usernames/display names;
- personal communications or user-generated content: Twitch chat messages;
- website content: the Twitch chat, badges, emotes, pinned messages, Channel
  Points UI, and Predictions UI displayed on the current page; and
- web history/browsing activity: the current Twitch channel URL and, when live
  monitoring is enabled, matching open Twitch channel tabs.

For each category, declare that the information is used only for the extension's
core functionality. Do not select advertising, creditworthiness, or sale to third
parties. Certify the Limited Use statements. The developer does not receive this
locally processed data; only public channel identifiers are sent to 7TV/DecAPI as
described in `PRIVACY.md`.

## Test instructions for reviewers

No special account is provided by the extension. Some actions require the
reviewer to use their own Twitch account.

```text
1. Install the extension and open a Twitch channel with active chat.
2. Confirm the visible message stream is replaced by the Chatty interface.
3. Click the extension toolbar icon to disable or re-enable replacement chat.
4. Open Chatty settings from the gear in its chat header to test display and highlight settings.
5. Type at least two letters matching a 7TV emote to test autocomplete.
6. Hover messages, usernames, badges, and emotes to test reply controls and metadata.
7. Channel Points, Predictions, user cards, message sending, and moderation continue through Twitch's native authenticated controls and depend on the account/channel state.
8. Optional point claiming and live-channel monitoring are disabled by default and can be enabled from Chatty settings.
```

## Required listing graphics

- Store icon: `assets/icons/chatty-128.png`
- At least one screenshot: 1280x800 pixels preferred; 640x400 is accepted
- Small promotional tile: 440x280 pixels
- Optional marquee tile: 1400x560 pixels

Use current, full-bleed screenshots that show the actual extension. Avoid claims
such as "official," "best," or store rankings. Keep Chatty's logo and colors
consistent across the icon, screenshots, and promotional graphics.

## Submission order

1. Merge the release pull request so the homepage and privacy-policy URLs are public.
2. Upload `dist/chatty-for-twitch.zip` in the Chrome Web Store Developer Dashboard.
3. Complete Store Listing, Privacy, Distribution, and Test Instructions.
4. Upload the required graphics.
5. Recheck that dashboard data disclosures match `PRIVACY.md`.
6. Submit for review. Use deferred publishing if you want to choose the release time after approval.
