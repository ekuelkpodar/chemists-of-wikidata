# LinkedIn series: Chemists of Wikidata (5 posts)

Live site: https://ekuelkpodar.github.io/chemists-of-wikidata/
Charts: `docs/social/` (1200×1200 for the feed, 1200×627 for link-style posts)

---

## Post 1: Paris → Berlin → America

**Hook:** For chemists born in the 1910s, 41% were American. Two centuries earlier, the leader was France.

- I parsed 11,903 chemists from Wikidata and assigned each to their countries of citizenship. Historical states like Prussia map to their modern successors.
- By birth cohort, the lead passes from France to the German states in the 1810s, then to the US in the 1860s.
- Britain and Germany traded the lead decade by decade between the 1760s and 1800s.
- Caveat: these are *notable* chemists (English Wikipedia), which overweights the anglophone world.

Chart: `docs/social/01_center_of_gravity_1200x1200.png`
Explore it (press play): https://ekuelkpodar.github.io/chemists-of-wikidata/#/gravity

---

## Post 2: Talent flowed one way

**Hook:** Of 1,152 chemists whose birthplace and citizenship put them in different countries, the US gained 482, net.

- A move is counted from country of birth to citizenship. Born in Breslau and German is *not* a move; there are 196 such border cases, excluded.
- Germany → US is the busiest corridor (70 people), followed by UK → US (58), then Austria, Russia and China → US.
- Germany, Austria and Russia are the largest net exporters. The 1930s are visible in the data.
- Citizenship isn't residence, so this undercounts people who moved without naturalising.

Chart: `docs/social/02_migration_1200x1200.png`
Map: https://ekuelkpodar.github.io/chemists-of-wikidata/#/migration

---

## Post 3: Women in chemistry

**Hook:** 7% of notable chemists born before 1900 were women. For those born since 1960, it's 36%.

- Sex as recorded in Wikidata (P21), for 10,662 chemists with a birth year.
- It isn't a straight line. Women reach about 17% of the 1890s cohort, slip back to 13–16% for those born 1910–1940, then climb steeply from the 1950s.
- The youngest cohorts (born in the 1980s and later) are small and skew toward early-career honours, so I don't lean on them.
- At today's rate, notable chemistry is still roughly 2 men to every woman.
- Wikipedia's own coverage gap for women means the true historical share is probably higher.

Chart: `docs/social/03_women_1200x1200.png`
Query it yourself (DuckDB runs in your browser): https://ekuelkpodar.github.io/chemists-of-wikidata/#/explorer

---

## Post 4: Longer lives, with an asterisk

**Hook:** Chemists born in the 1700s reached a median age of 69. Those born in 1900–1929 reached 86.

- Kaplan–Meier curves with living chemists right-censored. Without censoring, recent cohorts would look like they died young.
- Cox model: chemists with more than one citizenship had an 18% lower hazard (HR 0.82, 95% CI 0.74–0.91).
- That isn't a benefit of migrating. You have to survive to emigrate, and to become notable at all.
- I checked the proportional-hazards assumption: birth era violates it, so I also fit a model stratified by era.

Chart: `docs/social/04_lifespans_1200x1200.png`
Compare any groups: https://ekuelkpodar.github.io/chemists-of-wikidata/#/lifespans

---

## Post 5: Families of ideas

**Hook:** One in five chemists with recorded advisors belongs to a single academic family tree. Its earliest recorded root was born in 1378.

- I took Wikidata's doctoral advisor/student links (P184/P185) and walked them upward beyond chemistry: 6,322 people and 5,559 links.
- Justus von Liebig alone has 262 chemist descendants, and 54 of his academic descendants are Nobel laureates.
- PageRank on the reversed graph ranks mentors by influence, not just by student count.
- Caveat: famous people get their advisors recorded, so this overstates how concentrated lineage really is.

Chart: `docs/social/05_genealogy_1200x1200.png`
Trace your favourite chemist's lineage: https://ekuelkpodar.github.io/chemists-of-wikidata/#/families
