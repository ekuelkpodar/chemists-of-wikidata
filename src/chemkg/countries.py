"""Historical -> modern country mapping and name-change vs. migration classification.

Each Wikidata country label (P27 "country of citizenship") maps to
  * a primary modern successor (ISO3, used for maps and aggregation), and
  * a *territory set*: every modern state that covers part of the entity's territory.
Modern countries have a territory set of just themselves.

Two labels held by the same person are a **name change** (same territory under a
different regime, e.g. Russian Empire / Soviet Union / Russia) when their territory
sets intersect, and a **real multi-country affiliation** otherwise (e.g. Germany /
United States). Labels are grouped into connected components under "intersects";
a person with >= 2 components is a migration candidate. Note the P27 statement
carries no order, so *direction* is resolved later (see migration.py).
"""
from __future__ import annotations

from functools import lru_cache
from itertools import combinations

import networkx as nx
import pandas as pd

from .paths import RESOURCES


@lru_cache(maxsize=1)
def load_iso3() -> pd.DataFrame:
    return pd.read_csv(RESOURCES / "iso3_reference.csv", keep_default_na=False, na_values=[""])


@lru_cache(maxsize=1)
def load_country_map() -> pd.DataFrame:
    """One row per Wikidata label with modern successor, region, centroid and territory set."""
    m = pd.read_csv(RESOURCES / "country_map.csv", keep_default_na=False, na_values=[""])
    iso = load_iso3().rename(columns={"name": "modern_name"})
    m = m.merge(iso, on="iso3", how="left", validate="many_to_one")
    bad = m[m.iso3.notna() & m.modern_name.isna()]
    if len(bad):
        raise ValueError(f"ISO3 codes missing from iso3_reference.csv: {sorted(bad.iso3)}")
    if m.label.duplicated().any():
        raise ValueError(f"duplicate labels: {m.label[m.label.duplicated()].tolist()}")

    def territory(row) -> frozenset[str]:
        if pd.isna(row.iso3):
            return frozenset()
        extra = row.territory.split("|") if isinstance(row.territory, str) and row.territory else []
        return frozenset([row.iso3, *extra])

    m["territory"] = m.apply(territory, axis=1)
    unknown = set().union(*m.territory) - set(iso.iso3)
    if unknown:
        raise ValueError(f"territory ISO3 codes not in reference: {sorted(unknown)}")
    return m.rename(columns={"label": "country_label"})


def same_territory(a: frozenset[str], b: frozenset[str]) -> bool:
    return bool(a & b)


def annotate(person_country: pd.DataFrame) -> pd.DataFrame:
    """Attach modern successor, region, centroid and territory to (qid, country_label)."""
    m = load_country_map()
    missing = sorted(set(person_country.country_label) - set(m.country_label))
    if missing:
        raise ValueError(f"unmapped country labels: {missing}")
    out = person_country.merge(m, on="country_label", how="left", validate="many_to_one")
    return out


def affiliation_components(labels: list[str]) -> list[list[str]]:
    """Group a person's labels into connected components of overlapping territory."""
    m = load_country_map().set_index("country_label")
    real = [lab for lab in labels if m.loc[lab, "kind"] != "non_country"]
    g = nx.Graph()
    g.add_nodes_from(real)
    for a, b in combinations(real, 2):
        if same_territory(m.loc[a, "territory"], m.loc[b, "territory"]):
            g.add_edge(a, b)
    return [sorted(c) for c in sorted(nx.connected_components(g), key=lambda c: sorted(c))]


def component_iso3(component: list[str]) -> str:
    """Representative modern country for a component: a modern label if present,
    otherwise the primary successor of the most territorially specific label."""
    m = load_country_map().set_index("country_label")
    modern = [lab for lab in component if m.loc[lab, "kind"] == "modern"]
    if modern:
        # Several modern labels can share a component only via a historical bridge;
        # pick the most frequent ISO among them deterministically.
        return sorted(m.loc[modern, "iso3"])[0]
    most_specific = min(component, key=lambda lab: (len(m.loc[lab, "territory"]), lab))
    return m.loc[most_specific, "iso3"]


def classify_pairs(person_country: pd.DataFrame) -> pd.DataFrame:
    """All label pairs per person, labelled `name_change` or `multi_country`."""
    m = load_country_map().set_index("country_label")
    rows = []
    for qid, labs in person_country.groupby("qid").country_label:
        labs = sorted(set(labs) - set(m.index[m.kind == "non_country"]))
        for a, b in combinations(labs, 2):
            rel = "name_change" if same_territory(m.loc[a, "territory"], m.loc[b, "territory"]) else "multi_country"
            rows.append({"qid": qid, "label_a": a, "label_b": b,
                         "iso3_a": m.loc[a, "iso3"], "iso3_b": m.loc[b, "iso3"], "relation": rel})
    return pd.DataFrame(rows, columns=["qid", "label_a", "label_b", "iso3_a", "iso3_b", "relation"])


def person_affiliations(person_country: pd.DataFrame) -> pd.DataFrame:
    """One row per (person, affiliation component) with its representative ISO3."""
    rows = []
    for qid, labs in person_country.groupby("qid").country_label:
        comps = affiliation_components(sorted(set(labs)))
        for i, comp in enumerate(comps):
            rows.append({"qid": qid, "component": i, "iso3": component_iso3(comp),
                         "labels": comp, "n_components": len(comps)})
    return pd.DataFrame(rows, columns=["qid", "component", "iso3", "labels", "n_components"])
