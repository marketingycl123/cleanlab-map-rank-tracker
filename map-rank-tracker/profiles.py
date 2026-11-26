#!/usr/bin/env python3
"""Fetch Google Business Profile details (services, description, categories) for the
businesses that appear most in your latest scan, so the dashboard can compare them with you.

Uses DataForSEO  Business Data -> Google My Business Info (live).  One request per business.
Credentials come from the environment:  DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD

    python profiles.py --dry-run     show which businesses it would look up (no cost)
    python profiles.py --limit 1     look up ONE business (you) and print the exact cost per call
    python profiles.py               look up you + the top 12 competitors
    python profiles.py --top 20      you + the top 20 competitors

Results go to docs/data/profiles.json and are merged with earlier results.
Each business is looked up by its exact Google place id (no name guessing), and a result is only
used by the dashboard if Google returns that same place id.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "docs" / "data"
ENDPOINT = "https://api.dataforseo.com/v3/business_data/google/my_business_info/live"
LOCATION = "Amsterdam,North Holland,Netherlands"


def latest_scan_name():
    idx = json.loads((DATA_DIR / "index.json").read_text(encoding="utf-8"))["scans"]
    real = [n for n in idx if "-test" not in n]
    if not real:
        sys.exit("No real scan found in docs/data. Run `python scan.py` first.")
    return real[0]


def pick_businesses(scan, top):
    """You first, then the listings with the highest total 1/rank score over every keyword and spot."""
    score = {}
    for pts in scan["keywords"].values():
        for p in pts:
            if p.get("failed"):
                continue
            for pid, rank in p["ranks"]:
                score[pid] = score.get(pid, 0.0) + 1.0 / rank
    me = scan["business"]["place_id"]
    others = [pid for pid, _ in sorted(score.items(), key=lambda kv: -kv[1]) if pid != me]
    return [me] + others[:top]


def query_for(scan, pid):
    info = scan["places"].get(pid) or {}
    title = info.get("title") or scan["business"].get("name") or pid
    address = info.get("address") or (scan["business"].get("address") if pid == scan["business"]["place_id"] else "")
    return f"{title}, {address}" if address else title


def parse_profile(task):
    """Return (profile dict, error)."""
    if task.get("status_code") != 20000:
        return None, f"task status {task.get('status_code')}: {task.get('status_message')}"
    result = task.get("result") or []
    items = (result[0].get("items") if result else None) or []
    if not items:
        return None, "no profile found for this search"
    it = items[0]
    services = []
    for s in it.get("services") or []:
        if isinstance(s, dict):
            title = s.get("title") or s.get("name") or ""
            price = s.get("price") if isinstance(s.get("price"), dict) else {}
            services.append({"title": title, "category": s.get("category"),
                             "snippet": s.get("snippet"), "price": price.get("displayed_price")})
        else:
            services.append({"title": str(s), "category": None, "snippet": None, "price": None})
    return {
        "place_id": it.get("place_id"),
        "title": it.get("title"),
        "description": it.get("description"),
        "category": it.get("category"),
        "also": it.get("additional_categories") or [],
        "services": [x for x in services if x["title"]],
        "services_raw": it.get("services"),
        "attributes": it.get("attributes"),
        "topics": it.get("place_topics") or {},
        "work_time": (it.get("work_time") or {}).get("work_hours"),
        "rating": (it.get("rating") or {}).get("value"),
        "votes": (it.get("rating") or {}).get("votes_count"),
        "photos": it.get("total_photos"),
        "address": it.get("address"),
        "lat": it.get("latitude"),
        "lng": it.get("longitude"),
        "domain": it.get("domain"),
    }, None


def call_api(auth, query, retries=3):
    import requests

    body = [{"keyword": query, "location_name": LOCATION, "language_code": "en"}]
    last = "unknown"
    for attempt in range(retries):
        try:
            resp = requests.post(ENDPOINT, json=body, auth=auth, timeout=120)
            if resp.status_code == 200:
                payload = resp.json()
                return payload["tasks"][0], float(payload.get("cost") or 0), None
            last = f"HTTP {resp.status_code}"
        except Exception as exc:
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(2 * (attempt + 1))
    return None, 0.0, last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=12, help="how many competitors besides you (default 12)")
    ap.add_argument("--limit", type=int, help="stop after this many lookups (use 1 to see the price)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="look up businesses again even if they already have review topics saved")
    ap.add_argument("--raw", action="store_true", help="also save the full untouched response of each lookup to docs/data/raw-<place_id>.json")
    ap.add_argument("--fixture", help="parse this saved response instead of calling the API (tests only)")
    args = ap.parse_args()

    name = latest_scan_name()
    scan = json.loads((DATA_DIR / name).read_text(encoding="utf-8"))
    ids = pick_businesses(scan, args.top)
    if args.limit:
        ids = ids[: args.limit]
    print(f"Using scan {name}. {len(ids)} business(es) to look up:")
    for pid in ids:
        print("  -", query_for(scan, pid))
    if args.dry_run:
        print("Dry run: nothing was requested. The live price per lookup is not fixed in this script;")
        print("run with --limit 1 first and it will print the exact cost.")
        return

    auth = None
    fixture = None
    if args.fixture:
        fixture = json.loads(Path(args.fixture).read_bytes().decode("utf-8-sig"))["tasks"][0]
    else:
        login, password = os.environ.get("DATAFORSEO_LOGIN"), os.environ.get("DATAFORSEO_PASSWORD")
        if not login or not password:
            sys.exit("Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD first (see the README).")
        auth = (login, password)

    out_path = DATA_DIR / "profiles.json"
    store = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"profiles": {}, "cost_usd": 0}
    total = 0.0
    saved = 0
    made_call = False
    for i, pid in enumerate(ids):
        q = query_for(scan, pid)
        old = store["profiles"].get(pid)
        if old and "topics" in old and not args.refresh and fixture is None:
            print(f"  already have: {old.get('title') or q} (skipped, no cost)")
            continue
        first_call = not made_call
        if fixture is not None:
            task, cost, err = fixture, 0.0, None
        else:
            task, cost, err = call_api(auth, f"place_id:{pid}")  # exact business, no name guessing
        total += cost
        made_call = True
        if err:
            msg = f"  failed: {q}: {err}"
            if first_call:
                sys.exit(msg + "\nFirst request failed, stopped (nothing else was charged). Check login, password and balance.")
            print(msg)
            continue
        if args.raw:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            (DATA_DIR / f"raw-{pid}.json").write_text(json.dumps(task, indent=1, ensure_ascii=False), encoding="utf-8")
        prof, perr = parse_profile(task)
        if perr:
            print(f"  skipped: {q}: {perr}")
            continue
        wanted_title = (scan["places"].get(pid) or {}).get("title") or scan["business"].get("name") or ""
        prof["matched"] = (prof.get("place_id") == pid) or ((prof.get("title") or "").strip().lower() == wanted_title.strip().lower())
        prof["query"] = f"place_id:{pid}"
        store["profiles"][pid] = prof
        saved += 1
        flag = "" if prof["matched"] else "  (WARNING: Google returned a different business, ignored by the dashboard)"
        print(f"  ok: {prof.get('title')}: {len(prof['services'])} service(s){flag}")
        if saved == 1 and cost:
            print(f"  cost of one lookup: ${cost:.4f}")
        time.sleep(0.3)

    store["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    store["cost_usd"] = round(float(store.get("cost_usd") or 0) + total, 4)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(store, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Saved docs/data/profiles.json ({saved} profile(s), this run cost ${total:.4f})")


if __name__ == "__main__":
    main()
