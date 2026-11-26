"""Second SPARQL pass: advisors, students, awards, employers, education, gender, birthplace.

Batched with VALUES (~200 QIDs per request), polite User-Agent, retries with
exponential backoff, and every batch response cached as JSON in data/interim/enrich/.
`load_enrichment()` only reads the cache, so the rest of the pipeline runs offline.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time

import pandas as pd

from .paths import INTERIM, PROCESSED, QUERIES

ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "chemkg-pipeline/0.1 (open-source research project; python SPARQLWrapper)"
BATCH = 200
CACHE = INTERIM / "enrich"
NOBEL_CHEMISTRY = "Q44585"
NOBEL_PRIZES = {"Q44585": "Chemistry", "Q38104": "Physics", "Q80061": "Physiology or Medicine",
                "Q35637": "Peace", "Q37922": "Literature", "Q47170": "Economics"}
QUERY_FILES = {"relations": "enrich_relations.rq", "attributes": "enrich_attributes.rq",
               "lineage": "enrich_lineage.rq"}
MAX_LINEAGE_ROUNDS = 8


def _qid(uri: str | None) -> str | None:
    if not uri:
        return None
    m = re.search(r"/entity/(Q\d+)$", uri)
    return m.group(1) if m else None


def _cache_path(kind: str, qids: list[str]):
    # Key on the query text too, so editing a .rq file invalidates its cache.
    tmpl = (QUERIES / QUERY_FILES[kind]).read_text()
    h = hashlib.sha1((tmpl + ",".join(qids)).encode()).hexdigest()[:12]
    return CACHE / kind / f"{h}.json"


def fetch_batch(kind: str, qids: list[str], max_tries: int = 6) -> dict:
    from SPARQLWrapper import JSON, POST, SPARQLWrapper

    path = _cache_path(kind, qids)
    if path.exists():
        return json.loads(path.read_text())
    tmpl = (QUERIES / QUERY_FILES[kind]).read_text()
    query = tmpl.replace("{{VALUES}}", " ".join(f"wd:{q}" for q in qids))
    sp = SPARQLWrapper(ENDPOINT, agent=USER_AGENT)
    sp.setMethod(POST)
    sp.setReturnFormat(JSON)
    sp.setQuery(query)
    sp.setTimeout(120)
    delay = 5.0
    for attempt in range(1, max_tries + 1):
        try:
            res = sp.queryAndConvert()
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {"qids": qids, "bindings": res["results"]["bindings"]}
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload))
            tmp.rename(path)
            return payload
        except Exception as e:  # HTTP 429/5xx/timeouts
            if attempt == max_tries:
                raise
            print(f"  {kind} batch retry {attempt} after {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
            time.sleep(delay)
            delay = min(delay * 2, 120)
    raise RuntimeError("unreachable")


def _fetch_all(kind: str, qids: list[str], failed: list, pause: float) -> None:
    batches = [qids[i:i + BATCH] for i in range(0, len(qids), BATCH)]
    for i, b in enumerate(batches):
        cached = _cache_path(kind, b).exists()
        try:
            fetch_batch(kind, b)
        except Exception as e:
            failed.append((kind, i, str(e)[:200]))
            print(f"FAILED {kind} batch {i}: {e}", file=sys.stderr)
            continue
        if not cached:
            print(f"{kind} {i + 1}/{len(batches)}", flush=True)
            time.sleep(pause)


def run(pause: float = 1.0) -> None:
    qids = sorted(pd.read_parquet(PROCESSED / "people.parquet", columns=["qid"]).qid.tolist())
    failed: list = []
    for kind in ("relations", "attributes"):
        _fetch_all(kind, qids, failed, pause)
    # Lineage: walk advisor chains upward beyond the chemist set.
    known = set(qids)
    data = load_enrichment()
    frontier = set()
    if data is not None:
        e, _ = advisor_edges(data["relations"])
        frontier = set(e.advisor) - known
    rounds = 0
    while frontier and rounds < MAX_LINEAGE_ROUNDS:
        rounds += 1
        print(f"lineage round {rounds}: {len(frontier)} ancestors", flush=True)
        batch_q = sorted(frontier)
        _fetch_all("lineage", batch_q, failed, pause)
        known |= frontier
        lin = _load_lineage()
        frontier = set(lin[lin.prop == "P184"].target.dropna()) - known
    (CACHE / "status.json").write_text(json.dumps(
        {"people": len(qids), "lineage_rounds": rounds, "failed": failed,
         "finished": time.strftime("%Y-%m-%d %H:%M:%S")}, indent=2))
    print(f"done; {len(failed)} failed batches")


def _load_lineage() -> pd.DataFrame:
    rows = []
    for f in sorted((CACHE / "lineage").glob("*.json")):
        for b in json.loads(f.read_text())["bindings"]:
            rows.append({"qid": _qid(_val(b, "item")), "label": _val(b, "itemLabel"),
                         "birth": (_val(b, "birth") or "")[:5] or None,
                         "prop": _val(b, "prop"), "target": _qid(_val(b, "value")),
                         "target_label": _val(b, "valueLabel")})
    return pd.DataFrame(rows, columns=["qid", "label", "birth", "prop", "target", "target_label"])


def _val(b, k):
    return b.get(k, {}).get("value")


def load_enrichment() -> dict[str, pd.DataFrame] | None:
    """Parse cached batches into tidy tables. Returns None when nothing is cached."""
    rel_rows, attr_rows = [], []
    for f in sorted((CACHE / "relations").glob("*.json")):
        for b in json.loads(f.read_text())["bindings"]:
            rel_rows.append({"qid": _qid(_val(b, "item")), "prop": _val(b, "prop"),
                             "target": _qid(_val(b, "value")), "target_label": _val(b, "valueLabel")})
    for f in sorted((CACHE / "attributes").glob("*.json")):
        for b in json.loads(f.read_text())["bindings"]:
            attr_rows.append({"qid": _qid(_val(b, "item")), "sex": _val(b, "sexLabel"),
                              "instance_of": _qid(_val(b, "instanceOf")),
                              "birth_place": _qid(_val(b, "birthPlace")),
                              "birth_place_label": _val(b, "birthPlaceLabel"),
                              "coord": _val(b, "coord"),
                              "bp_country": _qid(_val(b, "bpCountry")),
                              "bp_country_label": _val(b, "bpCountryLabel"),
                              "bp_iso3": _val(b, "bpIso")})
    if not rel_rows and not attr_rows:
        return None
    rel = pd.DataFrame(rel_rows, columns=["qid", "prop", "target", "target_label"]).dropna(subset=["qid", "target"]).drop_duplicates()
    # A label equal to the QID means Wikidata has no English label.
    rel.loc[rel.target_label == rel.target, "target_label"] = None
    attr = pd.DataFrame(attr_rows, columns=["qid", "sex", "instance_of", "birth_place", "birth_place_label",
                                            "coord", "bp_country", "bp_country_label", "bp_iso3"])

    def coord(s):
        m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", s or "")
        return (float(m.group(2)), float(m.group(1))) if m else (None, None)

    attr["bp_lat"] = attr.coord.map(lambda c: coord(c)[0]).astype(float)
    attr["bp_lon"] = attr.coord.map(lambda c: coord(c)[1]).astype(float)
    person = (attr.groupby("qid").agg(
        sex=("sex", lambda s: s.dropna().iloc[0] if s.notna().any() else None),
        is_human=("instance_of", lambda s: "Q5" in set(s)),
        birth_place=("birth_place", "first"), birth_place_label=("birth_place_label", "first"),
        bp_lat=("bp_lat", "first"), bp_lon=("bp_lon", "first"),
        bp_country=("bp_country", "first"), bp_country_label=("bp_country_label", "first"),
        bp_iso3=("bp_iso3", "first"),
    ).reset_index())
    edges = rel.rename(columns={"prop": "relation"})
    edges["relation"] = edges.relation.map({"P184": "advisor", "P185": "student", "P166": "award",
                                            "P108": "employer", "P69": "educated_at"})
    lineage = _load_lineage()
    return {"person_attributes": person, "relations": edges, "lineage": lineage}


def advisor_edges(relations: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Directed advisor -> student edges, merging P184 (on student) and P185 (on advisor)."""
    a = relations[relations.relation == "advisor"].rename(columns={"target": "advisor", "qid": "student",
                                                                   "target_label": "advisor_label"})
    s = relations[relations.relation == "student"].rename(columns={"qid": "advisor", "target": "student",
                                                                   "target_label": "student_label"})
    e = pd.concat([a[["advisor", "student", "advisor_label"]], s[["advisor", "student", "student_label"]]])
    labels = pd.concat([a.set_index("advisor").advisor_label, s.set_index("student").student_label])
    labels = labels[~labels.index.duplicated()]
    e = e.drop_duplicates(["advisor", "student"])[["advisor", "student"]]
    e = e[e.advisor != e.student]
    return e.reset_index(drop=True), labels.rename("label")


if __name__ == "__main__":
    run()
