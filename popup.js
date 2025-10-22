// Transient mapping of intended URLs for newly created tabs (used for display until they load)
const intendedUrlByTabId = new Map();

// Debounce helper to prevent excessive refresh calls during rapid tab changes
function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

let suppressAutoRefresh = false;
const debouncedRefresh = debounce(refreshUrls, 200);

function scheduleAutoRefresh() {
  if (!suppressAutoRefresh) debouncedRefresh();
}

async function getUrlsInCurrentWindow() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  tabs.sort((a, b) => a.index - b.index);

  // Prefer real URL; if about:blank, try pendingUrl or the intended URL we recorded on creation.
  const urls = tabs.map(t => {
    let u = t.url || '';
    if (!u || u === 'about:blank') {
      // pendingUrl may exist on some Firefox versions; harmless to read if absent
      const pending = t.pendingUrl;
      if (pending && pending !== 'about:blank') {
        u = pending;
      } else if (intendedUrlByTabId.has(t.id)) {
        u = intendedUrlByTabId.get(t.id);
      }
    }
    return u;
  }).filter(u => u !== '');

  return urls;
}

function fillTextarea(urls) {
  const ta = document.getElementById('urlList');
  ta.value = urls.join('\n');
  autosizeTextarea(ta);
}

function autosizeTextarea(ta) {
  const max = Math.floor(window.innerHeight * 0.7);
  ta.style.height = 'auto';
  const desired = Math.min(ta.scrollHeight, Math.max(120, max));
  ta.style.height = desired + 'px';
  ta.style.overflowY = (ta.scrollHeight > desired) ? 'auto' : 'hidden';
}

async function refreshUrls() {
  try {
    const urls = await getUrlsInCurrentWindow();
    fillTextarea(urls);
  } catch (err) {
    console.error('Failed to fetch tabs', err);
    const ta = document.getElementById('urlList');
    ta.value = `Error fetching URLs:\n${String(err)}`;
    autosizeTextarea(ta);
  }
}

async function copyToClipboard() {
  const ta = document.getElementById('urlList');
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  try {
    await navigator.clipboard.writeText(ta.value);
    toast('Copied to clipboard');
  } catch {
    document.execCommand('copy');
    toast('Copied to clipboard');
  } finally {
    ta.setSelectionRange(0, 0);
    ta.blur();
  }
}

// Wait for a set of tab IDs to "settle": either finish loading or switch from about:blank.
// Times out after timeoutMs per tab to avoid hanging.
function waitForTabsToSettle(tabIds, timeoutMs = 6000) {
  if (!tabIds || tabIds.length === 0) return Promise.resolve();

  const waits = tabIds.map(id => new Promise(resolve => {
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };

    const finishIfSettled = async () => {
      try {
        const tab = await browser.tabs.get(id);
        const url = tab.url || '';
        const settled = (url && url !== 'about:blank' && tab.status !== 'loading');
        if (settled) {
          cleanup();
          resolve();
        }
      } catch {
        // If tab is gone, consider it settled
        cleanup();
        resolve();
      }
    };

    const onUpdated = (tabId, changeInfo, tab) => {
      if (tabId !== id) return;
      // Resolve on URL change away from about:blank or when status becomes 'complete'
      if ((changeInfo.url && changeInfo.url !== 'about:blank') || changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const onRemoved = (tabId) => {
      if (tabId === id) {
        cleanup();
        resolve();
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    // Check current state in case it's already settled
    finishIfSettled();
  }));

  return Promise.all(waits);
}

async function applyListToWindow() {
  const applyBtn = document.getElementById('applyBtn');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying…';
  suppressAutoRefresh = true;

  try {
    const ta = document.getElementById('urlList');
    const desired = ta.value
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (desired.length === 0) {
      const confirmEmpty = confirm(
        'The list is empty. Applying will close all tabs in this window. Continue?'
      );
      if (!confirmEmpty) return;
    }

    // Current window
    const { id: windowId } = await browser.windows.getCurrent({ populate: false });

    let tabs = await browser.tabs.query({ currentWindow: true });
    tabs.sort((a, b) => a.index - b.index);

    // Group existing tabs by exact URL
    const buckets = new Map();
    for (const t of tabs) {
      const key = t.url || '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }

    // Build plan
    const plan = [];
    const consumedIds = new Set();
    for (const url of desired) {
      const q = buckets.get(url);
      if (q && q.length > 0) {
        const tab = q.shift();
        plan.push({ type: 'existing', tabId: tab.id, url });
        consumedIds.add(tab.id);
      } else {
        plan.push({ type: 'new', url });
      }
    }

    const toClose = tabs.filter(t => !consumedIds.has(t.id));

    // Quick estimate (for confirmation)
    const currentOrderExisting = tabs.filter(t => consumedIds.has(t.id)).map(t => t.id);
    const desiredOrderExisting = plan.filter(x => x.type === 'existing').map(x => x.tabId);
    let reorderCount = 0;
    const len = Math.min(currentOrderExisting.length, desiredOrderExisting.length);
    for (let i = 0; i < len; i++) {
      if (currentOrderExisting[i] !== desiredOrderExisting[i]) reorderCount++;
    }
    const openCount = plan.filter(x => x.type === 'new').length;
    const closeCount = toClose.length;

    const msg = `Apply changes to this window?\n\n` +
      `Open: ${openCount}\n` +
      `Close: ${closeCount}\n` +
      `Reorder (move without reload): ~${reorderCount}`;
    if (!confirm(msg)) return;

    // 1) Close extras
    if (toClose.length > 0) {
      await Promise.allSettled(toClose.map(t => browser.tabs.remove(t.id)));
    }

    // Refresh tabs after closes
    tabs = await browser.tabs.query({ currentWindow: true });
    tabs.sort((a, b) => a.index - b.index);

    // 2) Create missing tabs (track created IDs and intended URLs)
    const createdIds = [];
    for (let i = 0; i < plan.length; i++) {
      if (plan[i].type === 'new') {
        try {
          const targetUrl = plan[i].url;
          const created = await browser.tabs.create({
            windowId,
            url: targetUrl,
            active: false
          });
          plan[i] = { type: 'existing', tabId: created.id, url: targetUrl };
          createdIds.push(created.id);
          intendedUrlByTabId.set(created.id, targetUrl);
        } catch (e) {
          console.warn('Failed to create tab for URL:', plan[i].url, e);
          toast(`Could not open: ${plan[i].url}`);
          plan.splice(i, 1);
          i--;
        }
      }
    }

    // 3) Reorder to match plan (moves do not reload)
    const finalIds = plan.map(x => x.tabId);
    for (let i = 0; i < finalIds.length; i++) {
      try {
        await browser.tabs.move(finalIds[i], { index: i });
      } catch (e) {
        console.warn('Move failed for tab', finalIds[i], e);
      }
    }

    // 4) Wait for newly created tabs to settle so we don't display about:blank
    await waitForTabsToSettle(createdIds, 6000);

    // Done. Update once after stabilization.
    await refreshUrls();
    toast('Applied changes');
  } catch (err) {
    console.error('Apply failed', err);
    toast('Failed to apply changes (see console)');
  } finally {
    suppressAutoRefresh = false;
    applyBtn.disabled = false;
    applyBtn.textContent = 'Apply';
  }
}

let toastTimeout;
function toast(msg) {
  clearTimeout(toastTimeout);
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '8px',
      right: '8px',
      padding: '6px 10px',
      borderRadius: '6px',
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      fontSize: '12px',
      zIndex: 9999
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  toastTimeout = setTimeout(() => { el.style.opacity = '0'; }, 1400);
}

// Event: as soon as a tab navigates off about:blank, drop its intended mapping
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (intendedUrlByTabId.has(tabId)) {
    const real = tab?.url || changeInfo.url;
    if (real && real !== 'about:blank') {
      intendedUrlByTabId.delete(tabId);
    }
  }
});

// Auto-refresh: update textarea on tab changes (debounced)
browser.tabs.onCreated.addListener(scheduleAutoRefresh);
browser.tabs.onRemoved.addListener(scheduleAutoRefresh);
browser.tabs.onMoved.addListener(scheduleAutoRefresh);
browser.tabs.onAttached.addListener(scheduleAutoRefresh);
browser.tabs.onDetached.addListener(scheduleAutoRefresh);
browser.tabs.onReplaced.addListener(scheduleAutoRefresh);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Update on URL changes, load state changes, pin/discard/index/title changes
  if (
    changeInfo.url !== undefined ||
    changeInfo.status !== undefined ||
    changeInfo.pinned !== undefined ||
    changeInfo.discarded !== undefined ||
    changeInfo.index !== undefined ||
    changeInfo.title !== undefined
  ) {
    scheduleAutoRefresh();
  }
});

// UI wiring
document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
document.getElementById('applyBtn').addEventListener('click', applyListToWindow);

// Autosize as the user edits and when the popup resizes
const ta = document.getElementById('urlList');
ta.addEventListener('input', () => autosizeTextarea(ta));
window.addEventListener('resize', () => autosizeTextarea(ta));

// Initial populate
refreshUrls();
