"""Shared loaders for analyses. Joins Phase 1 tables with (optional) cached enrichment."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd

from . import enrich
from .paths import PROCESSED

ERA_WIDTH = 25
ERA_START = 1700

EXCLUDE_ALWAYS = {"suspected_non_human", "death_before_birth"}


def era_of(year) -> str | None:
    """25-year birth cohort label, e.g. 1875 -> '1875–1899'; < 1700 -> 'before 1700'."""
    if year is None or pd.isna(year):
        return None
    y = int(year)
    if y < ERA_START:
        return "before 1700"
    s = ERA_START + (y - ERA_START) // ERA_WIDTH * ERA_WIDTH
    return f"{s}–{s + ERA_WIDTH - 1}"


def era_order() -> list[str]:
    return ["before 1700"] + [f"{s}–{s + ERA_WIDTH - 1}" for s in range(ERA_START, 2025, ERA_WIDTH)]


@dataclass
class Dataset:
    people: pd.DataFrame
    person_country: pd.DataFrame
    person_occupation: pd.DataFrame
    affiliations: pd.DataFrame
    attributes: pd.DataFrame | None
    relations: pd.DataFrame | None
    lineage: pd.DataFrame | None

    @property
    def enriched(self) -> bool:
        return self.attributes is not None


@lru_cache(maxsize=1)
def load() -> Dataset:
    people = pd.read_parquet(PROCESSED / "people.parquet")
    pc = pd.read_parquet(PROCESSED / "person_country.parquet")
    po = pd.read_parquet(PROCESSED / "person_occupation.parquet")
    aff = pd.read_parquet(PROCESSED / "person_affiliation.parquet")
    e = enrich.load_enrichment()
    attrs = rel = lin = None
    if e is not None:
        attrs, rel, lin = e["person_attributes"], e["relations"], e["lineage"]
        people = people.merge(attrs, on="qid", how="left")
        # Items whose P31 is not Q5 (human) are flagged automatically.
        nonhuman = people.is_human.eq(False)
        people["quality_flags"] = [list(f) + (["not_instance_of_human"] if nh else [])
                                   for f, nh in zip(people.quality_flags, nonhuman)]
        nobel = rel[(rel.relation == "award") & rel.target.isin(enrich.NOBEL_PRIZES)]
        people["nobel_chemistry"] = people.qid.isin(nobel[nobel.target == enrich.NOBEL_CHEMISTRY].qid)
        people["nobel_any"] = people.qid.isin(nobel.qid)
    else:
        people["sex"] = None
        people["nobel_chemistry"] = False
        people["nobel_any"] = False
    people["quality_flags"] = people.quality_flags.map(list)
    people["era"] = people.birth_year.map(era_of)
    people["excluded"] = people.quality_flags.map(
        lambda f: bool(set(f) & (EXCLUDE_ALWAYS | {"not_instance_of_human"})))
    return Dataset(people, pc, po, aff, attrs, rel, lin)


def analysable(people: pd.DataFrame) -> pd.DataFrame:
    return people[~people.excluded]


def fractional_country(ds: Dataset) -> pd.DataFrame:
    """Each person contributes weight 1/k to each of their k affiliation components."""
    a = ds.affiliations[["qid", "iso3", "n_components"]].copy()
    a["w"] = 1.0 / a.n_components
    return a.merge(analysable(ds.people)[["qid", "birth_year", "era"]], on="qid")


def to_jsonable(obj):
    """Recursively convert numpy/pandas scalars so json.dumps works."""
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return None if np.isnan(obj) else round(float(obj), 4)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if obj is pd.NA or obj is pd.NaT:
        return None
    return obj
