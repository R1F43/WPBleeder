const browser = globalThis.browser || globalThis.chrome;

export function initSettingsDrawer() {
  const drawer = document.getElementById('settings-drawer');
  const settingsBtn = document.getElementById('btn-settings');
  let isOpen = false;
  
  settingsBtn.addEventListener('click', () => {
    isOpen = !isOpen;
    if (isOpen) {
      openDrawer();
    } else {
      closeDrawer();
    }
  });
  
  function openDrawer() {
    // Mount content
    drawer.innerHTML = `
      <div class="settings-content">
        <div class="settings-group">
          <label class="settings-label" for="api-key">WPScan API key</label>
          <div class="input-with-toggle">
            <input type="password" id="api-key" class="settings-input" placeholder="Enter API key" autocomplete="off">
            <button class="toggle-visibility" type="button" aria-label="Toggle visibility">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="settings-note">Stored locally in the browser (unencrypted). Don't reuse a key you can't afford to expose.</div>
        </div>
        <div class="settings-row">
          <div class="settings-group">
            <label class="settings-label" for="concurrency">Concurrency</label>
            <input type="number" id="concurrency" class="settings-input" min="1" max="20" value="5">
          </div>
          <div class="settings-group">
            <label class="settings-label" for="delay">Delay (ms)</label>
            <input type="number" id="delay" class="settings-input" min="0" max="5000" step="50" value="200">
          </div>
        </div>
        <button class="btn-save" id="btn-save-settings">Save</button>
      </div>
    `;
    
    // Load current values
    browser.storage.local.get({
      'settings:wpscanApiKey': '',
      'settings:concurrency': 5,
      'settings:delayMs': 200
    }).then(result => {
      const apiKeyInput = document.getElementById('api-key');
      const concurrencyInput = document.getElementById('concurrency');
      const delayInput = document.getElementById('delay');
      if (apiKeyInput) apiKeyInput.value = result['settings:wpscanApiKey'];
      if (concurrencyInput) concurrencyInput.value = result['settings:concurrency'];
      if (delayInput) delayInput.value = result['settings:delayMs'];
    });
    
    // Eye toggle
    const toggleBtn = drawer.querySelector('.toggle-visibility');
    const apiKeyInput = drawer.querySelector('#api-key');
    if (toggleBtn && apiKeyInput) {
      toggleBtn.addEventListener('click', () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        // Swap eye icon
        toggleBtn.innerHTML = isPassword 
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
      });
    }
    
    // Save button
    const saveBtn = drawer.querySelector('#btn-save-settings');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const apiKey = document.getElementById('api-key')?.value || '';
        const concurrency = parseInt(document.getElementById('concurrency')?.value, 10) || 5;
        const delay = parseInt(document.getElementById('delay')?.value, 10) || 200;
        
        await browser.storage.local.set({
          'settings:wpscanApiKey': apiKey,
          'settings:concurrency': Math.max(1, Math.min(20, concurrency)),
          'settings:delayMs': Math.max(0, Math.min(5000, delay))
        });
        
        saveBtn.textContent = 'Saved!';
        setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
      });
    }
    
    drawer.classList.add('open');
  }
  
  function closeDrawer() {
    drawer.classList.remove('open');
    // Unmount content after transition
    setTimeout(() => {
      if (!isOpen) drawer.innerHTML = '';
    }, 200);
  }
}
