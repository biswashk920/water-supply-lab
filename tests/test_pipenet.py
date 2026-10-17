import glob
import json
import math
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
import pipenet  # noqa: E402

FILES = sorted(glob.glob(os.path.join(ROOT, "data", "*.json")))


def load(path):
    with open(path) as fh:
        return json.load(fh)


def test_single_pipe_matches_closed_form():
    net = load(os.path.join(ROOT, "data", "01_single_pipe.json"))
    r = pipenet.solve(net)
    q, L, D, C = 0.020, 1000.0, 0.200, 130.0
    h = 10.667 * L * q ** 1.852 / (C ** 1.852 * D ** 4.871)
    assert r["pipes"][0]["flow_lps"] == pytest.approx(20.0, abs=1e-6)
    assert r["pipes"][0]["headloss"] == pytest.approx(h, rel=1e-9)
    assert r["nodes"][1]["head"] == pytest.approx(100.0 - h, abs=1e-6)


def test_symmetric_loop_splits_flow_evenly():
    net = {"headloss": "HW",
           "nodes": [{"id": "R", "type": "R", "elev": 100}, {"id": "A", "type": "J", "elev": 0, "demand": 0},
                     {"id": "B", "type": "J", "elev": 0, "demand": 0}, {"id": "C", "type": "J", "elev": 0, "demand": 0},
                     {"id": "E", "type": "J", "elev": 0, "demand": 30}],
           "pipes": [{"id": "p0", "from": "R", "to": "A", "length": 500, "diam": 300, "rough": 120}]
           + [{"id": i, "from": a, "to": b, "length": 400, "diam": 200, "rough": 110}
              for i, a, b in (("p1", "A", "B"), ("p2", "A", "C"), ("p3", "B", "E"), ("p4", "C", "E"))]}
    f = {p["id"]: p["flow_lps"] for p in pipenet.solve(net)["pipes"]}
    assert f["p1"] == pytest.approx(15.0, abs=1e-6) and f["p2"] == pytest.approx(15.0, abs=1e-6)


@pytest.mark.parametrize("path", FILES, ids=[os.path.basename(p) for p in FILES])
def test_mass_and_energy_balance(path):
    net = load(path)
    r = pipenet.solve(net)
    assert r["converged"]
    flow = {p["id"]: p["flow_lps"] for p in r["pipes"]}
    for n in net["nodes"]:
        if n["type"] != "J":
            continue  # reservoirs and break pressure tanks supply whatever is drawn
        inflow = sum(flow[p["id"]] for p in net["pipes"] if p["to"] == n["id"]) \
            - sum(flow[p["id"]] for p in net["pipes"] if p["from"] == n["id"])
        assert inflow == pytest.approx(n["demand"], abs=1e-6)
    for res in r["pipes"]:  # head at the two ends (the tank's own side for a break pressure tank) minus headloss = 0
        assert res["head_from"] - res["head_to"] == pytest.approx(res["headloss"], abs=1e-6)


@pytest.mark.parametrize("path", FILES, ids=[os.path.basename(p) for p in FILES])
def test_against_epanet(path):
    net = load(path)
    exp, r = net["expected"], pipenet.solve(net)
    for p in r["pipes"]:
        assert abs(p["flow_lps"] - exp["flows_lps"][p["id"]]) <= exp["tol"]["flow_lps"]
    for n in r["nodes"]:
        assert abs(n["head"] - exp["heads_m"][n["id"]]) <= exp["tol"]["head_m"]
        if n["type"] == "B":
            assert abs(n["inlet_head"] - exp["inlet_heads_m"][n["id"]]) <= exp["tol"]["head_m"]


def test_validation_catches_bad_input():
    net = load(os.path.join(ROOT, "data", "02_single_loop.json"))
    net["pipes"].append({"id": "P9", "from": "J4", "to": "Z9", "length": 10, "diam": 100, "rough": 100})
    assert any("does not exist" in e for e in pipenet.validate(net))
    net = load(os.path.join(ROOT, "data", "02_single_loop.json"))
    net["nodes"].append({"id": "J9", "type": "J", "elev": 10, "demand": 1})
    assert any("Not connected" in e for e in pipenet.validate(net))
    net = load(os.path.join(ROOT, "data", "02_single_loop.json"))
    net["nodes"][0]["type"] = "J"
    assert any("reservoir" in e for e in pipenet.validate(net))


def test_dw_matches_hw_style_hand_check():
    # one pipe, Darcy-Weisbach, turbulent: h = f L/D v^2/2g with Swamee-Jain f
    net = {"headloss": "DW", "viscosity": 1.004e-6,
           "nodes": [{"id": "R", "type": "R", "elev": 50}, {"id": "J", "type": "J", "elev": 0, "demand": 10}],
           "pipes": [{"id": "P", "from": "R", "to": "J", "length": 500, "diam": 100, "rough": 0.05}]}
    r = pipenet.solve(net)
    v = 0.010 / (math.pi * 0.1 ** 2 / 4)
    re = v * 0.1 / 1.004e-6
    f = 0.25 / math.log10(0.05e-3 / (3.7 * 0.1) + 5.74 / re ** 0.9) ** 2
    assert r["pipes"][0]["headloss"] == pytest.approx(f * 500 / 0.1 * v * v / (2 * pipenet.G), rel=1e-9)


@pytest.mark.parametrize("path", FILES, ids=[os.path.basename(p) for p in FILES])
def test_example_pipes_are_not_shorter_than_straight_line(path):
    assert pipenet.length_check(load(path)) == []


def test_short_pipe_is_flagged_with_3d_minimum():
    net = {"nodes": [{"id": "R", "type": "R", "elev": 100, "x": 0, "y": 0},
                     {"id": "J", "type": "J", "elev": 60, "demand": 5, "x": 90, "y": 0}],
           "pipes": [{"id": "P1", "from": "R", "to": "J", "length": 80, "diam": 100, "rough": 120}]}
    (w,) = pipenet.length_check(net)
    assert w["id"] == "P1" and w["min"] == pytest.approx(math.sqrt(90 ** 2 + 40 ** 2))
    net["pipes"][0]["length"] = 100  # exactly long enough: 3D distance is 98.5 m
    assert pipenet.length_check(net) == []
    del net["nodes"][0]["x"]  # no coordinates: nothing to check
    net["pipes"][0]["length"] = 1
    assert pipenet.length_check(net) == []


def test_minor_loss_adds_k_v2_over_2g():
    net = {"headloss": "HW",
           "nodes": [{"id": "R", "type": "R", "elev": 100}, {"id": "J", "type": "J", "elev": 0, "demand": 20}],
           "pipes": [{"id": "P", "from": "R", "to": "J", "length": 800, "diam": 150, "rough": 130, "minor": 5.0}]}
    r = pipenet.solve(net)
    q, d = 0.020, 0.150
    hf = 10.667 * 800 * q ** 1.852 / (130 ** 1.852 * d ** 4.871)
    v = q / (math.pi * d * d / 4)
    assert r["pipes"][0]["headloss"] == pytest.approx(hf + 5.0 * v * v / (2 * pipenet.G), rel=1e-9)


def test_negative_minor_loss_is_rejected():
    net = load(os.path.join(ROOT, "data", "05_materials_fittings.json"))
    net["pipes"][0]["minor"] = -1
    assert any("minor loss" in e for e in pipenet.validate(net))


def test_break_pressure_tank_matches_epanet_and_resets_head():
    net = load(os.path.join(ROOT, "data", "06_gravity_break_pressure_tank.json"))
    r = pipenet.solve(net)
    b = next(n for n in r["nodes"] if n["id"] == "B1")
    assert b["head"] == 925.0 and b["pressure"] == 0.0
    assert b["net_outflow_lps"] == pytest.approx(9.0, abs=1e-6)  # what the downstream side draws
    assert b["inlet_head"] == pytest.approx(net["expected"]["inlet_heads_m"]["B1"], abs=0.05)
    flows = {p["id"]: p["flow_lps"] for p in r["pipes"]}
    assert flows["P2"] == pytest.approx(flows["P3"], abs=1e-6)  # float valve: inflow equals outflow


def test_pressure_rating_flags_pipes_only_without_the_tank():
    net = load(os.path.join(ROOT, "data", "06_gravity_break_pressure_tank.json"))
    assert pipenet.pressure_check(net, pipenet.solve(net)) == []
    net["nodes"][2]["type"] = "J"  # B1 -> plain junction: the whole drop now acts on the pipes
    flagged = {x["id"] for x in pipenet.pressure_check(net, pipenet.solve(net))}
    assert {"P4", "P5", "P6"} <= flagged


def test_tank_fed_from_two_sides_is_rejected():
    net = load(os.path.join(ROOT, "data", "06_gravity_break_pressure_tank.json"))
    net["nodes"].append({"id": "T2", "type": "R", "elev": 900, "demand": 0})
    net["pipes"].append({"id": "PY", "from": "T2", "to": "J4", "length": 400, "diam": 50, "rough": 150})
    assert any("more than one side" in e for e in pipenet.validate(net))
