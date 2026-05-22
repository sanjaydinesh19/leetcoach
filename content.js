// LeetCoach — content script injected into LeetCode problem pages

(function () {
  "use strict";

  // Guard against double injection
  if (document.getElementById("leetcoach-root")) return;

  // ── State ──────────────────────────────────────────────────────────────────

  const state = {
    problem: { title: "", content: "", constraints: "", difficulty: "", slug: "" },
    pattern: null,
    currentHintLevel: 0, // 0 = none shown yet
    hintsUnlocked: 0,
    hintCache: {},        // level → { hint, followUpQuestion }
    complexity: { timeComplexity: "—", spaceComplexity: "—", tleRisk: false, bottlenecks: [], suggestion: "" },
    errors: { errors: [], warnings: [] },
    vizData: null,
    vizStep: 0,
    vizTimer: null,
    vizPlaying: false,
    struggle: {
      compileFailures: 0,
      lastCodeSnapshot: "",
      rewriteCount: 0,
      inactiveTimer: null,
      lastActivity: Date.now(),
      alerted: false,
    },
    analysisDebounce: null,
    lastAnalyzedCode: "",
  };

  // ── Problem Parser ─────────────────────────────────────────────────────────

  function parseProblem() {
    const slug = location.pathname.split("/").filter(Boolean)[1] || "";
    if (slug === state.problem.slug && state.problem.title) return false; // no change

    const title =
      document.querySelector('[data-cy="question-title"]')?.textContent?.trim() ||
      document.querySelector(".text-title-large")?.textContent?.trim() ||
      document.querySelector("title")?.textContent?.replace("- LeetCode", "").trim() ||
      slug.replace(/-/g, " ");

    const difficulty =
      document.querySelector('[diff]')?.getAttribute("diff") ||
      document.querySelector(".text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard")?.textContent?.trim() ||
      "";

    // LeetCode renders problem content in a scrollable div
    const contentEl =
      document.querySelector('[data-track-load="description_content"]') ||
      document.querySelector(".elfjS") ||
      document.querySelector(".content__u3I1");

    let content = contentEl?.innerText?.trim() || "";
    let constraints = "";

    // Extract constraints section
    const constraintsMatch = content.match(/Constraints?:?([\s\S]*?)(?=\n\n|\nFollow-up|$)/i);
    if (constraintsMatch) constraints = constraintsMatch[1].trim();

    // Truncate content for API calls (keep first 1200 chars)
    if (content.length > 1200) content = content.slice(0, 1200) + "…";

    state.problem = { title, content, constraints, difficulty, slug };
    return true; // problem changed
  }

  function getEditorCode() {
    // Monaco editor
    if (window.monaco) {
      const models = window.monaco.editor.getModels();
      if (models.length > 0) return models[0].getValue();
    }

    // Fallback: read from DOM view-lines
    const lines = document.querySelectorAll(".view-line");
    if (lines.length > 0) {
      return Array.from(lines).map(l => l.textContent).join("\n");
    }

    // CodeMirror 6
    const cm = document.querySelector(".cm-content");
    if (cm) return cm.innerText;

    return "";
  }

  function getEditorLanguage() {
    const langBtn = document.querySelector('[data-cy="lang-btn"] button, .ant-select-selection-item');
    const lang = langBtn?.textContent?.trim()?.toLowerCase() || "python";
    if (lang.includes("python")) return "python";
    if (lang.includes("java") && !lang.includes("script")) return "java";
    if (lang.includes("c++") || lang.includes("cpp")) return "cpp";
    if (lang.includes("javascript") || lang.includes("js")) return "javascript";
    if (lang.includes("typescript")) return "typescript";
    if (lang.includes("go")) return "go";
    if (lang.includes("rust")) return "rust";
    return lang || "python";
  }

  // ── Message passing to background ─────────────────────────────────────────

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response?.error) return reject(new Error(response.error));
        resolve(response?.data);
      });
    });
  }

  // ── Sidebar HTML ───────────────────────────────────────────────────────────

  function buildSidebar() {
    const root = document.createElement("div");
    root.id = "leetcoach-root";

    root.innerHTML = `
      <button id="lc-toggle">
        <span class="lc-logo">🧠</span>
        LC
      </button>
      <div id="lc-panel">
        <div id="lc-header">
          <div id="lc-title">🧠 LeetCoach</div>
          <div id="lc-problem-name">Loading problem…</div>
          <span id="lc-pattern-badge" class="loading">Analyzing pattern…</span>
        </div>

        <div id="lc-tabs">
          <div class="lc-tab active" data-tab="hints">💡 Hints</div>
          <div class="lc-tab" data-tab="analysis">📊 Analysis</div>
          <div class="lc-tab" data-tab="visualize">🎬 Visualize</div>
        </div>

        <div id="lc-content">
          <!-- Hints Pane -->
          <div class="lc-pane active" id="lc-pane-hints">
            <div class="lc-section-label">Hint Level</div>
            <div id="lc-hint-levels">
              <button class="lc-hint-btn" data-level="1">H1</button>
              <button class="lc-hint-btn" data-level="2">H2</button>
              <button class="lc-hint-btn" data-level="3">H3</button>
              <button class="lc-hint-btn" data-level="4">H4</button>
              <button class="lc-hint-btn" data-level="5">H5</button>
            </div>

            <div id="lc-hint-box">
              <div style="color:#6b7280; font-style:italic;">
                Click "Get Hint" to receive your first progressive hint.<br><br>
                Hints go from pattern recognition → pseudocode → full solution.
              </div>
            </div>

            <button id="lc-next-hint-btn">Get Hint 1 →</button>

            <div id="lc-struggle-alert"></div>
          </div>

          <!-- Analysis Pane -->
          <div class="lc-pane" id="lc-pane-analysis">
            <div class="lc-section-label">Complexity</div>
            <div class="lc-complexity-row">
              <span class="lc-complexity-label">TIME</span>
              <span class="lc-complexity-value" id="lc-time-val">—</span>
            </div>
            <div class="lc-complexity-row">
              <span class="lc-complexity-label">SPACE</span>
              <span class="lc-complexity-value" id="lc-space-val">—</span>
            </div>

            <div id="lc-tle-warning"></div>

            <div id="lc-bottleneck-section" style="display:none">
              <div class="lc-section-label">Bottlenecks</div>
              <ul class="lc-bottleneck-list" id="lc-bottleneck-list"></ul>
            </div>

            <div id="lc-suggestion-section"></div>

            <div class="lc-section-label">Semantic Errors</div>
            <div id="lc-analysis-errors">
              <div class="lc-empty">Write some code and click Analyze to detect logical errors.</div>
            </div>

            <button id="lc-analyze-btn">Analyze My Code</button>
          </div>

          <!-- Visualize Pane -->
          <div class="lc-pane" id="lc-pane-visualize">
            <div id="lc-viz-container">
              <div id="lc-viz-title">Algorithm Visualizer</div>
              <div id="lc-viz-description" style="color:#6b7280">
                Generate a visualization for this problem's algorithm pattern.
              </div>
              <canvas id="lc-viz-canvas" width="310" height="160"></canvas>
              <div id="lc-viz-step-label"></div>
            </div>
            <div class="lc-viz-controls">
              <button class="lc-viz-btn" id="lc-viz-prev">⏮ Prev</button>
              <button class="lc-viz-btn" id="lc-viz-play">▶ Play</button>
              <button class="lc-viz-btn" id="lc-viz-next">Next ⏭</button>
            </div>
            <button id="lc-generate-viz-btn" style="margin-top:10px">🎬 Generate Visualization</button>
          </div>
        </div>

        <div id="lc-status">LeetCoach ready</div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  // ── UI Update Helpers ──────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const setStatus = (msg, type = "") => {
    const el = $("lc-status");
    if (el) { el.textContent = msg; el.className = type; }
  };

  function updatePatternBadge() {
    const badge = $("lc-pattern-badge");
    if (!badge) return;
    if (state.pattern) {
      badge.textContent = "⚡ " + state.pattern.pattern;
      badge.className = "";
    } else {
      badge.textContent = "Analyzing…";
      badge.className = "loading";
    }
  }

  function renderHintText(text) {
    // Render fenced code blocks as <pre><code>
    let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="lc-code-block"><code>${escapeHtml(code.trim())}</code></pre>`;
    });
    // Render numbered list lines (1. 2. 3.) preserving structure
    html = html.replace(/^(\d+\.\s.+)$/gm, "<div class='lc-pseudo-step'>$1</div>");
    // Newlines to <br> outside of pre blocks
    html = html.replace(/\n(?!<)/g, "<br>");
    return html;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function updateHintUI() {
    const box = $("lc-hint-box");
    const btn = $("lc-next-hint-btn");
    if (!box || !btn) return;

    const level = state.currentHintLevel;
    const cached = state.hintCache[level];

    if (level === 0) {
      box.innerHTML = `<div style="color:#6b7280;font-style:italic;">Click "Get Hint" to receive your first progressive hint.</div>`;
    } else if (cached) {
      const levelNames = ["", "Pattern Recognition", "Data Structure", "Optimization Clue", "Pseudocode", "Full Implementation"];
      box.innerHTML = `
        <div class="lc-hint-level-label">H${level}: ${levelNames[level]}</div>
        <div>${renderHintText(cached.hint)}</div>
        ${cached.followUpQuestion ? `<div id="lc-hint-followup">💭 ${cached.followUpQuestion}</div>` : ""}
      `;
    } else {
      box.innerHTML = `<div class="loading" style="color:#6b7280;font-style:italic;">Loading hint…</div>`;
    }

    // Update level buttons
    document.querySelectorAll(".lc-hint-btn").forEach(btn => {
      const lvl = parseInt(btn.dataset.level);
      btn.className = "lc-hint-btn";
      if (lvl === level) btn.classList.add("active");
      else if (lvl <= state.hintsUnlocked) btn.classList.add("unlocked");
    });

    // Update next hint button
    if (level >= 5) {
      btn.textContent = "All Hints Shown ✓";
      btn.disabled = true;
    } else {
      btn.textContent = `Get Hint ${level + 1} →`;
      btn.disabled = false;
    }
  }

  function updateComplexityUI(data) {
    const timeEl = $("lc-time-val");
    const spaceEl = $("lc-space-val");
    const tleEl = $("lc-tle-warning");
    const bottSection = $("lc-bottleneck-section");
    const bottList = $("lc-bottleneck-list");
    const suggSection = $("lc-suggestion-section");

    if (timeEl) {
      timeEl.textContent = data.timeComplexity;
      timeEl.className = "lc-complexity-value" + (data.tleRisk ? " tle" : "");
    }
    if (spaceEl) spaceEl.textContent = data.spaceComplexity;

    if (tleEl) {
      if (data.tleRisk) {
        tleEl.textContent = `⚠ TLE Risk: ${data.timeComplexity} may fail for n=10⁵. Consider a more efficient approach.`;
        tleEl.className = "visible";
      } else {
        tleEl.className = "";
      }
    }

    if (bottSection && bottList) {
      if (data.bottlenecks?.length > 0) {
        bottSection.style.display = "block";
        bottList.innerHTML = data.bottlenecks.map(b => `<li>${b}</li>`).join("");
      } else {
        bottSection.style.display = "none";
      }
    }

    if (suggSection) {
      suggSection.innerHTML = data.suggestion
        ? `<div class="lc-suggestion">💡 ${data.suggestion}</div>`
        : "";
    }
  }

  function updateErrorsUI(data) {
    const container = $("lc-analysis-errors");
    if (!container) return;

    if (!data.errors?.length && !data.warnings?.length) {
      container.innerHTML = `<div class="lc-empty">No logical errors detected. ✓</div>`;
      return;
    }

    let html = "";
    (data.errors || []).forEach(e => {
      html += `
        <div class="lc-error-card ${e.severity}">
          <div class="lc-error-title">${e.severity === "critical" ? "🔴" : "🟡"} ${e.description}</div>
          <div style="font-size:11px;color:#9ca3af">📍 ${e.location}</div>
          <div class="lc-error-fix">Fix: ${e.fix}</div>
        </div>`;
    });
    (data.warnings || []).forEach(w => {
      html += `<div class="lc-error-card warning"><div class="lc-error-title">⚠ Edge case: ${w}</div></div>`;
    });
    container.innerHTML = html;
  }

  // ── Struggle Detection ─────────────────────────────────────────────────────

  function checkStruggle() {
    const s = state.struggle;
    const alert = $("lc-struggle-alert");
    if (!alert || s.alerted) return;

    let msg = "";

    if (s.compileFailures >= 3) {
      msg = "⚠ You've had several failed runs. Want to try Hint 3 for an optimization clue?";
    } else if (s.rewriteCount >= 3) {
      msg = "📝 You've rewritten this a few times. Sometimes starting with pseudocode (Hint 4) helps clarify the approach.";
    } else if (Date.now() - s.lastActivity > 5 * 60 * 1000) {
      msg = "⏱ Been quiet for a while. Stuck on an edge case? Try Hint 2 for a data structure suggestion.";
    }

    if (msg) {
      alert.textContent = msg;
      alert.classList.add("visible");
      s.alerted = true;
    }
  }

  function trackActivity() {
    state.struggle.lastActivity = Date.now();
    clearTimeout(state.struggle.inactiveTimer);
    state.struggle.inactiveTimer = setTimeout(checkStruggle, 5 * 60 * 1000);
  }

  function detectCompileFailure() {
    const observer = new MutationObserver(() => {
      const hasError =
        document.querySelector(".error-alert, [data-e2e-locator='console-result-wrong-answer']") ||
        document.querySelector(".text-red-s, .text-sm.text-red");
      if (hasError) {
        state.struggle.compileFailures++;
        checkStruggle();
      }
    });

    const consoleArea = document.querySelector(".console-content, #qd-content");
    if (consoleArea) observer.observe(consoleArea, { childList: true, subtree: true });
  }

  // ── Complexity auto-analysis on code change ────────────────────────────────

  function scheduleComplexityAnalysis(code, language) {
    clearTimeout(state.analysisDebounce);
    state.analysisDebounce = setTimeout(async () => {
      if (code === state.lastAnalyzedCode || code.trim().length < 30) return;
      state.lastAnalyzedCode = code;

      // Detect major rewrites
      if (state.struggle.lastCodeSnapshot && code.length < state.struggle.lastCodeSnapshot.length * 0.5) {
        state.struggle.rewriteCount++;
        state.struggle.alerted = false;
        checkStruggle();
      }
      state.struggle.lastCodeSnapshot = code;

      try {
        const data = await send("ANALYZE_COMPLEXITY", {
          code,
          language,
          problemTitle: state.problem.title,
        });
        state.complexity = data;
        updateComplexityUI(data);
        setStatus("Complexity updated", "success");
      } catch (e) {
        // Silent fail for auto-analysis
      }
    }, 2500); // debounce 2.5s after typing stops
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  async function onGetHint() {
    const nextLevel = state.currentHintLevel + 1;
    if (nextLevel > 5) return;

    const btn = $("lc-next-hint-btn");
    if (btn) btn.disabled = true;

    // Use cache if available
    if (state.hintCache[nextLevel]) {
      state.currentHintLevel = nextLevel;
      state.hintsUnlocked = Math.max(state.hintsUnlocked, nextLevel);
      updateHintUI();
      if (btn) btn.disabled = false;
      return;
    }

    setStatus("Generating hint…");
    $("lc-hint-box").innerHTML = `<div style="color:#6b7280;font-style:italic;">✨ Thinking…</div>`;

    try {
      const code = getEditorCode();
      const data = await send("GET_HINT", {
        title: state.problem.title,
        content: state.problem.content,
        constraints: state.problem.constraints,
        code,
        hintLevel: nextLevel,
        pattern: state.pattern?.pattern || "unknown",
      });

      state.hintCache[nextLevel] = data;
      state.currentHintLevel = nextLevel;
      state.hintsUnlocked = Math.max(state.hintsUnlocked, nextLevel);
      state.struggle.alerted = false; // reset struggle after hint used
      updateHintUI();
      setStatus("Hint ready", "success");
    } catch (e) {
      $("lc-hint-box").innerHTML = `<div style="color:#ef4444;">Error: ${e.message}</div>`;
      setStatus(e.message, "error");
    }

    if (btn) btn.disabled = state.currentHintLevel >= 5;
  }

  async function onAnalyzeCode() {
    const btn = $("lc-analyze-btn");
    if (btn) { btn.textContent = "Analyzing…"; btn.disabled = true; }
    setStatus("Running analysis…");

    const code = getEditorCode();
    const language = getEditorLanguage();

    try {
      const [complexity, errors] = await Promise.all([
        send("ANALYZE_COMPLEXITY", {
          code, language, problemTitle: state.problem.title,
        }),
        send("DETECT_ERRORS", {
          code, language,
          problemTitle: state.problem.title,
          problemContent: state.problem.content,
          constraints: state.problem.constraints,
        }),
      ]);

      state.complexity = complexity;
      state.errors = errors;
      state.lastAnalyzedCode = code;

      updateComplexityUI(complexity);
      updateErrorsUI(errors);
      setStatus("Analysis complete", "success");
    } catch (e) {
      setStatus(e.message, "error");
    }

    if (btn) { btn.textContent = "Analyze My Code"; btn.disabled = false; }
  }

  async function onGenerateVisualization() {
    const btn = $("lc-generate-viz-btn");
    if (btn) { btn.textContent = "Generating…"; btn.disabled = true; }
    setStatus("Building visualization…");

    try {
      const data = await send("GET_VISUALIZATION", {
        pattern: state.pattern?.pattern || "Array",
        problemTitle: state.problem.title,
      });

      state.vizData = data;
      state.vizStep = 0;
      renderVizStep();
      setStatus("Visualization ready", "success");
    } catch (e) {
      setStatus(e.message, "error");
    }

    if (btn) { btn.textContent = "🎬 Regenerate"; btn.disabled = false; }
  }

  function onHintLevelClick(level) {
    if (level > state.hintsUnlocked + 1) return; // must unlock sequentially
    if (level > state.currentHintLevel && !state.hintCache[level]) {
      // Trigger hint load
      state.currentHintLevel = level - 1;
      onGetHint();
    } else {
      state.currentHintLevel = level;
      updateHintUI();
    }
  }

  // ── Visualizer ─────────────────────────────────────────────────────────────

  function renderVizStep() {
    const data = state.vizData;
    if (!data || !data.steps) return;

    const step = data.steps[state.vizStep] || data.steps[0];
    const canvas = $("lc-viz-canvas");
    const label = $("lc-viz-step-label");
    const titleEl = $("lc-viz-title");
    const descEl = $("lc-viz-description");

    if (titleEl) titleEl.textContent = data.title || data.pattern;
    if (descEl) descEl.textContent = data.description || "";

    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    const elements = step.values || data.initialState?.elements || [];
    const highlights = step.highlights || [];
    const pointers = step.pointers || {};

    if (data.type === "array" || !data.type) {
      drawArrayViz(ctx, W, H, elements, highlights, pointers);
    } else if (data.type === "dp_table") {
      drawDPTableViz(ctx, W, H, elements, highlights, data.initialState);
    } else if (data.type === "stack") {
      drawStackViz(ctx, W, H, elements, highlights);
    } else {
      drawArrayViz(ctx, W, H, elements, highlights, pointers);
    }

    if (label) {
      label.textContent = `Step ${state.vizStep + 1}/${data.steps.length}: ${step.action || ""}`;
    }

    // Update controls
    const prevBtn = $("lc-viz-prev");
    const nextBtn = $("lc-viz-next");
    if (prevBtn) prevBtn.disabled = state.vizStep <= 0;
    if (nextBtn) nextBtn.disabled = state.vizStep >= data.steps.length - 1;
  }

  function drawArrayViz(ctx, W, H, elements, highlights, pointers) {
    if (!elements.length) return;

    const n = elements.length;
    const cellW = Math.min(40, (W - 20) / n);
    const cellH = 36;
    const startX = (W - n * cellW) / 2;
    const startY = H / 2 - cellH / 2 - 10;

    // Draw cells
    elements.forEach((val, i) => {
      const x = startX + i * cellW;
      const isHighlighted = highlights.includes(i);

      ctx.fillStyle = isHighlighted ? "#7c3aed" : "#1e1e36";
      ctx.strokeStyle = isHighlighted ? "#a78bfa" : "#374151";
      ctx.lineWidth = isHighlighted ? 2 : 1;
      roundRect(ctx, x + 1, startY, cellW - 2, cellH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isHighlighted ? "#fff" : "#e5e7eb";
      ctx.font = `bold ${Math.min(14, cellW * 0.4 + 6)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(val), x + cellW / 2, startY + cellH / 2);

      // Index label
      ctx.fillStyle = "#4b5563";
      ctx.font = "10px monospace";
      ctx.fillText(String(i), x + cellW / 2, startY + cellH + 12);
    });

    // Draw pointer arrows
    const pointerColors = { left: "#10b981", right: "#f59e0b", mid: "#06b6d4", slow: "#10b981", fast: "#f59e0b" };
    Object.entries(pointers).forEach(([name, idx]) => {
      if (typeof idx !== "number" || idx < 0 || idx >= n) return;
      const x = startX + idx * cellW + cellW / 2;
      const color = pointerColors[name] || "#a78bfa";

      ctx.fillStyle = color;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(name, x, startY - 16);

      // Arrow
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, startY - 8);
      ctx.lineTo(x, startY - 2);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(x - 4, startY - 6);
      ctx.lineTo(x, startY - 2);
      ctx.lineTo(x + 4, startY - 6);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  function drawDPTableViz(ctx, W, H, elements, highlights, initialState) {
    if (!Array.isArray(elements) || !elements.length) return;
    // elements could be 1D (flat) or 2D (nested)
    const is2D = Array.isArray(elements[0]);
    const rows = is2D ? elements : [elements];
    const cols = rows[0].length;

    const cellW = Math.min(36, (W - 20) / cols);
    const cellH = Math.min(28, (H - 20) / rows.length);
    const startX = (W - cols * cellW) / 2;
    const startY = (H - rows.length * cellH) / 2;

    rows.forEach((row, r) => {
      row.forEach((val, c) => {
        const x = startX + c * cellW;
        const y = startY + r * cellH;
        const flatIdx = r * cols + c;
        const isHighlighted = highlights.includes(flatIdx) || highlights.includes(c);

        ctx.fillStyle = isHighlighted ? "#7c3aed" : "#1e1e36";
        ctx.strokeStyle = isHighlighted ? "#a78bfa" : "#374151";
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, cellW - 1, cellH - 1);
        ctx.strokeRect(x, y, cellW - 1, cellH - 1);

        ctx.fillStyle = isHighlighted ? "#fff" : "#9ca3af";
        ctx.font = `${Math.min(11, cellW * 0.3 + 5)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(val === Infinity ? "∞" : String(val), x + cellW / 2, y + cellH / 2);
      });
    });
  }

  function drawStackViz(ctx, W, H, elements, highlights) {
    if (!elements.length) return;
    const n = Math.min(elements.length, 6);
    const cellW = 80;
    const cellH = 28;
    const startX = (W - cellW) / 2;
    const topY = H / 2 - (n * cellH) / 2;

    // Draw stack from bottom to top
    for (let i = 0; i < n; i++) {
      const val = elements[elements.length - 1 - (n - 1 - i)];
      const y = topY + (n - 1 - i) * cellH;
      const isTop = i === n - 1;

      ctx.fillStyle = isTop ? "#7c3aed" : "#1e1e36";
      ctx.strokeStyle = isTop ? "#a78bfa" : "#374151";
      ctx.lineWidth = isTop ? 2 : 1;
      roundRect(ctx, startX, y + 1, cellW, cellH - 2, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isTop ? "#fff" : "#d1d5db";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(val), startX + cellW / 2, y + cellH / 2);
    }

    // TOP label
    if (n > 0) {
      ctx.fillStyle = "#a78bfa";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("← TOP", startX + cellW + 6, topY + cellH / 2);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function vizPlay() {
    const data = state.vizData;
    if (!data || state.vizPlaying) return;
    state.vizPlaying = true;
    const playBtn = $("lc-viz-play");
    if (playBtn) playBtn.textContent = "⏸ Pause";

    state.vizTimer = setInterval(() => {
      if (state.vizStep < data.steps.length - 1) {
        state.vizStep++;
        renderVizStep();
      } else {
        vizStop();
      }
    }, 900);
  }

  function vizStop() {
    clearInterval(state.vizTimer);
    state.vizPlaying = false;
    const playBtn = $("lc-viz-play");
    if (playBtn) playBtn.textContent = "▶ Play";
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  function bindEvents() {
    const root = $("leetcoach-root");

    // Toggle collapse
    $("lc-toggle")?.addEventListener("click", () => {
      root.classList.toggle("collapsed");
    });

    // Tab switching
    document.querySelectorAll(".lc-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".lc-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".lc-pane").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        $(`lc-pane-${tab.dataset.tab}`)?.classList.add("active");
      });
    });

    // Hint level buttons
    document.querySelectorAll(".lc-hint-btn").forEach(btn => {
      btn.addEventListener("click", () => onHintLevelClick(parseInt(btn.dataset.level)));
    });

    // Next hint button
    $("lc-next-hint-btn")?.addEventListener("click", onGetHint);

    // Analysis button
    $("lc-analyze-btn")?.addEventListener("click", onAnalyzeCode);

    // Visualization controls
    $("lc-generate-viz-btn")?.addEventListener("click", onGenerateVisualization);
    $("lc-viz-prev")?.addEventListener("click", () => {
      if (state.vizStep > 0) { state.vizStep--; renderVizStep(); }
    });
    $("lc-viz-next")?.addEventListener("click", () => {
      if (state.vizData && state.vizStep < state.vizData.steps.length - 1) {
        state.vizStep++;
        renderVizStep();
      }
    });
    $("lc-viz-play")?.addEventListener("click", () => {
      state.vizPlaying ? vizStop() : vizPlay();
    });
  }

  // Monitor editor for code changes
  function watchEditor() {
    // Try Monaco model onChange
    const tryMonaco = () => {
      if (window.monaco) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          models[0].onDidChangeContent(() => {
            trackActivity();
            const code = models[0].getValue();
            const lang = getEditorLanguage();
            scheduleComplexityAnalysis(code, lang);
          });
          return true;
        }
      }
      return false;
    };

    if (!tryMonaco()) {
      // Fallback: MutationObserver on editor DOM
      const editorEl = document.querySelector(".view-lines, .cm-content");
      if (editorEl) {
        new MutationObserver(() => {
          trackActivity();
          const code = getEditorCode();
          scheduleComplexityAnalysis(code, getEditorLanguage());
        }).observe(editorEl, { childList: true, subtree: true, characterData: true });
      } else {
        // Retry after Monaco loads
        setTimeout(watchEditor, 2000);
      }
    }
  }

  async function initForProblem() {
    const changed = parseProblem();
    if (!changed && state.pattern) return; // already initialized for this problem

    // Reset state for new problem
    state.pattern = null;
    state.currentHintLevel = 0;
    state.hintsUnlocked = 0;
    state.hintCache = {};
    state.struggle = { compileFailures: 0, lastCodeSnapshot: "", rewriteCount: 0, inactiveTimer: null, lastActivity: Date.now(), alerted: false };

    const nameEl = $("lc-problem-name");
    if (nameEl) nameEl.textContent = state.problem.title || "Unknown Problem";

    updatePatternBadge();
    updateHintUI();

    setStatus("Analyzing problem pattern…");

    try {
      const data = await send("ANALYZE_PROBLEM", {
        title: state.problem.title,
        content: state.problem.content,
        difficulty: state.problem.difficulty,
      });
      state.pattern = data;
      updatePatternBadge();
      setStatus(`Pattern: ${data.pattern}`, "success");

      // Show key insight in hint box
      const box = $("lc-hint-box");
      if (box && state.currentHintLevel === 0) {
        box.innerHTML = `
          <div style="color:#6b7280;font-style:italic;margin-bottom:8px;">
            Click "Get Hint 1" to start guided coaching.
          </div>
          <div style="color:#c4b5fd;font-size:11px;">
            💭 Try the problem yourself first — hints are waiting whenever you need them.
          </div>`;
      }
    } catch (e) {
      setStatus(e.message, "error");
      const badge = $("lc-pattern-badge");
      if (badge) { badge.textContent = "API key needed"; badge.className = "loading"; }
    }
  }

  function init() {
    buildSidebar();
    bindEvents();
    detectCompileFailure();
    trackActivity();

    // Wait for LeetCode's SPA to finish rendering the problem
    const tryInit = () => {
      const contentEl =
        document.querySelector('[data-track-load="description_content"]') ||
        document.querySelector(".elfjS");
      if (contentEl && contentEl.innerText.trim().length > 50) {
        initForProblem();
        watchEditor();
      } else {
        setTimeout(tryInit, 800);
      }
    };
    tryInit();

    // Watch for SPA navigation to new problems
    let lastPath = location.pathname;
    new MutationObserver(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        if (location.pathname.includes("/problems/")) {
          setTimeout(initForProblem, 1200);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
