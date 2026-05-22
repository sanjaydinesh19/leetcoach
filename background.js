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

  const system = `You are a precise algorithmic code reviewer. Your job is to give balanced, accurate feedback — strengths, edge case risks, and real bugs. CRITICAL RULE: Read every single line of code before making any claim. Never say a variable is uninitialized, missing, or wrong if it is present anywhere in the provided code. Only report errors you are 100% certain about after reading the full code. Do not hallucinate bugs. Respond ONLY with valid JSON.`;

  const user = `Review this ${language} solution for "${problemTitle}":

Problem: ${problemContent}
Constraints: ${constraints}

Code:
\`\`\`${language}
${code}
\`\`\`

Read the ENTIRE code carefully, then respond with exactly this JSON:
\`\`\`json
{
  "correct": [
    "one sentence describing something the user implemented correctly (algorithm choice, data structure, handling a tricky case). Max 3 items."
  ],
  "edgeCases": [
    "one sentence describing an edge case the code may not handle (e.g. empty input, all duplicates, negative numbers, overflow). Only list if genuinely unhandled. Max 3 items."
  ],
  "errors": [
    {
      "description": "specific description of a real logical bug you are certain exists after reading the full code",
      "location": "exact location in the code (e.g. 'while loop condition', 'return statement')",
      "fix": "what to change, in one sentence"
    }
  ]
}
\`\`\`

Rules:
- correct: find genuine strengths, not filler praise
- edgeCases: only list cases that are actually unhandled given the code you read
- errors: only include bugs you are absolutely certain about — if unsure, omit it
- all arrays may be empty if nothing applies`;

  const text = await callClaude(apiKey, system, user, 900);
  return parseJSON(text);
}

// ── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  chrome.storage.sync.get("apiKey").then(({ apiKey }) => {
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
