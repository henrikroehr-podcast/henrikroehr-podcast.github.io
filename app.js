const EPISODES_JSON = 'episodes.json';
const FALLBACK_RSS = 'https://anchor.fm/s/1091ae5c8/podcast/rss';

(async function init() {
  let data;
  try {
    const res = await fetch(EPISODES_JSON, { cache: 'no-store' });
    if (!res.ok) throw new Error('no episodes.json yet');
    data = await res.json();
  } catch {
    data = await fetchRssInBrowser(FALLBACK_RSS).catch(() => ({ items: [] }));
  }
  renderEpisodes(data?.items ?? []);
})();

function renderEpisodes(items) {
  const list = document.getElementById('episodes');
  const tpl = document.getElementById('episode-card-tpl');

  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<p style="grid-column: 1/-1; color:#9aa3ae">No episodes found yet.</p>`;
    return;
  }

  items.forEach(item => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('.thumb');
    const title = node.querySelector('.title');
    const date = node.querySelector('.date');
    const btn = node.querySelector('.play-btn');
    const audio = node.querySelector('.audio');

    img.src = item.image || item.podcastImage || 'logo.png';
    img.alt = item.title || 'Episode';
    title.textContent = item.title || 'Untitled episode';
    date.textContent = formatDate(item.pubDate);

    audio.src = item.audioUrl || '';
    audio.setAttribute('aria-label', `Audio for ${item.title}`);

    btn.addEventListener('click', () => {
      const anyPlaying = document.querySelectorAll('audio').length
        ? Array.from(document.querySelectorAll('audio')).filter(a => !a.paused)
        : [];
      anyPlaying.forEach(a => a.pause());

      if (audio.paused) {
        audio.play().catch(()=>{});
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', () => card.classList.add('playing'));
    audio.addEventListener('pause', () => card.classList.remove('playing'));
    audio.addEventListener('ended', () => card.classList.remove('playing'));

    list.appendChild(node);
  });
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function fetchRssInBrowser(url) {
  const res = await fetch(url);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const channelImage = doc.querySelector('channel > image > url')?.textContent
    || doc.querySelector('channel > itunes\\:image')?.getAttribute('href')
    || '';

  const items = Array.from(doc.querySelectorAll('item')).map(it => {
    const enclosure = it.querySelector('enclosure');
    const audioUrl = enclosure?.getAttribute('url') || '';
    const img =
      it.querySelector('itunes\\:image')?.getAttribute('href') ||
      it.querySelector('media\\:thumbnail')?.getAttribute('url') ||
      channelImage ||
      '';

    return {
      title: it.querySelector('title')?.textContent?.trim() || '',
      pubDate: it.querySelector('pubDate')?.textContent || '',
      audioUrl,
      image: img,
      podcastImage: channelImage
    };
  });

  return { items };
}