# core_web.py
from __future__ import annotations
import io, re, json, math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional
from collections import defaultdict

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

# =========================
# Parsing
# =========================
@dataclass
class INPParseResult:
    sections: Dict[str, Dict[str, List[str]]] = field(default_factory=lambda: defaultdict(dict))
    headers: Dict[str, List[str]] = field(default_factory=dict)
    tags: Dict[str, str] = field(default_factory=dict)
    descriptions: Dict[str, str] = field(default_factory=dict)

def _parse_inp_iter(lines) -> INPParseResult:
    sections: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    headers: Dict[str, List[str]] = {}
    tags: Dict[str, str] = {}
    descriptions: Dict[str, str] = {}

    current = None
    after_header = False

    for raw in lines:
        line = raw.rstrip("\n")

        # Section header like: [JUNCTIONS]
        m = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if m:
            current = m.group(1).upper()
            # use default headers from SECTION_HEADERS when available
            headers.setdefault(current, SECTION_HEADERS.get(current, []).copy())
            descriptions.setdefault(current, "")
            after_header = True
            continue

        if current is None:
            continue

        # Capture a single-line description immediately after header ("; ...")
        if after_header:
            if line.lstrip().startswith(";") and not line.lstrip().startswith(";;"):
                descriptions[current] = line.lstrip("; ").strip()
                after_header = False
                continue
            elif line.strip() != "":
                after_header = False

        if not line.strip():
            continue

        # Skip ordinary comments (but NOT header lines)
        if line.lstrip().startswith(";") and not line.lstrip().startswith(";;"):
            continue

        # Parse ";;" header lines — match desktop: split on 2+ whitespace, no expandtabs
        # This will only be used for sections that don't have defaults in SECTION_HEADERS
        if line.strip().startswith(";;"):
            content = line.strip()[2:].strip()
            if content and not all(c in "- " for c in content):
                if not headers[current]:
                    headers[current] = re.split(r"\s{2,}", content)
            continue

        tokens = re.split(r"\s+", line.strip())
        if not tokens:
            continue

        # Special section handling
        if current == "TAGS":
            # Desktop-style: "type id tag..." OR "ID TAG..." variants exist.
            # Your desktop effectively stores element_id -> tag (uses tokens[1] for id).
            if len(tokens) >= 3:
                element_id = tokens[1]
                tag_name = " ".join(tokens[2:])
                tags[element_id] = tag_name
            continue

        # HYDROGRAPHS: leave as you had (since your HYDROGRAPHS already match desktop)
        if current == 'HYDROGRAPHS':
            if len(tokens) == 2 and tokens[1].isnumeric():
                hydrograph_id, gage_name = tokens[0], tokens[1]
                g_sec = 'HYDROGRAPH_GAGES'
                sections.setdefault(g_sec, {})
                headers.setdefault(g_sec, ['Hydrograph', 'Gage'])
                descriptions.setdefault(g_sec, 'Hydrograph to Rain Gage Mapping')
                sections[g_sec][hydrograph_id] = [gage_name]
            elif len(tokens) >= 9:
                hydrograph, month, response = tokens[0], tokens[1], tokens[2]
                key = f"{hydrograph} {month} {response}"
                values = tokens[3:9]
                sections[current][key] = values
                headers[current] = [
                    'Hydrograph', 'Month', 'Response', 'R', 'T', 'K', 'Dmax', 'Drecov', 'Dinit'
                ]
            continue

        # Generic: store raw tokens with NO trim/pad to header length
        element_id = tokens[0]
        values = tokens[1:]
        sections[current][element_id] = values

    return INPParseResult(sections, headers, tags, descriptions)


def _parse_inp_filelike(f) -> INPParseResult:
    return _parse_inp_iter(f)

# Optional path-based wrapper (not used in browser)
def parse_inp(path: str) -> INPParseResult:
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        return _parse_inp_iter(fh)

# =========================
# Geometry (raw XY in feet; project in JS)
# =========================
@dataclass
class SWMMGeometry:
    nodes: Dict[str, Tuple[float, float]]          # node -> (x, y)
    links: Dict[str, List[Tuple[float, float]]]    # link -> [(x, y), ...]
    subpolys: Dict[str, List[Tuple[float, float]]] # sub -> [(x, y), ...]

def _parse_geom_iter(lines) -> SWMMGeometry:
    nodes_raw: Dict[str, Tuple[float, float]] = {}
    vertices_raw: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    links_endpoints: Dict[str, Tuple[str, str]] = {}
    subpolys_raw: Dict[str, List[Tuple[float, float]]] = {}

    section = None
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line.upper()
            continue

        parts = re.split(r"\s+", line)

        if section == "[COORDINATES]" and len(parts) >= 3:
            node, x, y = parts[0], float(parts[1]), float(parts[2])
            nodes_raw[node] = (x, y)

        elif section == "[VERTICES]" and len(parts) >= 3:
            link, x, y = parts[0], float(parts[1]), float(parts[2])
            vertices_raw[link].append((x, y))

        elif section in ("[CONDUITS]", "[PUMPS]", "[ORIFICES]", "[WEIRS]", "[OUTLETS]") and len(parts) >= 3:
            link, n1, n2 = parts[0], parts[1], parts[2]
            links_endpoints[link] = (n1, n2)

        elif section == "[POLYGONS]" and len(parts) >= 3:
            sub = parts[0]
            x, y = float(parts[1]), float(parts[2])
            subpolys_raw.setdefault(sub, []).append((x, y))

    links: Dict[str, List[Tuple[float, float]]] = {}
    for lid, (n1, n2) in links_endpoints.items():
        coords: List[Tuple[float, float]] = []
        if n1 in nodes_raw:
            coords.append(nodes_raw[n1])
        if lid in vertices_raw:
            coords.extend(vertices_raw[lid])
        if n2 in nodes_raw:
            coords.append(nodes_raw[n2])
        if len(coords) >= 2:
            links[lid] = coords

    return SWMMGeometry(nodes=nodes_raw, links=links, subpolys=subpolys_raw)

def parse_swmm_geometry_filelike(f) -> SWMMGeometry:
    return _parse_geom_iter(f)

# Optional path-based wrapper (not used in browser)
def parse_swmm_geometry(path: str) -> SWMMGeometry:
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        return _parse_geom_iter(fh)

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

# =========================
# Rename proposals (using XY)
# =========================
def _build_node_renames(pr1: INPParseResult, pr2: INPParseResult,
                        g1: SWMMGeometry, g2: SWMMGeometry,
                        eps_m: float = 0.5 * _FEET_TO_M) -> Dict[str, str]:
    node_secs = ("JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE")
    ids1 = set().union(*[set(pr1.sections.get(s, {})) for s in node_secs])
    ids2 = set().union(*[set(pr2.sections.get(s, {})) for s in node_secs])

    u1 = [nid for nid in ids1 if nid not in ids2]
    u2 = [nid for nid in ids2 if nid not in ids1]

    n1 = g1.nodes if g1 else {}
    n2 = g2.nodes if g2 else {}

    pairs = []
    for old_id in u1:
        if old_id not in n1:
            continue
        p1 = n1[old_id]
        best = None
        best_d = float("inf")
        for new_id in u2:
            if new_id not in n2:
                continue
            p2 = n2[new_id]
            d = _dist_m_xy(p1, p2)
            if d < eps_m and d < best_d:
                best, best_d = new_id, d
        if best is not None:
            pairs.append((old_id, best, best_d))

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
    link_secs = ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS")
    ids1 = set().union(*[set(pr1.sections.get(s, {})) for s in link_secs])
    ids2 = set().union(*[set(pr2.sections.get(s, {})) for s in link_secs])

    u1 = [lid for lid in ids1 if lid not in ids2]
    u2 = [lid for lid in ids2 if lid not in ids1]

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

            e2 = endpoints(pr2, new_id)
            inv = {v: k for k, v in node_renames.items()}
            e2_mapped = tuple(inv.get(x, x) for x in e2)
            endpoint_ok = set(e1) == set(e2_mapped)

            len2 = _polyline_length_m(coords2)
            if not _ratio_close(max(len1, 1e-6), max(len2, 1e-6), tol=len_tol):
                if not endpoint_ok:
                    continue

            c2 = _centroid_xy(coords2)
            if not c1 or not c2:
                continue
            dcent = _dist_m_xy(c1, c2)
            if dcent > eps_centroid_m and not endpoint_ok:
                continue

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

def spatial_reconcile_and_remap_using_geom(pr1: INPParseResult, pr2: INPParseResult,
                                           g1: SWMMGeometry, g2: SWMMGeometry) -> Dict[str, Dict[str, str]]:
    node_ren = _build_node_renames(pr1, pr2, g1, g2)
    link_ren = _build_link_renames(pr1, pr2, g1, g2, node_ren)
    sub_ren  = _build_sub_renames(pr1, pr2, g1, g2)

    _apply_renames_to_pr2(pr2, node_ren, link_ren, sub_ren)

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

# =========================
# Comparison
# =========================
@dataclass
class DiffSection:
    added: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    changed: Dict[str, Tuple[List[str], List[str]]] = field(default_factory=dict)

def compare_sections(secs1: Dict[str, Dict[str, List[str]]],
                     secs2: Dict[str, Dict[str, List[str]]],
                     headers1: Dict[str, List[str]],
                     headers2: Dict[str, List[str]]) -> Tuple[Dict[str, DiffSection], Dict[str, List[str]]]:
    out: Dict[str, DiffSection] = {}
    all_headers: Dict[str, List[str]] = {}
    for sec in sorted(set(secs1) | set(secs2)):
        recs1 = secs1.get(sec, {})
        recs2 = secs2.get(sec, {})
        keys1, keys2 = set(recs1), set(recs2)
        added = sorted(keys2 - keys1)
        removed = sorted(keys1 - keys2)
        changed = {k: (recs1[k], recs2[k]) for k in (keys1 & keys2) if recs1.get(k) != recs2.get(k)}
        if added or removed or changed:
            out[sec] = DiffSection(added, removed, changed)
            all_headers[sec] = headers1.get(sec) or headers2.get(sec, [])
    return out, all_headers

# =========================
# Public entrypoint for the web worker
# =========================
def run_compare(file1_bytes, file2_bytes) -> str:
    f1 = _to_text_io(file1_bytes)
    f2 = _to_text_io(file2_bytes)

    # Parse attributes
    pr1 = _parse_inp_filelike(f1)
    pr2 = _parse_inp_filelike(f2)

    # Parse geometry
    f1.seek(0); f2.seek(0)
    g1 = parse_swmm_geometry_filelike(f1)
    g2 = parse_swmm_geometry_filelike(f2)

    # Spatial reconciliation (renames applied to pr2 in place)
    renames = spatial_reconcile_and_remap_using_geom(pr1, pr2, g1, g2)

    # Compare after reconciliation
    diffs, headers = compare_sections(pr1.sections, pr2.sections, pr1.headers, pr2.headers)

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
        diffs_json[sec] = {
            # ADDED: values from file2
            "added":   { rid: (s2.get(rid, []) or []) for rid in d.added },
            # REMOVED: values from file1
            "removed": { rid: (s1.get(rid, []) or []) for rid in d.removed },
            # CHANGED: [old, new]
            "changed": { rid: [d.changed[rid][0], d.changed[rid][1]] for rid in d.changed }
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
        "hydrographs": hydrographs,  # <— include here
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
