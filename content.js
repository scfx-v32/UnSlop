// --- CONFIGURATION ---
const WATCH_LATER_URL = "https://www.youtube.com/playlist?list=WL";
let hasInjectedUnslop = false;
let currentSettings = {};
let navObserver = null;
let recObserver = null;

// --- ENTRY POINT ---
async function init() {
  const settings = await chrome.storage.local.get(['unslopMode', 'feedLimit', 'userDisabled']);
  currentSettings = settings;
  const isUnSlopMode = settings.unslopMode || false;
  const userDisabled = settings.userDisabled || false;

  // Run immediately on load
  handlePage(isUnSlopMode, settings.feedLimit, userDisabled);

  // Watch for page navigation
  let lastUrl = location.href;
  navObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      hasInjectedUnslop = false;
      handlePage(isUnSlopMode, settings.feedLimit, userDisabled);
    }
  });
  navObserver.observe(document, {subtree: true, childList: true});

  // Listen for storage changes to react to toggle
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.unslopMode || changes.userDisabled)) {
      // reload page so new state is respected immediately
      location.reload();
    }
  });
}

function handlePage(isUnSlopMode, limit, userDisabled = false) {
  // Only run on Homepage
  if (window.location.pathname !== "/") {
    // On video pages: if UnSlop is active, remove recommendations; otherwise leave them
    if (isUnSlopMode) {
      hideRecommendationsSidebar();
      observeRecommendations();
    }
    const modal = document.getElementById('unslop-modal');
    if(modal) modal.remove();
    return; 
  }

  // Always kill shorts
  hideShorts();
  
  // Always hide recommendation sidebar on homepage too
  hideRecommendationsSidebar();
  
  // Hide frosted glass header
  hideFrostedGlassHeader();

  if (isUnSlopMode) {
    if (!hasInjectedUnslop) {
      activateUnSlop(limit || 12);
    }
  } else {
    // If user manually disabled UnSlop, do not show timer/modal
    if (!userDisabled) showTimerModal();
    else disableAllFeatures();
  }
}

function hideShorts() {
    const shorts = document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer');
    shorts.forEach(el => el.style.display = 'none');
}

function hideRecommendationsSidebar() {
    // Remove right sidebar recommendations on video pages (and keep removing if re-inserted)
    const selectors = ['ytd-watch-next-results', 'ytd-secondary-results', '#secondary', '#related'];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        try { el.remove(); } catch(e) { el.style.display = 'none'; }
      });
    });
}

// Remove all injected UI and observers when user disables the extension
function disableAllFeatures() {
  // Remove hide-style
  removeHideStyle();
  // Remove injected grid
  const oldGrid = document.getElementById('unslop-grid');
  if (oldGrid) oldGrid.remove();
  // Remove modal, timer, loader
  ['unslop-modal','unslop-timer-widget','unslop-loader'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  // Re-enable native feed if present
  const nativeFeed = document.querySelector('ytd-rich-grid-renderer');
  if (nativeFeed) nativeFeed.style.display = '';
  // Disconnect nav observer
  try { if (navObserver) navObserver.disconnect(); } catch(e) {}
  try { if (recObserver) { recObserver.disconnect(); recObserver = null; } } catch(e) {}
}

function observeRecommendations() {
  // Already observing
  if (recObserver) return;
  const selectors = ['ytd-watch-next-results', 'ytd-secondary-results', '#secondary', '#related'];
  const observer = new MutationObserver(mutations => {
    mutations.forEach(() => {
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          try { el.remove(); } catch(e) { el.style.display = 'none'; }
        });
      });
    });
  });
  observer.observe(document.body || document, { childList: true, subtree: true });
  recObserver = observer;
}

function hideFrostedGlassHeader() {
    // Shorten the frosted glass header element
    const frosted = document.getElementById('frosted-glass');
    if(frosted) {
        frosted.style.height = '20px';
        frosted.style.minHeight = '20px';
    }
}

// --- FEATURE: THE MODAL ---
function showTimerModal() {
  if (document.getElementById('unslop-modal')) return;

  // Show native feed during countdown
  // Ensure any injected hide-style is removed so native feed shows
  removeHideStyle();

  const modal = document.createElement('div');
  modal.id = 'unslop-modal';
  modal.innerHTML = `
    <h1>UnSlop</h1>
    <p>Earn your scroll.</p>
    <input type="number" id="unslop-time-input" min="1" value="5">
    <button id="unslop-start-btn">START BROWSING</button>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  document.getElementById('unslop-start-btn').addEventListener('click', () => {
    const mins = parseInt(document.getElementById('unslop-time-input').value);
    document.body.style.overflow = 'auto';
    startCountdown(mins);
    modal.remove();
  });
}

// --- FEATURE: COUNTDOWN ---
function startCountdown(minutes) {
  const endTime = Date.now() + (minutes * 60 * 1000);
  const timerDiv = document.createElement('div');
  timerDiv.id = 'unslop-timer-widget';
  document.body.appendChild(timerDiv);
  makeDraggable(timerDiv);

  const interval = setInterval(() => {
    const remaining = Math.ceil((endTime - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(interval);
      chrome.storage.local.set({ unslopMode: true }, () => location.reload());
    } else {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      timerDiv.innerText = `${m}:${s < 10 ? '0'+s : s}`;
    }
  }, 1000);
}

// --- FEATURE: INJECT WL GRID ---
async function activateUnSlop(limit) {
  // 1. Inject style to hide native feed, shorts and sidebar
  injectHideStyle();
  // If we were observing recommendations on video pages, stop doing that
  try { if (recObserver) { recObserver.disconnect(); recObserver = null; } } catch(e) {}

  // 2. Show loading spinner
  showLoadingSpinner();

  try {
    // Fetch all WL videos (handle pagination)
    const allVideos = await fetchAllWatchLaterVideos();
    
    if (allVideos.length === 0) {
      hideLoadingSpinner();
      console.warn("No videos in Watch Later");
      return;
    }

    // 3. Shuffle & Limit
    const shuffled = allVideos.sort(() => 0.5 - Math.random()).slice(0, limit);

    // Enrich metadata for the videos we're about to display
    const enriched = await enrichVideoMetadata(shuffled);

    // 4. Create Grid
    const customGrid = document.createElement('div');
    customGrid.id = 'unslop-grid';

    enriched.forEach(vid => {
      const title = vid.title || "Unknown Title";
      const id = vid.videoId;
      const author = vid.author || "Unknown Channel";
      const thumb = vid.thumbnail || "";
      const views = vid.views || "No data";
      const uploadDate = vid.uploadDate || "Unknown";
      const channelPfp = vid.channelPfp || "";

      const card = document.createElement('div');
      card.className = 'unslop-card';
      card.onclick = () => window.location.href = `/watch?v=${id}`;
      
      card.innerHTML = `
          <div class="unslop-thumb-wrapper">
              <img src="${thumb}" alt="${title}">
          </div>
          <div class="unslop-info">
              <img src="${channelPfp}" class="unslop-avatar" alt="channel">
              <div class="unslop-text">
                  <span class="unslop-title">${title}</span>
                  <span class="unslop-meta">${author}</span>
                  <span class="unslop-stats">${views} • ${uploadDate}</span>
              </div>
          </div>
      `;
      customGrid.appendChild(card);
    });

    // 5. Inject into Main Container
    const container = document.querySelector('#primary') || document.querySelector('ytd-two-column-browse-results-renderer');
    
    const oldGrid = document.getElementById('unslop-grid');
    if(oldGrid) oldGrid.remove();
    
    if (container) {
        container.insertBefore(customGrid, container.firstChild);
        hasInjectedUnslop = true;
    }

    hideLoadingSpinner();

  } catch (e) {
    console.error("UnSlop Error", e);
    hideLoadingSpinner();
  }
}

// Fetch all videos from Watch Later playlist (handles pagination)
async function fetchAllWatchLaterVideos() {
  const allVideos = [];
  let continuation = null;
  let apiKey = null;
  let context = null;

  try {
    // First request
    const response = await fetch(WATCH_LATER_URL);
    const text = await response.text();

    // Extract ytInitialData for first batch
    const jsonStart = text.indexOf('var ytInitialData =');
    if (jsonStart === -1) return allVideos;
    const jsonEnd = text.indexOf(';</script>', jsonStart);
    const jsonText = text.substring(jsonStart + 19, jsonEnd);
    const ytData = JSON.parse(jsonText);

    // Extract innertube config (API key + context) for continuation requests
    const cfg = extractInnertubeConfig(text);
    apiKey = cfg.apiKey;
    context = cfg.context;
    
    // Extract videos and continuation token from first batch
    const firstBatch = extractVideosFromJSON(ytData);
    allVideos.push(...firstBatch.videos);
    continuation = firstBatch.continuation;

    // Fetch remaining batches using continuation
    while (continuation) {
      const batch = await fetchNextBatch(continuation, apiKey, context);
      allVideos.push(...batch.videos);
      continuation = batch.continuation;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

  } catch(e) {
    console.error("Error fetching Watch Later:", e);
  }

  return allVideos;
}

// Fetch next batch using continuation token
async function fetchNextBatch(continuation) {
  const videos = [];
  let nextContinuation = null;

  try {
    // apiKey and context should be provided by caller
    // (this function may be overridden by caller)
    const apiKey = arguments[1] || null;
    const context = arguments[2] || { client: { clientName: 'WEB', clientVersion: '2.20220101.00.00' } };
    const url = apiKey ? `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}` : 'https://www.youtube.com/youtubei/v1/browse';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: context || { client: { clientName: 'WEB', clientVersion: '2.20220101.00.00' } },
        continuation: continuation
      })
    });

    const data = await response.json();
    const batch = extractVideosFromBatch(data);
    videos.push(...batch.videos);
    nextContinuation = batch.continuation;

  } catch(e) {
    console.error("Error fetching batch:", e);
  }

  return { videos, continuation: nextContinuation };
}

// Extract INNERTUBE API key and context from page HTML
function extractInnertubeConfig(html) {
  try {
    const m = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
    if (m) {
      const cfg = JSON.parse(m[1]);
      return { apiKey: cfg.INNERTUBE_API_KEY || cfg['INNERTUBE_API_KEY'], context: cfg.INNERTUBE_CONTEXT || cfg['INNERTUBE_CONTEXT'] };
    }
    const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    if (keyMatch) return { apiKey: keyMatch[1], context: null };
  } catch(e) { /* ignore */ }
  return { apiKey: null, context: null };
}

// Inject/remove CSS to hide native feed, shorts and right sidebar
function injectHideStyle() {
  if (document.getElementById('unslop-hide-style')) return;
  const style = document.createElement('style');
  style.id = 'unslop-hide-style';
  style.textContent = `
    ytd-rich-grid-renderer { display: none !important; }
    ytd-rich-section-renderer, ytd-reel-shelf-renderer { display: none !important; }
    ytd-watch-next-results, ytd-secondary-results { display: none !important; }
  `;
  document.head.appendChild(style);
}

function removeHideStyle() {
  const s = document.getElementById('unslop-hide-style');
  if (s) s.remove();
}

// Enrich metadata for displayed videos by fetching their watch pages
async function enrichVideoMetadata(videos) {
  const concurrency = 4;
  let idx = 0;
  const results = [];

  async function worker() {
    while (idx < videos.length) {
      const i = idx++;
      const v = videos[i];
      try {
        const meta = await fetchVideoPageData(v.videoId);
        results[i] = Object.assign({}, v, meta);
      } catch (e) {
        results[i] = v;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function fetchVideoPageData(videoId) {
  try {
    const resp = await fetch(`/watch?v=${videoId}`);
    const txt = await resp.text();

    // Try to extract player response
    let playerMatch = txt.match(/var ytInitialPlayerResponse = (\{[\s\S]*?\});/);
    let player = null;
    if (playerMatch) player = JSON.parse(playerMatch[1]);

    // Try to extract initial data
    let dataMatch = txt.match(/var ytInitialData = (\{[\s\S]*?\});/);
    let initData = null;
    if (dataMatch) initData = JSON.parse(dataMatch[1]);

    const videoDetails = player?.videoDetails || {};
    const micro = player?.microformat?.playerMicroformatRenderer || {};

    const views = videoDetails.viewCount || videoDetails.shortViewCount || null;
    const length = videoDetails.lengthSeconds || null;
    const uploadDate = micro?.publishDate || micro?.uploadDate || null;

    // Try to get channel pfp from owner renderer in initial data
    let channelPfp = '';
    try {
      const ownerMatch = txt.match(/"videoOwnerRenderer":(\{[\s\S]*?\})[,}]/);
      if (ownerMatch) {
        const owner = JSON.parse(ownerMatch[1]);
        channelPfp = owner?.videoOwnerRenderer?.thumbnail?.thumbnails?.pop()?.url || '';
      }
    } catch(e) {}

    const prettyViews = views ? (typeof views === 'string' ? views : String(views)) : null;
    return { views: prettyViews, uploadDate: uploadDate || 'Unknown', length: length || null, channelPfp };
  } catch(e) {
    return {};
  }
}

// Extract videos from first response JSON
function extractVideosFromJSON(data) {
  const videos = [];
  let continuation = null;

  try {
    const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
    const tab = tabs.find(t => t.tabRenderer?.selected) || tabs[0];
    const contents = tab.tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents;
    const playlist = contents[0].playlistVideoListRenderer.contents;

    playlist.forEach(item => {
      const renderer = item.playlistVideoRenderer;
      if (!renderer) {
        // Check if it's a continuation token
        if (item.continuationItemRenderer) {
          continuation = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
        }
        return;
      }

      const video = parseVideoRenderer(renderer);
      if (video) videos.push(video);
    });

  } catch(e) {
    console.error("Error extracting from first JSON:", e);
  }

  return { videos, continuation };
}

// Extract videos from continuation batch
function extractVideosFromBatch(data) {
  const videos = [];
  let continuation = null;

  try {
    const onResponseReceivedActions = data.onResponseReceivedActions?.[0];
    if (!onResponseReceivedActions) return { videos, continuation };

    const appendContinuationItemsAction = onResponseReceivedActions.appendContinuationItemsAction;
    const items = appendContinuationItemsAction.continuationItems || [];

    items.forEach(item => {
      const renderer = item.playlistVideoRenderer;
      if (!renderer) {
        if (item.continuationItemRenderer) {
          continuation = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
        }
        return;
      }

      const video = parseVideoRenderer(renderer);
      if (video) videos.push(video);
    });

  } catch(e) {
    console.error("Error extracting from batch:", e);
  }

  return { videos, continuation };
}

// Parse individual video renderer
function parseVideoRenderer(renderer) {
  try {
    const title = renderer.title?.runs[0]?.text || "";
    const videoId = renderer.videoId || "";
    const author = renderer.shortBylineText?.runs[0]?.text || "";
    const thumbnail = renderer.thumbnail?.thumbnails?.pop()?.url || "";
    
    // Extract view count
    let views = "No data";
    if (renderer.videoDuration || renderer.videoDetails) {
      // Try to get views from different possible locations
      const viewCountText = renderer.viewCountText?.simpleText || "";
      if (viewCountText) views = viewCountText.split(' ')[0];
    }

    // Try alternate view count location
    if (views === "No data") {
      const stats = renderer.shortMetadataRowContainer?.metadataRowContainer?.contents?.[0];
      if (stats) {
        views = stats.metadataRowRenderer?.title?.simpleText || "No data";
      }
    }

    // Extract upload date
    let uploadDate = "Unknown";
    const dateText = renderer.shortMetadataRowContainer?.metadataRowContainer?.contents?.[1];
    if (dateText) {
      uploadDate = dateText.metadataRowRenderer?.title?.simpleText || "Unknown";
    }

    // Get channel pfp (thumbnail from author text, YouTube doesn't expose in this API easily)
    // We'll use a fallback or empty for now
    const channelPfp = renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url 
      ? getChannelPfpFromUrl(renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url) 
      : "";

    return {
      videoId,
      title,
      author,
      thumbnail,
      views,
      uploadDate,
      channelPfp
    };

  } catch(e) {
    console.error("Error parsing video:", e);
    return null;
  }
}

// Placeholder for channel pfp (YouTube doesn't expose directly in playlist API)
function getChannelPfpFromUrl(url) {
  // For now, return empty - could be enhanced with channel API call
  return "";
}

// Helper: Draggable
function makeDraggable(elmnt) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  elmnt.onmousedown = dragMouseDown;
  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX; pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }
  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }
  function closeDragElement() {
    document.onmouseup = null; document.onmousemove = null;
  }
}

// Loading spinner
function showLoadingSpinner() {
  if (document.getElementById('unslop-loader')) return;
  const loader = document.createElement('div');
  loader.id = 'unslop-loader';
  loader.innerHTML = '<div class="unslop-spinner"></div><p>Loading your Watch Later...</p>';
  document.body.appendChild(loader);
}

function hideLoadingSpinner() {
  const loader = document.getElementById('unslop-loader');
  if (loader) loader.remove();
}

init();