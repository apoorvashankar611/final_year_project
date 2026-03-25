// ============================================================
// PhishShield Extension - background.js
// MODIFIED FOR:
// 1. Social Media Filtering
// 2. Improved Output
// 3. Right-click Image Scan Feature
// ============================================================

// Store information about each tab's state
const tabStates = new Map(); // { tabId: { domain: string, previousUrl: string } }
const MAX_HISTORY_ITEMS = 10; // Maximum number of scan history items to keep

// ============================================================
// REQUIREMENT 1: SOCIAL MEDIA PLATFORM FILTER
// Only URLs belonging to these domains will be analyzed.
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
];

// ============================================================
// EXTENSION INSTALL SETUP
// Creates right-click context menu for image scanning
// ============================================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "scanImage",
    title: "Scan this image",
    contexts: ["image"],
  });
});

/**
 * Checks whether a given URL belongs to a supported social media platform.
 * Matches both exact domains and subdomains.
 * @param {string} url - The full URL to check
 * @returns {boolean}
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
      aiSuspicion: result.aiSuspicion || false,
      timestamp: new Date().toLocaleString(),
      reported: false,
    });

    if (history.length > MAX_HISTORY_ITEMS) {
      history.pop();
    }

    chrome.storage.local.set({ scanHistory: history });
  });
}

/**
 * Injects a visual indicator into the active webpage tab.
 * @param {number} tabId
 * @param {string} url
 * @param {boolean} isPhishing
 * @param {boolean} isSamePage
 * @param {boolean} notSocialMedia
 * @param {boolean} aiSuspicion
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

  if (isPhishing) {
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
// ============================================================
async function checkForPhishing(url, tabId, isReload = false) {
  try {
    if (
      !url ||
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")
    ) {
      return;
    }

    const domain = getDomain(url);

    if (!isSocialMediaUrl(url)) {
      injectPopup(tabId, url, false, false, true, false);
      return { url, notSocialMedia: true };
    }

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

    const response = await fetch("http://127.0.0.1:8000/predict_url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);
    const data = await response.json();

    const isPhishing = data.prediction === 0;
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

// ============================================================
// IMAGE SCAN HANDLER - Right-click menu
// FIX: background service worker fetches the image directly
// using its own elevated permissions (host_permissions: <all_urls>)
// No canvas, no page-context fetch — avoids CORS entirely.
// ============================================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "scanImage") return;

  const srcUrl = info.srcUrl;
  if (!srcUrl) return;

  // Show "scanning" indicator immediately
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.getElementById("ai-scan-popup")?.remove();
      const popup = document.createElement("div");
      popup.id = "ai-scan-popup";
      popup.textContent = "⏳ Scanning image...";
      Object.assign(popup.style, {
        position: "fixed", top: "20px", right: "20px",
        backgroundColor: "#444", color: "#fff",
        padding: "12px 16px", borderRadius: "8px",
        zIndex: "2147483647", fontSize: "14px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        fontFamily: "Arial, sans-serif",
      });
      document.body.appendChild(popup);
    },
  });

  try {
    // The service worker fetches the image with its own elevated permissions.
    // host_permissions: ["<all_urls>"] in manifest.json allows this,
    // and service workers are not subject to CORS restrictions the same way pages are.
    const imageResponse = await fetch(srcUrl);
    if (!imageResponse.ok) throw new Error(`Could not fetch image (HTTP ${imageResponse.status})`);

    const blob = await imageResponse.blob();

    // Convert blob → base64 using FileReader inside an injected script,
    // then send back to background via message.
    // (Service workers don't have FileReader, but we can use a workaround with arrayBuffer)
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const binary = uint8Array.reduce((acc, byte) => acc + String.fromCharCode(byte), "");
    const base64 = `data:${blob.type || "image/jpeg"};base64,` + btoa(binary);

    // Send base64 image to backend
    const backendResponse = await fetch("http://127.0.0.1:8000/predict_image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: base64 }),
    });

    if (!backendResponse.ok) throw new Error(`Backend error (HTTP ${backendResponse.status})`);
    const data = await backendResponse.json();
    if (data.error) throw new Error(data.error);

    // Save to storage so popup panel can also display it
    chrome.storage.local.set({
      lastImageScan: {
        prediction: data.prediction,
        confidence: data.confidence,
        timestamp: new Date().toLocaleString(),
      },
    });

    // Inject result popup into page
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (result) => {
        document.getElementById("ai-scan-popup")?.remove();
        const isAI = result.prediction === "AI Generated";
        const popup = document.createElement("div");
        popup.id = "ai-scan-popup";
        popup.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:15px;">${isAI ? "🤖 AI Generated" : "✅ Real Image"}</strong>
            <button id="close-img-popup" style="background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:0 0 0 12px;">×</button>
          </div>
          <div style="font-size:13px;opacity:0.9;">Confidence: ${result.confidence}%</div>
        `;
        Object.assign(popup.style, {
          position: "fixed", top: "20px", right: "20px",
          backgroundColor: isAI ? "#e67e22" : "#27ae60",
          color: "#fff", padding: "14px 16px", borderRadius: "8px",
          zIndex: "2147483647", fontSize: "14px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
          fontFamily: "Arial, sans-serif", minWidth: "200px",
        });
        document.body.appendChild(popup);
        document.getElementById("close-img-popup")
          ?.addEventListener("click", () => popup.remove());
        setTimeout(() => popup.remove(), 8000);
      },
      args: [{ prediction: data.prediction, confidence: data.confidence }],
    });

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "📸 Image Scan Result",
      message: `${data.prediction} — Confidence: ${data.confidence}%`,
    });

  } catch (err) {
    console.error("Image scan error:", err);

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (msg) => {
        document.getElementById("ai-scan-popup")?.remove();
        const popup = document.createElement("div");
        popup.id = "ai-scan-popup";
        popup.textContent = "❌ Scan failed: " + msg;
        Object.assign(popup.style, {
          position: "fixed", top: "20px", right: "20px",
          backgroundColor: "#c0392b", color: "#fff",
          padding: "12px 16px", borderRadius: "8px",
          zIndex: "2147483647", fontSize: "14px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          fontFamily: "Arial, sans-serif",
        });
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 6000);
      },
      args: [err.message],
    });
  }
});

// Debounce helper
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
setInterval(() => {
  tabStates.clear();
}, 30 * 60 * 1000);

console.log(
  "PhishShield background script started — Social Media Filter + Image Scan active",
);
