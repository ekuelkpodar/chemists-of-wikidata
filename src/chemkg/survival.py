"""Survival analysis of chemists' lifespans with right-censoring for the likely living.

Subjects: analysable people with a birth year >= 1700. Duration = age at death, or
age at the reference year (2026) for people flagged `is_living_likely` (censored).
Excluded: no birth year; born <= 1916 with no death date (`death_missing_presumed_dead`);
implausible lifespans (> 110 or < 15), which are data errors, not observations.

Big caveat, stated everywhere this is shown: inclusion requires notability, which
usually requires surviving to do notable work (immortal-time / survivorship bias).
Survival to young ages is therefore overstated, and comparisons across eras mix true
mortality change with changes in who becomes notable. We also do not model
left truncation (entry into Wikipedia), so this is descriptive, not causal.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.statistics import multivariate_logrank_test, proportional_hazard_test
from lifelines.utils import median_survival_times

from .data import Dataset, analysable
from .paths import REFERENCE_YEAR

BAD = {"death_missing_presumed_dead", "lifespan_over_110", "lifespan_under_15", "bce_date"}
SURV_ERAS = [(1700, 1799, "1700–1799"), (1800, 1849, "1800–1849"), (1850, 1899, "1850–1899"),
             (1900, 1929, "1900–1929"), (1930, 1959, "1930–1959")]
TIMELINE = np.arange(0, 111, 1)


def survival_frame(ds: Dataset) -> pd.DataFrame:
    p = analysable(ds.people)
    p = p[p.birth_year.notna() & (p.birth_year >= 1700)]
    p = p[~p.quality_flags.map(lambda f: bool(set(f) & BAD))]
    dead = p.death_year.notna()
    p = p[dead | p.is_living_likely].copy()
    p["event"] = p.death_year.notna().astype(int)
    p["duration"] = np.where(p.event == 1, p.lifespan, REFERENCE_YEAR - p.birth_year).astype(float)
    p["surv_era"] = pd.cut(p.birth_year.astype(int), bins=[1699, 1799, 1849, 1899, 1929, 1959, 2100],
                           labels=[e[2] for e in SURV_ERAS] + ["1960+"]).astype(str)
    region = (ds.affiliations.merge(_iso_region(), on="iso3").sort_values(["qid", "component"])
              .drop_duplicates("qid").set_index("qid").region)
    p["region"] = p.qid.map(region).fillna("Unknown")
    return p


def _iso_region():
    from .countries import load_iso3
    return load_iso3()[["iso3", "region"]]


def km_curves(df: pd.DataFrame, by: str, groups: list[str] | None = None, min_n: int = 100) -> list[dict]:
    out = []
    groups = groups or [g for g, n in df[by].value_counts().items() if n >= min_n]
    for g in groups:
        sub = df[df[by] == g]
        if len(sub) < min_n:
            continue
        km = KaplanMeierFitter(label=str(g)).fit(sub.duration, sub.event, timeline=TIMELINE)
        ci = km.confidence_interval_survival_function_
        med = km.median_survival_time_
        med_ci = median_survival_times(km.confidence_interval_)
        # Report from age 20 on: notability makes earlier ages uninformative.
        sl = slice(20, 110)
        out.append({
            "group": str(g), "by": by, "n": int(len(sub)), "events": int(sub.event.sum()),
            "censored": int((1 - sub.event).sum()),
            "median": None if np.isinf(med) else float(med),
            "median_ci": [None if np.isinf(v) else float(v) for v in med_ci.iloc[0].tolist()],
            "age": TIMELINE[sl].tolist(),
            "s": km.survival_function_.iloc[sl, 0].round(4).tolist(),
            "lo": ci.iloc[sl, 0].round(4).tolist(),
            "hi": ci.iloc[sl, 1].round(4).tolist(),
        })
    return out


def logrank(df: pd.DataFrame, by: str, groups: list[str]) -> dict:
    sub = df[df[by].isin(groups)]
    r = multivariate_logrank_test(sub.duration, sub[by], sub.event)
    return {"by": by, "groups": groups, "statistic": float(r.test_statistic), "p": float(r.p_value)}


def cox_model(df: pd.DataFrame) -> dict:
    """Cox PH on age, covariates: birth era, primary domain, region, sex, multi-country.
    Reference levels: 1850–1899, General chemistry, Western Europe, male."""
    d = df.copy()
    d = d[d.surv_era != "1960+"]  # almost no events yet
    covs = {"surv_era": "1850–1899", "primary_domain": "General chemistry", "region": "Western Europe"}
    if "sex" in d and d.sex.notna().any():
        d = d[d.sex.isin(["male", "female"])]
        d["female"] = (d.sex == "female").astype(int)
    d["multi_country"] = d.is_multi_country.astype(int)
    d = d[d.region != "Unknown"]
    # Collapse sparse categories to keep the model identifiable.
    for col, ref in covs.items():
        vc = d[col].value_counts()
        rare = vc[vc < 60].index
        d[col] = d[col].where(~d[col].isin(rare), "Other")
    X = pd.get_dummies(d[list(covs)], dtype=int)
    for col, ref in covs.items():
        X = X.drop(columns=f"{col}_{ref}")
    X = X.drop(columns=[c for c in X if c.endswith("_Other")], errors="ignore")
    extra = ["multi_country"] + (["female"] if "female" in d else [])
    X = pd.concat([X, d[extra], d[["duration", "event"]]], axis=1)
    cph = CoxPHFitter(penalizer=0.001)
    cph.fit(X, duration_col="duration", event_col="event")
    s = cph.summary
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ph = proportional_hazard_test(cph, X, time_transform="rank").summary
    rows = [{"term": t, "hr": float(r["exp(coef)"]), "lo": float(r["exp(coef) lower 95%"]),
             "hi": float(r["exp(coef) upper 95%"]), "p": float(r["p"]),
             "ph_p": float(ph.loc[t, "p"]) if t in ph.index else None}
            for t, r in s.iterrows()]
    return {"n": int(len(X)), "events": int(X.event.sum()), "concordance": float(cph.concordance_index_),
            "references": covs | {"sex": "male"}, "terms": rows,
            "ph_violations": [r["term"] for r in rows if r["ph_p"] is not None and r["ph_p"] < 0.01]}


def stratified_cox(df: pd.DataFrame, strata: str = "surv_era") -> dict:
    """Refit stratifying on the covariate most likely to violate PH (birth era), so the
    remaining hazard ratios do not rely on PH for era."""
    d = df[(df.surv_era != "1960+") & (df.region != "Unknown")].copy()
    d["multi_country"] = d.is_multi_country.astype(int)
    if "sex" in d and d.sex.notna().any():
        d = d[d.sex.isin(["male", "female"])]
        d["female"] = (d.sex == "female").astype(int)
    vc = d.primary_domain.value_counts()
    d["primary_domain"] = d.primary_domain.where(d.primary_domain.isin(vc[vc >= 60].index), "Other")
    X = pd.get_dummies(d[["primary_domain"]], dtype=int).drop(columns=["primary_domain_General chemistry"])
    X = X.drop(columns=[c for c in X if c.endswith("_Other")], errors="ignore")
    cols = ["multi_country"] + (["female"] if "female" in d else [])
    X = pd.concat([X, d[cols + ["duration", "event", strata]]], axis=1)
    cph = CoxPHFitter(penalizer=0.001).fit(X, "duration", "event", strata=[strata])
    return {"strata": strata, "n": int(len(X)), "terms": [
        {"term": t, "hr": float(r["exp(coef)"]), "lo": float(r["exp(coef) lower 95%"]),
         "hi": float(r["exp(coef) upper 95%"]), "p": float(r["p"])} for t, r in cph.summary.iterrows()]}
