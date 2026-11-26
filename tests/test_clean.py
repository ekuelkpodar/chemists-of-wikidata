import pytest

from chemkg.clean import (LIVING_BIRTH_CUTOFF, name_from_url, parse_date, parse_row,
                          years_between)

VOCAB = {"chemist", "biochemist", "chemical engineer"}


def row(head, *cells):
    cells = list(cells) + [""] * (10 - len(cells))
    return ["http://www.wikidata.org/entity/Q42", "wd:Q42", head, *cells]


class TestParseDate:
    def test_day_precision(self):
        d = parse_date("11 August 1915")
        assert (d.year, d.month, d.day, d.precision) == (1915, 8, 11, "day")

    def test_first_january_is_year_precision(self):
        assert parse_date("1 January 1871").precision == "year"

    def test_bce(self):
        d = parse_date("1 January 0201 BCE")
        assert d.year == -201

    @pytest.mark.parametrize("s", ["Spain", "chemist", "", "1915", "32 Foo 1900"])
    def test_non_dates(self, s):
        assert parse_date(s) is None

    def test_years_between_crosses_bce(self):
        assert years_between(-201, -101) == 100
        assert years_between(-10, 10) == 19  # no year zero
        assert years_between(1900, 1980) == 80


class TestParseRow:
    def test_aligned_row(self):
        r = parse_row(row("René Weiss", "birthDate", "11 August 1915", "deathDate", "4 May 2001",
                          "countryLabel", "Luxembourg", "occupationLabel", "chemist",
                          "wikipediaURL", "https://en.wikipedia.org/wiki/Ren%C3%A9_Weiss"), VOCAB)
        assert r.qid == "Q42" and r.label == "René Weiss"
        assert r.birth.year == 1915 and r.death.year == 2001
        assert r.countries == ["Luxembourg"] and r.occupations == ["chemist"]
        assert not r.misaligned

    def test_missing_fields_shift_columns(self):
        r = parse_row(row("X", "occupationLabel", "chemical engineer", "wikipediaURL",
                          "https://en.wikipedia.org/wiki/X"), VOCAB)
        assert r.birth is None and r.countries == [] and r.occupations == ["chemical engineer"]

    def test_misaligned_row_parsed_by_type(self):
        # Real example (Q421675 Louis Le Prince): keys out of step with values.
        r = parse_row(row("Louis Le Prince", "birthDate", "28 August 1841", "deathDate", "France",
                          "countryLabel", "chemist", "occupationLabel",
                          "https://en.wikipedia.org/wiki/Louis_Le_Prince", "wikipediaURL"), VOCAB)
        assert r.misaligned
        assert r.birth.year == 1841 and r.death is None
        assert r.countries == ["France"] and r.occupations == ["chemist"]
        assert r.url.endswith("Louis_Le_Prince")

    def test_qid_head_means_no_label(self):
        r = parse_row(row("Q42", "occupationLabel", "chemist"), VOCAB)
        assert r.label is None

    def test_death_only_date(self):
        r = parse_row(row("Y", "deathDate", "5 May 1900", "occupationLabel", "chemist"), VOCAB)
        assert r.birth is None and r.death.year == 1900

    def test_unknown_value_country(self):
        r = parse_row(row("Z", "countryLabel", "http://www.wikidata.org/.well-known/genid/abc",
                          "occupationLabel", "chemist"), VOCAB)
        assert r.unknown_country and r.countries == []


def test_name_from_url_strips_disambiguator():
    assert name_from_url("https://en.wikipedia.org/wiki/John_Browne_(chemist)") == ("John Browne", "John Browne (chemist)")
    assert name_from_url("https://en.wikipedia.org/wiki/Ren%C3%A9_Weiss")[0] == "René Weiss"


def test_living_cutoff_is_110_years_before_reference():
    assert LIVING_BIRTH_CUTOFF == 1916
