"""Screenshot every page (desktop + mobile, light + dark) from a running preview server.

usage: python scripts/screenshots.py http://localhost:4173 docs/screenshots [--quick]
Also reports console errors per page.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PAGES = [("story", "/"), ("migration", "/migration"), ("gravity", "/gravity?y=1900"), ("specialties", "/specialties"),
         ("lifespans", "/lifespans"), ("families", "/families"), ("explorer", "/explorer"), ("methods", "/methods")]
VIEWPORTS = {"desktop": dict(width=1440, height=900, device_scale_factor=1),
             "mobile": dict(width=390, height=844, device_scale_factor=2, is_mobile=True, has_touch=True)}


def main(base: str, out: str, quick: bool) -> None:
    outdir = Path(out)
    outdir.mkdir(parents=True, exist_ok=True)
    errors = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for vname, vp in VIEWPORTS.items():
            for theme in (["light"] if quick else ["light", "dark"]):
                ctx = b.new_context(viewport={"width": vp["width"], "height": vp["height"]},
                                    device_scale_factor=vp["device_scale_factor"], is_mobile=vp.get("is_mobile", False),
                                    has_touch=vp.get("has_touch", False), color_scheme=theme)
                page = ctx.new_page()
                for name, route in PAGES:
                    errs = []
                    page.on("console", lambda m, errs=errs: errs.append(m.text) if m.type == "error" else None)
                    page.on("pageerror", lambda e, errs=errs: errs.append(str(e)))
                    page.goto(f"{base}/#{route}", wait_until="networkidle")
                    page.wait_for_timeout(6000 if name == "explorer" else 1800)
                    if name == "story" and vname == "desktop":
                        page.evaluate("window.scrollTo(0, document.querySelector('#steps').offsetTop + 300)")
                        page.wait_for_timeout(900)
                        page.screenshot(path=outdir / f"{name}-steps-{vname}-{theme}.png")
                        page.evaluate("window.scrollTo(0, 0)")
                        page.wait_for_timeout(400)
                    page.screenshot(path=outdir / f"{name}-{vname}-{theme}.png", full_page=vname == "mobile" or name in ("methods",))
                    errors[f"{name}-{vname}-{theme}"] = errs
                ctx.close()
        b.close()
    bad = {k: v for k, v in errors.items() if v}
    print("console errors:", bad if bad else "none")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], "--quick" in sys.argv)
