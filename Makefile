PY := .venv/bin/python
NB := .venv/bin/jupyter nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=600

.PHONY: all setup data enrich analyses notebooks social web dev test screenshots clean

all: data analyses notebooks social web

setup:
	uv venv --python 3.11 .venv
	uv pip install --python $(PY) -e ".[dev]"
	cd web && npm ci

# Phase 1: raw CSV -> canonical parquet + quality report
data:
	$(PY) -m chemkg.pipeline data

# Phase 2 (optional, online): SPARQL enrichment, cached in data/interim/enrich/.
# Everything downstream runs offline from that cache.
enrich:
	$(PY) -m chemkg.enrich

# Phase 3: all analyses -> data/processed/ + web/public/data/*.json
analyses: data
	$(PY) -m chemkg.pipeline analyses

notebooks: analyses
	$(PY) scripts/build_notebooks.py
	for nb in notebooks/*.ipynb; do $(NB) $$nb || exit 1; done

social: analyses
	$(PY) scripts/social.py

# Phase 4: static site
web:
	cd web && npm ci && npm run build

dev:
	cd web && npm run dev

test:
	$(PY) -m pytest -q

# Requires `cd web && npx vite preview --port 4173` running.
screenshots:
	$(PY) scripts/screenshots.py http://localhost:4173 docs/screenshots

clean:
	rm -rf data/processed/* web/dist
