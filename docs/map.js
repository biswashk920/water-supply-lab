/* Map mode: click a map to place reservoirs, junctions and break tanks (x, y from the click, elevation from a DEM
   service), then click node after node to draw pipes. Node x, y and elevation stay the source of truth, so the
   tables, solver, length check and 3D view work as before. lat/lon are derived from x, y and net.origin. */
(function () {
  "use strict";
  var A = window.PipeApp, $ = function (id) { return document.getElementById(id); };
  var btn = $("modeMap"), map = null, group = null, shown = false, needFit = true, tool = "pan", pending = null;
  var KLAT = 111132, KLON = 111320, ELEV_URL = "https://api.open-meteo.com/v1/elevation";
  var HINTS = { pan: "Drag to move the map.", R: "Click the map to add a reservoir.", J: "Click the map to add a junction.", B: "Click the map to add a break tank.",
    pipe: "Click a node, then the next node, to draw pipes. Click the same node or press Esc to stop." };

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888"; }
  function note(t) { var e = $("mapNote"); e.textContent = t; e.hidden = !t; }
  function toXY(ll) {
    var o = A.net().origin;
    return { x: Math.round((ll.lng - o.lon) * KLON * Math.cos(o.lat * Math.PI / 180) * 10) / 10, y: Math.round(-(ll.lat - o.lat) * KLAT * 10) / 10 };
  }
  function toLL(x, y) {
    var o = A.net().origin;
    return { lat: o.lat - y / KLAT, lng: o.lon + x / (KLON * Math.cos(o.lat * Math.PI / 180)) };
  }

  function fetchElev(n) {
    note("Fetching the elevation for " + n.id + "\u2026");
    fetch(ELEV_URL + "?latitude=" + n.lat + "&longitude=" + n.lon).then(function (r) { return r.json(); }).then(function (j) {
      var z = j && j.elevation && j.elevation[0];
      if (typeof z !== "number") throw new Error("no value");
      if (A.net().nodes.indexOf(n) < 0) return;
      n.elev = Math.round(z); n.demElev = true;
      note(n.id + ": " + n.elev + " m from a coarse elevation model (about 90 m grid). It can be off by several metres, so correct it in the table with surveyed levels.");
      A.renderEditors(); A.update();
    }).catch(function () { note("Could not get the elevation for " + n.id + " (offline, or the service is busy). Enter it in the table."); });
  }

  function place(type, ll) {
    var net = A.net();
    if (!net.origin) {
      if (net.nodes.length && !confirm("This network has no map positions. Start a new map network? Its current nodes and pipes will be removed.")) return;
      net.nodes = []; net.pipes = []; net.origin = { lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) };
    }
    var q = toXY(ll), n = { id: A.uniqueId(type, net.nodes), type: type, elev: 0, demand: 0, x: q.x, y: q.y };
    net.nodes.push(n); A.renderEditors(); A.update(); fetchElev(n);
  }

  function pick(n) {
    var net = A.net();
    if (!pending || pending === n) { pending = pending === n ? null : n; A.update(); return; }
    var p = { id: A.uniqueId("P", net.pipes), from: pending.id, to: n.id, length: 500, diam: 200, material: "hdpe",
      rough: A.matRough("hdpe", net.headloss), fittings: [], extraK: 0, minor: 0 };
    net.pipes.push(p); A.suggestLength(p); pending = n; A.renderEditors(); A.update();
  }

  function redraw() {
    var net = A.net();
    if (!net.origin) { if (shown) note("This network has no map positions yet. Choose Reservoir or Junction and click the map to start."); return; }
    net.nodes.forEach(function (n) { var p = toLL(n.x, n.y); n.lat = +p.lat.toFixed(6); n.lon = +p.lng.toFixed(6); });
    if (!map) return;
    group.clearLayers();
    var res = A.result(), w = A.warns(), bad = {}, pts = [], qmax = 1e-9;
    w.len.concat(w.press).forEach(function (x) { bad[x.id] = 1; });
    if (res) res.pipes.forEach(function (r) { qmax = Math.max(qmax, Math.abs(r.flow_lps)); });
    net.pipes.forEach(function (p, i) {
      var a = A.nodeById(p.from), b = A.nodeById(p.to); if (!a || !b) return;
      var r = res ? res.pipes[i] : null;
      var line = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: bad[p.id] ? css("--bad") : (r ? css("--flow") : css("--muted")),
        weight: r ? 2 + 6 * Math.abs(r.flow_lps) / qmax : 3, opacity: 0.9, dashArray: bad[p.id] ? "8 6" : null }).addTo(group);
      line.bindTooltip(A.esc(p.id), { sticky: true });
      line.on("mousemove", function (e) { // head at the point under the cursor, interpolated between the end nodes
        var q = toXY(e.latlng), dx = b.x - a.x, dy = b.y - a.y;
        var t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        var g = a.elev + t * (b.elev - a.elev);
        var h = "<b>" + A.esc(p.id) + "</b> " + A.esc(p.from) + " \u2192 " + A.esc(p.to) + "<br>" + p.length + " m, \u00d8" + p.diam + " mm<br>Ground " + A.fmt(g, 1) + " m";
        if (r) { var hg = r.head_from - t * (r.head_from - r.head_to); h += "<br>Head " + A.fmt(hg, 2) + " m<br>Pressure " + A.fmt(hg - g, 2) + " m<br>Flow " + A.fmt(Math.abs(r.flow_lps), 2) + " L/s"; }
        line.setTooltipContent(h);
      });
    });
    net.nodes.forEach(function (n, i) {
      var rn = res ? res.nodes[i] : null, col = n.type === "R" ? css("--ink") : (n.type === "B" ? css("--accent") :
        (rn ? (rn.pressure < 0 ? css("--bad") : (rn.pressure < 10 ? css("--warn") : css("--ok"))) : css("--muted")));
      var m = L.marker([n.lat, n.lon], { draggable: true, icon: L.divIcon({ className: "mkwrap", iconSize: [18, 18], iconAnchor: [9, 9],
        html: '<span class="mk mk-' + n.type + (pending === n ? " sel" : "") + '" style="background:' + col + '"></span><span class="mklbl">' + A.esc(n.id) + "</span>" }) }).addTo(group);
      var tip = "<b>" + A.esc(n.id) + "</b><br>" + (n.type === "J" ? "Ground " : "Water level ") + A.fmt(n.elev, 1) + " m" + (n.demElev ? " (elevation model estimate)" : "");
      if (rn) tip += "<br>Head " + A.fmt(rn.head, 2) + " m" + (n.type === "J" ? "<br>Pressure " + A.fmt(rn.pressure, 2) + " m" : "");
      m.bindTooltip(tip, { direction: "top", offset: [0, -8] });
      m.on("click", function () { if (tool === "pipe") pick(n); });
      m.on("dragend", function () { // keep a manually entered elevation; refresh only model estimates
        var q = toXY(m.getLatLng()); n.x = q.x; n.y = q.y; delete n.autoXY;
        A.renderEditors(); A.update(); if (n.demElev) fetchElev(n);
      });
      pts.push([n.lat, n.lon]);
    });
    if (needFit && shown && pts.length) { map.fitBounds(pts, { padding: [50, 50], maxZoom: 17 }); needFit = false; }
  }

  function init() {
    if (map) return;
    var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "\u00a9 OpenStreetMap contributors" });
    var sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery \u00a9 Esri, Maxar, Earthstar Geographics" });
    var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "\u00a9 OpenStreetMap contributors, SRTM | \u00a9 OpenTopoMap (CC-BY-SA)" });
    map = L.map("map", { layers: [osm], center: [28.4, 84.0], zoom: 7 });
    L.control.layers({ "OpenStreetMap": osm, "Satellite (Esri)": sat, "Topographic (OpenTopoMap)": topo }).addTo(map);
    group = L.layerGroup().addTo(map);
    map.on("click", function (e) {
      if (tool === "J" || tool === "R" || tool === "B") place(tool, e.latlng);
      else if (tool === "pipe" && pending) { pending = null; A.update(); }
    });
  }

  function show(on) {
    shown = on; $("map").hidden = !on; $("mapBar").hidden = !on; $("schematic").hidden = on;
    btn.setAttribute("aria-pressed", String(on));
    if (on) {
      ["mode2d", "mode3d"].forEach(function (id) { $(id).setAttribute("aria-pressed", "false"); });
      $("ctl3d").hidden = true; $("tip").hidden = true;
      init(); map.invalidateSize(); redraw();
    } else { note(""); window.dispatchEvent(new Event("resize")); }
  }
  btn.addEventListener("click", function () {
    if (!window.L) { $("status").className = "status err"; $("status").textContent = "The map library did not load. Map mode needs an internet connection."; return; }
    show(true);
  });
  ["mode2d", "mode3d"].forEach(function (id) { $(id).addEventListener("click", function () { if (shown) show(false); }); });
  $("mapBar").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-tool]"); if (!b) return;
    tool = b.dataset.tool; pending = null;
    Array.prototype.forEach.call($("mapBar").querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    $("mapHint").textContent = HINTS[tool]; $("map").classList.toggle("place", tool !== "pan");
    A.update();
  });
  $("zoomIn").addEventListener("click", function () { if (shown) map.zoomIn(); });
  $("zoomOut").addEventListener("click", function () { if (shown) map.zoomOut(); });
  $("zoomFit").addEventListener("click", function () { if (shown) { needFit = true; redraw(); } });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && pending) { pending = null; A.update(); } });

  window.MapMode = { redraw: redraw, loaded: function () { needFit = true; pending = null; } };
})();
