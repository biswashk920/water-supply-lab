/* Typical roughness values by pipe material, and typical minor-loss coefficients.
   Textbook ranges for orientation only: use your standard, the manufacturer, or measurements for design. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PIPE_DATA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    version: 6,
    pnOptions: [6, 8, 10, 12.5, 16, 20, 25], // pressure ratings in bar
    materials: [
      { id: "pvc", name: "PVC / uPVC", C: 150, Crange: "140\u2013150", eps: 0.0015, epsRange: "0.0015", note: "Smooth plastic. Many designers use 140 to stay conservative." },
      { id: "hdpe", name: "HDPE / PE", C: 150, Crange: "140\u2013150", eps: 0.0015, epsRange: "0.0015\u20130.007", note: "Smooth plastic. Some references list a higher epsilon for HDPE." },
      { id: "copper", name: "Copper", C: 140, Crange: "130\u2013150", eps: 0.0015, epsRange: "0.0015", note: "Drawn tubing." },
      { id: "steel", name: "Steel, new", C: 140, Crange: "120\u2013150", eps: 0.045, epsRange: "0.045", note: "Commercial or welded steel. C drops quickly if it corrodes." },
      { id: "gi", name: "Galvanized iron (GI)", C: 120, Crange: "100\u2013120", eps: 0.15, epsRange: "0.15", note: "Common for small-diameter service lines. Ages badly." },
      { id: "ductile", name: "Ductile iron, cement-lined", C: 130, Crange: "120\u2013140", eps: 0.1, epsRange: "rough guide", note: "Epsilon here is a rough guide, not from a single standard." },
      { id: "castiron", name: "Cast iron, new", C: 130, Crange: "100\u2013130", eps: 0.26, epsRange: "0.26", note: "Old or tuberculated cast iron can fall far below this." },
      { id: "concrete", name: "Concrete, average", C: 120, Crange: "100\u2013140", eps: 1.0, epsRange: "0.3\u20133", note: "Depends strongly on the finish and joints." }
    ],
    // Typical K values from the EPANET 2 manual (fittings, fully open valves)
    fittings: [
      { name: "Square entrance (reservoir to pipe)", K: 0.5 },
      { name: "Exit into a tank or reservoir", K: 1.0 },
      { name: "Gate valve, fully open", K: 0.2 },
      { name: "Globe valve, fully open", K: 10 },
      { name: "Angle valve, fully open", K: 5 },
      { name: "Swing check valve, fully open", K: 2.5 },
      { name: "Elbow 90\u00b0, short radius", K: 0.9 },
      { name: "Elbow 90\u00b0, medium radius", K: 0.8 },
      { name: "Elbow 90\u00b0, long radius", K: 0.6 },
      { name: "Elbow 45\u00b0", K: 0.4 },
      { name: "Return bend 180\u00b0", K: 2.2 },
      { name: "Tee, flow through the run", K: 0.6 },
      { name: "Tee, flow through the branch", K: 1.8 }
    ]
  };
});
