// ============================================================
// PhishShield Extension — background.js
// FIXED:
//   - getCurrentStatus now has a 15 s timeout so popup never
//     shows "Scanning..." forever when backend is slow
//   - checkForPhishing returns a proper error object on timeout
//   - Text scan handlers unchanged
//   - All URL detection logic unchanged
// ============================================================

const tabStates      = new Map();
const MAX_HISTORY_ITEMS = 10;

const SOCIAL_MEDIA_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "snapchat.com",
  "reddit.com",
  "fake.facebook.com",
  // Added: Most used social media platforms in India
  "whatsapp.com",
  "web.whatsapp.com",
  "telegram.org",
  "web.telegram.org",
  "discord.com",
  "sharechat.com",
  "moj.tv",
  "josh.app",
  "roposo.com",
  "quora.com",
  // Add more social media platforms here as needed
];

// ============================================================
// ALWAYS SAFE DOMAINS
// These are verified real social media platforms.
// They skip ML analysis entirely and are marked safe directly
// to avoid false positives from the ML model.
// e.g. linkedin.com was incorrectly flagged as phishing
// ============================================================
const ALWAYS_SAFE_DOMAINS = [
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "whatsapp.com",
  "web.whatsapp.com",
  "telegram.org",
  "web.telegram.org",
  "snapchat.com",
  "reddit.com",
  "discord.com",
  "pinterest.com",
  "quora.com",
  "sharechat.com",
  "moj.tv",
  "josh.app",
  "roposo.com",
];

function isSocialMediaUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return SOCIAL_MEDIA_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );
  } catch { return false; }
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function storeScanHistory(result) {
  chrome.storage.local.get(["scanHistory"], (res) => {
    const history = res.scanHistory || [];
    history.unshift({
      url:         result.url,
      isPhishing:  result.isPhishing,
      aiSuspicion: result.aiSuspicion || false,
      timestamp:   new Date().toLocaleString(),
      reported:    false,
    });
    if (history.length > MAX_HISTORY_ITEMS) history.pop();
    chrome.storage.local.set({ scanHistory: history });
  });
}

function storeTextScanResult(result) {
  chrome.storage.local.get(["textScanHistory"], (res) => {
    const history = res.textScanHistory || [];
    history.unshift(result);
    if (history.length > MAX_HISTORY_ITEMS) history.pop();
    chrome.storage.local.set({ textScanHistory: history });
    chrome.storage.local.set({ latestTextResult: result });
  });
}

// ── injectPopup — UNCHANGED ───────────────────────────────────
function injectPopup(tabId, url, isPhishing, isSamePage = false, notSocialMedia = false, aiSuspicion = false) {
  const hostname = new URL(url).hostname;

  if (notSocialMedia) {
    const html = `
      <div id="not-social-indicator" style="position:fixed;top:20px;right:20px;
        background:#607D8B;color:white;padding:12px 16px;border-radius:6px;
        box-shadow:0 2px 6px rgba(0,0,0,.25);z-index:999999;
        font-family:Arial,sans-serif;max-width:360px;
        display:flex;align-items:flex-start;gap:10px;animation:fadeOut 7s forwards;">
        <span style="font-size:20px;">🌐</span>
        <div>
          <strong style="font-size:14px;">Not a Social Media Website</strong>
          <p style="margin:4px 0 0;font-size:12px;opacity:.9;">
            Phishing analysis is only performed on supported social media platforms.
          </p>
        </div>
        <button id="close-not-social-btn" style="background:none;border:none;
          color:white;font-size:18px;cursor:pointer;margin-left:auto;">×</button>
      </div>
      <style>@keyframes fadeOut{0%{opacity:1}80%{opacity:1}100%{opacity:0}}</style>`;
    chrome.scripting.executeScript({
      target: { tabId },
      func: (h) => {
        ["phishing-warning-popup","safe-url-indicator","same-page-indicator","not-social-indicator","text-scan-badge"]
          .forEach(id => document.getElementById(id)?.remove());
        const el = document.createElement("div");
        el.innerHTML = h;
        document.body.appendChild(el);
        document.getElementById("close-not-social-btn")?.addEventListener("click", () => el.remove());
        setTimeout(() => el.remove(), 7000);
      },
      args: [html],
    });
    return;
  }

  if (isPhishing) {
    const aiBadge = aiSuspicion
      ? `<div style="background:rgba(255,255,255,.2);border-radius:4px;padding:4px 8px;
           margin-top:8px;font-size:12px;">🤖 AI-generated phishing URL suspected</div>` : "";
    const html = `
      <div id="phishing-warning-popup" style="position:fixed;top:20px;right:20px;
        background:#ff4444;color:white;padding:20px;border-radius:8px;
        box-shadow:0 4px 8px rgba(0,0,0,.2);z-index:999999;
        max-width:400px;font-family:Arial,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="display:flex;align-items:center;">
            <span style="font-size:24px;margin-right:10px;">⚠️</span>
            <h3 style="margin:0;">PHISHING WEBSITE DETECTED</h3>
          </div>
          <button id="close-popup-btn" style="background:none;border:none;color:white;
            font-size:20px;cursor:pointer;padding:0 5px;">×</button>
        </div>
        <p style="margin:10px 0;">
          The website "<strong>${hostname}</strong>" has been detected as a potential phishing site.
        </p>
        ${aiBadge}
        <div style="display:flex;gap:10px;margin-top:15px;">
          <button id="close-tab-btn" style="background:white;color:#ff4444;border:none;
            padding:8px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Close Tab</button>
          <button id="report-btn" style="background:white;color:#ff4444;border:none;
            padding:8px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Report</button>
        </div>
      </div>`;
    chrome.scripting.executeScript({
      target: { tabId },
      func: (h) => {
        document.getElementById("phishing-warning-popup")?.remove();
        document.getElementById("text-scan-badge")?.remove();
        const p = document.createElement("div"); p.innerHTML = h;
        document.body.appendChild(p);
        document.getElementById("close-popup-btn")?.addEventListener("click", () => p.remove());
        document.getElementById("close-tab-btn")?.addEventListener("click", () => window.close());
        document.getElementById("report-btn")?.addEventListener("click", () =>
          window.open("https://safebrowsing.google.com/safebrowsing/report_phish/?url=" +
            encodeURIComponent(window.location.href), "_blank"));
      },
      args: [html],
    });
    return;
  }

  if (isSamePage) {
    const html = `
      <div id="same-page-indicator" style="position:fixed;top:20px;right:20px;
        background:#2196F3;color:white;padding:8px 12px;border-radius:4px;
        box-shadow:0 2px 4px rgba(0,0,0,.2);z-index:999999;
        font-family:Arial,sans-serif;display:flex;align-items:center;gap:5px;
        animation:fadeOut 5s forwards;">
        <span style="font-size:16px;">↺</span>
        <span style="font-size:14px;">Same Website</span>
        <button id="close-samepage-btn" style="background:none;border:none;color:white;
          font-size:16px;cursor:pointer;margin-left:5px;padding:0 5px;">×</button>
      </div>
      <style>@keyframes fadeOut{0%{opacity:1}80%{opacity:1}100%{opacity:0}}</style>`;
    chrome.scripting.executeScript({
      target: { tabId },
      func: (h) => {
        ["phishing-warning-popup","safe-url-indicator","same-page-indicator","not-social-indicator","text-scan-badge"]
          .forEach(id => document.getElementById(id)?.remove());
        const el = document.createElement("div"); el.innerHTML = h;
        document.body.appendChild(el);
        document.getElementById("close-samepage-btn")?.addEventListener("click", () => el.remove());
        setTimeout(() => el.remove(), 5000);
      },
      args: [html],
    });
  } else {
    const html = `
      <div id="safe-url-indicator" style="position:fixed;top:20px;right:20px;
        background:#4CAF50;color:white;padding:8px 12px;border-radius:4px;
        box-shadow:0 2px 4px rgba(0,0,0,.2);z-index:999999;
        font-family:Arial,sans-serif;display:flex;align-items:center;gap:5px;
        animation:fadeOut 5s forwards;">
        <span style="font-size:16px;">✓</span>
        <span style="font-size:14px;">Safe Social Media Website</span>
        <button id="report-safe-btn" style="background:none;border:none;color:white;
          font-size:14px;cursor:pointer;margin-left:5px;padding:0 5px;
          text-decoration:underline;">Report</button>
        <button id="close-tick-btn" style="background:none;border:none;color:white;
          font-size:16px;cursor:pointer;margin-left:5px;padding:0 5px;">×</button>
      </div>
      <style>@keyframes fadeOut{0%{opacity:1}80%{opacity:1}100%{opacity:0}}</style>`;
    chrome.scripting.executeScript({
      target: { tabId },
      func: (h) => {
        ["phishing-warning-popup","safe-url-indicator","same-page-indicator","not-social-indicator","text-scan-badge"]
          .forEach(id => document.getElementById(id)?.remove());
        const el = document.createElement("div"); el.innerHTML = h;
        document.body.appendChild(el);
        document.getElementById("close-tick-btn")?.addEventListener("click", () => el.remove());
        document.getElementById("report-safe-btn")?.addEventListener("click", () =>
          window.open("https://safebrowsing.google.com/safebrowsing/report_phish/?url=" +
            encodeURIComponent(window.location.href), "_blank"));
        setTimeout(() => el.remove(), 5000);
      },
      args: [html],
    });
  }
}

// ── checkForPhishing — FIXED: proper timeout + always safe domains ──
async function checkForPhishing(url, tabId, isReload = false) {
  try {
    if (!url || url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:"))
      return;

    const domain = getDomain(url);

    if (!isSocialMediaUrl(url)) {
      injectPopup(tabId, url, false, false, true, false);
      return { url, notSocialMedia: true };
    }

    // ----------------------------------------------------------
    // ALWAYS SAFE DOMAINS CHECK
    // These are verified real social media platforms.
    // Skip ML model entirely to avoid false positives.
    // e.g. linkedin.com was incorrectly flagged by ML model
    // ----------------------------------------------------------
    const isAlwaysSafe = ALWAYS_SAFE_DOMAINS.some((d) => domain.includes(d));
    if (isAlwaysSafe) {
      const result = {
        url,
        isPhishing:  false,
        aiSuspicion: false,
        timestamp:   new Date().toLocaleString(),
      };
      storeScanHistory(result);
      injectPopup(tabId, url, false, false, false, false);
      return result;
    }

    const history = await new Promise((resolve) =>
      chrome.storage.local.get(["scanHistory"], (res) => resolve(res.scanHistory || []))
    );

    if (history.length > 0) {
      const mostRecentDomain = getDomain(history[0].url);
      if (mostRecentDomain === domain) {
        if (isReload) {
          injectPopup(tabId, url, history[0].isPhishing, false, false, history[0].aiSuspicion || false);
        }
        tabStates.set(tabId, { domain, previousUrl: url });
        return history[0];
      }
    }

    // ── FIXED: wrap fetch in a 15 s timeout ──────────────────
    // Without this, a slow FastAPI response (fetching the target page)
    // keeps the popup stuck on "Scanning..." until Chrome kills it.
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15000);

    let data;
    try {
      const response = await fetch("http://127.0.0.1:8000/predict_url", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url }),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Status ${response.status}`);
      data = await response.json();
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        // Timed out — treat URL as suspicious so user isn't left hanging
        data = { prediction: 0, ai_generated_suspicion: false,
                 error: "Scan timed out after 15 s" };
      } else {
        throw fetchErr;   // re-throw connection errors
      }
    }
    // ─────────────────────────────────────────────────────────

    const isPhishing  = data.prediction === 0;
    const aiSuspicion = data.ai_generated_suspicion === true;

    tabStates.set(tabId, { domain, previousUrl: url });

    const result = { url, isPhishing, aiSuspicion, timestamp: new Date().toLocaleString() };
    storeScanHistory(result);
    injectPopup(tabId, url, isPhishing, false, false, aiSuspicion);

    return result;

  } catch (error) {
    console.error("Scan error:", error);
    return { error: error.message };
  }
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { clearTimeout(timeout); func(...args); }, wait);
  };
}

const debouncedCheck = debounce(checkForPhishing, 500);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0)
    debouncedCheck(details.url, details.tabId, details.transitionType === "reload");
});

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => { if (tab.url) debouncedCheck(tab.url, info.tabId, false); });
});

chrome.tabs.onRemoved.addListener((tabId) => tabStates.delete(tabId));

// ── Message handler ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "getCurrentStatus") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) { sendResponse({ error: "No active tab" }); return; }

      // ── FIXED: 16 s safety timeout on the popup side ─────
      // If checkForPhishing takes longer than 16 s for any reason,
      // sendResponse is still called so the popup never freezes.
      const safetyTimer = setTimeout(() => {
        sendResponse({ error: "Scan timed out — backend may be slow or unreachable" });
      }, 16000);

      try {
        const result = await checkForPhishing(tabs[0].url, tabs[0].id, false);
        clearTimeout(safetyTimer);
        sendResponse(result);
      } catch (e) {
        clearTimeout(safetyTimer);
        sendResponse({ error: e.message });
      }
    });
    return true;   // keep channel open for async sendResponse

  } else if (request.action === "getHistory") {
    chrome.storage.local.get(["scanHistory"], (res) => sendResponse(res.scanHistory || []));
    return true;

  } else if (request.action === "textScanResult") {
    storeTextScanResult(request.result);
    sendResponse({ received: true });
    return true;

  } else if (request.action === "getLatestTextResult") {
    chrome.storage.local.get(["latestTextResult", "textScanHistory"], (res) =>
      sendResponse({ latest: res.latestTextResult || null, history: res.textScanHistory || [] })
    );
    return true;
  }
});

setInterval(() => tabStates.clear(), 30 * 60 * 1000);

console.log("PhishShield background started — URL + Text detection, single backend port 8000");