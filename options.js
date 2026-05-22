const keyInput = document.getElementById("api-key");
const saveBtn = document.getElementById("save-btn");
const toggleBtn = document.getElementById("toggle-show");
const statusMsg = document.getElementById("status-msg");

// Load saved key on open
chrome.storage.sync.get("apiKey", ({ apiKey }) => {
  if (apiKey) keyInput.value = apiKey;
});

toggleBtn.addEventListener("click", () => {
  const isHidden = keyInput.type === "password";
  keyInput.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "Hide" : "Show";
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    showStatus("Please enter an API key.", "error");
    return;
  }
  if (!key.startsWith("sk-")) {
    showStatus("That doesn't look like a valid API key.", "error");
    return;
  }

  saveBtn.textContent = "Saving…";
  saveBtn.disabled = true;

  chrome.storage.sync.set({ apiKey: key }, () => {
    showStatus("✓ API key saved! Open a LeetCode problem to start.", "success");
    saveBtn.textContent = "Save Key";
    saveBtn.disabled = false;
  });
});

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = type;
}
