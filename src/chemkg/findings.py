"""Headline findings, computed (never hand-typed) from analysis results.

Each finding carries: a one-sentence hook, supporting numbers, the n behind it,
and the caveat that must travel with it.
"""
from __future__ import annotations

import pandas as pd

from . import countries
from .data import Dataset, analysable

NAMES = None


def _name(iso: str) -> str:
    global NAMES
    if NAMES is None:
        NAMES = countries.load_iso3().set_index("iso3").name.to_dict()
    return {"USA": "the US", "GBR": "the UK"}.get(iso, NAMES.get(iso, iso))


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def build(ds: Dataset, r: dict) -> list[dict]:
    out = []
    A = analysable(ds.people)

    # 1. leadership handoffs ------------------------------------------------------
    cog = r["cog"]
    lead, hand = cog["leaders"], cog["handoffs"]
    if hand:
        last = hand[-1]
        peak_dec = lead[lead.leader == last["to"]].leader_share.idxmax()
        peak = lead.loc[peak_dec, "leader_share"]
        chain = " → ".join([_name(hand[0]["from"])] + [_name(h["to"]) for h in hand])
        n = int(cog["counts"].sum().sum())
        out.append({
            "id": "handoff", "chart": "cog",
            "hook": (f"Chemistry's center of gravity moved {chain}: {_name(last['to'])} overtook "
                     f"{_name(last['from'])} among chemists born in the {last['decade']}s and peaked at "
                     f"{peak:.0%} of everyone born in the {int(peak_dec)}s."),
            "numbers": {"handoffs": hand, "peak_share": float(peak), "peak_decade": int(peak_dec)},
            "n": n, "caveat": "English-Wikipedia notability over-represents anglophone chemists; shares are "
                              "of notable chemists, not of all chemists."})

    # 2. migration ---------------------------------------------------------------
    mig = r["migration"]
    bal, cor = mig["balance"], mig["corridors"]
    if len(bal):
        top = bal.index[0]
        top_c = cor.iloc[0]
        losers = bal.rename_axis("iso3").reset_index().sort_values(["net", "iso3"], kind="stable").set_index("iso3").head(3)
        out.append({
            "id": "migration", "chart": "migration",
            "hook": (f"{_cap(_name(top))} is chemistry's great talent magnet: a net gain of {int(bal.loc[top, 'net'])} migrant chemists, "
                     f"with {_name(top_c.origin)} → {_name(top_c.dest)} the single busiest corridor "
                     f"({int(top_c.n)} people); the biggest net exporters are "
                     f"{', '.join(_name(i) for i in losers.index)}."),
            "numbers": {"net_top": int(bal.loc[top, "net"]), "top_corridor": [top_c.origin, top_c.dest, int(top_c.n)],
                        "net_exporters": {i: int(v) for i, v in losers.net.items()}},
            "n": mig["n_people_directed"],
            "caveat": "Direction comes from place of birth vs. citizenship; moves without naturalisation are invisible."})

    # 3. survival ----------------------------------------------------------------
    curves = {c["group"]: c for c in r["survival"]["curves"] if c["by"] == "surv_era"}
    if "1700–1799" in curves and "1900–1929" in curves:
        a, b = curves["1700–1799"], curves["1900–1929"]
        cox = {t["term"]: t for t in r["survival"]["cox"]["terms"]}
        mc = cox.get("multi_country")
        hook = (f"Chemists born in 1900–1929 reached a median age of {b['median']:.0f}, versus "
                f"{a['median']:.0f} for those born in the 1700s")
        if mc and mc["p"] < 0.05:
            hook += (f"; chemists who held more than one citizenship had a {1 - mc['hr']:.0%} lower hazard of death "
                     f"(HR {mc['hr']:.2f}, 95% CI {mc['lo']:.2f}–{mc['hi']:.2f}).")
        else:
            hook += "."
        out.append({
            "id": "survival", "chart": "survival", "hook": hook,
            "numbers": {"median_1700s": a["median"], "median_1900_29": b["median"],
                        "multi_country_hr": mc},
            "n": r["survival"]["cox"]["n"],
            "caveat": "Survivorship bias: you must live long enough to become notable. Medians describe notable "
                      "chemists, not mortality in the general population; living people are right-censored."})

    # 4. genealogy ---------------------------------------------------------------
    gm = r["genealogy"]["metrics"]
    if len(gm):
        roots = gm[gm.is_root].sort_values(["chem_descendants", "birth_year", "qid"], ascending=[False, True, True], kind="stable").iloc[0]
        ind = gm[gm.in_dataset]
        mentor = ind.sort_values(["chem_descendants", "qid"], ascending=[False, True], kind="stable").iloc[0]
        nob = ind.sort_values(["nobel_descendants", "qid"], ascending=[False, True], kind="stable").iloc[0]
        g = r["genealogy"]["graph"]
        out.append({
            "id": "genealogy", "chart": "genealogy",
            "hook": (f"Academic family trees run deep: {int(roots.chem_descendants)} of the {int(gm.in_dataset.sum()):,} "
                     f"chemists with recorded advisor links ({roots.chem_descendants / gm.in_dataset.sum():.0%}) belong to a single "
                     f"advisor-to-student lineage whose earliest recorded root is {roots['name']}"
                     f"{f' (b. {int(roots.birth_year)})' if pd.notna(roots.birth_year) else ''}; the academic descendants of "
                     f"{nob['name']}{f' (b. {int(nob.birth_year)})' if pd.notna(nob.birth_year) else ''} include "
                     f"{int(nob.nobel_descendants)} Nobel laureates."),
            "numbers": {"root": roots.qid, "root_descendants": int(roots.descendants),
                        "root_chem_descendants": int(roots.chem_descendants), "top_mentor": mentor.qid,
                        "nobel_root": nob.qid, "nobel_descendants": int(nob.nobel_descendants),
                        "nodes": g.number_of_nodes(), "edges": g.number_of_edges()},
            "n": int(g.number_of_edges()),
            "caveat": "Only advisor links recorded in Wikidata (P184/P185); coverage is sparse and skews to famous labs."})

    # 5. women -------------------------------------------------------------------
    if "sex" in A and A.sex.notna().any():
        s = A.dropna(subset=["birth_year", "sex"])
        early = s[s.birth_year < 1900]
        late = s[s.birth_year >= 1960]
        fe, fl = (early.sex == "female").mean(), (late.sex == "female").mean()
        dec = s[s.birth_year >= 1850].assign(d=lambda d: (d.birth_year // 10 * 10).astype(int))
        by_dec = dec.groupby("d").sex.apply(lambda x: (x == "female").mean())
        out.append({
            "id": "women", "chart": "women",
            "hook": (f"Women are {fl:.0%} of chemists born since 1960 in Wikidata, up from {fe:.1%} of those born "
                     f"before 1900. Even at today's rate, notable chemistry is still roughly "
                     f"{round((1 - fl) / fl)} men to every woman."),
            "numbers": {"female_pre1900": float(fe), "female_post1960": float(fl),
                        "by_decade": {int(k): float(v) for k, v in by_dec.items()}},
            "n": int(len(s)),
            "caveat": "Sex/gender as recorded in Wikidata (P21). Recognition gaps in Wikipedia itself depress women's counts."})

    # 6. specialties -------------------------------------------------------------
    growth = r["specialties"]["growth"]
    if "Life & medicinal chemistry" in growth:
        tot = A.dropna(subset=["birth_year"])
        tot = tot.assign(d=(tot.birth_year // 10 * 10).astype(int)).groupby("d").size()
        life = growth["Life & medicinal chemistry"]
        share = (life / tot.reindex(life.index)).dropna()
        early = share.loc[1850:1879].mean()
        late = share.loc[1940:1969].mean()
        out.append({
            "id": "specialties", "chart": "specialties",
            "hook": (f"Chemistry turned toward life: biochemists, pharmacologists and toxicologists were "
                     f"{early:.0%} of chemists born in 1850–1879 but {late:.0%} of those born in 1940–1969."),
            "numbers": {"life_share_1850_79": float(early), "life_share_1940_69": float(late)},
            "n": int(tot.loc[1850:1969].sum()),
            "caveat": "Many people carry only the generic 'chemist' label, so specialty shares are lower bounds."})
    return out
