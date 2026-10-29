/* Steady-state pipe network solver (Todini-Pilati gradient method). Mirrors python/pipenet.py.
   Units in: m, mm, L/s; roughness = C (HW) or mm (DW). Node types: J junction, R reservoir/tank
   (fixed head = elev), B break pressure tank (elev = water level; splits the network). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PipeNet = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var G = 9.80665, Q_MIN = 1e-6, NU_DEFAULT = 1.004e-6, BAR_TO_M = 100000 / (1000 * G);

  function isNum(x) { return typeof x === "number" && isFinite(x); }

  // Split the network at break pressure tanks and work out which side feeds each tank.
  function plan(net) {
    var nodes = net.nodes, pipes = net.pipes, typ = {}, uf = {};
    nodes.forEach(function (n) { typ[n.id] = n.type; if (n.type !== "B") uf[n.id] = n.id; });
    function find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
    pipes.forEach(function (p) { if (typ[p.from] !== "B" && typ[p.to] !== "B") uf[find(p.from)] = find(p.to); });
    var compIndex = {}, comps = [], compOf = {}, bptAdj = {}, pipeComp = {};
    nodes.forEach(function (n) {
      if (n.type === "B") { bptAdj[n.id] = []; return; }
      var r = find(n.id);
      if (compIndex[r] === undefined) { compIndex[r] = comps.length; comps.push({ nodes: [], pipes: [], bpts: [], feeder: null }); }
      comps[compIndex[r]].nodes.push(n.id); compOf[n.id] = compIndex[r];
    });
    pipes.forEach(function (p) {
      var owner = typ[p.from] !== "B" ? p.from : p.to;
      if (typ[owner] === "B") return; // both ends are tanks (reported by validate)
      var ci = compOf[owner]; comps[ci].pipes.push(p.id); pipeComp[p.id] = ci;
      [p.from, p.to].forEach(function (e) {
        if (typ[e] !== "B") return;
        if (comps[ci].bpts.indexOf(e) < 0) comps[ci].bpts.push(e);
        if (bptAdj[e].indexOf(ci) < 0) bptAdj[e].push(ci);
      });
    });
    var errs = [], feeder = {}, order = [], queue = [];
    comps.forEach(function (c, i) {
      if (c.nodes.some(function (id) { return typ[id] === "R"; })) { feeder[i] = null; queue.push(i); }
    });
    while (queue.length) {
      var ci = queue.shift(); order.push(ci);
      comps[ci].bpts.slice().sort().forEach(function (b) {
        if (b === feeder[ci]) return;
        bptAdj[b].slice().sort(function (x, y) { return x - y; }).forEach(function (cj) {
          if (cj === ci) return;
          if (feeder[cj] !== undefined) {
            var m = "Break pressure tank " + b + " is fed from more than one side, or the tanks form a loop.";
            if (errs.indexOf(m) < 0) errs.push(m);
          } else { feeder[cj] = b; queue.push(cj); }
        });
      });
    }
    comps.forEach(function (c, i) {
      if (feeder[i] === undefined) errs.push("No reservoir feeds the part of the network around " + c.nodes[0] + " (check the break pressure tanks).");
      c.feeder = feeder[i] === undefined ? null : feeder[i];
    });
    return { comps: comps, order: order, pipeComp: pipeComp, errors: errs, typ: typ };
  }

  function validate(net) {
    var errs = [], nodes = net.nodes || [], pipes = net.pipes || [];
    var model = String(net.headloss || "HW").toUpperCase();
    var nu = net.viscosity === undefined ? NU_DEFAULT : net.viscosity;
    if (model !== "HW" && model !== "DW") errs.push("Headloss model must be HW or DW.");
    if (model === "DW" && !(isNum(nu) && nu > 0)) errs.push("Viscosity must be a positive number.");
    var ids = {}, typ = {}, nRes = 0, nJun = 0, nBpt = 0;
    nodes.forEach(function (n) {
      var id = String(n.id === undefined || n.id === null ? "" : n.id).trim();
      if (!id) errs.push("A node has an empty ID.");
      else if (ids[id]) errs.push("Duplicate node ID: " + id);
      ids[id] = true; typ[n.id] = n.type;
      if (n.type === "R") nRes++;
      else if (n.type === "J") nJun++;
      else if (n.type === "B") nBpt++;
      else errs.push("Node " + id + ": type must be J (junction), R (reservoir) or B (break pressure tank).");
      if (!isNum(n.elev)) errs.push("Node " + id + ": elevation must be a number.");
      if (n.type === "J" && !isNum(n.demand === undefined ? 0 : n.demand))
        errs.push("Node " + id + ": demand must be a number.");
    });
    if (nRes === 0) errs.push("Add at least one reservoir (fixed-head source).");
    if (nJun + nBpt === 0) errs.push("Add at least one junction.");
    if (!pipes.length) errs.push("Add at least one pipe.");
    var pids = {}, edgesOk = true;
    pipes.forEach(function (p) {
      var pid = String(p.id === undefined || p.id === null ? "" : p.id).trim();
      if (!pid) errs.push("A pipe has an empty ID.");
      else if (pids[pid]) errs.push("Duplicate pipe ID: " + pid);
      pids[pid] = true;
      ["from", "to"].forEach(function (end) {
        if (!ids[p[end]]) { errs.push("Pipe " + pid + ": '" + end + "' node '" + p[end] + "' does not exist."); edgesOk = false; }
      });
      if (p.from === p.to) { errs.push("Pipe " + pid + ": start and end node are the same."); edgesOk = false; }
      else if (typ[p.from] === "B" && typ[p.to] === "B") { errs.push("Pipe " + pid + " joins two break pressure tanks. Put a junction between them."); edgesOk = false; }
      [["length", "length"], ["diam", "diameter"], ["rough", "roughness"]].forEach(function (kv) {
        if (!(isNum(p[kv[0]]) && p[kv[0]] > 0)) errs.push("Pipe " + pid + ": " + kv[1] + " must be a positive number.");
      });
      if (p.minor !== undefined && p.minor !== null && !(isNum(p.minor) && p.minor >= 0))
        errs.push("Pipe " + pid + ": minor loss K must be zero or positive.");
      if (p.pn !== undefined && p.pn !== null && !(isNum(p.pn) && p.pn > 0))
        errs.push("Pipe " + pid + ": pressure rating (PN) must be a positive number.");
    });
    if (!errs.length && edgesOk) { // every node must be reachable from a reservoir
      var adj = {};
      nodes.forEach(function (n) { adj[n.id] = []; });
      pipes.forEach(function (p) { adj[p.from].push(p.to); adj[p.to].push(p.from); });
      var stack = nodes.filter(function (n) { return n.type === "R"; }).map(function (n) { return n.id; });
      var seen = {};
      stack.forEach(function (s) { seen[s] = true; });
      while (stack.length) adj[stack.pop()].forEach(function (m) { if (!seen[m]) { seen[m] = true; stack.push(m); } });
      var lost = nodes.filter(function (n) { return !seen[n.id]; }).map(function (n) { return n.id; });
      if (lost.length) errs.push("Not connected to any reservoir: " + lost.join(", "));
      else if (nBpt) plan(net).errors.forEach(function (m) { errs.push(m); });
    }
    return errs;
  }

  // Signed friction headloss h (m) and slope dh/dq for flow q (m3/s). Returns [h, dh].
  function friction(q, L, D, rough, model, nu) {
    var a = Math.abs(q), r, k, re, f;
    if (model === "HW") {
      r = 10.667 * L / (Math.pow(rough, 1.852) * Math.pow(D, 4.871));
      if (a < Q_MIN) { k = r * Math.pow(Q_MIN, 0.852); return [k * q, k]; }
      return [r * Math.pow(a, 0.852) * q, 1.852 * r * Math.pow(a, 0.852)];
    }
    var kLam = 128 * nu * L / (Math.PI * G * Math.pow(D, 4));
    if (a < Q_MIN) return [kLam * q, kLam];
    re = 4 * a / (Math.PI * D * nu);
    if (re < 2000) return [kLam * q, kLam];
    var lg = Math.log(rough / (3.7 * D) + 5.74 / Math.pow(re, 0.9)) / Math.LN10;
    f = 0.25 / (lg * lg);
    r = f * 8 * L / (Math.PI * Math.PI * G * Math.pow(D, 5));
    return [r * a * q, 2 * r * a];
  }

  // Friction plus minor loss K*v^2/(2g) on the pipe. Returns [h, dh/dq].
  function headloss(q, L, D, rough, model, nu, K) {
    var r = friction(q, L, D, rough, model, nu);
    if (K > 0) {
      var km = 8 * K / (Math.PI * Math.PI * G * Math.pow(D, 4)), a = Math.abs(q);
      if (a >= Q_MIN) { r[0] += km * a * q; r[1] += 2 * km * a; }
      else { r[0] += km * Q_MIN * q; r[1] += km * Q_MIN; }
    }
    return r;
  }

  function solveLinear(A, b) { // Gaussian elimination, partial pivoting
    var n = b.length, i, j, k, p, t;
    for (i = 0; i < n; i++) A[i] = A[i].slice();
    b = b.slice();
    for (k = 0; k < n; k++) {
      p = k;
      for (i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
      if (Math.abs(A[p][k]) < 1e-300) throw new Error("The network equations are singular. Check connectivity.");
      t = A[k]; A[k] = A[p]; A[p] = t; t = b[k]; b[k] = b[p]; b[p] = t;
      for (i = k + 1; i < n; i++) {
        var m = A[i][k] / A[k][k];
        if (m === 0) continue;
        for (j = k; j < n; j++) A[i][j] -= m * A[k][j];
        b[i] -= m * b[k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      t = b[i];
      for (j = i + 1; j < n; j++) t -= A[i][j] * x[j];
      x[i] = t / A[i][i];
    }
    return x;
  }

  // Solve a network that has only J and R nodes (already validated).
  function solveCore(net, opts) {
    opts = opts || {};
    var tol = opts.tol || 1e-9, maxIter = opts.maxIter || 200;
    var model = String(net.headloss || "HW").toUpperCase();
    var nu = net.viscosity === undefined ? NU_DEFAULT : net.viscosity;
    var nodes = net.nodes, pipes = net.pipes, nn = nodes.length, np = pipes.length, i, k;
    var idx = {}, jidx = [], junc = [], head = [], fixedSum = 0, nFixed = 0;
    nodes.forEach(function (n, ix) {
      idx[n.id] = ix; head.push(n.elev);
      if (n.type === "J") { jidx.push(junc.length); junc.push(ix); } else { jidx.push(-1); fixedSum += n.elev; nFixed++; }
    });
    var nj = junc.length;
    junc.forEach(function (ix) { head[ix] = fixedSum / nFixed; });
    var demand = junc.map(function (ix) { return (nodes[ix].demand || 0) / 1000; });
    var ends = pipes.map(function (p) { return [idx[p.from], idx[p.to]]; });
    var L = pipes.map(function (p) { return p.length; });
    var D = pipes.map(function (p) { return p.diam / 1000; });
    var rough = pipes.map(function (p) { return model === "DW" ? p.rough / 1000 : p.rough; });
    var K = pipes.map(function (p) { return p.minor || 0; });
    var Q = D.map(function (d) { return Math.PI * d * d / 4; });
    var history = [], converged = false, it = 0;

    for (it = 1; it <= maxIter; it++) {
      var w = [], f1 = [], f2 = demand.map(function (d) { return -d; });
      var M = [], v = [];
      for (i = 0; i < nj; i++) { M.push(new Array(nj).fill(0)); v.push(0); }
      for (k = 0; k < np; k++) {
        var hd = headloss(Q[k], L[k], D[k], rough[k], model, nu, K[k]);
        w.push(1 / hd[1]);
        var a = ends[k][0], b = ends[k][1], ja = jidx[a], jb = jidx[b];
        f1.push(hd[0] + head[b] - head[a]);
        if (jb >= 0) f2[jb] += Q[k];
        if (ja >= 0) f2[ja] -= Q[k];
        if (ja >= 0) { M[ja][ja] += w[k]; v[ja] -= w[k] * f1[k]; }
        if (jb >= 0) { M[jb][jb] += w[k]; v[jb] += w[k] * f1[k]; }
        if (ja >= 0 && jb >= 0) { M[ja][jb] -= w[k]; M[jb][ja] -= w[k]; }
      }
      var rhs = f2.map(function (x, j) { return x - v[j]; });
      var dH = nj ? solveLinear(M, rhs) : [], dHfull = new Array(nn).fill(0);
      junc.forEach(function (ix, j) { dHfull[ix] = dH[j]; });
      var sumDQ = 0, sumQ = 0;
      for (k = 0; k < np; k++) {
        var dQ = -w[k] * (f1[k] + dHfull[ends[k][1]] - dHfull[ends[k][0]]);
        Q[k] += dQ; sumDQ += Math.abs(dQ);
      }
      for (i = 0; i < nn; i++) head[i] += dHfull[i];
      for (k = 0; k < np; k++) sumQ += Math.abs(Q[k]);
      var err = sumDQ / Math.max(sumQ, 1e-12);
      history.push(err);
      if (err < tol) { converged = true; break; }
    }
    if (it > maxIter) it = maxIter;

    var netOut = new Array(nn).fill(0), outPipes = [], outNodes = [];
    for (k = 0; k < np; k++) {
      var hk = headloss(Q[k], L[k], D[k], rough[k], model, nu, K[k])[0];
      netOut[ends[k][0]] += Q[k]; netOut[ends[k][1]] -= Q[k];
      outPipes.push({ id: pipes[k].id, flow_lps: Q[k] * 1000, velocity: Q[k] / (Math.PI * D[k] * D[k] / 4),
        headloss: hk, hl_per_km: hk / L[k] * 1000,
        headloss_minor: 8 * K[k] * Q[k] * Math.abs(Q[k]) / (Math.PI * Math.PI * G * Math.pow(D[k], 4)),
        head_from: head[ends[k][0]], head_to: head[ends[k][1]] });
    }
    nodes.forEach(function (n, ix) {
      outNodes.push({ id: n.id, type: n.type, head: head[ix], pressure: head[ix] - n.elev,
        demand_lps: n.type === "J" ? (n.demand || 0) : null,
        net_outflow_lps: n.type === "R" ? netOut[ix] * 1000 : null });
    });
    return { converged: converged, iterations: it, history: history, nodes: outNodes, pipes: outPipes };
  }

  function solve(net, opts) {
    var errs = validate(net);
    if (errs.length) { var e = new Error(errs.join("\n")); e.messages = errs; throw e; }
    if (!net.nodes.some(function (n) { return n.type === "B"; })) return solveCore(net, opts);
    var pl = plan(net), nodeBy = {}, pipeBy = {}, outflow = {}, inlet = {}, nodeRes = {}, pipeRes = {};
    var converged = true, iters = 0, hist = [];
    net.nodes.forEach(function (n) { nodeBy[n.id] = n; });
    net.pipes.forEach(function (p) { pipeBy[p.id] = p; });
    pl.order.slice().reverse().forEach(function (ci) { // downstream parts first, so each tank's draw is known
      var c = pl.comps[ci];
      var subNodes = c.nodes.map(function (id) { return Object.assign({}, nodeBy[id]); });
      c.bpts.slice().sort().forEach(function (b) {
        var n = Object.assign({}, nodeBy[b]);
        if (b === c.feeder) { n.type = "R"; n.demand = 0; }               // this part is fed from the tank
        else { n.type = "J"; n.demand = outflow[b] || 0; }                 // the tank draws this much from here
        subNodes.push(n);
      });
      var r = solveCore({ headloss: net.headloss, viscosity: net.viscosity, nodes: subNodes,
        pipes: c.pipes.map(function (id) { return pipeBy[id]; }) }, opts);
      converged = converged && r.converged;
      if (r.iterations >= iters) { iters = r.iterations; hist = r.history; }
      r.nodes.forEach(function (n) {
        if (pl.typ[n.id] === "B") {
          if (n.type === "R") outflow[n.id] = (outflow[n.id] || 0) + n.net_outflow_lps; else inlet[n.id] = n;
        } else nodeRes[n.id] = n;
      });
      r.pipes.forEach(function (p) { pipeRes[p.id] = p; });
    });
    var outNodes = net.nodes.map(function (n) {
      if (n.type !== "B") return nodeRes[n.id];
      var inl = inlet[n.id];
      return { id: n.id, type: "B", head: n.elev, pressure: 0, demand_lps: null, net_outflow_lps: outflow[n.id] || 0,
        inlet_head: inl ? inl.head : null, excess_head: inl ? inl.head - n.elev : null };
    });
    return { converged: converged, iterations: iters, history: hist, nodes: outNodes,
      pipes: net.pipes.map(function (p) { return pipeRes[p.id]; }) };
  }

  function distance3d(a, b) {
    var dz = a.elev - b.elev;
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + dz * dz);
  }

  // Pipes shorter than the straight-line (3D) distance between their end nodes.
  // Longer is fine (bends, climbs). Pipes whose nodes have no real coordinates are skipped.
  function lengthCheck(net) {
    var byId = {}, out = [];
    (net.nodes || []).forEach(function (n) { byId[n.id] = n; });
    (net.pipes || []).forEach(function (p) {
      var a = byId[p.from], b = byId[p.to];
      if (!a || !b || a === b || !isNum(p.length)) return;
      if (![a.x, a.y, a.elev, b.x, b.y, b.elev].every(isNum) || a.autoXY || b.autoXY) return;
      var d = distance3d(a, b);
      if (p.length < d * 0.999) out.push({ id: p.id, from: p.from, to: p.to, length: p.length, min: d });
    });
    return out;
  }

  // Pipes whose pressure exceeds their rating (pn in bar, 1 bar is about 10.2 m of head).
  // Static = no-flow pressure from the highest source level feeding that part of the network;
  // dynamic = from the solved heads. Water hammer is not included.
  function pressureCheck(net, result) {
    var pl = plan(net), elev = {}, res = {}, out = [];
    net.nodes.forEach(function (n) { elev[n.id] = n.elev; });
    result.pipes.forEach(function (p) { res[p.id] = p; });
    var levels = pl.comps.map(function (c) {
      var src = c.nodes.filter(function (id) { return pl.typ[id] === "R"; }).map(function (id) { return elev[id]; });
      if (c.feeder) src.push(elev[c.feeder]);
      return Math.max.apply(null, src);
    });
    net.pipes.forEach(function (p) {
      if (!isNum(p.pn) || p.pn <= 0 || pl.pipeComp[p.id] === undefined) return;
      var limit = p.pn * BAR_TO_M, lv = levels[pl.pipeComp[p.id]], r = res[p.id];
      var stat = Math.max(lv - elev[p.from], lv - elev[p.to]);
      var dyn = Math.max(r.head_from - elev[p.from], r.head_to - elev[p.to]);
      if (Math.max(stat, dyn) > limit) out.push({ id: p.id, pn: p.pn, limit_m: limit, static_m: stat, dynamic_m: dyn });
    });
    return out;
  }

  return { version: 6, solve: solve, validate: validate, lengthCheck: lengthCheck, distance3d: distance3d,
    pressureCheck: pressureCheck, BAR_TO_M: BAR_TO_M };
});
