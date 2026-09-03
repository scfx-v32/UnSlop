// Background service worker to schedule unslop resets

async function scheduleFromStorage() {
  chrome.storage.local.get(['frequency','weekday'], (data) => {
    const freq = data.frequency || 'never';
    const weekday = typeof data.weekday !== 'undefined' ? parseInt(data.weekday, 10) : 0;

    // Clear existing alarms
    chrome.alarms.clearAll(() => {
      if (freq === 'never') return;

      const now = new Date();
      // next midnight
      const nextMidnight = new Date();
      nextMidnight.setHours(24,0,0,0);

      let when = nextMidnight.getTime();
      let period = null;

      if (freq === 'daily') {
        period = 24 * 60; // minutes
      } else if (freq === 'weekly') {
        // find next occurrence of weekday
        const today = now.getDay();
        let daysUntil = (weekday - today + 7) % 7;
        if (daysUntil === 0) daysUntil = 7; // next week
        const target = new Date(nextMidnight.getTime() + daysUntil * 24 * 60 * 60 * 1000);
        when = target.getTime();
        period = 7 * 24 * 60;
      } else if (freq === 'monthly') {
        // first day of next month at midnight
        const target = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        target.setHours(0,0,0,0);
        when = target.getTime();
        period = null;
      }

      const alarmOptions = period ? { when: when, periodInMinutes: period } : { when: when };
      chrome.alarms.create('unslop-reset', alarmOptions);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => scheduleFromStorage());
chrome.runtime.onStartup.addListener(() => scheduleFromStorage());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.frequency || changes.weekday)) {
    scheduleFromStorage();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'unslop-reset') {
    // On scheduled reset, disable UnSlop and clear manual-disable so modal appears
    chrome.storage.local.set({ unslopMode: false, userDisabled: false }, () => {
      // reload youtube tabs so users see the change
      chrome.tabs.query({url: '*://www.youtube.com/*'}, (tabs) => {
        tabs.forEach(t => {
          try { chrome.tabs.reload(t.id); } catch (e) {}
        });
      });
      // Reschedule if frequency is monthly (we scheduled single-occurrence)
      chrome.storage.local.get(['frequency'], (data) => {
        if (data.frequency === 'monthly') scheduleFromStorage();
      });
    });
  }
});
