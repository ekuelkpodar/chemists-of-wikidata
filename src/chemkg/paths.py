"""Canonical filesystem locations. Everything is relative to the repo root."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
INTERIM = DATA / "interim"
PROCESSED = DATA / "processed"
QUERIES = ROOT / "queries"
RESOURCES = Path(__file__).resolve().parent / "resources"
WEB_DATA = ROOT / "web" / "public" / "data"

RAW_CSV = RAW / "chemist.csv"

# Reference "today" for censoring. Pinned (not datetime.now()) so outputs are reproducible.
REFERENCE_YEAR = 2026
