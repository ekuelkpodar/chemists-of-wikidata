"""Academic genealogy: doctoral advisor -> student DAG.

Edges merge P184 (doctoral advisor, on the student) and P185 (doctoral student, on the
advisor) for every chemist, plus upward lineage beyond the chemist set fetched by
enrich.py. Ancestors outside the chemist set (physicists, physicians, ...) are kept
as nodes so lineages are not truncated, but are marked `in_dataset = False`.

Metrics
  * descendants: size of the set reachable downward (all academic descendants)
  * pagerank: on the reversed graph (student -> advisor), so credit flows to mentors
  * nobel_descendants: Nobel laureates (any Nobel; chemistry separately) among descendants
  * Louvain communities on the undirected graph (seeded, reproducible)
  * family trees: roots (no known advisor) ranked by descendant count
"""
from __future__ import annotations

import networkx as nx
import pandas as pd

from . import enrich
from .data import Dataset


def build_graph(ds: Dataset) -> tuple[nx.DiGraph, pd.DataFrame, list]:
    rel = ds.relations
    if rel is None:
        return nx.DiGraph(), pd.DataFrame(columns=["advisor", "student"]), []
    edges, labels = enrich.advisor_edges(rel)
    lin = ds.lineage
    lin_labels = pd.Series(dtype=object)
    if lin is not None and len(lin):
        up = lin[lin.prop == "P184"].dropna(subset=["target"])
        edges = pd.concat([edges, pd.DataFrame({"advisor": up.target, "student": up.qid})]).drop_duplicates()
        lin_labels = pd.concat([lin.drop_duplicates("qid").set_index("qid").label,
                                up.drop_duplicates("target").set_index("target").target_label])
        lin_labels = lin_labels[lin_labels.notna() & ~lin_labels.index.duplicated()]
    p = ds.people.set_index("qid")
    g = nx.DiGraph()
    g.add_edges_from(edges[["advisor", "student"]].itertuples(index=False, name=None))
    # Break cycles (data errors such as mutual advisor statements) deterministically.
    removed = []
    while True:
        try:
            cyc = nx.find_cycle(g)
        except nx.NetworkXNoCycle:
            break
        u, v = sorted(cyc)[0][:2]
        g.remove_edge(u, v)
        removed.append((u, v))
    nobel_any = set(ds.people.qid[ds.people.nobel_any])
    nobel_chem = set(ds.people.qid[ds.people.nobel_chemistry])
    if lin is not None and len(lin):
        aw = lin[lin.prop == "P166"]
        nobel_any |= set(aw[aw.target.isin(enrich.NOBEL_PRIZES)].qid)
        nobel_chem |= set(aw[aw.target == enrich.NOBEL_CHEMISTRY].qid)
    lin_birth = (lin.dropna(subset=["birth"]).drop_duplicates("qid").set_index("qid").birth
                 .str.extract(r"(-?\d{1,4})")[0].astype(float) if lin is not None and len(lin) else pd.Series(dtype=float))
    for n in g.nodes:
        inside = n in p.index
        g.nodes[n].update({
            "name": p.loc[n, "name"] if inside else (labels.get(n) or lin_labels.get(n) or n),
            "birth_year": (None if pd.isna(p.loc[n, "birth_year"]) else int(p.loc[n, "birth_year"])) if inside
            else (None if pd.isna(lin_birth.get(n)) else int(lin_birth.get(n))),
            "in_dataset": inside, "nobel": n in nobel_any, "nobel_chemistry": n in nobel_chem,
        })
    return g, edges, removed


def metrics(g: nx.DiGraph, seed: int = 42) -> pd.DataFrame:
    if g.number_of_nodes() == 0:
        return pd.DataFrame()
    pr = nx.pagerank(g.reverse(copy=False), alpha=0.85)
    rows = []
    for n in g.nodes:
        desc = nx.descendants(g, n)
        rows.append({"qid": n, **g.nodes[n], "students": g.out_degree(n), "descendants": len(desc),
                     "nobel_descendants": sum(g.nodes[d]["nobel"] for d in desc),
                     "nobel_chem_descendants": sum(g.nodes[d]["nobel_chemistry"] for d in desc),
                     "chem_descendants": sum(g.nodes[d]["in_dataset"] for d in desc),
                     "generations": (max(nx.single_source_shortest_path_length(g, n).values()) if desc else 0),
                     "pagerank": pr[n], "is_root": g.in_degree(n) == 0})
    df = pd.DataFrame(rows)
    comms = nx.community.louvain_communities(g.to_undirected(), seed=seed, resolution=1.0)
    cid = {n: i for i, c in enumerate(sorted(comms, key=len, reverse=True)) for n in c}
    df["community"] = df.qid.map(cid)
    return df.sort_values(["descendants", "qid"], ascending=[False, True], kind="stable").reset_index(drop=True)


def family_trees(g: nx.DiGraph, m: pd.DataFrame, k: int = 10, max_nodes: int = 1500) -> list[dict]:
    """Top-k roots by number of *chemist* descendants (so deep pre-modern medical
    ancestries reached via the lineage pass don't crowd out chemistry's own families),
    each as a nested tree (spanning tree by BFS so a
    person with two advisors appears once, under the first-reached advisor)."""
    # Many roots sit atop the same shared genealogy (several 15th–16th-century teachers all
    # lead to the same ~500 chemists); skip a root whose chemist descendants are >= 80%
    # covered by roots already chosen.
    chem = {n for n, d in g.nodes(data=True) if d["in_dataset"]}
    chosen, covered = [], set()
    for r in m[m.is_root].sort_values(["chem_descendants", "birth_year", "qid"], ascending=[False, True, True], kind="stable").itertuples():
        if len(chosen) == k:
            break
        cd = nx.descendants(g, r.qid) & chem
        if cd and len(cd & covered) / len(cd) >= 0.8:
            continue
        chosen.append(r)
        covered |= cd
    trees = []
    for r in chosen:
        seen = {r.qid}
        def node(q, depth=0):
            kids = []
            for c in sorted(g.successors(q), key=lambda c: (g.nodes[c]["birth_year"] or 9999, c)):
                if c not in seen and len(seen) < max_nodes:
                    seen.add(c)
                    kids.append(c)
            d = g.nodes[q]
            out = {"id": q, "name": d["name"], "by": d["birth_year"], "nobel": d["nobel"],
                   "nc": d["nobel_chemistry"], "in": d["in_dataset"]}
            ch = [node(c, depth + 1) for c in kids]
            if ch:
                out["children"] = ch
            return out
        trees.append({"root": r.qid, "name": r.name, "descendants": int(r.descendants),
                      "chem_descendants": int(r.chem_descendants), "birth_year": r.birth_year,
                      "nobel_descendants": int(r.nobel_descendants), "generations": int(r.generations),
                      "tree": node(r.qid)})
    return trees


def chemist_families(g: nx.DiGraph, m: pd.DataFrame, k: int = 10) -> list[dict]:
    """Chemistry's own founding families: in-dataset chemists ranked by chemist descendants,
    greedily skipping anyone who is a descendant of an already chosen founder."""
    chosen, covered = [], set()
    for r in m[m.in_dataset].sort_values(["chem_descendants", "qid"], ascending=[False, True], kind="stable").itertuples():
        if len(chosen) == k:
            break
        if r.qid in covered:
            continue
        chosen.append(r)
        covered |= nx.descendants(g, r.qid)
    return [{"root": r.qid, "name": r.name, "birth_year": r.birth_year, "descendants": int(r.descendants),
             "chem_descendants": int(r.chem_descendants), "nobel_descendants": int(r.nobel_descendants),
             "generations": int(r.generations)} for r in chosen]


def lineage_path(g: nx.DiGraph, a: str, b: str) -> list[str] | None:
    """Shortest undirected path between two people through advisor links."""
    try:
        return nx.shortest_path(g.to_undirected(as_view=True), a, b)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None
