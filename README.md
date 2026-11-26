# Map Rank Tracker (YourCleanLab)

A weekly Google Maps rank scan with a heatmap dashboard, similar to Semrush's Map Rank Tracker.

- **What it does:** every Monday it searches Google Maps from a 7 × 7 grid of points, 1 km apart, around the address, for 7 keywords. It records where YourCleanLab and every competitor ranks at each point.
- **Cost:** 7 keywords × 49 points = 343 searches ≈ **$0.69 per week** (about $3 a month) at DataForSEO's $0.002 per search. Each scan stores its real cost, shown at the bottom of the page.
- **Where it runs:** GitHub Actions (free for this size). Nothing runs on your computer.
- **Where you see it:** a GitHub Pages site made from the `docs` folder.

## Run it yourself on Windows (no GitHub needed)

1. Unzip this folder, then open PowerShell inside it, for example: `cd $HOME\Desktop\map-rank-tracker`
2. One-time: `pip install requests`
3. Enter your DataForSEO API login and password (the password stays hidden as you type):
   ```powershell
   $env:DATAFORSEO_LOGIN = Read-Host "API login"
   $sec = Read-Host "API password" -AsSecureString
   $env:DATAFORSEO_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
   ```
4. Check the cost without spending anything: `python scan.py --dry-run`
5. Run the scan (about 343 searches, roughly $0.69, takes a few minutes to a quarter of an hour): `python scan.py`
6. View the map: `python serve.py` and open http://localhost:8000 in your browser. Press Ctrl+C in PowerShell to stop it.

Each scan is saved as `docs\data\<date>.json`. Run it again next week and the page compares the two scans. Keep the old files.

The login only lives in that PowerShell window. Closing it forgets it.

## Automatic weekly scan on GitHub (optional, skip if you run it yourself)

### One-time setup (about 10 minutes)

1. **Create a GitHub repository** and upload everything in this folder (keep the folder structure, including the hidden `.github` folder).
   - GitHub Pages on a free account needs a **public** repository. It will only contain ranks and business names, never your login.
2. **Add your DataForSEO login as secrets.** Repository → Settings → Secrets and variables → Actions → New repository secret. Create two:
   - `DATAFORSEO_LOGIN`
   - `DATAFORSEO_PASSWORD`

   Use the API login and API password from app.dataforseo.com/api-access. Do not turn on "IP access" there, because GitHub's servers change address and would be blocked.
3. **Turn on Pages.** Settings → Pages → Build and deployment → Source: *Deploy from a branch* → Branch `main`, folder `/docs` → Save.
4. **Run a cheap test first.** Actions tab → *Weekly map rank scan* → *Run workflow*. Enter `laundry near me` as keyword and `3` as max points. That costs about $0.006 and saves a "(partial)" scan.
5. **Run the full scan.** Run the workflow again with both boxes empty (about $0.69, takes a while). Open your Pages address (shown in Settings → Pages) to see the map.

After that it runs by itself every Monday.

## Changing things

Edit `config.json`:

| What | Where |
|---|---|
| Keywords and language | `keywords` (use `"nl"` for Dutch terms) |
| Grid size or spacing | `grid.size`, `grid.spacing_km` (a 9 × 9 grid costs about $0.16 per keyword) |
| Centre of the grid | `grid.center_lat`, `grid.center_lng` |
| Depth | `search.depth` (20 = top 20) |

## How the numbers work

- A listing missing from the top 20 at a point counts as rank 21 in the averages.
- Paid ads at the top of the list are not counted.
- **Share of voice is our own estimate** (each listing scores 1 ÷ rank at each point). It will not match Semrush.
- Rank bubbles use the rank shown on Google Maps when searching from that exact spot with "search this area". A manual search in your own browser can differ by a few places.

## If something goes wrong

- **The run fails:** GitHub emails you. The log shows the first failing requests. A scan is not saved if more than 10% of searches fail.
- **"Out of balance":** top up DataForSEO. The scan is not saved.
- **Scans stop appearing:** GitHub can pause scheduled workflows in a repository with no activity for 60 days. The weekly commit normally prevents that. If it happens, re-enable the workflow in the Actions tab.
- **Run it on your own computer** (optional): set `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in your terminal, run `pip install requests`, then `python scan.py`. Add `--dry-run` to see the cost without searching.

## Files

- `scan.py` runs the scan and writes `docs/data/<date>.json`.
- `docs/` is the dashboard (`index.html`, `app.js`, `metrics.js`). Leaflet is included, and map tiles come from OpenStreetMap.
- `tests/test_metrics.js` checks the rank maths (`node tests/test_metrics.js`).
- `.github/workflows/weekly-scan.yml` is the weekly schedule.

## Share it with someone else

Run this after a scan:

    python make_share.py

It builds a `share` folder (and `share.zip`) with your scans baked in. Anyone can open
`share\index.html` by double-clicking it, no server and no Python needed (the map tiles
need internet). Or drag the `share` folder to https://app.netlify.com/drop to get a link.
Anyone with the link can open it, so share it only with people who should see it.
`python make_share.py --latest` includes only the newest scan.

## Add services and descriptions (optional, small cost)

The Maps scan does not include the "Services" list from each Google Business Profile.
`profiles.py` fetches it (DataForSEO: Business Data, Google My Business Info) for you and the
most visible competitors in your latest scan. Set your login the same way as for `scan.py`, then:

    python profiles.py --dry-run     which businesses it would look up (no cost)
    python profiles.py --limit 1     look up only you; prints the exact cost of one lookup
    python profiles.py               you + the top 12 competitors

Results are saved in `docs\data\profiles.json`. The comparison table on the map then shows
each business's services and which ones the top listings have that you don't.
A result is only used if Google returned the business we asked for.
