// Service worker — handles all Claude API calls to avoid CORS from content scripts

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

async function callClaude(apiKey, systemPrompt, userMessage, maxTokens = 1024) {
  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

function parseJSON(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1] : text;
  return JSON.parse(raw.trim());
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleAnalyzeProblem(apiKey, { title, content, difficulty }) {
  const system = `You are an expert competitive programming coach. Analyze LeetCode problems and identify the core algorithmic pattern. Respond ONLY with valid JSON, no markdown outside the JSON block.`;

  const user = `Analyze this LeetCode problem and identify the algorithm pattern.

Title: ${title}
Difficulty: ${difficulty}
Problem: ${content}

Respond with exactly this JSON structure:
\`\`\`json
{
  "pattern": "primary algorithm pattern name (e.g. Sliding Window, Two Pointers, Dynamic Programming, BFS/DFS, Monotonic Stack, Binary Search, Union-Find, Greedy, Backtracking, Heap/Priority Queue, Trie, Hash Map)",
  "confidence": "high | medium | low",
  "keyInsight": "one sentence describing the core insight that unlocks this problem",
  "relatedPatterns": ["up to 2 alternative patterns"],
  "visualizationType": "array | tree | graph | dp_table | stack | heap | none"
}
\`\`\``;

  const text = await callClaude(apiKey, system, user, 512);
  return parseJSON(text);
}

async function handleGetHint(apiKey, { title, content, constraints, code, hintLevel, pattern }) {
  const system = `You are a Socratic programming mentor. Never give the full solution unless hint level 5. Guide students to discover solutions themselves through progressive hints.`;

  const hintInstructions = {
    1: "Pattern recognition only. Ask a guiding question about what data structure or technique applies. Do NOT name the algorithm. 2-3 sentences.",
    2: "Name the data structure or algorithm pattern and explain in 2-3 sentences WHY it fits this problem. No implementation details.",
    3: "Give a concise optimization clue in 2-3 sentences. Hint at the key operation that makes the solution efficient.",
    4: `Give a numbered pseudocode outline of 4-6 steps. Format it as a plain numbered list like:
1. Initialize ...
2. Iterate ...
3. Check ...
No actual code syntax — use plain English descriptions of each step.`,
    5: `Provide the complete working solution with brief inline comments. Use a fenced code block with the correct language identifier.`,
  };

  const user = `Problem: ${title}
Pattern: ${pattern}
Constraints: ${constraints}
Current code:
\`\`\`
${code || "(no code written yet)"}
\`\`\`

Hint level ${hintLevel}/5: ${hintInstructions[hintLevel]}

Respond using ONLY these two XML tags and nothing else outside them:
<hint>
your hint content here (can include newlines, code blocks, numbered lists freely)
</hint>
<followup>
a short question to prompt thinking (levels 1-3 only, leave empty for levels 4-5)
</followup>`;

  const text = await callClaude(apiKey, system, user, 1500);
  return parseHintResponse(text);
}

function parseHintResponse(text) {
  const hintMatch = text.match(/<hint>([\s\S]*?)<\/hint>/);
  const followupMatch = text.match(/<followup>([\s\S]*?)<\/followup>/);
  return {
    hint: hintMatch ? hintMatch[1].trim() : text.trim(),
    followUpQuestion: followupMatch ? followupMatch[1].trim() : "",
  };
}

async function handleAnalyzeComplexity(apiKey, { code, language, problemTitle }) {
  if (!code || code.trim().length < 20) {
    return { timeComplexity: "—", spaceComplexity: "—", tleRisk: false, bottlenecks: [], suggestion: "" };
  }

  const system = `You are an expert algorithm complexity analyzer. Analyze code and identify complexity with specific reasoning. Respond ONLY with valid JSON.`;

  const user = `Analyze the time and space complexity of this ${language} solution for "${problemTitle}":

\`\`\`${language}
${code}
\`\`\`

Respond with exactly this JSON:
\`\`\`json
{
  "timeComplexity": "O(...)",
  "spaceComplexity": "O(...)",
  "tleRisk": true or false,
  "bottlenecks": ["describe nested loops or inefficiencies, max 2 items"],
  "suggestion": "one-line tip to improve complexity (empty string if already optimal)"
}
\`\`\`

TLE risk is true if time complexity is O(n²) or worse for n > 10^4, or O(n³) for any n.`;

  const text = await callClaude(apiKey, system, user, 512);
  return parseJSON(text);
}

async function handleDetectErrors(apiKey, { code, language, problemTitle, problemContent, constraints }) {
  if (!code || code.trim().length < 30) return { correct: [], edgeCases: [], errors: [] };

  const system = `You are a meticulous code reviewer. You only report bugs you can directly prove from the code. You never hallucinate issues based on patterns — only on what is literally written. Respond ONLY with valid JSON.`;

  const user = `Review this ${language} solution for "${problemTitle}".

Problem: ${problemContent}
Constraints: ${constraints}

Code (read every line in order before forming any opinion):
\`\`\`${language}
${code}
\`\`\`

Before producing output, trace the code mentally in execution order:
- Note every variable definition and the line it first appears on.
- Note the actual order statements execute.

Then respond with exactly this JSON:
\`\`\`json
{
  "correct": [
    "genuine strength of the implementation — algorithm choice, tricky case handled correctly, good data structure. Max 3 items."
  ],
  "edgeCases": [
    "edge case that is genuinely unhandled based on what you read. Must be verifiable from the code. Max 3 items."
  ],
  "errors": [
    {
      "description": "bug description — must be directly provable from the code as written",
      "location": "quote the exact line or expression that is wrong",
      "fix": "one-sentence fix"
    }
  ]
}
\`\`\`

Strict rules — violation of these makes the review useless:
1. Before claiming a variable is undefined or uninitialized, confirm it does NOT appear on any earlier line. If it appears anywhere before its use, do NOT report it.
2. Before claiming lines are in the wrong order, quote both lines and state their actual positions in the code.
3. Every entry in "errors" must be something you can quote directly from the code. If you cannot point to the exact line, omit it.
4. "edgeCases" must reflect what the code actually does — not what a generic solution might miss.
5. If you are not fully certain about a bug, leave it out. A false positive is more harmful than a missed bug.`;

  const text = await callClaude(apiKey, system, user, 900);
  return parseJSON(text);
}

// ── Notion Integration ───────────────────────────────────────────────────────

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const COVER_URL = "https://raw.githubusercontent.com/sanjaydinesh19/leetcoach/main/assets/Background.jpg";

async function generateNotionContent(apiKey, { title, problemContent, userCode, language }) {
  const system = `You are an expert competitive programmer. Given a LeetCode problem and a user's solution, provide an optimal solution and concise study notes. Respond ONLY with valid JSON.`;

  const user = `Problem: ${title}
Statement: ${problemContent}

User's solution (${language}):
\`\`\`${language}
${userCode || "(no code provided)"}
\`\`\`

Respond with exactly this JSON:
\`\`\`json
{
  "optimalCode": "the optimal solution in ${language} with brief inline comments",
  "notes": [
    "5-6 bullet points covering: key insight, algorithm choice, time/space complexity, edge cases, and how the optimal differs from brute force"
  ]
}
\`\`\``;

  const text = await callClaude(apiKey, system, user, 1500);
  return parseJSON(text);
}

async function handleSaveToNotion(apiKey, notionKey, notionDbId, payload) {
  const { title, difficulty, topics, link, userCode, language, revise, problemContent } = payload;
  const today = new Date().toISOString().split("T")[0];

  const generated = await generateNotionContent(apiKey, { title, problemContent, userCode, language });

  const blocks = [
    { object: "block", type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: "My Solution" } }] } },
    { object: "block", type: "code", code: { language, rich_text: [{ type: "text", text: { content: userCode || "" } }] } },
    { object: "block", type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: "Optimal Solution" } }] } },
    { object: "block", type: "code", code: { language, rich_text: [{ type: "text", text: { content: generated.optimalCode } }] } },
    { object: "block", type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: "Notes" } }] } },
    ...generated.notes.map(note => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: [{ type: "text", text: { content: note } }] },
    })),
  ];

  const response = await fetch(`${NOTION_API_URL}/pages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: notionDbId },
      cover: { type: "external", external: { url: COVER_URL } },
      properties: {
        "Question Title": { title: [{ text: { content: title } }] },
        "Difficulty Level": { select: { name: difficulty } },
        "Topic": { multi_select: topics.map(t => ({ name: t })) },
        "Link": { url: link },
        "Revise": { select: { name: revise } },
        "Last Solved Date": { date: { start: today } },
      },
      children: blocks,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Notion API error ${response.status}`);
  }

  return await response.json();
}

// ── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  chrome.storage.sync.get(["apiKey", "notionKey", "notionDbId"]).then(({ apiKey, notionKey, notionDbId }) => {
    if (type === "SAVE_TO_NOTION") {
      if (!notionKey || !notionDbId) {
        sendResponse({ error: "Notion not configured. Click the LeetCoach icon to add your Notion key." });
        return;
      }
      if (!apiKey) {
        sendResponse({ error: "No Claude API key set. Click the LeetCoach icon to add your key." });
        return;
      }
      handleSaveToNotion(apiKey, notionKey, notionDbId, payload)
        .then((data) => sendResponse({ data }))
        .catch((err) => sendResponse({ error: err.message }));
      return;
    }

    if (!apiKey) {
      sendResponse({ error: "No API key set. Click the LeetCoach icon to add your key." });
      return;
    }

    let handler;
    switch (type) {
      case "ANALYZE_PROBLEM":    handler = handleAnalyzeProblem(apiKey, payload); break;
      case "GET_HINT":           handler = handleGetHint(apiKey, payload); break;
      case "ANALYZE_COMPLEXITY": handler = handleAnalyzeComplexity(apiKey, payload); break;
      case "DETECT_ERRORS":      handler = handleDetectErrors(apiKey, payload); break;
      default:
        sendResponse({ error: `Unknown message type: ${type}` });
        return;
    }

    handler
      .then((data) => sendResponse({ data }))
      .catch((err) => sendResponse({ error: err.message }));
  });

  return true; // keep message channel open for async response
});
