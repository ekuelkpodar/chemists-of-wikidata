// Chemists of Wikidata: load script. Copy data/processed/neo4j/*.csv into Neo4j's import dir.
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
