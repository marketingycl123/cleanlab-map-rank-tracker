/* Rank maths shared by the dashboard (browser) and the node test.
 *
 * Conventions (also explained on the page):
 *  - A listing missing from the top 20 at a grid point counts as rank 21.
 *  - Failed grid points are ignored.
 *  - Bands: Top 3, 4-10, 11-20, Not in top 20.
 *  - Share of voice (estimated): each listing scores 1/rank at every grid point;
 *    a listing's share is its total score divided by the total score of all listings.
 *    This is our own estimate and will NOT match Semrush's figure.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var OUT = 21;

  function validPoints(scan, keyword) {
    return (scan.keywords[keyword] || []).filter(function (p) { return !p.failed; });
  }

  function rankAt(point, placeId, me) {
    if (me) return point.me == null ? null : point.me;
    for (var i = 0; i < point.ranks.length; i++) {
      if (point.ranks[i][0] === placeId) return point.ranks[i][1];
    }
    return null;
  }

  function bandOf(rank) {
    if (rank == null) return "out";
    if (rank <= 3) return "top3";
    if (rank <= 10) return "mid";
    if (rank <= 20) return "low";
    return "out";
  }

  /* Summary for one listing (or the business itself when me === true). */
  function summarize(scan, keyword, placeId, me) {
    var pts = validPoints(scan, keyword);
    var n = pts.length;
    var sum = 0, bands = { top3: 0, mid: 0, low: 0, out: 0 }, best = null, score = 0, total = 0;
    pts.forEach(function (p) {
      var r = rankAt(p, placeId, me);
      sum += r == null ? OUT : r;
      bands[bandOf(r)] += 1;
      if (r != null && (best == null || r < best)) best = r;
      if (r != null) score += 1 / r;
      p.ranks.forEach(function (x) { total += 1 / x[1]; });
    });
    return {
      points: n,
      avgRank: n ? sum / n : null,
      bands: bands,
      bandShare: n ? {
        top3: bands.top3 / n, mid: bands.mid / n, low: bands.low / n, out: bands.out / n
      } : null,
      bestRank: best,
      shareOfVoice: total ? score / total : 0
    };
  }

  /* All listings seen in this keyword's scan, with avg rank and share of voice. */
  function competitors(scan, keyword) {
    var ids = {};
    validPoints(scan, keyword).forEach(function (p) {
      p.ranks.forEach(function (x) { ids[x[0]] = true; });
    });
    var rows = Object.keys(ids).map(function (id) {
      var s = summarize(scan, keyword, id, false);
      var info = scan.places[id] || {};
      return {
        placeId: id,
        title: info.title || id,
        category: info.category || "",
        rating: info.rating,
        votes: info.votes,
        avgRank: s.avgRank,
        shareOfVoice: s.shareOfVoice,
        bestRank: s.bestRank,
        top3Share: s.bandShare ? s.bandShare.top3 : 0,
        isMe: id === scan.business.place_id
      };
    });
    rows.sort(function (a, b) { return a.avgRank - b.avgRank; });
    return rows;
  }

  /* The square a grid point stands for: spacingKm wide and tall, centred on the point. */
  function cellBounds(lat, lng, spacingKm) {
    var dLat = (spacingKm / 2) / 111.32;
    var dLng = (spacingKm / 2) / (111.32 * Math.cos(lat * Math.PI / 180));
    return [[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]];
  }

  /* How many grid spots (and roughly how many km2) fall in one rank band. */
  function bandArea(scan, keyword, placeId, me, band, spacingKm) {
    var pts = validPoints(scan, keyword), spots = 0;
    pts.forEach(function (p) { if (bandOf(rankAt(p, placeId, me)) === band) spots += 1; });
    return { spots: spots, of: pts.length, km2: spots * spacingKm * spacingKm,
             totalKm2: pts.length * spacingKm * spacingKm };
  }

  /* Straight-line distance in km between two coordinates (haversine). */
  function distanceKm(lat1, lng1, lat2, lng2) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  return { OUT: OUT, distanceKm: distanceKm, validPoints: validPoints, rankAt: rankAt, bandOf: bandOf,
           summarize: summarize, competitors: competitors,
           cellBounds: cellBounds, bandArea: bandArea };
});
