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
  // Grow the textarea to fit content, up to 70% of popup viewport height
  const max = Math.floor(window.innerHeight * 0.7);
  ta.style.height = 'auto'; // reset to measure true scrollHeight
  const desired = Math.min(ta.scrollHeight, Math.max(120, max));
  ta.style.height = desired + 'px';

  // Only show scrollbar if content exceeds our cap
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
  toastTimeout = setTimeout(() => { el.style.opacity = '0'; }, 1200);
}

document.getElementById('refreshBtn').addEventListener('click', refreshUrls);
document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
document.getElementById('saveBtn').addEventListener('click', saveToFile);

// Autosize as the user edits and when the popup resizes
const ta = document.getElementById('urlList');
ta.addEventListener('input', () => autosizeTextarea(ta));
window.addEventListener('resize', () => autosizeTextarea(ta));

// Populate on open and size once content is set
refreshUrls();
