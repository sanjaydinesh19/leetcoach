# LeetCoach

An AI-powered Chrome extension that coaches you through LeetCode problems — progressively, not by handing you the answer. Solve, get coached, and save everything directly to your Notion revision tracker.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blueviolet)
![Claude API](https://img.shields.io/badge/Powered%20by-Claude%20Sonnet-a78bfa)
![Notion](https://img.shields.io/badge/Notion-Integration-black?logo=notion&logoColor=white)

---

## Features

### 5-Level Progressive Hints
Hints unlock one at a time so you're always challenged before you get help.

| Level | What you get |
|-------|-------------|
| H1 | Pattern recognition — a guiding question about the technique |
| H2 | Data structure suggestion — *why* it fits this problem |
| H3 | Optimization clue — the key insight for efficiency |
| H4 | Pseudocode — numbered plain-English algorithm outline |
| H5 | Full implementation — commented code with a one-click Copy button |

### Algorithm Pattern Recognition
The moment you open a problem, LeetCoach identifies the core pattern:
- Sliding Window, Two Pointers, Binary Search
- Dynamic Programming, Greedy, Backtracking
- BFS/DFS, Monotonic Stack, Union-Find, Heap, Trie

### Live Complexity Analysis
As you type, it predicts:
- Time and space complexity
- TLE risk (`"O(n²) may fail for n=10⁵"`)
- Specific bottlenecks (nested loops, redundant lookups)

### Three-Section Code Analysis
Click **Analyze My Code** for structured, accurate feedback:

| Section | Colour | What it shows |
|---------|--------|---------------|
| What you got right | Green | Correct algorithm choices, good data structures, tricky cases handled |
| Edge cases to consider | Yellow | Inputs that may not be handled (empty array, overflow, duplicates) |
| Critical errors | Red | Real logic bugs — with the exact line and a one-line fix |

### Struggle Detection
The extension tracks your session and adapts:
- 3+ failed runs → prompts an optimization hint
- Multiple rewrites → suggests starting from pseudocode
- 5 min inactivity → offers a data structure suggestion

### Notion Integration
Save solved problems directly to your Notion revision database with one click:
- Auto-populates topic tags from the LeetCode problem page
- Claude generates the optimal solution and study notes automatically
- Creates a fully formatted Notion page with your code, the optimal solution, notes, cover image, and all properties (difficulty, topic, revise flag, date)

---

## Installation

### 1. Get a Claude API Key
Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 2. Load the Extension
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `leetcoach` folder

### 3. Configure Your Keys
Click the **LeetCoach icon** in the Chrome toolbar to open the settings popup.

**Claude API Key** — paste your `sk-ant-...` key and click Save Key.

**Notion Integration** *(optional)* — to enable one-click saving to Notion:
1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → create a new integration → copy the API key (`ntn_...`)
2. Open your Notion database → click the `...` menu → **Connections** → add your integration
3. Paste the API key and your Database ID into the Notion Integration card → Save

### 4. Start Solving
Navigate to any LeetCode problem. The **LC** tab appears on the right edge of the page.

---

## How to Use

### Hints Tab
1. Click **Get Hint 1** — you'll get a guiding question about the pattern, not the answer
2. Attempt the problem based on the hint
3. Still stuck? Click **Get Hint 2** for a data structure suggestion
4. Work through H3 (optimization clue) → H4 (pseudocode) → H5 (full solution) only as needed
5. Jump to any unlocked level using the H1–H5 buttons at the top

> Don't skip straight to H5 — the progressive structure is the coaching.

### Analysis Tab
- **Complexity** updates automatically as you type (Time, Space, TLE risk)
- Click **Analyze My Code** after writing a draft to get:
  - What you got right (green)
  - Edge cases to consider (yellow)
  - Critical logic errors with exact line references (red)

### Notion Tab
Once you've solved a problem and want to save it for revision:

1. Click the **Notion** tab in the sidebar
2. **Topics** are auto-filled from the LeetCode tags — remove or add any
3. Set the **Revise** flag: *Must Revise* (want to revisit) or *Not Needed* (confident)
4. Click **Save to Notion**

LeetCoach will:
- Ask Claude to generate the optimal solution and 5–6 study notes
- Create a Notion page with your code, the optimal solution, notes, cover image, difficulty, topics, link, and today's date — all filled in automatically

The sidebar collapses to a thin **LC** tab when you don't need it.

---

## File Structure

```
leetcoach/
├── manifest.json      # MV3 extension config
├── background.js      # Service worker — Claude API calls + Notion API
├── content.js         # Sidebar UI, editor monitoring, struggle detection
├── sidebar.css        # Dark theme sidebar styles
├── options.html       # Settings popup (Claude key + Notion config)
├── options.js         # Options page logic
├── assets/
│   └── Background.jpg # Cover image used on all Notion pages
└── icons/             # Extension icons
```

### Architecture

```
LeetCode Page
     │
     ▼
content.js (injected)
  ├── Parses problem DOM (title, difficulty, topic tags)
  ├── Builds & renders sidebar (Hints / Analysis / Notion tabs)
  ├── Watches Monaco editor for code changes
  └── Sends messages to ──►  background.js (service worker)
                                  ├── Claude API (hints, analysis, optimal solution)
                                  └── Notion API (create page with full content)
```

API keys are stored in `chrome.storage.sync` — local to your browser only.

---

## Tech Stack

- **Chrome Extension** — Manifest V3, no build step
- **Vanilla JS** — load unpacked directly
- **Claude Sonnet 4.6** — pattern recognition, hints, complexity analysis, error detection, optimal solution generation
- **Notion API** — automated revision tracking

---

## Privacy

- API keys are stored only in Chrome's local storage (`chrome.storage.sync`)
- Problem content and your code are sent to Anthropic's API only when you request a hint, analysis, or Notion save
- No data is collected or stored by this extension

---

## Development

Clone and load unpacked — no build step required.

```bash
git clone https://github.com/sanjaydinesh19/leetcoach
# Then load the folder in chrome://extensions
```

To add a new Claude-powered feature, add a handler in `background.js` and wire it from `content.js` via `send("YOUR_TYPE", payload)`.
