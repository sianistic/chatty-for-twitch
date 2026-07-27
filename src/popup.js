(async function initPopup() {
  const checkbox = document.querySelector("#enabled");
  const stored = await chrome.storage.sync.get("chattySettings");
  const settings = ChattyCore.sanitizeSettings(stored.chattySettings);
  checkbox.checked = settings.enabled;
  checkbox.addEventListener("change", async () => {
    await chrome.storage.sync.set({
      chattySettings: { ...settings, enabled: checkbox.checked }
    });
  });
})();
