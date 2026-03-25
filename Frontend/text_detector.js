// ============================================================
// PhishShield Extension — text_detector.js
// FIXED:
//   - Now calls port 8000 (merged FastAPI), NOT port 5000
//   - Added fetch timeout so "checking..." never hangs forever
//   - Fixed badge position on Instagram/Facebook dynamic layouts
//   - Cleaner error messages
// ============================================================

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────
  // ✅ FIXED: port changed from 5000 → 8000 (merged backend)
  const TEXT_API_URL    = "http://127.0.0.1:8000/predict-text";
  const MIN_TEXT_LENGTH = 20;
  const MAX_TEXT_LENGTH = 5000;
  const BADGE_LIFETIME_MS = 9000;
  const DEBOUNCE_MS     = 700;
  const FETCH_TIMEOUT_MS = 10000;   // 10 s max — prevents infinite "Checking…"
  // ──────────────────────────────────────────────────────────

  let debounceTimer    = null;
  let activeBadge      = null;
  let activeController = null;   // AbortController for in-flight request

  // ── Remove any stale badge left from a previous failed attempt ──
  document.querySelectorAll("#phishshield-text-badge").forEach(el => el.remove());

  // ── Mouseup listener (debounced) ─────────────────────────
  document.addEventListener("mouseup", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(handleTextSelection, DEBOUNCE_MS);
  });

  // ── Dismiss badge when user clicks elsewhere ──────────────
  document.addEventListener("mousedown", (e) => {
    if (activeBadge && !activeBadge.contains(e.target)) {
      removeBadge();
    }
  });

  // ── Main selection handler ────────────────────────────────
  async function handleTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const rawText = selection.toString().trim();
    if (rawText.length < MIN_TEXT_LENGTH) return;

    const text = rawText.slice(0, MAX_TEXT_LENGTH);

    // Cancel any previous in-flight request
    if (activeController) activeController.abort();
    activeController = new AbortController();

    // Capture rect NOW (selection clears after await)
    let capturedRect = null;
    try {
      capturedRect = selection.getRangeAt(0).getBoundingClientRect();
    } catch (_) {}

    removeBadge();
    showBadge("checking", null, capturedRect);

    // ── Fetch with timeout ──────────────────────────────────
    const timeoutId = setTimeout(() => activeController.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(TEXT_API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text }),
        signal:  activeController.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Server error ${response.status}`);

      const data = await response.json();

      if (data.error) {
        showBadge("error", { message: data.error }, capturedRect);
        return;
      }

      showBadge(data.result === "Phishing" ? "phishing" : "safe", data, capturedRect);

      // Notify background so popup Text Check tab updates
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

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        showBadge("error",
          { message: "Request timed out — is the backend running on port 8000?" },
          capturedRect
        );
      } else {
        showBadge("error",
          { message: "Cannot reach backend. Run: uvicorn app:app --port 8000" },
          capturedRect
        );
      }
    }
  }

  // ── Badge rendering ───────────────────────────────────────
  function showBadge(state, data, rect) {
    removeBadge();

    const badge = document.createElement("div");
    badge.id = "phishshield-text-badge";

    let icon, label, bgColor, borderColor, extraHTML = "";

    switch (state) {
      case "checking":
        icon = "⏳"; label = "Checking text…";
        bgColor = "#fff8e1"; borderColor = "#f9a825";
        break;

      case "phishing": {
        icon = "⚠️"; label = "Phishing Text Detected";
        bgColor = "#ffebee"; borderColor = "#e53935";
        const pct = data?.confidence != null
          ? `${Math.round(data.confidence * 100)}% phishing confidence`
          : "";
        if (pct) extraHTML = `<div style="font-size:11px;margin-top:3px;opacity:.8;">${pct}</div>`;
        break;
      }

      case "safe": {
        icon = "✅"; label = "Text Looks Safe";
        bgColor = "#e8f5e9"; borderColor = "#43a047";
        const pct = data?.confidence != null
          ? `${Math.round((1 - data.confidence) * 100)}% safe`
          : "";
        if (pct) extraHTML = `<div style="font-size:11px;margin-top:3px;opacity:.8;">${pct}</div>`;
        break;
      }

      default:
        icon = "❌"; label = "Analysis failed";
        bgColor = "#fff3e0"; borderColor = "#fb8c00";
        if (data?.message) {
          extraHTML = `<div style="font-size:11px;margin-top:3px;opacity:.8;">${escapeHtml(data.message)}</div>`;
        }
    }

    badge.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:15px;line-height:1.4;flex-shrink:0;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <strong style="font-size:13px;display:block;">${label}</strong>
          ${extraHTML}
        </div>
        <button id="ps-badge-close" title="Dismiss" style="
          flex-shrink:0;margin-left:4px;background:none;border:none;
          cursor:pointer;font-size:16px;line-height:1;
          color:inherit;padding:0;opacity:.6;
        ">×</button>
      </div>
    `;

    Object.assign(badge.style, {
      position:      "fixed",
      zIndex:        "2147483647",
      padding:       "10px 13px",
      borderRadius:  "8px",
      background:    bgColor,
      border:        `2px solid ${borderColor}`,
      boxShadow:     "0 4px 16px rgba(0,0,0,0.18)",
      fontFamily:    "system-ui, Arial, sans-serif",
      color:         "#1a1a1a",
      maxWidth:      "290px",
      minWidth:      "190px",
      userSelect:    "none",
      pointerEvents: "auto",
    });

    // Position below selected text (viewport coords, position:fixed)
    if (rect && rect.width > 0) {
      const top  = Math.min(rect.bottom + 8, window.innerHeight - 110);
      const left = Math.max(4, Math.min(rect.left, window.innerWidth - 300));
      badge.style.top  = `${top}px`;
      badge.style.left = `${left}px`;
    } else {
      badge.style.bottom = "24px";
      badge.style.right  = "24px";
    }

    document.body.appendChild(badge);
    activeBadge = badge;

    badge.querySelector("#ps-badge-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeBadge();
    });

    if (state !== "checking") {
      setTimeout(removeBadge, BADGE_LIFETIME_MS);
    }
  }

  function removeBadge() {
    if (activeBadge) { activeBadge.remove(); activeBadge = null; }
  }

  function escapeHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  console.log("[PhishShield] Text detector active →", window.location.hostname);
})();