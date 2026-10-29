(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var APP_VERSION = 6;
  if (!window.PipeNet || PipeNet.version !== APP_VERSION || !window.PIPE_DATA || window.PIPE_DATA.version !== APP_VERSION || !window.PRESETS) {
    $("status").className = "status err";
    $("status").textContent = "Some files of this page come from different versions (solver.js, materials.js or presets.js do not match app.js, " +
      "possibly an older copy kept by the browser or left in the folder). Extract the whole zip into a new empty folder and reload with Ctrl+Shift+R.";
    return;
  }
  var P_LOW = 10, V_HIGH = 3;
  var MATS = window.PIPE_DATA.materials, FITS = window.PIPE_DATA.fittings, PNS = window.PIPE_DATA.pnOptions;
  var TYPES = [["J", "Junction"], ["R", "Reservoir"], ["B", "Break tank"]];
  var STARTER = { name: "New network", headloss: "HW",
    description: "A starter network: one reservoir, one junction, one pipe. Add nodes and pipes, and change a node's type to Break tank for gravity systems.",
    nodes: [{ id: "R1", type: "R", elev: 120, demand: 0, x: 0, y: 0 }, { id: "J1", type: "J", elev: 80, demand: 5, x: 500, y: 0 }],
    pipes: [{ id: "P1", from: "R1", to: "J1", length: 560, diam: 100, material: "hdpe", rough: 150, fittings: [], extraK: 0, minor: 0 }] };
  var net, result = null, lenWarns = [], pressWarns = [], viewFs = 12, zoom = 1;
  var drag = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(x, d) { return (x === null || x === undefined || !isFinite(x)) ? "" : x.toFixed(d); }
  function roughLabel() { return net.headloss === "DW" ? "\u03b5 (mm)" : "C"; }
  function mat(id) { for (var i = 0; i < MATS.length; i++) if (MATS[i].id === id) return MATS[i]; return null; }
  function matRough(id, model) { var m = mat(id); return m ? (model === "DW" ? m.eps : m.C) : null; }
  function nodeById(id) { for (var i = 0; i < net.nodes.length; i++) if (net.nodes[i].id === id) return net.nodes[i]; return null; }
  function nodeIndex(id) { for (var i = 0; i < net.nodes.length; i++) if (net.nodes[i].id === id) return i; return -1; }

  /* ---------- loading ---------- */
  function ensureCoords() {
    var n = net.nodes.length;
    net.nodes.forEach(function (nd, i) {
      if (typeof nd.x !== "number" || typeof nd.y !== "number") {
        nd.x = 300 + 220 * Math.cos(2 * Math.PI * i / n);
        nd.y = 200 + 140 * Math.sin(2 * Math.PI * i / n);
        nd.autoXY = true; // layout only, not real coordinates: skip the pipe length check
      }
    });
  }
  function loadNet(n, desc) {
    net = clone(n); delete net.expected;
    net.headloss = (net.headloss || "HW").toUpperCase();
    net.pipes.forEach(function (p) {
      if (!p.fittings) { p.fittings = []; p.extraK = p.minor || 0; } // older files: treat the total as "Other K"
      else if (p.extraK === undefined) p.extraK = 0;
      recomputeMinor(p);
    });
    ensureCoords();
    zoom = 1; view3d.vexag = null;
    $("model").value = net.headloss;
    $("desc").textContent = desc || net.description || "";
    $("lenHint").textContent = "";
    if (window.MapMode) MapMode.loaded();
    renderEditors(); update();
  }

  /* ---------- editor widgets ---------- */
  function tag(el, key) { el.dataset.f = key; el.setAttribute("aria-label", key); return el; }
  function numField(obj, key, after) {
    var el = document.createElement("input");
    el.type = "number"; el.step = "any";
    el.value = (typeof obj[key] === "number" && isFinite(obj[key])) ? obj[key] : "";
    el.addEventListener("change", function () {
      var v = parseFloat(el.value);
      if ((key === "extraK") && isNaN(v)) v = 0;
      obj[key] = v;
      if (key === "x" || key === "y") delete obj.autoXY;
      if (key === "elev") delete obj.demElev; // typed by hand: no longer a model estimate
      if (after) after();
      update();
    });
    return tag(el, key);
  }
  function textField(obj, key, onChange) {
    var el = document.createElement("input");
    el.type = "text"; el.value = obj[key] === undefined ? "" : obj[key];
    el.addEventListener("change", function () { var old = obj[key]; obj[key] = el.value.trim(); if (onChange) onChange(old, obj[key]); update(); });
    return tag(el, key);
  }
  function selectField(obj, key, options, onChange) {
    var el = document.createElement("select");
    options.forEach(function (o) { var op = document.createElement("option"); op.value = o; op.textContent = o; el.appendChild(op); });
    if (options.indexOf(obj[key]) < 0) { var op = document.createElement("option"); op.value = obj[key]; op.textContent = obj[key]; el.appendChild(op); }
    el.value = obj[key];
    el.addEventListener("change", function () { obj[key] = el.value; if (onChange) onChange(); update(); });
    return tag(el, key);
  }
  function typeSelect(n) {
    var el = document.createElement("select");
    TYPES.forEach(function (t) { var op = document.createElement("option"); op.value = t[0]; op.textContent = t[1]; el.appendChild(op); });
    el.value = n.type;
    el.addEventListener("change", function () { n.type = el.value; if (n.type !== "J") n.demand = 0; renderEditors(); update(); });
    return tag(el, "type");
  }
  function materialSelect(p) {
    var el = document.createElement("select");
    MATS.forEach(function (m) { var op = document.createElement("option"); op.value = m.id; op.textContent = m.name; el.appendChild(op); });
    var c = document.createElement("option"); c.value = "custom"; c.textContent = "Custom"; el.appendChild(c);
    el.value = mat(p.material) ? p.material : "custom";
    el.addEventListener("change", function () {
      p.material = el.value;
      var r = matRough(p.material, net.headloss);
      if (r !== null) p.rough = r;
      renderEditors(); update();
    });
    return tag(el, "material");
  }
  function pnSelect(p) {
    var el = document.createElement("select");
    var none = document.createElement("option"); none.value = ""; none.textContent = "No limit"; el.appendChild(none);
    PNS.forEach(function (v) { var op = document.createElement("option"); op.value = v; op.textContent = "PN " + v; el.appendChild(op); });
    if (typeof p.pn === "number" && PNS.indexOf(p.pn) < 0) { var o = document.createElement("option"); o.value = p.pn; o.textContent = "PN " + p.pn; el.appendChild(o); }
    el.value = typeof p.pn === "number" ? String(p.pn) : "";
    el.addEventListener("change", function () { if (el.value === "") delete p.pn; else p.pn = parseFloat(el.value); update(); });
    return tag(el, "pn");
  }
  function recomputeMinor(p) {
    var total = p.extraK || 0;
    (p.fittings || []).forEach(function (f) { total += f.K * f.n; });
    p.minor = Math.round(total * 1000) / 1000;
  }
  function fittingCell(p) {
    var box = document.createElement("div");
    var list = document.createElement("div"); list.className = "chips";
    (p.fittings || []).forEach(function (f, i) {
      var chip = document.createElement("span"); chip.className = "fchip";
      chip.appendChild(document.createTextNode(f.name + (f.n > 1 ? " \u00d7" + f.n : "") + " (K " + Math.round(f.K * f.n * 1000) / 1000 + ")"));
      var x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "\u2715";
      x.setAttribute("aria-label", "Remove one " + f.name + " from " + p.id);
      x.addEventListener("click", function () {
        if (f.n > 1) f.n--; else p.fittings.splice(i, 1);
        recomputeMinor(p); renderEditors(); update();
      });
      chip.appendChild(x); list.appendChild(chip);
    });
    box.appendChild(list);
    var el = document.createElement("select");
    var ph = document.createElement("option"); ph.value = ""; ph.textContent = "Add fitting\u2026"; el.appendChild(ph);
    FITS.forEach(function (f, i) { var op = document.createElement("option"); op.value = i; op.textContent = f.name + " (K " + f.K + ")"; el.appendChild(op); });
    el.setAttribute("aria-label", "add fitting to " + p.id);
    el.addEventListener("change", function () {
      if (el.value === "") return;
      var fit = FITS[+el.value];
      p.fittings = p.fittings || [];
      var found = p.fittings.filter(function (f) { return f.name === fit.name; })[0];
      if (found) found.n++; else p.fittings.push({ name: fit.name, K: fit.K, n: 1 });
      recomputeMinor(p); renderEditors(); update();
    });
    el.style.width = "100%";
    box.appendChild(el);
    return box;
  }
  function field(label, el, span) {
    var w = document.createElement("div"); w.className = "fld" + (span ? " span" + span : "");
    var s = document.createElement("span"); s.className = "lbl"; s.textContent = label;
    w.appendChild(s); w.appendChild(el); return w;
  }
  function delButton(label, fn) {
    var b = document.createElement("button"); b.type = "button"; b.className = "x"; b.textContent = "\u2715";
    b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b;
  }
  function row(table, cells) {
    var tr = document.createElement("tr");
    cells.forEach(function (c) { var td = document.createElement("td"); td.appendChild(c); tr.appendChild(td); });
    table.appendChild(tr);
  }
  function head(table, labels) {
    var tr = document.createElement("tr");
    labels.forEach(function (l) { var th = document.createElement("th"); th.textContent = l; tr.appendChild(th); });
    table.appendChild(tr);
  }

  // When a pipe's end nodes are picked, suggest a length 10% over the straight-line (3D) distance.
  function suggestLength(p) {
    var a = nodeById(p.from), b = nodeById(p.to), hint = $("lenHint");
    if (!a || !b || a === b || a.autoXY || b.autoXY) { hint.textContent = ""; return; }
    var d = PipeNet.distance3d(a, b);
    if (!isFinite(d)) { hint.textContent = ""; return; }
    p.length = Math.max(1, Math.ceil(d * 1.1));
    hint.textContent = p.id + ": length set to " + p.length + " m, 10% over the " + fmt(d, 1) + " m straight-line distance between " +
      p.from + " and " + p.to + ". Change it if the real route is longer.";
  }

  function renderEditors() {
    var nt = $("nodeTable"), pl = $("pipeList"), ids = net.nodes.map(function (n) { return n.id; });
    nt.innerHTML = ""; pl.innerHTML = "";
    head(nt, ["ID", "Type", "Elev (m)", "Demand (L/s)", "x (m)", "y (m)", ""]);
    net.nodes.forEach(function (n, i) {
      var dem = numField(n, "demand");
      if (n.type !== "J") { dem.disabled = true; dem.title = "Only junctions have a demand. Reservoirs and tanks supply whatever is drawn."; }
      row(nt, [
        textField(n, "id", function (oldId, newId) {
          net.pipes.forEach(function (p) { if (p.from === oldId) p.from = newId; if (p.to === oldId) p.to = newId; });
          renderEditors();
        }),
        typeSelect(n), numField(n, "elev"), dem, numField(n, "x"), numField(n, "y"),
        delButton("Delete node " + n.id, function () {
          net.pipes = net.pipes.filter(function (p) { return p.from !== n.id && p.to !== n.id; });
          net.nodes.splice(i, 1); renderEditors(); update();
        })
      ]);
    });
    net.pipes.forEach(function (p, i) {
      var card = document.createElement("div"); card.className = "pipe-card";
      var del = document.createElement("div"); del.className = "del-wrap";
      del.appendChild(delButton("Delete pipe " + p.id, function () { net.pipes.splice(i, 1); renderEditors(); update(); }));
      card.appendChild(field("Pipe", textField(p, "id")));
      card.appendChild(field("From", selectField(p, "from", ids, function () { suggestLength(p); renderEditors(); })));
      card.appendChild(field("To", selectField(p, "to", ids, function () { suggestLength(p); renderEditors(); })));
      card.appendChild(del);
      card.appendChild(field("Length (m)", numField(p, "length")));
      card.appendChild(field("Diameter (mm)", numField(p, "diam")));
      card.appendChild(field("Material", materialSelect(p), 2));
      card.appendChild(field(roughLabel(), numField(p, "rough", function () {
        var want = matRough(p.material, net.headloss);
        if (want !== null && p.rough !== want) { p.material = "custom"; renderEditors(); }
      })));
      card.appendChild(field("Pressure rating", pnSelect(p)));
      card.appendChild(field("Other K", numField(p, "extraK", function () { recomputeMinor(p); renderEditors(); })));
      var tk = document.createElement("div"); tk.className = "val"; tk.textContent = fmt(p.minor || 0, 2);
      card.appendChild(field("Total K", tk));
      card.appendChild(field("Fittings on this pipe", fittingCell(p), 4));
      pl.appendChild(card);
    });
  }

  function uniqueId(prefix, list) {
    var n = list.length + 1;
    while (list.some(function (o) { return o.id === prefix + n; })) n++;
    return prefix + n;
  }
  $("addNode").addEventListener("click", function () {
    var xsN = net.nodes.map(function (n) { return n.x; }).concat([0]);
    var maxX = Math.max.apply(null, xsN), gap = Math.max(100, 0.15 * (maxX - Math.min.apply(null, xsN)));
    var avgY = net.nodes.length ? net.nodes.reduce(function (s, n) { return s + n.y; }, 0) / net.nodes.length : 150;
    net.nodes.push({ id: uniqueId("J", net.nodes), type: "J", elev: 0, demand: 0, x: Math.round(maxX + gap), y: Math.round(avgY) });
    renderEditors(); update();
  });
  $("addPipe").addEventListener("click", function () {
    if (net.nodes.length < 2) return;
    var last = net.nodes.length - 1;
    var p = { id: uniqueId("P", net.pipes), from: net.nodes[last - 1].id, to: net.nodes[last].id, length: 500, diam: 200,
      material: "hdpe", rough: matRough("hdpe", net.headloss), fittings: [], extraK: 0, minor: 0 };
    net.pipes.push(p); suggestLength(p);
    renderEditors(); update();
  });
  $("model").addEventListener("change", function () {
    net.headloss = $("model").value;
    var custom = 0;
    net.pipes.forEach(function (p) { var r = matRough(p.material, net.headloss); if (r !== null) p.rough = r; else custom++; });
    $("desc").textContent = "Pipes with a material now use its " + roughLabel() + " value." +
      (custom ? " " + custom + " pipe" + (custom > 1 ? "s are" : " is") + " marked Custom and kept the old number, so re-enter " + roughLabel() + " for " + (custom > 1 ? "them" : "it") + "." : "");
    renderEditors(); update();
  });

  /* ---------- solve + render ---------- */
  function syncMap() { if (window.MapMode) MapMode.redraw(); }
  function update() {
    var errs = PipeNet.validate(net);
    result = null;
    var st = $("status");
    if (errs.length) {
      st.className = "status err";
      st.innerHTML = "Fix these before the network can be solved:<ul>" + errs.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>";
    } else {
      try { result = PipeNet.solve(net); } catch (e) { st.className = "status err"; st.textContent = e.message; }
      if (result) {
        var total = net.nodes.reduce(function (s, n) { return s + (n.type === "J" ? (n.demand || 0) : 0); }, 0);
        if (result.converged) { st.className = "status ok"; st.textContent = "Converged in " + result.iterations + " iterations. Total demand " + fmt(total, 2) + " L/s."; }
        else { st.className = "status warn"; st.textContent = "Did not converge in " + result.iterations + " iterations. Treat the numbers with caution."; }
      }
    }
    [showLengthWarnings, showPressureWarnings, renderResults, drawSchematic, drawConvergence, syncMap, hideTip].forEach(function (fn) {
      try { fn(); } catch (e) {
        console.error(e);
        st.className = "status err"; st.textContent = "Display error in " + fn.name + ": " + e.message;
      }
    });
  }

  function showLengthWarnings() {
    lenWarns = PipeNet.lengthCheck(net);
    var box = $("lenWarn"), bad = {};
    lenWarns.forEach(function (w) { bad[w.id] = w; });
    var up = function (w) { return fmt(Math.ceil(w.min * 10) / 10, 1); };
    box.hidden = !lenWarns.length;
    box.innerHTML = !lenWarns.length ? "" : "Pipe too short for its node positions:<ul>" + lenWarns.map(function (w) {
      return "<li>" + esc(w.id) + " is " + fmt(w.length, 1) + " m long, but " + esc(w.from) + " and " + esc(w.to) + " are " + fmt(w.min, 1) +
        " m apart (x, y and elevation). A pipe can be longer than that but not shorter. Enter at least " + up(w) + " m, or move the nodes.</li>";
    }).join("") + "</ul>Results use the length you entered, so headloss is underestimated for these pipes.";
    var cards = $("pipeList").children;
    net.pipes.forEach(function (p, i) {
      var inp = cards[i] && cards[i].querySelector('[data-f="length"]'), w = bad[p.id];
      if (!inp) return;
      inp.classList.toggle("bad-input", !!w);
      inp.title = w ? "Minimum length " + up(w) + " m (straight-line distance)" : "";
    });
  }

  function showPressureWarnings() {
    pressWarns = result ? PipeNet.pressureCheck(net, result) : [];
    var box = $("pressWarn");
    box.hidden = !pressWarns.length;
    box.innerHTML = !pressWarns.length ? "" : "Pressure above the pipe rating:<ul>" + pressWarns.map(function (w) {
      return "<li>" + esc(w.id) + " (PN " + w.pn + ", about " + fmt(w.limit_m, 0) + " m): static " + fmt(w.static_m, 0) + " m, computed " + fmt(w.dynamic_m, 0) + " m.</li>";
    }).join("") + "</ul>Consider a break pressure tank higher up (set a node's type to Break tank). Water hammer is not included.";
  }

  function nodeFlag(n) {
    if (n.type === "B") return n.excess_head === null || n.excess_head === undefined ? "" : (n.excess_head < 0 ? "inlet head below tank level" : "tank removes " + fmt(n.excess_head, 1) + " m");
    return n.type === "R" ? "" : (n.pressure < 0 ? "negative pressure" : (n.pressure < P_LOW ? "low pressure" : ""));
  }
  function cls(flag) { return /^tank removes/.test(flag) ? "ok" : (/negative|below tank/.test(flag) ? "bad" : (flag ? "warn" : "")); }
  function pipeFlags(p) {
    var f = [];
    if (Math.abs(p.velocity) > V_HIGH) f.push("high velocity");
    pressWarns.forEach(function (w) { if (w.id === p.id) f.push("above PN " + w.pn + " rating"); });
    return f.join("; ");
  }

  function renderResults() {
    var nr = $("nodeRes"), pr = $("pipeRes");
    if (!result) { nr.innerHTML = ""; pr.innerHTML = "<tr><td class='txt'>No results yet.</td></tr>"; return; }
    var h = "<tr><th>Node</th><th>Head (m)</th><th>Pressure (m)</th><th>Net outflow (L/s)</th><th class='txt'>Check</th></tr>";
    result.nodes.forEach(function (n) {
      var f = nodeFlag(n), pressure = n.type === "J" ? fmt(n.pressure, 2) : "";
      h += "<tr><td>" + esc(n.id) + "</td><td>" + fmt(n.head, 2) + "</td><td class='" + (n.type === "J" ? cls(f) : "") + "'>" + pressure +
        "</td><td>" + (n.type === "J" ? "" : fmt(n.net_outflow_lps, 2)) + "</td><td class='txt " + cls(f) + "'>" + f + "</td></tr>";
    });
    nr.innerHTML = h;
    var hasK = net.pipes.some(function (p) { return p.minor > 0; });
    h = "<tr><th>Pipe</th><th>Flow (L/s)</th><th class='txt'>Direction</th><th>Velocity (m/s)</th><th>Headloss (m)</th>" +
      (hasK ? "<th>of which fittings (m)</th>" : "") + "<th>Slope (m/km)</th><th class='txt'>Check</th></tr>";
    result.pipes.forEach(function (p, i) {
      var src = net.pipes[i], f = pipeFlags(p);
      h += "<tr><td>" + esc(p.id) + "</td><td>" + fmt(p.flow_lps, 3) + "</td><td class='txt'>" +
        (p.flow_lps >= 0 ? esc(src.from) + " \u2192 " + esc(src.to) : esc(src.to) + " \u2192 " + esc(src.from)) +
        "</td><td>" + fmt(Math.abs(p.velocity), 2) + "</td><td>" + fmt(p.headloss, 3) + "</td>" +
        (hasK ? "<td>" + fmt(Math.abs(p.headloss_minor), 3) + "</td>" : "") + "<td>" + fmt(p.hl_per_km, 2) +
        "</td><td class='txt " + (f ? "warn" : "") + "'>" + esc(f) + "</td></tr>";
    });
    pr.innerHTML = h;
  }

  /* ---------- schematic: constant pixel sizes; wheel zooms, drag pans (2D) or rotates (3D); scrolls both ways ---------- */
  var view3d = { on: false, az: -35, tilt: 55, vexag: null, heads: true };
  var disp = {}, PAD = 60; // disp: node id -> position in the current drawing (svg user units)

  function drawSchematic(anchor) {
    var box = $("schematic");
    if (!net.nodes.length) { box.innerHTML = ""; disp = {}; return; }
    var sl = box.scrollLeft, stp = box.scrollTop, is3 = view3d.on, i;
    var az = view3d.az * Math.PI / 180, ca = Math.cos(az), sa = Math.sin(az);
    var ph = view3d.tilt * Math.PI / 180, cp = Math.cos(ph), sp = Math.sin(ph);
    var xs = net.nodes.map(function (n) { return n.x; }), ys = net.nodes.map(function (n) { return n.y; }), zs = net.nodes.map(function (n) { return n.elev; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var zMin = Math.min.apply(null, zs), zMax = Math.max.apply(null, zs);
    if (result) result.pipes.forEach(function (p) { zMax = Math.max(zMax, p.head_from, p.head_to); });
    var e = 1;
    if (is3) {
      var span = Math.max(maxX - minX, maxY - minY, 1), zr = Math.max(zMax - zMin, 1);
      e = view3d.vexag || Math.min(60, Math.max(1, Math.round(0.4 * span / zr)));
      $("vexag").value = e; $("vexagVal").textContent = "\u00d7" + e;
    }
    // orthographic projection: rotate about the vertical axis, tilt, exaggerate elevation
    function proj(x, y, z) {
      if (!is3) return { x: x, y: y, d: 0 };
      var xr = x * ca - y * sa, yr = x * sa + y * ca;
      return { x: xr, y: yr * sp - z * e * cp, d: yr * cp + z * e * sp };
    }
    function lift(P, dz) { return { x: P.x, y: P.y - dz * e * cp }; }
    var G = {}, byId = {};
    net.nodes.forEach(function (n) { byId[n.id] = n; G[n.id] = proj(n.x, n.y, n.elev); disp[n.id] = { x: G[n.id].x, y: G[n.id].y }; });
    var showH = is3 && view3d.heads && !!result;
    var base = is3 ? [proj(minX, minY, zMin), proj(maxX, minY, zMin), proj(maxX, maxY, zMin), proj(minX, maxY, zMin)] : [];
    var pts = [];
    net.nodes.forEach(function (n) { pts.push(G[n.id]); });
    base.forEach(function (q) { pts.push(q); });
    var tops = {};
    if (showH) result.pipes.forEach(function (r, k) {
      var p = net.pipes[k], a = byId[p.from], b = byId[p.to]; if (!a || !b) return;
      tops[k] = [lift(G[a.id], r.head_from - a.elev), lift(G[b.id], r.head_to - b.elev)];
      pts.push(tops[k][0], tops[k][1]);
    });
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    pts.forEach(function (q) { minU = Math.min(minU, q.x); maxU = Math.max(maxU, q.x); minV = Math.min(minV, q.y); maxV = Math.max(maxV, q.y); });
    var bw = Math.max(maxU - minU, 1), bh = Math.max(maxV - minV, 1), minLen = Infinity;
    net.pipes.forEach(function (p) {
      var a = G[p.from], b = G[p.to];
      if (a && b) { var d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 1e-9 && d < minLen) minLen = d; }
    });
    var availW = Math.max(320, box.clientWidth - 4), availH = Math.max(260, box.clientHeight - 4);
    var fit = Math.min((availW - 2 * PAD) / bw, (availH - 2 * PAD) / bh);
    var readable = isFinite(minLen) ? Math.min(90 / minLen, fit * 6) : 0; // shortest pipe at least ~90 px, but not absurdly large
    var s = Math.max(fit, readable) * zoom; if (!(s > 0)) s = 1;
    var fs = 12 / s; viewFs = fs;
    var vx = minU - PAD / s, vy = minV - PAD / s, vw = bw + 2 * PAD / s, vh = bh + 2 * PAD / s;
    var badLen = {}, badPress = {};
    lenWarns.forEach(function (w) { badLen[w.id] = true; });
    pressWarns.forEach(function (w) { badPress[w.id] = true; });
    var qmax = result ? Math.max.apply(null, result.pipes.map(function (p) { return Math.abs(p.flow_lps); }).concat([1e-9])) : 1;
    var out = '<svg width="' + Math.round(vw * s) + '" height="' + Math.round(vh * s) + '" viewBox="' + [vx, vy, vw, vh].join(" ") +
      '" role="img" aria-label="Network schematic. Hover or tap a node or pipe for its head.">', labels = "";
    if (is3) {
      out += '<polygon style="fill:var(--grid);stroke:var(--line)" stroke-width="' + fs * 0.08 + '" points="' + base.map(function (q) { return q.x + "," + q.y; }).join(" ") + '"/>';
      net.nodes.forEach(function (n) { // drop lines to the base plane show the elevation
        var b0 = proj(n.x, n.y, zMin);
        if (Math.hypot(b0.x - G[n.id].x, b0.y - G[n.id].y) > fs * 0.5)
          out += '<line x1="' + G[n.id].x + '" y1="' + G[n.id].y + '" x2="' + b0.x + '" y2="' + b0.y + '" style="stroke:var(--muted)" stroke-width="' + fs * 0.06 + '" stroke-dasharray="' + fs * 0.25 + " " + fs * 0.25 + '" opacity="0.5"/>';
      });
    }
    var items = [];
    net.pipes.forEach(function (p, i) { var a = G[p.from], b = G[p.to]; if (a && b) items.push({ p: p, i: i, a: a, b: b, d: (a.d + b.d) / 2 }); });
    if (is3) items.sort(function (u, v) { return u.d - v.d; });
    items.forEach(function (it) {
      var p = it.p, a = it.a, b = it.b, r = result ? result.pipes[it.i] : null;
      var wdt = r ? fs * (0.18 + 0.5 * Math.abs(r.flow_lps) / qmax) : fs * 0.2;
      var col = (badLen[p.id] || badPress[p.id]) ? "var(--bad)" : (r ? "var(--flow)" : "var(--muted)");
      out += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" style="stroke:' + col + '" stroke-width="' + wdt + '"' +
        (badLen[p.id] ? ' stroke-dasharray="' + fs * 0.8 + " " + fs * 0.5 + '"' : "") + ' stroke-linecap="round" opacity="0.85"/>';
      if (tops[it.i]) { // hydraulic grade line above the pipe, with vertical lines showing the pressure head at each end
        var t0 = tops[it.i][0], t1 = tops[it.i][1];
        out += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + t0.x + '" y2="' + t0.y + '" style="stroke:var(--accent)" stroke-width="' + fs * 0.08 + '" opacity="0.6"/>' +
          '<line x1="' + b.x + '" y1="' + b.y + '" x2="' + t1.x + '" y2="' + t1.y + '" style="stroke:var(--accent)" stroke-width="' + fs * 0.08 + '" opacity="0.6"/>' +
          '<line x1="' + t0.x + '" y1="' + t0.y + '" x2="' + t1.x + '" y2="' + t1.y + '" style="stroke:var(--accent)" stroke-width="' + fs * 0.14 + '" stroke-dasharray="' + fs * 0.5 + " " + fs * 0.3 + '"/>';
      }
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (r && Math.abs(r.flow_lps) > 1e-9) {
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, sgn = r.flow_lps >= 0 ? 1 : -1;
        var ux = sgn * dx / len, uy = sgn * dy / len, ah = fs * 0.9;
        out += '<polygon style="fill:var(--ink)" points="' + [mx + ux * ah, my + uy * ah, mx - ux * ah * 0.6 - uy * ah * 0.6, my - uy * ah * 0.6 + ux * ah * 0.6, mx - ux * ah * 0.6 + uy * ah * 0.6, my - uy * ah * 0.6 - ux * ah * 0.6].join(" ") + '"/>';
      }
      labels += '<text x="' + mx + '" y="' + (my - fs * 1.1) + '" font-size="' + fs * 0.85 + '" text-anchor="middle" style="fill:var(--muted)">' + esc(p.id) + (r ? " \u00b7 " + fmt(Math.abs(r.flow_lps), 1) + " L/s" : "") + '</text>';
    });
    var order = net.nodes.map(function (n, i) { return i; });
    if (is3) order.sort(function (u, v) { return G[net.nodes[u].id].d - G[net.nodes[v].id].d; });
    order.forEach(function (i) {
      var n = net.nodes[i], P = G[n.id], rn = result ? result.nodes[i] : null, color = "var(--muted)", rr = fs * 0.75, label = esc(n.id);
      if (n.type === "J" && rn) { color = rn.pressure < 0 ? "var(--bad)" : (rn.pressure < P_LOW ? "var(--warn)" : "var(--ok)"); label += " \u00b7 " + fmt(rn.pressure, 1) + " m"; }
      if (n.type === "R") color = "var(--ink)";
      if (n.type === "B") { color = "var(--accent)"; if (rn && rn.excess_head !== null && rn.excess_head !== undefined) label += " \u00b7 \u2212" + fmt(Math.max(rn.excess_head, 0), 1) + " m"; }
      if (n.type === "J") out += '<circle cx="' + P.x + '" cy="' + P.y + '" r="' + rr + '" style="fill:' + color + '"/>';
      else if (n.type === "R") out += '<rect x="' + (P.x - rr) + '" y="' + (P.y - rr) + '" width="' + 2 * rr + '" height="' + 2 * rr + '" style="fill:' + color + '"/>';
      else out += '<polygon style="fill:' + color + '" points="' + [P.x, P.y - rr * 1.35, P.x + rr * 1.35, P.y, P.x, P.y + rr * 1.35, P.x - rr * 1.35, P.y].join(" ") + '"/>';
      labels += '<text x="' + P.x + '" y="' + (P.y + fs * 2.2) + '" font-size="' + fs + '" text-anchor="middle" style="fill:var(--ink)" font-weight="600">' + label + '</text>';
    });
    box.innerHTML = out + labels + "</svg>";
    if (anchor) { // keep the point under the cursor fixed while zooming
      box.scrollLeft = (sl + anchor.mx - PAD) * anchor.f + PAD - anchor.mx;
      box.scrollTop = (stp + anchor.my - PAD) * anchor.f + PAD - anchor.my;
    } else { box.scrollLeft = sl; box.scrollTop = stp; }
  }

  function zoomBy(f0, mx, my) {
    var nz = Math.max(0.2, Math.min(12, zoom * f0)), f = nz / zoom;
    if (f === 1) return;
    zoom = nz; drawSchematic({ f: f, mx: mx, my: my });
  }
  $("zoomIn").addEventListener("click", function () { var b = $("schematic"); zoomBy(1.25, b.clientWidth / 2, b.clientHeight / 2); });
  $("zoomOut").addEventListener("click", function () { var b = $("schematic"); zoomBy(1 / 1.25, b.clientWidth / 2, b.clientHeight / 2); });
  $("zoomFit").addEventListener("click", function () { zoom = 1; view3d.az = -35; view3d.tilt = 55; view3d.vexag = null; var b = $("schematic"); drawSchematic(); b.scrollLeft = 0; b.scrollTop = 0; });
  $("schematic").addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var dy = (ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY), r = this.getBoundingClientRect();
    zoomBy(Math.exp(-Math.max(-200, Math.min(200, dy)) * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  function setMode(on) {
    view3d.on = on; zoom = 1;
    $("mode2d").setAttribute("aria-pressed", String(!on)); $("mode3d").setAttribute("aria-pressed", String(on));
    $("ctl3d").hidden = !on; $("schematic").style.cursor = "grab";
    drawSchematic(); var b = $("schematic"); b.scrollLeft = 0; b.scrollTop = 0; hideTip();
  }
  $("mode2d").addEventListener("click", function () { setMode(false); });
  $("mode3d").addEventListener("click", function () { setMode(true); });
  $("vexag").addEventListener("input", function () { view3d.vexag = +this.value; drawSchematic(); });
  $("showHgl").addEventListener("change", function () { view3d.heads = this.checked; drawSchematic(); });
  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { drawSchematic(); }, 150); });

  // drag: pans the 2D plan, rotates the 3D view
  var raf = 0;
  (function () {
    var box = $("schematic");
    box.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, sl: box.scrollLeft, st: box.scrollTop, az: view3d.az, tilt: view3d.tilt, moved: false };
      try { box.setPointerCapture(ev.pointerId); } catch (x) { /* not critical */ }
    });
    box.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; hideTip(); box.style.cursor = "grabbing";
      if (view3d.on) {
        view3d.az = drag.az + dx * 0.4; view3d.tilt = Math.max(5, Math.min(90, drag.tilt + dy * 0.3));
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; drawSchematic(); });
      } else { box.scrollLeft = drag.sl - dx; box.scrollTop = drag.st - dy; }
    });
    function end() { drag = null; box.style.cursor = "grab"; }
    box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
    box.style.cursor = "grab";
  })();

  /* ---------- hover / tap: head at a node or along a pipe ---------- */
  function findHit(px, py) {
    var u = viewFs / 12, best = null, bd = Infinity, i; // u = drawing units per screen pixel
    for (i = 0; i < net.nodes.length; i++) {
      var P = disp[net.nodes[i].id]; if (!P) continue;
      var d = Math.hypot(px - P.x, py - P.y) / u;
      if (d <= 11 && d < bd) { bd = d; best = { kind: "node", i: i, x: P.x, y: P.y }; }
    }
    if (best) return best;
    bd = Infinity;
    for (i = 0; i < net.pipes.length; i++) {
      var a = disp[net.pipes[i].from], b = disp[net.pipes[i].to];
      if (!a || !b) continue;
      var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
      var qx = a.x + t * dx, qy = a.y + t * dy, dd = Math.hypot(px - qx, py - qy) / u;
      if (dd <= 9 && dd < bd) { bd = dd; best = { kind: "pipe", i: i, t: t, x: qx, y: qy }; }
    }
    return best;
  }
  function tipHtml(h) {
    var out;
    if (h.kind === "node") {
      var n = net.nodes[h.i], rn = result ? result.nodes[h.i] : null;
      if (n.type === "B") {
        out = "<b>" + esc(n.id) + " (break pressure tank)</b><br>Water level " + fmt(n.elev, 2) + " m";
        if (rn && rn.inlet_head !== null && rn.inlet_head !== undefined) out += "<br>Arriving head " + fmt(rn.inlet_head, 2) + " m<br>Head removed " + fmt(rn.excess_head, 2) + " m<br>Flow through " + fmt(rn.net_outflow_lps, 2) + " L/s";
        return out;
      }
      out = "<b>" + esc(n.id) + (n.type === "R" ? " (reservoir)" : "") + "</b><br>" + (n.type === "R" ? "Water level " : "Ground ") + fmt(n.elev, 2) + " m";
      if (rn) out += "<br>Head " + fmt(rn.head, 2) + " m" + (n.type === "J" ? "<br>Pressure " + fmt(rn.pressure, 2) + " m" : "");
      else out += "<br>Heads appear once the network solves.";
      return out;
    }
    var p = net.pipes[h.i], a = nodeById(p.from), b = nodeById(p.to), r = result ? result.pipes[h.i] : null;
    var ground = a.elev + h.t * (b.elev - a.elev);
    out = "<b>" + esc(p.id) + "</b>, " + Math.round(h.t * 100) + "% from " + esc(p.from) + " (" + fmt(h.t * p.length, 0) + " m along)<br>Ground " + fmt(ground, 2) + " m";
    if (r) {
      var hgl = r.head_from - h.t * (r.head_from - r.head_to);
      out += "<br>Head " + fmt(hgl, 2) + " m<br>Pressure " + fmt(hgl - ground, 2) + " m<br>Flow " + fmt(Math.abs(r.flow_lps), 2) + " L/s" +
        "<br><span class='sub'>Interpolated along a straight pipe</span>";
    } else out += "<br>Heads appear once the network solves.";
    return out;
  }
  function hideTip() {
    $("tip").hidden = true;
    var svg = $("schematic").querySelector("svg"), d = svg && svg.querySelector("#hoverDot");
    if (d) d.remove();
  }
  function onPointer(evt) {
    if (drag && drag.moved) return;
    var svg = $("schematic").querySelector("svg"); if (!svg || !svg.createSVGPoint) return;
    var m = svg.getScreenCTM(); if (!m) return;
    var pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    var sp = pt.matrixTransform(m.inverse()), hit = findHit(sp.x, sp.y);
    if (!hit) { hideTip(); return; }
    var dot = svg.querySelector("#hoverDot");
    if (!dot) { dot = document.createElementNS("http://www.w3.org/2000/svg", "circle"); dot.setAttribute("id", "hoverDot"); dot.setAttribute("fill", "none"); dot.style.stroke = "var(--ink)"; svg.appendChild(dot); }
    dot.setAttribute("cx", hit.x); dot.setAttribute("cy", hit.y); dot.setAttribute("r", viewFs * 1.1); dot.setAttribute("stroke-width", viewFs * 0.25);
    var tip = $("tip"), wrap = tip.parentNode.getBoundingClientRect();
    tip.innerHTML = tipHtml(hit); tip.hidden = false;
    var left = evt.clientX - wrap.left + 14, top = evt.clientY - wrap.top + 14;
    if (left + tip.offsetWidth > wrap.width) left = Math.max(0, evt.clientX - wrap.left - tip.offsetWidth - 14);
    if (top + tip.offsetHeight > wrap.height) top = Math.max(0, evt.clientY - wrap.top - tip.offsetHeight - 14);
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  ["pointermove", "pointerdown"].forEach(function (t) { $("schematic").addEventListener(t, onPointer); });
  $("schematic").addEventListener("pointerleave", hideTip);
  $("schematic").addEventListener("scroll", hideTip);

  function drawConvergence() {
    var box = $("conv");
    if (!result || !result.history.length) { box.innerHTML = "<p class='hint'>Solve a valid network to see the residual history.</p>"; return; }
    var hs = result.history.map(function (e) { return Math.log(Math.max(e, 1e-16)) / Math.LN10; });
    var W = 360, H = 130, L = 40, R = 8, T = 8, B = 24, n = hs.length;
    var lo = Math.floor(Math.min.apply(null, hs)), hi = Math.ceil(Math.max.apply(null, hs.concat([lo + 1])));
    var px = function (i) { return L + (n === 1 ? (W - L - R) / 2 : (W - L - R) * i / (n - 1)); };
    var py = function (v) { return T + (H - T - B) * (hi - v) / (hi - lo); };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Convergence history" style="width:100%;max-width:520px">';
    for (var g = lo; g <= hi; g += Math.max(1, Math.round((hi - lo) / 4))) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + py(g) + '" y2="' + py(g) + '" style="stroke:var(--grid)"/><text x="' + (L - 5) + '" y="' + (py(g) + 4) + '" font-size="10" text-anchor="end" style="fill:var(--muted)">1e' + g + '</text>';
    }
    s += '<polyline fill="none" style="stroke:var(--accent)" stroke-width="2" points="' + hs.map(function (v, i) { return px(i) + "," + py(v); }).join(" ") + '"/>';
    hs.forEach(function (v, i) { s += '<circle cx="' + px(i) + '" cy="' + py(v) + '" r="2.5" style="fill:var(--accent)"/>'; });
    s += '<text x="' + (W / 2) + '" y="' + (H - 6) + '" font-size="10.5" text-anchor="middle" style="fill:var(--muted)">iteration (relative flow change, log scale)</text></svg>';
    box.innerHTML = s;
  }

  /* ---------- verification + help tables ---------- */
  function renderVerify() {
    var t = $("verifyTable");
    var h = "<tr><th>Example</th><th class='txt'>Reference</th><th>Max flow diff (L/s)</th><th>Max head diff (m)</th><th class='txt'>Result</th></tr>";
    window.PRESETS.forEach(function (p) {
      if (!p.expected) return;
      var r = PipeNet.solve(p), dq = 0, dh = 0;
      r.pipes.forEach(function (x) { dq = Math.max(dq, Math.abs(x.flow_lps - p.expected.flows_lps[x.id])); });
      r.nodes.forEach(function (x) {
        dh = Math.max(dh, Math.abs(x.head - p.expected.heads_m[x.id]));
        if (x.type === "B") dh = Math.max(dh, Math.abs(x.inlet_head - p.expected.inlet_heads_m[x.id]));
      });
      var ok = r.converged && dq <= p.expected.tol.flow_lps && dh <= p.expected.tol.head_m;
      h += "<tr><td>" + esc(p.name) + "</td><td class='txt'>" + esc(p.expected.source) + "</td><td>" + dq.toFixed(5) + "</td><td>" + dh.toFixed(4) +
        "</td><td class='txt " + (ok ? "ok" : "bad") + "'>" + (ok ? "pass" : "fail") + " (tolerance " + p.expected.tol.flow_lps + " L/s, " + p.expected.tol.head_m + " m)</td></tr>";
    });
    t.innerHTML = h;
  }
  function renderHelpTables() {
    var h = "<tr><th class='txt'>Material</th><th>C used</th><th>C typical range</th><th>\u03b5 used (mm)</th><th>\u03b5 typical (mm)</th><th class='txt'>Note</th></tr>";
    MATS.forEach(function (m) {
      h += "<tr><td class='txt'>" + esc(m.name) + "</td><td>" + m.C + "</td><td>" + m.Crange + "</td><td>" + m.eps + "</td><td>" + m.epsRange + "</td><td class='txt wrap'>" + esc(m.note) + "</td></tr>";
    });
    $("matTable").innerHTML = h;
    h = "<tr><th class='txt'>Fitting</th><th>K</th></tr>";
    FITS.forEach(function (f) { h += "<tr><td class='txt'>" + esc(f.name) + "</td><td>" + f.K + "</td></tr>"; });
    $("fitTable").innerHTML = h;
  }

  /* ---------- share / export / import ---------- */
  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }
  $("share").addEventListener("click", function () {
    var enc = btoa(unescape(encodeURIComponent(JSON.stringify(net))));
    var url = location.href.split("#")[0] + "#n=" + enc;
    history.replaceState(null, "", url);
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
      function () { $("share").textContent = "Link copied"; setTimeout(function () { $("share").textContent = "Copy share link"; }, 1500); },
      function () { window.prompt("Copy this link:", url); });
  });
  $("exportJson").addEventListener("click", function () { download("network.json", JSON.stringify(net, null, 2), "application/json"); });
  $("importJson").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var obj = JSON.parse(rd.result);
        if (!Array.isArray(obj.nodes) || !Array.isArray(obj.pipes)) throw new Error("File needs 'nodes' and 'pipes' arrays.");
        loadNet(obj, "Imported " + f.name);
      } catch (e) { $("status").className = "status err"; $("status").textContent = "Could not import: " + e.message; }
    };
    rd.readAsText(f); this.value = "";
  });
  $("exportCsv").addEventListener("click", function () {
    if (!result) return;
    var csv = "NODES\nid,type,elevation_m,head_m,pressure_m,demand_lps\n";
    result.nodes.forEach(function (n, i) { csv += [n.id, n.type, net.nodes[i].elev, n.head.toFixed(4), n.pressure.toFixed(4), net.nodes[i].demand || 0].join(",") + "\n"; });
    csv += "\nPIPES\nid,from,to,length_m,diameter_mm,material,roughness,minor_K,pn_bar,flow_lps,velocity_ms,headloss_m\n";
    result.pipes.forEach(function (p, i) { var s = net.pipes[i]; csv += [p.id, s.from, s.to, s.length, s.diam, s.material || "custom", s.rough, s.minor || 0, s.pn || "", p.flow_lps.toFixed(5), p.velocity.toFixed(4), p.headloss.toFixed(4)].join(",") + "\n"; });
    download("results.csv", csv, "text/csv");
  });

  /* ---------- start ---------- */
  var sel = $("preset");
  var o0 = document.createElement("option"); o0.value = "new"; o0.textContent = "New network (starter)"; sel.appendChild(o0);
  window.PRESETS.forEach(function (p, i) { var o = document.createElement("option"); o.value = i; o.textContent = p.name; sel.appendChild(o); });
  sel.addEventListener("change", function () {
    history.replaceState(null, "", location.href.split("#")[0]);
    loadNet(sel.value === "new" ? STARTER : window.PRESETS[+sel.value]);
  });
  renderVerify(); renderHelpTables();
  var start = null;
  if (location.hash.indexOf("#n=") === 0) {
    try { start = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(3))))); } catch (e) { start = null; }
  }
  if (start) loadNet(start, "Loaded from a shared link."); else { sel.value = 5; loadNet(window.PRESETS[5]); }
  window.PipeApp = { net: function () { return net; }, result: function () { return result; }, warns: function () { return { len: lenWarns, press: pressWarns }; },
    update: update, renderEditors: renderEditors, uniqueId: uniqueId, suggestLength: suggestLength, matRough: matRough, nodeById: nodeById, fmt: fmt, esc: esc };
})();
