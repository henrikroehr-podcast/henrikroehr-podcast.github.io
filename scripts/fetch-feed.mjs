import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseHtml } from 'node-html-parser';
import Parser from 'fast-xml-parser';
import fetch from 'node-fetch';
import crypto from 'node:crypto';

const RSS_URL = process.env.RSS_URL || 'https://anchor.fm/s/1091ae5c8/podcast/rss';
const OUT = path.resolve(process.cwd(), 'episodes.json');
const IMG_DIR = path.resolve(process.cwd(), 'images');

const xmlParser = new Parser.XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  trimValues: true,
});

/** Normalize URLs and upgrade to https where safe */
function norm(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'https://');
  return url;
}

/** Extract first <img src> from an HTML fragment */
function firstImgFromHtml(html) {
  try {
    if (!html) return '';
    const root = parseHtml(html);
    return root.querySelector('img')?.getAttribute('src') || '';
  } catch {
    return '';
  }
}

/** Derive file extension from content-type or URL */
function extFrom(contentType, url) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/webp')) return '.webp';
  if (ct.includes('image/avif')) return '.avif';
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg';
  if (/\.(png)(\?|$)/i.test(url)) return '.png';
  if (/\.(webp)(\?|$)/i.test(url)) return '.webp';
  if (/\.(avif)(\?|$)/i.test(url)) return '.avif';
  if (/\.(jpe?g)(\?|$)/i.test(url)) return '.jpg';
  return '.jpg';
}

/** Try many places an episode image might live */
function pickItemImage(it, channelImg) {
  // 1) itunes:image (href or url) - sometimes array, sometimes object
  let ii = it?.['itunes:image'];
  if (Array.isArray(ii)) ii = ii.find(Boolean);
  const iiUrl = typeof ii === 'string' ? ii : (ii?.href || ii?.url);
  if (iiUrl) return norm(iiUrl);

  // 2) <image><url> (some feeds put a per-item <image>)
  const imageTag = it?.image?.url || it?.image;
  if (imageTag) return norm(typeof imageTag === 'string' ? imageTag : imageTag?.toString());

  // 3) media:content[*] that looks like an image
  const mc = it?.['media:content'];
  if (mc) {
    const arr = Array.isArray(mc) ? mc : [mc];
    const found = arr.find(x =>
      (x?.type && String(x.type).toLowerCase().startsWith('image/')) || x?.medium === 'image'
    );
    if (found?.url) return norm(found.url);
  }

  // 4) media:thumbnail
  const mt = it?.['media:thumbnail'];
  const mtUrl = typeof mt === 'string' ? mt : mt?.url;
  if (mtUrl) return norm(mtUrl);

  // 5) any <img> inside content/description
  const html = it?.['content:encoded'] || it?.content || it?.description || '';
  const fromHtml = firstImgFromHtml(html);
  if (fromHtml) return norm(fromHtml);

  // 6) fallback to channel image
  return norm(channelImg || '');
}

async function downloadImageToLocal(url) {
  const u = norm(url);
  if (!u) return '';

  const res = await fetch(u, {
    headers: {
      'user-agent': 'PodcastSiteFetcher/1.0 (+github pages)',
      'accept': 'image/*,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`image GET ${res.status} ${res.statusText} for ${u}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  const hash = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
  const ext = extFrom(ct, u);
  const file = `ep-${hash}${ext}`;
  await fs.mkdir(IMG_DIR, { recursive: true });
  // Always overwrite so changed artwork updates even if the URL stays the same
  await fs.writeFile(path.join(IMG_DIR, file), buf);
  return `images/${file}`;
}

(async () => {
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'PodcastSiteFetcher/1.0' } });
  if (!res.ok) throw new Error(`Failed RSS fetch: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const rss = xmlParser.parse(xml);

  const channel = rss?.rss?.channel || rss?.channel || {};
  const channelTitle = channel?.title || 'Podcast';
  const channelDescription =
    channel?.description || channel?.['itunes:summary'] || channel?.['itunes:subtitle'] || '';
  const channelImg =
    channel?.image?.url || channel?.['itunes:image']?.href || channel?.['itunes:image']?.url || '';

  const rawItems = Array.isArray(channel?.item) ? channel.item : [channel?.item].filter(Boolean);
  const items = [];

  let ok = 0, fail = 0;

  for (const it of rawItems) {
    const title = it?.title ?? '';
    const pubDate = it?.pubDate ?? '';

    // audio URL
    let audioUrl = it?.enclosure?.url || '';
    if (!audioUrl && it?.['media:content']) {
      const arr = Array.isArray(it['media:content']) ? it['media:content'] : [it['media:content']];
      const audioMC = arr.find(x => x?.type && String(x.type).toLowerCase().startsWith('audio/'));
      if (audioMC?.url) audioUrl = audioMC.url;
    }

    const notesHtml = it?.['content:encoded'] || it?.content || it?.description || '';

    // episode image (robust)
    const imageUrl = pickItemImage(it, channelImg);
    let imageLocal = '';
    if (imageUrl) {
      try {
        imageLocal = await downloadImageToLocal(imageUrl);
        ok++;
      } catch (e) {
        console.warn('[image download failed]', e.message);
        fail++;
      }
    }

    if (audioUrl) {
      items.push({
        title,
        pubDate,
        audioUrl: norm(audioUrl),
        image: norm(imageUrl),
        imageLocal,
        podcastImage: norm(channelImg),
        notesHtml,
      });
    }
  }

  // newest first
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const payload = {
    generatedAt: new Date().toISOString(),
    channel: { title: channelTitle, description: channelDescription, image: norm(channelImg) },
    items,
  };

  await fs.writeFile(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${OUT} (${items.length} episodes; image ok=${ok}, fail=${fail})`);
})();
