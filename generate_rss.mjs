// generate_rss.mjs
// Build a merged RSS for Geomega from GlobeNewswire search pages.
// Requires: Node 20+. No external deps.
// Output: docs/rss.xml

import { writeFileSync, mkdirSync } from "fs";
import crypto from "crypto";

const UA = "geomega-rss/1.0 (+github actions; contact: site-admin)";
const OUTFILE = "docs/rss.xml";

// Tweak these if needed.
const MAX_PAGES = 200;         // safety cap (should be plenty)
const PER_PAGE_DELAY_MS = 500; // be polite
const FETCH_TIMEOUT_MS = 15000;

// Search endpoints we’ll crawl & merge (keyword + generic search).
const SEARCH_BASES = [
  "https://www.globenewswire.com/search/keyword/geomega",
  "https://www.globenewswire.com/search/keyword/GMA",          // TSX-V ticker sometimes appears
  "https://www.globenewswire.com/search/keyword/Geomega%20Resources",
];

// ===== helpers =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    signal: controller.signal,
  })
    .then((res) => {
      clearTimeout(t);
      return res;
    })
    .catch((err) => {
      clearTimeout(t);
      throw err;
    });
}

async function getText(url) {
  const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS, url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return await res.text();
}

function absolutize(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return "https://www.globenewswire.com" + href;
  return null;
}

function uniq(array) {
  return [...new Set(array)];
}

function hashGuid(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function rssEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Very forgiving extractors that don’t need cheerio
function metaContent(html, prop) {
  const re = new RegExp(
    `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function nameContent(html, name) {
  const re = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function firstH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  // strip tags inside h1
  return m[1].replace(/<[^>]*>/g, "").trim();
}

function articleBodySnippet(html) {
  // Try JSON-LD description
  const ld = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (ld) {
    try {
      const json = JSON.parse(ld[1]);
      const d =
        (Array.isArray(json) ? json[0]?.description : json?.description) || "";
      if (d) return d;
    } catch {}
  }
  // Fallback: first paragraph after the header block
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return "";
  return m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function parseDate(html) {
  // Prefer OpenGraph / article meta
  const og = metaContent(html, "article:published_time") || metaContent(html, "og:updated_time");
  if (og) return new Date(og);
  const timeAttr = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (timeAttr) return new Date(timeAttr[1]);
  // VERY weak fallback: try to read a typical “Month DD, YYYY” on page
  const m = html.match(
    /([A-Z][a-z]+)\s+\d{1,2},\s+\d{4}/
  );
  if (m) return new Date(m[0]);
  return null;
}

function includeThisArticle(html) {
  // Keep only items that clearly mention Geomega
  return /Geomega/i.test(html) || /Géo?mega/i.test(html);
}

// ===== crawl search pages, gather article URLs =====
async function gatherArticleLinks() {
  const urls = new Set();

  for (const base of SEARCH_BASES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? base : `${base}?page=${page}`;
      console.log(`🔎 Listing: ${url}`);
      let html;
      try {
        html = await getText(url);
      } catch (e) {
        console.warn(`⚠️  Skipping page (${e.message})`);
        break; // likely no more pages or throttled; move to next base
      }

      // If this page is identical to previous (or empty), break
      const links = [];
      // Match both absolute and relative article links
      const re =
        /href=["'](\/news-release\/[^"']+|https:\/\/www\.globenewswire\.com\/news-release\/[^"']+)["']/gi;
      let m;
      while ((m = re.exec(html))) {
        const a = absolutize(m[1]);
        if (a) links.push(a);
      }

      const beforeCount = urls.size;
      links.forEach((l) => urls.add(l));

      console.log(
        `   • found ${links.length} links (unique total: ${urls.size})`
      );

      // Heuristic: if we saw no new links, assume we’re done with this base
      if (urls.size === beforeCount) {
        break;
      }

      // If list page shows no “news-release” links, also stop
      if (links.length === 0) break;

      await sleep(PER_PAGE_DELAY_MS);
    }
  }

  return [...urls];
}

// ===== fetch and parse each article =====
async function fetchArticle(url) {
  let html;
  try {
    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS, url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    console.warn(`   ⛔ ${url} -> ${e.message}`);
    return null;
  }

  if (!includeThisArticle(html)) {
    // Not actually about Geomega—skip noise results
    return null;
  }

  const title =
    metaContent(html, "og:title") || firstH1(html) || "Untitled Release";

  const img =
    metaContent(html, "og:image") || metaContent(html, "twitter:image") || "";

  const desc =
    metaContent(html, "og:description") ||
    nameContent(html, "description") ||
    articleBodySnippet(html) ||
    "";

  const dt = parseDate(html) || new Date();

  // Build a compact HTML description with an optional image
  const safeDesc = rssEscape(desc);
  const imgTag = img ? `<img src="${img}" style="width: 100%;" />` : "";
  const description = imgTag
    ? `<div>${imgTag}<div>${safeDesc}</div></div>`
    : safeDesc;

  return {
    title: title.trim(),
    link: url,
    guid: hashGuid(url),
    pubDate: dt.toUTCString(),
    description,
  };
}

// ===== build RSS XML =====
function buildRSS(items) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n<title>Geomega — GlobeNewswire (Merged)</title>\n<link>https://www.globenewswire.com/search/keyword/geomega</link>\n<description>Merged GlobeNewswire items for Geomega (GitHub Pages build).</description>\n<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;

  const body = items
    .map((it) => {
      return `<item>
<title>${rssEscape(it.title)}</title>
<link>${rssEscape(it.link)}</link>
<guid>${rssEscape(it.guid)}</guid>
<pubDate>${rssEscape(it.pubDate)}</pubDate>
<description>
${it.description}
</description>
</item>`;
    })
    .join("\n");

  const footer = `\n</channel>\n</rss>\n`;
  return header + body + footer;
}

// ===== main =====
(async () => {
  try {
    console.log("🏁 Starting crawl…");
    const articleLinks = await gatherArticleLinks();

    console.log(`🧮 Unique candidate links: ${articleLinks.length}`);

    const seen = new Set();
    const items = [];
    let count = 0;

    for (const link of articleLinks) {
      if (seen.has(link)) continue;
      seen.add(link);

      // Only accept proper news-release pages
      if (!/https:\/\/www\.globenewswire\.com\/news-release\//i.test(link)) {
        continue;
      }

      console.log(`📰 Fetching [${++count}/${articleLinks.length}]: ${link}`);
      const item = await fetchArticle(link);
      if (item) items.push(item);

      await sleep(250); // polite spacing between article fetches
    }

    // Sort newest first & hard-dedupe by GUID
    const byGuid = new Map();
    for (const it of items) {
      if (!byGuid.has(it.guid)) byGuid.set(it.guid, it);
    }
    const deduped = [...byGuid.values()].sort(
      (a, b) => new Date(b.pubDate) - new Date(a.pubDate)
    );

    const xml = buildRSS(deduped);
    mkdirSync("docs", { recursive: true });
    writeFileSync(OUTFILE, xml, "utf8");

    console.log(`✅ Wrote ${OUTFILE} with ${deduped.length} items.`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Build failed:", err?.stack || err);
    process.exit(1);
  }
})();
