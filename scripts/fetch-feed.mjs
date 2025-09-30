import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'node-html-parser';
import Parser from 'fast-xml-parser';
import fetch from 'node-fetch';

const RSS_URL = process.env.RSS_URL || 'https://anchor.fm/s/1091ae5c8/podcast/rss';
const OUT = path.resolve(process.cwd(), 'episodes.json');
const IMG_DIR = path.resolve(process.cwd(), 'images');

const xmlParser = new Parser.XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  trimValues: true
});

function firstImgFromHtml(html) {
  try {
    if (!html) return '';
    const root = parse(html);
    return root.querySelector('img')?.getAttribute('src') || '';
  } catch { return ''; }
}
function norm(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'https://');
  return url;
}
function pickItemImage(it, channelImg) {
  const ii = it?.['itunes:image'];
  const itunes = typeof ii === 'string' ? ii : (ii?.href || ii?.url);
  if (itunes) return norm(itunes);

  const mc = it?.['media:content'];
  if (mc) {
    const arr = Array.isArray(mc) ? mc : [mc];
    const found = arr.find(x =>
      (x?.type && String(x.type).startsWith('image/')) || x?.medium === 'image'
    );
    if (found?.url) return norm(found.url);
  }
  const mt = it?.['media:thumbnail'];
  if (mt?.url) return norm(mt.url);

  const html = it?.['content:encoded'] || it?.content || it?.description || '';
  const fromHtml = firstImgFromHtml(html);
  if (fromHtml) return norm(fromHtml);

  return norm(channelImg || '');
}
function pickAudio(it) {
  let audioUrl = it?.enclosure?.url || '';
  if (!audioUrl && it?.['media:content']) {
    const arr = Array.isArray(it['media:content']) ? it['media:content'] : [it['media:content']];
    const audioMC = arr.find(x => (x?.type && String(x.type).startsWith('audio/')));
    if (audioMC?.url) audioUrl = audioMC.url;
  }
  return norm(audioUrl);
}
function extFromContentType(ct) {
  if (!ct) return '.bin';
  if (ct.includes('jpeg')) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}
async function downloadImage(url) {
  if (!url) return '';
  try {
    await fs.mkdir(IMG_DIR, { recursive: true });
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
    let ext = '';
    try {
      ext = path.extname(new URL(url).pathname);
      if (!ext || ext.length > 5) ext = '';
    } catch {}
    const res = await fetch(url, { headers: { 'User-Agent': 'PodcastSiteFetcher/1.0' } });
    if (!res.ok) throw new Error(`img ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!ext) ext = extFromContentType(res.headers.get('content-type') || '');
    const filename = `ep-${hash}${ext}`;
    const full = path.join(IMG_DIR, filename);
    await fs.writeFile(full, buf);
    return `images/${filename}`;
  } catch {
    return '';
  }
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

  for (const it of rawItems) {
    const title = it?.title ?? '';
    const pubDate = it?.pubDate ?? '';
    const audioUrl = pickAudio(it);
    const notesHtml = it?.['content:encoded'] || it?.content || it?.description || '';

    const remoteImage = pickItemImage(it, channelImg);
    const imageLocal = await downloadImage(remoteImage);

    if (audioUrl) {
      items.push({
        title,
        pubDate,
        audioUrl,
        image: remoteImage,         // original URL (fallback)
        imageLocal: imageLocal || '',// cached file guaranteed to load
        podcastImage: norm(channelImg),
        notesHtml
      });
    }
  }

  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const payload = {
    generatedAt: new Date().toISOString(),
    channel: { title: channelTitle, description: channelDescription, image: norm(channelImg) },
    items
  };

  await fs.writeFile(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${OUT} (${items.length} episodes)`);
})();

