// Runs the browser solver (docs/solver.js) against the EPANET reference values in data/*.json.
//   node tests/test_solver_js.js
const fs = require("fs"), path = require("path");
const PipeNet = require("../docs/solver.js");
const dir = path.join(__dirname, "..", "data");
let failed = 0;
fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().forEach((f) => {
  const net = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const r = PipeNet.solve(net), e = net.expected;
  let dq = 0, dh = 0;
  r.pipes.forEach((p) => { dq = Math.max(dq, Math.abs(p.flow_lps - e.flows_lps[p.id])); });
  r.nodes.forEach((n) => { dh = Math.max(dh, Math.abs(n.head - e.heads_m[n.id])); if (n.type === "B") dh = Math.max(dh, Math.abs(n.inlet_head - e.inlet_heads_m[n.id])); });
  const ok = r.converged && dq <= e.tol.flow_lps && dh <= e.tol.head_m;
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + f + "  iterations=" + r.iterations +
    "  max|dQ|=" + dq.toFixed(5) + " L/s  max|dH|=" + dh.toFixed(5) + " m");
});

// every material id used in data/ must exist, and its roughness must match the table for that model
const DATA = require("../docs/materials.js");
fs.readdirSync(dir).filter((f) => f.endsWith(".json")).forEach((f) => {
  const net = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  net.pipes.forEach((p) => {
    if (!p.material || p.material === "custom") return;
    const m = DATA.materials.find((x) => x.id === p.material);
    const want = m && (net.headloss === "DW" ? m.eps : m.C);
    if (!m || p.rough !== want) { failed++; console.log("FAIL material " + p.material + " on " + p.id + " in " + f); }
  });
});

// fittings listed on a pipe must add up to the K the solver uses, and names must exist in the table
fs.readdirSync(dir).filter((f) => f.endsWith(".json")).forEach((f) => {
  const net = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  net.pipes.forEach((p) => {
    if (!p.fittings) return;
    let sum = p.extraK || 0, namesOk = true;
    p.fittings.forEach((x) => { sum += x.K * x.n; if (!DATA.fittings.some((t) => t.name === x.name && t.K === x.K)) namesOk = false; });
    if (!namesOk || Math.abs(sum - (p.minor || 0)) > 1e-9) { failed++; console.log("FAIL fittings on " + p.id + " in " + f); }
  });
});

// pipe length check: presets are clean, a short pipe is flagged with the 3D minimum
const base = JSON.parse(fs.readFileSync(path.join(dir, "02_single_loop.json"), "utf8"));
if (PipeNet.lengthCheck(base).length) { failed++; console.log("FAIL length check flags a valid preset"); }
const short = { nodes: [{ id: "R", type: "R", elev: 100, x: 0, y: 0 }, { id: "J", type: "J", elev: 60, demand: 5, x: 90, y: 0 }],
  pipes: [{ id: "P1", from: "R", to: "J", length: 80, diam: 100, rough: 120 }] };
const w = PipeNet.lengthCheck(short);
const lengthOk = w.length === 1 && Math.abs(w[0].min - Math.sqrt(90 * 90 + 40 * 40)) < 1e-9;
short.pipes[0].length = 100;
const okAfter = PipeNet.lengthCheck(short).length === 0;
if (!(lengthOk && okAfter)) failed++;
console.log((lengthOk && okAfter ? "PASS " : "FAIL ") + "pipe length check");

// pressure ratings: the break pressure tank example is within PN 10; remove the tank and pipes are flagged
const bptNet = JSON.parse(fs.readFileSync(path.join(dir, "06_gravity_break_pressure_tank.json"), "utf8"));
const okFlags = PipeNet.pressureCheck(bptNet, PipeNet.solve(bptNet)).length === 0;
const noTank = JSON.parse(JSON.stringify(bptNet)); noTank.nodes.find((n) => n.id === "B1").type = "J";
const flagged = PipeNet.pressureCheck(noTank, PipeNet.solve(noTank)).map((x) => x.id);
const pressOk = okFlags && flagged.includes("P6") && flagged.includes("P4");
if (!pressOk) failed++;
console.log((pressOk ? "PASS " : "FAIL ") + "pressure rating check (flagged without tank: " + flagged.join(",") + ")");
// tank structure errors
const loop = JSON.parse(JSON.stringify(bptNet)); loop.nodes.push({ id: "T2", type: "R", elev: 900, demand: 0 }); loop.pipes.push({ id: "PY", from: "T2", to: "J4", length: 400, diam: 50, rough: 150 });
const twoBpt = PipeNet.validate(loop).some((m) => /more than one side/.test(m));
if (!twoBpt) failed++;
console.log((twoBpt ? "PASS " : "FAIL ") + "tank between two reservoirs (fed from two sides) is rejected");
process.exit(failed ? 1 : 0);
