(function exposeCore(root) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    timestamps: true,
    compact: true,
    fontSize: 13,
    highlightUsers: [],
    highlightWords: [],
    highlightColor: "#7c5cff",
    mentionColor: "#f0a83a",
    maxMessages: 2000,
    textOnlyEmotes: false,
    idleTwitchMinutes: 0,
    autoClaimPoints: false,
    autoOpenLive: false,
    liveChannels: [],
    liveCheckMinutes: 2
  });

  function normalizeList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    return String(value || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function sanitizeSettings(value) {
    const input = value && typeof value === "object" ? value : {};
    const integer = (candidate, fallback, min, max) => {
      const number = Number(candidate);
      return Number.isFinite(number)
        ? Math.min(max, Math.max(min, Math.round(number)))
        : fallback;
    };
    const color = (candidate, fallback) =>
      /^#[0-9a-f]{6}$/i.test(String(candidate || "")) ? candidate : fallback;

    return {
      enabled: input.enabled !== false,
      timestamps: input.timestamps !== false,
      compact: input.compact !== false,
      fontSize: integer(input.fontSize, DEFAULT_SETTINGS.fontSize, 10, 22),
      highlightUsers: normalizeList(input.highlightUsers),
      highlightWords: normalizeList(input.highlightWords),
      highlightColor: color(input.highlightColor, DEFAULT_SETTINGS.highlightColor),
      mentionColor: color(input.mentionColor, DEFAULT_SETTINGS.mentionColor),
      maxMessages: integer(input.maxMessages, DEFAULT_SETTINGS.maxMessages, 500, 5000),
      textOnlyEmotes: input.textOnlyEmotes === true,
      idleTwitchMinutes: [15, 30, 60].includes(Number(input.idleTwitchMinutes))
        ? Number(input.idleTwitchMinutes)
        : 0,
      autoClaimPoints: input.autoClaimPoints === true,
      autoOpenLive: input.autoOpenLive === true,
      liveChannels: normalizeChannels(input.liveChannels),
      liveCheckMinutes: integer(
        input.liveCheckMinutes,
        DEFAULT_SETTINGS.liveCheckMinutes,
        1,
        30
      )
    };
  }

  function normalizeChannels(value) {
    return Array.from(new Set(normalizeList(value)
      .map((item) => item
        .replace(/^https?:\/\/(?:www\.)?twitch\.tv\//i, "")
        .replace(/^@/, "")
        .split(/[/?#]/)[0]
        .toLowerCase())
      .filter((item) => /^[a-z0-9_]{1,25}$/.test(item))));
  }

  function isLiveStatusText(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text || /offline|not live|does not exist|error/.test(text)) return false;
    return (
      /\blive\b|\buptime\b|\bstreaming\b/.test(text) ||
      /\b\d+\s+(?:seconds?|minutes?|hours?|days?)\b/.test(text)
    );
  }

  function newlyLiveChannels(previous, current) {
    const before = previous && typeof previous === "object" ? previous : {};
    const now = current && typeof current === "object" ? current : {};
    return Object.keys(now).filter(
      (channel) =>
        now[channel] === true &&
        Object.prototype.hasOwnProperty.call(before, channel) &&
        before[channel] === false
    );
  }

  function escapeTag(value) {
    return String(value || "")
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\\\/g, "\\")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n");
  }

  function createHighlightMatcher(settings, viewerName) {
    const clean = sanitizeSettings(settings);
    const users = new Set(clean.highlightUsers.map((item) => item.replace(/^@/, "").toLowerCase()));
    const words = clean.highlightWords.map((item) => item.toLowerCase());
    const viewer = String(viewerName || "").replace(/^@/, "").toLowerCase();
    const mention = viewer ? new RegExp(`(^|\\W)@?${escapeRegExp(viewer)}(\\W|$)`, "i") : null;

    return (message) => {
      const text = String(message.text || "");
      if (mention?.test(text)) return { type: "mention", color: clean.mentionColor };
      if (users.has(String(message.username || "").toLowerCase())) {
        return { type: "custom", color: clean.highlightColor };
      }
      const lowered = words.length ? text.toLowerCase() : "";
      return words.some((word) => lowered.includes(word))
        ? { type: "custom", color: clean.highlightColor }
        : null;
    };
  }

  function getHighlight(message, settings, viewerName) {
    return createHighlightMatcher(settings, viewerName)(message);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function indexEmotes(payloads) {
    const result = new Map();
    for (const payload of payloads || []) {
      const entries = payload?.emotes || payload?.emote_set?.emotes || [];
      for (const entry of entries) {
        const name = entry.name;
        const host = entry.data?.host || entry.host;
        if (!name || !host?.url) continue;
        const files = Array.isArray(host.files) ? host.files : [];
        const preferred =
          files.find((file) => file.name === "2x.webp") ||
          files.find((file) => file.name === "1x.webp") ||
          files.find((file) => file.format === "WEBP") ||
          files[0];
        const scheme = String(host.url).startsWith("//") ? "https:" : "";
        const url = preferred
          ? `${scheme}${host.url}/${preferred.name}`
          : `${scheme}${host.url}/2x.webp`;
        result.set(name, {
          id: entry.id || entry.data?.id || "",
          name,
          url,
          width: Number(preferred?.width) || 32,
          height: Number(preferred?.height) || 32,
          provider: "7TV",
          owner:
            entry.data?.owner?.display_name ||
            entry.data?.owner?.username ||
            "",
          animated: Boolean(
            entry.data?.animated ||
            Number(preferred?.frame_count) > 1
          )
        });
      }
    }
    return result;
  }

  function tokenizeEmotes(text, emotes) {
    const value = String(text || "");
    if (!(emotes instanceof Map) || emotes.size === 0) {
      return [{ type: "text", value }];
    }
    const tokens = [];
    let start = 0;
    for (const match of value.matchAll(/\S+/g)) {
      const name = match[0];
      const emote = emotes.get(name);
      if (!emote) continue;
      if (match.index > start) tokens.push({ type: "text", value: value.slice(start, match.index) });
      tokens.push({ type: "emote", value: name, emote });
      start = match.index + name.length;
    }
    if (start < value.length || !tokens.length) tokens.push({ type: "text", value: value.slice(start) });
    return tokens;
  }

  function findEmoteSuggestions(query, emotes, limit = 8) {
    const needle = String(query || "").trim().toLowerCase();
    if (needle.length < 2 || !(emotes instanceof Map)) return [];
    return Array.from(emotes.entries())
      .map(([key, emote]) => ({
        ...emote,
        name: emote.name || key,
        matchName: String(emote.name || key).toLowerCase()
      }))
      .filter((emote) => emote.matchName.includes(needle))
      .sort((left, right) => {
        const leftPrefix = left.matchName.startsWith(needle);
        const rightPrefix = right.matchName.startsWith(needle);
        if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, Math.max(1, Number(limit) || 8))
      .map(({ matchName, ...emote }) => emote);
  }

  const api = {
    DEFAULT_SETTINGS,
    normalizeList,
    normalizeChannels,
    sanitizeSettings,
    escapeTag,
    createHighlightMatcher,
    getHighlight,
    indexEmotes,
    tokenizeEmotes,
    findEmoteSuggestions,
    isLiveStatusText,
    newlyLiveChannels
  };

  root.ChattyCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
