import pandas as pd
import pytest

from chemkg import countries
from chemkg.clean import build_tables
from chemkg.paths import RAW_CSV


@pytest.fixture(scope="module")
def cmap():
    return countries.load_country_map().set_index("country_label")


def test_every_observed_label_is_mapped():
    t = build_tables(RAW_CSV)
    countries.annotate(t["person_country"])  # raises on unmapped labels


def test_all_mapped_labels_have_coordinates(cmap):
    real = cmap[cmap.kind != "non_country"]
    assert real.lat.notna().all() and real.lon.notna().all()


@pytest.mark.parametrize("a,b", [
    ("United Kingdom", "United Kingdom of Great Britain and Ireland"),
    ("Russian Empire", "Soviet Union"),
    ("Soviet Union", "Russia"),
    ("Empire of Japan", "Japan"),
    ("Kingdom of Prussia", "German Reich"),
    ("German Reich", "Germany"),
    ("Republic of China", "People's Republic of China"),
    ("Republic of China", "Taiwan"),
    ("Soviet Union", "Ukraine"),
    ("Austria–Hungary", "Czech Republic"),
    ("Pakistan", "Bangladesh"),
    ("British Raj", "Pakistan"),
])
def test_name_change_pairs(cmap, a, b):
    assert countries.same_territory(cmap.loc[a, "territory"], cmap.loc[b, "territory"])


@pytest.mark.parametrize("a,b", [
    ("Germany", "United States"),
    ("Austria", "United States"),
    ("Canada", "United States"),
    ("United Kingdom", "United States"),
    ("United Kingdom", "Australia"),
    ("Soviet Union", "Israel"),
])
def test_migration_pairs(cmap, a, b):
    assert not countries.same_territory(cmap.loc[a, "territory"], cmap.loc[b, "territory"])


def test_components_merge_renames_and_split_migrations():
    comps = countries.affiliation_components(
        ["Kingdom of Prussia", "German Reich", "Germany", "United States", "statelessness"])
    assert comps == [["German Reich", "Germany", "Kingdom of Prussia"], ["United States"]]


def test_component_iso_prefers_modern_label():
    assert countries.component_iso3(["Russian Empire", "Soviet Union", "Ukraine"]) == "UKR"
    assert countries.component_iso3(["Russian Empire", "Soviet Union"]) == "RUS"


def test_classify_pairs():
    pc = pd.DataFrame({"qid": ["Q1"] * 3, "country_label": ["Germany", "German Reich", "United States"]})
    rel = countries.classify_pairs(pc).set_index(["label_a", "label_b"]).relation
    assert rel[("German Reich", "Germany")] == "name_change"
    assert rel[("Germany", "United States")] == "multi_country"
