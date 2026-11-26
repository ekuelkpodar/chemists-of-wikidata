"""Pipeline entry points.  `python -m chemkg.pipeline data` builds Phase 1 outputs."""
from __future__ import annotations

import json
import sys

import pandas as pd

from . import clean, countries, occupations
from .paths import PROCESSED, RAW_CSV, REFERENCE_YEAR


def build_data() -> dict[str, pd.DataFrame]:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    t = clean.build_tables(RAW_CSV)
    people, pc_raw, po_raw = t["people"], t["person_country"], t["person_occupation"]

    pc = countries.annotate(pc_raw)
    pc["territory"] = pc.territory.map(sorted)
    po = occupations.annotate(po_raw)
    pairs = countries.classify_pairs(pc_raw)
    aff = countries.person_affiliations(pc_raw)

    # Person-level derived columns.
    people = people.merge(occupations.primary_domain(po_raw), on="qid", how="left")
    n_aff = aff.groupby("qid").n_components.first()
    people["n_country_affiliations"] = people.qid.map(n_aff).fillna(0).astype(int)
    people["is_multi_country"] = people.n_country_affiliations >= 2
    people["n_occupations"] = people.qid.map(po_raw.groupby("qid").size()).fillna(0).astype(int)
    non_country = set(countries.load_country_map().query("kind == 'non_country'").country_label)
    nc_q = set(pc_raw[pc_raw.country_label.isin(non_country)].qid)
    people["quality_flags"] = [f + (["non_country_citizenship"] if q in nc_q else [])
                               for q, f in zip(people.qid, people.quality_flags)]

    people.to_parquet(PROCESSED / "people.parquet", index=False)
    pc.to_parquet(PROCESSED / "person_country.parquet", index=False)
    po.to_parquet(PROCESSED / "person_occupation.parquet", index=False)
    pairs.to_parquet(PROCESSED / "person_country_pairs.parquet", index=False)
    aff.to_parquet(PROCESSED / "person_affiliation.parquet", index=False)

    quality = quality_report(people, pc, po, pairs, t["_n_rows"].iloc[0].to_dict())
    (PROCESSED / "quality.json").write_text(json.dumps(quality, indent=2, ensure_ascii=False))
    return {"people": people, "person_country": pc, "person_occupation": po, "pairs": pairs, "affiliations": aff}


def quality_report(people, pc, po, pairs, raw_counts) -> dict:
    n = len(people)
    flags = people.quality_flags.explode().value_counts().to_dict()

    def pct(k):
        return round(100 * k / n, 1)

    by = people.birth_year.dropna()
    return {
        "reference_year": REFERENCE_YEAR,
        "raw": {"rows": int(raw_counts["n_rows"]), "misaligned_rows": int(raw_counts["n_misaligned"])},
        "people": n,
        "unique_names": int(people.name.nunique()),
        "fill_rates_pct": {
            "birth_year": pct(people.birth_year.notna().sum()),
            "death_year": pct(people.death_year.notna().sum()),
            "country": pct(people.qid.isin(pc.qid).sum()),
            "occupation": pct(people.qid.isin(po.qid).sum()),
            "wikipedia_url": pct(people.wikipedia_url.notna().sum()),
        },
        "birth_year_range": [int(by.min()), int(by.max())],
        "birth_precision": people.birth_precision.value_counts(dropna=False).rename(index=str).to_dict(),
        "living_likely": int(people.is_living_likely.sum()),
        "living_likely_rule": f"no death date and birth_year > {clean.LIVING_BIRTH_CUTOFF}",
        "multi_occupation_people": int((people.n_occupations >= 2).sum()),
        "country_labels": int(pc.country_label.nunique()),
        "country_label_kinds": pc.drop_duplicates("country_label").kind.value_counts().to_dict(),
        "multi_label_people": int((pc.groupby("qid").size() >= 2).sum()),
        "name_change_only_people": int(people.qid.isin(pairs.qid).sum() - people.is_multi_country.sum()),
        "multi_country_people": int(people.is_multi_country.sum()),
        "pair_relations": pairs.relation.value_counts().to_dict(),
        "flags": {k: int(v) for k, v in flags.items()},
        "flag_definitions": FLAG_DEFINITIONS,
        "flagged_examples": {
            f: people[people.quality_flags.map(lambda x, f=f: f in x)]
            .head(10)[["qid", "name", "birth_date", "death_date", "lifespan"]]
            .astype(object).where(lambda d: d.notna(), None).to_dict("records")
            for f in ["lifespan_over_110", "lifespan_under_15", "bce_date", "misaligned_source_row",
                      "suspected_non_human", "non_country_citizenship", "death_missing_presumed_dead"]
        },
    }


FLAG_DEFINITIONS = {
    "missing_birth": "no birth date in Wikidata",
    "missing_country": "no country of citizenship",
    "birth_year_precision": "birth rendered as '1 January' = Wikidata year precision (a true 1 Jan birthday is indistinguishable)",
    "death_year_precision": "death rendered as '1 January' = year precision",
    "conflicting_birth_dates": "more than one birth date statement; most precise then earliest kept",
    "conflicting_death_dates": "more than one death date statement; most precise then earliest kept",
    "death_missing_presumed_dead": f"no death date but born <= {clean.LIVING_BIRTH_CUTOFF}; excluded from survival analysis",
    "lifespan_over_110": "lifespan > 110 years: likely date error",
    "lifespan_under_15": "lifespan < 15 years: likely date error",
    "death_before_birth": "death year earlier than birth year",
    "bce_date": "birth or death date is BCE",
    "misaligned_source_row": "a source row had keys out of step with values; parsed by content type",
    "no_english_label": "no English label; name decoded from Wikipedia URL",
    "unknown_value_country": "country statement is Wikidata 'unknown value'",
    "non_country_citizenship": "citizenship value is not a state (statelessness, ethnic group, fictional)",
    "suspected_non_human": "hand-flagged: not a real chemist (e.g. fictional character)",
}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "data"
    if cmd == "data":
        out = build_data()
        print({k: len(v) for k, v in out.items()})
    else:
        raise SystemExit(f"unknown command {cmd}")
