PY := .venv/bin/python
NB := .venv/bin/jupyter nbconvert --to notebook --execute --inplace

.PHONY: all setup data enrich analyses web test clean

all: data analyses web

setup:
	uv venv --python 3.11 .venv
	uv pip install --python $(PY) -e ".[dev]"

data:
	$(PY) -m chemkg.pipeline data

# Hits the Wikidata SPARQL endpoint; results are cached in data/interim/.
enrich:
	$(PY) -m chemkg.enrich

analyses: data
	$(PY) -m chemkg.pipeline analyses
	for nb in notebooks/*.ipynb; do $(NB) $$nb || exit 1; done

web:
	cd web && npm ci && npm run build

test:
	$(PY) -m pytest -q

clean:
	rm -rf data/processed/* web/dist
