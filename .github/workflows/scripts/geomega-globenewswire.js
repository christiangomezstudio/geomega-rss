// scripts/geomega-globenewswire.js
import fetch from "node-fetch";
import fs from "fs";
import { XMLBuilder } from "fast-xml-parser";

const keyword = "Geomega";
const maxPages = 20; // fetch up to 400 results
const all = [];

for (let page = 1; page <= maxPages; page++) {
  const url = `https://www.globenewswire.com/api/Search/NewsSearch?keyword=${encodeURIComponent(
    keyword
  )}&page=${page}&pageSize=20&language=en`;

  const res = await fetch(url);
  if (!res.ok) break;
  const data = await res.json();

  if (!data.NewsResults?.length) break;
  for (const n of data.NewsResults) {
    all.push({
      title: n.Title,
      link: `https://www.globenewswire.com/news-release/${n.NewsID}/0/en/${encodeURIComponent(
        n.Title.replace(/\s+/g, "-")
      )}.html`,
      guid: n.NewsID,
      pubDate: new Date(n.PublishDate).toUTCString(),
      description: n.TeaserText || "",
    });
  }
  if (data.NewsResults.length < 20) break;
}

all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
const rss = builder.build({
  rss: {
    "@_version": "2.0",
    channel: {
      title: `GlobeNewswire — ${keyword}`,
      link: `https://www.globenewswire.com/search/keyword/${keyword}`,
      description: `All GlobeNewswire releases for ${keyword}`,
      lastBuildDate: new Date().toUTCString(),
      item: all,
    },
  },
});

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/rss.xml", rss);
console.log(`✅ Created docs/rss.xml with ${all.length} items.`);
