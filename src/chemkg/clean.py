"""Parse the scraped Wikidata card-view CSV into a canonical, tidy schema.

The raw export is *not* a table. Each row is
    explore href, item-link, card-view-value, (title, value)*
where the *title cell holds the field name* (birthDate, deathDate, countryLabel,
occupationLabel, wikipediaURL) and missing fields are skipped, so a given field
moves between columns from row to row.

`card-view-value` normally holds the item's English *label* (the person's name);
for ~30 items without an English label it holds the bare QID instead. The QID is
always taken from `explore href`.

In a handful of rows the keys are out of step with their values (e.g. the cell
after `countryLabel` holds "chemist"). We therefore parse by *content type*
(date / Wikipedia URL / occupation / country) and only use the key cells to
disambiguate birth vs. death dates. A row is flagged `misaligned` when any key
is followed by a value of the wrong type.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

import pandas as pd

from . import FIELD
from .paths import REFERENCE_YEAR

KEYS = {"birthDate", "deathDate", "countryLabel", "occupationLabel", "wikipediaURL"}
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], start=1)}
DATE_RE = re.compile(r"^(\d{1,2}) (" + "|".join(MONTHS) + r") (\d{1,4})( BCE)?$")
QID_RE = re.compile(r"^Q\d+$")
WIKI_RE = re.compile(r"^https?://[a-z\-]+\.wikipedia\.org/wiki/")
GENID_RE = re.compile(r"/\.well-known/genid/")

# Age thresholds used for quality flags and censoring.
MAX_PLAUSIBLE_LIFESPAN = 110
MIN_PLAUSIBLE_LIFESPAN = 15
# A person with no death date is "likely living" only if they would be younger
# than MAX_PLAUSIBLE_LIFESPAN today.
LIVING_BIRTH_CUTOFF = REFERENCE_YEAR - MAX_PLAUSIBLE_LIFESPAN  # 1916


@dataclass(frozen=True)
class ParsedDate:
    year: int          # astronomical-ish: 201 BCE -> -201 (no year zero, historian convention)
    month: int
    day: int
    precision: str     # "day" | "year"  ("1 January" is Wikidata's rendering of year precision)
    raw: str


def parse_date(s: str) -> ParsedDate | None:
    m = DATE_RE.match(s.strip())
    if not m:
        return None
    day, month, year, bce = int(m.group(1)), MONTHS[m.group(2)], int(m.group(3)), bool(m.group(4))
    if bce:
        year = -year
    precision = "year" if (day == 1 and month == 1) else "day"
    return ParsedDate(year, month, day, precision, s)


def years_between(birth: int, death: int) -> int:
    """Elapsed years, accounting for the missing year zero across the BCE/CE boundary."""
    span = death - birth
    if birth < 0 < death:
        span -= 1
    return span


def name_from_url(url: str) -> tuple[str, str]:
    """('Wilhelm Meiser', 'Wilhelm_Meiser') from a Wikipedia URL.

    The display name drops a trailing disambiguator such as "(chemist)".
    """
    title = unquote(url.rsplit("/wiki/", 1)[-1]).replace("_", " ")
    name = re.sub(r"\s*\([^)]*\)$", "", title.replace("_", " ")).strip()
    return name, title


@dataclass
class RowRecord:
    qid: str
    label: str | None
    misaligned: bool
    birth: ParsedDate | None = None
    death: ParsedDate | None = None
    countries: list[str] = field(default_factory=list)
    unknown_country: bool = False
    occupations: list[str] = field(default_factory=list)
    url: str | None = None
    unparsed: list[str] = field(default_factory=list)


_KEY_KIND = {"birthDate": "date", "deathDate": "date", "countryLabel": "country",
             "occupationLabel": "occupation", "wikipediaURL": "url"}


def parse_row(row: list[str], occupation_vocab: set[str]) -> RowRecord:
    """Parse one raw CSV row (all 13 cells) by content type."""
    qid = row[0].rsplit("/", 1)[-1]
    head = row[2]
    label = None if (QID_RE.match(head) or head == "") else head
    rec = RowRecord(qid=qid, label=label, misaligned=False)
    cells = row[3:]
    prev_key: str | None = None
    for cell in cells:
        if cell == "":
            continue
        if cell in KEYS:
            prev_key = cell
            continue
        d = parse_date(cell)
        kind = ("date" if d else "url" if WIKI_RE.match(cell) else "country" if GENID_RE.search(cell)
                else "occupation" if cell in occupation_vocab else "country")
        if prev_key is not None and kind != _KEY_KIND[prev_key]:
            rec.misaligned = True
        if d is not None:
            # Use the key immediately before the date; fall back to order.
            if prev_key == "deathDate" or (prev_key != "birthDate" and rec.birth is not None):
                rec.death = d
            else:
                rec.birth = d
        elif WIKI_RE.match(cell):
            rec.url = cell
        elif GENID_RE.search(cell):
            rec.unknown_country = True  # Wikidata "unknown value" blank node
        elif cell in occupation_vocab:
            rec.occupations.append(cell)
        else:
            rec.countries.append(cell)
        prev_key = None
    return rec


def read_raw(path: Path) -> list[list[str]]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    return rows[1:]


def occupation_vocabulary(rows: list[list[str]]) -> set[str]:
    """Values that follow an `occupationLabel` key and are followed by `wikipediaURL`.

    Every query row ends with occupation then URL, so requiring the URL key to come
    next excludes the misaligned rows, where the cell after `occupationLabel` is a URL.
    """
    vocab: set[str] = set()
    for row in rows:
        cells = row[3:]
        for i in range(len(cells) - 2):
            if cells[i] == "occupationLabel" and cells[i + 2] == "wikipediaURL" and not WIKI_RE.match(cells[i + 1]):
                vocab.add(cells[i + 1])
    return vocab


# Known non-chemist / fictional entities that the original query matched.
# Kept in the data, flagged, so analyses can exclude them explicitly.
SUSPECTED_NON_HUMAN = {
    "Q158940": "fictional character (Bane, DC Comics)",
}


def _pick_date(dates: list[ParsedDate]) -> ParsedDate | None:
    """Prefer day precision over year precision, then the earliest."""
    if not dates:
        return None
    return sorted(dates, key=lambda d: (d.precision != "day", d.year, d.month, d.day))[0]


def build_tables(path: Path) -> dict[str, pd.DataFrame]:
    rows = read_raw(path)
    vocab = occupation_vocabulary(rows)
    recs = [parse_row(r, vocab) for r in rows]

    by_qid: dict[str, list[RowRecord]] = {}
    for r in recs:
        by_qid.setdefault(r.qid, []).append(r)

    people, pc, po = [], [], []
    for qid, rs in by_qid.items():
        births = {r.birth.raw: r.birth for r in rs if r.birth}
        deaths = {r.death.raw: r.death for r in rs if r.death}
        birth = _pick_date(list(births.values()))
        death = _pick_date(list(deaths.values()))
        url = next((r.url for r in rs if r.url), None)
        url_name, title = name_from_url(url) if url else (None, None)
        label = next((r.label for r in rs if r.label), None)
        name = label or url_name or qid
        flags: list[str] = []

        if any(r.misaligned for r in rs):
            flags.append("misaligned_source_row")
        if label is None:
            flags.append("no_english_label")
        if len(births) > 1:
            flags.append("conflicting_birth_dates")
        if len(deaths) > 1:
            flags.append("conflicting_death_dates")
        if birth is None:
            flags.append("missing_birth")
        elif birth.precision == "year":
            flags.append("birth_year_precision")
        if death is not None and death.precision == "year":
            flags.append("death_year_precision")
        if (birth and birth.year < 0) or (death and death.year < 0):
            flags.append("bce_date")
        if birth and birth.year > REFERENCE_YEAR:
            flags.append("birth_in_future")

        lifespan = None
        if birth and death:
            lifespan = years_between(birth.year, death.year)
            if lifespan < 0:
                flags.append("death_before_birth")
            elif lifespan > MAX_PLAUSIBLE_LIFESPAN:
                flags.append("lifespan_over_110")
            elif lifespan < MIN_PLAUSIBLE_LIFESPAN:
                flags.append("lifespan_under_15")

        is_living_likely = bool(death is None and birth is not None and birth.year > LIVING_BIRTH_CUTOFF)
        if death is None and birth is not None and not is_living_likely:
            flags.append("death_missing_presumed_dead")

        countries = sorted({c for r in rs for c in r.countries})
        if not countries:
            flags.append("missing_country")
        if any(r.unknown_country for r in rs):
            flags.append("unknown_value_country")
        if qid in SUSPECTED_NON_HUMAN:
            flags.append("suspected_non_human")

        people.append({
            "qid": qid,
            "name": name,
            "label": label,
            "wikipedia_title": title,
            "wikipedia_url": url,
            "field": FIELD,
            "birth_year": birth.year if birth else None,
            "birth_date": birth.raw if birth else None,
            "birth_precision": birth.precision if birth else None,
            "death_year": death.year if death else None,
            "death_date": death.raw if death else None,
            "death_precision": death.precision if death else None,
            "lifespan": lifespan,
            "is_living_likely": is_living_likely,
            "n_source_rows": len(rs),
            "quality_flags": flags,
        })
        for c in countries:
            pc.append({"qid": qid, "country_label": c})
        for o in sorted({o for r in rs for o in r.occupations}):
            po.append({"qid": qid, "occupation": o})

    people_df = pd.DataFrame(people)
    for c in ("birth_year", "death_year", "lifespan"):
        people_df[c] = people_df[c].astype("Int64")
    return {
        "people": people_df.sort_values("qid", key=lambda s: s.str[1:].astype(int)).reset_index(drop=True),
        "person_country": pd.DataFrame(pc),
        "person_occupation": pd.DataFrame(po),
        "_n_rows": pd.DataFrame({"n_rows": [len(rows)], "n_misaligned": [sum(r.misaligned for r in recs)]}),
    }
