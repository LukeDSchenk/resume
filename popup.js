async function getUrlsInCurrentWindow() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  tabs.sort((a, b) => a.index - b.index);
  const urls = tabs.map(t => t.url || "").filter(u => u !== "");
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

function saveToFile() {
  const content = document.getElementById('urlList').value;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `resume-${timestamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Saved .txt file');
}

async function applyListToWindow() {
  const applyBtn = document.getElementById('applyBtn');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying…';

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

    // Current window and tabs (fixed)
    const { id: windowId } = await browser.windows.getCurrent({ populate: false });

    let tabs = await browser.tabs.query({ currentWindow: true });
    tabs.sort((a, b) => a.index - b.index);

    const buckets = new Map(); // url -> array of tabs
    for (const t of tabs) {
      const key = t.url || '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }

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

    // 2) Create missing tabs
    for (let i = 0; i < plan.length; i++) {
      if (plan[i].type === 'new') {
        try {
          const created = await browser.tabs.create({
            windowId,
            url: plan[i].url,
            active: false
          });
          plan[i] = { type: 'existing', tabId: created.id, url: plan[i].url };
        } catch (e) {
          console.warn('Failed to create tab for URL:', plan[i].url, e);
          toast(`Could not open: ${plan[i].url}`);
          plan.splice(i, 1);
          i--;
        }
      }
    }

    // 3) Reorder to match plan
    const finalIds = plan.map(x => x.tabId);
    for (let i = 0; i < finalIds.length; i++) {
      try {
        await browser.tabs.move(finalIds[i], { index: i });
      } catch (e) {
        console.warn('Move failed for tab', finalIds[i], e);
      }
    }

    await refreshUrls();
    toast('Applied changes');
  } catch (err) {
    console.error('Apply failed', err);
    toast('Failed to apply changes (see console)');
  } finally {
    const applyBtn2 = document.getElementById('applyBtn');
    applyBtn2.disabled = false;
    applyBtn2.textContent = 'Apply';
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

document.getElementById('refreshBtn').addEventListener('click', refreshUrls);
document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
document.getElementById('saveBtn').addEventListener('click', saveToFile);
document.getElementById('applyBtn').addEventListener('click', applyListToWindow);

// Autosize as the user edits and when the popup resizes
const ta = document.getElementById('urlList');
ta.addEventListener('input', () => autosizeTextarea(ta));
window.addEventListener('resize', () => autosizeTextarea(ta));

// Populate on open
refreshUrls();
