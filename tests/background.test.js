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

async function createFixture({ existingTabs = [] } = {}) {
  let settings = {
    autoOpenLive: false,
    liveChannels: [],
    liveCheckMinutes: 2
  };
  const localState = { chattyLiveStates: { alice: false } };
  const createdTabs = [];
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
      async clear() { return true; },
      create() {},
      onAlarm: { addListener(listener) { listeners.alarm = listener; } }
    },
    tabs: {
      async create(options) {
        createdTabs.push(options);
        return { id: createdTabs.length, ...options };
      },
      async query() { return structuredClone(existingTabs); }
    }
  };

  const context = vm.createContext({
    URL,
    chrome,
    console,
    clearTimeout,
    fetch: async () => ({
      ok: true,
      async text() { return "alice is live"; }
    }),
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
    listeners,
    enableAutoOpen() {
      settings = {
        autoOpenLive: true,
        liveChannels: ["alice"],
        liveCheckMinutes: 2
      };
    }
  };
}

test("overlapping live checks open a newly-live channel only once", async () => {
  const fixture = await createFixture();
  fixture.enableAutoOpen();

  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  await tick();

  assert.equal(fixture.createdTabs.length, 1);
});

test("a live channel already open in Twitch does not get duplicated", async () => {
  const fixture = await createFixture({
    existingTabs: [{ id: 44, url: "https://www.twitch.tv/alice" }]
  });
  fixture.enableAutoOpen();

  fixture.listeners.alarm({ name: "chatty-live-channel-check" });
  await tick();

  assert.equal(fixture.createdTabs.length, 0);
});
