#!/usr/bin/env python3
# Merges multiple RSS/Atom feeds, dedupes, sorts, and writes docs/rss.xml

import os
import time
import html
from datetime import datetime, timezone
from email.utils import format_datetime
import feedparser
import xml.etree.ElementTree as ET

# ======== CONFIG ========
FEEDS = [
    # Newsfile (Geomega full)
    "https://feeds.newsfilecorp.com/company/11749/full",
    # GlobeNewswire via RSS.app (your feed)
    "https://rss.app/feeds/ONebqtvoXhDJAEzd.xml",
]
MAX_ITEMS = 1000  # keep up to this many newest items
CHANNEL_TITLE = "GEOMEGA — Merged Press Releases (Newsfile + GlobeNewswire)"
CHANNEL_LINK  = "https://www.geomega.ca/"
CHANNEL_DESC  = "Merged feed combining Newsfile and GlobeNewswire results for Geomega."
OUTPUT_PATH   = os.path.join("docs", "rss.xml")
# ========================

def _best_dt(entry):
    """
    Try to get a timezone-aware datetime from an entry.
    Uses published_parsed, then updated_parsed, else now().
    """
    dt_tuple = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if dt_tuple:
        # time.struct_time -> aware datetime (UTC)
        return datetime.fromtimestamp(time.mktime(dt_tuple), tz=timezone.utc)
    # Fallback: current time (UTC)
    return datetime.now(tz=timezone.utc)

def _text(field):
    return (field or "").strip()

def collect_items(url):
    d = feedparser.parse(url)
    items = []
    for e in d.entries:
        title = _text(getattr(e, "title", ""))
        link  = _text(getattr(e, "link", ""))
        desc  = _text(getattr(e, "summary", "")) or _text(getattr(e, "description", ""))
        dt    = _best_dt(e)
        src   = "Newsfile" if "newsfilecorp" in url else ("GlobeNewswire" if "rss.app" in url or "globenewswire" in url else "Source")
        if not link and hasattr(e, "id"):
            link = _text(e.id)
        if not title and link:
            title = link
        items.append({
            "title": title,
            "link": link,
            "desc": desc,
            "date": dt,
            "source": src,
        })
    return items

def build_rss(items):
    # Root
    rss = ET.Element("rss", attrib={"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = CHANNEL_TITLE
    ET.SubElement(channel, "link").text = CHANNEL_LINK
    ET.SubElement(channel, "description").text = CHANNEL_DESC
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(datetime.now(timezone.utc))

    for it in items:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = it["title"]
        ET.SubElement(item, "link").text = it["link"]
        ET.SubElement(item, "guid").text = it["link"] or (it["title"] + str(it["date"].timestamp()))
        ET.SubElement(item, "pubDate").text = format_datetime(it["date"])
        desc_text = it["desc"]
        if it["source"]:
            # Append a small source note
            desc_text = f"{desc_text}\n\n(Source: {it['source']})" if desc_text else f"(Source: {it['source']})"
        # Minimal escaping; many readers accept plain text description
        ET.SubElement(item, "description").text = html.escape(desc_text)

    return rss

def main():
    # 1) Fetch and merge
    merged = []
    for url in FEEDS:
        try:
            merged.extend(collect_items(url))
        except Exception as ex:
            print(f"[WARN] Failed parsing {url}: {ex}")

    # 2) Deduplicate by link, then by (title,date)
    seen_links = set()
    unique = []
    for it in merged:
        key = it["link"].strip()
        if key and key not in seen_links:
            seen_links.add(key)
            unique.append(it)
        elif not key:
            alt_key = (it["title"], it["date"].isoformat())
            if alt_key not in seen_links:
                seen_links.add(alt_key)
                unique.append(it)

    # 3) Sort newest first
    unique.sort(key=lambda x: x["date"], reverse=True)

    # 4) Trim
    unique = unique[:MAX_ITEMS]

    # 5) Build XML
    rss = build_rss(unique)

    # 6) Ensure docs/ exists and write
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    tree = ET.ElementTree(rss)
    # Pretty print
    ET.indent(tree, space="  ", level=0)
    tree.write(OUTPUT_PATH, encoding="utf-8", xml_declaration=True)
    print(f"[OK] Wrote {OUTPUT_PATH} with {len(unique)} items.")

if __name__ == "__main__":
    main()
