"use strict";

importScripts("core.js");

const CACHE_TTL = 5 * 60 * 1000;
const LIVE_ALARM = "chatty-live-channel-check";
const LIVE_STATE_KEY = "chattyLiveStates";
const cache = new Map();

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
    await chrome.tabs.create({
      url: `https://www.twitch.tv/${encodeURIComponent(channel)}`,
      active: true
    });
  }
}

async function configureLiveAlarm() {
  const settings = await readSettings();
  await chrome.alarms.clear(LIVE_ALARM);
  if (!settings.autoOpenLive || settings.liveChannels.length === 0) return;
  chrome.alarms.create(LIVE_ALARM, {
    periodInMinutes: settings.liveCheckMinutes
  });
  checkLiveChannels();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIVE_ALARM) checkLiveChannels();
});

chrome.runtime.onInstalled.addListener(configureLiveAlarm);
chrome.runtime.onStartup.addListener(configureLiveAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.chattySettings) configureLiveAlarm();
});

configureLiveAlarm();
