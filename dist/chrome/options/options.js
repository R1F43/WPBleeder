/**
 * WPBleeder — Options Page Script
 * Reads/writes the same storage keys as the in-panel settings drawer.
 */
(function() {
  'use strict';
  const browser = globalThis.browser || globalThis.chrome;

  const apiKeyInput = document.getElementById('api-key');
  const concurrencyInput = document.getElementById('concurrency');
  const delayInput = document.getElementById('delay');
  const saveBtn = document.getElementById('btn-save');
  const statusEl = document.getElementById('status');

  // Load current settings on page open
  browser.storage.local.get({
    'settings:wpscanApiKey': '',
    'settings:concurrency': 5,
    'settings:delayMs': 200
  }).then(result => {
    apiKeyInput.value = result['settings:wpscanApiKey'];
    concurrencyInput.value = result['settings:concurrency'];
    delayInput.value = result['settings:delayMs'];
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const concurrency = Math.max(1, Math.min(20, parseInt(concurrencyInput.value, 10) || 5));
    const delay = Math.max(0, Math.min(5000, parseInt(delayInput.value, 10) || 200));

    await browser.storage.local.set({
      'settings:wpscanApiKey': apiKey,
      'settings:concurrency': concurrency,
      'settings:delayMs': delay
    });

    // Update inputs with clamped values
    concurrencyInput.value = concurrency;
    delayInput.value = delay;

    statusEl.textContent = 'Saved!';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });

  // Listen for external changes (from the in-panel drawer)
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['settings:wpscanApiKey']) {
      apiKeyInput.value = changes['settings:wpscanApiKey'].newValue || '';
    }
    if (changes['settings:concurrency']) {
      concurrencyInput.value = changes['settings:concurrency'].newValue;
    }
    if (changes['settings:delayMs']) {
      delayInput.value = changes['settings:delayMs'].newValue;
    }
  });
})();
