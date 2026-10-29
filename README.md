# Water Supply Lab: PipeNet

PipeNet is a browser tool for analysing water supply pipe networks. You lay out reservoirs, break pressure tanks, junctions and pipes (in tables, on a schematic, or by clicking on a real map) and it solves flows, heads and pressures. The solver exists in Python and in JavaScript, and both are checked against EPANET.

- **Live page:** https://biswashk920.github.io/water-supply-lab/
- **Repository:** https://github.com/biswashk920/water-supply-lab

## What it does

- Solves flows and nodal heads for looped or branched networks with one or more fixed-head reservoirs (Todini-Pilati gradient method).
- **Headloss:** Hazen-Williams, or Darcy-Weisbach with the Swamee-Jain friction factor (laminar below Re 2000).
- **Pipe materials:** a dropdown fills in a typical C or ε. A built-in guide explains both and how to choose.
- **Minor losses:** add fittings (bends, tees, valves) to a pipe from a list of typical K values, plus an "Other K" field.
- **Break pressure tanks** for gravity systems: a tank resets the head to its own water level, and the page shows how much head it removes.
- **Pressure rating (PN) per pipe**, with a warning when static or computed pressure is above the rating.
- **Pipe length check:** a red warning when a pipe is shorter than the straight-line distance between its end nodes. Picking the end nodes suggests a length 10% over that distance.
- **Schematic:** 2D plan and 3D view (adjustable vertical exaggeration, optional hydraulic grade line). The mouse wheel zooms, drag pans or rotates, and hovering a node or pipe shows its head and pressure.
- **Map mode:** place the network on OpenStreetMap, Esri satellite or OpenTopoMap (see below).
- Input validation (unknown nodes, duplicate IDs, nodes not connected to a reservoir, tanks fed from two sides, non-positive dimensions).
- Share a network as a link, export and import JSON, export results as CSV.

## Map mode

The **Map** button puts the network on a real map.

1. Pick **Reservoir**, **Junction** or **Break tank** and click the map. The click gives the node's position, and its ground elevation is fetched from the Open-Meteo elevation service.
2. Pick **Pipe** and click one node, then the next, to draw pipes. Clicking on continues the chain; click the same node or press Esc to stop.
3. Drag a marker to move a node. Everything stays editable in the Nodes and Pipes tables.
4. Switch the background with the layer button (OpenStreetMap, satellite, topographic).

How it works: each node keeps x and y (metres from the first node you placed, using a local flat-earth projection that is fine over a few kilometres) and elevation. `lat` and `lon` are derived from these and saved with `origin` in the JSON. Files without a map position still load as before. A house can be modelled as a junction.

**Elevations from the map are rough.** The elevation model has a grid of about 90 m, so values can be off by several metres. On a gravity line, where the whole drop may be tens of metres, that can change the results. Use the map to sketch the network quickly, then correct the elevations in the Nodes table with surveyed or GPS levels. A value you type is no longer marked as an estimate.

**Running it from a folder:** OpenStreetMap blocks tile requests that carry no web address (Referer), so if you open `docs/index.html` straight from disk (`file:///...`) the OpenStreetMap layer shows "Access blocked". The satellite and topographic layers still work. To use OpenStreetMap locally, serve the folder:

```bash
cd docs
python -m http.server 8000
# then open http://localhost:8000
```

The published GitHub Pages address works without this. Map mode needs an internet connection for tiles and elevation; without it the rest of the page still works.

## What it does not do

- **No demand calculation.** The tool does not turn population, per-capita use, losses or peak factors into flows. You enter the demand at each junction in L/s (see the next section).
- **Steady state only.** No extended-period simulation, no tanks that fill or drain, no pumps. Valves are only a fixed K (fully open), not controls.
- **No water hammer**, pipe temperature derating or fitting pressure ratings. Pressure ratings are compared with static and computed pressure only.
- **Demand-driven analysis:** demands are met regardless of pressure, so a network can show negative pressures instead of reduced supply.
- **Break pressure tanks** are held at a constant water level. They are not checked for size, overflow or running dry.
- **Minor-loss K** is whatever you enter. The tool does not work out K from bend angle or tee geometry.
- **Map pipes are straight lines** between nodes, with no bend points. Real routes are longer, so adjust the length in the table (the red warning only catches pipes that are too short).
- Not tested on very large networks. The linear solve is a dense Gaussian elimination, fine for tens to a few hundred nodes.
- Not a design tool on its own. Check results against your own tools and codes before relying on them.

## Demand and peak factors

PipeNet solves the network for exactly the demands you type in. It has no peak factor setting, so **whatever case you enter is the case you get**. If you enter average demand, the results are average-day results; if you enter peak-hour demand, they are peak-hour results.

Demand calculation is a separate step, done in a notebook or spreadsheet before you use the tool:

```
average demand (L/s) = population x litres per person per day / 86400
design demand (L/s)  = average demand x (1 + losses) x design factor
```

The design factor is the peak factor for the case you are checking, usually maximum day or peak hour. The values for litres per person per day, losses and peak factors depend on your national or project design standard, so take them from that standard. The numbers below are only to show the arithmetic:

| Item | Example value |
|---|---|
| Population served | 100 |
| Litres per person per day | 45 |
| Average demand | 100 x 45 / 86400 = 0.052 L/s |
| Losses | 15% |
| Peak factor | 3 |
| Design demand | 0.052 x 1.15 x 3 = 0.18 L/s |

**How to use it**

1. In your spreadsheet, work out the design demand for each junction (for a house modelled as a junction, use the persons in that house).
2. Type the result into that node's **Demand (L/s)** in the Nodes table.
3. Read the results for that case.
4. **To change the peak factor**, change it in your spreadsheet, retype the new demands and solve again. To compare cases (for example maximum day and peak hour), save each one with **Export JSON** or **Copy share link** and reopen it later.

Two things to keep in mind. Distribution pipes are normally checked at peak hour, while a transmission main and storage are normally checked at maximum day, so you will usually run more than one case. And peak factors are usually higher for small groups of users, so a single factor applied to every house can understate the peak on a short branch that serves only a few houses.

## Choosing K for a pipe

K is the minor loss coefficient: a number from handbooks that counts how many velocity heads (`v²/2g`) a fitting loses. The tool works out `v²/2g`, and you supply K.

Add up every fitting the water passes through along that pipe, wherever it sits, including those at either end, and count each physical fitting once. You do not pick a junction type for each end.

Example: pipe P1 leaves a tank through a square outlet (K 0.5) and a gate valve (K 0.2), then turns through a 90° short-radius elbow where it meets J1 (K 0.9). P1's Total K is 1.6. The elbow belongs to P1 or to the next pipe, not both. At 10 L/s in a 100 mm pipe, `v²/2g` is 0.083 m, so the fittings lose about 0.13 m, next to 1.66 m of friction over 100 m (Hazen-Williams, C = 140).

EPANET works the same way: K is a property of the pipe, and a junction itself has no loss. At a tee, put the run value on the pipe that continues straight and the branch value on the side pipe. There is no entry for other bend angles (acute or obtuse bends): take K from a handbook and type it into Other K.

## Break pressure tanks

A break pressure tank (BPT) is an open tank on a gravity line. For the pipes below it, the tank is a reservoir fixed at its water level. For the pipes above it, the tank is a demand equal to what the downstream side draws; the head arriving above the tank level is burned off by the float valve. The network is therefore solved in parts, downstream first. Each tank must be fed from one side only. If the arriving head is below the tank level the page says the tank cannot be fed.

Set a node's type to Break tank and its elevation to the water level. In the example "Gravity system with a break pressure tank", change B1 to a Junction to see the pressure rating warnings appear.

## Pipe length check

For each pipe the page computes the straight-line distance between its end nodes, `sqrt(dx² + dy² + dz²)` with `dz` the elevation difference, and warns in red if the entered length is shorter. A pipe can be longer (bends, climbs) but not shorter. It is a warning, not a block: the network still solves using the length you entered, which underestimates headloss for that pipe. A 0.1% tolerance absorbs rounding. Nodes without real coordinates (for example an imported file that has none) are skipped.

## Materials and pressure ratings

Choosing a material fills in a typical value of C (Hazen-Williams) or ε (Darcy-Weisbach, mm); switching formula converts every pipe that has a material, and typing your own number marks the pipe Custom. The values in `docs/materials.js` are typical textbook figures for orientation. The ε for cement-lined ductile iron and the range for concrete are rough guides rather than values from one standard, so use your own standard, the manufacturer's data or measurements for real design.

The pressure rating is chosen per pipe (PN in bar, 1 bar is about 10.2 m of head); no default is set from the material. Static pressure is the no-flow pressure measured from the highest source level feeding that part of the network.

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

Other tests: closed-form single pipe, symmetric loop splits flow evenly, mass balance at every junction, energy consistency along every pipe, Darcy-Weisbach hand calculation, minor loss `K v²/2g`, break tank float-valve behaviour, pressure rating flags with and without the tank, and input validation. The in-page "Verification against EPANET" panel reruns the comparison in your browser.

The page layout, hover, zoom, 3D view and map mode are checked by hand in a browser, not by automated tests. The map projection and elevation lookup are not covered by the Python or Node tests.

The example networks use illustrative numbers, not data from a real system.

## Run it

```bash
# page, without the OpenStreetMap layer: open docs/index.html in a browser
# page, with all map layers: serve the docs folder (see "Map mode")
cd docs && python -m http.server 8000

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

Repository Settings > Pages > Build and deployment > Deploy from a branch > `main`, folder `/docs`. The page then appears at https://biswashk920.github.io/water-supply-lab/.

## Repository layout

```
docs/      the web page: index.html, solver.js, app.js, map.js, style.css, materials.js, presets.js (generated)
python/    pipenet.py, reference solver (same algorithm as solver.js)
data/      example networks with EPANET reference values
tests/     pytest suite and Node test
tools/     generate_expected.py (needs wntr), build_presets.py
```

## References

- Todini, E. and Pilati, S. (1988). A gradient algorithm for the analysis of pipe networks. In *Computer Applications in Water Supply*, Research Studies Press.
- Rossman, L. A. (2000). *EPANET 2 Users Manual*. US EPA.
- Swamee, P. K. and Jain, A. K. (1976). Explicit equations for pipe-flow problems. *Journal of the Hydraulics Division, ASCE*, 102(5).

Map data: OpenStreetMap contributors; satellite imagery Esri, Maxar, Earthstar Geographics; topographic tiles OpenTopoMap (CC-BY-SA); elevations from Open-Meteo.

## License

MIT