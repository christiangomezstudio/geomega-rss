// generate_rss.mjs
import fs from "fs";
import fetch from "node-fetch";
import { XMLBuilder } from "fast-xml-parser";

const OUTPUT_FILE = "docs/rss.xml";
const BASE_URL =
  "https://www.globenewswire.com/search/keyword/geomega?kw=geomega&page=";

async function fetchAllPages() {
  let allItems = [];
  let page = 1;

  while (true) {
    console.log(`Fetching page ${page}...`);
    const res = await fetch(`${BASE_URL}${page}`);
    const html = await res.text();

    const matches = [
      ...html.matchAll(/href="(\/news-release\/[^"]+)"/g),
    ].map((m) => m[1]);

    if (matches.length === 0) break; // no more pages
    console.log(`→ found ${matches.length} releases on page ${page}`);

    for (const path of matches) {
      const url = `https://www.globenewswire.com${path}`;
      const itemHtml = await fetch(url).then((r) => r.text());
      const titleMatch = itemHtml.match(/<title>(.*?)<\/title>/i);
      const dateMatch = itemHtml.match(
        /content="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z"/
      );
      const descMatch = itemHtml.match(
        /<meta name="description" content="(.*?)"/i
      );
      const imgMatch = itemHtml.match(
        /https:\/\/ml\.globenewswire\.com\/Resource\/Download\/[^\s"']+/i
      );

      allItems.push({
        title: titleMatch ? titleMatch[1].replace(" - GlobeNewswire", "") : url,
        link: url,
        guid: Buffer.from(url).toString("hex").slice(0, 32),
        pubDate: dateMatch
          ? new Date(dateMatch[1]).toUTCString()
          : new Date().toUTCString(),
        description:
          `<div>` +
          (imgMatch
            ? `<img src="${imgMatch[0]}" style="width:100%;"/><br>`
            : "") +
          (descMatch ? descMatch[1] : "") +
          ` (Source: GlobeNewswire)</div>`,
      });
    }

    page++;
  }

  return allItems;
}

async function main() {
  const items = await fetchAllPages();
  console.log(`Total collected: ${items.length}`);

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
  });

  const feed = {
    rss: {
      "@_version": "2.0",
      channel: {
        title: "Geomega — GlobeNewswire (All Pages)",
        link: "https://www.globenewswire.com/search/keyword/geomega",
        description: "Full GlobeNewswire results for geomega",
        lastBuildDate: new Date().toUTCString(),
        item: items,
      },
    },
  };

  const xmlContent = builder.build(feed);
  fs.writeFileSync(OUTPUT_FILE, xmlContent, "utf8");
  console.log(`✅ RSS written to ${OUTPUT_FILE}`);
}

main().catch((err) => console.error(err));
