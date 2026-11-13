"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "src", "core.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "src", "background.js"), "utf8");

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

async function createFixture({ existingTabs = [], initialSettings = {}, fetchResponse, idleReplies = {} } = {}) {
  let settings = {
    autoOpenLive: false,
    liveChannels: [],
    liveCheckMinutes: 2,
    ...initialSettings
  };
  const localState = { chattyLiveStates: { alice: false } };
  const createdTabs = [];
  const reloadedTabs = [];
  const updatedTabs = [];
  const navigationStarts = [];
  const reloadStarts = [];
  const requests = [];
  const discardedTabs = [];
  const idleProbes = [];
  const alarms = new Map();
  const focusedWindows = new Set([1]);
  const tabStates = new Map(existingTabs.map((tab) => [tab.id, {
    active: Boolean(tab.active),
    url: tab.url,
    windowId: tab.windowId ?? 1
  }]));
  const listeners = {};

  const chrome = {
    runtime: {
      onMessage: { addListener(listener) { listeners.message = listener; } },
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } }
    },
    storage: {
      sync: {
        async get() { return { chattySettings: settings }; }
      },
      local: {
        async get() { return structuredClone(localState); },
        async set(value) { Object.assign(localState, structuredClone(value)); }
      },
      onChanged: { addListener(listener) { listeners.storageChanged = listener; } }
    },
    alarms: {
      async clear(name) { return alarms.delete(name); },
      async get(name) { return alarms.get(name); },
      async create(name, options) { alarms.set(name, options); },
      onAlarm: { addListener(listener) { listeners.alarm = listener; } }
    },
    tabs: {
      async create(options) {
        createdTabs.push(options);
        const id = createdTabs.length;
        const state = {
          active: Boolean(options.active),
          url: options.url || "chrome://newtab/",
          windowId: 1
        };
        tabStates.set(id, state);
        if (options.url?.startsWith("https://www.twitch.tv/")) {
          navigationStarts.push({
            active: state.active,
            focused: focusedWindows.has(state.windowId),
            tabId: id
          });
        }
        return { id, status: "loading", ...state };
      },
      async get(tabId) {
        const existing = existingTabs.find((tab) => tab.id === tabId);
        if (existing) return { ...existing };
        return { id: tabId, status: "complete", url: "https://www.twitch.tv/alice" };
      },
      async query() { return structuredClone(existingTabs); },
      async sendMessage(id, message) {
        assert.equal(message.type, "CANTY_CHECK_IDLE_TAB");
        idleProbes.push(id);
        if (!Object.hasOwn(idleReplies, id)) throw new Error("No content script");
        return idleReplies[id];
      },
      async discard(id) { discardedTabs.push(id); },
      async reload(tabId) {
        reloadedTabs.push(tabId);
        const state = tabStates.get(tabId);
        reloadStarts.push({
          active: Boolean(state?.active),
          focused: focusedWindows.has(state?.windowId),
          tabId
        });
      },
      async update(tabId, options) {
        updatedTabs.push({ tabId, options });
        const previous = tabStates.get(tabId) || { active: false, windowId: 1 };
        const state = { ...previous, ...options };
        tabStates.set(tabId, state);
        if (options.url?.startsWith("https://www.twitch.tv/")) {
          navigationStarts.push({
            active: Boolean(previous.active),
            focused: focusedWindows.has(previous.windowId),
            tabId
          });
        }
        return { id: tabId, ...state };
      }
    },
    windows: {
      async update(windowId, options) {
        if (options.focused) {
          focusedWindows.clear();
          focusedWindows.add(windowId);
        }
        return { id: windowId, ...options };
      }
    }
  };

  const context = vm.createContext({
    URL,
    chrome,
    console,
    clearTimeout,
    fetch: async (url) => {
      requests.push(url);
      return fetchResponse ? fetchResponse(url) : {
        ok: true,
        async text() { return "alice is live"; }
      };
    },
    setTimeout,
    structuredClone
  });
  context.importScripts = (filename) => {
    assert.equal(filename, "core.js");
    vm.runInContext(coreSource, context, { filename: "core.js" });
  };

  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  await tick();

  return {
    createdTabs,
    navigationStarts,
    reloadStarts,
    reloadedTabs,
    updatedTabs,
    listeners,
    requests,
    alarms,
    discardedTabs,
    idleProbes,
    requestEmotes(channel) {
      return new Promise((resolve) => listeners.message({ type: "CHATTY_FETCH_7TV", channel }, {}, resolve));
    },
    enableAutoOpen() {
      settings = {
        autoOpenLive: true,
        liveChannels: ["alice"],
        liveCheckMinutes: 2
      };
    }
  };
}

test("concurrent tabs share 7TV requests and receive only compact emote metadata", async () => {
  const emote = (id) => ({
    id,
    name: "cheer",
    data: { owner: { display_name: "Artist", unused: "x".repeat(10000) },
      host: { url: "//cdn.7tv.app/emote/" + id, files: [{ name: "2x.webp" }] } }
  });
  const fixture = await createFixture({
    fetchResponse: async (url) => ({
      ok: true,
      text: async () => "123",
      json: async () => url.endsWith("/global")
        ? { emotes: [emote("global")] }
        : { emote_set: { emotes: [emote("channel")] } }
    })
  });
  const results = await Promise.all([fixture.requestEmotes("alice"), fixture.requestEmotes("alice")]);
  results.push(await fixture.requestEmotes("alice"));
  assert.equal(fixture.requests.length, 3, "one global, one channel ID, and one channel emote request");
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.ok(JSON.stringify(result.data).length < 1000);
    assert.equal(result.data.emotes.length, 1);
    assert.equal(result.data.emotes.at(-1).url, "https://cdn.7tv.app/emote/channel/2x.webp");
    assert.equal(result.data.emotes.at(-1).owner, "Artist");
  }
});

test("idle tab unloading is opt-in and requires a safe response from the Twitch page", async () => {
  const idle = {
    url: "https://www.twitch.tv/alice",
    lastAccessed: Date.now() - 40 * 60 * 1000,
    status: "complete",
    autoDiscardable: true,
    active: false
  };
  const existingTabs = [
    { ...idle, id: 1 },
    { ...idle, id: 2, active: true },
    { ...idle, id: 3, pinned: true },
    { ...idle, id: 4, audible: true },
    { ...idle, id: 5, lastAccessed: Date.now() },
    { ...idle, id: 6, url: "https://example.com/alice" },
    { ...idle, id: 7 },
    { ...idle, id: 8 },
    { ...idle, id: 9, discarded: true },
    { ...idle, id: 10, autoDiscardable: false },
    { ...idle, id: 11, url: "https://www.twitch.tv/videos/123" },
    { ...idle, id: 12, splitViewId: 0 },
    { ...idle, id: 13, pendingUrl: "https://www.twitch.tv/bob" }
  ];
  const off = await createFixture({ existingTabs });
  assert.equal(off.alarms.has("canty-idle-twitch-tabs"), false);
  off.listeners.alarm({ name: "canty-idle-twitch-tabs" });
  await tick();
  assert.deepEqual(off.idleProbes, []);

  const on = await createFixture({
    existingTabs,
    initialSettings: { idleTwitchMinutes: 30 },
    idleReplies: { 1: { canUnload: true }, 7: { canUnload: false } }
  });
  assert.ok(on.alarms.has("canty-idle-twitch-tabs"));
  on.listeners.alarm({ name: "canty-idle-twitch-tabs" });
  await tick();
  assert.deepEqual(on.idleProbes, [1, 7, 8]);
  assert.deepEqual(on.discardedTabs, [1]);
});

test("overlapping live checks open a newly-live channel only once", async () => {
  const fixture = await createFixture();
  fixture.enableAutoOpen();

  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  await tick();

  assert.equal(fixture.createdTabs.length, 1);
});

test("a newly-live channel starts Twitch navigation only after its tab is foregrounded", async () => {
  const fixture = await createFixture();
  fixture.enableAutoOpen();

  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  await tick();

  assert.deepEqual(fixture.navigationStarts, [{
    active: true,
    focused: true,
    tabId: 1
  }]);
});

test("a live channel already open in Twitch is refreshed and focused", async () => {
  const fixture = await createFixture({
    existingTabs: [{
      active: false,
      id: 44,
      url: "https://www.twitch.tv/alice",
      windowId: 2
    }]
  });
  fixture.enableAutoOpen();

  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  await tick();

  assert.equal(fixture.createdTabs.length, 0);
  assert.deepEqual(fixture.reloadedTabs, [44]);
  assert.deepEqual(fixture.reloadStarts, [{
    active: true,
    focused: true,
    tabId: 44
  }]);
  assert.equal(fixture.updatedTabs.length, 1);
  assert.equal(fixture.updatedTabs[0].tabId, 44);
  assert.equal(fixture.updatedTabs[0].options.active, true);
});
