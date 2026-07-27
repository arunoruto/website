#!/usr/bin/env python3
"""Fetch publications from ORCID (+ Crossref for DOI'd entries) and write
publications.bib and data/publications.json from the same fetch, in one pass.

This is a full regeneration each run, not a merge into an existing .bib -
hand edits to publications.bib will not survive a re-sync.

Duplicate works (e.g. a journal article and its arXiv preprint) are merged
into a single entry, keyed by a normalized title. The most authoritative
version (see TYPE_PRIORITY) is kept as the canonical record; any fields it
is missing are filled in from the duplicate.

Uses only the Python standard library - no pip install required.
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ORCID_ID = os.environ.get("ORCID_ID", "0000-0002-1631-7083")
CONTACT = "website-publications-sync (https://arnaut.me; mailto:mirza.arnaut@tu-dortmund.de)"

# Lower number = more authoritative version, wins as the canonical record
# when the same work appears multiple times under different ORCID types.
TYPE_PRIORITY = {
    "journal-article": 1,
    "conference-paper": 2,
    "conference-abstract": 3,
    "preprint": 4,
    "working-paper": 5,
}
BIB_TYPE = {
    "journal-article": "article",
    "conference-paper": "inproceedings",
    "conference-abstract": "inproceedings",
    "preprint": "unpublished",
    "working-paper": "techreport",
}
CATEGORY = {
    "journal-article": "journal",
    "conference-paper": "conference",
    "conference-abstract": "conference",
}
VENUE_FIELD = {"article": "journal", "inproceedings": "booktitle", "techreport": "institution"}


def log(message: str) -> None:
    print(message, file=sys.stderr)


def repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    )
    return Path(result.stdout.strip())


def fetch_json(url: str, retries: int = 2) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": CONTACT})
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < retries:
                time.sleep(1)
    raise RuntimeError(f"Failed to fetch {url}") from last_error


def fetch_crossref(doi: str) -> dict[str, Any]:
    try:
        return fetch_json(f"https://api.crossref.org/works/{doi}").get("message", {})
    except RuntimeError as error:
        log(f"  Crossref lookup failed for {doi}, continuing without it: {error}")
        return {}


def extract_doi(work: dict[str, Any]) -> str | None:
    for external_id in (work.get("external-ids") or {}).get("external-id") or []:
        if external_id.get("external-id-type") == "doi":
            return external_id.get("external-id-value")
    return None


def extract_url(work: dict[str, Any], doi: str | None) -> str | None:
    direct_url = (work.get("url") or {}).get("value")
    if direct_url:
        return direct_url
    for external_id in (work.get("external-ids") or {}).get("external-id") or []:
        if external_id.get("external-id-relationship") == "self" and external_id.get("external-id-url"):
            return external_id["external-id-url"]["value"]
    if doi:
        return f"https://doi.org/{doi}"
    return None


def clean_abstract(text: str | None) -> str | None:
    """Crossref abstracts are JATS-XML fragments, sometimes with entities
    escaped twice (e.g. "&amp;amp;" for a literal "&") - unescape twice."""
    if not text:
        return None
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(html.unescape(text))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def build_entry(orcid_type: str, work: dict[str, Any]) -> dict[str, Any]:
    doi = extract_doi(work)
    crossref = fetch_crossref(doi) if doi else {}

    authors = [
        contributor["credit-name"]["value"]
        for contributor in (work.get("contributors") or {}).get("contributor") or []
        if contributor.get("credit-name")
    ]
    publication_date = work.get("publication-date") or {}
    venue = (work.get("journal-title") or {}).get("value")
    if not venue:
        container_titles = crossref.get("container-title") or []
        venue = container_titles[0] if container_titles else None

    return {
        "orcidType": orcid_type,
        "orcidPutCode": work.get("put-code"),
        "title": (work.get("title") or {}).get("title", {}).get("value", ""),
        "authors": authors,
        "year": (publication_date.get("year") or {}).get("value"),
        "month": (publication_date.get("month") or {}).get("value"),
        "venue": venue,
        "publisher": crossref.get("publisher"),
        "doi": doi,
        "url": extract_url(work, doi),
        "citations": crossref.get("is-referenced-by-count"),
        "abstract": clean_abstract(crossref.get("abstract")),
        "bibType": BIB_TYPE.get(orcid_type, "misc"),
        "category": CATEGORY.get(orcid_type, "other"),
    }


def normalized_title(title: str) -> str:
    return re.sub(r"[^a-z]", "", title.lower())


def dedupe(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge entries that represent the same work (matched by normalized
    title) into one record. The higher-priority type is processed first and
    kept as the canonical record; later duplicates only fill in fields the
    canonical record is missing, and are otherwise dropped."""
    ordered = sorted(entries, key=lambda e: TYPE_PRIORITY.get(e["orcidType"], 6))
    merged: dict[str, dict[str, Any]] = {}
    key_order: list[str] = []

    for entry in ordered:
        key = normalized_title(entry["title"]) or f"_{entry.get('orcidPutCode')}"
        if key not in merged:
            merged[key] = entry
            key_order.append(key)
            continue
        canonical = merged[key]
        if len(entry["authors"]) > len(canonical["authors"]):
            canonical["authors"] = entry["authors"]
        for field in ("year", "month", "venue", "publisher", "doi", "url", "citations", "abstract"):
            if not canonical.get(field):
                canonical[field] = entry.get(field)

    return [merged[key] for key in key_order]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def first_author_last_name(authors: list[str]) -> str:
    if not authors:
        return "unknown"
    name = authors[0]
    return name.split(",")[0] if "," in name else name.split(" ")[-1]


def assign_citekeys(entries: list[dict[str, Any]]) -> None:
    seen: dict[str, int] = {}
    for entry in entries:
        first_title_word = (entry["title"].split(" ") or [""])[0]
        base = slug(first_author_last_name(entry["authors"])) + str(entry.get("year") or "nd") + slug(first_title_word)
        count = seen.get(base, 0)
        seen[base] = count + 1
        entry["citekey"] = base if count == 0 else f"{base}{count}"


def escape_bib(value: str) -> str:
    return value.replace("{", "").replace("}", "")


def to_bibtex(entries: list[dict[str, Any]]) -> str:
    blocks = []
    for entry in entries:
        lines = [f"@{entry['bibType']}{{{entry['citekey']},", f"  title = {{{escape_bib(entry['title'])}}},"]
        if entry["authors"]:
            lines.append(f"  author = {{{' and '.join(escape_bib(a) for a in entry['authors'])}}},")
        if entry.get("year"):
            lines.append(f"  year = {{{entry['year']}}},")
        if entry.get("month"):
            lines.append(f"  month = {{{entry['month']}}},")
        if entry.get("venue"):
            field = VENUE_FIELD.get(entry["bibType"], "note")
            lines.append(f"  {field} = {{{escape_bib(entry['venue'])}}},")
        if entry.get("publisher"):
            lines.append(f"  publisher = {{{escape_bib(entry['publisher'])}}},")
        if entry.get("doi"):
            lines.append(f"  doi = {{{entry['doi']}}},")
        if entry.get("url"):
            lines.append(f"  url = {{{entry['url']}}},")
        if entry.get("citations"):
            lines.append(f"  citations = {{{entry['citations']}}},")
        if entry.get("abstract"):
            lines.append(f"  abstract = {{{escape_bib(entry['abstract'])}}},")
        lines.append(f"  orcidtype = {{{entry['orcidType']}}},")
        if entry.get("orcidPutCode"):
            lines.append(f"  orcidputcode = {{{entry['orcidPutCode']}}},")
        lines.append("}\n")
        blocks.append("\n".join(lines))
    return "\n".join(blocks) + "\n"


def main() -> None:
    root = repo_root()

    log(f"Fetching ORCID works summary for {ORCID_ID}...")
    works = fetch_json(f"https://pub.orcid.org/v3.0/{ORCID_ID}/works")

    entries = []
    for group in works.get("group", []):
        summary = group["work-summary"][0]
        path = summary["path"]
        log(f"Fetching work {path}...")
        work = fetch_json(f"https://pub.orcid.org/v3.0{path}")
        entries.append(build_entry(summary["type"], work))

    log(f"Fetched {len(entries)} publications, deduplicating...")
    entries = dedupe(entries)
    entries.sort(key=lambda e: str(e.get("year") or ""), reverse=True)
    assign_citekeys(entries)
    log(f"{len(entries)} publications after deduplication.")

    json_out = root / "data" / "publications.json"
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
    log(f"Wrote {len(entries)} entries to {json_out}")

    bib_out = root / "publications.bib"
    bib_out.write_text(to_bibtex(entries))
    log(f"Wrote {len(entries)} entries to {bib_out}")


if __name__ == "__main__":
    main()
