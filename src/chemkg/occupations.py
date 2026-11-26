"""Two-level occupation taxonomy: domain -> Wikidata occupation label."""
from __future__ import annotations

from functools import lru_cache

import pandas as pd

from .paths import RESOURCES

GENERAL = "General chemistry"


@lru_cache(maxsize=1)
def load_taxonomy() -> pd.DataFrame:
    t = pd.read_csv(RESOURCES / "occupation_taxonomy.csv", keep_default_na=False)
    if t.occupation.duplicated().any():
        raise ValueError("duplicate occupations in taxonomy")
    return t


def annotate(person_occupation: pd.DataFrame) -> pd.DataFrame:
    t = load_taxonomy()
    missing = sorted(set(person_occupation.occupation) - set(t.occupation))
    if missing:
        raise ValueError(f"occupations missing from taxonomy: {missing}")
    return person_occupation.merge(t[["occupation", "domain"]], on="occupation", how="left", validate="many_to_one")


def primary_domain(person_occupation: pd.DataFrame) -> pd.Series:
    """Most specific domain per person: any non-general domain beats 'General chemistry';
    ties among specialist domains are broken by the domain's overall rarity (rarer wins),
    so a 'chemist + crystallographer' is Physical & theoretical."""
    po = annotate(person_occupation)
    freq = po.domain.value_counts()
    po = po.assign(_general=po.domain.eq(GENERAL), _freq=po.domain.map(freq))
    po = po.sort_values(["qid", "_general", "_freq", "domain"])
    return po.groupby("qid").domain.first().rename("primary_domain")
