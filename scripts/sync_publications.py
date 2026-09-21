#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "bibtexparser~=1.4",
#     "pylatexenc~=2.10",
# ]
# ///
"""Sync publications from Google Scholar, enriched by ORCID and Crossref, and
write data/publications.json, data/publications.bib and data/scholar.json in one pass.

Google Scholar (via SerpApi - Scholar has no official API) is the list of
record: a work appears on the site if it is on the Scholar profile, which is
where merging and curation happen. The one exception bridges Scholar's
indexing lag: an ORCID record from the last ORCID_ONLY_MAX_AGE_MONTHS that
Scholar does not have yet is listed too, until Scholar catches up. Scholar's metadata is
thin though (no DOIs, no work types, truncated author lists), so every
article is enriched, first match wins:

1. ORCID, matched by title - work type, full author list, DOI. ORCID is only
   a lookup table here, so its duplicates are harmless: the best record per
   title is used and the rest are never looked at.
2. Crossref, by DOI where one is known and by bibliographic title search
   where not. A search hit is only trusted when its title matches almost
   exactly (TITLE_MATCH_THRESHOLD): Crossref always returns *something*.
3. Scholar's own per-article page, for works neither of the above knows.
   Each costs one SerpApi search, so the result is reused from the previous
   data/publications.json and only fetched for new articles.

Each entry also gets a link to its ResearchGate page where one exists.
ResearchGate has no API and blocks scrapers, so this is a Google site: search
through SerpApi, trusted only if the title in the page's URL matches. Hits are
kept for good and misses re-checked every RESEARCHGATE_RECHECK_DAYS, both via
the previous data/publications.json, as each lookup costs a search.

data/publications.json is the site's own record of each publication, in its
own structure (see to_record), independent of any one platform: content fields
at the top, "ids" for identifiers, "links" for every page of the work that is
known (publisher, DOI, Scholar, ResearchGate, ...) and "sync" for this
script's bookkeeping. It doubles as the cache the next run starts from.
data/publications.bib is a LaTeX export of the same data and is never read.

Citation counts and the profile metrics in data/scholar.json come from
Scholar. GOOGLE_SCHOLAR_ID and SERPAPI_KEY must be set in the environment;
any Scholar failure aborts the run before anything is written, so the
previously committed data stays in place.

This is a full regeneration each run, not a merge into an existing .bib -
hand edits to data/publications.bib will not survive a re-sync.

Run with `uv run scripts/sync_publications.py` - the dependencies above are
declared inline (PEP 723), so there is no requirements.txt or venv to manage
and uv provisions the interpreter itself.
"""
from __future__ import annotations

import datetime
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import bibtexparser
from bibtexparser.bibdatabase import BibDatabase
from bibtexparser.bwriter import BibTexWriter
from pylatexenc.latexencode import unicode_to_latex

ORCID_ID = os.environ.get("ORCID_ID", "0000-0002-1631-7083")
SCHOLAR_ID = os.environ.get("GOOGLE_SCHOLAR_ID")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY")
SERPAPI_PAGE_SIZE = 100  # SerpApi's maximum for the author engine
RESEARCHGATE_RECHECK_DAYS = 30
# Scholar takes days to weeks to index a new paper. Until it has, an ORCID
# record this recent is listed anyway; an older one that Scholar lacks is taken
# to be one of ORCID's duplicates (or deliberately left off the profile).
ORCID_ONLY_MAX_AGE_MONTHS = 12
CONTACT = "website-publications-sync (https://arnaut.me; mailto:mirza.arnaut@tu-dortmund.de)"

# Minimum similarity of normalized titles for two records to count as the same
# work. For this profile, Crossref's best hit for a work it really has scores
# 1.00 and for one it lacks at most 0.60, so 0.9 tolerates a typo or subtitle
# difference without ever adopting a lookalike's DOI.
TITLE_MATCH_THRESHOLD = 0.9

# Work types use ORCID's vocabulary whichever source they came from. Lower
# number = more authoritative version, wins as the canonical record when the
# same work appears multiple times under different types.
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
CROSSREF_TYPE = {
    "journal-article": "journal-article",
    "proceedings-article": "conference-paper",
    "posted-content": "preprint",
    "report": "working-paper",
}
CONFERENCE_VENUE = re.compile(
    r"conference|meeting|congress|symposium|workshop|proceedings|abstracts|assembly", re.IGNORECASE
)
CATEGORY = {
    "journal-article": "journal",
    "conference-paper": "conference",
    "conference-abstract": "conference",
}
VENUE_FIELD = {"article": "journal", "inproceedings": "booktitle", "techreport": "institution"}

# Machine identifiers, not prose: biblatex wants these verbatim, so they skip
# unicode_to_latex (which would turn a "_" in a URL into "\_"). Only the two
# characters that genuinely break BibTeX parsing inside a braced field are
# escaped - "%" in particular starts a comment and would eat the rest of the entry.
VERBATIM_FIELDS = {"doi", "url", "researchgate", "scholarid"}

# Acronyms bib styles would otherwise lowercase in a title. Applied only to
# titles, and only *after* unicode_to_latex, which escapes braces
# ("{DoLP}" -> "\{DoLP\}") and would destroy the protection if run second.
PROTECTED_ACRONYMS = (
    "DoLP", "AoLP", "PCA", "MSTM5", "DDSCAT", "BVRI", "UBVRI", "LRO", "WAC",
    "NEA", "NEAs", "MAE", "RSA", "VLA", "DoI",
)

# Emitted in this order; anything not listed here is dropped by BibTexWriter.
FIELD_ORDER = (
    "title", "author", "year", "month", "journal", "booktitle", "institution",
    "note", "publisher", "doi", "url", "researchgate", "citations", "abstract",
    "orcidtype", "orcidputcode", "scholarid",
)


def log(message: str) -> None:
    print(message, file=sys.stderr)


def repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    )
    return Path(result.stdout.strip())


def fetch_json(url: str, retries: int = 2, timeout: int = 30) -> dict[str, Any]:
    # SerpApi takes its key as a query parameter - never echo the query string.
    safe_url = url.split("?", 1)[0]
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": CONTACT})
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < retries:
                time.sleep(1)
    raise RuntimeError(f"Failed to fetch {safe_url}: {last_error}") from None


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


def strip_markup(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text))).strip()


def normalized_title(title: str) -> str:
    return re.sub(r"[^a-z]", "", strip_markup(title).lower())


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalized_title(a), normalized_title(b)).ratio()


def search_crossref(title: str, author: str) -> dict[str, Any]:
    """Find a work on Crossref by title. Crossref ranks by relevance and always
    returns something, so the best hit only counts if its title really is the
    same (TITLE_MATCH_THRESHOLD) - otherwise a lookalike's DOI would be adopted."""
    query = urllib.parse.urlencode({"query.bibliographic": title, "query.author": author, "rows": 5})
    try:
        items = fetch_json(f"https://api.crossref.org/works?{query}").get("message", {}).get("items") or []
    except RuntimeError as error:
        log(f"  Crossref search failed, continuing without it: {error}")
        return {}
    scored = [(title_similarity(title, (item.get("title") or [""])[0]), item) for item in items]
    score, best = max(scored, key=lambda pair: pair[0], default=(0.0, {}))
    return best if score >= TITLE_MATCH_THRESHOLD else {}


def blank_entry(title: str) -> dict[str, Any]:
    return {
        "source": "scholar",
        "orcidType": None,
        "orcidPutCode": None,
        "title": title,
        "authors": [],
        "year": None,
        "month": None,
        "venue": None,
        "publisher": None,
        "doi": None,
        "url": None,
        "citations": None,
        "abstract": None,
    }


def orcid_entry(orcid_type: str, work: dict[str, Any]) -> dict[str, Any]:
    doi = extract_doi(work)
    publication_date = work.get("publication-date") or {}
    return blank_entry((work.get("title") or {}).get("title", {}).get("value", "")) | {
        "source": "orcid",
        "orcidType": orcid_type,
        "orcidPutCode": work.get("put-code"),
        "authors": [
            contributor["credit-name"]["value"]
            for contributor in (work.get("contributors") or {}).get("contributor") or []
            if contributor.get("credit-name")
        ],
        "year": (publication_date.get("year") or {}).get("value"),
        "month": (publication_date.get("month") or {}).get("value"),
        "venue": (work.get("journal-title") or {}).get("value"),
        "doi": doi,
        "url": extract_url(work, doi),
    }


def apply_crossref(entry: dict[str, Any], crossref: dict[str, Any]) -> None:
    """Fill in whatever the entry is still missing from a Crossref record."""
    if entry["source"] == "scholar":
        entry["source"] = "crossref"
    date_parts = ((crossref.get("issued") or {}).get("date-parts") or [[]])[0]
    doi = entry["doi"] or crossref.get("DOI")
    candidates = {
        "orcidType": CROSSREF_TYPE.get(crossref.get("type", "")),
        "authors": [
            " ".join(part for part in (author.get("given"), author.get("family")) if part)
            for author in crossref.get("author") or []
        ],
        "year": str(date_parts[0]) if date_parts and date_parts[0] else None,
        "month": f"{date_parts[1]:02d}" if len(date_parts) > 1 else None,
        "venue": strip_markup((crossref.get("container-title") or [""])[0]) or None,
        "publisher": crossref.get("publisher"),
        "doi": doi,
        "url": f"https://doi.org/{doi}" if doi else None,
        "citations": crossref.get("is-referenced-by-count"),
        "abstract": clean_abstract(crossref.get("abstract")),
    }
    for field, value in candidates.items():
        if not entry.get(field):
            entry[field] = value


def fetch_serpapi(**params: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"engine": "google_scholar_author", "api_key": SERPAPI_KEY, **params})
    # SerpApi runs the scrape while the request is open; a Google search
    # regularly takes longer than the default timeout.
    result = fetch_json(f"https://serpapi.com/search.json?{query}", timeout=90)
    if result.get("error"):
        raise RuntimeError(f"SerpApi error: {result['error']}")
    return result


def fetch_scholar_profile() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return the first page of the profile (author info + metrics) and every
    article on it, newest first."""
    first_page: dict[str, Any] = {}
    articles: list[dict[str, Any]] = []
    while True:
        try:
            page = fetch_serpapi(
                author_id=SCHOLAR_ID, sort="pubdate", start=str(len(articles)), num=str(SERPAPI_PAGE_SIZE)
            )
        except RuntimeError:
            # Paging past the end of a profile with exactly N full pages is
            # reported as an error ("no results"), not as an empty page.
            if articles:
                return first_page, articles
            raise
        first_page = first_page or page
        batch = page.get("articles") or []
        articles.extend(batch)
        if len(batch) < SERPAPI_PAGE_SIZE:
            return first_page, articles


def split_authors(authors: str) -> list[str]:
    return [name.strip() for name in authors.split(",") if name.strip(" .…")]


def apply_scholar_details(
    entry: dict[str, Any], article: dict[str, Any], previous: dict[str, dict[str, Any]]
) -> None:
    """Last resort for a work neither ORCID nor Crossref knows: Scholar's own
    page for it, which (unlike the profile listing) has the full author list.
    Costs one SerpApi search, so reuse what the previous run already fetched."""
    cached = previous.get(cache_key(entry))
    if cached and cached.get("source") == "scholar" and cached.get("authors"):
        for field in ("orcidType", "authors", "month", "venue", "publisher", "url", "abstract"):
            entry[field] = cached.get(field)
        return

    log("  Not on ORCID or Crossref, fetching its Scholar page...")
    try:
        citation = fetch_serpapi(view_op="view_citation", citation_id=article["citation_id"]).get("citation") or {}
    except RuntimeError as error:
        log(f"  Scholar page lookup failed, keeping the listing data: {error}")
        citation = {}

    venue = next((citation[label] for label in ("journal", "conference", "book", "source") if citation.get(label)), None)
    # "Venue 12 (3), 45-67, 2024" -> "Venue"
    entry["venue"] = venue or re.sub(r"[\s,]*\d[\d\s(),\-]*$", "", article.get("publication") or "") or None
    # The venue name is the only type hint there is. Scholar's own labels are
    # no help: it files conferences under "journal" as often as not.
    if CONFERENCE_VENUE.search(entry["venue"] or ""):
        entry["orcidType"] = "conference-paper"
    elif citation.get("journal"):
        entry["orcidType"] = "journal-article"
    date_parts = (citation.get("publication_date") or "").split("/")
    entry["month"] = f"{int(date_parts[1]):02d}" if len(date_parts) > 1 and date_parts[1].isdigit() else None
    entry["authors"] = split_authors(citation.get("authors") or article.get("authors") or "")
    entry["publisher"] = citation.get("publisher")
    entry["url"] = citation.get("link") or article.get("link")
    entry["abstract"] = clean_abstract(citation.get("description"))


def find_researchgate(title: str) -> str | None:
    """ResearchGate puts the title in its URLs (/publication/<id>_<Title_words>),
    which is what gets compared: result titles come back truncated."""
    try:
        # Bare words only: quoting the title as a phrase misses pages whose title
        # is punctuated differently, and punctuation like "C/2023 A3 (...)" makes
        # Google drop the site: filter altogether. The slug check does the vetting.
        words = re.sub(r"[^\w\s]", " ", title)
        results = fetch_serpapi(engine="google", q=f"site:researchgate.net/publication {words}", num="5")
    except RuntimeError as error:
        # An empty result page is reported as an error; anything else (quota,
        # network) is a real failure and must not be recorded as "not found".
        if "returned any results" not in str(error):
            raise
        return None
    for result in results.get("organic_results") or []:
        match = re.match(r"https://www\.researchgate\.net/publication/\d+_([^/?#]+)", result.get("link") or "")
        if match and title_similarity(title, match[1].replace("_", " ")) >= TITLE_MATCH_THRESHOLD:
            return match[0]
    return None


def apply_researchgate(entry: dict[str, Any], cached: dict[str, Any] | None) -> None:
    today = datetime.date.today()
    entry["researchGateUrl"] = (cached or {}).get("researchGateUrl")
    entry["researchGateChecked"] = (cached or {}).get("researchGateChecked")
    if entry["researchGateUrl"]:
        return
    if entry["researchGateChecked"]:
        age = today - datetime.date.fromisoformat(entry["researchGateChecked"])
        if age.days < RESEARCHGATE_RECHECK_DAYS:
            return
    try:
        entry["researchGateUrl"] = find_researchgate(entry["title"])
    except RuntimeError as error:
        log(f"  ResearchGate lookup failed, will retry next run: {error}")
        return
    entry["researchGateChecked"] = today.isoformat()
    log(f"  ResearchGate: {entry['researchGateUrl'] or 'not found'}")


def match_orcid(title: str, summaries: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Build the entry for a Scholar title from every ORCID record of that
    work. ORCID often holds the same work several times (journal version,
    preprint, a re-import without DOI); dedupe() folds them into the most
    authoritative one. Records no Scholar article matches are never fetched."""
    matches = [s for s in summaries if title_similarity(title, s["title"]) >= TITLE_MATCH_THRESHOLD]
    if not matches:
        return None
    for summary in matches:
        summary["matched"] = True
    entries = [orcid_entry(s["type"], fetch_json(f"https://pub.orcid.org/v3.0{s['path']}")) for s in matches]
    return dedupe(entries)[0]


def fetch_orcid_summaries() -> list[dict[str, Any]]:
    works = fetch_json(f"https://pub.orcid.org/v3.0/{ORCID_ID}/works")
    return [
        {
            "title": ((summary.get("title") or {}).get("title") or {}).get("value", ""),
            "type": summary["type"],
            "path": summary["path"],
            "date": summary.get("publication-date") or {},
            "matched": False,
        }
        for group in works.get("group", [])
        for summary in group["work-summary"][:1]
    ]


def is_recent(summary: dict[str, Any]) -> bool:
    year = (summary["date"].get("year") or {}).get("value")
    if not year:
        return False
    month = (summary["date"].get("month") or {}).get("value") or "12"
    today = datetime.date.today()
    return (today.year * 12 + today.month) - (int(year) * 12 + int(month)) <= ORCID_ONLY_MAX_AGE_MONTHS


def cache_key(entry: dict[str, Any]) -> str:
    return entry.get("scholarId") or f"orcid:{entry.get('orcidPutCode')}"


def build_entry(
    article: dict[str, Any], summaries: list[dict[str, Any]], author: str, previous: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Build the entry for a Scholar article - or, for a work Scholar does
    not have yet, for a stand-in article carrying nothing but its title."""
    entry = match_orcid(article["title"], summaries) or blank_entry(article["title"])
    entry["scholarId"] = article.get("citation_id")
    crossref = fetch_crossref(entry["doi"]) if entry["doi"] else search_crossref(entry["title"], author)
    if crossref:
        apply_crossref(entry, crossref)
    if entry["source"] == "scholar":
        apply_scholar_details(entry, article, previous)
    apply_researchgate(entry, previous.get(cache_key(entry)))

    cited_by = (article.get("cited_by") or {}).get("value")
    entry["citations"] = cited_by if cited_by is not None else entry["citations"]
    entry["year"] = entry["year"] or article.get("year") or None
    # Built rather than copied: the listing's own link drags the paging and
    # sorting parameters of this script's query along.
    entry["scholarUrl"] = entry["scholarId"] and "https://scholar.google.com/citations?" + urllib.parse.urlencode(
        {"view_op": "view_citation", "user": SCHOLAR_ID, "citation_for_view": entry["scholarId"]}
    )
    entry["scholarCitedByUrl"] = (article.get("cited_by") or {}).get("link")
    entry["orcidType"] = entry["orcidType"] or "other"
    entry["bibType"] = BIB_TYPE.get(entry["orcidType"], "misc")
    entry["category"] = CATEGORY.get(entry["orcidType"], "other")
    return entry


def scholar_metrics(profile: dict[str, Any]) -> dict[str, Any]:
    cited_by = profile.get("cited_by") or {}
    table = {key: value.get("all") for row in cited_by.get("table") or [] for key, value in row.items()}
    return {
        "citations": table.get("citations"),
        "hIndex": table.get("h_index"),
        "i10Index": table.get("i10_index"),
        "citationsPerYear": {str(point["year"]): point["citations"] for point in cited_by.get("graph") or []},
    }


def to_record(entry: dict[str, Any]) -> dict[str, Any]:
    """The published shape of an entry in data/publications.json. Links that
    are not known are left out, so a template can just range over the rest."""
    doi = entry.get("doi")
    doi_url = f"https://doi.org/{doi}" if doi else None
    primary = entry.get("url")
    if primary and re.match(r"https?://(dx\.)?doi\.org/", primary):
        primary = doi_url or primary  # ORCID still hands out http://dx.doi.org/ links
    links = {
        "primary": primary,
        "doi": doi_url,
        "scholar": entry.get("scholarUrl"),
        "scholarCitedBy": entry.get("scholarCitedByUrl"),
        "researchgate": entry.get("researchGateUrl"),
    }
    return {
        "citekey": entry["citekey"],
        "type": entry["orcidType"],
        "bibType": entry["bibType"],
        "category": entry["category"],
        "title": entry["title"],
        "authors": entry["authors"],
        "year": entry.get("year"),
        "month": entry.get("month"),
        "venue": entry.get("venue"),
        "publisher": entry.get("publisher"),
        "abstract": entry.get("abstract"),
        "citations": entry.get("citations"),
        "ids": {"doi": doi, "scholar": entry.get("scholarId"), "orcidPutCode": entry.get("orcidPutCode")},
        "links": {name: url for name, url in links.items() if url},
        "sync": {"source": entry["source"], "researchGateChecked": entry.get("researchGateChecked")},
    }


def from_record(record: dict[str, Any]) -> dict[str, Any]:
    """Inverse of to_record: a record read back as a working entry."""
    ids, links, sync = record.get("ids") or {}, record.get("links") or {}, record.get("sync") or {}
    shared = ("citekey", "bibType", "category", "title", "authors", "year", "month", "venue",
              "publisher", "abstract", "citations")
    return {field: record.get(field) for field in shared} | {
        "source": sync.get("source"),
        "orcidType": record.get("type"),
        "orcidPutCode": ids.get("orcidPutCode"),
        "doi": ids.get("doi"),
        "url": links.get("primary"),
        "scholarId": ids.get("scholar"),
        "scholarUrl": links.get("scholar"),
        "scholarCitedByUrl": links.get("scholarCitedBy"),
        "researchGateUrl": links.get("researchgate"),
        "researchGateChecked": sync.get("researchGateChecked"),
    }


def dedupe(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge entries that represent the same work (matched by normalized
    title) into one record. The higher-priority type is processed first and
    kept as the canonical record; later duplicates only fill in fields the
    canonical record is missing, and are otherwise dropped."""
    ordered = sorted(entries, key=lambda e: TYPE_PRIORITY.get(e["orcidType"], 6))
    merged: dict[str, dict[str, Any]] = {}
    key_order: list[str] = []

    for entry in ordered:
        key = normalized_title(entry["title"]) or f"_{entry.get('orcidPutCode') or entry.get('scholarId')}"
        if key not in merged:
            merged[key] = entry
            key_order.append(key)
            continue
        canonical = merged[key]
        if len(entry["authors"]) > len(canonical["authors"]):
            canonical["authors"] = entry["authors"]
        for field in ("year", "month", "venue", "publisher", "doi", "url", "citations", "abstract", "researchGateUrl"):
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


def protect_acronyms(value: str) -> str:
    for acronym in PROTECTED_ACRONYMS:
        value = re.sub(
            rf"(?<![A-Za-z0-9]){re.escape(acronym)}(?![A-Za-z0-9])", f"{{{acronym}}}", value
        )
    return value


def encode_field(name: str, value: Any) -> str:
    """Render one field value as LaTeX-safe BibTeX.

    Prose fields go through pylatexenc, which handles both the specials that
    break parsing ("&" -> "\\&", "%" -> "\\%") and the non-ASCII that breaks
    pdflatex ("micro" -> "\\ensuremath{\\mu}", "o-umlaut" -> '\\"o').
    """
    text = str(value)
    if name in VERBATIM_FIELDS:
        return text.replace("%", r"\%").replace("#", r"\#")
    text = unicode_to_latex(text)
    return protect_acronyms(text) if name == "title" else text


def to_bibtex(entries: list[dict[str, Any]]) -> str:
    database = BibDatabase()
    for entry in entries:
        record: dict[str, str] = {
            "ENTRYTYPE": entry["bibType"],
            "ID": entry["citekey"],
            "title": encode_field("title", entry["title"]),
            "orcidtype": encode_field("orcidtype", entry["orcidType"]),
        }
        if entry["authors"]:
            record["author"] = " and ".join(encode_field("author", a) for a in entry["authors"])
        if entry.get("venue"):
            record[VENUE_FIELD.get(entry["bibType"], "note")] = encode_field("venue", entry["venue"])
        for source, field in (
            ("year", "year"),
            ("month", "month"),
            ("publisher", "publisher"),
            ("doi", "doi"),
            ("url", "url"),
            ("researchGateUrl", "researchgate"),
            ("citations", "citations"),
            ("abstract", "abstract"),
            ("orcidPutCode", "orcidputcode"),
            ("scholarId", "scholarid"),
        ):
            if entry.get(source):
                record[field] = encode_field(field, entry[source])
        database.entries.append(record)

    writer = BibTexWriter()
    writer.indent = "  "
    writer.display_order = FIELD_ORDER
    writer.order_entries_by = None  # preserve the year-sorted order from main()
    return bibtexparser.dumps(database, writer)


def main() -> None:
    root = repo_root()

    if not (SCHOLAR_ID and SERPAPI_KEY):
        sys.exit("GOOGLE_SCHOLAR_ID and SERPAPI_KEY must be set (locally: in .env, loaded by direnv).")
    json_out = root / "data" / "publications.json"
    previous = {}
    if json_out.exists():
        cached = [from_record(record) for record in json.loads(json_out.read_text())]
        previous = {cache_key(entry): entry for entry in cached}

    log(f"Fetching Google Scholar profile {SCHOLAR_ID}...")
    profile, articles = fetch_scholar_profile()
    if not articles:
        # An empty profile is far more likely a scrape gone wrong than a fact.
        sys.exit("Scholar returned no articles - refusing to blank the publication list.")
    # Crossref's author filter wants a surname; Scholar has the display name.
    author = ((profile.get("author") or {}).get("name") or "").split(" ")[-1]

    log(f"Fetching ORCID works summary for {ORCID_ID}...")
    summaries = fetch_orcid_summaries()

    entries = []
    for article in articles:
        log(f"Resolving \"{article['title']}\"...")
        entries.append(build_entry(article, summaries, author, previous))
        log(f"  -> {entries[-1]['source']}, {entries[-1]['orcidType']}, doi={entries[-1]['doi']}")

    for summary in summaries:
        # build_entry marks every ORCID record of the title as matched, so a
        # work ORCID holds several times is still only picked up once.
        if not summary["matched"] and is_recent(summary):
            log(f"Not on Scholar yet, keeping from ORCID: \"{summary['title']}\"...")
            entries.append(build_entry({"title": summary["title"]}, summaries, author, previous))
            log(f"  -> {entries[-1]['source']}, {entries[-1]['orcidType']}, doi={entries[-1]['doi']}")

    unmatched = [s["title"] for s in summaries if not s["matched"]]
    if unmatched:
        log(f"{len(unmatched)} older ORCID record(s) not on the Scholar profile, skipped:")
        for title in sorted(set(unmatched)):
            log(f"  - {title}")

    # Two Scholar articles that were never merged can resolve to the same work.
    entries = dedupe(entries)
    entries.sort(key=lambda e: str(e.get("year") or ""), reverse=True)
    assign_citekeys(entries)
    log(f"{len(entries)} publications, {len(articles)} of them on Scholar.")

    json_out.parent.mkdir(parents=True, exist_ok=True)
    records = [to_record(entry) for entry in entries]
    json_out.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n")
    log(f"Wrote {len(entries)} entries to {json_out}")

    metrics_out = root / "data" / "scholar.json"
    metrics_out.write_text(json.dumps(scholar_metrics(profile), indent=2) + "\n")
    log(f"Wrote profile metrics to {metrics_out}")

    bib_out = root / "data" / "publications.bib"
    bib_out.write_text(to_bibtex(entries))
    log(f"Wrote {len(entries)} entries to {bib_out}")


if __name__ == "__main__":
    main()
