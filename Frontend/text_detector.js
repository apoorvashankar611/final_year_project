// ================================================================
// PhishShield — text_detector.js  v2.0  "Universal"
// ================================================================
// STRATEGY:
//   Previous versions used document-level mouseup / selectionchange.
//   This FAILS on LinkedIn, Facebook, and other React sites because:
//     1. Rich-text editors consume mouseup before it bubbles
//     2. React synthetic events don't always reach document
//     3. selectionchange fires but getSelection() is already cleared
//        by the time the async handler runs on some platforms
//
//   v2.0 solution — THREE-LAYER detection:
//     Layer 1: document selectionchange  (works: Instagram, WhatsApp)
//     Layer 2: pointerup on capture phase (works: LinkedIn, Facebook)
//     Layer 3: Polling fallback every 400ms (catches everything else)
//
//   Additional fixes:
//     - Selection snapshotted immediately and synchronously
//     - Named handlers on window → safe re-injection on SPA nav
//     - One badge guaranteed via DOM ID sweep in removeBadge()
//     - Zero-rect fallback for WhatsApp virtualised list
//     - lastCheckedText dedup prevents API spam
// ================================================================

(function () {
  "use strict";

  // ── Re-injection guard (SPA navigation safe) ─────────────────
  // Remove old listeners if script re-runs (Instagram/Facebook SPA)
  if (window.__psActive) {
    document.removeEventListener("selectionchange", window.__psOnSelChange, true);
    document.removeEventListener("pointerup",       window.__psOnPointerUp, true);
    clearInterval(window.__psPollTimer);
  }
  window.__psActive = true;

  // ── Config ───────────────────────────────────────────────────
  const API_URL           = "http://127.0.0.1:8000/predict-text";
  const MIN_LEN           = 20;
  const MAX_LEN           = 5000;
  const BADGE_TTL_MS      = 9000;
  const DEBOUNCE_MS       = 500;
  const FETCH_TIMEOUT_MS  = 10000;
  const POLL_INTERVAL_MS  = 400;   // Layer 3 polling interval
  // ─────────────────────────────────────────────────────────────

  let debounceTimer    = null;
  let activeBadge      = null;
  let activeController = null;
  let lastCheckedText  = "";
  let lastPolledText   = "";

  // Sweep any stale badges left from a previous inject
  document.querySelectorAll("#ps-badge").forEach(el => el.remove());

  // ================================================================
  // LAYER 1 — selectionchange (Instagram, WhatsApp, Twitter/X)
  // ================================================================
  window.__psOnSelChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => tryDetect("selectionchange"), DEBOUNCE_MS);
  };
  document.addEventListener("selectionchange", window.__psOnSelChange, true);

  // ================================================================
  // LAYER 2 — pointerup with CAPTURE phase
  // ================================================================
  // Using capture (3rd arg = true) means we see the event BEFORE
  // React/LinkedIn's editor handles it. This is the key fix for
  // LinkedIn and Facebook where mouseup never reached document.
  window.__psOnPointerUp = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => tryDetect("pointerup"), DEBOUNCE_MS);
  };
  document.addEventListener("pointerup", window.__psOnPointerUp, true);

  // ================================================================
  // LAYER 3 — Polling fallback (catches sites that block all events)
  // ================================================================
  window.__psPollTimer = setInterval(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (text.length < MIN_LEN) return;
    if (text === lastPolledText) return;  // same selection, skip
    lastPolledText = text;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => tryDetect("poll"), DEBOUNCE_MS);
  }, POLL_INTERVAL_MS);

  // ── Dismiss badge on click outside ───────────────────────────
  document.addEventListener("pointerdown", (e) => {
    if (activeBadge && !activeBadge.contains(e.target)) removeBadge();
  }, true);

  // ================================================================
  // CORE: tryDetect — snapshot selection synchronously then go async
  // ================================================================
  function tryDetect(source) {
    // ── 1. Snapshot selection RIGHT NOW (sync) ──────────────────
    // On LinkedIn, by the time an async function runs, getSelection()
    // may already be cleared. We grab everything we need NOW.
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const rawText = sel.toString().trim();
    if (rawText.length < MIN_LEN) return;
    if (rawText === lastCheckedText) return;   // dedup

    // ── 2. Snapshot bounding rect NOW (sync) ────────────────────
    let rect = null;
    try {
      const range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
      // WhatsApp virtualised list fix: rect can be (0,0,0,0)
      if (!rect || rect.width === 0) {
        const rects = range.getClientRects();
        if (rects.length > 0) rect = rects[rects.length - 1];
      }
    } catch (_) {}

    // ── 3. Lock in this text — all async work uses this snapshot ─
    lastCheckedText  = rawText;
    lastPolledText   = rawText;   // sync poll too
    const text       = rawText.slice(0, MAX_LEN);

    // Cancel any previous in-flight request
    if (activeController) activeController.abort();
    activeController = new AbortController();

    removeBadge();
    showBadge("checking", null, rect);

    // ── 4. Fire API (async from here) ───────────────────────────
    callAPI(text, rect, activeController);
  }

  // ================================================================
  // API call
  // ================================================================
  async function callAPI(text, rect, controller) {
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text }),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (data.error) {
        showBadge("error", { message: data.error }, rect);
        return;
      }

      showBadge(data.result === "Phishing" ? "phishing" : "safe", data, rect);

      // Notify popup
      try {
        chrome.runtime.sendMessage({
          action: "textScanResult",
          result: {
            text:       text.slice(0, 120),
            prediction: data.prediction,
            result:     data.result,
            confidence: data.confidence,
            timestamp:  new Date().toLocaleString(),
            url:        window.location.href,
          },
        });
      } catch (_) {}

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        showBadge("error",
          { message: "Timed out — is backend running on port 8000?" }, rect);
      } else {
        showBadge("error",
          { message: "Cannot reach backend. Run: uvicorn app:app --port 8000" }, rect);
      }
    }
  }

  // ================================================================
  // Badge UI
  // ================================================================
  function showBadge(state, data, rect) {
    removeBadge();

    const badge = document.createElement("div");
    badge.id = "ps-badge";

    let icon, label, bg, border, extra = "";

    switch (state) {
      case "checking":
        icon = "⏳"; label = "Checking text…";
        bg = "#fff8e1"; border = "#f9a825";
        break;

      case "phishing": {
        icon = "⚠️"; label = "Phishing Text Detected";
        bg = "#ffebee"; border = "#e53935";
        const pct = data?.confidence != null
          ? `${Math.round(data.confidence * 100)}% phishing confidence` : "";
        if (pct) extra =
          `<div style="font-size:11px;margin-top:3px;opacity:.8;">${pct}</div>`;
        break;
      }

      case "safe": {
        icon = "✅"; label = "Text Looks Safe";
        bg = "#e8f5e9"; border = "#43a047";
        const pct = data?.confidence != null
          ? `${Math.round((1 - data.confidence) * 100)}% safe` : "";
        if (pct) extra =
          `<div style="font-size:11px;margin-top:3px;opacity:.8;">${pct}</div>`;
        break;
      }

      default:
        icon = "❌"; label = "Analysis failed";
        bg = "#fff3e0"; border = "#fb8c00";
        if (data?.message) extra =
          `<div style="font-size:11px;margin-top:3px;opacity:.8;">${esc(data.message)}</div>`;
    }

    badge.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:15px;line-height:1.4;flex-shrink:0;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <strong style="font-size:13px;display:block;">${label}</strong>
          ${extra}
        </div>
        <button data-ps-close title="Dismiss"
          style="flex-shrink:0;margin-left:4px;background:none;border:none;
                 cursor:pointer;font-size:16px;line-height:1;
                 color:inherit;padding:0;opacity:.6;">×</button>
      </div>`;

    Object.assign(badge.style, {
      position:      "fixed",
      zIndex:        "2147483647",
      padding:       "10px 14px",
      borderRadius:  "10px",
      background:    bg,
      border:        `2px solid ${border}`,
      boxShadow:     "0 4px 20px rgba(0,0,0,0.22)",
      fontFamily:    "system-ui, Arial, sans-serif",
      color:         "#1a1a1a",
      maxWidth:      "300px",
      minWidth:      "200px",
      userSelect:    "none",
      pointerEvents: "auto",
      transition:    "opacity .2s",
    });

    // Position: below selection if rect is valid, else bottom-right
    const valid = rect && rect.width > 0 && rect.height > 0;
    if (valid) {
      badge.style.top  = `${Math.min(rect.bottom + 10, window.innerHeight - 120)}px`;
      badge.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 315))}px`;
    } else {
      badge.style.bottom = "28px";
      badge.style.right  = "28px";
    }

    document.body.appendChild(badge);
    activeBadge = badge;

    badge.querySelector("[data-ps-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeBadge();
    });

    if (state !== "checking") setTimeout(removeBadge, BADGE_TTL_MS);
  }

  function removeBadge() {
    document.querySelectorAll("#ps-badge").forEach(el => el.remove());
    activeBadge = null;
  }

  function esc(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  console.log("[PhishShield] text_detector v2.0 (universal) →", window.location.hostname);
})();