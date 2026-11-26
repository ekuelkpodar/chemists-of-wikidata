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
    return person_occupation.drop(columns=["domain"], errors="ignore").merge(t[["occupation", "domain"]], on="occupation", how="left", validate="many_to_one")


def primary_domain(person_occupation: pd.DataFrame) -> pd.Series:
    """Most specific domain per person: any non-general domain beats 'General chemistry';
    ties among specialist domains are broken by the domain's overall rarity (rarer wins),
    so a 'chemist + crystallographer' is Physical & theoretical."""
    po = annotate(person_occupation)
    freq = po.domain.value_counts()
    po = po.assign(_general=po.domain.eq(GENERAL), _freq=po.domain.map(freq))
    po = po.sort_values(["qid", "_general", "_freq", "domain"])
    return po.groupby("qid").domain.first().rename("primary_domain")


# ---------------------------------------------------------------- specialty evolution

def cooccurrence(person_occupation: pd.DataFrame, people_ok: set[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Nodes (occupation, domain, n) and weighted edges (a, b, n, jaccard)."""
    from itertools import combinations

    po = annotate(person_occupation[person_occupation.qid.isin(people_ok)])
    n = po.groupby("occupation").qid.nunique()
    nodes = n.rename("n").reset_index().merge(load_taxonomy()[["occupation", "domain"]], on="occupation")
    pairs: dict[tuple[str, str], int] = {}
    for _, occs in po.groupby("qid").occupation:
        for a, b in combinations(sorted(set(occs)), 2):
            pairs[(a, b)] = pairs.get((a, b), 0) + 1
    edges = pd.DataFrame([{"a": a, "b": b, "n": k} for (a, b), k in pairs.items()],
                         columns=["a", "b", "n"])
    if len(edges):
        edges["jaccard"] = edges.n / (edges.a.map(n) + edges.b.map(n) - edges.n)
    return nodes, edges.sort_values("n", ascending=False).reset_index(drop=True)


def first_appearance(person_occupation: pd.DataFrame, people: pd.DataFrame, k: int = 3) -> pd.DataFrame:
    """Per occupation: earliest holder's birth year, and the birth year by which k holders
    exist (robust to single mis-tagged early figures), plus total holders with a birth year."""
    po = annotate(person_occupation).merge(people[["qid", "name", "birth_year"]], on="qid")
    po = po.dropna(subset=["birth_year"]).sort_values("birth_year")
    rows = []
    for occ, g in po.groupby("occupation"):
        rows.append({"occupation": occ, "domain": g.domain.iloc[0],
                     "first_year": int(g.birth_year.iloc[0]), "first_person": g.name.iloc[0],
                     "first_qid": g.qid.iloc[0],
                     f"year_k{k}": int(g.birth_year.iloc[k - 1]) if len(g) >= k else None,
                     "median_year": float(g.birth_year.median()), "n": int(len(g))})
    return pd.DataFrame(rows).sort_values(f"year_k{k}", na_position="last").reset_index(drop=True)


def growth_by_decade(person_occupation: pd.DataFrame, people: pd.DataFrame,
                     start: int = 1700, end: int = 1990) -> pd.DataFrame:
    """People per (decade, domain) by birth decade; each person counted once per domain held."""
    po = annotate(person_occupation).merge(people[["qid", "birth_year"]], on="qid").dropna(subset=["birth_year"])
    po = po[(po.birth_year >= start) & (po.birth_year < end + 10)]
    po["decade"] = (po.birth_year // 10 * 10).astype(int)
    return po.drop_duplicates(["qid", "domain"]).pivot_table(
        index="decade", columns="domain", values="qid", aggfunc="count", fill_value=0)
