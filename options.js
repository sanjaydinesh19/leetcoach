const keyInput = document.getElementById("api-key");
const saveBtn = document.getElementById("save-btn");
const toggleBtn = document.getElementById("toggle-show");
const statusMsg = document.getElementById("status-msg");

const notionKeyInput = document.getElementById("notion-key");
const notionDbInput = document.getElementById("notion-db");
const saveNotionBtn = document.getElementById("save-notion-btn");
const toggleNotionBtn = document.getElementById("toggle-notion-key");
const notionStatusMsg = document.getElementById("notion-status-msg");

// Load saved keys on open
chrome.storage.sync.get(["apiKey", "notionKey", "notionDbId"], ({ apiKey, notionKey, notionDbId }) => {
  if (apiKey) keyInput.value = apiKey;
  if (notionKey) notionKeyInput.value = notionKey;
  if (notionDbId) notionDbInput.value = notionDbId;
});

toggleBtn.addEventListener("click", () => {
  const isHidden = keyInput.type === "password";
  keyInput.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "Hide" : "Show";
});

toggleNotionBtn.addEventListener("click", () => {
  const isHidden = notionKeyInput.type === "password";
  notionKeyInput.type = isHidden ? "text" : "password";
  toggleNotionBtn.textContent = isHidden ? "Hide" : "Show";
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    showStatus(statusMsg, "Please enter an API key.", "error");
    return;
  }
  if (!key.startsWith("sk-")) {
    showStatus(statusMsg, "That doesn't look like a valid API key.", "error");
    return;
  }

  saveBtn.textContent = "Saving…";
  saveBtn.disabled = true;

  chrome.storage.sync.set({ apiKey: key }, () => {
    showStatus(statusMsg, "✓ API key saved! Open a LeetCode problem to start.", "success");
    saveBtn.textContent = "Save Key";
    saveBtn.disabled = false;
  });
});

saveNotionBtn.addEventListener("click", () => {
  const notionKey = notionKeyInput.value.trim();
  const notionDbId = notionDbInput.value.trim();

  if (!notionKey || !notionDbId) {
    showStatus(notionStatusMsg, "Both Notion API key and Database ID are required.", "error");
    return;
  }
  if (!notionKey.startsWith("ntn_") && !notionKey.startsWith("secret_")) {
    showStatus(notionStatusMsg, "That doesn't look like a valid Notion key.", "error");
    return;
  }

  saveNotionBtn.textContent = "Saving…";
  saveNotionBtn.disabled = true;

  chrome.storage.sync.set({ notionKey, notionDbId }, () => {
    showStatus(notionStatusMsg, "✓ Notion integration saved!", "success");
    saveNotionBtn.textContent = "Save";
    saveNotionBtn.disabled = false;
  });
});

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = type;
}
