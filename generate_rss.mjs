// generate_rss.mjs
// Node 18+ (native fetch). One dep: cheerio
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'docs', 'rss.xml');

const START_URL = 'https://www.globenewswire.com/search/keyword/geomega';

const SLEEP_MS = 900; // be polite
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const fetchHTML = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extract result cards (title + link) from a search page */
const parseResults = (html) => {
  const $ = cheerio.load(html);
  const items = [];

  // Primary selector for result cards
  $('a[href*="/news-release/"]').each((_, a) => {
    const href = $(a).attr('href');
    // Strictly accept full news release pages
    if (!href) return;
    if (!href.includes('/news-release/')) return;

    // Normalize to absolute
    const link = href.startsWith('http')
      ? href
      : `https://www.globenewswire.com${href}`;

    // Try to grab nearest title text
    const title =
      $(a).text().trim() ||
      $(a).attr('title')?.trim() ||
      $('title').first().text().trim() ||
      'GlobeNewswire News Release';

    items.push({ title, link });
  });

  // Deduplicate by link on this page
  const seen = new Set();
  return items.filter((it) => (seen.has(it.link) ? false : seen.add(it.link)));
};

/** Find "next page" URL on the search page */
const findNext = (html, currUrl) => {
  const $ = cheerio.load(html);

  // Try <link rel="next" href="...">
  const nextLinkTag = $('link[rel="next"]').attr('href');
  if (nextLinkTag) {
    return nextLinkTag.startsWith('http')
      ? nextLinkTag
      : new URL(nextLinkTag, currUrl).toString();
  }

  // Try anchor with rel="next"
  const aRelNext = $('a[rel="next"]').attr('href');
  if (aRelNext) {
    return aRelNext.startsWith('http')
      ? aRelNext
      : new URL(aRelNext, currUrl).toString();
  }

  // Fallback: a button/anchor containing "Next"
  let candidate = null;
  $('a,button').each((_, el) => {
    const t = cheerio.load(el).text().trim().toLowerCase();
    if (t === 'next' || t.includes('next ›') || t.includes('suivant')) {
      const href = $(el).attr('href');
      if (href) {
        candidate = href.startsWith('http')
          ? href
          : new URL(href, currUrl).toString();
      }
    }
  });

  return candidate || null;
};

/** Fetch details (pubDate + img + description) from a news page */
const parseNewsPage = async (url) => {
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // Try to read date from meta or page
  let pub = $('meta[property="article:published_time"]').attr('content')
    || $('time[datetime]').attr('datetime')
    || $('meta[name="pubdate"]').attr('content')
    || $('meta[itemprop="datePublished"]').attr('content')
    || $('span.date, div.date').first().text().trim()
    || '';

  // Normalize to RFC1123 if possible
  const pubDate = pub ? new Date(pub).toUTCString() : new Date().toUTCString();

  // Try to extract a headline and summary
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('title').text().trim() ||
    'GlobeNewswire Release';

  // Hero image (if present)
  const img =
    $('meta[property="og:image"]').attr('content') ||
    $('img[src*="Resource/Download"]').attr('src') ||
    '';

  // Body snippet
  let body =
    $('meta[name="description"]').attr('content') ||
    $('div[itemprop="articleBody"], article, .article-body, .RichText, .articleBody')
      .first()
      .text()
      .trim();

  if (body) body = body.replace(/\s+/g, ' ').slice(0, 800);

  // Build simple HTML description
  const descParts = [];
  if (img) descParts.push(`<div><img src="${img}" style="width: 100%;"/></div>`);
  if (body) descParts.push(`<div>${body}</div>`);
  const description = descParts.join('');

  return { title, pubDate, description };
};

const buildRSS = (channel, items) => {
  const esc = (s) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const head = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${esc(channel.title)}</title>
<link>${esc(channel.link)}</link>
<description>${esc(channel.description)}</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
`;

  const tail = `</channel>\n</rss>\n`;

  const itemXml = items
    .map(
      (it) => `<item>
<title>${esc(it.title)}</title>
<link>${esc(it.link)}</link>
<guid>${esc(it.guid)}</guid>
<pubDate>${esc(it.pubDate)}</pubDate>
<description>
${esc(it.description || '')}
</description>
</item>`
    )
    .join('\n');

  return head + itemXml + '\n' + tail;
};

(async () => {
  console.log('➡️  Crawling GlobeNewswire for "geomega" (all pages)…');
  const seenLinks = new Set();
  const candidates = [];

  let pageUrl = START_URL;
  let pageCount = 0;

  while (pageUrl) {
    pageCount += 1;
    console.log(`  • Page ${pageCount}: ${pageUrl}`);
    const html = await fetchHTML(pageUrl);
    const found = parseResults(html);

    let newOnThisPage = 0;
    for (const it of found) {
      if (!seenLinks.has(it.link)) {
        seenLinks.add(it.link);
        candidates.push(it.link);
        newOnThisPage += 1;
      }
    }
    console.log(`    ↳ ${newOnThisPage} new links (total unique: ${seenLinks.size})`);

    const next = findNext(html, pageUrl);
    if (!next) break;
    pageUrl = next;
    await sleep(SLEEP_MS);
  }

  console.log(`✅ Collected ${candidates.length} unique news-release URLs. Fetching details…`);

  const rssItems = [];
  let i = 0;
  for (const link of candidates) {
    i += 1;
    try {
      process.stdout.write(`    [${i}/${candidates.length}] ${link}\r`);
      const meta = await parseNewsPage(link);
      rssItems.push({
        title: meta.title || 'GlobeNewswire Release',
        link,
        guid: link.replace(/^https?:\/\//, ''),
        pubDate: meta.pubDate,
        description: meta.description || ''
      });
      await sleep(SLEEP_MS);
    } catch (e) {
      console.warn(`\n    ! Failed: ${link} – ${e.message}`);
    }
  }
  console.log('\n🧾 Building RSS…');

  // Sort newest first
  rssItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const xml = buildRSS(
    {
      title: 'Geomega — GlobeNewswire (All Results)',
      link: START_URL,
      description: 'Full GlobeNewswire results for "geomega" (auto-crawled)'
    },
    rssItems
  );

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, xml, 'utf8');
  console.log(`✨ Wrote ${OUT} with ${rssItems.length} items.`);
})();
