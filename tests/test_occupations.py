import pandas as pd

from chemkg import occupations


def test_primary_domain_prefers_specialist():
    po = pd.DataFrame({"qid": ["Q1", "Q1", "Q2", "Q3", "Q3"],
                       "occupation": ["chemist", "crystallographer", "chemist", "biochemist", "chemist"]})
    d = occupations.primary_domain(po)
    assert d["Q1"] == "Physical & theoretical"
    assert d["Q2"] == "General chemistry"
    assert d["Q3"] == "Life & medicinal chemistry"
