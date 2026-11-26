"""Neo4j-ready knowledge-graph export.

Nodes: Person, Country, Occupation, Domain, Era, Award, Institution
Rels:  CITIZEN_OF, HAS_OCCUPATION, IN_DOMAIN, BORN_IN_ERA, ADVISED, RECEIVED,
       WORKED_AT, EDUCATED_AT, SUCCESSOR_OF (historical country -> modern country)

Files land in data/processed/neo4j/ with a `load.cypher` that uses LOAD CSV
(copy the folder into Neo4j's import directory, then run the script).
"""
from __future__ import annotations

import pandas as pd

from . import countries, enrich, occupations
from .data import Dataset, era_order
from .paths import PROCESSED

OUT = PROCESSED / "neo4j"

LOAD_CYPHER = """// Chemists of Wikidata: load script. Copy data/processed/neo4j/*.csv into Neo4j's import dir.
CREATE CONSTRAINT person_qid IF NOT EXISTS FOR (p:Person) REQUIRE p.qid IS UNIQUE;
CREATE CONSTRAINT country_label IF NOT EXISTS FOR (c:Country) REQUIRE c.label IS UNIQUE;
CREATE CONSTRAINT occupation_name IF NOT EXISTS FOR (o:Occupation) REQUIRE o.name IS UNIQUE;
CREATE CONSTRAINT domain_name IF NOT EXISTS FOR (d:Domain) REQUIRE d.name IS UNIQUE;
CREATE CONSTRAINT era_name IF NOT EXISTS FOR (e:Era) REQUIRE e.name IS UNIQUE;
CREATE CONSTRAINT award_qid IF NOT EXISTS FOR (a:Award) REQUIRE a.qid IS UNIQUE;
CREATE CONSTRAINT inst_qid IF NOT EXISTS FOR (i:Institution) REQUIRE i.qid IS UNIQUE;

LOAD CSV WITH HEADERS FROM 'file:///persons.csv' AS r
MERGE (p:Person {qid: r.qid})
SET p.name = r.name, p.birth_year = toInteger(r.birth_year), p.death_year = toInteger(r.death_year),
    p.in_dataset = r.in_dataset = 'true', p.nobel_chemistry = r.nobel_chemistry = 'true',
    p.sex = r.sex, p.wikipedia_url = r.wikipedia_url, p.field = r.field;

LOAD CSV WITH HEADERS FROM 'file:///countries.csv' AS r
MERGE (c:Country {label: r.label}) SET c.iso3 = r.iso3, c.modern_name = r.modern_name, c.kind = r.kind,
  c.region = r.region, c.lat = toFloat(r.lat), c.lon = toFloat(r.lon);
LOAD CSV WITH HEADERS FROM 'file:///occupations.csv' AS r
MERGE (o:Occupation {name: r.name}) MERGE (d:Domain {name: r.domain}) MERGE (o)-[:IN_DOMAIN]->(d);
LOAD CSV WITH HEADERS FROM 'file:///eras.csv' AS r
MERGE (e:Era {name: r.name}) SET e.start = toInteger(r.start);
LOAD CSV WITH HEADERS FROM 'file:///awards.csv' AS r
MERGE (a:Award {qid: r.qid}) SET a.name = r.name, a.is_nobel = r.is_nobel = 'true';
LOAD CSV WITH HEADERS FROM 'file:///institutions.csv' AS r
MERGE (i:Institution {qid: r.qid}) SET i.name = r.name;

LOAD CSV WITH HEADERS FROM 'file:///successor_of.csv' AS r
MATCH (h:Country {label: r.historical}), (m:Country {label: r.modern}) MERGE (h)-[:SUCCESSOR_OF]->(m);
LOAD CSV WITH HEADERS FROM 'file:///citizen_of.csv' AS r
MATCH (p:Person {qid: r.qid}), (c:Country {label: r.country}) MERGE (p)-[:CITIZEN_OF]->(c);
LOAD CSV WITH HEADERS FROM 'file:///has_occupation.csv' AS r
MATCH (p:Person {qid: r.qid}), (o:Occupation {name: r.occupation}) MERGE (p)-[:HAS_OCCUPATION]->(o);
LOAD CSV WITH HEADERS FROM 'file:///born_in_era.csv' AS r
MATCH (p:Person {qid: r.qid}), (e:Era {name: r.era}) MERGE (p)-[:BORN_IN_ERA]->(e);
LOAD CSV WITH HEADERS FROM 'file:///advised.csv' AS r
MATCH (a:Person {qid: r.advisor}), (s:Person {qid: r.student}) MERGE (a)-[:ADVISED]->(s);
LOAD CSV WITH HEADERS FROM 'file:///received.csv' AS r
MATCH (p:Person {qid: r.qid}), (a:Award {qid: r.award}) MERGE (p)-[:RECEIVED]->(a);
LOAD CSV WITH HEADERS FROM 'file:///worked_at.csv' AS r
MATCH (p:Person {qid: r.qid}), (i:Institution {qid: r.institution}) MERGE (p)-[:WORKED_AT]->(i);
LOAD CSV WITH HEADERS FROM 'file:///educated_at.csv' AS r
MATCH (p:Person {qid: r.qid}), (i:Institution {qid: r.institution}) MERGE (p)-[:EDUCATED_AT]->(i);
"""


def export(ds: Dataset, advisor_edges: pd.DataFrame | None, ancestor_labels: pd.Series | None) -> dict[str, int]:
    OUT.mkdir(parents=True, exist_ok=True)
    p = ds.people
    persons = p[["qid", "name", "birth_year", "death_year", "wikipedia_url", "field",
                 "nobel_chemistry"]].assign(sex=p.get("sex"), in_dataset=True)
    if advisor_edges is not None and len(advisor_edges):
        ext = sorted((set(advisor_edges.advisor) | set(advisor_edges.student)) - set(p.qid))
        lin = ds.lineage
        ext_birth = (lin.dropna(subset=["birth"]).drop_duplicates("qid").set_index("qid").birth
                     .str.extract(r"(-?\d{1,4})")[0] if lin is not None and len(lin) else pd.Series(dtype=str))
        ext_nobel = set(lin[(lin.prop == "P166") & (lin.target == enrich.NOBEL_CHEMISTRY)].qid) if lin is not None and len(lin) else set()
        persons = pd.concat([persons, pd.DataFrame({
            "qid": ext, "name": [ancestor_labels.get(q, q) if ancestor_labels is not None else q for q in ext],
            "birth_year": [ext_birth.get(q) for q in ext], "in_dataset": False,
            "nobel_chemistry": [q in ext_nobel for q in ext]})], ignore_index=True)
    files = {"persons": persons}

    cmap = countries.load_country_map()
    files["countries"] = cmap.rename(columns={"country_label": "label"})[
        ["label", "iso3", "modern_name", "kind", "region", "lat", "lon"]]
    modern_label = cmap[cmap.kind == "modern"].drop_duplicates("iso3").set_index("iso3").country_label
    succ = cmap[(cmap.kind != "modern") & cmap.iso3.isin(modern_label.index)]
    files["successor_of"] = pd.DataFrame({"historical": succ.country_label, "modern": succ.iso3.map(modern_label)})
    tax = occupations.load_taxonomy()
    files["occupations"] = tax.rename(columns={"occupation": "name"})[["name", "domain"]]
    files["eras"] = pd.DataFrame({"name": era_order(),
                                  "start": [None] + [int(e[:4]) for e in era_order()[1:]]})
    files["citizen_of"] = ds.person_country.rename(columns={"country_label": "country"})[["qid", "country"]]
    files["has_occupation"] = ds.person_occupation[["qid", "occupation"]]
    files["born_in_era"] = p.dropna(subset=["era"])[["qid", "era"]]
    if advisor_edges is not None:
        files["advised"] = advisor_edges[["advisor", "student"]]
    r = ds.relations
    if r is not None:
        aw = r[r.relation == "award"]
        files["awards"] = (aw.drop_duplicates("target")[["target", "target_label"]]
                           .rename(columns={"target": "qid", "target_label": "name"})
                           .assign(is_nobel=lambda d: d.qid.isin(enrich.NOBEL_PRIZES)))
        files["received"] = aw.rename(columns={"target": "award"})[["qid", "award"]]
        inst = r[r.relation.isin(["employer", "educated_at"])]
        files["institutions"] = (inst.drop_duplicates("target")[["target", "target_label"]]
                                 .rename(columns={"target": "qid", "target_label": "name"}))
        files["worked_at"] = r[r.relation == "employer"].rename(columns={"target": "institution"})[["qid", "institution"]]
        files["educated_at"] = r[r.relation == "educated_at"].rename(columns={"target": "institution"})[["qid", "institution"]]
    else:
        for k, cols in {"awards": ["qid", "name", "is_nobel"], "received": ["qid", "award"],
                        "institutions": ["qid", "name"], "worked_at": ["qid", "institution"],
                        "educated_at": ["qid", "institution"], "advised": ["advisor", "student"]}.items():
            files.setdefault(k, pd.DataFrame(columns=cols))
    for name, df in files.items():
        df.to_csv(OUT / f"{name}.csv", index=False)
    (OUT / "load.cypher").write_text(LOAD_CYPHER)
    return {k: len(v) for k, v in files.items()}
