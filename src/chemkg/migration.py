"""Country -> country migration network by 25-year birth cohort.

A migration edge origin -> destination is recorded when a person is affiliated with
two territorially distinct countries. Direction comes from place of birth (P19):

1. If the birthplace's current country (P17) falls inside one citizenship component's
   territory, that component is the origin and the others are destinations.
2. If the birthplace lies outside *every* citizenship component, the birthplace
   country is the origin and every citizenship component is a destination (e.g. born
   in Germany, sole citizenship United States).
3. Multi-country people without a usable birthplace get an *undirected* corridor only.

Border shifts: a birthplace's country (P17) is its *current* country, so a chemist born
in Breslau in 1850 has birthplace country Poland even though Breslau was Prussian. For
modern-country pairs whose border moved, a birth before the shift year is treated as
"same territory" (method `border_shift`, excluded from the network) rather than migration.

Citizenship (P27) is not residence, so moves without naturalisation are invisible.
"""
from __future__ import annotations

import pandas as pd

from . import countries
from .data import Dataset, analysable, era_order


# Modern-country pairs whose shared border region changed hands, and the year by which the
# current border was settled. Births before that year across the pair are not migration.
BORDER_SHIFTS: dict[frozenset, int] = {frozenset(k): y for k, y in [
    (("DEU", "POL"), 1945), (("DEU", "RUS"), 1945), (("DEU", "LTU"), 1945), (("DEU", "FRA"), 1919),
    (("DEU", "DNK"), 1920), (("DEU", "CZE"), 1945), (("DEU", "BEL"), 1920),
    (("AUT", "ITA"), 1919), (("AUT", "CZE"), 1919), (("AUT", "POL"), 1919), (("AUT", "UKR"), 1919),
    (("AUT", "SVN"), 1919), (("AUT", "HRV"), 1919),
    (("HUN", "ROU"), 1947), (("HUN", "SVK"), 1947), (("HUN", "SRB"), 1920), (("HUN", "HRV"), 1920), (("HUN", "UKR"), 1945),
    (("POL", "UKR"), 1945), (("POL", "LTU"), 1945), (("POL", "BLR"), 1945), (("POL", "RUS"), 1918),
    (("RUS", "UKR"), 1991), (("RUS", "BLR"), 1991), (("RUS", "FIN"), 1940), (("RUS", "POL"), 1918),
    (("ITA", "SVN"), 1947), (("ITA", "HRV"), 1947), (("ITA", "FRA"), 1860),
    (("ROU", "UKR"), 1945), (("ROU", "MDA"), 1945), (("TUR", "GRC"), 1923), (("IND", "PAK"), 1947), (("IND", "BGD"), 1947),
    (("GBR", "IRL"), 1922),
]}


def is_border_shift(a: str, b: str, birth_year) -> bool:
    y = BORDER_SHIFTS.get(frozenset((a, b)))
    return y is not None and birth_year is not None and not pd.isna(birth_year) and birth_year < y


def _territory_of(labels) -> frozenset[str]:
    cmap = countries.load_country_map().set_index("country_label")
    return frozenset().union(*[cmap.loc[lab, "territory"] for lab in labels])


def build_edges(ds: Dataset) -> pd.DataFrame:
    people = analysable(ds.people).set_index("qid")
    aff = ds.affiliations[ds.affiliations.qid.isin(people.index)]
    iso_known = set(countries.load_iso3().iso3)
    rows = []
    for qid, g in aff.groupby("qid"):
        p = people.loc[qid]
        comps = [(r.iso3, _territory_of(r.labels)) for r in g.itertuples()]
        bp = p.get("bp_iso3") if "bp_iso3" in p else None
        bp = bp if isinstance(bp, str) and bp in iso_known else None
        base = {"qid": qid, "birth_year": p.birth_year, "era": p.era}
        if bp is not None:
            origin = [iso for iso, terr in comps if bp in terr]
            if origin:
                o = origin[0]
                for iso, _ in comps:
                    if iso != o:
                        rows.append({**base, "origin": o, "dest": iso, "method": "birthplace_in_citizenship"})
            else:
                for iso, _ in comps:
                    if iso != bp:
                        rows.append({**base, "origin": bp, "dest": iso, "method": "birthplace_outside_citizenship"})
        elif len(comps) >= 2:
            isos = sorted(iso for iso, _ in comps)
            for i in range(len(isos)):
                for j in range(i + 1, len(isos)):
                    rows.append({**base, "origin": isos[i], "dest": isos[j], "method": "undirected"})
    e = pd.DataFrame(rows, columns=["qid", "birth_year", "era", "origin", "dest", "method"])
    shift = [is_border_shift(o, d, y) for o, d, y in zip(e.origin, e.dest, e.birth_year)]
    e.loc[shift, "method"] = "border_shift"
    return e[e.origin != e.dest].drop_duplicates(["qid", "origin", "dest"]).reset_index(drop=True)


def summarise(edges: pd.DataFrame) -> dict:
    d = edges[~edges.method.isin(["undirected", "border_shift"])]
    corridors = d.groupby(["origin", "dest"]).size().rename("n").reset_index().sort_values("n", ascending=False)
    by_era = d.dropna(subset=["era"]).groupby(["era", "origin", "dest"]).size().rename("n").reset_index()
    inflow = d.groupby("dest").size()
    outflow = d.groupby("origin").size()
    net = (inflow.reindex(inflow.index.union(outflow.index), fill_value=0)
           - outflow.reindex(inflow.index.union(outflow.index), fill_value=0)).rename("net")
    balance = pd.DataFrame({"inflow": inflow, "outflow": outflow}).fillna(0).astype(int).join(net)
    balance = balance.sort_values("net", ascending=False)
    era_net = []
    for era, g in d.dropna(subset=["era"]).groupby("era"):
        i, o = g.groupby("dest").size(), g.groupby("origin").size()
        idx = i.index.union(o.index)
        n = i.reindex(idx, fill_value=0) - o.reindex(idx, fill_value=0)
        for iso, v in n.items():
            era_net.append({"era": era, "iso3": iso, "net": int(v),
                            "inflow": int(i.get(iso, 0)), "outflow": int(o.get(iso, 0))})
    return {
        "n_edges_directed": int(len(d)),
        "n_edges_undirected": int((edges.method == "undirected").sum()),
        "n_border_shift": int((edges.method == "border_shift").sum()),
        "n_people_directed": int(d.qid.nunique()),
        "method_counts": edges.method.value_counts().to_dict(),
        "corridors": corridors,
        "by_era": by_era,
        "balance": balance,
        "era_net": pd.DataFrame(era_net),
        "era_order": [e for e in era_order() if e in set(d.era.dropna())],
    }
