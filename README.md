# Water Supply Lab (PipeNet)

PipeNet is a small tool for working out how water moves through a pipe network. You draw the network, it tells you the flow in each pipe and the head and pressure at each node. It runs in the browser, so there is nothing to install.

I made it mainly with gravity-fed village schemes in mind: a tank high up, a line of pipes running downhill, a few break pressure tanks to keep the pressure sane. But it works for any looped or branched network that is fed from one or more fixed-level reservoirs.

- Live page: https://biswashk920.github.io/water-supply-lab/
- Code: https://github.com/biswashk920/water-supply-lab

## What you can do with it

You can build a network in three ways, and mix them freely: type nodes and pipes into the tables, look at them on a 2D or 3D schematic, or click them onto a real map.

For each pipe you pick a material (which fills in a typical roughness), a diameter, a length, and any fittings it passes through, such as bends, tees and valves. You can set a pressure rating (PN) on each pipe and the page warns you if the pressure goes above it. Headloss uses either Hazen-Williams or Darcy-Weisbach, whichever you prefer.

Some other things it does:

- Break pressure tanks. A tank resets the head to its own water level, and the page shows how much head it threw away.
- Warns in red if a pipe is shorter than the straight-line distance between its two end nodes, which can't be right. When you pick the end nodes it suggests a length 10% longer than that distance.
- Hover over a node or a pipe to see its head and pressure.
- Save and share: copy a link to your network, or export and import it as JSON. Results can be exported as CSV.
- Checks your input before solving, for example duplicate IDs, nodes with no connection to a reservoir, or a tank fed from both sides.

## Drawing on a map

Press **Map**, choose Reservoir, Junction or Break tank, and click where it goes. The node gets its position from your click, and its elevation is looked up from the Open-Meteo elevation service. Then choose **Pipe** and click one node and then the next to join them. Keep clicking to carry on along a line; press Esc or click the same node again to stop. You can drag any marker to move it, and everything can still be edited in the tables afterwards.

The map can be switched between OpenStreetMap, Esri satellite and OpenTopoMap with the layer button.

Please don't trust the elevations from the map. The elevation data is on a grid of roughly 90 m, so a value can easily be several metres out. On a gravity line, where the total drop might only be a few tens of metres, that is enough to change the answer. The idea is to sketch the network quickly on the map and then correct the elevations in the Nodes table with levels from a survey or a GPS. Once you type a value yourself, it is no longer treated as an estimate.

Inside the tool every node keeps x and y in metres, measured from the first node you placed, plus its elevation. Latitude and longitude are worked out from those and saved in the JSON next to an `origin`. The flat-earth conversion is fine over a few kilometres. Files saved before the map existed still open normally.

**Opening it from your own computer.** OpenStreetMap refuses tile requests that come from a page opened straight from disk (`file:///...`), and shows "Access blocked". The satellite and topographic layers are fine. To get OpenStreetMap working locally, serve the folder instead:

```bash
cd docs
python -m http.server 8000
# open http://localhost:8000
```

The GitHub Pages link works without any of this. Map mode does need an internet connection for the tiles and elevations; the rest of the page doesn't.

## What it doesn't do

- It doesn't work out demand. You type the flow at each junction in L/s. More on that below.
- It is steady state only. No pumps, no tanks filling and emptying over a day, no valves acting as controls (a valve is just a fixed K, fully open).
- It ignores water hammer, and temperature effects on the pipe.
- It assumes every demand is met whatever the pressure. If the network can't really deliver, you will see negative pressures rather than reduced supply.
- A break pressure tank is held at a constant level. The tool doesn't check whether it is big enough or whether it would overflow or run dry.
- You choose K for each fitting yourself. It doesn't work it out from the bend angle or the tee shape.
- Pipes on the map are straight lines between two nodes. A real pipe follows the ground and is longer, so adjust the length in the table.
- I haven't tried it on large networks. The linear solve is a plain dense one, which should be fine for tens to a few hundred nodes.

It is not a replacement for a proper design check. Compare the results with your own calculations and the standards you work to.

## Demand and peak factors

The tool solves the network for the demands you give it, nothing more. There is no peak factor setting. If you type average demand you get average-day results, and if you type peak-hour demand you get peak-hour results.

So the demand work happens before you open the tool, in a notebook or spreadsheet:

```
average demand (L/s) = people x litres per person per day / 86400
design demand (L/s)  = average demand x (1 + losses) x peak factor
```

Which litres-per-person, loss allowance and peak factor to use depends on the standard you are following, so take them from there. The numbers below are only to show the arithmetic:

| | Example |
|---|---|
| People served | 100 |
| Litres per person per day | 45 |
| Average demand | 100 x 45 / 86400 = 0.052 L/s |
| Losses | 15% |
| Peak factor | 3 |
| Design demand | 0.052 x 1.15 x 3 = 0.18 L/s |

To use it: work out the design demand for each junction (if a junction is a single house, use the people in that house), type it into the **Demand (L/s)** column of the Nodes table, and read the results.

If you want to try a different peak factor, change it in your spreadsheet, type the new demands in and solve again. To compare cases such as maximum day and peak hour, save each one with Export JSON or Copy share link so you can open it again later.

Two things to remember. Distribution pipes are usually checked at peak hour, while a transmission main and the storage are usually checked at maximum day, so you will probably run the network more than once. And peak factors are normally higher for small groups of people, so one factor applied to every house can understate the peak on a short branch with only a few houses on it.

## Choosing K for a pipe

K is the loss coefficient for a fitting. The head lost is `K v²/2g`, and you read K from a handbook or from the table in the tool, which uses the typical values from the EPANET manual. The tool works out `v²/2g` for you.

For each pipe, add up every fitting the water goes through, including the ones at either end, and count each physical fitting once. You don't choose a junction type for each end. For example, a pipe that leaves a tank through a square outlet (K 0.5) and a gate valve (K 0.2), and then turns through a 90° short-radius elbow where it meets J1 (K 0.9), has a total K of 1.6. That elbow belongs either to this pipe or to the next one, not to both.

This is the same way EPANET treats it: the loss belongs to the pipe, and a junction on its own has none. At a tee, give the run value to the pipe that carries on straight and the branch value to the side pipe. There is no entry for other bend angles, so look up K in a handbook and type it into Other K.

## Break pressure tanks

A break pressure tank is an open tank on a gravity line. Water comes in, a float valve shuts off to match what is drawn downstream, and the water leaves at the tank's own level, so the pressure starts again from zero.

In the tool, set a node's type to Break tank and its elevation to the water level. Below the tank it behaves like a reservoir at that level. Above it, the tank is treated as a demand equal to whatever the downstream side draws, and any head above the tank level is lost across the float valve. The network is solved in two parts, downstream first. A tank has to be fed from one side only, and if the head arriving is lower than the tank level the page tells you the tank can't be fed.

There is an example network with a break pressure tank. Change B1 to a Junction and you will see the pressure rating warnings come back.

## Materials and roughness

Picking a material fills in a typical C (Hazen-Williams) or ε in mm (Darcy-Weisbach). Switching between the two formulas converts every pipe that has a material. If you type your own number the material changes to Custom. The values in `docs/materials.js` are ordinary textbook numbers, good for orientation only. The ε for cement-lined ductile iron and the range for concrete are rough guides, not figures from one standard, so use your own standard or the manufacturer's data for real work.

PN is in bar, and 1 bar is about 10.2 m of head. There is no default from the material, so you set it per pipe. Static pressure is the no-flow pressure measured from the highest source feeding that part of the network.

The pressure shown when you hover along a pipe is a straight interpolation between its two ends. That is right for friction in a uniform pipe, but a fitting's loss is really local and is spread evenly here, so values close to a fitting are approximate.

## How it is solved

It uses the Todini-Pilati gradient method: Newton's method applied to the continuity and energy equations, reduced to a single linear system in the junction heads on each iteration. Flows start at 1 m/s, like EPANET. The advantage over Hardy-Cross is that you don't have to define loops or start from flows that already balance, which suits a tool where people keep editing the network.

The solver is written twice, once in Python (`python/pipenet.py`) and once in JavaScript (`docs/solver.js`), using the same algorithm.

## Checking it against EPANET

`tools/generate_expected.py` builds each example network in EPANET 2.2 (through WNTR) and stores the answer in the data file. Both the Python and the JavaScript tests compare against those stored values. A break pressure tank is set up in EPANET as two nodes joined by a pressure reducing valve set to 0 m.

| Example | Max flow difference | Max head difference |
|---|---|---|
| Single pipe | < 0.00001 L/s | 0.00007 m |
| Single loop | 0.00001 L/s | 0.00005 m |
| Two loops | 0.00001 L/s | 0.00006 m |
| Gravity village (Darcy-Weisbach) | < 0.00001 L/s | 0.035 m |
| Materials and fittings | 0.00004 L/s | 0.00012 m |
| Gravity system with a break pressure tank | < 0.00001 L/s | 0.0003 m |

The 0.035 m in the Darcy-Weisbach case is inside the 0.05 m tolerance used in the tests, but I haven't tracked down where it comes from. My guess is the viscosity value, or a small difference in how the friction factor is handled. So for Darcy-Weisbach, read the agreement as "close", not "identical".

The other tests cover a single pipe with a known answer, a symmetric loop splitting the flow evenly, mass balance at every junction, energy balance along every pipe, a hand calculation for Darcy-Weisbach, the minor loss formula, the break tank, the pressure rating flags with and without the tank, and input validation. You can also rerun the EPANET comparison in your browser from the "Verification against EPANET" panel on the page.

The page itself (layout, hover, zoom, 3D view and the map) was checked by hand in a browser. There are no automated tests for it, and none for the map projection or the elevation lookup.

The example networks use made-up numbers, not data from a real system.

## Running it

```bash
# page without the OpenStreetMap layer: just open docs/index.html
# page with every map layer: serve the docs folder
cd docs && python -m http.server 8000

# Python tests
pip install -r requirements.txt
pytest

# JavaScript solver against the same reference values
node tests/test_solver_js.js
```

If you change a file in `data/`, regenerate the reference values and the bundled examples:

```bash
python tools/generate_expected.py
python tools/build_presets.py
```

If the page complains about mismatched files, unzip everything into a fresh empty folder and reload with Ctrl+Shift+R. It means your browser or folder still has an older copy of one of the files.

## Putting it on GitHub Pages

In the repository go to Settings > Pages > Build and deployment > Deploy from a branch, then choose `main` and the `/docs` folder. The page appears at https://biswashk920.github.io/water-supply-lab/.

## What's in the repository

```
docs/      the web page: index.html, solver.js, app.js, map.js, style.css, materials.js, presets.js (generated)
python/    pipenet.py, the Python solver
data/      example networks with EPANET reference values
tests/     pytest suite and the Node test
tools/     generate_expected.py (needs wntr), build_presets.py
```

## References

- Todini, E. and Pilati, S. (1988). A gradient algorithm for the analysis of pipe networks. In *Computer Applications in Water Supply*, Research Studies Press.
- Rossman, L. A. (2000). *EPANET 2 Users Manual*. US EPA.
- Swamee, P. K. and Jain, A. K. (1976). Explicit equations for pipe-flow problems. *Journal of the Hydraulics Division, ASCE*, 102(5).

Map data from OpenStreetMap contributors. Satellite imagery by Esri, Maxar and Earthstar Geographics. Topographic tiles by OpenTopoMap (CC-BY-SA). Elevations from Open-Meteo.

## License

MIT