"""Run each network in data/ through EPANET (via WNTR) and store the result as
the "expected" block that both test suites and the in-browser Verify panel use.

    pip install wntr
    python tools/generate_expected.py
"""
import glob
import json
import os
import sys
import wntr

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))
import pipenet

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EPANET_NU = 1.0219e-6  # EPANET's "relative viscosity = 1.0" in m2/s (1.1e-5 ft2/s)


def run_epanet(net):
    """A break pressure tank B becomes junction B (upstream side) and junction B__out (downstream
    side) joined by a pressure reducing valve set to 0 m, so the downstream head equals the tank level."""
    wn = wntr.network.WaterNetworkModel()
    dw = str(net.get("headloss", "HW")).upper() == "DW"
    wn.options.hydraulic.headloss = "D-W" if dw else "H-W"
    wn.options.hydraulic.viscosity = float(net.get("viscosity", 1.004e-6)) / EPANET_NU
    wn.options.hydraulic.accuracy = 1e-6
    wn.options.hydraulic.trials = 200
    plan = pipenet._plan(net) if any(n["type"] == "B" for n in net["nodes"]) else None
    for n in net["nodes"]:
        if n["type"] == "R":
            wn.add_reservoir(n["id"], base_head=n["elev"])
        elif n["type"] == "B":
            wn.add_junction(n["id"], base_demand=0.0, elevation=n["elev"])
            wn.add_junction(n["id"] + "__out", base_demand=0.0, elevation=n["elev"])
            wn.add_valve(n["id"] + "__prv", n["id"], n["id"] + "__out", diameter=0.3, valve_type="PRV",
                         minor_loss=0.0, initial_setting=0.0)
        else:
            wn.add_junction(n["id"], base_demand=n.get("demand", 0) / 1000.0, elevation=n["elev"])
    typ = {n["id"]: n["type"] for n in net["nodes"]}
    for p in net["pipes"]:
        rough = p["rough"] / 1000.0 if dw else p["rough"]  # WNTR uses metres for D-W roughness
        ends = []
        for e in (p["from"], p["to"]):
            if typ[e] == "B" and plan["comps"][plan["pipe_comp"][p["id"]]]["feeder"] == e:
                e = e + "__out"  # this pipe is on the downstream side of the tank
            ends.append(e)
        wn.add_pipe(p["id"], ends[0], ends[1], length=p["length"], diameter=p["diam"] / 1000.0,
                    roughness=rough, minor_loss=float(p.get("minor", 0) or 0))
    res = wntr.sim.EpanetSimulator(wn).run_sim()
    flows = {k: float(v) * 1000.0 for k, v in res.link["flowrate"].iloc[0].items() if not k.endswith("__prv")}
    heads, inlet = {}, {}
    for n in net["nodes"]:
        if n["type"] == "B":
            heads[n["id"]] = float(res.node["head"].iloc[0][n["id"] + "__out"])
            inlet[n["id"]] = float(res.node["head"].iloc[0][n["id"]])
        else:
            heads[n["id"]] = float(res.node["head"].iloc[0][n["id"]])
    return flows, heads, inlet


for path in sorted(glob.glob(os.path.join(ROOT, "data", "*.json"))):
    with open(path) as fh:
        net = json.load(fh)
    net.pop("expected", None)
    flows, heads, inlet = run_epanet(net)
    net["expected"] = {
        "source": f"EPANET 2.2 via WNTR {wntr.__version__}",
        "tol": {"flow_lps": 0.05, "head_m": 0.05},
        "flows_lps": {k: round(v, 5) for k, v in flows.items()},
        "heads_m": {k: round(v, 4) for k, v in heads.items()},
    }
    if inlet:
        net["expected"]["inlet_heads_m"] = {k: round(v, 4) for k, v in inlet.items()}
    with open(path, "w") as fh:
        json.dump(net, fh, indent=2)
        fh.write("\n")
    print("updated", os.path.basename(path))
