// generate_rss.mjs — Full Geomega GlobeNewswire feed using their JSON API
import fs from "fs";
import fetch from "node-fetch";

const KEYWORD = "geomega";
const OUT = "docs/rss.xml";
const MAX_PAGES = 200; // fetch up to 200 pages × 20 results = 4000+ items
const API = "https://www.globenewswire.com/JsonFeed/Search";

// helper
function esc(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function getPage(page) {
  const url = `${API}?keyword=${KEYWORD}&page=${page}&pageSize=20&language=en`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const json = await r.json();
  return json.items || [];
}

async function main() {
  console.log("🔍 Fetching GlobeNewswire JSON feed...");
  let all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const items = await getPage(p);
    if (!items.length) break;
    all = all.concat(items);
    console.log(`Page ${p}: +${items.length} items (total ${all.length})`);
    if (items.length < 20) break;
  }

  const formatted = all.map((x) => ({
    title: x.title?.trim() || "Untitled",
    link: `https://www.globenewswire.com${x.url}`,
    pubDate: new Date(x.date).toUTCString(),
    description: `${x.intro || ""} (Source: GlobeNewswire)`
  }));

  formatted.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const itemsXML = formatted
    .map(
      (i) => `
<item>
  <title>${esc(i.title)}</title>
  <link>${esc(i.link)}</link>
  <guid>${esc(i.link)}</guid>
  <pubDate>${i.pubDate}</pubDate>
  <description>${esc(i.description)}</description>
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
  ${itemsXML}
</channel>
</rss>`;

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(OUT, xml);
  console.log(`✅ Done — wrote ${formatted.length} items to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
