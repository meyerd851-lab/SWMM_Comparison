# core_web.py
# ==============================================================================
# SWMM COMPARISON TOOL - CORE LOGIC
# ==============================================================================
# This module contains the core logic for parsing, analyzing, and comparing
# SWMM (Storm Water Management Model) INP files.
#
# It is designed to be run in a web browser environment (via Pyodide) or
# locally for testing.
#
# KEY SECTIONS:
# 1. Imports and Constants
# 2. INP Parsing Logic (reading the text file)
# 3. Geometry Parsing (extracting coordinates)
# 4. Spatial Analysis (calculating distances, areas)
# 5. Renaming Logic (matching elements between files)
# 6. Comparison Logic (finding differences)
# 7. Public API (entry point for the UI)
# ==============================================================================

from __future__ import annotations
import io, re, json, math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
import zipfile
import shapefile

# ------------------------------------------------------------------------------
# SECTION 1: CONSTANTS
# ------------------------------------------------------------------------------
# Default Coordinate Reference System (CRS) for the map visualization.
# EPSG:3735 is a specific projection (State Plane Ohio South), but the app
# uses proj4js to reproject this to Web Mercator for the map.
MAP_SOURCE_CRS = "EPSG:3735"  # raw XY (feet); project in JS with proj4

SECTION_HEADERS = {
    # --- Project-level / config sections ------------------------------------
    "TITLE": [],  # free text lines

    "OPTIONS": ["Option", "Value"],

    "REPORT": ["Keyword", "Value1", "Value2", "Value3"],

    #"FILES": ["Action", "FileType", "FileName"],  # USE/SAVE, RAINFALL/RUNOFF/etc.

    "RAINGAGES": [
        "Name",       # Name
        "Format",     # INTENSITY / VOLUME / CUMULATIVE
        "Interval",   # Intvl
        "SCF",        # Snow Catch Factor
        "Source",     # TIMESERIES/FILE
        "SourceName", # Tseries or Fname
        "Station",    # Sta (optional)
        "Units",      # IN / MM (optional)
    ],

    "EVAPORATION": [
        "Keyword",    # CONSTANT / MONTHLY / TIMESERIES / TEMPERATURE / FILE / RECOVERY / DRY_ONLY
        "Value1", "Value2", "Value3", "Value4", "Value5", "Value6",
        "Value7", "Value8", "Value9", "Value10", "Value11", "Value12"
    ],

    "TEMPERATURE": [
        "Keyword",    # TIMESERIES / FILE / WINDSPEED / SNOWMELT / ADC
        "Arg1", "Arg2", "Arg3", "Arg4", "Arg5", "Arg6",
        "Arg7", "Arg8", "Arg9", "Arg10", "Arg11", "Arg12"
    ],

    "ADJUSTMENTS": [
        "Variable",   # TEMPERATURE / EVAPORATION / RAINFALL / CONDUCTIVITY
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ],

    # --- Runoff / hydrology --------------------------------------------------
    "SUBCATCHMENTS": [
        "Name",
        "RainGage",    # Rgage
        "Outlet",      # OutID
        "Area",
        "PctImperv",   # %Imperv
        "Width",
        "Slope",
        "CurbLength",  # Clength
        "SnowPack"     # Spack (optional)
    ],

    "SUBAREAS": [
        "Subcatch",
        "N_Imperv",    # Nimp
        "N_Perv",      # Nperv
        "S_Imperv",    # Simp
        "S_Perv",      # Sperv
        "PctZeroStor", # %Zero
        "RouteTo",
        "PctRouted"    # %Routed (optional)
    ],

    "INFILTRATION (HORTON)": [
        "Subcatch",
        "Max. Infil. Rate", "Min. Infil. Rate", "Decay Constant", "Drying Time", "Max Volume",  # interpretation depends on method
        "Method"                       # optional override
    ],

    "LID_CONTROLS": [
        # First line: Name Type
        "Name",
        "Type",        # BC/RG/GR/IT/PP/RB/RD/VS
        # Subsequent SURFACE/SOIL/PAVEMENT/STORAGE/DRAIN/DRAINMAT/REMOVALS
        # lines get parsed separately; if you show them as a grid you may want another view.
    ],

    "LID_USAGE": [
        "Subcatch",
        "LID",
        "Number",
        "Area",
        "Width",
        "InitSat",
        "FromImp",
        "ToPerv",
        "RptFile",
        "DrainTo",
        "FromPerv"
    ],

    "AQUIFERS": [
        "Name",
        "Porosity",    # Por
        "WiltPoint",   # WP
        "FieldCap",    # FC
        "Ks",
        "Kslope",      # Kslp
        "Tslope",      # Tslp
        "ETu",
        "ETs",
        "Seep",
        "BottomElev",  # Ebot
        "InitGWTable", # Egw
        "InitUmc",     # Umc
        "EvapPattern"  # Epat (optional)
    ],

    "GROUNDWATER": [
        "Subcatch",
        "Aquifer",
        "Node",
        "SurfElev",     # Esurf
        "A1", "B1",
        "A2", "B2",
        "A3",
        "Dsw",
        "Egwt",
        "Ebot",
        "Egw",
        "Umc"
    ],

    "GWF": [
        "Subcatch",
        "Expression"    # full math expression string
    ],

    "SNOWPACKS": [
        "Name",
        "Subcatch",    # or * for global
        "Pliquid",
        "Plimit",
        "Sdmelt",
        "Fwfrac",
        "Sfw0",
        "Sfwmax",
        "Farea",
        "Tbase",
        "Fmf", "Umlt",
        "FImin", "FImax"
        # (Snowpack format is a bit more complex; this is a generic superset)
    ],

    # --- Nodes / links / conveyance -----------------------------------------
    "JUNCTIONS": [
        "Name",
        "InvertElev",   # Invert
        "MaxDepth",
        "InitDepth",
        "SurchargeDepth",
        "PondedArea"
    ],

    "OUTFALLS": [
        "Name",
        "InvertElev",
        "Type",         # FREE / NORMAL / FIXED / TIDAL / TIMESERIES / ROUTED
        "StageData",    # fixed elev, tidals, timeseries name, or receiving node
        "TideGate",
        "RouteTo"
    ],

    "DIVIDERS": [
        "Name",
        "Node",         # Inlet node
        "Link",         # Main conduit
        "Type",         # CUTOFF / OVERFLOW / TABULAR / WEIR / CUSTOM
        "Qmin",         # or parameters depending on Type
        "Qmax",
        "P1", "P2", "P3"
    ],

    "STORAGE": [
        "Name",
        "InvertElev",
        "MaxDepth",
        "InitDepth",
        "Shape",        # FUNCTIONAL / TABULAR / CYLINDRICAL / etc.
        "Coeff1",
        "Coeff2",
        "Coeff3",
        "SurfArea",
        "EvapFactor",
        "SeepageRate",
        "Fevap"
    ],

    "CONDUITS": [
        "Name",
        "FromNode",
        "ToNode",
        "Length",
        "Roughness",
        "InOffset",
        "OutOffset",
        "InitFlow",
        "MaxFlow"
    ],

    "PUMPS": [
        "Name",
        "FromNode",
        "ToNode",
        "PumpCurve",
        "Status",       # ON/OFF
        "StartupDepth",
        "ShutoffDepth"
    ],

    "ORIFICES": [
        "Name",
        "FromNode",
        "ToNode",
        "Type",         # SIDE/BOTTOM
        "Offset",
        "OrificeCoeff",
        "FlapGate",
        "OpenCloseTime"
    ],

    "WEIRS": [
        "Name",
        "FromNode",
        "ToNode",
        "Type",         # TRANSVERSE/SIDE/V-NOTCH/...
        "CrestElev",
        "WeirCoeff",
        "FlapGate",
        "EndCon",
        "CdDischarge"   # plus a few extras depending on type; treat as generic last col
    ],

    "OUTLETS": [
        "Name",
        "FromNode",
        "ToNode",
        "Type",         # FUNCTIONAL / TABULAR / etc.
        "Curve",
        "FlapGate",
        "Seepage"
    ],

    "XSECTIONS": [
        "Link",
        "Shape",
        "Geom1",
        "Geom2",
        "Geom3",
        "Geom4",
        "Barrels",
        "CulvertCode"
    ],

    "TRANSECTS": [
        "TransectID",
        "RecordType",   # NC / X1 / GR / etc.
        "Value1", "Value2", "Value3", "Value4", "Value5", "Value6"
    ],

    "STREETS": [
        "Name",
        "Tcrown",
        "Sx",           # gutter slopes
        "Wcurb",
        "Wstreet",
        "Nstreet",
        "Ncurb",
        "Soffset"
    ],

    "INLETS": [
        "Name",
        "Type",         # GRATE/CURB/COMBO/BYPASS/...
        "Param1", "Param2", "Param3", "Param4",
        "Param5", "Param6", "Param7", "Param8"
    ],

    "INLET_USAGE": [
        "Inlet",
        "NodeOrLink",
        "Placement",    # ON_GRADE / ON_SAG / SLOPED / etc.
        "Number",
        "CloggingFactor",
        "LocalDepression",
        "Qmax"
    ],

    "LOSSES": [
        "Link",
        "Kentry",
        "Kexit",
        "Kavg",
        "FlapGate",
        "Seepage"
    ],

    # --- Water quality / land use -------------------------------------------
    "POLLUTANTS": [
        "Name",
        "Units",
        "Crdc",         # Crain
        "Cgw",
        "Crdii",
        "Cinit",
        "Kdecay",
        "SnowOnly",
        "CoPollut",
        "CoFrac"
    ],

    "LANDUSES": [
        "Name",
        "SweepInterval",
        "Availability",
        "LastSweepDays",
        "StreetSweepEff"
    ],

    "COVERAGES": [
        "Subcatch",
        "LandUse",
        "Percent"
    ],

    "BUILDUP": [
        "LandUse",
        "Pollutant",
        "FuncType",     # POWER/EXPONENTIAL/SATURATION/EMC/RATING
        "Coeff1",
        "Coeff2",
        "Coeff3",
        "PerUnit"
    ],

    "WASHOFF": [
        "LandUse",
        "Pollutant",
        "FuncType",     # EXPONENTIAL/EMC/RATING
        "Coeff1",
        "Coeff2",
        "CleanEffic",
        "BMPRemoval"
    ],

    "TREATMENT": [
        "NodeOrOutfall",
        "Pollutant",
        "Expression"
    ],

    # --- External inflows / DWF / RDII / UH ---------------------------------
    "INFLOWS": [
        "Node",
        "Constituent",       # FLOW or pollutant name
        "TimeSeries",
        "Type",
        "Mfactor",
        "Sfactor",
        "Baseline",
        "Pattern"
    ],

    "DWF": [
        "Node",
        "Constituent",  # FLOW or pollutant name
        "Average Value", "Time Pattern 1", "Time Pattern 2", "Time Pattern 3", "Time Pattern 4"
    ],

    "RDII": [
        "Node",
        "UnitHyd",
        "SewerArea"
    ],

    "UNITHYD": [
        "Name",
        "RainGage",
        "Month",
        "Response",     # SHORT/MEDIUM/LONG
        "R", "T", "K"
    ],

    "HYDROGRAPHS": [
        # You’re already handling this specially; this is just a generic header
        "Hydrograph",
        "Month",
        "Response",
        "R",
        "T",
        "K",
        "Dmax",
        "Drecov",
        "Dinit"
    ],

    "LOADINGS": [
        "Subcatch",
        "Pollutant",
        "InitBuildup"
    ],

    # --- Curves, Patterns, Timeseries ---------------------------------------
    "CURVES": [
        "CurveID",
        "X",
        "Y"
    ],

    "TIMESERIES": [
        "Name",
        "Date",
        "Time",
        "Value",
        "FileName"
    ],

    "PATTERNS": [
        "PatternID",
        "Type",         # MONTHLY/DAILY/HOURLY/WEEKEND
        "Factor1", "Factor2", "Factor3", "Factor4",
        "Factor5", "Factor6", "Factor7", "Factor8",
        "Factor9", "Factor10", "Factor11", "Factor12"
    ],

    # --- Controls, Tags, Map / geometry -------------------------------------
    "CONTROLS": [
        # Not really tabular – control rules are free-form:
        "RuleText"
    ],

    "TAGS": [
        "Type",
        "ID",
        "Tag"
    ],

    # Map/geometry sections (often at bottom of file)
    "COORDINATES": [
        "Node",
        "X",
        "Y"
    ],

    "VERTICES": [
        "Link",
        "X",
        "Y"
    ],

    "POLYGONS": [
        "Subcatch",
        "X",
        "Y"
    ],

    # Some project files also include [LABELS], [BACKDROP], etc.; you can add as needed:
    "LABELS": [
        "X",
        "Y",
        "Label",
        "Anchor"
    ],
}

# ==============================================================================
# SECTION 2: INP PARSING LOGIC
# ==============================================================================
# The following classes and functions are responsible for reading the raw text
# of an INP file and converting it into a structured dictionary.
#
# The SWMM INP format is section-based, with headers in brackets like [JUNCTIONS].
# ------------------------------------------------------------------------------

# =========================
# Parsing
# =========================
@dataclass
class INPParseResult:
    """
    Data structure to hold the parsed contents of an INP file.
    
    Attributes:
        sections (Dict): A dictionary where keys are section names (e.g., "JUNCTIONS")
                         and values are dictionaries mapping Element ID -> List of Values.
        headers (Dict):  A dictionary mapping section names to their column headers.
        tags (Dict):     A dictionary mapping Element IDs to their Tag strings.
        descriptions (Dict): A dictionary mapping section names to description comments.
    """
    sections: Dict[str, Dict[str, List[str]]] = field(default_factory=lambda: defaultdict(dict))
    headers: Dict[str, List[str]] = field(default_factory=dict)
    tags: Dict[str, str] = field(default_factory=dict)
    descriptions: Dict[str, str] = field(default_factory=dict)

def _parse_inp_iter(lines) -> INPParseResult:
    """
    Iterates through the lines of an INP file and parses them into a structured result.
    
    Args:
        lines: An iterable of strings (lines from the file).
        
    Returns:
        INPParseResult: The parsed data.
    """
    sections: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    headers: Dict[str, List[str]] = {}
    tags: Dict[str, str] = {}
    descriptions: Dict[str, str] = {}

    current = None  # The current section being parsed (e.g., "JUNCTIONS")
    after_header = False # Flag to track if we are immediately after a section header

    for raw in lines:
        line = raw.rstrip("\n")

        # 1. Check for Section Headers like [JUNCTIONS]
        #    Regex explanation: ^ start of line, \s* optional whitespace, \[ literal bracket,
        #    ([^\]]+) capture group for section name, \] literal bracket, \s* optional whitespace, $ end of line.
        m = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if m:
            current = m.group(1).upper()
            # Initialize headers for this section using defaults if available
            headers.setdefault(current, SECTION_HEADERS.get(current, []).copy())
            descriptions.setdefault(current, "")
            after_header = True
            continue

        if current is None:
            continue

        # 2. Capture Description Comments
        #    Some sections have a description line starting with a semicolon immediately after the header.
        if after_header:
            if line.lstrip().startswith(";") and not line.lstrip().startswith(";;"):
                descriptions[current] = line.lstrip("; ").strip()
                after_header = False
                continue
            elif line.strip() != "":
                after_header = False

        if not line.strip():
            continue

        # 3. Skip Ordinary Comments
        #    Lines starting with ; are comments, unless they are special header lines (;;)
        if line.lstrip().startswith(";") and not line.lstrip().startswith(";;"):
            continue

        # 4. Parse Custom Headers (starting with ;;)
        #    Some files define their own column headers in the file.
        if line.strip().startswith(";;"):
            content = line.strip()[2:].strip()
            # If the content isn't just dashes (separator line), treat it as headers
            if content and not all(c in "- " for c in content):
                if not headers[current]:
                    # Split by 2 or more spaces to separate column names
                    headers[current] = re.split(r"\s{2,}", content)
            continue

        # 5. Parse Data Lines
        #    Split the line by whitespace to get tokens/values.
        tokens = re.split(r"\s+", line.strip())
        if not tokens:
            continue

        # --- Special Handling for Specific Sections ---

        # [TAGS] section format: "Node ID Tag" or "Link ID Tag"
        if current == "TAGS":
            if len(tokens) >= 3:
                element_id = tokens[1]
                tag_name = " ".join(tokens[2:])
                tags[element_id] = tag_name
            continue

        # [HYDROGRAPHS] section can have two formats
        if current == 'HYDROGRAPHS':
            # Format 1: Mapping to a Rain Gage (e.g., "Hydro1  Gage1")
            if len(tokens) == 2 and tokens[1].isnumeric():
                hydrograph_id, gage_name = tokens[0], tokens[1]
                g_sec = 'HYDROGRAPH_GAGES'
                sections.setdefault(g_sec, {})
                headers.setdefault(g_sec, ['Hydrograph', 'Gage'])
                descriptions.setdefault(g_sec, 'Hydrograph to Rain Gage Mapping')
                sections[g_sec][hydrograph_id] = [gage_name]
            # Format 2: Hydrograph Parameters (e.g., "Hydro1  JAN  SHORT  0.1  0.2 ...")
            elif len(tokens) >= 9:
                hydrograph, month, response = tokens[0], tokens[1], tokens[2]
                key = f"{hydrograph} {month} {response}"
                values = tokens[3:9]
                sections[current][key] = values
                headers[current] = [
                    'Hydrograph', 'Month', 'Response', 'R', 'T', 'K', 'Dmax', 'Drecov', 'Dinit'
                ]
            continue

        # Generic Section Parsing
        # The first token is usually the Element ID (Name), and the rest are values.
        element_id = tokens[0]
        if current == "OPTIONS":
            # For OPTIONS, treat everything after the first token as a single value string
            values = [" ".join(tokens[1:])]
        else:
            values = tokens[1:]
        sections[current][element_id] = values

    return INPParseResult(sections, headers, tags, descriptions)




# ==============================================================================
# SECTION 3: GEOMETRY PARSING
# ==============================================================================
# These functions handle the extraction of spatial data (coordinates) from the
# [COORDINATES], [VERTICES], and [POLYGONS] sections.
# ------------------------------------------------------------------------------

# =========================
# Geometry (raw XY in feet; project in JS)
# =========================
@dataclass
class SWMMGeometry:
    nodes: Dict[str, Tuple[float, float]]          # node -> (x, y)
    links: Dict[str, List[Tuple[float, float]]]    # link -> [(x, y), ...]
    subpolys: Dict[str, List[Tuple[float, float]]] # sub -> [(x, y), ...]

def _parse_geom_iter(lines) -> SWMMGeometry:
    """
    Parses geometry data from INP lines.
    
    This function scans the file for specific geometry sections and builds
    a mapping of element IDs to their coordinates.
    """
    nodes_raw: Dict[str, Tuple[float, float]] = {}
    vertices_raw: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    links_endpoints: Dict[str, Tuple[str, str]] = {}
    subpolys_raw: Dict[str, List[Tuple[float, float]]] = {}

    section = None
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        
        # Detect section header
        if line.startswith("[") and line.endswith("]"):
            section = line.upper()
            continue

        parts = re.split(r"\s+", line)

        # Parse Node Coordinates (e.g., Junctions, Outfalls)
        if section == "[COORDINATES]" and len(parts) >= 3:
            node, x, y = parts[0], float(parts[1]), float(parts[2])
            nodes_raw[node] = (x, y)

        # Parse Link Vertices (intermediate points for conduits)
        elif section == "[VERTICES]" and len(parts) >= 3:
            link, x, y = parts[0], float(parts[1]), float(parts[2])
            vertices_raw[link].append((x, y))

        # Parse Link Connectivity (From Node -> To Node)
        # This is needed to draw the full path of a link (Node -> Vertices -> Node)
        elif section in ("[CONDUITS]", "[PUMPS]", "[ORIFICES]", "[WEIRS]", "[OUTLETS]") and len(parts) >= 3:
            link, n1, n2 = parts[0], parts[1], parts[2]
            links_endpoints[link] = (n1, n2)

        # Parse Subcatchment Polygons
        elif section == "[POLYGONS]" and len(parts) >= 3:
            sub = parts[0]
            x, y = float(parts[1]), float(parts[2])
            subpolys_raw.setdefault(sub, []).append((x, y))

    # Assemble full link coordinates (Start Node + Vertices + End Node)
    links: Dict[str, List[Tuple[float, float]]] = {}
    for lid, (n1, n2) in links_endpoints.items():
        coords: List[Tuple[float, float]] = []
        if n1 in nodes_raw:
            coords.append(nodes_raw[n1])
        if lid in vertices_raw:
            coords.extend(vertices_raw[lid])
        if n2 in nodes_raw:
            coords.append(nodes_raw[n2])
        
        # Only store if we have at least 2 points (start and end)
        if len(coords) >= 2:
            links[lid] = coords

    return SWMMGeometry(nodes=nodes_raw, links=links, subpolys=subpolys_raw)



# ==============================================================================
# SECTION 4: SPATIAL ANALYSIS HELPERS
# ==============================================================================
# These helper functions perform geometric calculations like distance, length,
# and area. They are used primarily for the "Renaming Logic" to match elements
# that might have changed names but are in the same location.
# ------------------------------------------------------------------------------

# =========================
# Spatial helpers (planar XY in feet → meters)
# =========================
_FEET_TO_M = 0.3048

def _dist_m_xy(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    dx = (p2[0] - p1[0]) * _FEET_TO_M
    dy = (p2[1] - p1[1]) * _FEET_TO_M
    return math.hypot(dx, dy)

def _polyline_length_m(coords: List[Tuple[float, float]]) -> float:
    if not coords or len(coords) < 2:
        return 0.0
    return sum(_dist_m_xy(a, b) for a, b in zip(coords[:-1], coords[1:]))

def _centroid_xy(coords: List[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    if not coords:
        return None
    x = sum(p[0] for p in coords) / len(coords)
    y = sum(p[1] for p in coords) / len(coords)
    return (x, y)

def _bbox_area_m2(coords: List[Tuple[float, float]]) -> float:
    if not coords:
        return 0.0
    xs = [p[0] for p in coords]; ys = [p[1] for p in coords]
    w_ft = max(xs) - min(xs)
    h_ft = max(ys) - min(ys)
    return (w_ft * _FEET_TO_M) * (h_ft * _FEET_TO_M)

def _ratio_close(a: float, b: float, tol=0.10) -> bool:
    if a == 0 or b == 0:
        return False
    r = a / b
    return (1 - tol) <= r <= (1 + tol)

# ==============================================================================
# SECTION 5: RENAMING LOGIC (HEURISTICS)
# ==============================================================================
# This is the "magic" of the comparison tool. It attempts to match elements
# between two files even if their IDs (names) have changed.
#
# It uses spatial proximity (location) and attribute similarity to guess if
# "Node A" in File 1 is actually "Node B" in File 2.
# ------------------------------------------------------------------------------

# =========================
# Rename proposals (using XY)
# =========================
def _build_node_renames(pr1: INPParseResult, pr2: INPParseResult,
                        g1: SWMMGeometry, g2: SWMMGeometry,
                        eps_m: float = 0.5 * _FEET_TO_M) -> Dict[str, str]:
    """
    Identifies nodes that have been renamed based on their location.
    
    If a node in File 1 is missing in File 2, and a new node in File 2 appears
    at the exact same location (within a small tolerance), we assume it was renamed.
    
    Args:
        eps_m: The distance tolerance in meters (default is ~0.5 ft).
    """
    node_secs = ("JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE")
    # Get set of all node IDs in both files
    ids1 = set().union(*[set(pr1.sections.get(s, {})) for s in node_secs])
    ids2 = set().union(*[set(pr2.sections.get(s, {})) for s in node_secs])

    # Find unique nodes (present in one but not the other)
    u1 = [nid for nid in ids1 if nid not in ids2] # Potential "Old Names"
    u2 = [nid for nid in ids2 if nid not in ids1] # Potential "New Names"

    n1 = g1.nodes if g1 else {}
    n2 = g2.nodes if g2 else {}

    pairs = []
    for old_id in u1:
        if old_id not in n1:
            continue
        p1 = n1[old_id]
        best = None
        best_d = float("inf")
        
        # Search for the closest new node
        for new_id in u2:
            if new_id not in n2:
                continue
            p2 = n2[new_id]
            d = _dist_m_xy(p1, p2)
            
            # If it's within tolerance and is the closest one found so far
            if d < eps_m and d < best_d:
                best, best_d = new_id, d
        
        if best is not None:
            pairs.append((old_id, best, best_d))

    # Sort by distance (closest matches first) to resolve conflicts
    pairs.sort(key=lambda x: x[2])
    renames: Dict[str, str] = {}
    used_new = set()
    
    for old_id, new_id, _ in pairs:
        if new_id in used_new:
            continue
        renames[old_id] = new_id
        used_new.add(new_id)
        
    return renames

def _build_link_renames(pr1: INPParseResult, pr2: INPParseResult,
                        g1: SWMMGeometry, g2: SWMMGeometry,
                        node_renames: Dict[str, str],
                        eps_centroid_m: float = 5 * _FEET_TO_M,
                        len_tol: float = 0.05) -> Dict[str, str]:
    """
    Identifies links (conduits) that have been renamed.
    
    This is more complex than nodes. We check:
    1. Are the start/end nodes the same (or renamed versions of each other)?
    2. Is the length similar?
    3. Is the centroid (midpoint) location similar?
    """
    link_secs = ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS")
    ids1 = set().union(*[set(pr1.sections.get(s, {})) for s in link_secs])
    ids2 = set().union(*[set(pr2.sections.get(s, {})) for s in link_secs])

    u1 = [lid for lid in ids1 if lid not in ids2]
    u2 = [lid for lid in ids2 if lid not in ids1]

    # Helper to get start/end node IDs for a link
    def endpoints(pr: INPParseResult, lid: str) -> tuple:
        for s in link_secs:
            if lid in pr.sections.get(s, {}):
                vals = pr.sections[s][lid]
                if len(vals) >= 2:
                    return (vals[0], vals[1])
        return (None, None)

    renames: Dict[str, str] = {}
    used_new = set()

    for old_id in u1:
        coords1 = g1.links.get(old_id) if g1 else None
        if not coords1 or len(coords1) < 2:
            continue
        e1 = endpoints(pr1, old_id)
        len1 = _polyline_length_m(coords1)
        c1 = _centroid_xy(coords1)

        best = None
        best_score = float("inf")
        
        for new_id in u2:
            if new_id in used_new:
                continue
            coords2 = g2.links.get(new_id) if g2 else None
            if not coords2 or len(coords2) < 2:
                continue

            # Check connectivity (Start/End nodes)
            e2 = endpoints(pr2, new_id)
            inv = {v: k for k, v in node_renames.items()} # Reverse map for node renames
            e2_mapped = tuple(inv.get(x, x) for x in e2)
            endpoint_ok = set(e1) == set(e2_mapped)

            # Check length similarity
            len2 = _polyline_length_m(coords2)
            if not _ratio_close(max(len1, 1e-6), max(len2, 1e-6), tol=len_tol):
                if not endpoint_ok:
                    continue

            # Check spatial proximity of centroids
            c2 = _centroid_xy(coords2)
            if not c1 or not c2:
                continue
            dcent = _dist_m_xy(c1, c2)
            
            # If endpoints don't match, we need to be very close spatially
            if dcent > eps_centroid_m and not endpoint_ok:
                continue

            # Calculate a score (lower is better)
            # Prioritize endpoint matches (0) over just spatial matches (1000)
            score = (0 if endpoint_ok else 1) * 1000 + dcent
            if score < best_score:
                best, best_score = new_id, score

        if best is not None:
            renames[old_id] = best
            used_new.add(best)

    return renames

def _build_sub_renames(pr1: INPParseResult, pr2: INPParseResult,
                       g1: SWMMGeometry, g2: SWMMGeometry,
                       eps_centroid_m: float = 10 * _FEET_TO_M,
                       area_tol: float = 0.10) -> Dict[str, str]:
    s = "SUBCATCHMENTS"
    ids1 = set(pr1.sections.get(s, {}))
    ids2 = set(pr2.sections.get(s, {}))
    u1 = [sid for sid in ids1 if sid not in ids2]
    u2 = [sid for sid in ids2 if sid not in ids1]

    renames: Dict[str, str] = {}
    used_new = set()
    for old_id in u1:
        poly1 = g1.subpolys.get(old_id) if g1 else None
        if not poly1 or len(poly1) < 3:
            continue
        c1 = _centroid_xy(poly1)
        a1 = _bbox_area_m2(poly1) or 1.0

        best = None
        best_score = float("inf")
        for new_id in u2:
            if new_id in used_new:
                continue
            poly2 = g2.subpolys.get(new_id) if g2 else None
            if not poly2 or len(poly2) < 3:
                continue
            c2 = _centroid_xy(poly2)
            a2 = _bbox_area_m2(poly2) or 1.0
            if not _ratio_close(a1, a2, tol=area_tol):
                continue
            dcent = _dist_m_xy(c1, c2)
            if dcent > eps_centroid_m:
                continue
            if dcent < best_score:
                best, best_score = new_id, dcent

        if best is not None:
            renames[old_id] = best
            used_new.add(new_id)

    return renames

def _apply_renames_to_pr2(pr2: INPParseResult,
                          node_ren: Dict[str, str],
                          link_ren: Dict[str, str],
                          sub_ren: Dict[str, str]) -> None:
    node_new_to_old = {v: k for k, v in node_ren.items()}
    link_new_to_old = {v: k for k, v in link_ren.items()}
    sub_new_to_old  = {v: k for k, v in sub_ren.items()}

    for sec in ("JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"):
        secmap = pr2.sections.get(sec, {})
        for new_id, old_id in list(node_new_to_old.items()):
            if new_id in secmap and old_id not in secmap:
                secmap[old_id] = secmap.pop(new_id)

    for sec in ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"):
        secmap = pr2.sections.get(sec, {})
        for lid, vals in list(secmap.items()):
            if len(vals) >= 2:
                vals[0] = node_new_to_old.get(vals[0], vals[0])
                vals[1] = node_new_to_old.get(vals[1], vals[1])
        for new_id, old_id in list(link_new_to_old.items()):
            if new_id in secmap and old_id not in secmap:
                secmap[old_id] = secmap.pop(new_id)

    secmap = pr2.sections.get("SUBCATCHMENTS", {})
    for new_id, old_id in list(sub_new_to_old.items()):
        if new_id in secmap and old_id not in secmap:
            secmap[old_id] = secmap.pop(new_id)

    for new_id, old_id in list(node_new_to_old.items()) + list(link_new_to_old.items()) + list(sub_new_to_old.items()):
        if new_id in pr2.tags and old_id not in pr2.tags:
            pr2.tags[old_id] = pr2.tags.pop(new_id)

def _apply_renames_to_geometry(g2: SWMMGeometry,
                               node_ren: Dict[str, str],
                               link_ren: Dict[str, str],
                               sub_ren: Dict[str, str]) -> None:
    """
    Updates the geometry object g2 in-place, replacing new IDs with old IDs
    for any renamed elements. This ensures the frontend can look up geometry
    using the original ID.
    """
    node_new_to_old = {v: k for k, v in node_ren.items()}
    for new_id, old_id in list(node_new_to_old.items()):
        if new_id in g2.nodes and old_id not in g2.nodes:
            g2.nodes[old_id] = g2.nodes.pop(new_id)

    link_new_to_old = {v: k for k, v in link_ren.items()}
    for new_id, old_id in list(link_new_to_old.items()):
        if new_id in g2.links and old_id not in g2.links:
            g2.links[old_id] = g2.links.pop(new_id)

    sub_new_to_old = {v: k for k, v in sub_ren.items()}
    for new_id, old_id in list(sub_new_to_old.items()):
        if new_id in g2.subpolys and old_id not in g2.subpolys:
            g2.subpolys[old_id] = g2.subpolys.pop(new_id)

def spatial_reconcile_and_remap_using_geom(pr1: INPParseResult, pr2: INPParseResult,
                                           g1: SWMMGeometry, g2: SWMMGeometry) -> Dict[str, Dict[str, str]]:
    node_ren = _build_node_renames(pr1, pr2, g1, g2)
    link_ren = _build_link_renames(pr1, pr2, g1, g2, node_ren)
    sub_ren  = _build_sub_renames(pr1, pr2, g1, g2)

    _apply_renames_to_pr2(pr2, node_ren, link_ren, sub_ren)
    _apply_renames_to_geometry(g2, node_ren, link_ren, sub_ren)

    by_sec = defaultdict(dict)
    for old_id, new_id in node_ren.items():
        for sec in ("JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"):
            if old_id in pr1.sections.get(sec, {}):
                by_sec[sec][old_id] = new_id
                break
    for old_id, new_id in link_ren.items():
        for sec in ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"):
            if old_id in pr1.sections.get(sec, {}):
                by_sec[sec][old_id] = new_id
                break
    for old_id, new_id in sub_ren.items():
        by_sec["SUBCATCHMENTS"][old_id] = new_id

    return by_sec

# ==============================================================================
# SECTION 6: COMPARISON LOGIC
# ==============================================================================
# This section contains the core logic for comparing two parsed INP files.
# It identifies added, removed, and changed elements, and calculates specific
# numerical differences.
# ------------------------------------------------------------------------------

# =========================
# Comparison
# =========================
@dataclass
class DiffSection:
    """
    Holds the differences for a specific section (e.g., JUNCTIONS).
    
    Attributes:
        added (List[str]): List of IDs that are present in File 2 but not File 1.
        removed (List[str]): List of IDs that are present in File 1 but not File 2.
        changed (Dict): Dictionary mapping ID -> (Old Values, New Values).
                        Only includes items where the values are actually different.
    """
    added: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    changed: Dict[str, Tuple[List[str], List[str]]] = field(default_factory=dict)

def compare_sections(secs1: Dict[str, Dict[str, List[str]]],
                     secs2: Dict[str, Dict[str, List[str]]],
                     headers1: Dict[str, List[str]],
                     headers2: Dict[str, List[str]]) -> Tuple[Dict[str, DiffSection], Dict[str, List[str]]]:
    """
    Compares all sections between two files.
    
    Returns:
        Tuple: (Diffs per section, Headers per section)
    """
    out: Dict[str, DiffSection] = {}
    all_headers: Dict[str, List[str]] = {}
    
    # Iterate over all unique sections found in either file
    for sec in sorted(set(secs1) | set(secs2)):
        recs1 = secs1.get(sec, {})
        recs2 = secs2.get(sec, {})
        keys1, keys2 = set(recs1), set(recs2)
        
        # Identify Added and Removed IDs
        added = sorted(keys2 - keys1)
        removed = sorted(keys1 - keys2)
        
        # Identify Changed items (same ID, different values)
        changed = {k: (recs1[k], recs2[k]) for k in (keys1 & keys2) if recs1.get(k) != recs2.get(k)}

        if added or removed or changed:
            out[sec] = DiffSection(added, removed, changed)
            all_headers[sec] = headers1.get(sec) or headers2.get(sec, [])
            
    return out, all_headers

def _calculate_field_diffs(old_vals: List[str], new_vals: List[str], headers: List[str], section: str) -> Dict[str, float]:
    """
    Calculates numerical differences for specific fields in changed records.
    
    For example, if a Conduit's length changes from 100 to 110, this function
    will return {"Length": 10.0}.
    """
    diffs = {}
    if not headers:
        return diffs

    def get_val(values: List[str], index: int) -> Optional[float]:
        try:
            if index < len(values):
                return float(values[index])
        except (ValueError, TypeError):
            pass
        return None

    if section == "CONDUITS":
        # Hardcoded indices for standard SWMM fields
        fields_to_diff = {"Length": 2, "Roughness": 3, "InOffset": 4, "OutOffset": 5}
        for field, idx in fields_to_diff.items():
            old_v, new_v = get_val(old_vals, idx), get_val(new_vals, idx)
            if old_v is not None and new_v is not None:
                diffs[field] = new_v - old_v

    elif section == "JUNCTIONS":
        # Field names are from headers, but we use hardcoded indices for robustness
        # Headers: "Name", "InvertElev", "MaxDepth", ...
        # Values: [InvertElev, MaxDepth, ...]
        invert_idx, max_depth_idx = 0, 1

        old_invert = get_val(old_vals, invert_idx)
        new_invert = get_val(new_vals, invert_idx)
        if old_invert is not None and new_invert is not None:
            diffs["InvertElev"] = new_invert - old_invert

        old_max_depth = get_val(old_vals, max_depth_idx)
        new_max_depth = get_val(new_vals, max_depth_idx)
        if old_max_depth is not None and new_max_depth is not None:
            diffs["MaxDepth"] = new_max_depth - old_max_depth

        # Autocalculated RimElevation (Invert + MaxDepth)
        if old_invert is not None and old_max_depth is not None:
            diffs["RimElevation_old"] = old_invert + old_max_depth
        if new_invert is not None and new_max_depth is not None:
            diffs["RimElevation_new"] = new_invert + new_max_depth
        if "RimElevation_old" in diffs and "RimElevation_new" in diffs:
            diffs["RimElevation_diff"] = diffs["RimElevation_new"] - diffs["RimElevation_old"]

    return diffs

def _filter_changes_by_tolerance(diffs: Dict[str, DiffSection], tolerances: Dict[str, float], renames: Dict[str, Dict[str, str]] = None):
    """
    Post-process the 'changed' items in a diffs object, removing any items
    where all numerical differences fall within the specified tolerances.
    """
    if not tolerances:
        print("[DEBUG] No tolerances provided, skipping filter.")
        return

    # Check if any tolerance values are actually set (non-zero)
    has_any_tolerance = any(v > 0 for v in tolerances.values() if isinstance(v, (int, float)))
    if not has_any_tolerance:
        print("[DEBUG] All tolerance values are 0 or invalid, skipping filter.")
        return

    def get_float(val_str: str) -> Optional[float]:
        try:
            return float(val_str)
        except (ValueError, TypeError):
            return None

    print(f"[DEBUG] Filtering with tolerances: {tolerances}")

    for sec, diff_section in diffs.items():
        ids_to_remove = []
        for item_id, (old_vals, new_vals) in diff_section.changed.items():
            # Skip filtering if the item was renamed (it's a change regardless of values)
            if renames and sec in renames and item_id in renames[sec]:
                continue

            max_len = max(len(old_vals), len(new_vals))
            old_padded = old_vals + [""] * (max_len - len(old_vals))
            new_padded = new_vals + [""] * (max_len - len(new_vals))

            # Track which fields are within tolerance vs truly different
            fields_within_tolerance = set()
            is_truly_different = False
            
            for i in range(max_len):
                v1, v2 = old_padded[i], new_padded[i]
                if v1 == v2:
                    continue

                # Check for numerical tolerance
                v1_f, v2_f = get_float(v1), get_float(v2)
                if v1_f is not None and v2_f is not None:
                    field_within_tol = False
                    if sec == "CONDUITS":
                        if i == 2: # Length (index 2)
                            tol = tolerances.get("CONDUIT_LENGTH", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                        elif i == 3: # Roughness (index 3)
                            tol = tolerances.get("CONDUIT_ROUGHNESS", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                        elif i in (4, 5): # In/Out Offset (index 4=InOffset, 5=OutOffset)
                            tol = tolerances.get("CONDUIT_OFFSET", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                    elif sec == "JUNCTIONS":
                        if i == 0: # InvertElev
                            tol = tolerances.get("JUNCTION_INVERT", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                        elif i == 1: # MaxDepth
                            tol = tolerances.get("JUNCTION_DEPTH", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                    
                    if field_within_tol:
                        continue  # Skip this field, it's within tolerance

                is_truly_different = True
                break

            if not is_truly_different:
                ids_to_remove.append(item_id)

        for item_id in ids_to_remove:
            del diff_section.changed[item_id]
        
        if ids_to_remove:
            print(f"[DEBUG] [{sec}]: Removed {len(ids_to_remove)} item(s) that were within tolerance.")

# ==============================================================================
# SECTION 7: PUBLIC API (WEB WORKER ENTRYPOINT)
# ==============================================================================
# This is the main function called by the JavaScript frontend (via Pyodide).
# It orchestrates the entire comparison process.
# ------------------------------------------------------------------------------

# =========================
# Public entrypoint for the web worker
# =========================
def run_compare(file1_bytes, file2_bytes, tolerances_py=None) -> str:
    """
    Main entry point for the comparison logic.
    
    Args:
        file1_bytes: Content of the first INP file (bytes or string).
        file2_bytes: Content of the second INP file (bytes or string).
        tolerances_py: Optional dictionary of tolerance values (e.g., {"CONDUIT_LENGTH": 0.1}).
        
    Returns:
        str: A JSON string containing the full comparison results, geometry, and summaries.
    """
    f1 = _to_text_io(file1_bytes)
    f2 = _to_text_io(file2_bytes)

    # 1. Parse Attributes (Text Data)
    pr1 = _parse_inp_iter(f1)
    pr2 = _parse_inp_iter(f2)

    # 2. Parse Geometry (Spatial Data)
    f1.seek(0); f2.seek(0)
    g1 = _parse_geom_iter(f1)
    g2 = _parse_geom_iter(f2)

    # --- Handle Tolerances ---
    # Handle tolerances whether passed as a JS Proxy or a generic Python dict
    tolerances = {}
    if tolerances_py is not None:
        if hasattr(tolerances_py, 'to_py'):
            # It's a JS Proxy (passed directly from JS)
            tolerances = tolerances_py.to_py()
        else:
            # It's already a Python dictionary (converted in JS via pyodide.toPy)
            tolerances = tolerances_py

    # 3. Spatial Reconciliation
    #    Attempt to match renamed elements using geometry.
    renames = spatial_reconcile_and_remap_using_geom(pr1, pr2, g1, g2)

    # 4. Compare Sections
    #    Calculate added/removed/changed items.
    diffs, headers = compare_sections(pr1.sections, pr2.sections, pr1.headers, pr2.headers)

    # --- FORCE RENAMED ITEMS INTO "CHANGED" ---

    for sec, mapping in renames.items():
        if sec not in diffs:
            diffs[sec] = DiffSection()
            headers[sec] = pr1.headers.get(sec) or pr2.headers.get(sec, [])
        
        for old_id in mapping:
            if old_id not in diffs[sec].changed:
                # It was considered "Same" because attributes matched.
                # Move it to "Changed".
                v1 = pr1.sections.get(sec, {}).get(old_id, [])
                v2 = pr2.sections.get(sec, {}).get(old_id, [])
                diffs[sec].changed[old_id] = (v1, v2)

    # 5. Filter by Tolerance
    #    Remove "Changed" items if the difference is within the specified tolerance.
    
    _filter_changes_by_tolerance(diffs, tolerances, renames)

    # --- INJECT "New Name" COLUMN ---
    # Add "New Name" column for sections with renames.
    # Populate with "NA" by default, or the new name if renamed.
    for sec in diffs:
        if sec in renames and renames[sec]:
            # Add header
            if sec in headers and "New Name" not in headers[sec]:
                headers[sec].insert(1, "New Name")

    # 6. Build Output JSON
    
    # Summary rows for the left panel
    summary_rows = [
        {"Section": s, "AddedCount": len(d.added), "RemovedCount": len(d.removed), "ChangedCount": len(d.changed)}
        for s, d in diffs.items()
    ]

    # Build rich diffs: include full arrays for added/removed
    diffs_json = {}
    for sec, d in diffs.items():
        s1 = pr1.sections.get(sec, {})
        s2 = pr2.sections.get(sec, {})
        
        # Helper to pad values if we added a column
        has_new_name_col = sec in headers and "New Name" in headers[sec]
        
        def get_vals(source, rid, is_file2=False):
            vals = source.get(rid, []) or []
            if has_new_name_col:
                # Pad with "NA" for Added/Removed items
                vals = list(vals)
                vals.insert(0, "NA") 
            return vals

        # Prepare changed items with injected column
        changed_json = {}
        for rid in d.changed:
            old_vals_orig, new_vals_orig = d.changed[rid]
            
            # Calculate diffs on ORIGINAL values (before injection)
            field_diffs = _calculate_field_diffs(old_vals_orig, new_vals_orig, headers.get(sec, []), sec)
            
            # Inject "New Name" column
            if has_new_name_col:
                new_name_val = renames.get(sec, {}).get(rid, "NA")
                # Create NEW lists to avoid mutating the originals used elsewhere
                # User requested NO diff arrow for this column, so set both old and new to the same value
                v1_disp = [new_name_val] + old_vals_orig
                v2_disp = [new_name_val] + new_vals_orig
            else:
                v1_disp = old_vals_orig
                v2_disp = new_vals_orig
                
            changed_json[rid] = {
                "values": [v1_disp, v2_disp],
                "diff_values": field_diffs
            }

        diffs_json[sec] = {
            # ADDED: values from file2
            "added":   { rid: get_vals(s2, rid, True) for rid in d.added },
            # REMOVED: values from file1
            "removed": { rid: get_vals(s1, rid, False) for rid in d.removed },
            # CHANGED: [old, new]
            "changed": changed_json
        }

    # expose full hydrograph maps so the UI can build the 3x6 drill-down like desktop
    hydrographs = {
        "file1": pr1.sections.get("HYDROGRAPHS", {}),
        "file2": pr2.sections.get("HYDROGRAPHS", {}),
    }

    geom = {
        "crs": MAP_SOURCE_CRS,
        "nodes1": g1.nodes, "links1": g1.links, "subs1": g1.subpolys,
        "nodes2": g2.nodes, "links2": g2.links, "subs2": g2.subpolys,
    }

    out = {
        "summary": summary_rows,
        "diffs": diffs_json,
        "headers": headers,
        "renames": renames,
        "geometry": geom,
        "sections1": pr1.sections,
        "sections2": pr2.sections,
        "hydrographs": hydrographs,
        "tolerances": tolerances,
    }
    return json.dumps(out)


def _to_text_io(payload) -> io.StringIO:
    """Accept bytes, bytearray, memoryview, str, or any buffer-protocol object."""
    if isinstance(payload, str):
        return io.StringIO(payload)
    if isinstance(payload, (bytes, bytearray)):
        data = payload
    elif isinstance(payload, memoryview):
        data = payload.tobytes()
    else:
        # Last-ditch: try buffer protocol
        try:
            data = bytes(payload)
        except Exception as e:
            raise TypeError(f"Unsupported input type for INP bytes: {type(payload)!r}") from e
    return io.StringIO(data.decode("utf-8", "ignore"))


# ==============================================================================
# SECTION 8: SHAPEFILE EXPORT
# ==============================================================================
# Logic to generate a ZIP file containing Shapefiles for Nodes, Links, and Subcatchments.
# ------------------------------------------------------------------------------

import zipfile
import shapefile

# WKT Definitions for supported CRS
CRS_WKT = {
    "EPSG:3735": 'PROJCS["NAD83 / Ohio South (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",40.03333333333333],PARAMETER["standard_parallel_2",38.73333333333333],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",-82.5],PARAMETER["false_easting",1968500.000000001],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192,AUTHORITY["EPSG","9003"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","3735"]]',
    "EPSG:3733": 'PROJCS["NAD83 / Ohio North (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",41.7],PARAMETER["standard_parallel_2",40.43333333333333],PARAMETER["latitude_of_origin",39.66666666666666],PARAMETER["central_meridian",-82.5],PARAMETER["false_easting",1968500.000000001],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192,AUTHORITY["EPSG","9003"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","3733"]]',
    "EPSG:6499": 'PROJCS["NAD83(2011) / Michigan South (ft)",GEOGCS["NAD83(2011)",DATUM["NAD83_National_Spatial_Reference_System_2011",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1116"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","6318"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",43.66666666666666],PARAMETER["standard_parallel_2",42.1],PARAMETER["latitude_of_origin",41.5],PARAMETER["central_meridian",-84.36666666666666],PARAMETER["false_easting",13123359.58005249],PARAMETER["false_northing",0],UNIT["foot",0.3048,AUTHORITY["EPSG","9002"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","6499"]]',
    "EPSG:2272": 'PROJCS["NAD83 / Pennsylvania South (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",40.96666666666667],PARAMETER["standard_parallel_2",39.93333333333333],PARAMETER["latitude_of_origin",39.33333333333334],PARAMETER["central_meridian",-77.75],PARAMETER["false_easting",1968500.000000001],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192,AUTHORITY["EPSG","9003"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","2272"]]',
}

def generate_shapefiles_zip(diffs_json_str: str, geometry_json_str: str, crs_id: str = None, file_prefix: str = "export") -> bytes:
    """
    Generates a ZIP file containing shapefiles for Nodes, Links, and Subcatchments.
    
    Args:
        diffs_json_str: JSON string of the diffs object (output of run_compare).
        geometry_json_str: JSON string of the geometry object.
        crs_id: Optional EPSG code (e.g., "EPSG:3735") to include a .prj file.
        file_prefix: String to append to filenames (e.g., "file1_vs_file2").
        
    Returns:
        bytes: The ZIP file content.
    """
    try:
        diffs_full = json.loads(diffs_json_str)
        # The 'diffs' key inside the full output holds the actual diffs
        diffs = diffs_full.get("diffs", {}) if "diffs" in diffs_full else diffs_full
        
        # If the input was the full output object, extract geometry from it too
        if "geometry" in diffs_full:
            geom = diffs_full["geometry"]
        else:
            geom = json.loads(geometry_json_str)
            
        # Extract geometry
        nodes1 = geom.get("nodes1", {})
        nodes2 = geom.get("nodes2", {})
        links1 = geom.get("links1", {})
        links2 = geom.get("links2", {})
        subs1 = geom.get("subs1", {})
        subs2 = geom.get("subs2", {})
        
        # In-memory ZIP buffer
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            
            # Helper to write a shapefile to the ZIP
            def write_shapefile(name, shape_type, records, coords_lookup1, coords_lookup2):
                # records: list of (id, status)
                # coords_lookup1: dict id -> coords (for Removed)
                # coords_lookup2: dict id -> coords (for Added, Changed, Same)
                
                shpio = io.BytesIO()
                shxio = io.BytesIO()
                dbfio = io.BytesIO()
                
                w = shapefile.Writer(shp=shpio, shx=shxio, dbf=dbfio)
                w.shapeType = shape_type
                w.field("ID", "C", 50)
                w.field("Status", "C", 20)
                
                count = 0
                for eid, status in records:
                    coords = None
                    if status == "Removed":
                        coords = coords_lookup1.get(eid)
                    else:
                        coords = coords_lookup2.get(eid)
                        
                    if not coords:
                        continue
                        
                    # Add geometry
                    if shape_type == shapefile.POINT:
                        # coords is (x, y)
                        w.point(coords[0], coords[1])
                    elif shape_type == shapefile.POLYLINE:
                        # coords is [(x, y), ...]
                        w.line([coords])
                    elif shape_type == shapefile.POLYGON:
                        # coords is [(x, y), ...]
                        # Ensure closed polygon
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        w.poly([coords])
                        
                    w.record(eid, status)
                    count += 1
                    
                w.close()
                
                if count > 0:
                    zf.writestr(f"{name}.shp", shpio.getvalue())
                    zf.writestr(f"{name}.shx", shxio.getvalue())
                    zf.writestr(f"{name}.dbf", dbfio.getvalue())
                    
                    # Write PRJ file if CRS is provided and known
                    if crs_id and crs_id in CRS_WKT:
                        zf.writestr(f"{name}.prj", CRS_WKT[crs_id])

            # --- Prepare Data ---
            
            # Re-parsing the full output to get sections lists
            full_out = diffs_full
            secs1 = full_out.get("sections1", {})
            secs2 = full_out.get("sections2", {})
            
            def collect_records(section_names):
                records = []
                processed_ids = set()
                
                for sec in section_names:
                    s1 = secs1.get(sec, {})
                    s2 = secs2.get(sec, {})
                    d = diffs.get(sec, {})
                    
                    added = set(d.get("added", {}).keys())
                    removed = set(d.get("removed", {}).keys())
                    changed = set(d.get("changed", {}).keys())
                    
                    # Added
                    for eid in added:
                        if eid not in processed_ids:
                            records.append((eid, "Added"))
                            processed_ids.add(eid)
                            
                    # Removed
                    for eid in removed:
                        if eid not in processed_ids:
                            records.append((eid, "Removed"))
                            processed_ids.add(eid)
                            
                    # Changed
                    for eid in changed:
                        if eid not in processed_ids:
                            records.append((eid, "Changed"))
                            processed_ids.add(eid)
                            
                    # Same
                    # IDs in s2 that are not added or changed
                    for eid in s2:
                        if eid not in added and eid not in changed and eid not in processed_ids:
                            records.append((eid, "Same"))
                            processed_ids.add(eid)
                            
                return records

            # Nodes
            node_sections = ["JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"]
            node_records = collect_records(node_sections)
            write_shapefile(f"nodes_{file_prefix}", shapefile.POINT, node_records, nodes1, nodes2)
            
            # Links
            link_sections = ["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"]
            link_records = collect_records(link_sections)
            write_shapefile(f"links_{file_prefix}", shapefile.POLYLINE, link_records, links1, links2)
            
            # Subcatchments
            sub_records = collect_records(["SUBCATCHMENTS"])
            write_shapefile(f"subcatchments_{file_prefix}", shapefile.POLYGON, sub_records, subs1, subs2)
            
        return zip_buffer.getvalue()
    except Exception as e:
        return str(e).encode("utf-8")
