// generate_rss.mjs — crawl all GlobeNewswire search pages for “Geomega”
import fs from "fs";
import fetch from "node-fetch";

const KEYWORD = "geomega";
const BASE = `https://www.globenewswire.com/search/keyword/${KEYWORD}?page=`;
const OUT = "docs/rss.xml";
const MAX_PAGES = 300;
const MAX_ITEMS = 1000;

// helper
function esc(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return await r.text();
}

function extractLinks(html) {
  const re =
    /https:\/\/www\.globenewswire\.com\/news-release\/\d{4}\/\d{2}\/\d{2}\/\d+\/0\/en\/[^"<>]+\.html/g;
  return [...new Set(html.match(re) || [])];
}

async function scrapeArticle(url) {
  const html = await getText(url);
  const title =
    html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
    html.match(/<title>(.*?)<\/title>/i)?.[1] ||
    "Untitled";
  const desc =
    html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1] || "";
  const date =
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ||
    html.match(/<meta property="article:published_time" content="([^"]+)"/i)?.[1];
  const pubDate = date ? new Date(date).toUTCString() : new Date().toUTCString();
  return { title, link: url, pubDate, description: desc };
}

async function main() {
  console.log("🔍 Collecting article links…");
  const links = new Set();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const html = await getText(BASE + p);
    const found = extractLinks(html);
    if (!found.length) break;
    for (const f of found) links.add(f);
    console.log(`Page ${p}: +${found.length} links`);
    if (found.length < 20) break;
  }

  const all = [];
  console.log(`📰 Found ${links.size} article URLs. Fetching details…`);
  for (const L of links) {
    try {
      const art = await scrapeArticle(L);
      all.push(art);
      if (all.length >= MAX_ITEMS) break;
    } catch (e) {
      console.warn("skip", L);
    }
  }

  all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const items = all
    .map(
      (x) => `
<item>
  <title>${esc(x.title)}</title>
  <link>${esc(x.link)}</link>
  <guid>${esc(x.link)}</guid>
  <pubDate>${x.pubDate}</pubDate>
  <description>${esc(x.description)} (Source: GlobeNewswire)</description>
</item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Geomega — GlobeNewswire (All Pages)</title>
<link>https://www.globenewswire.com/search/keyword/${KEYWORD}</link>
<description>Full GlobeNewswire results for ${KEYWORD}</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(OUT, xml);
  console.log(`✅ Wrote ${all.length} items → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
