import { getState, subscribe, toggleEnabled, abortScan, resetScan } from '../state.js';

const STATUS_CONFIG = {
  idle:           { dot: 'status-idle',     label: 'idle' },
  passive_loaded: { dot: 'status-idle',     label: 'passive loaded' },
  scanning:       { dot: 'status-scanning', label: 'scanning' },
  done:           { dot: 'status-done',     label: 'done' },
  aborted:        { dot: 'status-aborted',  label: 'aborted' },
  disabled:       { dot: 'status-disabled', label: 'disabled' }
};

// SVG paths
const POWER_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>';
const STOP_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

export function initHeader() {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const powerBtn = document.getElementById('btn-power');
  const resetBtn = document.getElementById('btn-reset');
  
  function updateStatus(status) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
    dot.className = `status-dot ${config.dot}`;
    label.textContent = config.label;
    
    if (status === 'scanning') {
      powerBtn.innerHTML = STOP_SVG;
      powerBtn.title = 'Abort scan';
      powerBtn.setAttribute('aria-label', 'Abort scan');
      powerBtn.classList.remove('is-disabled');
    } else {
      powerBtn.innerHTML = POWER_SVG;
      if (status === 'disabled') {
        powerBtn.title = 'Extension is disabled (Click to enable)';
        powerBtn.setAttribute('aria-label', 'Extension is disabled (Click to enable)');
        powerBtn.classList.add('is-disabled');
      } else {
        powerBtn.title = 'Disable extension';
        powerBtn.setAttribute('aria-label', 'Disable extension');
        powerBtn.classList.remove('is-disabled');
      }
    }
  }
  
  // Subscribe to status changes
  subscribe('status', (status) => updateStatus(status));
  updateStatus(getState().status);
  
  // Power/abort click handler
  powerBtn?.addEventListener('click', async () => {
    const state = getState();
    if (state.status === 'scanning') {
      await abortScan();
    } else {
      await toggleEnabled();
    }
  });

  // Start Over / Reset click handler
  resetBtn?.addEventListener('click', async () => {
    resetBtn.classList.add('rotating');
    await resetScan();
    setTimeout(() => {
      resetBtn.classList.remove('rotating');
    }, 550);
  });

  // Close panel click handler (works in both Firefox sidebar and Chrome side panel)
  const closeBtn = document.getElementById('btn-close-panel');
  closeBtn?.addEventListener('click', async () => {
    try {
      if (browser.sidebarAction && typeof browser.sidebarAction.close === 'function') {
        await browser.sidebarAction.close();
        return;
      }
    } catch (e) {}
    try {
      if (browser.sidePanel && typeof browser.sidePanel.close === 'function') {
        await browser.sidePanel.close();
        return;
      }
    } catch (e) {}
    try {
      window.close();
    } catch (e) {}
  });
}
