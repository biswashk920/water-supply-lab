# PipeNet: build your water system today

An interactive pipe network tool that runs in the browser. Lay out reservoirs, break pressure tanks, junctions and pipes, choose pipe materials and fittings, and watch flows, heads and pressures update, in a 2D plan or a 3D view. The solver is written twice (Python and JavaScript) and both versions are checked against EPANET.

- **Live page:** https://biswashk920.github.io/water-supply-lab/
- **Repository:** https://github.com/biswashk920/water-supply-lab

## What it does

- Solves flows and nodal heads for looped or branched networks with one or more fixed-head reservoirs
- **Break pressure tanks** for gravity systems: a tank resets the head to its own water level, and the page shows how much head it removes
- **Pressure rating (PN) per pipe**, with a warning when static or computed pressure is above the rating
- Headloss: Hazen-Williams, or Darcy-Weisbach with the Swamee-Jain friction factor (laminar below Re 2000)
- Pipe material dropdown that fills in a typical C or ε, with a built-in guide explaining both and how to choose
- Minor losses (bends, tees, valves): add fittings to a pipe from a list of typical K values (from the EPANET manual), shown as removable tags, plus an Other K field
- Schematic with constant-size symbols: the mouse wheel zooms around the cursor, drag pans, and scroll bars work in both directions, so large networks stay readable
- **3D view**: drag to rotate, adjustable vertical exaggeration, and (optionally) the hydraulic grade line above each pipe with vertical lines showing the pressure head at each end
- Hover or tap a node or pipe to see its head, ground level and pressure at that point
- Warns in red when a pipe is shorter than the straight-line distance between its end nodes
- Validates input (unknown nodes, duplicate IDs, nodes not connected to a reservoir, tanks fed from two sides, non-positive dimensions)
- Share a network as a link, export and import JSON, export results as CSV

## Choosing K for a pipe

K is the minor loss coefficient: a number from handbooks that counts how many velocity heads (`v²/2g`) a fitting loses. The tool works out `v²/2g`, and you supply K.

Add up every fitting the water passes through along that pipe, wherever it sits, including those at either end, and count each physical fitting once. You do not pick a junction type for each end.

Example: pipe P1 leaves a tank through a square outlet (K 0.5) and a gate valve (K 0.2), then turns through a 90° short-radius elbow where it meets J1 (K 0.9). P1's Total K is 1.6. The elbow belongs to P1 or to the next pipe, not both. At 10 L/s in a 100 mm pipe, `v²/2g` is 0.083 m, so the fittings lose about 0.13 m, next to 1.66 m of friction over 100 m (Hazen-Williams, C = 140).

EPANET works the same way: K is a property of the pipe, and a junction itself has no loss. At a tee, put the run value on the pipe that continues straight and the branch value on the side pipe. There is no entry for other bend angles (acute or obtuse bends): take K from a handbook and type it into Other K.

## Break pressure tanks

A break pressure tank (BPT) is an open tank on a gravity line. For the pipes below it, the tank is a reservoir fixed at its water level. For the pipes above it, the tank is a demand equal to what the downstream side draws; the head arriving above the tank level is burned off by the float valve. The network is therefore solved in parts, downstream first. Each tank must be fed from one side only. If the arriving head is below the tank level the page says the tank cannot be fed.

Set a node's type to Break tank and its elevation to the water level. In the example "Gravity system with a break pressure tank", change B1 to a Junction to see the pressure rating warnings appear.

## Pipe length check

Node x and y are plan coordinates in metres. For each pipe the page computes the straight-line distance between its end nodes, `sqrt(dx^2 + dy^2 + dz^2)` with `dz` the elevation difference, and warns in red if the entered length is shorter. A pipe can be longer (bends, climbs) but not shorter. It is a warning, not a block: the network still solves using the length you entered, which underestimates headloss for that pipe. A 0.1% tolerance absorbs rounding. Picking a pipe's From and To nodes suggests a length 10% over the straight-line distance. Nodes without real coordinates (for example an imported file that has none) are skipped.

## Materials and pressure ratings

Choosing a material fills in a typical value of C (Hazen-Williams) or ε (Darcy-Weisbach, mm); switching formula converts every pipe that has a material, and typing your own number marks the pipe Custom. The values in `docs/materials.js` are typical textbook figures for orientation. The ε for cement-lined ductile iron and the range for concrete are rough guides rather than values from one standard, so use your own standard, the manufacturer's data or measurements for real design.

The pressure rating is chosen per pipe (PN in bar, 1 bar is about 10.2 m of head); no default is set from the material. Static pressure is the no-flow pressure measured from the highest source level feeding that part of the network. Water hammer is not included.

## Hover heads

Over a node the tooltip shows ground level, head and pressure. Over a pipe it shows the same at that point, interpolating linearly between the two end nodes. That is exact for friction in a uniform pipe, but a fitting's loss is local in reality and is spread evenly here, so treat values near fittings as approximate.

## How it is solved

Todini-Pilati gradient method: Newton's method on the continuity and energy equations, reduced to one linear system in the junction heads per iteration. Flows start at 1 m/s, as EPANET does. Unlike Hardy-Cross it needs no loop definitions or continuity-satisfying initial flows, so it copes with networks the user edits freely.

## Verification

`tools/generate_expected.py` builds each network in `data/` in EPANET 2.2 (through WNTR) and stores the result in the file. A break pressure tank is represented in EPANET by two nodes joined by a pressure reducing valve set to 0 m. Both test suites compare against those stored values.

| Example | Max flow difference | Max head difference |
|---|---|---|
| Single pipe | < 0.00001 L/s | 0.00007 m |
| Single loop | 0.00001 L/s | 0.00005 m |
| Two loops | 0.00001 L/s | 0.00006 m |
| Gravity village (Darcy-Weisbach) | < 0.00001 L/s | 0.035 m |
| Materials and fittings (minor losses) | 0.00004 L/s | 0.00012 m |
| Gravity system with a break pressure tank | < 0.00001 L/s | 0.0003 m |

The 0.035 m difference in the Darcy-Weisbach case is inside the 0.05 m test tolerance. I have not traced its exact source; the likely candidates are the water viscosity constant and small differences in how EPANET and this code treat the friction factor. Treat agreement for Darcy-Weisbach as "close", not "identical".

Other tests: closed-form single pipe, symmetric loop splits flow evenly, mass balance at every junction, energy consistency along every pipe, Darcy-Weisbach hand calculation, minor loss `K v²/2g`, break tank float-valve behaviour, pressure rating flags with and without the tank, and input validation. The in-page "Verification against EPANET" panel reruns the comparison in your browser. The page itself (layout, hover, zoom, 3D) was checked in Chromium by hand-written scripts that are not part of the repository tests.

The example networks use illustrative numbers, not data from a real system.

## Run it

```bash
# page: open docs/index.html in a browser (no build step, no server needed)

# Python tests
pip install -r requirements.txt
pytest

# JavaScript solver against the same references
node tests/test_solver_js.js
```

After editing a file in `data/`, regenerate the references and the bundled presets:

```bash
python tools/generate_expected.py
python tools/build_presets.py
```

If the page shows a message about mismatched files, extract the whole zip into a new empty folder and reload with Ctrl+Shift+R. It means the browser or folder holds an older copy of one of the files.

## Publish with GitHub Pages

Repository Settings > Pages > Build and deployment > Deploy from a branch > `main`, folder `/docs`. The page then appears at https://biswashk920.github.io/water-supply-pipe-network/.

## Limitations

- Steady state only: no extended-period simulation, tanks that fill or drain, or pumps. Valves are only represented by a fixed K (fully open), not as controls
- A break pressure tank is held at a constant water level. It is not checked for being big enough, overflowing, or running dry
- Demand-driven analysis: demands are met regardless of pressure, so a network can show negative pressures instead of reduced supply
- Reservoirs and tanks are fixed-head nodes (head = water level)
- Minor losses are lumped on a pipe by a K value you choose; the tool does not work out K from bend angle or tee geometry
- Pressure ratings are compared with static and computed pressure only. Water hammer, pipe temperature derating and the exact rating of fittings are not considered
- Darcy-Weisbach slope uses a frozen friction factor, and the laminar/turbulent switch at Re 2000 is abrupt (EPANET interpolates between 2000 and 4000). Networks with flows right at that transition may converge slowly or not at all; the page reports non-convergence
- The 3D view is an orthographic projection with exaggerated elevation. It reads x, y and elevation from the node table and does not follow real terrain between nodes
- Not tested on very large networks. The linear solve is a dense Gaussian elimination, fine for tens to a few hundred nodes
- Not a design tool. Check results against your own tools and codes before relying on them

## Repository layout

```
docs/      the web page: index.html, solver.js, app.js, style.css, materials.js, presets.js (generated)
python/    pipenet.py, reference solver (same algorithm as solver.js)
data/      example networks with EPANET reference values
tests/     pytest suite and Node test
tools/     generate_expected.py (needs wntr), build_presets.py
```

## References

- Todini, E. and Pilati, S. (1988). A gradient algorithm for the analysis of pipe networks. In *Computer Applications in Water Supply*, Research Studies Press.
- Rossman, L. A. (2000). *EPANET 2 Users Manual*. US EPA.
- Swamee, P. K. and Jain, A. K. (1976). Explicit equations for pipe-flow problems. *Journal of the Hydraulics Division, ASCE*, 102(5).

## License

MIT
