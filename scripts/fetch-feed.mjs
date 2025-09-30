import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'node-html-parser';
import Parser from 'fast-xml-parser';
import fetch from 'node-fetch';

const RSS_URL = process.env.RSS_URL || 'https://anchor.fm/s/1091ae5c8/podcast/rss';
const OUT = path.resolve(process.cwd(), 'episodes.json');

(async () => {
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'PodcastSiteFetcher/1.0' } });
  if (!res.ok) throw new Error(`Failed RSS fetch: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const parser = new Parser.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    allowBooleanAttributes: true,
    trimValues: true
  });

  const rss = parser.parse(xml);
  const channel = rss?.rss?.channel || rss?.channel || {};

  const channelImg =
    channel?.image?.url ||
    channel?.['itunes:image']?.href ||
    '';

  const items = (Array.isArray(channel?.item) ? channel.item : [channel?.item].filter(Boolean))
    .map(it => {
      const title = it?.title ?? '';
      const pubDate = it?.pubDate ?? '';
      const enclosure = it?.enclosure;
      const audioUrl = enclosure?.url ?? '';
      const img = (it?.['itunes:image']?.href) || (it?.['media:thumbnail']?.url) || channelImg || '';
      let descImg = '';
      if (it?.description) {
        try {
          const root = parse(it.description);
          const first = root.querySelector('img');
          if (first?.getAttribute('src')) descImg = first.getAttribute('src');
        } catch {}
      }
      return {
        title, pubDate, audioUrl,
        image: img || descImg || '',
        podcastImage: channelImg
      };
    })
    .filter(ep => ep.audioUrl);

  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const payload = { generatedAt: new Date().toISOString(), items };

  const pretty = JSON.stringify(payload, null, 2);
  await fs.writeFile(OUT, pretty, 'utf8');
  console.log(`Wrote ${OUT} (${items.length} episodes)`);
})();