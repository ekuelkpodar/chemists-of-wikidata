import pandas as pd

from chemkg import migration
from chemkg.data import Dataset


def _ds(people_rows, aff_rows):
    people = pd.DataFrame(people_rows)
    people["quality_flags"] = [[] for _ in range(len(people))]
    people["excluded"] = False
    people["era"] = "1850–1874"
    aff = pd.DataFrame(aff_rows)
    aff["n_components"] = aff.groupby("qid").qid.transform("size")
    return Dataset(people, None, None, aff, None, None, None)


def test_birthplace_inside_one_citizenship_sets_direction():
    ds = _ds([{"qid": "Q1", "birth_year": 1860, "bp_iso3": "DEU"}],
             [{"qid": "Q1", "component": 0, "iso3": "DEU", "labels": ["German Empire"]},
              {"qid": "Q1", "component": 1, "iso3": "USA", "labels": ["United States"]}])
    e = migration.build_edges(ds)
    assert e[["origin", "dest", "method"]].values.tolist() == [["DEU", "USA", "birthplace_in_citizenship"]]


def test_birthplace_outside_all_citizenships():
    ds = _ds([{"qid": "Q2", "birth_year": 1900, "bp_iso3": "HUN"}],
             [{"qid": "Q2", "component": 0, "iso3": "USA", "labels": ["United States"]}])
    e = migration.build_edges(ds)
    assert e[["origin", "dest"]].values.tolist() == [["HUN", "USA"]]


def test_historical_territory_counts_as_same_place():
    # Born in present-day Ukraine, citizen of the Russian Empire: no migration.
    ds = _ds([{"qid": "Q3", "birth_year": 1880, "bp_iso3": "UKR"}],
             [{"qid": "Q3", "component": 0, "iso3": "RUS", "labels": ["Russian Empire"]}])
    assert migration.build_edges(ds).empty


def test_border_shift_is_not_migration():
    # Born 1850 in Breslau (now Poland), citizen of "Germany".
    ds = _ds([{"qid": "Q4", "birth_year": 1850, "bp_iso3": "POL"}],
             [{"qid": "Q4", "component": 0, "iso3": "DEU", "labels": ["Germany"]}])
    e = migration.build_edges(ds)
    assert e.method.tolist() == ["border_shift"]
    assert migration.summarise(e)["n_edges_directed"] == 0


def test_no_birthplace_gives_undirected_corridor():
    ds = _ds([{"qid": "Q5", "birth_year": 1900, "bp_iso3": None}],
             [{"qid": "Q5", "component": 0, "iso3": "USA", "labels": ["United States"]},
              {"qid": "Q5", "component": 1, "iso3": "AUT", "labels": ["Austria"]}])
    e = migration.build_edges(ds)
    assert e.method.tolist() == ["undirected"] and e.origin.iloc[0] == "AUT"
