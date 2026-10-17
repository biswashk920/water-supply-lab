"""Steady-state pipe network solver (Todini-Pilati gradient method).

Reference implementation. docs/solver.js mirrors this file, so the browser tool and
the Python code can be checked against the same benchmarks.

Units (input): length m, diameter mm, elevation m, demand L/s,
roughness = Hazen-Williams C (HW) or absolute roughness in mm (DW).
Optional per pipe: "minor" = sum of minor loss coefficients K (headloss K*v^2/2g),
"pn" = pressure rating in bar. Positive pipe flow runs from the "from" node to the "to" node.

Node types: "J" junction (elev = ground level, demand in L/s), "R" reservoir or tank
(fixed head = elev = water level), "B" break pressure tank (elev = water level). A break
pressure tank is a fixed head for the pipes downstream of it, while the pipes upstream
see it as a demand equal to what the downstream side draws; the float valve burns off
the excess head. It splits the network into parts that are solved leaves first.
"""
import math
import numpy as np

G = 9.80665
Q_MIN = 1e-6           # m3/s: below this, headloss is linearised to avoid a zero slope
NU_DEFAULT = 1.004e-6  # m2/s, water at 20 C
BAR_TO_M = 100000.0 / (1000.0 * G)  # metres of water head per bar


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _plan(net):
    """Split the network at break pressure tanks and work out which side feeds each tank."""
    nodes, pipes = net["nodes"], net["pipes"]
    typ = {n["id"]: n["type"] for n in nodes}
    uf = {i: i for i, t in typ.items() if t != "B"}

    def find(x):
        while uf[x] != x:
            uf[x] = uf[uf[x]]
            x = uf[x]
        return x

    for p in pipes:
        if typ[p["from"]] != "B" and typ[p["to"]] != "B":
            uf[find(p["from"])] = find(p["to"])
    comp_index, comps, comp_of = {}, [], {}
    for n in nodes:
        if n["type"] == "B":
            continue
        r = find(n["id"])
        if r not in comp_index:
            comp_index[r] = len(comps)
            comps.append({"nodes": [], "pipes": [], "bpts": set(), "feeder": None})
        comps[comp_index[r]]["nodes"].append(n["id"])
        comp_of[n["id"]] = comp_index[r]
    bpt_adj = {i: set() for i, t in typ.items() if t == "B"}
    pipe_comp = {}
    for p in pipes:
        owner = p["from"] if typ[p["from"]] != "B" else p["to"]
        if typ[owner] == "B":
            continue  # both ends are tanks (reported by validate)
        ci = comp_of[owner]
        comps[ci]["pipes"].append(p["id"])
        pipe_comp[p["id"]] = ci
        for e in (p["from"], p["to"]):
            if typ[e] == "B":
                comps[ci]["bpts"].add(e)
                bpt_adj[e].add(ci)
    errs, feeder_of, order = [], {}, []
    queue = [i for i, c in enumerate(comps) if any(typ[n] == "R" for n in c["nodes"])]
    for i in queue:
        feeder_of[i] = None
    while queue:
        ci = queue.pop(0)
        order.append(ci)
        for b in sorted(comps[ci]["bpts"]):
            if b == feeder_of[ci]:
                continue
            for cj in sorted(bpt_adj[b]):
                if cj == ci:
                    continue
                if cj in feeder_of:
                    msg = f"Break pressure tank {b} is fed from more than one side, or the tanks form a loop."
                    if msg not in errs:
                        errs.append(msg)
                else:
                    feeder_of[cj] = b
                    queue.append(cj)
    for i, c in enumerate(comps):
        if i not in feeder_of:
            errs.append(f"No reservoir feeds the part of the network around {c['nodes'][0]} (check the break pressure tanks).")
        c["feeder"] = feeder_of.get(i)
    return {"comps": comps, "order": order, "pipe_comp": pipe_comp, "errors": errs, "typ": typ}


def validate(net):
    """Return a list of problems (empty list = network is usable)."""
    errs = []
    nodes, pipes = net.get("nodes", []), net.get("pipes", [])
    model = str(net.get("headloss", "HW")).upper()
    if model not in ("HW", "DW"):
        errs.append("Headloss model must be HW or DW.")
    if model == "DW" and not (_num(net.get("viscosity", NU_DEFAULT)) and net.get("viscosity", NU_DEFAULT) > 0):
        errs.append("Viscosity must be a positive number.")
    ids, typ, n_res, n_jun, n_bpt = set(), {}, 0, 0, 0
    for n in nodes:
        nid = str(n.get("id", "")).strip()
        if not nid:
            errs.append("A node has an empty ID.")
        elif nid in ids:
            errs.append(f"Duplicate node ID: {nid}")
        ids.add(nid)
        typ[n.get("id")] = n.get("type")
        if n.get("type") == "R":
            n_res += 1
        elif n.get("type") == "J":
            n_jun += 1
        elif n.get("type") == "B":
            n_bpt += 1
        else:
            errs.append(f"Node {nid}: type must be J (junction), R (reservoir) or B (break pressure tank).")
        if not _num(n.get("elev")):
            errs.append(f"Node {nid}: elevation must be a number.")
        if n.get("type") == "J" and not _num(n.get("demand", 0)):
            errs.append(f"Node {nid}: demand must be a number.")
    if n_res == 0:
        errs.append("Add at least one reservoir (fixed-head source).")
    if n_jun + n_bpt == 0:
        errs.append("Add at least one junction.")
    if not pipes:
        errs.append("Add at least one pipe.")
    pids, edges_ok = set(), True
    for p in pipes:
        pid = str(p.get("id", "")).strip()
        if not pid:
            errs.append("A pipe has an empty ID.")
        elif pid in pids:
            errs.append(f"Duplicate pipe ID: {pid}")
        pids.add(pid)
        for end in ("from", "to"):
            if p.get(end) not in ids:
                errs.append(f"Pipe {pid}: '{end}' node '{p.get(end)}' does not exist.")
                edges_ok = False
        if p.get("from") == p.get("to"):
            errs.append(f"Pipe {pid}: start and end node are the same.")
            edges_ok = False
        elif typ.get(p.get("from")) == "B" and typ.get(p.get("to")) == "B":
            errs.append(f"Pipe {pid} joins two break pressure tanks. Put a junction between them.")
            edges_ok = False
        for key, label in (("length", "length"), ("diam", "diameter"), ("rough", "roughness")):
            if not (_num(p.get(key)) and p[key] > 0):
                errs.append(f"Pipe {pid}: {label} must be a positive number.")
        if p.get("minor") is not None and not (_num(p["minor"]) and p["minor"] >= 0):
            errs.append(f"Pipe {pid}: minor loss K must be zero or positive.")
        if p.get("pn") is not None and not (_num(p["pn"]) and p["pn"] > 0):
            errs.append(f"Pipe {pid}: pressure rating (PN) must be a positive number.")
    if not errs and edges_ok:  # every node must be reachable from a reservoir
        adj = {i: [] for i in ids}
        for p in pipes:
            adj[p["from"]].append(p["to"])
            adj[p["to"]].append(p["from"])
        stack = [n["id"] for n in nodes if n["type"] == "R"]
        seen = set(stack)
        while stack:
            for m in adj[stack.pop()]:
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        lost = [n["id"] for n in nodes if n["id"] not in seen]
        if lost:
            errs.append("Not connected to any reservoir: " + ", ".join(lost))
        elif n_bpt:
            errs.extend(_plan(net)["errors"])
    return errs


def distance_3d(a, b):
    """Straight-line distance (m) between two nodes, using x, y and elevation."""
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["elev"] - b["elev"]) ** 2)


def length_check(net):
    """Pipes shorter than the straight-line distance between their end nodes.

    A pipe can be longer than that (bends, climbs) but never shorter. Returns a list of
    dicts; empty means fine. Pipes whose nodes have no coordinates are skipped.
    """
    by_id = {n.get("id"): n for n in net.get("nodes", [])}
    out = []
    for p in net.get("pipes", []):
        a, b = by_id.get(p.get("from")), by_id.get(p.get("to"))
        if a is None or b is None or a is b or not _num(p.get("length")):
            continue
        if not all(_num(v.get(k)) for v in (a, b) for k in ("x", "y", "elev")):
            continue
        d = distance_3d(a, b)
        if p["length"] < d * 0.999:
            out.append({"id": p["id"], "from": p["from"], "to": p["to"], "length": p["length"], "min": d})
    return out


def _friction(q, L, D, rough, model, nu):
    """Signed friction headloss h (m) and slope dh/dq for flow q (m3/s)."""
    a = abs(q)
    if model == "HW":
        r = 10.667 * L / (rough ** 1.852 * D ** 4.871)
        if a < Q_MIN:
            k = r * Q_MIN ** 0.852
            return k * q, k
        return r * a ** 0.852 * q, 1.852 * r * a ** 0.852
    # Darcy-Weisbach: laminar below Re 2000, Swamee-Jain above (friction factor frozen in the slope)
    k_lam = 128.0 * nu * L / (math.pi * G * D ** 4)
    if a < Q_MIN:
        return k_lam * q, k_lam
    re = 4.0 * a / (math.pi * D * nu)
    if re < 2000.0:
        return k_lam * q, k_lam
    f = 0.25 / math.log10(rough / (3.7 * D) + 5.74 / re ** 0.9) ** 2
    r = f * 8.0 * L / (math.pi ** 2 * G * D ** 5)
    return r * a * q, 2.0 * r * a


def _headloss(q, L, D, rough, model, nu, K=0.0):
    """Friction plus minor loss K*v^2/(2g) on the pipe. Returns (h, dh/dq)."""
    h, dh = _friction(q, L, D, rough, model, nu)
    if K > 0:
        km = 8.0 * K / (math.pi ** 2 * G * D ** 4)
        a = abs(q)
        if a >= Q_MIN:
            h += km * a * q
            dh += 2.0 * km * a
        else:
            h += km * Q_MIN * q
            dh += km * Q_MIN
    return h, dh


def _solve_core(net, tol=1e-9, max_iter=200):
    """Solve a network with only J and R nodes (already validated)."""
    model = str(net.get("headloss", "HW")).upper()
    nu = float(net.get("viscosity", NU_DEFAULT))
    nodes, pipes = net["nodes"], net["pipes"]
    nn, npipe = len(nodes), len(pipes)
    idx = {n["id"]: i for i, n in enumerate(nodes)}
    junc = [i for i, n in enumerate(nodes) if n["type"] == "J"]
    jidx = [-1] * nn
    for k, i in enumerate(junc):
        jidx[i] = k
    nj = len(junc)
    head = np.array([float(n["elev"]) for n in nodes])
    fixed_mean = np.mean([head[i] for i, n in enumerate(nodes) if n["type"] == "R"])
    for i in junc:
        head[i] = fixed_mean
    demand = np.array([float(nodes[i].get("demand", 0)) / 1000.0 for i in junc])
    ends = [(idx[p["from"]], idx[p["to"]]) for p in pipes]
    L = [float(p["length"]) for p in pipes]
    D = [float(p["diam"]) / 1000.0 for p in pipes]
    rough = [float(p["rough"]) / (1000.0 if model == "DW" else 1.0) for p in pipes]
    K = [float(p.get("minor") or 0.0) for p in pipes]  # minor loss coefficient per pipe
    Q = np.array([math.pi * d * d / 4.0 for d in D])  # start at 1 m/s, as EPANET does

    history, converged, it = [], False, 0
    for it in range(1, max_iter + 1):
        h = np.empty(npipe)
        dh = np.empty(npipe)
        for k in range(npipe):
            h[k], dh[k] = _headloss(Q[k], L[k], D[k], rough[k], model, nu, K[k])
        w = 1.0 / dh
        M = np.zeros((nj, nj))
        v = np.zeros(nj)
        f2 = -demand.copy()
        f1 = np.empty(npipe)
        for k, (a, b) in enumerate(ends):
            f1[k] = h[k] + head[b] - head[a]
            ja, jb = jidx[a], jidx[b]
            if jb >= 0:
                f2[jb] += Q[k]
            if ja >= 0:
                f2[ja] -= Q[k]
            if ja >= 0:
                M[ja, ja] += w[k]
                v[ja] -= w[k] * f1[k]
            if jb >= 0:
                M[jb, jb] += w[k]
                v[jb] += w[k] * f1[k]
            if ja >= 0 and jb >= 0:
                M[ja, jb] -= w[k]
                M[jb, ja] -= w[k]
        dH = np.linalg.solve(M, f2 - v) if nj else np.zeros(0)
        dHfull = np.zeros(nn)
        for k, i in enumerate(junc):
            dHfull[i] = dH[k]
        dQ = np.array([-w[k] * (f1[k] + dHfull[b] - dHfull[a]) for k, (a, b) in enumerate(ends)])
        head += dHfull
        Q += dQ
        err = float(np.abs(dQ).sum() / max(np.abs(Q).sum(), 1e-12))
        history.append(err)
        if err < tol:
            converged = True
            break

    net_out = np.zeros(nn)
    out_pipes, out_nodes = [], []
    for k, (a, b) in enumerate(ends):
        hk, _ = _headloss(Q[k], L[k], D[k], rough[k], model, nu, K[k])
        net_out[a] += Q[k]
        net_out[b] -= Q[k]
        out_pipes.append({
            "id": pipes[k]["id"], "flow_lps": Q[k] * 1000.0,
            "velocity": Q[k] / (math.pi * D[k] ** 2 / 4.0),
            "headloss": hk, "hl_per_km": hk / L[k] * 1000.0,
            "headloss_minor": 8.0 * K[k] * Q[k] * abs(Q[k]) / (math.pi ** 2 * G * D[k] ** 4),
            "head_from": head[a], "head_to": head[b],
        })
    for i, n in enumerate(nodes):
        out_nodes.append({
            "id": n["id"], "type": n["type"], "head": head[i],
            "pressure": head[i] - n["elev"],
            "demand_lps": float(n.get("demand", 0)) if n["type"] == "J" else None,
            "net_outflow_lps": net_out[i] * 1000.0 if n["type"] == "R" else None,
        })
    return {"converged": converged, "iterations": it, "history": history,
            "nodes": out_nodes, "pipes": out_pipes}


def solve(net, tol=1e-9, max_iter=200):
    errs = validate(net)
    if errs:
        raise ValueError("\n".join(errs))
    if not any(n["type"] == "B" for n in net["nodes"]):
        return _solve_core(net, tol, max_iter)
    plan = _plan(net)
    comps = plan["comps"]
    node_by = {n["id"]: n for n in net["nodes"]}
    pipe_by = {p["id"]: p for p in net["pipes"]}
    outflow, inlet, node_res, pipe_res = {}, {}, {}, {}
    converged, iters, hist = True, 0, []
    for ci in reversed(plan["order"]):  # tanks' downstream parts first, so their draw is known
        c = comps[ci]
        sub_nodes = [dict(node_by[i]) for i in c["nodes"]]
        for b in sorted(c["bpts"]):
            n = dict(node_by[b])
            if b == c["feeder"]:
                n["type"], n["demand"] = "R", 0          # this part is fed from the tank
            else:
                n["type"], n["demand"] = "J", outflow.get(b, 0.0)  # the tank draws this much from here
            sub_nodes.append(n)
        sub = {"headloss": net.get("headloss", "HW"), "viscosity": net.get("viscosity", NU_DEFAULT),
               "nodes": sub_nodes, "pipes": [pipe_by[i] for i in c["pipes"]]}
        r = _solve_core(sub, tol, max_iter)
        converged = converged and r["converged"]
        if r["iterations"] >= iters:
            iters, hist = r["iterations"], r["history"]
        for n in r["nodes"]:
            if plan["typ"].get(n["id"]) == "B":
                if n["type"] == "R":
                    outflow[n["id"]] = outflow.get(n["id"], 0.0) + n["net_outflow_lps"]
                else:
                    inlet[n["id"]] = n
            else:
                node_res[n["id"]] = n
        for p in r["pipes"]:
            pipe_res[p["id"]] = p
    out_nodes = []
    for n in net["nodes"]:
        if n["type"] == "B":
            inl = inlet.get(n["id"])
            out_nodes.append({
                "id": n["id"], "type": "B", "head": float(n["elev"]), "pressure": 0.0, "demand_lps": None,
                "net_outflow_lps": outflow.get(n["id"], 0.0),
                "inlet_head": inl["head"] if inl else None,
                "excess_head": inl["head"] - n["elev"] if inl else None,
            })
        else:
            out_nodes.append(node_res[n["id"]])
    return {"converged": converged, "iterations": iters, "history": hist,
            "nodes": out_nodes, "pipes": [pipe_res[p["id"]] for p in net["pipes"]]}


def _comp_levels(net, plan):
    elev = {n["id"]: n["elev"] for n in net["nodes"]}
    levels = []
    for c in plan["comps"]:
        src = [elev[i] for i in c["nodes"] if plan["typ"][i] == "R"]
        if c["feeder"]:
            src.append(elev[c["feeder"]])
        levels.append(max(src))
    return levels


def pressure_check(net, result):
    """Pipes whose pressure exceeds their rating ("pn" in bar; 1 bar is about 10.2 m of head).

    Static pressure = no-flow pressure from the highest source water level feeding that part
    of the network. Dynamic = from the solved heads. Water hammer is not included.
    """
    plan = _plan(net)
    levels = _comp_levels(net, plan)
    elev = {n["id"]: n["elev"] for n in net["nodes"]}
    res = {p["id"]: p for p in result["pipes"]}
    out = []
    for p in net["pipes"]:
        pn = p.get("pn")
        if not _num(pn) or pn <= 0 or p["id"] not in plan["pipe_comp"]:
            continue
        limit = pn * BAR_TO_M
        static = max(levels[plan["pipe_comp"][p["id"]]] - elev[p["from"]], levels[plan["pipe_comp"][p["id"]]] - elev[p["to"]])
        r = res[p["id"]]
        dynamic = max(r["head_from"] - elev[p["from"]], r["head_to"] - elev[p["to"]])
        if max(static, dynamic) > limit:
            out.append({"id": p["id"], "pn": pn, "limit_m": limit, "static_m": static, "dynamic_m": dynamic})
    return out
