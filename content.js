// LeetCoach — content script injected into LeetCode problem pages

(function () {
  "use strict";

  if (document.getElementById("leetcoach-root")) return;

  // ── State ──────────────────────────────────────────────────────────────────

  const state = {
    problem: { title: "", content: "", constraints: "", difficulty: "", slug: "" },
    pattern: null,
    currentHintLevel: 0,
    hintsUnlocked: 0,
    hintCache: {},
    complexity: { timeComplexity: "—", spaceComplexity: "—", tleRisk: false, bottlenecks: [], suggestion: "" },
    errors: { errors: [], warnings: [] },
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
    if (slug === state.problem.slug && state.problem.title) return false;

    const title =
      document.querySelector('[data-cy="question-title"]')?.textContent?.trim() ||
      document.querySelector(".text-title-large")?.textContent?.trim() ||
      document.querySelector("title")?.textContent?.replace("- LeetCode", "").trim() ||
      slug.replace(/-/g, " ");

    const difficulty =
      document.querySelector('[diff]')?.getAttribute("diff") ||
      document.querySelector(".text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard")?.textContent?.trim() ||
      "";

    const contentEl =
      document.querySelector('[data-track-load="description_content"]') ||
      document.querySelector(".elfjS") ||
      document.querySelector(".content__u3I1");

    let content = contentEl?.innerText?.trim() || "";
    let constraints = "";

    const constraintsMatch = content.match(/Constraints?:?([\s\S]*?)(?=\n\n|\nFollow-up|$)/i);
    if (constraintsMatch) constraints = constraintsMatch[1].trim();

    if (content.length > 1200) content = content.slice(0, 1200) + "…";

    state.problem = { title, content, constraints, difficulty, slug };
    return true;
  }

  function getEditorCode() {
    if (window.monaco) {
      const models = window.monaco.editor.getModels();
      if (models.length > 0) return models[0].getValue();
    }
    const lines = document.querySelectorAll(".view-line");
    if (lines.length > 0) return Array.from(lines).map(l => l.textContent).join("\n");
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

  // ── Message passing ────────────────────────────────────────────────────────

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
      <button id="lc-toggle">LC</button>
      <div id="lc-panel">
        <div id="lc-header">
          <div id="lc-title">LeetCoach</div>
          <div id="lc-problem-name">Loading problem…</div>
          <span id="lc-pattern-badge" class="loading">Analyzing pattern…</span>
        </div>

        <div id="lc-tabs">
          <div class="lc-tab active" data-tab="hints">Hints</div>
          <div class="lc-tab" data-tab="analysis">Analysis</div>
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
              <div class="lc-hint-placeholder">
                Click "Get Hint" to receive your first progressive hint.
                <br><br>
                Hints progress from pattern recognition through to a full solution.
              </div>
            </div>

            <button id="lc-next-hint-btn">Get Hint 1</button>

            <div id="lc-struggle-alert"></div>
          </div>

          <!-- Analysis Pane -->
          <div class="lc-pane" id="lc-pane-analysis">
            <div class="lc-section-label">Complexity</div>
            <div class="lc-complexity-row">
              <span class="lc-complexity-label">Time</span>
              <span class="lc-complexity-value" id="lc-time-val">—</span>
            </div>
            <div class="lc-complexity-row">
              <span class="lc-complexity-label">Space</span>
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
        </div>

        <div id="lc-status">Ready</div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  // ── UI Helpers ─────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const setStatus = (msg, type = "") => {
    const el = $("lc-status");
    if (el) { el.textContent = msg; el.className = type; }
  };

  function updatePatternBadge() {
    const badge = $("lc-pattern-badge");
    if (!badge) return;
    if (state.pattern) {
      badge.textContent = state.pattern.pattern;
      badge.className = "";
    } else {
      badge.textContent = "Analyzing…";
      badge.className = "loading";
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderHintText(text) {
    // Pull code blocks out first so the \n→<br> pass never touches them.
    // textContent on a <pre> with real \n chars preserves formatting perfectly;
    // <br> tags inside <pre> read as empty string via textContent, breaking copy.
    const blocks = [];

    let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const id = "lc-cb-" + Math.random().toString(36).slice(2, 8);
      const label = lang || "code";
      const block = `<div class="lc-code-wrapper"><div class="lc-code-header"><span class="lc-code-lang">${label}</span><button class="lc-copy-btn" data-copy-target="${id}">Copy</button></div><pre class="lc-code-block" id="${id}"><code>${escapeHtml(code.trim())}</code></pre></div>`;
      const marker = `\x00BLOCK${blocks.length}\x00`;
      blocks.push(block);
      return marker;
    });

    // Process surrounding prose only
    html = html.replace(/^(\d+\.\s.+)$/gm, "<div class='lc-pseudo-step'>$1</div>");
    html = html.replace(/\n(?!<)/g, "<br>");

    // Restore code blocks with their original newlines intact
    blocks.forEach((block, i) => { html = html.replace(`\x00BLOCK${i}\x00`, block); });

    return html;
  }

  function updateHintUI() {
    const box = $("lc-hint-box");
    const btn = $("lc-next-hint-btn");
    if (!box || !btn) return;

    const level = state.currentHintLevel;
    const cached = state.hintCache[level];

    if (level === 0) {
      box.innerHTML = `<div class="lc-hint-placeholder">Click "Get Hint" to receive your first progressive hint.<br><br>Hints progress from pattern recognition through to a full solution.</div>`;
    } else if (cached) {
      const levelNames = ["", "Pattern Recognition", "Data Structure", "Optimization Clue", "Pseudocode", "Full Implementation"];
      box.innerHTML = `
        <div class="lc-hint-level-label">H${level} — ${levelNames[level]}</div>
        <div class="lc-hint-body">${renderHintText(cached.hint)}</div>
        ${cached.followUpQuestion ? `<div class="lc-hint-followup">${cached.followUpQuestion}</div>` : ""}
      `;
    } else {
      box.innerHTML = `<div class="lc-hint-placeholder">Generating hint…</div>`;
    }

    document.querySelectorAll(".lc-hint-btn").forEach(b => {
      const lvl = parseInt(b.dataset.level);
      b.className = "lc-hint-btn";
      if (lvl === level) b.classList.add("active");
      else if (lvl <= state.hintsUnlocked) b.classList.add("unlocked");
    });

    if (level >= 5) {
      btn.textContent = "All Hints Shown";
      btn.disabled = true;
    } else {
      btn.textContent = `Get Hint ${level + 1}`;
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
        tleEl.textContent = `TLE Risk — ${data.timeComplexity} may fail for n=10⁵. Consider a more efficient approach.`;
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
        ? `<div class="lc-suggestion">${data.suggestion}</div>`
        : "";
    }
  }

  function updateErrorsUI(data) {
    const container = $("lc-analysis-errors");
    if (!container) return;

    const correct = data.correct || [];
    const edgeCases = data.edgeCases || [];
    const errors = data.errors || [];

    if (!correct.length && !edgeCases.length && !errors.length) {
      container.innerHTML = `<div class="lc-empty">No issues found. Write some code and click Analyze.</div>`;
      return;
    }

    let html = "";

    if (correct.length) {
      html += `<div class="lc-analysis-section lc-section-green">
        <div class="lc-analysis-section-label">What you got right</div>
        ${correct.map(c => `<div class="lc-analysis-item">${c}</div>`).join("")}
      </div>`;
    }

    if (edgeCases.length) {
      html += `<div class="lc-analysis-section lc-section-yellow">
        <div class="lc-analysis-section-label">Edge cases to consider</div>
        ${edgeCases.map(e => `<div class="lc-analysis-item">${e}</div>`).join("")}
      </div>`;
    }

    if (errors.length) {
      html += `<div class="lc-analysis-section lc-section-red">
        <div class="lc-analysis-section-label">Critical errors</div>
        ${errors.map(e => `
          <div class="lc-analysis-item">
            <div class="lc-error-title">${e.description}</div>
            <div class="lc-error-location">${e.location}</div>
            <div class="lc-error-fix">${e.fix}</div>
          </div>`).join("")}
      </div>`;
    }

    container.innerHTML = html;
  }

  // ── Struggle Detection ─────────────────────────────────────────────────────

  function checkStruggle() {
    const s = state.struggle;
    const alertEl = $("lc-struggle-alert");
    if (!alertEl || s.alerted) return;

    let msg = "";
    if (s.compileFailures >= 3) {
      msg = "Several failed runs detected. Hint 3 offers an optimization clue that may help.";
    } else if (s.rewriteCount >= 3) {
      msg = "You've rewritten this a few times. Starting with pseudocode (Hint 4) can help clarify the approach.";
    } else if (Date.now() - s.lastActivity > 5 * 60 * 1000) {
      msg = "Been a while. Stuck on an edge case? Hint 2 offers a data structure suggestion.";
    }

    if (msg) {
      alertEl.textContent = msg;
      alertEl.classList.add("visible");
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

  // ── Auto Complexity ────────────────────────────────────────────────────────

  function scheduleComplexityAnalysis(code, language) {
    clearTimeout(state.analysisDebounce);
    state.analysisDebounce = setTimeout(async () => {
      if (code === state.lastAnalyzedCode || code.trim().length < 30) return;
      state.lastAnalyzedCode = code;

      if (state.struggle.lastCodeSnapshot && code.length < state.struggle.lastCodeSnapshot.length * 0.5) {
        state.struggle.rewriteCount++;
        state.struggle.alerted = false;
        checkStruggle();
      }
      state.struggle.lastCodeSnapshot = code;

      try {
        const data = await send("ANALYZE_COMPLEXITY", { code, language, problemTitle: state.problem.title });
        state.complexity = data;
        updateComplexityUI(data);
        setStatus("Complexity updated", "success");
      } catch (_) { /* silent */ }
    }, 2500);
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  async function onGetHint() {
    const nextLevel = state.currentHintLevel + 1;
    if (nextLevel > 5) return;

    const btn = $("lc-next-hint-btn");
    if (btn) btn.disabled = true;

    if (state.hintCache[nextLevel]) {
      state.currentHintLevel = nextLevel;
      state.hintsUnlocked = Math.max(state.hintsUnlocked, nextLevel);
      updateHintUI();
      if (btn) btn.disabled = state.currentHintLevel >= 5;
      return;
    }

    setStatus("Generating hint…");
    $("lc-hint-box").innerHTML = `<div class="lc-hint-placeholder">Thinking…</div>`;

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
      state.struggle.alerted = false;
      updateHintUI();
      setStatus("Hint ready", "success");
    } catch (e) {
      $("lc-hint-box").innerHTML = `<div class="lc-error-inline">Error: ${e.message}</div>`;
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
        send("ANALYZE_COMPLEXITY", { code, language, problemTitle: state.problem.title }),
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

  function onHintLevelClick(level) {
    if (level > state.hintsUnlocked + 1) return;
    if (level > state.currentHintLevel && !state.hintCache[level]) {
      state.currentHintLevel = level - 1;
      onGetHint();
    } else {
      state.currentHintLevel = level;
      updateHintUI();
    }
  }

  // ── Event Binding ──────────────────────────────────────────────────────────

  function bindEvents() {
    const root = $("leetcoach-root");

    $("lc-toggle")?.addEventListener("click", () => root.classList.toggle("collapsed"));

    document.querySelectorAll(".lc-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".lc-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".lc-pane").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        $(`lc-pane-${tab.dataset.tab}`)?.classList.add("active");
      });
    });

    document.querySelectorAll(".lc-hint-btn").forEach(btn => {
      btn.addEventListener("click", () => onHintLevelClick(parseInt(btn.dataset.level)));
    });

    $("lc-next-hint-btn")?.addEventListener("click", onGetHint);
    $("lc-analyze-btn")?.addEventListener("click", onAnalyzeCode);

    // Copy button delegation (buttons injected dynamically into hint box)
    root.addEventListener("click", (e) => {
      const btn = e.target.closest(".lc-copy-btn");
      if (!btn) return;
      const targetId = btn.dataset.copyTarget;
      const pre = document.getElementById(targetId);
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent).then(() => {
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
      });
    });
  }

  function watchEditor() {
    const tryMonaco = () => {
      if (window.monaco) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          models[0].onDidChangeContent(() => {
            trackActivity();
            scheduleComplexityAnalysis(models[0].getValue(), getEditorLanguage());
          });
          return true;
        }
      }
      return false;
    };

    if (!tryMonaco()) {
      const editorEl = document.querySelector(".view-lines, .cm-content");
      if (editorEl) {
        new MutationObserver(() => {
          trackActivity();
          scheduleComplexityAnalysis(getEditorCode(), getEditorLanguage());
        }).observe(editorEl, { childList: true, subtree: true, characterData: true });
      } else {
        setTimeout(watchEditor, 2000);
      }
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function initForProblem() {
    const changed = parseProblem();
    if (!changed && state.pattern) return;

    state.pattern = null;
    state.currentHintLevel = 0;
    state.hintsUnlocked = 0;
    state.hintCache = {};
    state.struggle = { compileFailures: 0, lastCodeSnapshot: "", rewriteCount: 0, inactiveTimer: null, lastActivity: Date.now(), alerted: false };

    const nameEl = $("lc-problem-name");
    if (nameEl) nameEl.textContent = state.problem.title || "Unknown Problem";

    updatePatternBadge();
    updateHintUI();
    setStatus("Analyzing pattern…");

    try {
      const data = await send("ANALYZE_PROBLEM", {
        title: state.problem.title,
        content: state.problem.content,
        difficulty: state.problem.difficulty,
      });
      state.pattern = data;
      updatePatternBadge();
      setStatus(`Pattern: ${data.pattern}`, "success");
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

    let lastPath = location.pathname;
    new MutationObserver(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        if (location.pathname.includes("/problems/")) setTimeout(initForProblem, 1200);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
