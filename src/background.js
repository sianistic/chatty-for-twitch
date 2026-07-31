"use strict";

importScripts("core.js");

const CACHE_TTL = 5 * 60 * 1000;
const LIVE_ALARM = "chatty-live-channel-check";
const LIVE_STATE_KEY = "chattyLiveStates";
const TAB_READY_TIMEOUT = 12000;
const TAB_READY_POLL = 250;
const cache = new Map();
let liveCheckPromise = null;

async function cachedJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_TTL) return hit.value;
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const value = await response.json();
  cache.set(url, { time: Date.now(), value });
  return value;
}

async function fetchText(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.text();
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== "CHATTY_FETCH_7TV") return undefined;

  (async () => {
    const channel = String(message.channel || "").toLowerCase();
    const global = await cachedJson("https://7tv.io/v3/emote-sets/global");
    let channelSet = null;
    let channelId = null;

    if (channel && /^[a-z0-9_]+$/.test(channel)) {
      try {
        const rawId = await fetchText(`https://decapi.me/twitch/id/${encodeURIComponent(channel)}`);
        if (/^\d+$/.test(rawId.trim())) {
          channelId = rawId.trim();
          channelSet = await cachedJson(`https://7tv.io/v3/users/twitch/${channelId}`);
        }
      } catch (error) {
        console.info("[Chatty] Channel 7TV set unavailable:", error.message);
      }
    }

    return { global, channelSet, channelId };
  })()
    .then((data) => respond({ ok: true, data }))
    .catch((error) => respond({ ok: false, error: error.message }));

  return true;
});

async function readSettings() {
  const stored = await chrome.storage.sync.get("chattySettings");
  return ChattyCore.sanitizeSettings(stored.chattySettings);
}

async function channelIsLive(channel) {
  try {
    const response = await fetch(
      `https://decapi.me/twitch/uptime/${encodeURIComponent(channel)}`,
      { cache: "no-store", credentials: "omit" }
    );
    if (!response.ok) return false;
    return ChattyCore.isLiveStatusText(await response.text());
  } catch (error) {
    console.info(`[Chatty] Live check failed for ${channel}:`, error.message);
    return null;
  }
}

async function findChannelTab(channel) {
  try {
    const tabs = await chrome.tabs.query({ url: ["https://www.twitch.tv/*"] });
    return tabs.find((tab) => {
      try {
        const pathParts = new URL(tab.url).pathname.split("/").filter(Boolean);
        return pathParts.length === 1
          && decodeURIComponent(pathParts[0]).toLowerCase() === channel;
      } catch (_error) {
        return false;
      }
    });
  } catch (error) {
    console.info(`[Chatty] Could not inspect existing tabs for ${channel}:`, error.message);
    return null;
  }
}

async function waitForTabDocument(tabId) {
  const deadline = Date.now() + TAB_READY_TIMEOUT;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch (_error) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_READY_POLL));
  }
}

async function openLiveChannel(channel) {
  const existing = await findChannelTab(channel);
  if (existing?.id != null) {
    await chrome.tabs.reload(existing.id);
    await chrome.tabs.update(existing.id, { active: true });
    return;
  }

  const created = await chrome.tabs.create({
    url: `https://www.twitch.tv/${encodeURIComponent(channel)}`,
    active: false
  });
  if (created?.id == null) return;
  await waitForTabDocument(created.id);
  await chrome.tabs.update(created.id, { active: true });
}

async function checkLiveChannels() {
  const settings = await readSettings();
  if (!settings.autoOpenLive || settings.liveChannels.length === 0) return;

  const stored = await chrome.storage.local.get(LIVE_STATE_KEY);
  const previous = stored[LIVE_STATE_KEY] || {};
  const next = {};

  await Promise.all(settings.liveChannels.map(async (channel) => {
    const live = await channelIsLive(channel);
    if (live === null) {
      if (Object.hasOwn(previous, channel)) next[channel] = previous[channel];
      return;
    }
    next[channel] = live;
  }));

  await chrome.storage.local.set({ [LIVE_STATE_KEY]: next });
  for (const channel of ChattyCore.newlyLiveChannels(previous, next)) {
    await openLiveChannel(channel);
  }
}

function scheduleLiveCheck() {
  if (liveCheckPromise) return liveCheckPromise;
  liveCheckPromise = checkLiveChannels()
    .catch((error) => {
      console.info("[Chatty] Live channel check failed:", error.message);
    })
    .finally(() => {
      liveCheckPromise = null;
    });
  return liveCheckPromise;
}

async function configureLiveAlarm() {
  const settings = await readSettings();
  await chrome.alarms.clear(LIVE_ALARM);
  if (!settings.autoOpenLive || settings.liveChannels.length === 0) return;
  chrome.alarms.create(LIVE_ALARM, {
    periodInMinutes: settings.liveCheckMinutes
  });
  return scheduleLiveCheck();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIVE_ALARM) scheduleLiveCheck();
});

chrome.runtime.onInstalled.addListener(configureLiveAlarm);
chrome.runtime.onStartup.addListener(configureLiveAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.chattySettings) configureLiveAlarm();
});

configureLiveAlarm();
