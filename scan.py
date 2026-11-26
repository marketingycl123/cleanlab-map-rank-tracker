#!/usr/bin/env python3
"""Weekly Google Maps rank scan using the DataForSEO Maps SERP (live, advanced) endpoint.

Runs every keyword in config.json on a square grid of points around the business,
and writes one compact JSON file per scan to docs/data/<date>.json plus docs/data/index.json.

Credentials come from the environment (never from files):
    DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD

Useful flags:
    --keyword "laundry near me"   run only this keyword (repeatable)
    --max-points 3                only the first N grid points per keyword (cheap smoke test)
    --fixture path/to/response    do NOT call the API; parse this saved response for every point (tests only)
    --dry-run                     print the plan and estimated cost, then exit
"""
import argparse
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "docs" / "data"
ENDPOINT = "https://api.dataforseo.com/v3/serp/google/maps/live/advanced"
COST_PER_REQUEST_ESTIMATE = 0.002
MAX_FAILURE_SHARE = 0.10  # if more than this share of requests fail, the scan is not saved


def grid_points(cfg):
    g = cfg["grid"]
    n = int(g["size"])
    half = (n - 1) / 2
    d_lat = g["spacing_km"] / 110.574
    d_lng = g["spacing_km"] / (111.320 * math.cos(math.radians(g["center_lat"])))
    points = []
    for i in range(n):
        for j in range(n):
            lat = g["center_lat"] + (i - half) * d_lat
            lng = g["center_lng"] + (j - half) * d_lng
            points.append((round(lat, 5), round(lng, 5)))
    return points


def parse_items(task_obj):
    """Return (items, error) from one DataForSEO task object.

    Only regular listings (maps_search) are kept; paid items are ignored for ranking.
    """
    if task_obj.get("status_code") != 20000:
        return None, f"task status {task_obj.get('status_code')}: {task_obj.get('status_message')}"
    result = task_obj.get("result") or []
    if not result:
        return None, "empty result"
    items = result[0].get("items") or []
    kept = []
    for it in items:
        if it.get("type") != "maps_search":
            continue
        rating = it.get("rating") or {}
        kept.append(
            {
                "place_id": it.get("place_id") or it.get("cid") or it.get("title"),
                "title": it.get("title") or "",
                "category": it.get("category") or "",
                "rating": rating.get("value"),
                "votes": rating.get("votes_count"),
                "rank": it.get("rank_group"),
                # free extras: already in the same response, no extra cost
                "lat": it.get("latitude"),
                "lng": it.get("longitude"),
                "address": it.get("address"),
                "domain": it.get("domain"),
                "photos": it.get("total_photos"),
                "claimed": it.get("is_claimed"),
                "also": it.get("additional_categories") or [],
                "book": bool(it.get("book_online_url")),
            }
        )
    return kept, None


def find_me(items, business):
    for it in items:
        if it["place_id"] == business["place_id"]:
            return it["rank"]
    needle = business.get("title_contains", "").lower()
    if needle:
        for it in items:
            if needle in it["title"].lower():
                return it["rank"]
    return None


def call_api(auth, cfg, keyword, language, lat, lng, retries=3):
    import requests

    s = cfg["search"]
    body = [
        {
            "keyword": keyword,
            "location_coordinate": f"{lat},{lng},{cfg['grid']['zoom']}",
            "language_code": language,
            "device": s["device"],
            "os": s["os"],
            "depth": s["depth"],
            "search_this_area": s["search_this_area"],
        }
    ]
    last_err = "unknown"
    for attempt in range(retries):
        try:
            resp = requests.post(
                ENDPOINT,
                json=body,
                auth=auth,
                timeout=120,
            )
            if resp.status_code == 200:
                payload = resp.json()
                task = payload["tasks"][0]
                return task, float(payload.get("cost") or 0), None
            last_err = f"HTTP {resp.status_code}"
        except Exception as exc:  # network errors, timeouts, bad JSON
            last_err = f"{type(exc).__name__}: {exc}"
        time.sleep(2 * (attempt + 1))
    return None, 0.0, last_err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keyword", action="append")
    ap.add_argument("--max-points", type=int)
    ap.add_argument("--fixture")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    keywords = cfg["keywords"]
    if args.keyword:
        wanted = {k.lower() for k in args.keyword}
        keywords = [k for k in keywords if k["keyword"].lower() in wanted]
        if not keywords:
            sys.exit("No matching keyword in config.json")
    points = grid_points(cfg)
    if args.max_points:
        points = points[: args.max_points]

    jobs = [(k, p) for k in keywords for p in points]
    print(f"{len(keywords)} keywords x {len(points)} points = {len(jobs)} requests "
          f"(about ${len(jobs) * COST_PER_REQUEST_ESTIMATE:.2f})")
    if args.dry_run:
        return

    fixture_task = None
    auth = None
    if args.fixture:
        raw = Path(args.fixture).read_bytes().decode("utf-8-sig")
        fixture_task = json.loads(raw)["tasks"][0]
    else:
        login = os.environ.get("DATAFORSEO_LOGIN")
        password = os.environ.get("DATAFORSEO_PASSWORD")
        if not login or not password:
            sys.exit("Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables.")
        auth = (login, password)

    def run(job):
        k, (lat, lng) = job
        if fixture_task is not None:
            task, cost, err = fixture_task, 0.0, None
        else:
            task, cost, err = call_api(auth, cfg, k["keyword"], k["language_code"], lat, lng)
        if err:
            return job, None, cost, err
        items, perr = parse_items(task)
        return job, items, cost, perr

    # Preflight: one real request first, so a wrong login or empty balance stops the scan immediately.
    if fixture_task is None:
        _, pitems, _, perr = run(jobs[0])
        if perr:
            sys.exit(f"Preflight request failed, scan stopped (nothing else was charged): {perr}\n"
                     "Check the API login/password and your DataForSEO balance.")

    started = datetime.now(timezone.utc)
    places = {}
    by_keyword = {k["keyword"]: [] for k in keywords}
    failures = []
    total_cost = 0.0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run, j) for j in jobs]
        done = 0
        for fut in as_completed(futures):
            (k, (lat, lng)), items, cost, err = fut.result()
            total_cost += cost
            done += 1
            if err:
                failures.append({"keyword": k["keyword"], "lat": lat, "lng": lng, "error": err})
                by_keyword[k["keyword"]].append({"lat": lat, "lng": lng, "failed": True})
            else:
                for it in items:
                    pid = it["place_id"]
                    if pid not in places:
                        places[pid] = {k: v for k, v in it.items() if k not in ("place_id", "rank")}
                by_keyword[k["keyword"]].append(
                    {
                        "lat": lat,
                        "lng": lng,
                        "me": find_me(items, cfg["business"]),
                        "ranks": [[it["place_id"], it["rank"]] for it in items],
                    }
                )
            if done % 20 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} done, failures so far: {len(failures)}")

    failure_share = len(failures) / len(jobs) if jobs else 0
    if failure_share > MAX_FAILURE_SHARE:
        print(f"Too many failures ({len(failures)} of {len(jobs)}). Scan NOT saved.")
        for f in failures[:10]:
            print("  ", f)
        sys.exit(1)

    # keep a stable order: row by row, south to north
    for kw in by_keyword:
        by_keyword[kw].sort(key=lambda p: (p["lat"], p["lng"]))

    scan = {
        "scanned_at": started.isoformat(timespec="seconds"),
        "business": cfg["business"],
        "grid": cfg["grid"],
        "search": cfg["search"],
        "cost_usd": round(total_cost, 4),
        "failed_points": len(failures),
        "places": places,
        "keywords": by_keyword,
    }
    if args.fixture:
        scan["TEST_FIXTURE"] = True

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    suffix = "-test" if args.fixture else ("-partial" if (args.keyword or args.max_points) else "")
    name = started.strftime("%Y-%m-%d") + suffix + ".json"
    (DATA_DIR / name).write_text(json.dumps(scan, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    index_path = DATA_DIR / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"scans": []}
    index["scans"] = sorted({*index["scans"], name}, reverse=True)
    index["updated"] = started.isoformat(timespec="seconds")
    index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")

    print(f"Saved docs/data/{name} (cost ${total_cost:.3f}, {len(failures)} failed points)")


if __name__ == "__main__":
    main()
