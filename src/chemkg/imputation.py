"""Imputation of missing country / specialty, and anomaly detection for dates.

Country model
  Target: the person's single modern country (people with exactly one affiliation),
  collapsed to the top-K countries + OTHER. Features: character n-grams of the name
  (strong nationality signal), birth decade, occupation multi-hot, sex, birthplace
  country (if enriched), and tokens of employer / alma-mater labels (if enriched).
  Baselines: majority class, and "birthplace country if known, else majority".
  Evaluation: stratified 5-fold CV; accuracy, macro-F1, top-3 accuracy.

Specialty model
  Target: primary *specialist* domain, trained on people who have one. Predicts a
  likely specialty for "chemist"-only people from institution tokens, name, era, country.

Date anomalies
  Rule flags from cleaning plus relational checks from the advisor graph: a student
  born before (or < 15 years after) their advisor, or > 80 years after.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, top_k_accuracy_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import OneHotEncoder

from .data import Dataset, analysable
from .occupations import GENERAL

SEED = 42


def _institution_text(ds: Dataset) -> pd.Series:
    if ds.relations is None:
        return pd.Series(dtype=str)
    r = ds.relations[ds.relations.relation.isin(["employer", "educated_at", "award"])]
    return r.dropna(subset=["target_label"]).groupby("qid").target_label.apply(lambda s: " | ".join(s))


def _features(df: pd.DataFrame, ds: Dataset, use_birthplace: bool, fit: dict | None = None):
    """Build a sparse feature matrix. `fit` carries fitted transformers for reuse."""
    fit = fit if fit is not None else {}
    inst = df.qid.map(_institution_text(ds)).fillna("")
    occ = df.qid.map(ds.person_occupation.groupby("qid").occupation.apply(lambda s: " | ".join(s))).fillna("")
    cat = pd.DataFrame({
        "decade": (df.birth_year // 10 * 10).astype("Int64").astype(str),
        "sex": df.get("sex", pd.Series(index=df.index, dtype=object)).fillna("unknown").astype(str),
    })
    if use_birthplace:
        cat["bp"] = df.get("bp_iso3", pd.Series(index=df.index, dtype=object)).fillna("unknown").astype(str)
    parts = []
    specs = [
        ("name", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=3, sublinear_tf=True), df.name.fillna("")),
        ("inst", TfidfVectorizer(token_pattern=r"[A-Za-zÀ-ž]{3,}", min_df=3, sublinear_tf=True), inst),
        ("occ", CountVectorizer(tokenizer=lambda s: [t for t in s.split(" | ") if t], token_pattern=None,
                                lowercase=False, binary=True), occ),
    ]
    for key, vec, text in specs:
        if key not in fit:
            # A block with no usable tokens (e.g. occupations masked out) is skipped.
            try:
                fit[key] = vec.fit(text)
            except ValueError:
                fit[key] = None
        if fit[key] is not None:
            parts.append(fit[key].transform(text))
    if "cat" not in fit:
        fit["cat"] = OneHotEncoder(handle_unknown="ignore").fit(cat)
    parts.append(fit["cat"].transform(cat))
    return sparse.hstack(parts).tocsr(), fit


def _cv(df: pd.DataFrame, y: pd.Series, ds: Dataset, use_birthplace: bool, baseline_fn,
        class_weight: str | None = "balanced") -> dict:
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    classes = np.array(sorted(y.unique()))
    res = {"model": [], "baseline_majority": [], "baseline_rule": []}
    top3, f1m, f1b = [], [], []
    for tr, te in skf.split(df, y):
        Xtr, fit = _features(df.iloc[tr], ds, use_birthplace)
        Xte, _ = _features(df.iloc[te], ds, use_birthplace, fit)
        clf = LogisticRegression(max_iter=2000, C=4.0, class_weight=class_weight)
        clf.fit(Xtr, y.iloc[tr])
        proba = clf.predict_proba(Xte)
        pred = clf.classes_[proba.argmax(1)]
        maj = y.iloc[tr].mode()[0]
        rule = baseline_fn(df.iloc[te], maj)
        res["model"].append(accuracy_score(y.iloc[te], pred))
        res["baseline_majority"].append(accuracy_score(y.iloc[te], [maj] * len(te)))
        res["baseline_rule"].append(accuracy_score(y.iloc[te], rule))
        f1m.append(f1_score(y.iloc[te], pred, average="macro"))
        f1b.append(f1_score(y.iloc[te], rule, average="macro"))
        full = np.zeros((len(te), len(classes)))
        idx = {c: i for i, c in enumerate(classes)}
        for j, c in enumerate(clf.classes_):
            full[:, idx[c]] = proba[:, j]
        top3.append(top_k_accuracy_score(y.iloc[te], full, k=3, labels=classes))
    return {
        "n": int(len(df)), "classes": int(len(classes)),
        "accuracy": {k: [float(np.mean(v)), float(np.std(v))] for k, v in res.items()},
        "macro_f1": {"model": float(np.mean(f1m)), "baseline_rule": float(np.mean(f1b))},
        "top3_accuracy_model": float(np.mean(top3)),
    }


def country_model(ds: Dataset, top_k: int = 20) -> tuple[dict, pd.DataFrame]:
    people = analysable(ds.people)
    single = ds.affiliations[ds.affiliations.n_components == 1].set_index("qid").iso3
    train = people[people.qid.isin(single.index)].copy()
    y_full = train.qid.map(single)
    top = y_full.value_counts().head(top_k).index
    y = y_full.where(y_full.isin(top), "OTHER").reset_index(drop=True)
    train = train.reset_index(drop=True)
    use_bp = "bp_iso3" in train

    def rule(df, maj):
        if not use_bp:
            return [maj] * len(df)
        bp = df.bp_iso3.where(df.bp_iso3.isin(top), None)
        return bp.fillna(maj).tolist()

    report = _cv(train, y, ds, use_bp, rule)
    report["target"] = f"single modern country, top {top_k} + OTHER"
    # Fit on everything; predict for people with no country.
    X, fit = _features(train, ds, use_bp)
    clf = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced").fit(X, y)
    missing = people[~people.qid.isin(ds.affiliations.qid)].reset_index(drop=True)
    Xm, _ = _features(missing, ds, use_bp, fit)
    proba = clf.predict_proba(Xm)
    order = proba.argsort(1)[:, ::-1]
    preds = pd.DataFrame({
        "qid": missing.qid, "name": missing.name,
        "pred_1": clf.classes_[order[:, 0]], "p_1": proba[np.arange(len(missing)), order[:, 0]],
        "pred_2": clf.classes_[order[:, 1]], "p_2": proba[np.arange(len(missing)), order[:, 1]],
    })
    return report, preds


def specialty_model(ds: Dataset) -> tuple[dict, pd.DataFrame]:
    people = analysable(ds.people).reset_index(drop=True)
    first_iso = ds.affiliations.sort_values(["qid", "component"]).drop_duplicates("qid").set_index("qid").iso3
    people["bp_iso3"] = people.qid.map(first_iso)  # use citizenship as the "place" feature here
    spec = people[people.primary_domain != GENERAL].reset_index(drop=True)
    y = spec.primary_domain.reset_index(drop=True)
    # Drop occupation features: they *are* the label. Mask by clearing occupations.
    ds_masked = Dataset(ds.people, ds.person_country, ds.person_occupation.iloc[0:0], ds.affiliations,
                        ds.attributes, ds.relations, ds.lineage)
    report = _cv(spec, y, ds_masked, True, lambda df, maj: [maj] * len(df))
    unweighted = _cv(spec, y, ds_masked, True, lambda df, maj: [maj] * len(df), class_weight=None)
    report["unweighted_model"] = {"accuracy": unweighted["accuracy"]["model"],
                                  "macro_f1": unweighted["macro_f1"]["model"]}
    report["target"] = "primary specialist domain (people with a non-general occupation)"
    X, fit = _features(spec, ds_masked, True)
    clf = LogisticRegression(max_iter=2000, C=2.0, class_weight="balanced").fit(X, y)
    gen = people[people.primary_domain == GENERAL].reset_index(drop=True)
    Xg, _ = _features(gen, ds_masked, True, fit)
    proba = clf.predict_proba(Xg)
    preds = pd.DataFrame({"qid": gen.qid, "name": gen.name,
                          "pred": clf.classes_[proba.argmax(1)], "p": proba.max(1)})
    return report, preds


def date_anomalies(ds: Dataset, advisor_edges: pd.DataFrame | None) -> pd.DataFrame:
    p = ds.people.set_index("qid")
    rows = []
    rule_flags = {"lifespan_over_110", "lifespan_under_15", "death_before_birth", "birth_in_future",
                  "conflicting_birth_dates", "conflicting_death_dates"}
    for qid, r in p.iterrows():
        for f in set(r.quality_flags) & rule_flags:
            rows.append({"qid": qid, "name": r["name"], "check": f, "detail": f"{r.birth_date} – {r.death_date}"})
    if advisor_edges is not None and len(advisor_edges):
        by = p.birth_year
        e = advisor_edges.assign(ab=advisor_edges.advisor.map(by), sb=advisor_edges.student.map(by)).dropna()
        e["gap"] = e.sb - e.ab
        for r in e[(e.gap < 15) | (e.gap > 80)].itertuples():
            for qid, role in ((r.student, "student"), (r.advisor, "advisor")):
                rows.append({"qid": qid, "name": p.loc[qid, "name"], "check": "advisor_age_gap",
                             "detail": f"as {role}: advisor b.{int(r.ab)}, student b.{int(r.sb)} (gap {int(r.gap)})"})
    return pd.DataFrame(rows, columns=["qid", "name", "check", "detail"])
