// ============================================================
// PhishShield Extension - popup.js
// MODIFIED FOR: Improved 3-state output (Requirement 4)
//   1. "Not a social media website"
//   2. "Safe social media website"
//   3. "Phishing website detected"
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
  const resultDiv = document.getElementById("result");
  const loadingDiv = document.getElementById("loading");
  const historyDiv = document.getElementById("history");

  // Show loading state while checking current tab
  loadingDiv.style.display = "block";

  // Request current tab status from background script
  chrome.runtime.sendMessage({ action: "getCurrentStatus" }, (response) => {
    loadingDiv.style.display = "none";

    if (!response) {
      resultDiv.innerHTML = `<div class="error">❌ Could not retrieve status.</div>`;
      return;
    }

    if (response?.error) {
      resultDiv.innerHTML = `
        <div class="error">
          ❌ Error checking URL<br>
          <small>${response.error}</small>
        </div>
      `;
      return;
    }

    // ----------------------------------------------------------
    // REQUIREMENT 4: THREE POSSIBLE OUTPUT STATES
    // ----------------------------------------------------------

    // STATE 1: Not a social media website — no analysis performed
    if (response.notSocialMedia) {
      resultDiv.innerHTML = `
        <div class="not-social">
          🌐 <strong>Not a Social Media Website</strong><br>
          <small>Phishing analysis is not performed on this site.</small>
        </div>
      `;
      return;
    }

    // STATE 2 / 3: Social media site — show phishing or safe result
    if (response.isPhishing) {
      // STATE 3: Phishing detected
      const aiNote = response.aiSuspicion
        ? `<br><small>🤖 AI-generated phishing URL suspected</small>`
        : "";

      resultDiv.innerHTML = `
        <div class="phishing">
          ⚠️ <strong>Phishing Website Detected</strong>${aiNote}<br>
          <small>${response.url}</small>
        </div>
      `;
    } else {
      // STATE 2: Safe social media site
      resultDiv.innerHTML = `
        <div class="safe">
          ✅ <strong>Safe Social Media Website</strong><br>
          <small>${response.url}</small>
        </div>
      `;
    }
  });

  // Load scan history from storage
  function loadHistory() {
    chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
      historyDiv.innerHTML = "";
      history.forEach((entry) => {
        const el = document.createElement("div");

        // History cards also reflect the 3-state logic
        let statusLabel, cssClass;
        if (entry.notSocialMedia) {
          statusLabel = "🌐 Not Social Media";
          cssClass = "not-social";
        } else if (entry.isPhishing) {
          statusLabel = entry.aiSuspicion
            ? "⚠️ Phishing (AI-suspected)"
            : "⚠️ Phishing Detected";
          cssClass = "phishing";
        } else {
          statusLabel = "✅ Safe";
          cssClass = "safe";
        }

        el.className = `history-entry ${cssClass}`;
        el.innerHTML = `
          <div>
            <strong>${statusLabel}</strong>
            <a href="https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(entry.url)}"
               target="_blank"
               class="report-link">Report</a>
          </div>
          <div class="url">${entry.url}</div>
          <div class="time">Scanned at: ${entry.timestamp}</div>
        `;
        historyDiv.appendChild(el);
      });
    });
  }

  // Initial load
  loadHistory();

  // Refresh history every 5 seconds
  setInterval(loadHistory, 5000);
});
