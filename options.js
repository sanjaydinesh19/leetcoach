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

saveBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  if (!key) {
    showStatus("Please enter an API key.", "error");
    return;
  }
  if (!key.startsWith("sk-ant-")) {
    showStatus("That doesn't look like a Claude API key (should start with sk-ant-).", "error");
    return;
  }

  saveBtn.textContent = "Verifying…";
  saveBtn.disabled = true;

  // Quick validation call
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (res.status === 401) {
      showStatus("Invalid API key — check and try again.", "error");
    } else {
      chrome.storage.sync.set({ apiKey: key }, () => {
        showStatus("✓ API key saved! Open a LeetCode problem to start.", "success");
      });
    }
  } catch {
    // Network error — save anyway (may be working fine in extension context)
    chrome.storage.sync.set({ apiKey: key }, () => {
      showStatus("✓ Key saved (could not verify — check your connection).", "success");
    });
  }

  saveBtn.textContent = "Save Key";
  saveBtn.disabled = false;
});

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = type;
}
