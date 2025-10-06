# SWMM Comparison App

A browser-based tool for comparing EPA SWMM .inp files. It identifies and visualizes differences between two model versions directly in the browser—no installation or backend required.

Live App: https://meyerd851-lab.github.io/SWMM_Comparison/

Repository: https://github.com/meyerd851-lab/SWMM_Comparison

**Overview**

The SWMM Comparison App highlights added, removed, and changed elements between two models using an interactive table and map interface. It supports geometry, hydraulics, subcatchments, infiltration parameters, and hydrographs, providing both a summary and detailed view of changes.

**Features**

INP File Comparison: Compares two .inp files across all SWMM sections.

Interactive Map: Visualizes added, removed, changed, and unchanged elements with Leaflet basemaps.

Detailed Table View: Shows line-by-line changes with side-by-side popups for each element.

Hydrograph Support: Compares RTK parameters by month and duration bin with delta calculations.

Session Save/Load: Exports or restores comparison sessions via .json files.

Excel Export: Generates a formatted .xlsx summary of all detected differences.

Offline Use: Runs entirely client-side in any modern browser.

**Technologies**

Frontend: HTML, CSS, JavaScript

Mapping: Leaflet.js, proj4.js

Processing: Web Workers

Export: SheetJS (xlsx)

Hosting: GitHub Pages

Pyodide: Allows Python code to execute natively in the browser, letting the app perform complex model comparisons locally on your device without any external processing.
