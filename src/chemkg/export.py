"""Run every analysis and write compact, pre-aggregated JSON (+ one parquet) for the web app."""
from __future__ import annotations

import json
import time

import pandas as pd

from . import cohorts, countries, enrich, genealogy, graph, imputation, migration, occupations, survival
from .data import analysable, load, to_jsonable
from .paths import INTERIM, PROCESSED, QUERIES, REFERENCE_YEAR, WEB_DATA

N_SHARDS = 32


def _write(name: str, obj) -> int:
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    s = json.dumps(to_jsonable(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    (WEB_DATA / name).write_text(s)
    return len(s)


def _records(df: pd.DataFrame) -> list[dict]:
    return to_jsonable(df.astype(object).where(df.notna(), None).to_dict("records"))


def run_all() -> dict:
    t0 = time.time()
    ds = load()
    P = ds.people
    A = analysable(P)
    iso = countries.load_iso3()
    sizes, results = {}, {}

    # --- 1. migration -------------------------------------------------------------
    edges = migration.build_edges(ds)
    mig = migration.summarise(edges)
    edges.to_parquet(PROCESSED / "migration_edges.parquet", index=False)
    names = P.set_index("qid").name
    directed = edges[~edges.method.isin(["undirected", "border_shift"])]
    migrants = directed.assign(name=directed.qid.map(names))[["qid", "name", "origin", "dest", "birth_year", "era"]]
    used_iso = sorted(set(directed.origin) | set(directed.dest) | set(ds.affiliations.iso3))
    sizes["migration.json"] = _write("migration.json", {
        "n_people": mig["n_people_directed"], "n_edges": mig["n_edges_directed"],
        "n_undirected": mig["n_edges_undirected"], "n_border_shift": mig["n_border_shift"],
        "methods": mig["method_counts"],
        "eras": mig["era_order"],
        "countries": _records(iso[iso.iso3.isin(used_iso)]),
        "flows": _records(mig["by_era"]),
        "balance": _records(mig["balance"].reset_index(names="iso3")),
        "era_net": _records(mig["era_net"]),
        "migrants": _records(migrants.sort_values("birth_year")),
    })
    results["migration"] = mig

    # --- 2. center of gravity -----------------------------------------------------
    counts, shares = cohorts.decade_shares(ds)
    lead = cohorts.leaders(counts)
    hand = cohorts.handoffs(lead)
    race = cohorts.cumulative_race(ds)
    center = cohorts.geographic_center(ds)
    top_iso = [c for c in shares.columns if c != "OTHER"]
    sizes["cog.json"] = _write("cog.json", {
        "decades": counts.index.tolist(),
        "totals": counts.sum(axis=1).round(2).tolist(),
        "shares": {c: shares[c].round(4).tolist() for c in shares.columns},
        "counts": {c: counts[c].round(2).tolist() for c in top_iso},
        "leaders": _records(lead.reset_index(names="decade")),
        "handoffs": hand, "race": race, "center": _records(center),
        "names": iso.set_index("iso3").name.to_dict(),
    })
    results["cog"] = {"leaders": lead, "handoffs": hand, "shares": shares, "counts": counts}

    # --- 3. specialties -----------------------------------------------------------
    nodes, cedges = occupations.cooccurrence(ds.person_occupation, set(A.qid))
    first = occupations.first_appearance(ds.person_occupation, A)
    growth = occupations.growth_by_decade(ds.person_occupation, A)
    sizes["specialties.json"] = _write("specialties.json", {
        "nodes": _records(nodes), "edges": _records(cedges), "first": _records(first),
        "growth": {"decades": growth.index.tolist(), "series": {c: growth[c].tolist() for c in growth.columns}},
        "domains": sorted(occupations.load_taxonomy().domain.unique()),
    })
    results["specialties"] = {"nodes": nodes, "edges": cedges, "first": first, "growth": growth}

    # --- 4. survival --------------------------------------------------------------
    sf = survival.survival_frame(ds)
    curves = (survival.km_curves(sf, "surv_era") + survival.km_curves(sf, "primary_domain", min_n=150)
              + survival.km_curves(sf, "region", min_n=150))
    if sf.get("sex") is not None and sf.sex.notna().any():
        curves += survival.km_curves(sf, "sex", groups=["male", "female"])
    curves += survival.km_curves(sf.assign(all="All chemists"), "all")
    cox = survival.cox_model(sf)
    scox = survival.stratified_cox(sf)
    eras_lr = [e for e in sf.surv_era.unique() if e != "1960+"]
    sizes["survival.json"] = _write("survival.json", {
        "n": int(len(sf)), "events": int(sf.event.sum()), "censored": int((1 - sf.event).sum()),
        "reference_year": REFERENCE_YEAR, "curves": curves, "cox": cox, "stratified_cox": scox,
        "logrank": [survival.logrank(sf, "surv_era", eras_lr)],
    })
    results["survival"] = {"frame": sf, "curves": curves, "cox": cox, "stratified": scox}

    # --- 7. genealogy (before imputation: anomalies use advisor edges) --------------
    g, adv_edges, removed = genealogy.build_graph(ds)
    gm = genealogy.metrics(g)
    trees = genealogy.family_trees(g, gm) if len(gm) else []
    if len(gm):
        gm.to_parquet(PROCESSED / "genealogy_metrics.parquet", index=False)
        node_cols = ["qid", "name", "birth_year", "in_dataset", "nobel", "nobel_chemistry", "descendants",
                     "students", "pagerank", "community", "generations", "nobel_descendants", "chem_descendants"]
        sizes["genealogy.json"] = _write("genealogy.json", {
            "n_nodes": g.number_of_nodes(), "n_edges": g.number_of_edges(),
            "n_in_dataset": int(gm.in_dataset.sum()), "cycles_removed": [list(e) for e in removed],
            "n_components": nx_components(g),
            "nodes": [[r.qid, r.name, r.birth_year, int(r.in_dataset), int(r.nobel), int(r.nobel_chemistry),
                       int(r.descendants), round(float(r.pagerank) * 1e4, 3), int(r.community)]
                      for r in gm[node_cols].itertuples()],
            "node_cols": ["id", "name", "by", "in", "nobel", "nc", "desc", "pr", "comm"],
            "edges": [[a, b] for a, b in g.edges],
            "top": _records(gm.head(50)[node_cols]),
            "top_pagerank": _records(gm.nlargest(25, "pagerank")[node_cols]),
            "top_nobel_lineages": _records(gm.nlargest(25, "nobel_descendants")[node_cols]),
            "top_chemist_mentors": _records(gm[gm.in_dataset].nlargest(25, "chem_descendants")[node_cols]),
            "trees": [{k: v for k, v in t.items() if k != "tree"} for t in trees],
            "chemist_families": genealogy.chemist_families(g, gm),
        })
        sizes["genealogy_summary.json"] = _write("genealogy_summary.json", {
            "n_nodes": g.number_of_nodes(), "n_edges": g.number_of_edges(),
            "chemist_families": genealogy.chemist_families(g, gm)})
    results["genealogy"] = {"graph": g, "metrics": gm, "trees": trees, "removed": removed}

    # --- 5. imputation & anomalies -------------------------------------------------
    c_rep, c_pred = imputation.country_model(ds)
    s_rep, s_pred = imputation.specialty_model(ds)
    anomalies = imputation.date_anomalies(ds, adv_edges if len(adv_edges) else None)
    c_pred.to_parquet(PROCESSED / "imputed_country.parquet", index=False)
    s_pred.to_parquet(PROCESSED / "imputed_specialty.parquet", index=False)
    anomalies.to_parquet(PROCESSED / "date_anomalies.parquet", index=False)
    sizes["imputation.json"] = _write("imputation.json", {
        "country": c_rep, "specialty": s_rep,
        "country_examples": _records(c_pred.nlargest(15, "p_1")),
        "country_pred_dist": c_pred.pred_1.value_counts().head(15).to_dict(),
        "country_confident": int((c_pred.p_1 >= 0.6).sum()), "country_missing": int(len(c_pred)),
        "specialty_pred_dist": s_pred[s_pred.p >= 0.5].pred.value_counts().to_dict(),
        "anomaly_counts": anomalies.check.value_counts().to_dict(),
        "anomalies": _records(anomalies.head(300)),
    })
    results["imputation"] = {"country": c_rep, "specialty": s_rep, "anomalies": anomalies,
                             "country_pred": c_pred, "specialty_pred": s_pred}

    # --- 6. knowledge graph ----------------------------------------------------------
    labels = pd.Series({n: d["name"] for n, d in g.nodes(data=True)}) if g.number_of_nodes() else None
    results["neo4j"] = graph.export(ds, adv_edges if len(adv_edges) else None, labels)

    # --- people index, details shards, explorer parquet ------------------------------
    sizes.update(export_people(ds))
    sizes["meta.json"] = _write("meta.json", meta(ds, results))
    from . import findings
    results["findings"] = findings.build(ds, results)
    sizes["findings.json"] = _write("findings.json", results["findings"])
    qdir = WEB_DATA.parent / "queries"
    qdir.mkdir(parents=True, exist_ok=True)
    for f in QUERIES.glob("*.rq"):
        (qdir / f.name).write_text(f.read_text())
    results["sizes"] = sizes
    results["seconds"] = round(time.time() - t0, 1)
    return results


def nx_components(g) -> list[int]:
    import networkx as nx
    return sorted((len(c) for c in nx.weakly_connected_components(g)), reverse=True)[:10]


def export_people(ds) -> dict:
    P = ds.people
    aff = ds.affiliations.groupby("qid").iso3.apply(lambda s: "|".join(sorted(set(s))))
    labels = ds.person_country.groupby("qid").country_label.apply(lambda s: "|".join(sorted(s)))
    occs = ds.person_occupation.groupby("qid").occupation.apply(lambda s: "|".join(sorted(s)))
    domains = sorted(occupations.load_taxonomy().domain.unique())
    dom_idx = {d: i for i, d in enumerate(domains)}
    tax = occupations.load_taxonomy()
    occ_list = tax.occupation.tolist()
    occ_idx = {o: i for i, o in enumerate(occ_list)}
    occ_of = ds.person_occupation.groupby("qid").occupation.apply(lambda s: sorted(occ_idx[o] for o in s))
    surv_ok = set(survival.survival_frame(ds).qid)
    sex_code = {"male": 1, "female": 2}
    rows = []
    for r in P.itertuples():
        sex = getattr(r, "sex", None)
        rows.append([r.qid, r.name, None if pd.isna(r.birth_year) else int(r.birth_year),
                     None if pd.isna(r.death_year) else int(r.death_year), aff.get(r.qid, ""),
                     dom_idx.get(r.primary_domain, 0), int(r.is_living_likely), int(r.nobel_chemistry),
                     int(r.excluded), occ_of.get(r.qid, []), sex_code.get(sex, 0 if sex is None or pd.isna(sex) else 3),
                     int(r.qid in surv_ok)])
    sizes = {"people.json": _write("people.json", {
        "cols": ["id", "name", "by", "dy", "iso", "dom", "living", "nobel", "excluded", "occ", "sex", "sv"],
        "domains": domains, "occupations": occ_list,
        "occupation_domain": [dom_idx[d] for d in tax.domain],
        "sex": ["unknown", "male", "female", "other"], "rows": rows})}

    # Details, sharded by numeric QID so the drawer fetches ~1/32 of the data.
    rel = ds.relations
    adv = stud = None
    if rel is not None:
        adv_e, lab = enrich.advisor_edges(rel)
        nm = P.set_index("qid").name.to_dict()
        name_of = lambda q: nm.get(q) or lab.get(q) or q  # noqa: E731
        adv = adv_e.groupby("student").advisor.apply(lambda s: [[q, name_of(q), q in nm] for q in s])
        stud = adv_e.groupby("advisor").student.apply(lambda s: [[q, name_of(q), q in nm] for q in s])
        aw = rel[rel.relation == "award"].dropna(subset=["target_label"])
        awards = aw.groupby("qid").apply(lambda g: [[t, l] for t, l in zip(g.target, g.target_label)],
                                         include_groups=False)
        emp = rel[rel.relation == "employer"].dropna(subset=["target_label"]).groupby("qid").target_label.apply(list)
        edu = rel[rel.relation == "educated_at"].dropna(subset=["target_label"]).groupby("qid").target_label.apply(list)
    shards: dict[int, dict] = {i: {} for i in range(N_SHARDS)}
    for r in P.itertuples():
        d = {"n": r.name, "u": r.wikipedia_url, "bd": r.birth_date, "dd": r.death_date,
             "bp": getattr(r, "birth_place_label", None), "sex": getattr(r, "sex", None),
             "c": labels.get(r.qid, "").split("|") if r.qid in labels else [],
             "o": occs.get(r.qid, "").split("|") if r.qid in occs else [],
             "f": list(r.quality_flags), "liv": bool(r.is_living_likely)}
        if rel is not None:
            d.update({"adv": adv.get(r.qid, []), "stu": stud.get(r.qid, []),
                      "aw": awards.get(r.qid, []), "emp": emp.get(r.qid, [])[:12], "edu": edu.get(r.qid, [])[:12]})
        shards[int(r.qid[1:]) % N_SHARDS][r.qid] = {k: v for k, v in d.items() if v not in (None, [], "")}
    (WEB_DATA / "details").mkdir(parents=True, exist_ok=True)
    for i, s in shards.items():
        sizes[f"details/{i}.json"] = _write(f"details/{i}.json", s)

    # Flat parquet for DuckDB-WASM explorer.
    flat = P[["qid", "name", "birth_year", "death_year", "lifespan", "is_living_likely", "primary_domain",
              "era", "nobel_chemistry", "wikipedia_url"]].copy()
    flat["countries"] = flat.qid.map(labels)
    flat["iso3"] = flat.qid.map(aff)
    flat["occupations"] = flat.qid.map(occs)
    if "sex" in P:
        flat["sex"] = P.sex
        flat["birth_place"] = P.get("birth_place_label")
    if rel is not None:
        flat["n_awards"] = flat.qid.map(rel[rel.relation == "award"].groupby("qid").size()).fillna(0).astype(int)
        flat["n_students"] = flat.qid.map(stud.map(len) if stud is not None else {}).fillna(0).astype(int)
    flat["quality_flags"] = P.quality_flags.map(lambda f: "|".join(f))
    flat.to_parquet(WEB_DATA / "chemists.parquet", index=False, compression="zstd")
    sizes["chemists.parquet"] = (WEB_DATA / "chemists.parquet").stat().st_size
    return sizes


def meta(ds, results) -> dict:
    P = ds.people
    status = {}
    sp = INTERIM / "enrich" / "status.json"
    if sp.exists():
        status = json.loads(sp.read_text())
    q = json.loads((PROCESSED / "quality.json").read_text())
    return {
        "generated": time.strftime("%Y-%m-%d"), "reference_year": REFERENCE_YEAR,
        "n_people": int(len(P)), "n_analysable": int((~P.excluded).sum()),
        "n_with_birth": int(P.birth_year.notna().sum()), "n_with_country": int(P.qid.isin(ds.affiliations.qid).sum()),
        "n_living": int(P.is_living_likely.sum()), "n_nobel_chemistry": int(P.nobel_chemistry.sum()),
        "n_female": int((P.get("sex") == "female").sum()) if "sex" in P else None,
        "n_male": int((P.get("sex") == "male").sum()) if "sex" in P else None,
        "n_countries": int(ds.affiliations.iso3.nunique()),
        "n_country_labels": int(ds.person_country.country_label.nunique()),
        "enriched": ds.enriched, "enrichment": status, "quality": {k: q[k] for k in
                                                                    ("fill_rates_pct", "flags", "flag_definitions", "raw")},
        "birth_year_range": q["birth_year_range"],
        "countries": _records(countries.load_iso3()),
        "n_misaligned_rows": q["raw"]["misaligned_rows"],
        "multi_country_people": q["multi_country_people"],
        "domains": sorted(occupations.load_taxonomy().domain.unique()),
    }
