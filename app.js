const EPISODES_JSON = 'episodes.json';
const FALLBACK_RSS = 'https://anchor.fm/s/1091ae5c8/podcast/rss';

let flyout;
let FEED_GEN_AT = ''; 

(async function init() {
  // Shared flyout
  flyout = document.createElement('div');
  flyout.id = 'notes-flyout';
  flyout.innerHTML = `
    <div class="notes-flyout-inner">
      <h3 class="notes-flyout-title"></h3>
      <div class="notes-flyout-body"></div>
    </div>`;
  document.body.appendChild(flyout);

  let data;

  // 🔁 NEW ORDER:
  // 1) Try LIVE RSS (this is what Spotify / Apple use)
  // 2) If that fails (CORS / network), fall back to episodes.json
  try {
    data = await fetchRssInBrowser(FALLBACK_RSS);
  } catch (e) {
    console.warn('Failed to fetch RSS in browser, falling back to episodes.json', e);
    try {
      const res = await fetch(`${EPISODES_JSON}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('no episodes.json yet');
      data = await res.json();
    } catch (e2) {
      console.error('Failed to fetch both RSS and episodes.json', e2);
      data = { items: [], channel: {} };
    }
  }

  FEED_GEN_AT = data?.generatedAt || '';

  const titleEl = document.getElementById('podcast-title');
  const descEl = document.getElementById('podcast-description');
  if (data?.channel?.title) titleEl.textContent = data.channel.title;
  if (data?.channel?.description) descEl.innerHTML = sanitizeToInlineHtml(data.channel.description);

  renderEpisodes(data?.items ?? []);
})();

// --- Image Fallback Helper ---
function setupEpisodeImage(img, episode) {
  // Prefer per-episode image from RSS, then show-level image, then local logo
  const candidates = [
    episode.image,
    episode.podcastImage,
    'logo.png'
  ].filter(Boolean);

  let idx = 0;

  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = episode.title || 'Episode';

  function tryNext() {
    if (idx >= candidates.length) {
      img.onerror = null; // stop looping
      return;
    }
    img.src = candidates[idx++];
  }

  img.onerror = tryNext;
  tryNext();
}

function renderEpisodes(items) {
  const list = document.getElementById('episodes');
  const tpl = document.getElementById('episode-card-tpl');

  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<p style="grid-column: 1/-1; color:#9aa3ae">Keine Episoden gefunden.</p>`;
    return;
  }

  items.forEach((item, index) => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('.thumb');
    const title = node.querySelector('.title');
    const date = node.querySelector('.date');
    const btn = node.querySelector('.play-btn');
    const audio = node.querySelector('.audio');

    // Use robust image logic based on RSS fields
    setupEpisodeImage(img, item);

    title.textContent = item.title || 'Untitled episode';
    date.textContent = formatDate(item.pubDate);

    audio.src = item.audioUrl || '';
    audio.setAttribute('aria-label', `Audio für ${item.title || 'Episode'}`);

    btn.addEventListener('click', () => {
      const anyPlaying = Array.from(document.querySelectorAll('audio')).filter(a => !a.paused);
      anyPlaying.forEach(a => a.pause());
      if (audio.paused) audio.play().catch(()=>{});
      else audio.pause();
    });
    audio.addEventListener('play', () => card.classList.add('playing'));
    audio.addEventListener('pause', () => card.classList.remove('playing'));
    audio.addEventListener('ended', () => card.classList.remove('playing'));

    // Hover: show flyout to the RIGHT for left tiles, LEFT for right tiles
    card.addEventListener('mouseenter', () => showFlyoutBeside(card, item));
    card.addEventListener('mouseleave', (e) => {
      const to = e.relatedTarget;
      if (!flyout.contains(to)) hideFlyoutSoon();
    });

    // Keep visible when hovering flyout itself
    flyout.addEventListener('mouseleave', hideFlyoutSoon);

    list.appendChild(node);
  });
}

// --- Flyout beside card ---
let hideTimer = null;
function showFlyoutBeside(cardEl, item) {
  clearTimeout(hideTimer);

  // Fill content
  const t = flyout.querySelector('.notes-flyout-title');
  const b = flyout.querySelector('.notes-flyout-body');
  t.textContent = item.title ? `Shownotes – ${item.title}` : 'Shownotes';
  b.innerHTML = sanitizeRichHtml(item.notesHtml || '');

  // Measure card and viewport
  const rect = cardEl.getBoundingClientRect();
  const cardMidX = rect.left + rect.width / 2;
  const viewportMidX = window.innerWidth / 2;
  const gap = 12; // px

  // Temporarily show flyout offscreen to measure its size
  flyout.style.visibility = 'hidden';
  flyout.classList.add('visible');
  const fw = flyout.offsetWidth;
  const fh = flyout.offsetHeight || 200;
  flyout.classList.remove('visible');
  flyout.style.visibility = '';

  // Decide side: left tiles -> right side flyout; right tiles -> left side flyout
  const placeRight = cardMidX < viewportMidX;

  // Compute top so flyout vertically aligns with card center (and stays in viewport)
  let top = rect.top + window.scrollY + rect.height / 2 - fh / 2;
  const minTop = window.scrollY + 8;
  const maxTop = window.scrollY + window.innerHeight - fh - 8;
  top = Math.max(minTop, Math.min(maxTop, top));

  // Compute left based on side, clamp inside viewport
  let left;
  if (placeRight) {
    left = rect.right + window.scrollX + gap;
    // clamp so it doesn't spill out
    left = Math.min(left, window.scrollX + window.innerWidth - fw - 8);
  } else {
    left = rect.left + window.scrollX - fw - gap;
    left = Math.max(left, window.scrollX + 8);
  }

  flyout.style.top = `${top}px`;
  flyout.style.left = `${left}px`;
  flyout.style.transform = 'none';
  flyout.classList.add('visible');
}
function hideFlyoutSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => flyout.classList.remove('visible'), 120);
}

// --- Utilities & fallback ---
function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function sanitizeToInlineHtml(input) {
  const temp = document.createElement('div');
  temp.textContent = input || '';
  return (temp.innerHTML || '').replace(/\n/g, '<br>');
}
function sanitizeRichHtml(input) {
  if (!input) return '';
  const allowed = new Set(['B','I','EM','STRONG','A','BR','P','UL','OL','LI','H3','H4','H5']);
  const container = document.createElement('div');
  container.innerHTML = input;
  const walk = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, null);
  const toRemove = [];
  while (walk.nextNode()) {
    const el = walk.currentNode;
    if (!allowed.has(el.tagName)) {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      toRemove.push(el);
    } else if (el.tagName === 'A') {
      const href = el.getAttribute('href') || '#';
      el.setAttribute('href', href);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
      for (const attr of Array.from(el.attributes)) {
        if (!['href','target','rel'].includes(attr.name)) el.removeAttribute(attr.name);
      }
    } else {
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    }
  }
  toRemove.forEach(n => n.remove());
  return container.innerHTML;
}

async function fetchRssInBrowser(url) {
  const res = await fetch(url);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const channelTitle =
    doc.querySelector('channel > title')?.textContent?.trim() || 'Podcast';

  const channelDesc =
    doc.querySelector('channel > description')?.textContent?.trim() ||
    doc.querySelector('channel > itunes\\:summary')?.textContent?.trim() ||
    doc.querySelector('channel > itunes\\:subtitle')?.textContent?.trim() ||
    '';

  const channelImage =
    doc.querySelector('channel > image > url')?.textContent ||
    doc.querySelector('channel > itunes\\:image')?.getAttribute('href') ||
    '';

  const items = Array.from(doc.querySelectorAll('item')).map(it => {
    const enclosure = it.querySelector('enclosure');
    const audioUrl = enclosure?.getAttribute('url') || '';

    const imgCandidate =
      it.querySelector('itunes\\:image')?.getAttribute('href') ||
      it.querySelector('media\\:content')?.getAttribute('url') ||
      it.querySelector('media\\:thumbnail')?.getAttribute('url') ||
      (() => {
        const html = it.querySelector('content\\:encoded')?.textContent
          || it.querySelector('description')?.textContent
          || '';
        if (!html) return '';
        try {
          const temp = document.implementation.createHTMLDocument('');
          temp.body.innerHTML = html;
          return temp.querySelector('img')?.getAttribute('src') || '';
        } catch { return ''; }
      })() ||
      channelImage ||
      '';

    const notesHtml =
      it.querySelector('content\\:encoded')?.textContent ||
      it.querySelector('description')?.textContent ||
      '';

    return {
      title: it.querySelector('title')?.textContent?.trim() || '',
      pubDate: it.querySelector('pubDate')?.textContent || '',
      audioUrl,
      image: imgCandidate,
      podcastImage: channelImage,
      notesHtml
    };
  });

  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return { channel: { title: channelTitle, description: channelDesc }, items };
}
