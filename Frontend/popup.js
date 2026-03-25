// ============================================================
// PhishShield Extension — popup.js
// FIXED:
//   - Added 17 s client-side timeout on getCurrentStatus so
//     popup never freezes on "Scanning..." if backend is down
//   - All original URL display logic unchanged
//   - Text scan tab unchanged
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
  const resultDiv      = document.getElementById("result");
  const loadingDiv     = document.getElementById("loading");
  const historyDiv     = document.getElementById("history");
  const textResultCard = document.getElementById("text-result-card");
  const textHistoryDiv = document.getElementById("text-history");

  // ── Tab switcher ──────────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab)?.classList.add("active");
    });
  });

  // ══════════════════════════════════════════════════════════
  // URL CHECK — FIXED: timeout so "Scanning..." never sticks
  // ══════════════════════════════════════════════════════════
  loadingDiv.style.display = "block";

  // Safety net: if background.js takes > 17 s, show an error
  // instead of leaving the user staring at "Scanning..."
  const scanTimeout = setTimeout(() => {
    loadingDiv.style.display = "none";
    resultDiv.innerHTML = `
      <div class="error">
        ⏳ <strong>Scan is taking too long</strong><br>
        <small>The backend may be slow or unreachable on port 8000.<br>
        Make sure the backend is running:
        <code>uvicorn app:app --port 8000</code></small>
      </div>`;
  }, 17000);

  chrome.runtime.sendMessage({ action: "getCurrentStatus" }, (response) => {
    clearTimeout(scanTimeout);
    loadingDiv.style.display = "none";

    if (chrome.runtime.lastError) {
      resultDiv.innerHTML = `<div class="error">❌ Extension error: ${chrome.runtime.lastError.message}</div>`;
      return;
    }

    if (!response) {
      resultDiv.innerHTML = `<div class="error">❌ Could not retrieve status.</div>`;
      return;
    }

    if (response.error) {
      // Show a helpful error rather than a blank panel
      const isTimeout = response.error.toLowerCase().includes("timeout");
      resultDiv.innerHTML = `
        <div class="error">
          ${isTimeout ? "⏳" : "❌"} <strong>${isTimeout ? "Scan timed out" : "Error checking URL"}</strong><br>
          <small>${response.error}</small>
        </div>`;
      return;
    }

    if (response.notSocialMedia) {
      resultDiv.innerHTML = `
        <div class="not-social">
          🌐 <strong>Not a Social Media Website</strong><br>
          <small>Phishing analysis is not performed on this site.</small>
        </div>`;
      return;
    }

    if (response.isPhishing) {
      const aiNote = response.aiSuspicion
        ? `<br><small>🤖 AI-generated phishing URL suspected</small>` : "";
      resultDiv.innerHTML = `
        <div class="phishing">
          ⚠️ <strong>Phishing Website Detected</strong>${aiNote}<br>
          <small>${response.url}</small>
        </div>`;
    } else {
      resultDiv.innerHTML = `
        <div class="safe">
          ✅ <strong>Safe Social Media Website</strong><br>
          <small>${response.url}</small>
        </div>`;
    }
  });

  // ── URL history ───────────────────────────────────────────
  function loadHistory() {
    chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
      if (chrome.runtime.lastError || !history) return;
      historyDiv.innerHTML = "";
      history.forEach((entry) => {
        const el = document.createElement("div");
        let statusLabel, cssClass;
        if (entry.notSocialMedia)     { statusLabel = "🌐 Not Social Media"; cssClass = "not-social"; }
        else if (entry.isPhishing)    { statusLabel = entry.aiSuspicion ? "⚠️ Phishing (AI-suspected)" : "⚠️ Phishing Detected"; cssClass = "phishing"; }
        else                          { statusLabel = "✅ Safe"; cssClass = "safe"; }
        el.className = `history-entry ${cssClass}`;
        el.innerHTML = `
          <div>
            <strong>${statusLabel}</strong>
            <a href="https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(entry.url)}"
               target="_blank" class="report-link">Report</a>
          </div>
          <div class="url">${entry.url}</div>
          <div class="time">Scanned at: ${entry.timestamp}</div>`;
        historyDiv.appendChild(el);
      });
    });
  }

  loadHistory();
  setInterval(loadHistory, 5000);

  // ══════════════════════════════════════════════════════════
  // TEXT CHECK — unchanged
  // ══════════════════════════════════════════════════════════

  function renderTextResult(latest) {
    if (!textResultCard) return;
    if (!latest) {
      textResultCard.className = "text-idle";
      textResultCard.innerHTML = `
        No text scanned yet.<br>
        <small>Highlight text on any supported social media page to analyse it.</small>`;
      return;
    }
    const isPhishing = latest.prediction === 1;
    const confidence = latest.confidence ?? null;
    const preview    = latest.text ? escapeHtml(latest.text.slice(0, 80)) : "";
    const pct        = confidence !== null
      ? Math.round(isPhishing ? confidence * 100 : (1 - confidence) * 100) : null;
    const barColor   = isPhishing ? "#e53935" : "#43a047";
    const barWidth   = pct !== null ? `${pct}%` : "0%";

    textResultCard.className = isPhishing ? "text-phishing" : "text-safe";
    textResultCard.innerHTML = `
      <div>
        <strong>${isPhishing ? "⚠️ Phishing Text Detected" : "✅ Text Looks Safe"}</strong>
        ${pct !== null ? `<span style="float:right;font-size:12px;">${pct}%</span>` : ""}
      </div>
      ${pct !== null ? `
        <div class="confidence-bar-wrap">
          <div class="confidence-bar-fill" style="width:${barWidth};background:${barColor};"></div>
        </div>` : ""}
      ${preview ? `<div class="text-preview">"${preview}…"</div>` : ""}
      <div style="font-size:11px;color:#888;margin-top:4px;">${latest.timestamp || ""}</div>`;
  }

  function renderTextHistory(history) {
    if (!textHistoryDiv) return;
    textHistoryDiv.innerHTML = "";
    if (!history || history.length === 0) {
      textHistoryDiv.innerHTML = `<div style="color:#aaa;font-size:12px;padding:4px 0;">No text scans yet.</div>`;
      return;
    }
    history.forEach((entry) => {
      const isPhishing = entry.prediction === 1;
      const el = document.createElement("div");
      el.className = `text-history-entry ${isPhishing ? "text-phishing" : "text-safe"}`;
      el.innerHTML = `
        <div><strong>${isPhishing ? "⚠️ Phishing" : "✅ Safe"}</strong></div>
        <div class="th-preview">"${escapeHtml((entry.text || "").slice(0, 70))}…"</div>
        <div class="th-time">${entry.timestamp || ""}</div>`;
      textHistoryDiv.appendChild(el);
    });
  }

  function loadTextResults() {
    chrome.runtime.sendMessage({ action: "getLatestTextResult" }, (data) => {
      if (chrome.runtime.lastError || !data) return;
      renderTextResult(data.latest);
      renderTextHistory(data.history);
    });
  }

  loadTextResults();
  setInterval(loadTextResults, 3000);

  function escapeHtml(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
});