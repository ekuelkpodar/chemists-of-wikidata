"""Static social charts (1200×1200 and 1200×627) for LinkedIn, plus the Open Graph image.

Reads only the web JSON produced by `make analyses`, so the numbers match the site exactly.
usage: python scripts/social.py
"""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import PercentFormatter  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
OUT = ROOT / "docs" / "social"
PAPER, INK, MUTED, GRID = "#f7f5f0", "#191919", "#5c5c5c", "#e4e1da"
S = {"blue": "#257de0", "orange": "#f47230", "aqua": "#00b894", "yellow": "#f2a600", "violet": "#6a4ce2", "grey": "#b9b5ad"}
COUNTRY = {"USA": S["blue"], "DEU": S["orange"], "GBR": S["aqua"], "FRA": S["yellow"]}
SERIF = ["Georgia", "DejaVu Serif"]
URL = "chemists of wikidata"


def load(name):
    return json.loads((DATA / name).read_text())


def frame(size, title, subtitle, foot):
    w, h = (12, 12) if size == "square" else (12, 6.27)
    fig = plt.figure(figsize=(w, h), dpi=100, facecolor=PAPER)
    top = 0.80 if size == "square" else 0.70
    fig.text(0.06, 0.93 if size == "square" else 0.89, title, fontsize=34 if size == "square" else 28,
             family=SERIF, color=INK, va="top", wrap=True)
    fig.text(0.06, (0.855 if size == "square" else 0.775), subtitle, fontsize=15, color=MUTED, va="top")
    fig.text(0.06, 0.03, foot, fontsize=11, color=MUTED)
    fig.text(0.94, 0.03, URL, fontsize=11, color=MUTED, ha="right")
    ax = fig.add_axes([0.09, 0.11, 0.84, top - 0.15])
    ax.set_facecolor(PAPER)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#c2c2c2")
    ax.tick_params(colors=MUTED, labelsize=13)
    ax.grid(axis="y", color=GRID, lw=1)
    ax.set_axisbelow(True)
    return fig, ax


def end_labels(ax, items, min_gap):
    """items: (x, y, text, color). Labels that would collide get spread apart vertically and
    joined to their line end with a thin leader line."""
    items = sorted(items, key=lambda t: t[1])
    ys = [t[1] for t in items]
    for i in range(1, len(ys)):
        ys[i] = max(ys[i], ys[i - 1] + min_gap)
    for (x, y, text, color), ly in zip(items, ys):
        ax.plot([x], [y], "o", ms=9, color=color, mec=PAPER, mew=2, zorder=5)
        ax.annotate(text, (x, y), xytext=(x + 6, ly), textcoords="data", va="center", fontsize=14, color=INK,
                    arrowprops=dict(arrowstyle="-", color="#c2c2c2", lw=1) if abs(ly - y) > 1e-9 else None)


def chart_handoff(size):
    cog = load("cog.json")
    dec, tot = cog["decades"], cog["totals"]
    hand = cog["handoffs"]
    fig, ax = frame(size, "Paris → Berlin → America",
                    "Share of each birth decade's notable chemists, by country of citizenship",
                    f"n = {int(sum(tot)):,} chemists with birth year and country · 3-decade smoothing · Wikidata (CC0)")
    ends = []
    for k, c in COUNTRY.items():
        xs, ys = [], []
        for i, d in enumerate(dec):
            w = range(max(0, i - 1), min(len(dec), i + 2))
            if d < 1750 or sum(tot[j] for j in w) < 45:
                continue
            xs.append(d)
            ys.append(sum(cog["shares"][k][j] * tot[j] for j in w) / sum(tot[j] for j in w))
        ax.plot(xs, ys, color=c, lw=3.2, solid_capstyle="round")
        ends.append((xs[-1], ys[-1], cog["names"][k].replace("United ", "U. "), c))
    end_labels(ax, ends, 0.028)
    for h in hand:
        ax.axvline(h["decade"], color=MUTED, lw=1, ls=(0, (2, 3)))
        ax.text(h["decade"] + 2, ax.get_ylim()[1] * 0.97, f"{cog['names'][h['to']].replace('United States', 'US')}\nleads",
                fontsize=12, color=MUTED, va="top")
    ax.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax.set_xlim(1750, 2015)
    return fig


def chart_migration(size):
    mig = load("migration.json")
    names = {c["iso3"]: c["name"].replace("United States", "US").replace("United Kingdom", "UK") for c in mig["countries"]}
    cnt = {}
    for m in mig["migrants"]:
        cnt[(m["origin"], m["dest"])] = cnt.get((m["origin"], m["dest"]), 0) + 1
    top = sorted(cnt.items(), key=lambda kv: -kv[1])[:10][::-1]
    fig, ax = frame(size, "Talent flowed one way", "Busiest corridors: country of birth → country of citizenship",
                    f"n = {mig['n_people']:,} chemists with a directed move · border changes excluded · Wikidata (CC0)")
    labels = [f"{names.get(o, o)} → {names.get(d, d)}" for (o, d), _ in top]
    vals = [v for _, v in top]
    ax.barh(labels, vals, height=0.62, color=[S["blue"] if d == "USA" else S["grey"] for (o, d), _ in top])
    for i, v in enumerate(vals):
        ax.text(v + max(vals) * 0.01, i, str(v), va="center", fontsize=13, color=INK)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID)
    ax.tick_params(axis="y", labelsize=14, colors=INK)
    ax.text(0.99, 0.02, "blue = into the United States", transform=ax.transAxes, ha="right", fontsize=12, color=MUTED)
    return fig


def chart_women(size):
    f = {x["id"]: x for x in load("findings.json")}["women"]
    bd = {int(k): v for k, v in f["numbers"]["by_decade"].items() if int(k) <= 1990}
    fe, fl = f["numbers"]["female_pre1900"], f["numbers"]["female_post1960"]
    fig, ax = frame(size, f"Women in chemistry: {fe:.0%} → {fl:.0%}", "Women as a share of notable chemists, by birth decade",
                    f"n = {f['n']:,} chemists with recorded sex (Wikidata P21) · Wikidata (CC0)")
    xs, ys = list(bd), list(bd.values())
    ax.fill_between(xs, ys, color=S["violet"], alpha=0.10, lw=0)
    ax.plot(xs, ys, color=S["violet"], lw=3.2)
    for x, y in zip(xs, ys):
        if x in (1850, 1900, 1950) or x == xs[-1]:
            ax.plot([x], [y], "o", ms=9, color=S["violet"], mec=PAPER, mew=2)
            ax.annotate(f"{y:.0%}", (x, y), xytext=(0, 12), textcoords="offset points", ha="center", fontsize=14, color=INK)
    ax.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax.set_ylim(0, max(ys) * 1.25)
    return fig


def chart_survival(size):
    s = load("survival.json")
    curves = [c for c in s["curves"] if c["by"] == "surv_era" and c["group"] in ("1700–1799", "1850–1899", "1900–1929")]
    curves.sort(key=lambda c: c["group"])
    fig, ax = frame(size, "Longer lives, with an asterisk", "Share of chemists still alive at each age, by birth era (Kaplan–Meier, 95% CI)",
                    f"n = {s['n']:,} · living chemists censored at 2026 · survivorship bias: notability requires survival · Wikidata (CC0)")
    for c, col in zip(curves, [S["yellow"], S["orange"], S["blue"]]):
        ax.fill_between(c["age"], c["lo"], c["hi"], step="post", color=col, alpha=0.12, lw=0)
        ax.step(c["age"], c["s"], where="post", color=col, lw=3)
        if c["median"]:
            ax.plot([c["median"]], [0.5], "o", ms=9, color=col, mec=PAPER, mew=2, zorder=5)
        ax.plot([], [], color=col, lw=3, label=f"born {c['group']} · median age {c['median']:.0f} · n {c['n']:,}")
    ax.axhline(0.5, color="#c2c2c2", lw=1)
    ax.legend(loc="lower left", frameon=False, fontsize=14, labelcolor=INK)
    ax.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax.set_xlim(20, 105)
    ax.set_xlabel("age", color=MUTED, fontsize=13)
    return fig


def chart_genealogy(size):
    g = load("genealogy.json")
    top = g["top_chemist_mentors"][:10][::-1]
    fig, ax = frame(size, "Families of ideas", "Chemists with the most academic descendants who are themselves notable chemists",
                    f"{g['n_edges']:,} advisor→student links among {g['n_nodes']:,} people (Wikidata P184/P185) · ★ Nobel descendants")
    labels = [f"{r['name']} ({r['birth_year']})" for r in top]
    vals = [r["chem_descendants"] for r in top]
    ax.barh(labels, vals, height=0.62, color=S["blue"])
    for i, r in enumerate(top):
        ax.text(r["chem_descendants"] + max(vals) * 0.01, i,
                f"{r['chem_descendants']}" + (f"   ★ {r['nobel_descendants']}" if r["nobel_descendants"] else ""),
                va="center", fontsize=13, color=INK)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID)
    ax.tick_params(axis="y", labelsize=14, colors=INK)
    return fig


def og_image():
    meta = load("meta.json")
    fig = plt.figure(figsize=(12, 6.27), dpi=100, facecolor=PAPER)
    fig.text(0.06, 0.82, "THE SCIENCE OF SCIENTISTS", fontsize=14, color="#1b64be", weight="bold")
    fig.text(0.06, 0.72, f"{meta['n_people']:,} chemists.\nThree centuries.\nOne moving center.", fontsize=46,
             family=SERIF, color=INK, va="top", linespacing=1.08)
    fig.text(0.06, 0.10, "Migration · center of gravity · lifespans · academic family trees — from Wikidata",
             fontsize=15, color=MUTED)
    ax = fig.add_axes([0.60, 0.22, 0.36, 0.56])
    ax.set_facecolor(PAPER)
    cog = load("cog.json")
    dec, tot = cog["decades"], cog["totals"]
    for k, c in COUNTRY.items():
        xs, ys = [], []
        for i, d in enumerate(dec):
            w = range(max(0, i - 1), min(len(dec), i + 2))
            if d < 1750 or sum(tot[j] for j in w) < 45:
                continue
            xs.append(d)
            ys.append(sum(cog["shares"][k][j] * tot[j] for j in w) / sum(tot[j] for j in w))
        ax.plot(xs, ys, color=c, lw=4)
        ax.text(xs[-1] + 4, ys[-1], cog["names"][k].replace("United ", "U. "), fontsize=13, color=INK, va="center")
    ax.axis("off")
    out = ROOT / "web" / "public" / "og.png"
    fig.savefig(out, dpi=100, facecolor=PAPER)
    plt.close(fig)
    return out


CHARTS = [("01_center_of_gravity", chart_handoff), ("02_migration", chart_migration), ("03_women", chart_women),
          ("04_lifespans", chart_survival), ("05_genealogy", chart_genealogy)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in CHARTS:
        for size, suffix in (("square", "1200x1200"), ("wide", "1200x627")):
            fig = fn(size)
            fig.savefig(OUT / f"{name}_{suffix}.png", dpi=100, facecolor=PAPER)
            plt.close(fig)
    print("wrote", len(CHARTS) * 2, "charts and", og_image())


if __name__ == "__main__":
    main()
