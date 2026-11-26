"""Center of gravity: each country's share of chemists by birth cohort, and leadership handoffs.

Allocation: a person affiliated with k territorially distinct countries contributes
1/k to each (see countries.person_affiliations). People without a country are excluded.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import countries
from .data import Dataset, analysable, fractional_country

DECADE_MIN, DECADE_MAX = 1700, 1990


def decade_shares(ds: Dataset, top: int = 12) -> tuple[pd.DataFrame, pd.DataFrame]:
    f = fractional_country(ds).dropna(subset=["birth_year"])
    f = f[(f.birth_year >= DECADE_MIN) & (f.birth_year < DECADE_MAX + 10)]
    f["decade"] = (f.birth_year // 10 * 10).astype(int)
    counts = f.pivot_table(index="decade", columns="iso3", values="w", aggfunc="sum", fill_value=0.0)
    totals = counts.sum(axis=1)
    top_isos = counts.sum().sort_values(ascending=False).head(top).index.tolist()
    shares = counts.div(totals, axis=0)
    return counts, shares[top_isos].assign(OTHER=1 - shares[top_isos].sum(axis=1))


def leaders(counts: pd.DataFrame, window: int = 3, min_total: float = 30) -> pd.DataFrame:
    """Leading country per decade, using a centred rolling window over decades to damp noise.
    Decades whose smoothed total is below `min_total` are reported but marked as low-n."""
    smooth = counts.rolling(window, center=True, min_periods=1).sum()
    tot = smooth.sum(axis=1)
    share = smooth.div(tot, axis=0)
    out = pd.DataFrame({
        "leader": share.idxmax(axis=1),
        "leader_share": share.max(axis=1),
        "runner_up": share.apply(lambda r: r.nlargest(2).index[-1], axis=1),
        "runner_up_share": share.apply(lambda r: r.nlargest(2).iloc[-1], axis=1),
        "n_window": tot,
    })
    out["low_n"] = out.n_window < min_total
    return out


def handoffs(lead: pd.DataFrame, hold: int = 2) -> list[dict]:
    """Decades where the (smoothed) leader changes and the new leader then holds the top
    spot for at least `hold` consecutive decades (hysteresis, so near-ties do not flap).
    Low-n decades are ignored."""
    lead = lead[~lead.low_n]
    seq = list(lead.leader.items())
    out, current = [], None
    for i, (dec, who) in enumerate(seq):
        if current is None:
            current = who
            continue
        if who != current and all(seq[j][1] == who for j in range(i, min(i + hold, len(seq)))) \
                and i + hold <= len(seq):
            out.append({"decade": int(dec), "from": current, "to": who,
                        "to_share": float(lead.loc[dec, "leader_share"])})
            current = who
    return out


def cumulative_race(ds: Dataset, start: int = 1700, end: int = 2000, step: int = 5, top: int = 15) -> dict:
    """Cumulative chemists born by year Y, per country (for the bar-chart race)."""
    f = fractional_country(ds).dropna(subset=["birth_year"])
    years = list(range(start, end + 1, step))
    per_year = f.groupby(["iso3", "birth_year"]).w.sum()
    frames = {}
    for iso, s in per_year.groupby(level=0):
        s = s.droplevel(0)
        frames[iso] = [float(s[s.index <= y].sum()) for y in years]
    df = pd.DataFrame(frames, index=years)
    keep = set()
    for y in years:  # any country that is ever in the top N at some frame
        keep |= set(df.loc[y].nlargest(top).index)
    return {"years": years, "series": {iso: [round(v, 2) for v in df[iso]] for iso in sorted(keep)}}


def geographic_center(ds: Dataset) -> pd.DataFrame:
    """Spherical mean position of chemists by birth decade, using birthplace coordinates
    where available and the citizenship country's representative point otherwise."""
    p = analysable(ds.people).dropna(subset=["birth_year"])
    p = p[(p.birth_year >= DECADE_MIN) & (p.birth_year < DECADE_MAX + 10)]
    iso = countries.load_iso3().set_index("iso3")
    first = ds.affiliations.sort_values(["qid", "component"]).drop_duplicates("qid").set_index("qid").iso3
    lat = p.get("bp_lat", pd.Series(index=p.index, dtype=float)).copy()
    lon = p.get("bp_lon", pd.Series(index=p.index, dtype=float)).copy()
    fallback_iso = p.qid.map(first)
    lat = lat.fillna(fallback_iso.map(iso.lat))
    lon = lon.fillna(fallback_iso.map(iso.lon))
    d = pd.DataFrame({"decade": (p.birth_year // 10 * 10).astype(int), "lat": lat, "lon": lon}).dropna()
    rows = []
    for dec, g in d.groupby("decade"):
        la, lo = np.radians(g.lat), np.radians(g.lon)
        x, y, z = (np.cos(la) * np.cos(lo)).mean(), (np.cos(la) * np.sin(lo)).mean(), np.sin(la).mean()
        rows.append({"decade": int(dec), "lat": float(np.degrees(np.arctan2(z, np.hypot(x, y)))),
                     "lon": float(np.degrees(np.arctan2(y, x))), "n": int(len(g))})
    return pd.DataFrame(rows)
