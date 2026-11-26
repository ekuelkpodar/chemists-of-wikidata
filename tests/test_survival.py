import numpy as np
import pandas as pd

from chemkg.clean import LIVING_BIRTH_CUTOFF
from chemkg.data import Dataset
from chemkg.paths import REFERENCE_YEAR
from chemkg import survival


def _ds(rows):
    people = pd.DataFrame(rows)
    defaults = {"quality_flags": [[] for _ in rows], "excluded": False, "primary_domain": "General chemistry",
                "is_multi_country": False, "lifespan": None, "death_year": None}
    for k, v in defaults.items():
        if k not in people:
            people[k] = v
    people["lifespan"] = people.lifespan.astype("Int64")
    aff = pd.DataFrame({"qid": people.qid, "component": 0, "iso3": "DEU", "labels": [["Germany"]] * len(people),
                        "n_components": 1})
    return Dataset(people, None, None, aff, None, None, None)


def test_living_people_are_censored_at_reference_year():
    ds = _ds([
        {"qid": "Q1", "birth_year": 1950, "death_year": None, "is_living_likely": True},
        {"qid": "Q2", "birth_year": 1900, "death_year": 1980, "lifespan": 80, "is_living_likely": False},
    ])
    f = survival.survival_frame(ds).set_index("qid")
    assert f.loc["Q1", "event"] == 0 and f.loc["Q1", "duration"] == REFERENCE_YEAR - 1950
    assert f.loc["Q2", "event"] == 1 and f.loc["Q2", "duration"] == 80


def test_presumed_dead_without_date_is_excluded_not_censored():
    ds = _ds([{"qid": "Q3", "birth_year": LIVING_BIRTH_CUTOFF - 10, "death_year": None, "is_living_likely": False,
               "quality_flags": ["death_missing_presumed_dead"]}])
    assert survival.survival_frame(ds).empty


def test_implausible_lifespans_and_pre_1700_excluded():
    ds = _ds([
        {"qid": "Q4", "birth_year": 1800, "death_year": 1930, "lifespan": 130, "is_living_likely": False,
         "quality_flags": ["lifespan_over_110"]},
        {"qid": "Q5", "birth_year": 1650, "death_year": 1700, "lifespan": 50, "is_living_likely": False},
    ])
    assert survival.survival_frame(ds).empty


def test_km_median_with_censoring():
    # 4 deaths at 50,60,70,80 and 4 censored at 90: S drops by 1/8 per death -> never reaches 0.5.
    df = pd.DataFrame({"duration": [50, 60, 70, 80, 90, 90, 90, 90], "event": [1, 1, 1, 1, 0, 0, 0, 0],
                       "g": "a"})
    c = survival.km_curves(df, "g", min_n=1)[0]
    assert c["median"] is None and c["censored"] == 4
    s = dict(zip(c["age"], c["s"]))
    assert np.isclose(s[85], 0.5)
