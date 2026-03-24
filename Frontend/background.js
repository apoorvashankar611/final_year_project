// ============================================================
// PhishShield Extension - background.js
// MODIFIED FOR: Social Media Filtering (Req 1), Improved Output (Req 4)
// ============================================================

// Store information about each tab's state
const tabStates = new Map(); // { tabId: { domain: string, previousUrl: string } }
const MAX_HISTORY_ITEMS = 10; // Maximum number of scan history items to keep

// ============================================================
// REQUIREMENT 1: SOCIAL MEDIA PLATFORM FILTER
// Only URLs belonging to these domains will be analyzed.
// To add more platforms in the future, simply add them here.
// ============================================================
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
];

/**
 * Checks whether a given URL belongs to a supported social media platform.
 * Matches both exact domains and subdomains (e.g., m.facebook.com).
 * @param {string} url - The full URL to check
 * @returns {boolean} - true if it's a social media site
 */
function isSocialMediaUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return SOCIAL_MEDIA_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain),
    );
  } catch (e) {
    return false;
  }
}

// Get the domain name from a URL
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url;
  }
}

// Save the scan result to browser's local storage
function storeScanHistory(result) {
  chrome.storage.local.get(["scanHistory"], (res) => {
    const history = res.scanHistory || [];
    history.unshift({
      url: result.url,
      isPhishing: result.isPhishing,
      // NEW: store ai_generated_suspicion flag in history
      aiSuspicion: result.aiSuspicion || false,
      timestamp: new Date().toLocaleString(),
      reported: false,
    });

    // Keep only the last 10 items
    if (history.length > MAX_HISTORY_ITEMS) {
      history.pop();
    }

    chrome.storage.local.set({ scanHistory: history });
  });
}

// ============================================================
// REQUIREMENT 4: IMPROVED EXTENSION OUTPUT
// injectPopup now handles 4 states:
//   1. notSocialMedia  → "Not a social media website"
//   2. isPhishing      → "Phishing website detected"
//   3. isSamePage      → "Same Website" (unchanged UX)
//   4. safe            → "Safe social media website"
// ============================================================

/**
 * Injects a visual indicator into the active webpage tab.
 * @param {number} tabId
 * @param {string} url
 * @param {boolean} isPhishing
 * @param {boolean} isSamePage
 * @param {boolean} notSocialMedia - true when URL is not a social media site
 * @param {boolean} aiSuspicion    - true when AI-generated phishing is suspected
 */
function injectPopup(
  tabId,
  url,
  isPhishing,
  isSamePage = false,
  notSocialMedia = false,
  aiSuspicion = false,
) {
  const hostname = new URL(url).hostname;

  // ----------------------------------------------------------
  // STATE 1: NOT A SOCIAL MEDIA WEBSITE
  // ----------------------------------------------------------
  if (notSocialMedia) {
    const notSocialHTML = `
      <div id="not-social-indicator" style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: #607D8B;
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        z-index: 999999;
        font-family: Arial, sans-serif;
        max-width: 360px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        animation: fadeOut 7s forwards;
      ">
        <span style="font-size: 20px;">🌐</span>
        <div>
          <strong style="font-size: 14px;">Not a Social Media Website</strong>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">
            Phishing analysis is only performed on supported social media platforms.
          </p>
        </div>
        <button id="close-not-social-btn" style="
          background: none; border: none; color: white;
          font-size: 18px; cursor: pointer; margin-left: auto;
        ">×</button>
      </div>
      <style>
        @keyframes fadeOut {
          0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; }
        }
      </style>
    `;

    chrome.scripting.executeScript({
      target: { tabId },
      func: (html) => {
        [
          "phishing-warning-popup",
          "safe-url-indicator",
          "same-page-indicator",
          "not-social-indicator",
        ].forEach((id) => document.getElementById(id)?.remove());

        const el = document.createElement("div");
        el.innerHTML = html;
        document.body.appendChild(el);

        document
          .getElementById("close-not-social-btn")
          ?.addEventListener("click", () => el.remove());
        setTimeout(() => el.remove(), 7000);
      },
      args: [notSocialHTML],
    });
    return;
  }

  // ----------------------------------------------------------
  // STATE 2: PHISHING WEBSITE DETECTED
  // ----------------------------------------------------------
  if (isPhishing) {
    // Build an extra badge if AI-generated suspicion is flagged
    const aiBadge = aiSuspicion
      ? `<div style="
          background: rgba(255,255,255,0.2);
          border-radius: 4px;
          padding: 4px 8px;
          margin-top: 8px;
          font-size: 12px;
        ">🤖 AI-generated phishing URL suspected</div>`
      : "";

    const popupHTML = `
      <div id="phishing-warning-popup" style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        z-index: 999999;
        max-width: 400px;
        font-family: Arial, sans-serif;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center;">
            <span style="font-size: 24px; margin-right: 10px;">⚠️</span>
            <h3 style="margin: 0;">PHISHING WEBSITE DETECTED</h3>
          </div>
          <button id="close-popup-btn" style="
            background: none; border: none; color: white;
            font-size: 20px; cursor: pointer; padding: 0 5px;
          ">×</button>
        </div>
        <p style="margin: 10px 0;">
          The website "<strong>${hostname}</strong>" has been detected as a potential phishing site.
        </p>
        ${aiBadge}
        <div style="display: flex; gap: 10px; margin-top: 15px;">
          <button id="close-tab-btn" style="
            background: white; color: #ff4444; border: none;
            padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;
          ">Close Tab</button>
          <button id="report-btn" style="
            background: white; color: #ff4444; border: none;
            padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;
          ">Report</button>
        </div>
      </div>
    `;

    chrome.scripting.executeScript({
      target: { tabId },
      func: (html) => {
        document.getElementById("phishing-warning-popup")?.remove();
        const popup = document.createElement("div");
        popup.innerHTML = html;
        document.body.appendChild(popup);

        document
          .getElementById("close-popup-btn")
          ?.addEventListener("click", () => popup.remove());
        document
          .getElementById("close-tab-btn")
          ?.addEventListener("click", () => window.close());
        document.getElementById("report-btn")?.addEventListener("click", () => {
          window.open(
            "https://safebrowsing.google.com/safebrowsing/report_phish/?url=" +
              encodeURIComponent(window.location.href),
            "_blank",
          );
        });
      },
      args: [popupHTML],
    });

    // ----------------------------------------------------------
    // STATE 3: SAME PAGE NAVIGATION (unchanged)
    // ----------------------------------------------------------
  } else if (isSamePage) {
    const samePageHTML = `
      <div id="same-page-indicator" style="
        position: fixed; top: 20px; right: 20px;
        background: #2196F3; color: white;
        padding: 8px 12px; border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        z-index: 999999; font-family: Arial, sans-serif;
        display: flex; align-items: center; gap: 5px;
        animation: fadeOut 5s forwards;
      ">
        <span style="font-size: 16px;">🔄</span>
        <span style="font-size: 14px;">Same Website</span>
        <button id="close-samepage-btn" style="
          background: none; border: none; color: white;
          font-size: 16px; cursor: pointer; margin-left: 5px; padding: 0 5px;
        ">×</button>
      </div>
      <style>
        @keyframes fadeOut { 0% { opacity:1; } 80% { opacity:1; } 100% { opacity:0; } }
      </style>
    `;

    chrome.scripting.executeScript({
      target: { tabId },
      func: (html) => {
        [
          "phishing-warning-popup",
          "safe-url-indicator",
          "same-page-indicator",
        ].forEach((id) => document.getElementById(id)?.remove());

        const indicator = document.createElement("div");
        indicator.innerHTML = html;
        document.body.appendChild(indicator);

        document
          .getElementById("close-samepage-btn")
          ?.addEventListener("click", () => indicator.remove());
        setTimeout(() => indicator.remove(), 5000);
      },
      args: [samePageHTML],
    });

    // ----------------------------------------------------------
    // STATE 4: SAFE SOCIAL MEDIA WEBSITE
    // ----------------------------------------------------------
  } else {
    const tickHTML = `
      <div id="safe-url-indicator" style="
        position: fixed; top: 20px; right: 20px;
        background: #4CAF50; color: white;
        padding: 8px 12px; border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        z-index: 999999; font-family: Arial, sans-serif;
        display: flex; align-items: center; gap: 5px;
        animation: fadeOut 5s forwards;
      ">
        <span style="font-size: 16px;">✓</span>
        <span style="font-size: 14px;">Safe Social Media Website</span>
        <button id="report-safe-btn" style="
          background: none; border: none; color: white;
          font-size: 14px; cursor: pointer;
          margin-left: 5px; padding: 0 5px; text-decoration: underline;
        ">Report</button>
        <button id="close-tick-btn" style="
          background: none; border: none; color: white;
          font-size: 16px; cursor: pointer;
          margin-left: 5px; padding: 0 5px;
        ">×</button>
      </div>
      <style>
        @keyframes fadeOut { 0% { opacity:1; } 80% { opacity:1; } 100% { opacity:0; } }
      </style>
    `;

    chrome.scripting.executeScript({
      target: { tabId },
      func: (html) => {
        [
          "phishing-warning-popup",
          "safe-url-indicator",
          "same-page-indicator",
        ].forEach((id) => document.getElementById(id)?.remove());

        const tick = document.createElement("div");
        tick.innerHTML = html;
        document.body.appendChild(tick);

        document
          .getElementById("close-tick-btn")
          ?.addEventListener("click", () => tick.remove());
        document
          .getElementById("report-safe-btn")
          ?.addEventListener("click", () => {
            window.open(
              "https://safebrowsing.google.com/safebrowsing/report_phish/?url=" +
                encodeURIComponent(window.location.href),
              "_blank",
            );
          });
        setTimeout(() => tick.remove(), 5000);
      },
      args: [tickHTML],
    });
  }
}

// ============================================================
// MAIN PHISHING CHECK FUNCTION
// Now includes: social media gate + AI suspicion display
// ============================================================
async function checkForPhishing(url, tabId, isReload = false) {
  try {
    // Skip internal browser pages
    if (
      !url ||
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")
    ) {
      return;
    }

    const domain = getDomain(url);

    // ----------------------------------------------------------
    // REQUIREMENT 1: SOCIAL MEDIA FILTER
    // If the URL is not a social media platform, show the
    // "Not a social media website" message and stop here.
    // ----------------------------------------------------------
    if (!isSocialMediaUrl(url)) {
      injectPopup(tabId, url, false, false, true, false); // notSocialMedia = true
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
        isPhishing: false,
        aiSuspicion: false,
        timestamp: new Date().toLocaleString(),
      };
      storeScanHistory(result);
      injectPopup(tabId, url, false, false, false, false);
      return result;
    }

    // ===================================================
    // SAME DOMAIN CHECK LOGIC (unchanged from original)
    // ===================================================
    const history = await new Promise((resolve) => {
      chrome.storage.local.get(["scanHistory"], (res) => {
        resolve(res.scanHistory || []);
      });
    });

    if (history.length > 0) {
      const mostRecentDomain = getDomain(history[0].url);
      if (mostRecentDomain === domain) {
        if (isReload) {
          injectPopup(
            tabId,
            url,
            history[0].isPhishing,
            false,
            false,
            history[0].aiSuspicion || false,
          );
        }
        tabStates.set(tabId, { domain, previousUrl: url });
        return history[0];
      }
    }
    // ===================================================

    // Send URL to backend for ML-based phishing detection
    const response = await fetch("http://127.0.0.1:8000/predict_url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);
    const data = await response.json();

    // prediction === 0 means Phishing (matches original logic)
    const isPhishing = data.prediction === 0;

    // REQUIREMENT 2: Read the AI suspicion flag from backend response
    const aiSuspicion = data.ai_generated_suspicion === true;

    tabStates.set(tabId, { domain, previousUrl: url });

    const result = {
      url,
      isPhishing,
      aiSuspicion,
      timestamp: new Date().toLocaleString(),
    };

    storeScanHistory(result);
    injectPopup(tabId, url, isPhishing, false, false, aiSuspicion);

    return result;
  } catch (error) {
    console.error("Scan error:", error);
    return { error: error.message };
  }
}

// Debounce helper — limits how often we trigger checks on rapid navigations
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedCheck = debounce(checkForPhishing, 500);

// Watch for page navigations
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    const isReload = details.transitionType === "reload";
    debouncedCheck(details.url, details.tabId, isReload);
  }
});

// Watch for tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      debouncedCheck(tab.url, activeInfo.tabId, false);
    }
  });
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// Handle popup messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCurrentStatus") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const url = tabs[0].url;
      const result = await checkForPhishing(url, tabs[0].id, false);
      sendResponse(result);
    });
    return true;
  } else if (request.action === "getHistory") {
    chrome.storage.local.get(["scanHistory"], (res) => {
      sendResponse(res.scanHistory || []);
    });
    return true;
  }
});

// Cleanup tab states every 30 minutes
setInterval(
  () => {
    tabStates.clear();
  },
  30 * 60 * 1000,
);

// ============================================================
// NEW FEATURE: Highlighted Text Phishing Detection
// Listens for text selection on social media pages only
// ============================================================

// Inject the text selection listener into social media pages
function injectTextSelectionListener(tabId, url) {
  // Only run on social media pages
  if (!isSocialMediaUrl(url)) return;

  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Avoid injecting multiple times
      if (window.__phishShieldTextListenerActive) return;
      window.__phishShieldTextListenerActive = true;

      document.addEventListener("mouseup", () => {
        const selectedText = window.getSelection().toString().trim();

        // Only check if user selected more than 10 characters
        if (selectedText.length > 10) {
          // Send selected text to background script
          chrome.runtime.sendMessage({
            action: "checkSelectedText",
            text: selectedText,
          });
        }
      });
    },
  });
}

// Listen for text check requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkSelectedText") {
    // Send selected text to backend for analysis
    fetch("http://127.0.0.1:8000/predict_text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: request.text }),
    })
      .then((res) => res.json())
      .then((data) => {
        // Store result so popup can read it
        chrome.storage.local.set({
          lastTextScan: {
            text: request.text.substring(0, 100), // store first 100 chars
            result: data.result,
            isPhishing: data.is_phishing,
            matchedKeywords: data.matched_keywords || [],
            suspiciousPatterns: data.suspicious_patterns || [],
            timestamp: new Date().toLocaleString(),
          },
        });

        // Show inline badge on the page
        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          func: (result, isPhishing) => {
            // Remove existing text scan badge
            document.getElementById("text-scan-badge")?.remove();

            const badge = document.createElement("div");
            badge.id = "text-scan-badge";
            badge.style.cssText = `
              position: fixed;
              bottom: 20px;
              right: 20px;
              background: ${isPhishing ? "#ff4444" : "#4CAF50"};
              color: white;
              padding: 10px 16px;
              border-radius: 6px;
              box-shadow: 0 2px 6px rgba(0,0,0,0.2);
              z-index: 999999;
              font-family: Arial, sans-serif;
              font-size: 14px;
              max-width: 320px;
            `;
            badge.innerHTML = `
              ${isPhishing ? "⚠️" : "✅"}
              <strong>Selected Text:</strong>
              ${isPhishing ? "Phishing detected" : "Looks legitimate"}
              <button id="close-text-badge" style="
                background: none; border: none; color: white;
                font-size: 16px; cursor: pointer;
                margin-left: 8px; float: right;
              ">×</button>
            `;
            document.body.appendChild(badge);

            document
              .getElementById("close-text-badge")
              ?.addEventListener("click", () => badge.remove());

            // Auto remove after 6 seconds
            setTimeout(() => badge.remove(), 6000);
          },
          args: [data.result, data.is_phishing],
        });
      })
      .catch((err) => console.error("Text scan error:", err));

    return true;
  }
});

// Inject listener when page loads
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    setTimeout(() => {
      chrome.tabs.get(details.tabId, (tab) => {
        if (tab.url) injectTextSelectionListener(details.tabId, tab.url);
      });
    }, 1000);
  }
});

console.log(
  "PhishShield background script started — Social Media Filter active",
);
