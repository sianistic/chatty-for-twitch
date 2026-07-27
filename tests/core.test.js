"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("settings are bounded and lists are normalized", () => {
  const value = core.sanitizeSettings({
    fontSize: 99,
    maxMessages: 2,
    highlightUsers: " Alice, bob\n@Carol ",
    highlightColor: "red"
  });
  assert.equal(value.fontSize, 22);
  assert.equal(value.maxMessages, 100);
  assert.deepEqual(value.highlightUsers, ["Alice", "bob", "@Carol"]);
  assert.equal(value.highlightColor, core.DEFAULT_SETTINGS.highlightColor);
});

test("mentions take priority over custom highlight rules", () => {
  const match = core.getHighlight(
    { username: "alice", text: "hello @Viewer!" },
    { highlightUsers: ["alice"], mentionColor: "#123456" },
    "viewer"
  );
  assert.deepEqual(match, { type: "mention", color: "#123456" });
});

test("7TV payloads are indexed and exact tokens become emotes", () => {
  const indexed = core.indexEmotes([
    {
      emotes: [{
        name: "catJAM",
        data: {
          owner: { display_name: "EmoteArtist" },
          animated: true,
          host: {
            url: "//cdn.7tv.app/emote/abc",
            files: [{ name: "2x.webp", width: 64, height: 64 }]
          }
        }
      }]
    }
  ]);
  assert.equal(indexed.get("catJAM").url, "https://cdn.7tv.app/emote/abc/2x.webp");
  assert.equal(indexed.get("catJAM").provider, "7TV");
  assert.equal(indexed.get("catJAM").owner, "EmoteArtist");
  assert.equal(indexed.get("catJAM").animated, true);
  assert.deepEqual(
    core.tokenizeEmotes("hi catJAM!", indexed).map((part) => part.type),
    ["text", "text", "text"]
  );
  assert.deepEqual(
    core.tokenizeEmotes("hi catJAM", indexed).map((part) => part.type),
    ["text", "text", "emote"]
  );
});

test("automation settings normalize Twitch channel URLs", () => {
  const value = core.sanitizeSettings({
    autoClaimPoints: true,
    autoOpenLive: true,
    liveChannels: "https://twitch.tv/XQC, @pokimane, invalid channel!",
    liveCheckMinutes: 0
  });
  assert.equal(value.autoClaimPoints, true);
  assert.equal(value.autoOpenLive, true);
  assert.deepEqual(value.liveChannels, ["xqc", "pokimane"]);
  assert.equal(value.liveCheckMinutes, 1);
});

test("live status text distinguishes online and offline responses", () => {
  assert.equal(core.isLiveStatusText("xqc is live for 2 hours"), true);
  assert.equal(core.isLiveStatusText("5 hours, 44 minutes, 51 seconds"), true);
  assert.equal(core.isLiveStatusText("xqc is offline"), false);
  assert.equal(core.isLiveStatusText(""), false);
});

test("live automation opens only on an offline-to-live transition", () => {
  assert.deepEqual(
    core.newlyLiveChannels(
      { xqc: false, pokimane: true },
      { xqc: true, pokimane: true, newchannel: true }
    ),
    ["xqc"]
  );
});

test("emote autocomplete requires two letters and prioritizes prefix matches", () => {
  const emotes = new Map([
    ["dogCa", { name: "dogCa" }],
    ["catJAM", { name: "catJAM" }],
    ["catDance", { name: "catDance" }]
  ]);
  assert.deepEqual(core.findEmoteSuggestions("c", emotes), []);
  assert.deepEqual(
    core.findEmoteSuggestions("ca", emotes).map((emote) => emote.name),
    ["catDance", "catJAM", "dogCa"]
  );
});
