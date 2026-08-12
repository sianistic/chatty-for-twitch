# Privacy Policy for Chatty for Twitch

Effective date: August 11, 2026

Chatty for Twitch ("Chatty") is an unofficial browser extension that replaces
the visible Twitch chat presentation with a compact, customizable interface.
This policy explains what the extension processes, where that information goes,
and what it does not do.

## Summary

- The developer does not operate a Chatty server and does not receive or store
  users' Twitch chat history, credentials, settings, or browsing history.
- Chatty has no analytics, advertising, tracking, or data sales.
- Twitch chat messages, usernames, badges, emotes, links, Channel Points UI,
  pinned messages, and Predictions UI are read from the open Twitch page and
  processed locally to provide the replacement chat interface.
- Chatty sends only the Twitch channel identifiers described below to 7TV and
  DecAPI to provide emotes and optional live-channel monitoring.

## Information processed locally

While a Twitch channel page is open, Chatty processes the page content necessary
to render and operate chat. This can include:

- public Twitch usernames, display names, badges, username colors, and messages;
- links, emotes, reply relationships, pinned messages, moderation state,
  Channel Points interface text, and active Prediction information;
- the current Twitch channel name and URL; and
- user-created Chatty settings such as highlight rules, colors, font size,
  message limit, and optional automation preferences.

Chat messages are retained only in the extension's in-memory message buffer for
the current page session. Outgoing draft text may be retained briefly in page
memory to prevent Twitch confirmations from appearing as duplicate messages.
Neither messages nor drafts are persisted as chat history or transmitted to the
developer.

Chat sending, Channel Point spending, Prediction voting, user cards, and
moderation actions are delegated to Twitch's own page controls. Chatty does not
collect Twitch passwords, authentication cookies, OAuth tokens, or payment data.

## Browser storage

Chatty uses the browser's synchronized extension storage for settings. Depending
on the user's browser and sync configuration, the browser provider may sync
those settings between the user's signed-in browser profiles.

When optional live-channel monitoring is enabled, Chatty uses local extension
storage to remember whether each selected channel was last observed as online
or offline. This prevents repeated tab openings. These records are updated as
checks run and can be removed by clearing the extension's data or uninstalling
the extension.

## External requests

Chatty makes HTTPS requests to these services only to provide its disclosed
features:

- **7TV (`7tv.io`)**: requests the public global emote set and, when available,
  the public emote set for the current Twitch channel.
- **DecAPI (`decapi.me`)**: sends a Twitch channel name to resolve its public
  numeric Twitch ID for 7TV. When the user explicitly enables live-channel
  monitoring, Chatty also sends the configured channel names to DecAPI to check
  whether they are live.
- **Twitch (`twitch.tv`)**: Chatty runs only on Twitch pages, reads the on-page
  chat interface, and uses Twitch's existing controls for authenticated actions.
  Optional live-channel automation may inspect, focus, refresh, or open a
  matching Twitch channel tab.

Those services may independently receive ordinary network information such as
an IP address and request metadata under their own privacy practices. Chatty does
not add a user identifier, advertising identifier, credential, or chat message
to its 7TV or DecAPI requests.

## Sharing, selling, and advertising

The developer does not sell, rent, or share user information for advertising,
profiling, credit, or other unrelated purposes. Chatty does not use information
for personalized advertising and does not allow humans to read users' chat data
through a developer-operated service.

Information is transferred to 7TV and DecAPI only as described above and only as
necessary to provide emotes or user-enabled live-channel monitoring.

## Security and remote code

External requests use HTTPS. All executable code is included in the extension
package. Chatty does not download or execute remotely hosted code.

## User choices and deletion

Users can disable Chatty from its toolbar popup. Automatic Channel Point claiming
and live-channel monitoring are separate settings and are off by default.

Users can remove stored Chatty settings and live-state records by clearing the
extension's data in the browser or uninstalling the extension. Closing or
refreshing a Twitch tab clears that tab's in-memory Chatty messages.

## Chrome Web Store Limited Use

Chatty's use of information is limited to providing and improving its disclosed
single purpose: a customizable Twitch chat interface and its directly related
Twitch chat-access features. The extension's use of information complies with
the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Children and sensitive information

Chatty is not designed to collect information from children or to collect
sensitive personal information. Users should not send passwords, tokens, payment
details, or other sensitive information through support reports.

## Changes to this policy

If Chatty's data practices change, this policy and the Chrome Web Store privacy
disclosures will be updated before the new practices are released.

## Contact and support

Privacy questions and support requests can be filed at:

https://github.com/sianistic/chatty-for-twitch/issues
