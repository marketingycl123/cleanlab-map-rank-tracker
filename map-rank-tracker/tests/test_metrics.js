// Run with: node tests/test_metrics.js
const assert = require("assert");
const M = require("../docs/metrics.js");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);

// Hand-built scan: three valid points and one failed point.
const scan = {
  business: { place_id: "ME" },
  places: {
    A: { title: "A", category: "Laundry" },
    B: { title: "B", category: "Laundry" },
    C: { title: "C", category: "Laundry" },
    ME: { title: "Me", category: "Laundry service" }
  },
  keywords: {
    k: [
      { lat: 1, lng: 1, me: 3, ranks: [["A", 1], ["B", 2], ["ME", 3]] },
      { lat: 1, lng: 2, me: null, ranks: [["B", 1], ["A", 2], ["C", 3]] },
      { lat: 2, lng: 1, me: 1, ranks: [["ME", 1], ["A", 2]] },
      { lat: 2, lng: 2, failed: true }
    ]
  }
};

// bands
assert.strictEqual(M.bandOf(1), "top3");
assert.strictEqual(M.bandOf(3), "top3");
assert.strictEqual(M.bandOf(4), "mid");
assert.strictEqual(M.bandOf(10), "mid");
assert.strictEqual(M.bandOf(11), "low");
assert.strictEqual(M.bandOf(20), "low");
assert.strictEqual(M.bandOf(21), "out");
assert.strictEqual(M.bandOf(null), "out");

// the business: ranks 3, (missing = 21), 1 -> average 25/3
const me = M.summarize(scan, "k", null, true);
assert.strictEqual(me.points, 3, "failed point is ignored");
close(me.avgRank, 25 / 3, "avg rank");
assert.deepStrictEqual(me.bands, { top3: 2, mid: 0, low: 0, out: 1 });
close(me.bandShare.top3, 2 / 3, "top3 share");
assert.strictEqual(me.bestRank, 1);

// share of voice: me = 1/3 + 1/1; everyone = (1+1/2+1/3) + (1+1/2+1/3) + (1+1/2)
close(me.shareOfVoice, (1 / 3 + 1) / (11 / 6 + 11 / 6 + 1.5), "share of voice");

// competitors, sorted by average rank
const rows = M.competitors(scan, "k");
assert.deepStrictEqual(rows.map(r => r.placeId), ["A", "B", "ME", "C"]);
close(rows[0].avgRank, 5 / 3, "A avg");
close(rows[1].avgRank, 8, "B avg");
close(rows[2].avgRank, 25 / 3, "ME avg");
close(rows[3].avgRank, 15, "C avg");
assert.strictEqual(rows[2].isMe, true);
assert.strictEqual(rows.filter(r => r.isMe).length, 1);

// shares of voice across all listings add up to 100%
close(rows.reduce((s, r) => s + r.shareOfVoice, 0), 1, "SoV total");

// empty keyword does not crash
const empty = M.summarize({ keywords: { z: [] }, business: {}, places: {} }, "z", null, true);
assert.strictEqual(empty.points, 0);
assert.strictEqual(empty.avgRank, null);

// band areas: the business is top3 at 2 valid spots, out at 1; spacing 2 km -> 4 km2 per spot
const area = M.bandArea(scan, "k", null, true, "top3", 2);
assert.strictEqual(area.spots, 2);
assert.strictEqual(area.of, 3);
close(area.km2, 8, "band km2");
close(area.totalKm2, 12, "total km2");
assert.strictEqual(M.bandArea(scan, "k", null, true, "mid", 2).spots, 0);

// cell bounds: 1 km square at the equator is ~0.008983 deg tall and wide
const cb = M.cellBounds(0, 0, 1);
close(cb[1][0] - cb[0][0], 1 / 111.32, "cell height");
close(cb[1][1] - cb[0][1], 1 / 111.32, "cell width at equator");
const cb60 = M.cellBounds(60, 0, 1);
close((cb60[1][1] - cb60[0][1]) / (cb60[1][0] - cb60[0][0]), 2, "cell is twice as wide in degrees at 60N");

// distance (haversine): exact reference values
close(M.distanceKm(0, 0, 0, 1), 6371 * Math.PI / 180, "1 degree at equator");
close(M.distanceKm(10, 5, 11, 5), 6371 * Math.PI / 180, "1 degree of latitude");
assert.ok(Math.abs(M.distanceKm(60, 0, 60, 1) - 6371 * Math.PI / 180 / 2) < 0.02, "1 degree of longitude at 60N is half the equator figure");
assert.strictEqual(M.distanceKm(52.3, 4.8, 52.3, 4.8), 0);

console.log("All metrics tests passed");
