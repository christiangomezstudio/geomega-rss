#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build a GlobeNewswire-only RSS feed and publish it as docs/rss.xml
- Input: one or more RSS feeds (GlobeNewswire-only)
- Output: merged, de-duplicated, newest-first RSS 2.0 at docs/rss.xml
"""

import hashlib
import time
import email.utils as eut
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import xml.etree.ElementTree as ET

# ---------------------------
# CONFIG — GLOBE ONLY
# ---------------------------
FEEDS = [
    # Your GlobeNewswire search feed (from earlier):
    "https://rss.app/feeds/ONebqtvoXhDJAEzd.xml",
    # If you later find other GlobeNewswire RSS endpoints, just add them here.
]

OUTPUT_PATH = "docs/rss.xml"
FEED_TITLE = "Geomega — GlobeNewswire (Merged)"
FEED_LINK  = "https://christiangomezstudio.github.io/geomega-rss/rss.xml"
FEED_DESC  = "Merged GlobeNewswire items for Geomega (GitHub Pages build)."
MAX_ITEMS  = 1000  # cap for safety

# ---------------------------
# UTIL
# ---------------------------
def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")

def parse_rss(xml_text: str):
    """
    Very tolerant RSS item parser. Returns list of dicts with:
    title, link, pubDate (RFC2822), description, guid
    """
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    # RSS 2.0: <rss><channel><item>
    chan = root.find("./channel")
    if chan is None:
        # Atom fallback (not expected but just in case)
        # Map Atom <entry> to RSS-like dict
        for entry in root.findall(".//{http://www.w3.org/2005/Atom}entry"):
            title = (entry.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
            link_el = entry.find("{http://www.w3.org/2005/Atom}link")
            link = (link_el.get("href") if link_el is not None else "").strip()
            updated = (entry.findtext("{http://www.w3.org/2005/Atom}updated") or "").strip()
            summary = (entry.findtext("{http://www.w3.org/2005/Atom}summary") or "").strip()
            guid = link or (title + updated)

            # Convert ISO8601 -> RFC2822 if possible
            pub_rfc2822 = updated
            try:
                # crude ISO8601 -> epoch -> RFC2822
                from datetime import datetime
                dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                pub_rfc2822 = eut.formatdate(dt.timestamp(), usegmt=True)
            except Exception:
                pass

            items.append({
                "title": title,
                "link": link,
                "pubDate": pub_rfc2822,
                "description": summary,
                "guid": guid
            })
        return items

    for it in chan.findall("./item"):
        title = (it.findtext("title") or "").strip()
        link  = (it.findtext("link") or "").strip()
        pub   = (it.findtext("pubDate") or "").strip()
        desc  = (it.findtext("description") or "").strip()
        guid  = (it.findtext("guid") or "").strip() or link or (title + pub)

        # Ensure pubDate is RFC2822 (some feeds omit or use other formats)
        if not pub:
            # best-effort: now
            pub = eut.formatdate(time.time(), usegmt=True)

        items.append({
            "title": title,
            "link": link,
            "pubDate": pub,
            "description": desc,
            "guid": guid
        })
    return items

def as_epoch(pub_date: str) -> float:
    try:
        # RSS pubDate typically RFC2822
        tt = eut.parsedate_to_datetime(pub_date)
        return tt.timestamp()
    except Exception:
        return 0.0

def build_guid_key(item: dict) -> str:
    base = item.get("guid") or (item.get("link") or "") or (item.get("title","") + item.get("pubDate",""))
    return hashlib.sha1(base.encode("utf-8", errors="ignore")).hexdigest()

# ---------------------------
# MAIN
# ---------------------------
def main():
    all_items = []
    for url in FEEDS:
        try:
            xml_text = fetch(url)
            items = parse_rss(xml_text)
            all_items.extend(items)
        except (URLError, HTTPError) as e:
            # Skip on fetch errors
            continue
        except Exception:
            continue

    # De-dupe by GUID/link hash
    seen = set()
    unique = []
    for it in all_items:
        key = build_guid_key(it)
        if key in seen:
            continue
        seen.add(key)
        # append a source marker at the end of description for front-end labeling (optional)
        desc = (it.get("description") or "").strip()
        if "(Source:" not in desc:
            # Always mark as GlobeNewswire for this feed
            if desc:
                desc = f"{desc}\n(Source: GlobeNewswire)"
            else:
                desc = "(Source: GlobeNewswire)"
        it["description"] = desc
        unique.append(it)

    # Sort newest first
    unique.sort(key=lambda x: as_epoch(x.get("pubDate","")), reverse=True)
    unique = unique[:MAX_ITEMS]

    # Build minimal RSS 2.0
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")

    ET.SubElement(channel, "title").text = FEED_TITLE
    ET.SubElement(channel, "link").text  = FEED_LINK
    ET.SubElement(channel, "description").text = FEED_DESC
    ET.SubElement(channel, "lastBuildDate").text = eut.formatdate(time.time(), usegmt=True)

    for it in unique:
        el = ET.SubElement(channel, "item")
        ET.SubElement(el, "title").text = it.get("title","")
        ET.SubElement(el, "link").text  = it.get("link","")
        ET.SubElement(el, "guid").text  = it.get("guid","") or it.get("link","")
        ET.SubElement(el, "pubDate").text = it.get("pubDate","")
        # description must be inside CDATA if it might contain HTML entities
        desc_el = ET.SubElement(el, "description")
        # Use a simple escape; for safety we wrap as plain text (front-end strips HTML anyway)
        desc_el.text = it.get("description","")

    # Ensure docs/ exists
    import os
    os.makedirs("docs", exist_ok=True)

    # Write pretty
    ET.indent(rss)  # Python 3.9+
    ET.ElementTree(rss).write(OUTPUT_PATH, encoding="utf-8", xml_declaration=True)

if __name__ == "__main__":
    main()
