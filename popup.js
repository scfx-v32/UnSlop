document.addEventListener('DOMContentLoaded', () => {
  const limitInput = document.getElementById('limit');
  const toggleBtn = document.getElementById('toggle-unslop');
  const toggleSwitch = document.querySelector('.toggle-switch');
  const refreshBtn = document.getElementById('refresh');
  const manageWlBtn = document.getElementById('manage-wl');

  // Load saved settings (feedLimit, mode, frequency, weekday)
    chrome.storage.local.get(['feedLimit', 'unslopMode', 'frequency', 'weekday'], (data) => {
      if (limitInput && data.feedLimit) limitInput.value = data.feedLimit;

      // Update toggle state safely
      const isEnabled = data.unslopMode !== false;
      if (toggleSwitch) {
        if (isEnabled) toggleSwitch.classList.add('active');
        else toggleSwitch.classList.remove('active');
      }
      if (toggleBtn) {
        const span = toggleBtn.querySelector('span');
        if (span) span.textContent = isEnabled ? 'UnSlop Enabled' : 'UnSlop Disabled';
      }

      // Frequency
      const freqInput = document.getElementById('frequency');
      const weekdayRow = document.getElementById('weekday-row');
      const weekdaySelect = document.getElementById('weekday');
      if (freqInput && data.frequency) freqInput.value = data.frequency;
      if (weekdaySelect && typeof data.weekday !== 'undefined') weekdaySelect.value = data.weekday;
      if (weekdayRow) weekdayRow.style.display = (data.frequency === 'weekly') ? 'block' : 'none';
    });

  // Save feed limit on change
  if (limitInput) {
    limitInput.addEventListener('change', () => {
      chrome.storage.local.set({ feedLimit: parseInt(limitInput.value) });
    });
  }

    // Frequency handling
    const freqInput = document.getElementById('frequency');
    const weekdayRow = document.getElementById('weekday-row');
    const weekdaySelect = document.getElementById('weekday');
    if (freqInput) {
      freqInput.addEventListener('change', () => {
        const val = freqInput.value;
        chrome.storage.local.set({ frequency: val });
        if (weekdayRow) weekdayRow.style.display = (val === 'weekly') ? 'block' : 'none';
      });
    }
    if (weekdaySelect) {
      weekdaySelect.addEventListener('change', () => {
        chrome.storage.local.set({ weekday: weekdaySelect.value });
      });
    }

  // Toggle UnSlop on/off
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      chrome.storage.local.get(['unslopMode'], (data) => {
        const currentState = data.unslopMode !== false;
        const newState = !currentState;

        // If turning on, clear userDisabled. If turning off, mark userDisabled so modal won't auto-appear.
        chrome.storage.local.set({ unslopMode: newState, userDisabled: !newState }, () => {
          if (toggleSwitch) toggleSwitch.classList.toggle('active');
          const span = toggleBtn.querySelector('span');
          if (span) span.textContent = newState ? 'UnSlop Enabled' : 'UnSlop Disabled';

          // Reload YouTube tab
          chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.reload(tabs[0].id);
            }
          });
        });
      });
    });
  }

  // Refresh Feed button
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.reload(tabs[0].id);
        }
      });
    });
  }

  // Manage Watch Later button
  if (manageWlBtn) {
    manageWlBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: "https://www.youtube.com/playlist?list=WL" });
    });
  }
});