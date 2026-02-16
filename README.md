# SWMM Comparison App

A browser-based tool for comparing EPA SWMM `.inp` files. It identifies and visualizes differences between two model versions directly in the browser—no installation or backend required.

**Live App:** https://meyerd851-lab.github.io/SWMM_Comparison/

**Repository:** https://github.com/meyerd851-lab/SWMM_Comparison

---

## Overview

The SWMM Comparison App highlights added, removed, and changed elements between two SWMM models using an interactive table and map interface. All processing runs client-side via Pyodide (Python in the browser), so no data leaves your machine.

---

## Features

### Core Comparison
- **Full INP Parsing** — Compares two `.inp` files across 40+ SWMM sections, including project options, hydrology, conveyance, water quality, and geometry.
- **Change Detection** — Identifies added, removed, and changed elements with field-level diff highlighting.
- **Rename Detection** — Heuristic matching detects renamed elements across files.

### Interactive Map
- **Leaflet Visualization** — Color-coded display of added (green), removed (red), changed (orange), and unchanged (gray) elements.
- **Custom Node Shapes** — Distinct markers for Junctions (circles), Storage (squares), Outfalls (triangles), and Dividers (diamonds).
- **Geometry Change Detection** — Flags elements with modified coordinates, vertices, or polygons.
- **CRS Support** — Configurable coordinate reference system via proj4 projection.
- **Configurable Labels** — Toggle labels for nodes, links, and subcatchments.

### Table & Detail Views
- **Grouped Sections** — Sidebar organizes sections into General, Nodes, Links, and Subcatchments groups with change count badges.
- **Sortable & Filterable** — Filter by change type (Added/Removed/Changed) and search by element ID.
- **Detail Modal** — Click any row for a side-by-side field comparison with old → new highlighting.

### Multi-Line Section Support
Specialized parsing and display for complex SWMM data structures:

| Section | Parsing | Detail View |
|---------|---------|-------------|
| **Curves** | Type + X/Y point aggregation | Side-by-side point table with diff highlighting |
| **Timeseries** | Inline data aggregation / external file detection | Date/time/value table with delta calculations |
| **Patterns** | Type + multiplier aggregation (Hourly/Daily/Monthly/Weekend) | Named time-slot table with factor diffs |
| **Transects** | HEC-2 format (NC/X1/GR lines) | Properties table + geometry point comparison |
| **Hydrographs** | Month × Response (Short/Medium/Long) RTK grouping | RTK parameter grid with delta calculations |
| **LID Controls** | Type + layer accumulation (Surface/Soil/Pavement/Storage/Drain/Removals) | Per-layer parameter table with named fields + pollutant removal comparison |

### Infiltration
- **Dynamic Method Detection** — Automatically detects Horton vs. Green-Ampt from `[OPTIONS]` and adjusts column headers accordingly.

### Export & Session Management
- **Excel Export** — Generates a formatted `.xlsx` workbook with all detected differences organized by section.
- **Session Save/Load** — Export or restore comparison sessions via `.json` files for sharing or revisiting later.
- **Shapefile Export** — Export comparison results as shapefiles for use in GIS applications.

---

## Supported Sections

<details>
<summary>Click to expand full section list</summary>

**Project Configuration:** Title, Options, Report, Raingages, Evaporation, Temperature, Adjustments

**Subcatchments & Hydrology:** Subcatchments, Subareas, Infiltration, LID Controls, LID Usage, Aquifers, Groundwater, GWF, Snowpacks, Coverages, Loadings

**Nodes:** Junctions, Outfalls, Dividers, Storage, DWF, Inflows, RDII, Treatment, Coordinates

**Links:** Conduits, Pumps, Orifices, Weirs, Outlets, Cross-Sections, Transects, Streets, Inlets, Inlet Usage, Losses, Vertices

**Water Quality:** Pollutants, Land Uses, Buildup, Washoff

**Time-Varying Data:** Curves, Timeseries, Patterns, Hydrographs (Unit Hydrographs)

**Controls & Metadata:** Controls, Tags, Labels, Polygons

</details>

---

## Technologies

| Component | Technology |
|-----------|-----------|
| Frontend | HTML, CSS, JavaScript (ES modules) |
| Mapping | Leaflet.js, proj4.js |
| Processing | Web Workers + Pyodide (Python in browser) |
| Export | SheetJS (xlsx), shapefile.py |
| Hosting | GitHub Pages |

---

## Project Structure

```
SWMM_Comparison/
├── index.html          # Main application page
├── styles.css          # Application styles
├── js/                 # Frontend JavaScript modules
│   ├── app.js          # Application entry point & file handling
│   ├── state.js        # Shared application state
│   ├── map.js          # Leaflet map rendering & interactions
│   ├── table.js        # Section sidebar & data table rendering
│   ├── ui.js           # Detail modals, dialogs, & export logic
│   ├── utils.js        # Shared utilities (escaping, header labels)
│   └── ShapeMarker.js  # Custom Leaflet marker shapes
├── worker/             # Background processing
│   ├── worker.js       # Web Worker entry point (Pyodide loader)
│   ├── core_web.py     # INP parser, diff engine, rename heuristics
│   └── shapefile.py    # Shapefile generation
└── assets/             # Static assets (icons)
```

---

## Getting Started

1. Open the [live app](https://meyerd851-lab.github.io/SWMM_Comparison/) or serve locally:
   ```bash
   python -m http.server 8001
   ```
2. Select two SWMM `.inp` files (old and new).
3. Click **Compare** — the app parses both files, computes differences, and renders the results.
4. Browse sections in the sidebar, click rows for detail views, or explore changes on the map.

---

## Running Locally

```bash
git clone https://github.com/meyerd851-lab/SWMM_Comparison.git
cd SWMM_Comparison/SWMM_Comparison
python -m http.server 8001
```

Then open `http://localhost:8001` in a modern browser.
