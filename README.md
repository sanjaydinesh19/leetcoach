# 🧠 LeetCoach

An AI-powered Chrome extension that coaches you through LeetCode problems — progressively, not by handing you the answer.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blueviolet)
![Claude API](https://img.shields.io/badge/Powered%20by-Claude%20Sonnet-a78bfa)

---

## Why LeetCoach?

Most AI tools for LeetCode either give you the full solution immediately (useless for learning) or just syntax-check your code. LeetCoach is different — it acts as a Socratic mentor, guiding you to the answer through progressive hints, pattern recognition, and real-time analysis.

---

## Features

### 💡 5-Level Progressive Hints
Hints unlock one at a time so you're always challenged before you get help.

| Level | What you get |
|-------|-------------|
| H1 | Pattern recognition — a guiding question about the technique |
| H2 | Data structure suggestion — *why* it fits this problem |
| H3 | Optimization clue — the key insight for efficiency |
| H4 | Pseudocode — algorithm outline without real syntax |
| H5 | Full implementation — commented code |

### ⚡ Algorithm Pattern Recognition
The moment you open a problem, LeetCoach identifies the core pattern:
- Sliding Window, Two Pointers, Binary Search
- Dynamic Programming, Greedy, Backtracking
- BFS/DFS, Monotonic Stack, Union-Find, Heap, Trie

### 📊 Live Complexity Analysis
As you type, it predicts:
- Time and space complexity
- TLE risk (`"Your O(n²) solution may fail for n=10⁵"`)
- Specific bottlenecks (nested loops, redundant lookups)

### 🐛 Semantic Error Detection
Not syntax errors — actual reasoning mistakes:
- Wrong algorithm choice for the constraints
- Hashmap key collisions
- Off-by-one errors in pointer logic
- Edge cases your code doesn't handle

### 🎬 Algorithm Visualizer
Animated step-by-step Canvas visualizations generated for your specific problem:
- Array / Sliding Window
- DP Table cell-by-cell filling
- Stack push/pop operations
- Two-pointer movement

### 🧠 Struggle Detection
The extension tracks your session and adapts:
- 3+ failed runs → *"Stuck on edge cases? Try H3 for an optimization clue."*
- Multiple rewrites → *"Starting with pseudocode (H4) might help clarify the approach."*
- 5 min inactivity → *"Been quiet for a while. Want a data structure suggestion?"*

---

## Installation

### 1. Get a Claude API Key
Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key. Free tier works.

### 2. Load the Extension
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `leetcoach` folder

### 3. Add Your API Key
Click the 🧠 icon in the Chrome toolbar → paste your `sk-ant-...` key → Save.

### 4. Start Solving
Navigate to any LeetCode problem (e.g. `leetcode.com/problems/two-sum/`). The **🧠 LC** tab appears on the right edge of the page.

---

## How to Use

| Panel | What to do |
|-------|-----------|
| **Hints** | Click "Get Hint 1 →" and work progressively. Don't skip levels. |
| **Analysis** | Click "Analyze My Code" after writing a solution draft. Complexity updates live as you type. |
| **Visualize** | Click "Generate Visualization" to see the algorithm animated for your problem. |

The sidebar collapses to a thin tab when you don't need it.

---

## File Structure

```
leetcoach/
├── manifest.json      # MV3 extension config
├── background.js      # Service worker — all Claude API calls
├── content.js         # Sidebar UI, editor monitoring, struggle detection
├── sidebar.css        # Dark theme sidebar styles
├── options.html       # Settings page (API key input)
├── options.js         # Options page logic
└── icons/             # Extension icons
```

### Architecture

```
LeetCode Page
     │
     ▼
content.js (injected)
  ├── Parses problem DOM
  ├── Builds & renders sidebar
  ├── Watches Monaco editor for code changes
  └── Sends messages to ──►  background.js (service worker)
                                  │
                                  ▼
                           Claude API (Anthropic)
                           claude-sonnet-4-6
```

All Claude API calls go through the background service worker to avoid CORS issues. The API key is stored in `chrome.storage.sync` — local to your browser, never sent anywhere except Anthropic's API.

---

## Tech Stack

- **Chrome Extension** — Manifest V3
- **Vanilla JS** — No build step, load directly
- **Canvas API** — Algorithm visualizations
- **Claude Sonnet 4.6** — Pattern recognition, hints, complexity analysis, error detection

---

## Privacy

- Your API key is stored only in Chrome's local storage (`chrome.storage.sync`)
- Problem content and your code are sent to Anthropic's API only when you request a hint or analysis
- No data is collected or stored by this extension

---

## Development

Clone and load unpacked — no build step required.

```bash
git clone https://github.com/sanjaydinesh19/leetcoach
# Then load the folder in chrome://extensions
```

To add a new Claude-powered feature, add a handler in `background.js` and call it from `content.js` via `send("YOUR_TYPE", payload)`.
