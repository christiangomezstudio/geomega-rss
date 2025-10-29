// generate_rss.mjs
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const OUT_DIR = "docs";
const OUT_FILE = path.join(OUT_DIR, "rss.xml");

// Crawl all GlobeNewswire result pages for keyword "geomega"
const SEARCH_BASE = "https://www.globenewswire.com/search/keyword/geomega?page=";
// Strict pattern for article URLs only (skips generic “Press Release Distribution…” cards)
const ARTICLE_URL_RE =
  /https:\/\/www\.globenewswire\.com\/news-release\/\d{4}\/\d{2}\/\d{2}\/\d+\/0\/en\/[^"<>]+?\.html/g;

const MAX_PAGES = 300;     // hard cap
const MAX_ITEMS = 1000;    // safety cap

function dedupe(arr) {
  return [...new Set(arr)];
}

function xmlEscape(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function parseJSONLD(html) {
  const blocks = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (Array.isArray(obj)) blocks.push(...obj);
      else blocks.push(obj);
    } catch (_) {}
  }
  return blocks;
}

function first(val) {
  return Array.isArray(val) ? val[0] : val;
}

async function collectArticleLinks() {
  const links = new Set();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = `${SEARCH_BASE}${p}`;
    let html;
    try {
      html = await getText(url);
    } catch {
      break; // stop on 404 or network issue (end of pages)
    }
    const pageLinks = dedupe(html.match(ARTICLE_URL_RE) || []);
    const before = links.size;
    for (const L of pageLinks) links.add(L);
    const added = links.size - before;
    if (added === 0) break; // no new items → stop
    if (links.size >= MAX_ITEMS) break;
  }
  return [...links];
}

function itemXML({ title, link, pubDate, description }) {
  return `
<item>
  <title>${xmlEscape(title || "")}</title>
  <link>${xmlEscape(link)}</link>
  <guid>${xmlEscape(link)}</guid>
  <pubDate>${new Date(pubDate).toUTCString()}</pubDate>
  <description>${xmlEscape(description || "")} (Source: GlobeNewswire)</description>
</item>`;
}

function wrapRSS(itemsXML) {
  const now = new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Geomega — GlobeNewswire (Merged)</title>
<link>https://christiangomezstudio.github.io/geomega-rss/rss.xml</link>
<description>Merged GlobeNewswire items for Geomega (GitHub Pages build).</description>
<lastBuildDate>${now}</lastBuildDate>
${itemsXML.join("\n")}
</channel>
</rss>`;
}

async function scrapeArticle(url) {
  const html = await getText(url);
  const jsonld = parseJSONLD(html);

  // Prefer NewsArticle schema
  const news = jsonld.find(
    (b) =>
      (b["@type"] === "NewsArticle" || b["@type"] === "Article") &&
      (b.headline || b.name)
  );

  // Fallbacks
  const title =
    (news && (first(news.headline) || first(news.name))) ||
    (html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]) ||
    (html.match(/<title>(.*?)<\/title>/i)?.[1]) ||
    "Untitled";

  const pubDateRaw =
    (news && (first(news.datePublished) || first(news.dateCreated))) ||
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ||
    html.match(/<meta property="article:published_time" content="([^"]+)"/i)?.[1];

  const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();

  // Short description: prefer JSON-LD description or first paragraph text
  const desc =
    (news && first(news.description)) ||
    html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1] ||
    html
      .replace(/\s+/g, " ")
      .match(/<div class="gnw-article__content">.*?<p>(.*?)<\/p>/i)?.[1] ||
    "";

  return { title, link: url, pubDate, description: desc };
}

async function main() {
  const allLinks = await collectArticleLinks();

  // Fetch articles ( newest-first helps if API throttles )
  const items = [];
  for (const url of allLinks) {
    try {
      const item = await scrapeArticle(url);
      items.push(item);
    } catch (_) {
      // skip broken page
    }
  }

  // Sort by pubDate desc, keep MAX_ITEMS
  items.sort((a, b) => b.pubDate - a.pubDate);
  const limited = items.slice(0, MAX_ITEMS);

  // Build RSS
  const itemsXML = limited.map(itemXML);
  const rss = wrapRSS(itemsXML);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, rss, "utf8");
  console.log(`Wrote ${limited.length} items → ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
