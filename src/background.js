"use strict";

importScripts("core.js");

const CACHE_TTL = 5 * 60 * 1000;
const MAX_EMOTE_CHANNELS = 16;
const IDLE_PROBE_TIMEOUT = 1500;
const TWITCH_TABS = "https://www.twitch.tv/*";
const LIVE_ALARM = "chatty-live-channel-check";
const LIVE_STATE_KEY = "chattyLiveStates";
const IDLE_ALARM = "canty-idle-twitch-tabs";
const globalEmotes = new Map();
const channelEmotes = new Map();
let liveCheckPromise = null;
let idleCheckPromise = null;

function cachedEmotes(cache, key, limit, load) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.promise;
  }
  for (const [oldKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(oldKey);
  }
  const entry = { expiresAt: now + CACHE_TTL, promise: load().catch((error) => {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }) };
  cache.set(key, entry);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  return entry.promise;
}

async function fetchEmoteSet(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return [...ChattyCore.indexEmotes([await response.json()]).values()];
}

async function fetchText(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.text();
}

async function fetchChannelEmotes(channel) {
  const id = (await fetchText(`https://decapi.me/twitch/id/${encodeURIComponent(channel)}`)).trim();
  return /^\d+$/.test(id) ? fetchEmoteSet(`https://7tv.io/v3/users/twitch/${id}`) : [];
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== "CHATTY_FETCH_7TV") return undefined;

  (async () => {
    const channel = ChattyCore.normalizeChannels([message.channel || ""])[0];
    const [global, local] = await Promise.all([
      cachedEmotes(globalEmotes, "global", 1, () => fetchEmoteSet("https://7tv.io/v3/emote-sets/global")),
      channel ? cachedEmotes(channelEmotes, channel, MAX_EMOTE_CHANNELS, () => fetchChannelEmotes(channel))
        .catch((error) => {
          console.info("[Canty] Channel 7TV set unavailable:", error.message);
          return [];
        }) : []
    ]);
    const emotes = new Map();
    for (const emote of global) emotes.set(emote.name, emote);
    for (const emote of local) emotes.set(emote.name, emote);
    return { emotes: [...emotes.values()] };
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
    console.info(`[Canty] Live check failed for ${channel}:`, error.message);
    return null;
  }
}

async function findChannelTab(channel) {
  try {
    const tabs = await chrome.tabs.query({ url: [TWITCH_TABS] });
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
    console.info(`[Canty] Could not inspect existing tabs for ${channel}:`, error.message);
    return null;
  }
}

async function foregroundTab(tabId, windowId) {
  if (windowId != null) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
      console.info(`[Canty] Could not focus Twitch window ${windowId}:`, error.message);
    }
  }
  return chrome.tabs.update(tabId, { active: true });
}

async function openLiveChannel(channel) {
  const existing = await findChannelTab(channel);
  if (existing?.id != null) {
    await foregroundTab(existing.id, existing.windowId);
    await chrome.tabs.reload(existing.id);
    return;
  }

  // Twitch defers parts of its player while a page is hidden. Create and focus
  // the tab first so the Twitch navigation starts with a visible document.
  const created = await chrome.tabs.create({ active: true });
  if (created?.id == null) return;
  await foregroundTab(created.id, created.windowId);
  await chrome.tabs.update(created.id, {
    url: `https://www.twitch.tv/${encodeURIComponent(channel)}`
  });
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
      console.info("[Canty] Live channel check failed:", error.message);
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

function canUnloadTab(tab, cutoff) {
  if (tab?.id == null || tab.active || tab.pinned || tab.audible || tab.discarded ||
    tab.incognito || tab.autoDiscardable !== true || tab.pendingUrl || tab.status !== "complete" ||
    (Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0) ||
    !Number.isFinite(tab.lastAccessed) || tab.lastAccessed > cutoff) return false;
  try {
    const url = new URL(tab.url);
    return url.origin === "https://www.twitch.tv" && /^\/[a-z0-9_]{1,25}\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function probeIdlePage(id) {
  let timer;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(id, { type: "CANTY_CHECK_IDLE_TAB" }, { frameId: 0 }),
      new Promise((resolve) => { timer = setTimeout(resolve, IDLE_PROBE_TIMEOUT); })
    ]);
    return response?.canUnload === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function unloadIdleTwitchTabs() {
  const settings = await readSettings();
  if (!settings.enabled || !settings.idleTwitchMinutes) return;
  const cutoff = Date.now() - settings.idleTwitchMinutes * 60000;
  const tabs = await chrome.tabs.query({ url: [TWITCH_TABS], active: false, audible: false, discarded: false });
  for (const tab of tabs) {
    if (!canUnloadTab(tab, cutoff)) continue;
    if (!await probeIdlePage(tab.id)) continue;
    try {
      const current = await chrome.tabs.get(tab.id);
      if (!canUnloadTab(current, cutoff) || current.url !== tab.url) continue;
      const latest = await readSettings();
      if (!latest.enabled || latest.idleTwitchMinutes !== settings.idleTwitchMinutes) return;
      await chrome.tabs.discard(tab.id);
    } catch {
      // The tab may have closed or become active since it was checked.
    }
  }
}

async function configureIdleAlarm() {
  const settings = await readSettings();
  if (!settings.enabled || !settings.idleTwitchMinutes) {
    await chrome.alarms.clear(IDLE_ALARM);
  } else if (!await chrome.alarms.get(IDLE_ALARM)) {
    await chrome.alarms.create(IDLE_ALARM, { periodInMinutes: 5 });
  }
}

function configureIdleTabs() {
  return configureIdleAlarm().catch((error) => {
    console.info("[Canty] Could not schedule idle tab checks:", error.message);
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIVE_ALARM) scheduleLiveCheck();
  if (alarm.name === IDLE_ALARM && !idleCheckPromise) {
    idleCheckPromise = unloadIdleTwitchTabs().catch((error) => {
      console.info("[Canty] Idle Twitch tab check failed:", error.message);
    }).finally(() => { idleCheckPromise = null; });
  }
});

chrome.runtime.onInstalled.addListener(configureLiveAlarm);
chrome.runtime.onStartup.addListener(configureLiveAlarm);
chrome.runtime.onInstalled.addListener(configureIdleTabs);
chrome.runtime.onStartup.addListener(configureIdleTabs);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.chattySettings) return;
  configureLiveAlarm();
  configureIdleTabs();
});

configureLiveAlarm();
configureIdleTabs();
