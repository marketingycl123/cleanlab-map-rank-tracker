(function () {
  "use strict";
  var M = window.Metrics;
  var state = { pinMarkers: {}, fitSpotKey: null, profiles: null, manual: {}, index: null, cache: {}, scanName: null, keyword: null, selected: null, map: null, layer: null, band: null, spot: null, fitKey: null };
  var BAND_COLOR = { top3: "#1a9e5c", mid: "#f0b429", low: "#e5533d", out: "#9aa0a6" };
  var BAND_LABEL = { top3: "Rank 1–3", mid: "Rank 4–10", low: "Rank 11–20", out: "Not in top 20" };

  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === "text") n.textContent = props[k];
      else if (k === "class") n.className = props[k];
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function pct1(x) { return (x * 100).toFixed(1) + "%"; }

  function fetchJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
      return r.json();
    });
  }

  function loadScan(name) {
    if (state.cache[name]) return Promise.resolve(state.cache[name]);
    if (window.BUNDLE) { state.cache[name] = window.BUNDLE.scans[name]; return Promise.resolve(state.cache[name]); }
    return fetchJSON("data/" + name).then(function (s) { state.cache[name] = s; return s; });
  }

  function dateLabel(name) {
    return name.replace(".json", "").replace("-test", " (test)").replace("-partial", " (partial)");
  }

  function previousName(name) {
    var list = state.index.scans, i = list.indexOf(name);
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
  }

  /* ---------- rendering ---------- */

  function renderScanBar() {
    var bar = document.getElementById("scanbar");
    clear(bar);
    state.index.scans.slice(0, 12).forEach(function (name) {
      var b = el("button", { class: "chip", type: "button", text: dateLabel(name), "aria-pressed": String(name === state.scanName) });
      b.addEventListener("click", function () { selectScan(name); });
      bar.appendChild(b);
    });
  }

  function renderKeywords(scan) {
    var nav = document.getElementById("keywords");
    clear(nav);
    Object.keys(scan.keywords).forEach(function (k) {
      var b = el("button", { class: "tab", type: "button", role: "tab", text: k, "aria-selected": String(k === state.keyword) });
      b.addEventListener("click", function () { state.keyword = k; state.selected = null; state.band = null; state.spot = null; render(); });
      nav.appendChild(b);
    });
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  /* One plain-words line saying how this number changed since the previous scan. */
  function changeNode(curVal, prevVal, lowerIsBetter, neutral, fmt, unitWord) {
    if (prevVal == null || curVal == null) return el("div", { class: "delta flat", text: "No earlier scan to compare with yet." });
    var d = curVal - prevVal;
    if (Math.abs(d) < 0.005) return el("div", { class: "delta flat", text: "Same as the previous scan (" + fmt(prevVal) + ")." });
    var better = lowerIsBetter ? d < 0 : d > 0;
    var word = neutral ? "Changed" : (better ? "Better" : "Worse");
    var detail = unitWord
      ? plural(Math.abs(d), unitWord) + (d > 0 ? " more" : " fewer") + " than the previous scan (was " + fmt(prevVal) + ")"
      : "was " + fmt(prevVal) + " in the previous scan";
    return el("div", { class: "delta " + (neutral ? "flat" : (better ? "up" : "down")), text: word + ": " + detail + "." });
  }

  function setBand(b) { state.band = state.band === b ? null : b; state.spot = null; render(); }

  function kpi(c) {
    var valueKids = [document.createTextNode(c.value)];
    if (c.small) valueKids.push(el("small", { text: c.small }));
    var kids = [el("div", { class: "label", text: c.label }), el("div", { class: "value" }, valueKids),
                el("div", { class: "desc", text: c.desc }), c.change];
    if (c.barShare != null) {
      var fill = el("i", { style: "width:" + Math.round(c.barShare * 100) + "%;background:" + c.barColor });
      kids.push(el("div", { class: "bar" }, [fill]));
    }
    if (!c.band) return el("div", { class: "kpi" }, kids);
    var card = el("div", { class: "kpi clickable", tabindex: "0", role: "button", "aria-pressed": String(state.band === c.band), title: "Click to highlight these areas on the map" }, kids);
    card.addEventListener("click", function () { setBand(c.band); });
    card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBand(c.band); } });
    return card;
  }

  function renderKpis(scan, prevScan) {
    var box = document.getElementById("kpis");
    clear(box);
    var cur = M.summarize(scan, state.keyword, null, true);
    var prev = prevScan && prevScan.keywords[state.keyword] ? M.summarize(prevScan, state.keyword, null, true) : null;
    if (!cur.points) { box.appendChild(el("div", { class: "empty", text: "No valid grid points for this keyword." })); return; }
    var n = cur.points;
    var oneDec = function (x) { return x.toFixed(1); };
    var spots = function (x) { return String(x); };
    function band(key, label, desc, lowerIsBetter, neutral, color) {
      var count = cur.bands[key];
      return {
        label: label, value: String(count), small: " of " + n + " spots · " + pct(cur.bandShare[key]),
        desc: desc + " Click to highlight on the map.",
        change: changeNode(count, prev && prev.bands[key], lowerIsBetter, neutral, spots, "spot"),
        barShare: cur.bandShare[key], barColor: color, band: key
      };
    }
    [
      { label: "Average position", value: oneDec(cur.avgRank), small: " (1 is best)",
        desc: "Your average rank over all " + n + " spots. A spot where you are not in the top 20 counts as 21. Lower is better.",
        change: changeNode(cur.avgRank, prev && prev.avgRank, true, false, oneDec) },
      { label: "Share of attention (est.)", value: pct1(cur.shareOfVoice),
        desc: "Your share of all the attention in this area. Rank 1 counts most and rank 20 almost nothing. My own rough estimate. Higher is better.",
        change: changeNode(cur.shareOfVoice, prev && prev.shareOfVoice, false, false, pct1) },
      band("top3", "In the top 3", "Spots where you are one of the first 3 businesses shown. This is what most people see.", false, false, "var(--good)"),
      band("mid", "Ranks 4 to 10", "Spots where you are still on the first page, but below the top 3.", false, true, "var(--mid)"),
      band("low", "Ranks 11 to 20", "Spots where you are on the second page. Very few people see these.", true, false, "var(--low)"),
      band("out", "Not in the top 20", "Spots where you do not show up at all. These are the grey bubbles.", true, false, "var(--out)")
    ].forEach(function (c) { box.appendChild(kpi(c)); });
  }

  function bubbleIcon(rank, failed, dim, sel) {
    var cls = "bubble ", text;
    if (failed) { cls += "fail"; text = "–"; }
    else if (rank == null || rank > 20) { cls += "out"; text = "20+"; }
    else {
      var b = M.bandOf(rank);
      cls += b === "top3" ? "good" : b === "mid" ? "mid" : "low";
      text = String(rank);
    }
    if (dim) cls += " dim";
    if (sel) cls += " sel";
    return L.divIcon({ className: "", html: '<div class="' + cls + '">' + text + "</div>", iconSize: [34, 34], iconAnchor: [17, 17] });
  }

  function subjectName(scan) {
    return state.selected == null ? scan.business.name : ((scan.places[state.selected] || {}).title || "This listing");
  }

  var lastPick = 0;
  function pickSpot(idx, band) {
    // ignore the second click of a double-click (it lands after the map has moved)
    if (Date.now() - lastPick < 600) return;
    lastPick = Date.now();
    state.spot = idx;
    state.band = band;
    render();
  }

  function clearPick() {
    if (Date.now() - lastPick < 600) return;
    state.spot = null; state.band = null; render();
  }

  function renderMap(scan) {
    var pts = scan.keywords[state.keyword] || [];
    if (!state.map) {
      state.map = L.map("map", { scrollWheelZoom: true, doubleClickZoom: false, maxZoom: 19, minZoom: 9 });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
      }).addTo(state.map);
      state.map.on("click", clearPick);
    }
    if (state.layer) state.layer.remove();
    state.layer = L.layerGroup().addTo(state.map);
    var isMe = state.selected == null;
    var name = subjectName(scan);
    var spacing = scan.grid.spacing_km;
    var bounds = [];
    // areas first (underneath), bubbles on top
    pts.forEach(function (p, idx) {
      var rank = p.failed ? null : M.rankAt(p, state.selected, isMe);
      var band = p.failed ? "fail" : M.bandOf(rank);
      var active = state.band == null || band === state.band;
      var isSpot = state.spot === idx;
      var color = p.failed ? "#bbbbbb" : BAND_COLOR[band];
      var rect = L.rectangle(M.cellBounds(p.lat, p.lng, spacing), {
        stroke: true, color: isSpot ? "#111" : color, weight: isSpot ? 3 : (state.band != null && active ? 2 : 1),
        opacity: active ? 0.9 : 0.25, fillColor: color,
        fillOpacity: p.failed ? 0.05 : (state.band == null ? 0.28 : (active ? 0.5 : 0.04)),
        dashArray: p.failed ? "4 4" : null, interactive: true
      });
      rect.on("click", function (e) { L.DomEvent.stopPropagation(e); if (!p.failed) pickSpot(idx, band); });
      rect.addTo(state.layer);
      bounds.push([p.lat, p.lng]);
    });
    pts.forEach(function (p, idx) {
      var rank = p.failed ? null : M.rankAt(p, state.selected, isMe);
      var band = p.failed ? "fail" : M.bandOf(rank);
      var dim = state.band != null && band !== state.band;
      var m = L.marker([p.lat, p.lng], { icon: bubbleIcon(rank, p.failed, dim, state.spot === idx), keyboard: false });
      m.bindTooltip(p.failed ? "Search failed at this spot" : name + ": " + (rank == null ? "not in top 20" : "rank " + rank) + " (click for details)");
      m.on("click", function (e) { L.DomEvent.stopPropagation(e); if (!p.failed) pickSpot(idx, band); });
      m.addTo(state.layer);
    });
    var g = scan.grid;
    L.circleMarker([g.center_lat, g.center_lng], { radius: 5, color: "#000", weight: 2, fill: false, interactive: false }).addTo(state.layer);
    // pins for the businesses ranking above the subject at the chosen spot
    state.pinMarkers = {};
    var spotPoint = state.spot != null ? pts[state.spot] : null;
    var pinBounds = [];
    if (spotPoint) {
      var here = [spotPoint.lat, spotPoint.lng];
      pinBounds.push(here);
      var mineRank = M.rankAt(spotPoint, state.selected, isMe);
      aheadList(scan, spotPoint, mineRank, isMe).forEach(function (a) {
        if (a.info.lat == null || a.info.lng == null) return;
        var there = [a.info.lat, a.info.lng];
        L.polyline([here, there], { color: "#333", weight: 1.5, dashArray: "5 6", opacity: 0.7, interactive: false }).addTo(state.layer);
        var d = M.distanceKm(here[0], here[1], there[0], there[1]);
        var pop = el("div", { class: "poppin" }, [
          el("strong", { text: "#" + a.rank + "  " + (a.info.title || "") }),
          el("div", { text: a.info.address || "Address not saved yet" }),
          el("div", { class: "mute", text: d.toFixed(1) + " km from this spot" + (a.info.category ? " · " + a.info.category : "") +
            (a.info.rating != null ? " · " + a.info.rating.toFixed(1) + (a.info.votes != null ? " (" + a.info.votes + ")" : "") : "") })
        ]);
        var mk = L.marker(there, { icon: pinIcon(String(a.rank), false), zIndexOffset: 1000 }).bindPopup(pop);
        mk.addTo(state.layer);
        state.pinMarkers[a.id] = mk;
        pinBounds.push(there);
      });
      var sInfo = isMe ? { lat: g.center_lat, lng: g.center_lng } : placeInfo(scan, state.selected);
      if (sInfo.lat != null && sInfo.lng != null) {
        var ym = L.marker([sInfo.lat, sInfo.lng], { icon: pinIcon(isMe ? "YOU" : "THIS", true), zIndexOffset: 1100 })
          .bindPopup(el("div", { class: "poppin" }, [el("strong", { text: subjectName(scan) }), el("div", { text: (isMe ? scan.business.address : sInfo.address) || "" })]));
        ym.addTo(state.layer);
        pinBounds.push([sInfo.lat, sInfo.lng]);
      }
    }
    var key = state.scanName + "|" + state.keyword;
    var spotKey = spotPoint ? key + "|" + state.spot : null;
    if (spotKey && spotKey !== state.fitSpotKey) {
      if (pinBounds.length > 1) state.map.fitBounds(pinBounds, { padding: [70, 70], maxZoom: 16 });
      state.fitSpotKey = spotKey;
    } else if (!spotKey && state.fitSpotKey != null) {
      state.fitSpotKey = null;
      if (bounds.length) state.map.fitBounds(bounds, { padding: [40, 40] });
    } else if (bounds.length && state.fitKey !== key) {
      state.map.fitBounds(bounds, { padding: [40, 40] });
      state.fitKey = key;
    }
    setTimeout(function () { state.map.invalidateSize(); }, 50);
  }

  function renderShowing(scan) {
    var box = document.getElementById("showing");
    clear(box);
    box.appendChild(el("span", { text: "Map shows: " }));
    box.appendChild(el("strong", { text: subjectName(scan) }));
    var pts = scan.keywords[state.keyword] || [];
    var sp = state.spot != null ? pts[state.spot] : null;
    if (sp) {
      var mineHere = M.rankAt(sp, state.selected, state.selected == null);
      box.appendChild(el("span", { class: "spotnote", text: "Spot selected: " + (mineHere == null ? "not in the top 20 here" : "rank #" + mineHere + " here") + ". " }));
      var jump = el("button", { class: "lg", type: "button", text: "See who ranks above ↓" });
      jump.addEventListener("click", function () { var sb = document.getElementById("spot"); if (sb) sb.scrollIntoView({ behavior: "smooth", block: "start" }); });
      box.appendChild(jump);
    } else {
      box.appendChild(el("span", { class: "spotnote mute", text: "Click any bubble to see who ranks above you there." }));
    }
    if (state.selected != null) {
      var back = el("button", { class: "lg reset", type: "button", text: "Back to " + scan.business.name });
      back.addEventListener("click", function () { state.selected = null; state.band = null; state.spot = null; render(); });
      box.appendChild(back);
    }
  }

  function renderLegend(scan) {
    var lg = document.getElementById("legend");
    clear(lg);
    ["top3", "mid", "low", "out"].forEach(function (b) {
      var btn = el("button", { class: "lg", type: "button", "aria-pressed": String(state.band === b), title: "Highlight these areas" },
        [el("i", { style: "background:" + BAND_COLOR[b] }), document.createTextNode(BAND_LABEL[b])]);
      btn.addEventListener("click", function () { setBand(b); });
      lg.appendChild(btn);
    });
    if (state.band) {
      var all = el("button", { class: "lg reset", type: "button", text: "Show all" });
      all.addEventListener("click", clearPick);
      lg.appendChild(all);
    }
  }


  function searchWordIn(keyword, title) {
    var words = keyword.toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 5 && w !== "near"; });
    var t = (title || "").toLowerCase();
    return words.some(function (w) { return t.indexOf(w) >= 0; });
  }

  /* What we know about a listing: the scan's data, topped up from profiles.json when a field is missing. */
  function placeInfo(scan, id) {
    var base = scan.places[id] || {};
    var pr = profileOf(id);
    if (!pr) return base;
    var m = {};
    Object.keys(base).forEach(function (k) { m[k] = base[k]; });
    ["address", "lat", "lng", "photos", "domain"].forEach(function (k) { if (m[k] == null && pr[k] != null) m[k] = pr[k]; });
    if (!(m.also && m.also.length) && pr.also && pr.also.length) m.also = pr.also;
    if (!m.category && pr.category) m.category = pr.category;
    return m;
  }

  /* The listings that rank above the subject at this spot (or the top 5 if the subject is not in the top 20). */
  function aheadList(scan, p, mine, isMe) {
    var subjectId = isMe ? scan.business.place_id : state.selected;
    var limit = mine == null ? 5 : mine - 1;
    return p.ranks.slice().sort(function (a, b) { return a[1] - b[1]; })
      .filter(function (x) { return x[0] !== subjectId && x[1] <= limit; })
      .slice(0, 10)
      .map(function (x) { return { id: x[0], rank: x[1], info: placeInfo(scan, x[0]) }; });
  }

  function pinIcon(text, you) {
    return L.divIcon({ className: "", html: '<div class="pin' + (you ? " you" : "") + '">' + text + "</div>",
      iconSize: you ? [44, 26] : [30, 30], iconAnchor: you ? [22, 13] : [15, 15] });
  }

  function openPin(id) {
    var mk = state.pinMarkers[id];
    if (mk && state.map) { state.map.panTo(mk.getLatLng()); mk.openPopup(); }
  }

  function profileOf(id) {
    var pr = state.profiles && state.profiles[id];
    return pr && pr.matched ? pr : null;
  }

  /* Services: typed in by hand (docs/data/services_manual.json) win; Google data is the fallback. */
  function servicesOf(info) {
    var m = state.manual[(info.title || "").trim().toLowerCase()];
    if (m) return m.slice();
    var pr = profileOf(info.id);
    if (pr && pr.services && pr.services.length) return pr.services.map(function (x) { return x.title; });
    return null;
  }

  function topicsOf(id) {
    var pr = profileOf(id);
    if (!pr || !pr.topics) return null;
    var keys = Object.keys(pr.topics);
    return keys.length ? keys.sort(function (a, b) { return pr.topics[b] - pr.topics[a]; }) : null;
  }

  var DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var DAYN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function hhmm(t) { return (t.hour < 10 ? "0" : "") + t.hour + ":" + (t.minute < 10 ? "0" : "") + t.minute; }
  function hoursText(id) {
    var pr = profileOf(id);
    var tt = pr && pr.work_time && pr.work_time.timetable;
    if (!tt) return null;
    var parts = DAYS.map(function (d) {
      var v = tt[d];
      if (!v || !v.length) return "closed";
      return v.map(function (x) { return hhmm(x.open) + "-" + hhmm(x.close); }).join(", ");
    });
    var out = [], i = 0;
    while (i < 7) {
      var j = i;
      while (j + 1 < 7 && parts[j + 1] === parts[i]) j++;
      out.push((j > i ? DAYN[i] + "-" + DAYN[j] : DAYN[i]) + " " + parts[i]);
      i = j + 1;
    }
    return out.join("; ");
  }

  function compareTable(scan, p, mine, isMe) {
    var meId = scan.business.place_id;
    var subjectId = isMe ? meId : state.selected;
    var sorted = p.ranks.slice().sort(function (a, b) { return a[1] - b[1]; });
    var cols = sorted.filter(function (x) { return x[0] !== subjectId; }).slice(0, 3).map(function (x) {
      return { id: x[0], label: "#" + x[1], info: Object.assign({ id: x[0] }, placeInfo(scan, x[0])) };
    });
    var subjInfo = placeInfo(scan, subjectId);
    cols.push({
      label: (isMe ? "You" : "Selected") + (mine == null ? " (not top 20)" : " (#" + mine + ")"),
      id: subjectId, info: Object.assign({ id: subjectId }, subjInfo), subject: true,
      lat: subjInfo.lat != null ? subjInfo.lat : (isMe ? scan.grid.center_lat : null),
      lng: subjInfo.lng != null ? subjInfo.lng : (isMe ? scan.grid.center_lng : null)
    });
    cols.forEach(function (c) {
      var la = c.lat != null ? c.lat : c.info.lat, lo = c.lng != null ? c.lng : c.info.lng;
      c.dist = (la != null && lo != null) ? M.distanceKm(p.lat, p.lng, la, lo) : null;
    });
    var haveExtras = cols.some(function (c) { return c.info.photos != null || c.info.lat != null; });
    var minDist = Math.min.apply(null, cols.map(function (c) { return c.dist == null ? Infinity : c.dist; }));
    var dash = "–";
    var rows = [
      ["Name", function (c) { return c.info.title || dash; }],
      ["Distance from this spot", function (c) { return c.dist == null ? dash : c.dist.toFixed(1) + " km"; }, true],
      ["Main category", function (c) { return c.info.category || dash; }],
      ["Also listed as", function (c) { return (c.info.also && c.info.also.length) ? c.info.also.join(", ") : dash; }],
      ["Rating", function (c) { return c.info.rating != null ? c.info.rating.toFixed(1) + (c.info.votes != null ? " (" + c.info.votes + ")" : "") : dash; }],
      ["Photos", function (c) { return c.info.photos != null ? String(c.info.photos) : dash; }],
      ["Profile claimed", function (c) { return c.info.claimed == null ? dash : (c.info.claimed ? "Yes" : "No"); }],
      ["Search word in name", function (c) { return c.info.title ? (searchWordIn(state.keyword, c.info.title) ? "Yes" : "No") : dash; }],
      ["Website", function (c) { return c.info.domain || dash; }],
      ["Services listed", function (c) {
        var t = servicesOf(c.info);
        if (!t) return "not available";
        return t.length + ": " + t.slice(0, 8).join(", ") + (t.length > 8 ? ", +" + (t.length - 8) + " more" : "");
      }],
      ["Review topics (what customers mention)", function (c) {
        var t = topicsOf(c.id);
        return t ? t.slice(0, 6).join(", ") : dash;
      }],
      ["Opening hours", function (c) { return hoursText(c.id) || dash; }]
    ];
    var thead = el("tr", null, [el("th", { text: "" })].concat(cols.map(function (c) {
      return el("th", { class: c.subject ? "subj" : "", text: c.label });
    })));
    var tbody = rows.map(function (r) {
      return el("tr", null, [el("th", { class: "rowh", text: r[0] })].concat(cols.map(function (c) {
        var cell = el("td", { class: (c.subject ? "subj " : "") + (r[2] && c.dist != null && c.dist === minDist ? "best" : ""), text: r[1](c) });
        return cell;
      })));
    });
    var wrap = el("div", { class: "cmpwrap" }, [el("table", { class: "cmp" }, [el("thead", null, [thead]), el("tbody", null, tbody)])]);
    var out = [el("h3", { text: "Why they rank above " + (isMe ? "you" : "it") + " here" }), wrap];
    var subjCol = cols[cols.length - 1], first = cols[0];
    if (first && first.dist != null && subjCol.dist != null && mine !== 1) {
      out.push(el("p", { class: "spotsum", text: "The #1 listing is " + first.dist.toFixed(1) + " km from this spot; " +
        (isMe ? "you are " : "this listing is ") + subjCol.dist.toFixed(1) + " km away." }));
    }
    function gap(label, getter) {
      var mineList = getter(subjCol);
      var others = cols.slice(0, 3).filter(function (c) { return !c.subject; }).map(getter).filter(Boolean);
      if (!mineList || !others.length) return;
      var have = {}, seen = {}, missing = [];
      mineList.forEach(function (x) { have[x.toLowerCase()] = true; });
      others.forEach(function (l) { l.forEach(function (x) {
        var k = x.toLowerCase();
        if (!have[k] && !seen[k]) { seen[k] = true; missing.push(x); }
      }); });
      out.push(el("p", { class: "spotsum", text: missing.length
        ? label + " the businesses above have that " + (isMe ? "you don't" : "this listing doesn't") + ": " + missing.slice(0, 10).join(", ") + (missing.length > 10 ? ", +" + (missing.length - 10) + " more" : "") + "."
        : "Nothing in " + label.toLowerCase() + " that the businesses above list is missing from " + (isMe ? "your" : "this") + " profile." }));
    }
    gap("Services", function (c) { return servicesOf(c.info); });
    gap("Review topics", function (c) { return topicsOf(c.id); });
    if (!cols.some(function (c) { return !c.subject && servicesOf(c.info); })) {
      out.push(el("p", { class: "hint", text: "Google data has no services for these businesses. To compare them, type what you see on their Google Maps page into data/services_manual.json (see the README)." }));
    }
    if (!state.profiles) out.push(el("p", { class: "hint", text: "Review topics and hours are not loaded yet. Run profiles.py (see the README)." }));
    if (!haveExtras) out.push(el("p", { class: "hint", text: "Distance, photos, categories and website are saved from the next scan onwards. This scan was run before they were added." }));
    return out;
  }

  function renderSpot(scan) {
    var box = document.getElementById("spot");
    clear(box);
    var pts = scan.keywords[state.keyword] || [];
    if (state.band == null) { box.hidden = true; return; }
    box.hidden = false;
    if (state.spot != null && state.shownSpot !== state.spot) {
      state.shownSpot = state.spot;
      setTimeout(function () { box.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50);
    }
    if (state.spot == null) state.shownSpot = null;
    var isMe = state.selected == null;
    var name = subjectName(scan);
    var spacing = scan.grid.spacing_km;
    var area = M.bandArea(scan, state.keyword, state.selected, isMe, state.band, spacing);
    var head = el("div", { class: "spothead" }, [
      el("span", { class: "dot", style: "background:" + BAND_COLOR[state.band] }),
      el("strong", { text: BAND_LABEL[state.band] + " area" })
    ]);
    var close = el("button", { class: "lg reset", type: "button", text: "Close" });
    close.addEventListener("click", clearPick);
    head.appendChild(close);
    box.appendChild(head);
    box.appendChild(el("p", { class: "spotsum", text: name + " is in this band at " + area.spots + " of " + area.of +
      " spots, roughly " + area.km2.toFixed(0) + " km² of the " + area.totalKm2.toFixed(0) + " km² scanned (each spot stands for a " +
      spacing + " km square around it)." }));
    var p = state.spot != null ? pts[state.spot] : null;
    if (!p) {
      box.appendChild(el("p", { class: "hint", text: "Click a bubble or square on the map to see who ranks 1 to 20 at that spot." }));
      return;
    }
    var mine = M.rankAt(p, state.selected, isMe);
    box.appendChild(el("h3", { text: "Spot " + p.lat.toFixed(4) + ", " + p.lng.toFixed(4) }));
    box.appendChild(el("p", { class: "spotsum", text: name + (mine == null ? " is not in the top 20 here." : " ranks #" + mine + " here.") }));
    var link = el("a", { href: "https://www.google.com/maps/search/" + encodeURIComponent(state.keyword) + "/@" + p.lat + "," + p.lng + ",14z",
      target: "_blank", rel: "noopener", text: "Open this search in Google Maps ↗" });
    box.appendChild(el("p", { class: "hint" }, [link]));
    compareTable(scan, p, mine, isMe).forEach(function (n) { box.appendChild(n); });
    box.appendChild(el("h3", { text: "Everyone in the top 20 here" }));
    var list = el("ol", { class: "toplist" });
    p.ranks.slice().sort(function (a, b) { return a[1] - b[1]; }).forEach(function (x) {
      var info = placeInfo(scan, x[0]);
      var you = x[0] === scan.business.place_id;
      var chosen = state.selected != null && x[0] === state.selected;
      var rating = info.rating != null ? info.rating.toFixed(1) + (info.votes != null ? " (" + info.votes + ")" : "") : "";
      var la = info.lat != null ? info.lat : (you ? scan.grid.center_lat : null);
      var lo = info.lng != null ? info.lng : (you ? scan.grid.center_lng : null);
      var dist = (la != null && lo != null) ? M.distanceKm(p.lat, p.lng, la, lo) : null;
      var addr = info.address || (you ? scan.business.address : "");
      var sub = [addr, dist != null ? dist.toFixed(1) + " km from this spot" : null].filter(Boolean).join(" · ");
      var li = el("li", { class: "clickable " + (you ? "me " : "") + (chosen ? "chosen" : "") }, [
        el("span", { class: "rk", text: String(x[1]) }),
        el("span", { class: "nm" }, [document.createTextNode((info.title || x[0]) + (you ? "  (you)" : "")), sub ? el("span", { class: "addr", text: sub }) : null]),
        el("span", { class: "rt", text: rating })
      ]);
      li.addEventListener("click", function () { openPin(x[0]); });
      list.appendChild(li);
    });
    box.appendChild(list);
    if (mine == null && isMe) box.appendChild(el("p", { class: "hint", text: "These are the 20 listings Google showed instead (paid ads are not counted)." }));
  }

  function renderTable(scan) {
    var rows = M.competitors(scan, state.keyword);
    var tbody = document.querySelector("#comp tbody");
    clear(tbody);
    var me = rows.filter(function (r) { return r.isMe; })[0];
    var shown = rows.filter(function (r) { return !r.isMe; }).slice(0, 15);
    if (me) shown.unshift(me); // your own row is always pinned to the top
    document.getElementById("paneltitle").textContent = "Competitors for “" + state.keyword + "”";
    shown.forEach(function (r) {
      var id = r.isMe ? null : r.placeId;
      var selected = (state.selected == null && r.isMe) || state.selected === r.placeId;
      var nameCell = el("td", null, [
        document.createTextNode(r.title),
        r.isMe ? el("span", { class: "you", text: "You" }) : null,
        r.category ? el("span", { class: "cat", text: r.category }) : null
      ]);
      var rating = r.rating != null ? r.rating.toFixed(1) + (r.votes != null ? " (" + r.votes + ")" : "") : "–";
      var tr = el("tr", { tabindex: "0", "aria-selected": String(selected) }, [
        nameCell,
        el("td", { class: "num", text: rating }),
        el("td", { class: "num", text: r.avgRank.toFixed(1) }),
        el("td", { class: "num", text: pct1(r.shareOfVoice) })
      ]);
      var choose = function () { state.selected = id; state.band = null; state.spot = null; render(); };
      tr.addEventListener("click", choose);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
      tbody.appendChild(tr);
    });
  }

  function renderMeta(scan) {
    var when = new Date(scan.scanned_at);
    var txt = "Scanned " + when.toUTCString() + " · " + (scan.keywords[state.keyword] || []).length +
      " grid points per keyword · cost $" + scan.cost_usd.toFixed(3) +
      (scan.failed_points ? " · " + scan.failed_points + " failed point(s)" : "");
    document.getElementById("meta").textContent = txt;
    var g = scan.grid;
    document.getElementById("subtitle").textContent =
      scan.business.name + " · " + g.size + "×" + g.size + " grid, " + g.spacing_km + " km apart · " +
      scan.search.device + " searches";
    var banner = document.getElementById("banner");
    if (scan.TEST_FIXTURE) {
      banner.hidden = false;
      banner.textContent = "This scan is TEST data (generated offline), not real Google results.";
    } else banner.hidden = true;
  }

  function render() {
    var scan = state.cache[state.scanName];
    var prevName = previousName(state.scanName);
    var prevScan = prevName ? state.cache[prevName] : null;
    renderScanBar();
    renderKeywords(scan);
    renderKpis(scan, prevScan);
    renderShowing(scan);
    renderLegend(scan);
    renderSpot(scan);
    renderMap(scan);
    renderTable(scan);
    renderMeta(scan);
  }

  function selectScan(name) {
    var prev = previousName(name);
    Promise.all([loadScan(name), prev ? loadScan(prev).catch(function () { return null; }) : null]).then(function () {
      state.scanName = name;
      var kws = Object.keys(state.cache[name].keywords);
      if (kws.indexOf(state.keyword) < 0) state.keyword = kws[0];
      state.selected = null; state.band = null; state.spot = null;
      render();
    }).catch(showError);
  }

  function showError(err) {
    var main = document.querySelector("main");
    clear(main);
    main.appendChild(el("div", { class: "empty", text: "Could not load data: " + err.message }));
  }

  (window.BUNDLE ? Promise.resolve(window.BUNDLE.manual || {}) : fetchJSON("data/services_manual.json").catch(function () { return {}; })).then(function (man) {
    state.manual = {};
    Object.keys(man || {}).forEach(function (k) { if (k.charAt(0) !== "_" && Array.isArray(man[k])) state.manual[k.trim().toLowerCase()] = man[k]; });
    return window.BUNDLE ? Promise.resolve(window.BUNDLE.profiles || null) : fetchJSON("data/profiles.json").catch(function () { return null; });
  }).then(function (pr) {
    state.profiles = pr && pr.profiles ? pr.profiles : null;
    return window.BUNDLE ? window.BUNDLE.index : fetchJSON("data/index.json");
  }).then(function (idx) {
    state.index = idx;
    if (!idx.scans.length) {
      document.getElementById("subtitle").textContent = "No scans yet. Run the weekly scan once to see the map.";
      return;
    }
    selectScan(idx.scans[0]);
  }).catch(function () {
    document.getElementById("subtitle").textContent = "No scans yet. Run the weekly scan once to see the map.";
  });
})();
