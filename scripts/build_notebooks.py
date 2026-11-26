"""Generate the narrative analysis notebooks (02–08). `make analyses` then executes them.

Notebooks are generated from this script so their structure is reviewable as code;
the executed .ipynb files (with outputs) are committed.
"""
import nbformat as nbf

M, C = nbf.v4.new_markdown_cell, nbf.v4.new_code_cell

SETUP = """import json, warnings
import pandas as pd, numpy as np
import matplotlib.pyplot as plt
from chemkg.data import load, analysable
from chemkg import countries
warnings.filterwarnings("ignore")
pd.set_option("display.max_colwidth", 70)
plt.rcParams.update({"figure.dpi": 110, "axes.spines.top": False, "axes.spines.right": False, "font.size": 10})
ds = load()
P, A = ds.people, analysable(ds.people)
NAMES = countries.load_iso3().set_index("iso3").name.to_dict()
print(f"{len(P):,} people, {len(A):,} analysable; enrichment loaded: {ds.enriched}")"""

NOTEBOOKS = {
"02_migration": [
M("""# 02 · Migration network

**Question:** where did chemists move, and which countries gained or lost talent?

**Method** (`chemkg.migration`)
- A migration edge *origin → destination* needs evidence that a person was tied to two territorially distinct countries. Territory sets come from notebook 01, so Russian Empire → Soviet Union counts as one place.
- Direction comes from place of birth (P19 → current country P17):
  1. The birthplace is inside one citizenship → that citizenship is the origin.
  2. The birthplace is outside every citizenship → the birthplace country is the origin (e.g. born in Hungary, US citizen only).
  3. No birthplace → an undirected corridor, reported but not drawn.
- **Border shifts.** A birthplace's *current* country can differ from the country that held it at birth (Breslau, now Wrocław). For known border pairs, births before the shift year are labelled `border_shift` and excluded.
- Eras are 25-year *birth* cohorts.

**Assumptions:** citizenship is a proxy for where people worked, and moves without naturalisation are invisible. Dual citizenship from birth looks like migration."""),
C(SETUP),
C("""from chemkg import migration
edges = migration.build_edges(ds)
mig = migration.summarise(edges)
pd.Series(mig["method_counts"]).rename("edges")"""),
M("### Top corridors (directed)"),
C("""cor = mig["corridors"].assign(origin=lambda d: d.origin.map(NAMES), dest=lambda d: d.dest.map(NAMES))
cor.head(20)"""),
M("### Net brain gain"),
C("""bal = mig["balance"].rename(index=NAMES)
pd.concat([bal.head(10), bal.tail(8)])"""),
C("""top = mig["balance"].head(8).index.tolist() + mig["balance"].tail(5).index.tolist()
en = mig["era_net"][mig["era_net"].iso3.isin(top)].pivot_table(index="era", columns="iso3", values="net", fill_value=0)
en = en.reindex([e for e in mig["era_order"] if e in en.index])
ax = en[["USA", "GBR", "DEU", "CAN"] if set(["USA","GBR","DEU","CAN"]) <= set(en.columns) else en.columns[:4]].plot(marker="o", figsize=(9, 3.5))
ax.axhline(0, color="#999", lw=1); ax.set_ylabel("net migrants (in − out)"); ax.set_xlabel("birth cohort")
ax.set_title(f"Net migration by birth cohort (n = {mig['n_people_directed']:,} people with a directed move)\\nCaveat: citizenship-based; English-Wikipedia notability", fontsize=10)
plt.xticks(rotation=45); plt.tight_layout()"""),
M("### Corridors by era"),
C("""be = mig["by_era"].assign(corridor=lambda d: d.origin.map(NAMES) + " → " + d.dest.map(NAMES))
be.sort_values("n", ascending=False).groupby("era").head(3).sort_values(["era", "n"], ascending=[True, False])"""),
M("""### Reading the result
- The United States dominates inflows from the late-19th-century cohorts on. Germany → US is the largest single corridor.
- The largest net exporters are Germany, Austria, Russia, Poland and China. That fits the 1930s emigration from Central Europe, Soviet-era emigration and the post-1949 Chinese diaspora.
- Israel's positive balance reflects post-1948 immigration, mostly from Eastern Europe.
- **Limitation:** only about 1 in 10 chemists has a recorded move, and the US share is inflated by English-Wikipedia coverage."""),
],
"03_center_of_gravity": [
M("""# 03 · Center of gravity

**Question:** which country produced the largest share of each generation of chemists, and when did leadership change hands?

**Method** (`chemkg.cohorts`)
- Unit: birth decade. Each person counts toward the modern successor of each citizenship component, weighted 1/k for k components.
- **Leader** per decade: the largest share in a centred 3-decade rolling window. A **handoff** needs the new leader to hold the top spot for at least 2 consecutive decades (hysteresis), so near-ties don't flap. Decades with fewer than 30 people in the window are flagged as low-n.
- **Geographic center:** the spherical mean of birthplace coordinates (citizenship country's point when the birthplace is unknown).

**Assumption:** historical states are attributed to their *primary* modern successor (Prussia → Germany, Austria-Hungary → Austria)."""),
C(SETUP),
C("""from chemkg import cohorts
counts, shares = cohorts.decade_shares(ds)
lead = cohorts.leaders(counts)
hand = cohorts.handoffs(lead)
pd.DataFrame(hand).assign(**{"from": lambda d: d["from"].map(NAMES), "to": lambda d: d["to"].map(NAMES)})"""),
C("""lead.assign(leader=lead.leader.map(NAMES), runner_up=lead.runner_up.map(NAMES)).iloc[::2]"""),
C("""fig, ax = plt.subplots(figsize=(10, 4))
keys = ["FRA", "DEU", "GBR", "USA", "RUS"]
sm = shares[keys].rolling(3, center=True, min_periods=1).mean()
sm = sm[counts.sum(axis=1).rolling(3, center=True, min_periods=1).sum() >= 30]
for k in keys: ax.plot(sm.index, sm[k], label=NAMES[k], lw=2)
for h in hand: ax.axvline(h["decade"], color="#888", lw=1, ls=":")
ax.yaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(1.0)); ax.legend(frameon=False, ncol=5)
ax.set_title(f"Share of each birth decade's chemists (3-decade smoothing; n = {int(counts.sum().sum()):,})\\nCaveat: notable = English Wikipedia article; anglophone countries over-represented", fontsize=10)
plt.tight_layout()"""),
C("""center = cohorts.geographic_center(ds)
center.iloc[::5]"""),
M("""### Reading the result
- France leads the 18th-century cohorts, the German states lead from the 1810s, and the United States overtakes Germany in the 1860s birth cohort.
- The US peaks at about 40% of chemists born in the 1910s, then falls: Germany recovers somewhat, and India rises to about 8% of the 1970s cohort.
- Japan and China stay under 3% of every cohort. That reflects English-Wikipedia coverage, not the real size of East Asian chemistry, and it is the clearest sign of the dataset's bias.
- The geographic center moves from central Europe into the North Atlantic. That's what a mean of two continents does, and it is the clearest single picture of the shift."""),
],
"04_specialties": [
M("""# 04 · Specialty evolution

**Question:** how did chemistry's sub-fields emerge and grow?

**Method** (`chemkg.occupations`)
- Co-occurrence graph: nodes are the 46 occupation labels; an edge joins two labels held by the same person, weighted by count and Jaccard.
- First appearance: the earliest holder's birth year and the birth year by which **3** holders exist (robust to one retro-tagged figure).
- Growth: people per birth decade holding each domain.

**Assumption:** labels are applied retrospectively by Wikidata editors. 'Emergence' means adoption of the label for people born then, not the founding of the field."""),
C(SETUP),
C("""from chemkg import occupations
nodes, edges = occupations.cooccurrence(ds.person_occupation, set(A.qid))
edges.head(15)"""),
C("""first = occupations.first_appearance(ds.person_occupation, A)
first[first.n >= 5]"""),
C("""growth = occupations.growth_by_decade(ds.person_occupation, A)
tot = A.dropna(subset=["birth_year"]).assign(d=lambda d: (d.birth_year // 10 * 10).astype(int)).groupby("d").size()
share = growth.div(tot.reindex(growth.index), axis=0).loc[1800:1990]
share = share[tot.reindex(share.index) >= 20]
ax = share.drop(columns=["General chemistry"]).plot(figsize=(10, 4), lw=2)
ax.yaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(1.0))
ax.set_title(f"Share of each birth decade holding a specialist label (decades with ≥ 20 people; n = {int(tot.loc[1800:1999].sum()):,})\\nCaveat: most people carry only 'chemist'; shares are lower bounds", fontsize=10)
ax.legend(frameon=False, fontsize=8); plt.tight_layout()"""),
M("""### Reading the result
- Life & medicinal chemistry (biochemistry, pharmacology, toxicology) grows from about a seventh of cohorts born in the mid-19th century to about a third of those born in the mid-20th. It is the main structural change in the profession.
- `chemist + biochemist` is the dominant pair, and pharmacology bridges biochemistry and toxicology.
- Apart from the generic label, the best-connected specialties are biochemist, physical chemist, pharmacologist and chemical engineer."""),
],
"05_survival": [
M("""# 05 · Survival analysis

**Question:** how long did chemists live, and how does that differ by era, specialty, region and sex?

**Method** (`chemkg.survival`)
- Subjects: analysable people born 1700 or later. Duration is age at death, or age in 2026 for the **likely living** (right-censored).
- Excluded: no birth year; born ≤ 1916 with no death date (a missing date, not censoring); lifespans over 110 or under 15 (date errors).
- Kaplan–Meier with log-log 95% CIs; log-rank test across eras.
- Cox PH: birth era (ref 1850–1899), primary domain (ref General), region (ref Western Europe), sex (ref male), more than one citizenship. Sparse levels are folded into "Other". PH is checked with Schoenfeld-residual tests (rank time transform). A second Cox model stratified by era drops the PH assumption for era.

**Honesty about bias.** Inclusion requires notability, which requires surviving long enough to become notable (immortal-time bias). Survival at young ages is overstated, and the era effect mixes real mortality decline with changing notability. Left truncation (when someone *enters* Wikipedia) isn't modelled. Treat this as descriptive."""),
C(SETUP),
C("""from chemkg import survival
sf = survival.survival_frame(ds)
print(f"n = {len(sf):,}; deaths = {sf.event.sum():,}; censored = {(1 - sf.event).sum():,}")
sf.groupby("surv_era").agg(n=("qid", "size"), deaths=("event", "sum"))"""),
C("""from lifelines import KaplanMeierFitter
fig, ax = plt.subplots(figsize=(9, 4.5))
for era in ["1700–1799", "1800–1849", "1850–1899", "1900–1929", "1930–1959"]:
    s = sf[sf.surv_era == era]
    KaplanMeierFitter(label=f"{era} (n={len(s):,})").fit(s.duration, s.event).plot_survival_function(ax=ax, ci_show=True)
ax.set_xlim(20, 105); ax.set_xlabel("age"); ax.set_ylabel("share alive")
ax.set_title("Kaplan–Meier survival by birth era (95% CI; living censored at 2026)\\nCaveat: survivorship/notability bias — not a population life table", fontsize=10)
plt.tight_layout()"""),
C("""pd.DataFrame([{k: c[k] for k in ("by", "group", "n", "events", "censored", "median", "median_ci")} for c in
              survival.km_curves(sf, "surv_era") + survival.km_curves(sf, "primary_domain", min_n=150) + survival.km_curves(sf, "region", min_n=150)])"""),
C("""survival.logrank(sf, "surv_era", ["1700–1799", "1800–1849", "1850–1899", "1900–1929", "1930–1959"])"""),
M("### Cox proportional hazards"),
C("""cox = survival.cox_model(sf)
print(f"n = {cox['n']:,}, events = {cox['events']:,}, concordance = {cox['concordance']:.3f}")
print("PH violations (p < 0.01):", cox["ph_violations"])
pd.DataFrame(cox["terms"]).round(4)"""),
C("""scox = survival.stratified_cox(sf)
pd.DataFrame(scox["terms"]).round(4)"""),
M("""### Reading the result
- Median age at death rises from about 69 (born 1700s) to the mid-80s (born 1900–1929). Later cohorts are heavily censored, and their medians depend on the survivors.
- The era effect violates PH, as expected: hazards differ most at younger ages. The stratified model removes era from the PH assumption. The other hazard ratios shrink toward 1 (more than one citizenship: 0.82 → 0.89; female: 0.78 → 0.82) but stay below it.
- People with more than one citizenship have a lower hazard. This is almost certainly selection (you have to survive to emigrate, and migrants were often established scientists), not a causal effect of migrating.
- Former-USSR and sub-Saharan chemists have higher hazards and East Asian chemists lower ones. These are consistent with national life-expectancy differences, but the samples are small."""),
],
"06_imputation_anomalies": [
M("""# 06 · Imputation & anomaly detection

**Questions:** can we predict a chemist's missing country or specialty from other features? Which dates are probably wrong?

**Method** (`chemkg.imputation`)
- **Country:** target is the single modern country (people with exactly one affiliation), top 20 + OTHER. Features: character 2–4-grams of the name, birth decade, occupations, sex, birthplace country, words from employer/alma mater/award labels. Multinomial logistic regression (balanced class weights), stratified 5-fold CV.
  Baselines: majority class, and "birthplace country if known, else majority".
- **Specialty:** primary specialist domain, with occupation features removed (they *are* the label).
- **Dates:** rule flags, plus a relational check from the advisor graph (advisor born < 15 or > 80 years before the student).

**Assumption:** predictions are stored separately (`data/processed/imputed_*.parquet`) and **never** fed back into other analyses."""),
C(SETUP),
C("""from chemkg import imputation
crep, cpred = imputation.country_model(ds)
pd.DataFrame({k: {"mean": v[0], "sd": v[1]} for k, v in crep["accuracy"].items()}).T.assign(
    macro_f1=[crep["macro_f1"]["model"], None, crep["macro_f1"]["baseline_rule"]])"""),
C("""print(f"top-3 accuracy: {crep['top3_accuracy_model']:.3f}")
cpred.sort_values("p_1", ascending=False).head(15)"""),
C("""srep, spred = imputation.specialty_model(ds)
{k: srep[k] for k in ("n", "accuracy", "macro_f1", "unweighted_model", "top3_accuracy_model")}"""),
M("""The specialty model doesn't beat the majority class on accuracy. With balanced weights it trades accuracy for macro-F1. Without occupation text, specialty can't be recovered from names, eras and institutions, so **we don't impute specialty**. That's the honest negative result."""),
C("""from chemkg import genealogy
g, adv, _ = genealogy.build_graph(ds)
an = imputation.date_anomalies(ds, adv if len(adv) else None)
print(an.check.value_counts())
an[an.check == "advisor_age_gap"].head(15)"""),
M("""### Reading the result
- Names carry a lot of nationality signal. The country model reaches about 88% accuracy, against 70% for the birthplace rule and 31% for the majority class, with about 97% top-3 accuracy. That makes it useful for *suggesting* Wikidata edits, not for silently filling gaps.
- Advisor age gaps outside 15–80 years catch real errors: swapped advisor/student statements, and confused namesakes or birth years."""),
],
"07_knowledge_graph": [
M("""# 07 · Knowledge graph export (Neo4j)

`chemkg.graph.export` writes node and relationship CSVs plus `load.cypher` to `data/processed/neo4j/`.

| Nodes | Relationships |
|---|---|
| Person (chemists + external advisors), Country (historical labels), Occupation, Domain, Era, Award, Institution | CITIZEN_OF, HAS_OCCUPATION, IN_DOMAIN, BORN_IN_ERA, ADVISED, RECEIVED, WORKED_AT, EDUCATED_AT, SUCCESSOR_OF |

Load: copy the CSVs into Neo4j's `import/` directory and run `load.cypher` (Neo4j 5)."""),
C(SETUP),
C("""from pathlib import Path
from chemkg.paths import PROCESSED
d = PROCESSED / "neo4j"
pd.Series({f.stem: sum(1 for _ in open(f)) - 1 for f in sorted(d.glob("*.csv"))}, name="rows")"""),
C("""print((d / "load.cypher").read_text()[:1500])"""),
M("""### Example queries
```cypher
// Nobel laureates in Chemistry and their academic grandparents
MATCH (gp:Person)-[:ADVISED]->(:Person)-[:ADVISED]->(n:Person {nobel_chemistry: true})
RETURN n.name, collect(DISTINCT gp.name) LIMIT 20;

// Chemists who were citizens of a historical state and its modern successor
MATCH (p:Person)-[:CITIZEN_OF]->(h:Country)-[:SUCCESSOR_OF]->(m:Country)<-[:CITIZEN_OF]-(p)
RETURN h.label, m.label, count(p) ORDER BY count(p) DESC;

// Institutions that employed the most Nobel laureates
MATCH (p:Person {nobel_chemistry: true})-[:WORKED_AT]->(i:Institution)
RETURN i.name, count(p) AS laureates ORDER BY laureates DESC LIMIT 10;
```"""),
],
"08_genealogy": [
M("""# 08 · Academic genealogy

**Method** (`chemkg.genealogy`)
- Edges: P184 (doctoral advisor, on the student) ∪ P185 (doctoral student, on the advisor). The lineage pass in `enrich.py` walks advisor chains *upward* beyond the chemist set (up to 8 rounds), so families aren't cut off at a physicist or physician.
- Cycles (data errors) are broken deterministically and reported.
- Metrics: descendants, chemist-descendants, generations, PageRank on the reversed graph (credit flows to mentors), Nobel laureates among descendants, Louvain communities (seed 42).
- **Family trees** are roots (no recorded advisor), ranked by the number of descendants who are chemists in this dataset.

**Caveat:** advisor links are sparse and skew toward famous labs and the German/American research-university tradition."""),
C(SETUP),
C("""from chemkg import genealogy
g, adv, removed = genealogy.build_graph(ds)
m = genealogy.metrics(g)
print(f"{g.number_of_nodes():,} people, {g.number_of_edges():,} advisor links, {len(removed)} cycle edges removed")
print(f"in dataset: {m.in_dataset.sum():,}; with ≥1 recorded student: {(m.students > 0).sum():,}")"""),
C("""trees = genealogy.family_trees(g, m)
pd.DataFrame([{k: t[k] for k in ("name", "birth_year", "chem_descendants", "descendants", "generations", "nobel_descendants")} for t in trees])"""),
C("""m[m.in_dataset].nlargest(15, "pagerank")[["name", "birth_year", "students", "descendants", "chem_descendants", "nobel_descendants", "pagerank"]]"""),
C("""m[m.in_dataset].nlargest(15, "nobel_descendants")[["name", "birth_year", "students", "chem_descendants", "nobel_descendants", "generations"]]"""),
C("""comm = m.groupby("community").agg(size=("qid", "size"), nobel=("nobel", "sum"),
     exemplar=("name", lambda s: ", ".join(s.iloc[:3])), median_birth=("birth_year", "median")).sort_values("size", ascending=False)
comm.head(10)"""),
C("""print(genealogy.lineage_path(g, *[m.loc[m.name == n, "qid"].iloc[0] for n in ("Linus Pauling", "Arnold Sommerfeld")]) if {"Linus Pauling", "Arnold Sommerfeld"} <= set(m.name) else "names not both present")"""),
M("""### Reading the result
- One giant connected family contains most recorded links. It runs through 19th-century German chemistry (Liebig: 262 chemist descendants and 54 Nobel laureates; Bunsen: 147; Wöhler: 141) and, via the lineage pass, back to Renaissance and early-modern physicians and scholars.
- Nobel laureates cluster in these lineages: being in a large, well-documented family and winning a Nobel are correlated. Part of that is documentation bias, since famous people get their advisors recorded."""),
],
}


def main():
    for name, cells in NOTEBOOKS.items():
        nb = nbf.v4.new_notebook()
        nb.cells = cells
        nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3"}
        nbf.write(nb, f"notebooks/{name}.ipynb")
    print(f"wrote {len(NOTEBOOKS)} notebooks")


if __name__ == "__main__":
    main()
