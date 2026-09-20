import { getState, subscribe, toggleCategory, startScan, abortScan } from '../state.js';

const CATEGORIES = [
  { id: 'paths', label: 'Paths' },
  { id: 'admin', label: 'Admin Portal' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'themes', label: 'Themes' },
  { id: 'users', label: 'Users' },
  { id: 'media', label: 'Media' },
  { id: 'xmlrpc', label: 'XML-RPC' },
  { id: 'findings', label: 'Findings' }
];

export function initChips() {
  const container = document.getElementById('scan-chips');
  const scanBtn = document.getElementById('btn-scan');
  const scanBtnLabel = document.getElementById('scan-btn-label');
  const stopBtn = document.getElementById('btn-stop');
  
  // Create chip elements
  CATEGORIES.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip selected';
    chip.dataset.category = cat.id;
    chip.textContent = cat.label;
    chip.addEventListener('click', () => {
      if (getState().status === 'scanning') return;
      toggleCategory(cat.id);
    });
    container.appendChild(chip);
  });
  
  // Update chip visual state and scan button label
  function updateChips() {
    const state = getState();
    const selected = state.selectedCategories;
    const isScanning = state.status === 'scanning';
    
    container.querySelectorAll('.chip').forEach(chip => {
      const cat = chip.dataset.category;
      if (selected.has(cat)) {
        chip.classList.add('selected');
      } else {
        chip.classList.remove('selected');
      }
      if (isScanning) {
        chip.classList.add('disabled');
      } else {
        chip.classList.remove('disabled');
      }
    });
    
    // Update scan button
    const count = selected.size;
    scanBtnLabel.textContent = `Start scan (${count} selected)`;
    scanBtn.disabled = count === 0 || !state.enabled || isScanning;
    
    if (isScanning) {
      scanBtnLabel.textContent = 'Scanning…';
    }

    // Update stop button
    if (stopBtn) {
      stopBtn.disabled = !isScanning;
      if (isScanning) {
        stopBtn.classList.add('active');
      } else {
        stopBtn.classList.remove('active');
      }
    }
  }
  
  subscribe('selectedCategories', updateChips);
  subscribe('status', updateChips);
  subscribe('enabled', updateChips);
  updateChips();
  
  // Scan button click
  scanBtn.addEventListener('click', async () => {
    const state = getState();
    if (state.status === 'scanning' || !state.enabled) return;
    await startScan();
  });

  // Stop button click
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      const state = getState();
      if (state.status !== 'scanning') return;
      stopBtn.disabled = true;
      stopBtn.classList.remove('active');
      await abortScan();
    });
  }
}
