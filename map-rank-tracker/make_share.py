#!/usr/bin/env python3
"""Build a version of the dashboard that anyone can open by double-clicking index.html.

It copies the dashboard into ./share and bakes your scan files into one bundle.js,
so no web server is needed. Zip the share folder and send it, or drag the folder to
https://app.netlify.com/drop to get a link.

    python make_share.py            # all scans (week-to-week comparison keeps working)
    python make_share.py --latest   # only the newest scan
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"
OUT = ROOT / "share"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--latest", action="store_true", help="include only the newest scan")
    ap.add_argument("--no-test", action="store_true", help="leave out -test (fake) scans")
    args = ap.parse_args()

    index_path = DOCS / "data" / "index.json"
    if not index_path.exists():
        raise SystemExit("No scans found in docs/data. Run `python scan.py` first.")
    names = json.loads(index_path.read_text(encoding="utf-8"))["scans"]
    if args.no_test:
        names = [n for n in names if "-test" not in n]
    if args.latest:
        names = names[:1]
    if not names:
        raise SystemExit("No scans to share.")

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(DOCS, OUT, ignore=shutil.ignore_patterns("data"))

    scans = {n: json.loads((DOCS / "data" / n).read_text(encoding="utf-8")) for n in names}
    bundle = {"index": {"scans": names}, "scans": scans}
    prof_path = DOCS / "data" / "profiles.json"
    if prof_path.exists():
        bundle["profiles"] = json.loads(prof_path.read_text(encoding="utf-8"))
    man_path = DOCS / "data" / "services_manual.json"
    if man_path.exists():
        bundle["manual"] = json.loads(man_path.read_text(encoding="utf-8"))
    (OUT / "bundle.js").write_text(
        "window.BUNDLE=" + json.dumps(bundle, separators=(",", ":"), ensure_ascii=False) + ";",
        encoding="utf-8",
    )

    html = (OUT / "index.html").read_text(encoding="utf-8")
    tag = '<script src="app.js"></script>'
    if tag not in html:
        raise SystemExit("index.html changed: could not find the app.js script tag")
    (OUT / "index.html").write_text(html.replace(tag, '<script src="bundle.js"></script>\n' + tag), encoding="utf-8")

    zip_path = shutil.make_archive(str(ROOT / "share"), "zip", OUT)
    print(f"Built {OUT} with {len(names)} scan(s).")
    print(f"Zip to send: {zip_path}")
    print("Open share\\index.html by double-clicking, or drag the share folder to https://app.netlify.com/drop for a link.")


if __name__ == "__main__":
    main()
