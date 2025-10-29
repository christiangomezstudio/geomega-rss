// geomega-globenewswire-rss.js
import fetch from "node-fetch";
import fs from "fs";
import { XMLBuilder } from "fast-xml-parser";

const keyword = "Geomega";
const maxPages = 20; // fetch up to 20 pages (~400 results)
const items = [];

for (let page = 1; page <= maxPages; page++) {
  const url = `https://www.globenewswire.com/api/Search/NewsSearch?keyword=${encodeURIComponent(
    keyword
  )}&page=${page}&pageSize=20&language=en`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.NewsResults?.length) break;

  data.NewsResults.forEach((n) => {
    items.push({
      title: n.Title,
      link: `https://www.globenewswire.com/news-release/${n.NewsID}/0/en/${encodeURIComponent(
        n.Title.replace(/\s+/g, "-")
      )}.html`,
      guid: n.NewsID,
      pubDate: new Date(n.PublishDate).toUTCString(),
      description: n.TeaserText || "GlobeNewswire press release",
    });
  });
  // break if less than pageSize (end of results)
  if (data.NewsResults.length < 20) break;
}

// build RSS XML
const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
const xml = builder.build({
  rss: {
    "@_version": "2.0",
    channel: {
      title: `GlobeNewswire — ${keyword} Press Releases`,
      link: `https://www.globenewswire.com/search/keyword/${keyword}`,
      description: `All GlobeNewswire results for ${keyword}`,
      lastBuildDate: new Date().toUTCString(),
      item: items,
    },
  },
});

// write to file
fs.writeFileSync("rss-globenewswire-geomega.xml", xml);
console.log(`✅ RSS generated with ${items.length} items.`);
