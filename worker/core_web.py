# core_web.py — SWMM INP/RPT parser, diff engine, spatial rename detection, shapefile export

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: IMPORTS & CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

from __future__ import annotations
import io, re, json, math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
import zipfile
import shapefile

MAP_SOURCE_CRS = "EPSG:3735"  # Default CRS; reprojected client-side via proj4


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: SECTION HEADER DEFINITIONS
#   Default column headers for every SWMM INP section. Used to label parsed
#   data and to align old/new values during comparison.
# ═══════════════════════════════════════════════════════════════════════════════

SECTION_HEADERS = {
    # --- Project / Config ---
    "TITLE": [],

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
        "Arg7", "Arg8", "Arg9", "Arg10", "Arg11", "Arg12", "Arg13"
    ],

    "ADJUSTMENTS": [
        "Variable",   # TEMPERATURE / EVAPORATION / RAINFALL / CONDUCTIVITY
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ],

    # --- Hydrology ---
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

    "INFILTRATION": [
        "Subcatch",
        "Max. Infil. Rate", "Min. Infil. Rate", "Decay Constant", "Drying Time", "Max Volume",  # Interpretation depends on method
        "Method"                       # optional override
    ],

    "LID_CONTROLS": [
        "Name",
        "Type",        # BC/IT/PP/VS/RG/RD
        "Layers"
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
    ],

    # --- Nodes / Links ---
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
        "Elevation",         # Inlet node
        "Diverted Link",         # Main conduit
        "Type",         # CUTOFF / OVERFLOW / TABULAR / WEIR / CUSTOM
        "P1", "P2", "P3", "P4", "P5"
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
        "nLeft", "nRight", "nChan",
        "XLeft", "XRight",
        "Lfactor", "Wfactor", "Eoffset"
    ],

    "STREETS": [
        "Name",
        "Tcrown",
        "Hcurb",           # gutter slopes
        "Sx",
        "nRoad",
        "a",
        "W",
        "Sides",
        "Tback",
        "Sback",
        "nBack"
    ],

    "INLETS": [
        "Name",
        "Type",         # GRATE/CURB/COMBO/BYPASS/...
        "Param1", "Param2", "Param3", "Param4",
        "Param5", "Param6", "Param7", "Param8"
    ],

    "INLET_USAGE": [
        "Conduit",
        "Inlet",
        "Node",    
        "Number",
        "%Clogged",
        "Qmax",
        "aLocal",
        "wLocal",
        "Placement"
    ],

    "LOSSES": [
        "Link",
        "Kentry",
        "Kexit",
        "Kavg",
        "FlapGate",
        "Seepage"
    ],

    # --- Water Quality / Land Use ---
    "POLLUTANTS": [
        "Name",
        "Units",
        "Crain",         # Crain
        "Cgw",
        "Crdii",
        "Kdecay",
        "SnowOnly",
        "CoPollut",
        "CoFrac",
        "Cdwf",
        "Cinit"
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
        "SweepRemoval",
        "BMPRemoval"
    ],

    "TREATMENT": [
        "NodeOrOutfall",
        "Pollutant",
        "Expression"
    ],

    # --- Inflows / DWF / RDII ---
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
        
        "Hydrograph",
        "Month",
        "Response",
        "R",
        "T",
        "K",
        "Dmax",
        "Drecov",
        "Dinit",
        "RainGage"
    ],

    "LOADINGS": [
        "Subcatch",
        "Pollutant",
        "InitBuildup"
    ],

    # --- Curves / Patterns / Timeseries ---
    "CURVES": [
        "CurveID",
        "Type",
        "Data"
    ],

    "TIMESERIES": [
        "Name",
        "Date",
        "Time",
        "Value",
        "FileName"
    ],



    # --- Controls / Tags / Geometry ---
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
        "Data"
    ],

    "POLYGONS": [
        "Subcatch",
        "Data"
    ],

    "LABELS": [
        "X",
        "Y",
        "Label",
        "Anchor"
    ],
}


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: INP TEXT PARSING
#   Reads INP file lines and produces a structured INPParseResult containing
#   sections (element ID → values), headers, tags, and descriptions.
# ═══════════════════════════════════════════════════════════════════════════════
@dataclass
class INPParseResult:
    """Structured result of parsing a SWMM INP file."""
    sections: Dict[str, Dict[str, List[str]]] = field(default_factory=lambda: defaultdict(dict))
    headers: Dict[str, List[str]] = field(default_factory=dict)
    tags: Dict[str, str] = field(default_factory=dict)
    descriptions: Dict[str, str] = field(default_factory=dict)

def _parse_inp_iter(lines) -> INPParseResult:
    """Parse INP file lines into a structured INPParseResult."""
    sections: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    headers: Dict[str, List[str]] = {}
    tags: Dict[str, str] = {}
    descriptions: Dict[str, str] = {}

    # Multi-line section accumulators
    temp_curves: Dict[str, Dict] = {}
    temp_points: Dict[str, Dict[str, List]] = defaultdict(lambda: defaultdict(list))
    temp_patterns: Dict[str, Dict] = {}
    temp_hydro_gages: Dict[str, str] = {}
    temp_timeseries: Dict[str, Dict] = {}
    temp_transects: Dict[str, Dict] = {}
    current_nc: List[str] = ["0", "0", "0"]
    current_transect_id: str = None
    temp_lid_controls: Dict[str, Dict] = {}
    LID_KNOWN_TYPES = {"BC", "IT", "PP", "VS", "RG", "RD"}
    LID_KNOWN_LAYERS = {"SURFACE", "SOIL", "PAVEMENT", "STORAGE", "DRAIN", "DRAINMAT", "REMOVALS"}

    current = None
    current_control_rule = None
    after_header = False

    for raw in lines:
        line = raw.rstrip("\n")

        # 1. Section header detection: [SECTION_NAME]
        m = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if m:
            current = m.group(1).upper()
            current_control_rule = None
            headers.setdefault(current, SECTION_HEADERS.get(current, []).copy())
            descriptions.setdefault(current, "")
            after_header = True
            continue

        if current is None:
            continue

        # [CONTROLS]: accumulate rule blocks by name
        if current == "CONTROLS":
            if line.lstrip().upper().startswith("RULE "):
                parts = line.strip().split(maxsplit=1)
                if len(parts) >= 2:
                    current_control_rule = parts[1]
                    sections[current][current_control_rule] = [line]
                else:
                    # Fallback for malformed rule line
                    current_control_rule = f"RULE_{len(sections[current])}"
                    sections[current][current_control_rule] = [line]
            elif current_control_rule:
                sections[current][current_control_rule][0] += "\n" + line
            continue

        # [TRANSECTS]: HEC-2 format (NC, X1, GR records)
        if current == 'TRANSECTS':
             if line.startswith(";") or not line.strip():
                 continue
                 
             tokens = line.strip().split()
             if not tokens: continue
             
             record_type = tokens[0].upper()
             
             if record_type == "NC":
                 if len(tokens) >= 4:
                     current_nc = tokens[1:4]
                 continue
                 
             elif record_type == "X1":
                 if len(tokens) < 2: continue
                 tid = tokens[1]
                 current_transect_id = tid
                 if tid not in temp_transects:
                     temp_transects[tid] = {
                         "nc": list(current_nc),
                         "x1": [],
                         "gr": []
                     }
                 temp_transects[tid]["x1"] = tokens[2:]
                 continue
                 
             elif record_type == "GR":
                 if not current_transect_id or current_transect_id not in temp_transects:
                     continue
                 raw_vals = tokens[1:]
                 for i in range(0, len(raw_vals), 2):
                     if i+1 < len(raw_vals):
                         elev = raw_vals[i]
                         sta = raw_vals[i+1]
                         temp_transects[current_transect_id]["gr"].append([sta, elev])
                 continue
             else:
                 continue

        # [LID_CONTROLS] - Multi-line: Type line + Layer lines
        if current == 'LID_CONTROLS':
             if line.startswith(";") or not line.strip():
                 continue
             tokens = line.strip().split()
             if len(tokens) < 2: continue
             
             lid_id = tokens[0]
             second = tokens[1].upper()
             
             # Type definition line: "LID1 BC"
             if second in LID_KNOWN_TYPES:
                 if lid_id not in temp_lid_controls:
                     temp_lid_controls[lid_id] = {"type": second, "layers": {}}
                 else:
                     temp_lid_controls[lid_id]["type"] = second
                 continue
             
             # Layer line: "LID1 SURFACE 0.0 0.0 0.1 1.0 5"
             if second in LID_KNOWN_LAYERS:
                 if lid_id not in temp_lid_controls:
                     temp_lid_controls[lid_id] = {"type": "", "layers": {}}
                 
                 if second == "REMOVALS":
                     # REMOVALS: pairs of [pollutant, percent]
                     raw_vals = tokens[2:]
                     pairs = []
                     for i in range(0, len(raw_vals), 2):
                         if i+1 < len(raw_vals):
                             pairs.append([raw_vals[i], raw_vals[i+1]])
                     temp_lid_controls[lid_id]["layers"]["REMOVALS"] = pairs
                 else:
                     temp_lid_controls[lid_id]["layers"][second] = tokens[2:]
                 continue
             
             continue

        # 2. Capture description comment (single `;` line immediately after header)
        if after_header:
            if line.lstrip().startswith(";") and not line.lstrip().startswith(";;"):
                descriptions[current] = line.lstrip("; ").strip()
                after_header = False
                continue
            elif line.strip() != "":
                after_header = False

        if not line.strip():
            continue

        # 3. Skip ordinary comments (single `;`; double `;;` are column headers)
        if line.lstrip().startswith(";") and not line.lstrip().startswith(";;"):
            continue

        # 4. Parse column headers (`;;`-prefixed lines)
        if line.strip().startswith(";;"):
            content = line.strip()[2:].strip()
            if content and not all(c in "- " for c in content):
                if not headers[current]:
                    headers[current] = re.split(r"\s{2,}", content)
            continue

        # 5. Parse data lines
        tokens = re.split(r"\s+", line.strip())
        if not tokens:
            continue

        # --- Section-specific handlers ---

        # [TAGS]
        if current == "TAGS":
            if len(tokens) >= 3:
                element_id = tokens[1]
                tag_name = " ".join(tokens[2:])
                tags[element_id] = tag_name
            continue

        # [HYDROGRAPHS]: Rain Gage mapping or RTK parameter rows
        if current == 'HYDROGRAPHS':
            if len(tokens) == 2:
                hydrograph_id, gage_name = tokens[0], tokens[1]
                # Store mapping in temp dict
                temp_hydro_gages[hydrograph_id] = gage_name
            elif len(tokens) >= 9:
                hydrograph, month, response = tokens[0], tokens[1], tokens[2]
                key = f"{hydrograph} {month} {response}"
                values = tokens[3:9]
                sections[current][key] = values
                headers[current] = [
                    'Hydrograph', 'Month', 'Response', 'R', 'T', 'K', 'Dmax', 'Drecov', 'Dinit', 'RainGage'
                ]
            continue

        # [PATTERNS]: aggregate multi-line multiplier values
        if current == 'PATTERNS':
             if len(tokens) < 2:
                 continue
             
             pid = tokens[0]
             
             # Initialize accumulator
             if pid not in temp_patterns:
                 temp_patterns[pid] = {"type": "", "values": []}
             
             # Check if second token is a type keyword
             potential_type = tokens[1].upper()
             known_types = {"MONTHLY", "DAILY", "HOURLY", "WEEKEND"}
             
             vals_start_idx = 1
             if potential_type in known_types:
                 temp_patterns[pid]["type"] = potential_type
                 vals_start_idx = 2
             
             # Collect all remaining tokens as values
             for v in tokens[vals_start_idx:]:
                 temp_patterns[pid]["values"].append(v)
             
             continue

        # [TIMESERIES]: aggregate inline data or external file references
        if current == 'TIMESERIES':
             if len(tokens) < 2:
                 continue
             
             ts_id = tokens[0]
             
             if ts_id not in temp_timeseries:
                 temp_timeseries[ts_id] = {"type": "Inline", "file": "", "values": []}

             # Check for FILE keyword
             if len(tokens) >= 3 and tokens[1].upper() == "FILE":
                 temp_timeseries[ts_id]["type"] = "External"
                 temp_timeseries[ts_id]["file"] = " ".join(tokens[2:])
             else:
                 vals = tokens[1:]
                 temp_timeseries[ts_id]["values"].append(vals)

             continue

        # [CURVES]: aggregate typed XY data points
        if current == 'CURVES':
             if len(tokens) < 3:
                 continue
             
             curve_id = tokens[0]
             
             # Initialize accumulator
             if curve_id not in temp_curves:
                 temp_curves[curve_id] = {"type": "", "points": []}

             c_data = temp_curves[curve_id]
             
             x_val, y_val = None, None
             
             if len(tokens) >= 4:
                 # Name Type X Y
                 c_data["type"] = tokens[1]
                 x_val, y_val = tokens[2], tokens[3]
             elif len(tokens) == 3:
                 # Name X Y
                 x_val, y_val = tokens[1], tokens[2]
             
             if x_val is not None and y_val is not None:
                 c_data["points"].append((x_val, y_val))
                 
             continue

        # [TREATMENT]: expression may contain spaces
        if current == 'TREATMENT':
            if len(tokens) >= 3:
                node_id = tokens[0]
                pollutant = tokens[1]
                expression = " ".join(tokens[2:])
                sections[current][node_id] = [pollutant, expression]
            continue

        # [VERTICES] / [POLYGONS]: accumulate XY coordinate pairs
        if current in ('VERTICES', 'POLYGONS'):
             if len(tokens) < 3:
                 continue
             
             elm_id = tokens[0]
             x_val, y_val = tokens[1], tokens[2]
             
             temp_points[current][elm_id].append((x_val, y_val))
             continue

        # [TITLE]: accumulate as a single text block
        if current == "TITLE":
            key = "Project Description"
            if key not in sections[current]:
                sections[current][key] = []
                if not headers.get(current):
                   headers[current] = ["Content"]
            
            sections[current][key].append(line.strip())
            continue

        # Generic parsing: first token = element ID, rest = values
        element_id = tokens[0]
        if current == "OPTIONS":
            values = [" ".join(tokens[1:])]
        else:
            values = tokens[1:]
        sections[current][element_id] = values

    # Post-process: strip trailing whitespace from control rule text
    if "CONTROLS" in sections:
        for rule_id in sections["CONTROLS"]:
            raw_text = sections["CONTROLS"][rule_id][0]
            sections["CONTROLS"][rule_id][0] = raw_text.strip()

    # Finalize CURVES
    if temp_curves:
        # Ensure CURVES section exists
        if "CURVES" not in sections:
            sections["CURVES"] = {}
            
        for cid, data in temp_curves.items():
            points_json = json.dumps(data["points"])
            sections["CURVES"][cid] = [data["type"], points_json]

    for sec_name in ['VERTICES', 'POLYGONS']:
        if sec_name in temp_points:
            if sec_name not in sections:
                sections[sec_name] = {}
            for eid, points in temp_points[sec_name].items():
                sections[sec_name][eid] = [json.dumps(points)]

    # Finalize HYDROGRAPHS: inject Rain Gage from mapping lines
    if "HYDROGRAPHS" in sections and temp_hydro_gages:
        gages = temp_hydro_gages
        for key, values in sections["HYDROGRAPHS"].items():
            parts = key.split(" ", 1)
            if parts:
                hid = parts[0]
                gage = gages.get(hid, "")
                values.append(gage)
    
    # Finalize PATTERNS
    if temp_patterns:
        # Ensure PATTERNS section exists
        if "PATTERNS" not in sections:
            sections["PATTERNS"] = {}
            
        for pid, pdata in temp_patterns.items():
            j_vals = json.dumps(pdata["values"])
            sections["PATTERNS"][pid] = [pdata["type"], j_vals]

    # Finalize TIMESERIES
    if temp_timeseries:
        if "TIMESERIES" not in sections:
            sections["TIMESERIES"] = {}
            
        for tid, tdata in temp_timeseries.items():
            if tdata["type"] == "External":
                sections["TIMESERIES"][tid] = ["External", tdata["file"]]
            else:
                j_vals = json.dumps(tdata["values"])
                sections["TIMESERIES"][tid] = ["Inline", j_vals]

    # Finalize TRANSECTS
    if temp_transects:
        if "TRANSECTS" not in sections:
            sections["TRANSECTS"] = {}
        
        for tid, tdata in temp_transects.items():
            nc = tdata["nc"]
            x1 = tdata["x1"]
            gr = tdata["gr"]
            nL, nR, nC = (nc + ["0", "0", "0"])[:3]
            val_xL = x1[1] if len(x1) > 1 else "0"
            val_xR = x1[2] if len(x1) > 2 else "0"
            val_L = x1[6] if len(x1) > 6 else "0"
            val_W = x1[7] if len(x1) > 7 else "0"
            val_E = x1[8] if len(x1) > 8 else "0"
            gr_json = json.dumps(gr)
            row_data = [nL, nR, nC, val_xL, val_xR, val_L, val_W, val_E, gr_json]
            sections["TRANSECTS"][tid] = row_data

    # Finalize LID_CONTROLS
    if temp_lid_controls:
        if "LID_CONTROLS" not in sections:
            sections["LID_CONTROLS"] = {}
        for lid_id, ldata in temp_lid_controls.items():
            layers_json = json.dumps(ldata["layers"])
            sections["LID_CONTROLS"][lid_id] = [ldata["type"], layers_json]

    # Post-process INFILTRATION based on OPTIONS
    infil_method = "HORTON"
    if "OPTIONS" in sections and "INFILTRATION" in sections["OPTIONS"]:
          val_list = sections["OPTIONS"]["INFILTRATION"]
          if val_list and val_list[0].upper().strip() == "GREEN_AMPT":
             infil_method = "GREEN_AMPT"
    
    if infil_method == "GREEN_AMPT":
        headers["INFILTRATION"] = ["Subcatch", "Suction Head (in)", "Conductivity (in/hr)", "Initial Deficit (frac.)"]
        
        if "INFILTRATION" in sections:
            for sub_id, vals in sections["INFILTRATION"].items():
                if len(vals) > 3:
                     sections["INFILTRATION"][sub_id] = vals[:3]

    return INPParseResult(sections, headers, tags, descriptions)



# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: GEOMETRY PARSING & SPATIAL UTILITIES
#   Extracts node coordinates, link paths, and subcatchment polygons from INP
#   lines. Also provides distance, centroid, and bounding-box helper functions
#   used by the rename detection logic.
# ═══════════════════════════════════════════════════════════════════════════════
@dataclass
class SWMMGeometry:
    """Parsed spatial data from an INP file."""
    nodes: Dict[str, Tuple[float, float]]
    links: Dict[str, List[Tuple[float, float]]]
    subpolys: Dict[str, List[List[Tuple[float, float]]]]

def _parse_geom_iter(lines) -> SWMMGeometry:
    """Extract node coordinates, link paths, and subcatchment polygons from INP lines."""
    nodes_raw: Dict[str, Tuple[float, float]] = {}
    vertices_raw: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    links_endpoints: Dict[str, Tuple[str, str]] = {}
    subpolys_raw: Dict[str, List[List[Tuple[float, float]]]] = {}

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
            
            if sub not in subpolys_raw:
                subpolys_raw[sub] = [[]]

            current_ring = subpolys_raw[sub][-1]
            
            # Start a new ring if current ring is closed
            if len(current_ring) >= 3 and current_ring[0] == current_ring[-1]:
                current_ring = []
                subpolys_raw[sub].append(current_ring)
            
            current_ring.append((x, y))

    # Assemble link paths: start node -> vertices -> end node
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


# --- Spatial Helpers (planar XY in ft → m) ---

_FEET_TO_M = 0.3048

def _dist_m_xy(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    dx = (p2[0] - p1[0]) * _FEET_TO_M
    dy = (p2[1] - p1[1]) * _FEET_TO_M
    return math.hypot(dx, dy)

def _polyline_length_m(coords: List[Tuple[float, float]]) -> float:
    if not coords or len(coords) < 2:
        return 0.0
    return sum(_dist_m_xy(a, b) for a, b in zip(coords[:-1], coords[1:]))

def _centroid_xy(coords: Any) -> Optional[Tuple[float, float]]:
    """Compute the arithmetic mean centroid of a coordinate set (single or multi-ring)."""
    if not coords:
        return None
    
    # Flatten multi-ring coordinates
    points = []
    if isinstance(coords[0], list):
        for ring in coords:
            points.extend(ring)
    else:
        points = coords
        
    if not points:
        return None
        
    x = sum(p[0] for p in points) / len(points)
    y = sum(p[1] for p in points) / len(points)
    return (x, y)

def _bbox_area_m2(coords: Any) -> float:
    """Compute bounding-box area in square meters from coordinate set."""
    if not coords:
        return 0.0
        
    points = []
    if isinstance(coords[0], list):
        for ring in coords:
            points.extend(ring)
    else:
        points = coords
        
    if not points: 
        return 0.0

    xs = [p[0] for p in points]; ys = [p[1] for p in points]
    w_ft = max(xs) - min(xs)
    h_ft = max(ys) - min(ys)
    return (w_ft * _FEET_TO_M) * (h_ft * _FEET_TO_M)

def _ratio_close(a: float, b: float, tol=0.10) -> bool:
    if a == 0 or b == 0:
        return False
    r = a / b
    return (1 - tol) <= r <= (1 + tol)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5: RENAME DETECTION
#   Identifies elements that were renamed between files by matching spatial
#   proximity and attribute similarity. Uses a grid-based SpatialIndex to
#   avoid O(N²) comparisons. Covers nodes, links, and subcatchments.
# ═══════════════════════════════════════════════════════════════════════════════

class SpatialIndex:
    """Grid-based spatial index for accelerating nearest-neighbor queries."""
    def __init__(self, cell_size_ft: float = 200.0):
        self.cell_size = cell_size_ft
        self.grid: Dict[Tuple[int, int], List[Tuple[str, float, float]]] = defaultdict(list)

    def _get_cell(self, x: float, y: float) -> Tuple[int, int]:
        return (int(x // self.cell_size), int(y // self.cell_size))

    def add(self, id: str, x: float, y: float):
        cell = self._get_cell(x, y)
        self.grid[cell].append((id, x, y))

    def query_candidates(self, x: float, y: float, radius_ft: float = 0.0) -> List[Tuple[str, float, float]]:
        """Return items from the containing cell and its 8 neighbors."""
        cx, cy = self._get_cell(x, y)
        candidates = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                candidates.extend(self.grid.get((cx + dx, cy + dy), []))
        return candidates
def _build_node_renames(pr1: INPParseResult, pr2: INPParseResult,
                        g1: SWMMGeometry, g2: SWMMGeometry,
                        eps_m: float = 0.5 * _FEET_TO_M) -> Dict[str, str]:
    """Identify renamed nodes by matching coordinates within tolerance."""
    node_secs = ("JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE")
    ids1 = set().union(*[set(pr1.sections.get(s, {})) for s in node_secs])
    ids2 = set().union(*[set(pr2.sections.get(s, {})) for s in node_secs])

    u1 = [nid for nid in ids1 if nid not in ids2]
    u2 = [nid for nid in ids2 if nid not in ids1]

    n1 = g1.nodes if g1 else {}
    n2 = g2.nodes if g2 else {}

    # Index file-2 unique nodes for spatial lookup
    idx = SpatialIndex(cell_size_ft=500.0)
    for new_id in u2:
        if new_id in n2:
            x, y = n2[new_id]
            idx.add(new_id, x, y)

    pairs = []
    for old_id in u1:
        if old_id not in n1:
            continue
        p1 = n1[old_id]
        x1, y1 = p1
        
        best = None
        best_d = float("inf")
        
        candidates = idx.query_candidates(x1, y1)

        for new_id, x2, y2 in candidates:
            # Quick bounding-box pre-filter
            tol_ft = eps_m / _FEET_TO_M
            if abs(x1 - x2) > tol_ft or abs(y1 - y2) > tol_ft:
                continue

            d = _dist_m_xy((x1, y1), (x2, y2))
            
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
    """Identify renamed links by matching connectivity, length, and centroid proximity."""
    link_secs = ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS")
    ids1 = set().union(*[set(pr1.sections.get(s, {})) for s in link_secs])
    ids2 = set().union(*[set(pr2.sections.get(s, {})) for s in link_secs])

    u1 = [lid for lid in ids1 if lid not in ids2]
    u2 = [lid for lid in ids2 if lid not in ids1]

    # Helper to look up start/end node IDs for a link
    def endpoints(pr: INPParseResult, lid: str) -> tuple:
        for s in link_secs:
            if lid in pr.sections.get(s, {}):
                vals = pr.sections[s][lid]
                if len(vals) >= 2:
                    return (vals[0], vals[1])
        return (None, None)

    idx = SpatialIndex(cell_size_ft=500.0)
    link2_meta = {}  # Cached metadata for file-2 links
    
    for new_id in u2:
        coords2 = g2.links.get(new_id) if g2 else None
        if not coords2 or len(coords2) < 2:
            continue
        c2 = _centroid_xy(coords2)
        if c2:
            idx.add(new_id, c2[0], c2[1])
            link2_meta[new_id] = {
                "coords": coords2,
                "len": _polyline_length_m(coords2),
                "endpoints": endpoints(pr2, new_id),
                "centroid": c2
            }

    renames: Dict[str, str] = {}
    used_new = set()
    inv_node_renames = {v: k for k, v in node_renames.items()}

    for old_id in u1:
        coords1 = g1.links.get(old_id) if g1 else None
        if not coords1 or len(coords1) < 2:
            continue
        e1 = endpoints(pr1, old_id)
        len1 = _polyline_length_m(coords1)
        c1 = _centroid_xy(coords1)
        if not c1: continue

        best = None
        best_score = float("inf")
        
        candidates = idx.query_candidates(c1[0], c1[1])

        for new_id, _, _ in candidates:
            if new_id in used_new: 
                continue
                
            meta2 = link2_meta.get(new_id)
            if not meta2: continue
            
            e2 = meta2["endpoints"]
            e2_mapped = tuple(inv_node_renames.get(x, x) for x in e2)
            endpoint_ok = set(e1) == set(e2_mapped)

            len2 = meta2["len"]
            if not _ratio_close(max(len1, 1e-6), max(len2, 1e-6), tol=len_tol):
                if not endpoint_ok:
                    continue

            c2 = meta2["centroid"]
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
    """Identify renamed subcatchments by matching centroid proximity and bounding-box area."""
    s = "SUBCATCHMENTS"
    ids1 = set(pr1.sections.get(s, {}))
    ids2 = set(pr2.sections.get(s, {}))
    u1 = [sid for sid in ids1 if sid not in ids2]
    u2 = [sid for sid in ids2 if sid not in ids1]

    idx = SpatialIndex(cell_size_ft=1000.0)
    sub2_meta = {}

    for new_id in u2:
        poly2 = g2.subpolys.get(new_id) if g2 else None
        if not poly2 or len(poly2) < 3:
            continue
        c2 = _centroid_xy(poly2)
        if c2:
            idx.add(new_id, c2[0], c2[1])
            sub2_meta[new_id] = {
                "centroid": c2,
                "area": _bbox_area_m2(poly2) or 1.0,
                "poly": poly2
            }

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
        
        candidates = idx.query_candidates(c1[0], c1[1])
        
        for new_id, _, _ in candidates:
            if new_id in used_new: continue
            
            meta2 = sub2_meta.get(new_id)
            if not meta2: continue
            
            a2 = meta2["area"]
            if not _ratio_close(a1, a2, tol=area_tol):
                continue
                
            c2 = meta2["centroid"]
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
    """Remap geometry keys from new IDs back to old IDs for renamed elements."""
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


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6: DIFF ENGINE
#   Compares parsed sections between two INP files to identify added, removed,
#   and changed elements. Includes field-level numerical diffs and
#   tolerance-based filtering.
# ═══════════════════════════════════════════════════════════════════════════════
@dataclass
class DiffSection:
    """Added, removed, and changed elements for a single INP section."""
    added: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    changed: Dict[str, Tuple[List[str], List[str]]] = field(default_factory=dict)

def _calculate_slope(conduit_vals: List[str], sections: Dict[str, Dict[str, List[str]]]) -> Optional[float]:
    """Calculate conduit slope: (InOffset - OutOffset) / Length."""
    try:
        # Indices per SECTION_HEADERS["CONDUITS"]: Length=2, InOffset=4, OutOffset=5
        length = float(conduit_vals[2])
        if length <= 0:
            return 0.0

        in_offset = float(conduit_vals[4]) if len(conduit_vals) > 4 else 0.0
        out_offset = float(conduit_vals[5]) if len(conduit_vals) > 5 else 0.0
        
        return (in_offset - out_offset) / length
            
    except (ValueError, IndexError):
        pass
        
    return None


def compare_sections(secs1: Dict[str, Dict[str, List[str]]],
                     secs2: Dict[str, Dict[str, List[str]]],
                     headers1: Dict[str, List[str]],
                     headers2: Dict[str, List[str]],
                     progress_callback=None) -> Tuple[Dict[str, DiffSection], Dict[str, List[str]]]:
    """Compare all sections between two parsed INP files. Returns (diffs, headers)."""
    out: Dict[str, DiffSection] = {}
    all_headers: Dict[str, List[str]] = {}
    
    all_sections = sorted(set(secs1) | set(secs2))
    total_secs = len(all_sections)

    for i, sec in enumerate(all_sections):
        if progress_callback:
            pct = 40 + (i / max(total_secs, 1) * 50)
            progress_callback(pct, f"Comparing {sec}...")

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

def _calculate_field_diffs(old_vals: List[str], new_vals: List[str], headers: List[str], section: str,
                           secs1: Dict[str, Dict[str, List[str]]] = None,
                           secs2: Dict[str, Dict[str, List[str]]] = None) -> Dict[str, float]:
    """Compute numerical deltas for key fields in changed records (e.g., Length, InvertElev)."""
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
        fields_to_diff = {"Length": 2, "Roughness": 3, "InOffset": 4, "OutOffset": 5}
        for field, idx in fields_to_diff.items():
            old_v, new_v = get_val(old_vals, idx), get_val(new_vals, idx)
            if old_v is not None and new_v is not None:
                diffs[field] = new_v - old_v

        # Derived slope diff
        if secs1 is not None and secs2 is not None:
            slope1 = _calculate_slope(old_vals, secs1)
            slope2 = _calculate_slope(new_vals, secs2)
            if slope1 is not None and slope2 is not None:
                diffs["Slope"] = slope2 - slope1


    elif section == "JUNCTIONS":
        invert_idx, max_depth_idx = 0, 1

        old_invert = get_val(old_vals, invert_idx)
        new_invert = get_val(new_vals, invert_idx)
        if old_invert is not None and new_invert is not None:
            diffs["InvertElev"] = new_invert - old_invert

        old_max_depth = get_val(old_vals, max_depth_idx)
        new_max_depth = get_val(new_vals, max_depth_idx)
        if old_max_depth is not None and new_max_depth is not None:
            diffs["MaxDepth"] = new_max_depth - old_max_depth

        # Derived rim elevation (Invert + MaxDepth)
        if old_invert is not None and old_max_depth is not None:
            diffs["RimElevation_old"] = old_invert + old_max_depth
        if new_invert is not None and new_max_depth is not None:
            diffs["RimElevation_new"] = new_invert + new_max_depth
        if "RimElevation_old" in diffs and "RimElevation_new" in diffs:
            diffs["RimElevation_diff"] = diffs["RimElevation_new"] - diffs["RimElevation_old"]

    return diffs

def _filter_changes_by_tolerance(diffs: Dict[str, DiffSection], tolerances: Dict[str, float], renames: Dict[str, Dict[str, str]] = None):
    """Remove changed items where all numerical differences fall within specified tolerances."""
    if not tolerances:
        return

    # Check if any tolerance values are actually set (non-zero)
    has_any_tolerance = any(v > 0 for v in tolerances.values() if isinstance(v, (int, float)))
    if not has_any_tolerance:
        return

    def get_float(val_str: str) -> Optional[float]:
        try:
            return float(val_str)
        except (ValueError, TypeError):
            return None


    # Slope tolerance check helper
    slope_tol = tolerances.get("CONDUIT_SLOPE", 0)
    has_slope_tol = slope_tol > 0
    
    for sec, diff_section in diffs.items():
        ids_to_remove = []
        for item_id, (old_vals, new_vals) in diff_section.changed.items():
            # Skip renamed items — renames are always flagged as changes
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
                        if i == 0:
                            tol = tolerances.get("JUNCTION_INVERT", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                        elif i == 1:
                            tol = tolerances.get("JUNCTION_DEPTH", 0)
                            if tol > 0 and abs(v1_f - v2_f) <= tol:
                                fields_within_tolerance.add(i)
                                field_within_tol = True
                    
                    if field_within_tol:
                        continue  # Skip this field, it's within tolerance

                is_truly_different = True
                break
            
            # Slope tolerance (not applied without full section data; see note)
            if not is_truly_different and sec == "CONDUITS" and has_slope_tol:
                pass

            if not is_truly_different:
                ids_to_remove.append(item_id)

        for item_id in ids_to_remove:
            del diff_section.changed[item_id]
        
        if ids_to_remove:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7: PUBLIC API
#   Main entry point called by the web worker. Orchestrates parsing, spatial
#   reconciliation, diffing, tolerance filtering, and JSON output assembly.
# ═══════════════════════════════════════════════════════════════════════════════

def _to_text_io(payload) -> io.StringIO:
    """Convert bytes/str/buffer input to a StringIO for line-by-line parsing."""
    if isinstance(payload, str):
        return io.StringIO(payload)
    if isinstance(payload, (bytes, bytearray)):
        data = payload
    elif isinstance(payload, memoryview):
        data = payload.tobytes()
    else:
        try:
            data = bytes(payload)
        except Exception as e:
            raise TypeError(f"Unsupported input type for INP bytes: {type(payload)!r}") from e
    return io.StringIO(data.decode("utf-8", "ignore"))


def run_compare(file1_bytes, file2_bytes, tolerances_py=None, progress_callback=None) -> str:
    """Main entry point: parse two INP files, detect renames, diff, and return JSON results."""
    f1 = _to_text_io(file1_bytes)
    f2 = _to_text_io(file2_bytes)

    if progress_callback: progress_callback(5, "Parsing inputs...")

    pr1 = _parse_inp_iter(f1)
    if progress_callback: progress_callback(10, "Parsed File 1...")
    pr2 = _parse_inp_iter(f2)
    if progress_callback: progress_callback(15, "Parsed File 2...")

    f1.seek(0); f2.seek(0)
    g1 = _parse_geom_iter(f1)
    g2 = _parse_geom_iter(f2)
    if progress_callback: progress_callback(20, "Parsed Geometry...")

    # Check for infiltration method mismatch
    warnings = {}

    def get_infil_method(pr):
        if "OPTIONS" in pr.sections and "INFILTRATION" in pr.sections["OPTIONS"]:
            val = pr.sections["OPTIONS"]["INFILTRATION"]
            return val[0].upper().strip() if val else "HORTON"
        return "HORTON"

    m1 = get_infil_method(pr1)
    m2 = get_infil_method(pr2)

    if m1 != m2:
        warnings["INFILTRATION"] = f"Files use differing infiltration models: {m1} vs {m2}"
        # Clear incompatible data
        if "INFILTRATION" in pr1.sections: pr1.sections["INFILTRATION"] = {}
        if "INFILTRATION" in pr2.sections: pr2.sections["INFILTRATION"] = {}
        pr1.headers["INFILTRATION"] = []
        pr2.headers["INFILTRATION"] = []

    # Handle tolerances (may arrive as JS Proxy or Python dict)
    tolerances = {}
    if tolerances_py is not None:
        if hasattr(tolerances_py, 'to_py'):
            tolerances = tolerances_py.to_py()
        else:
            tolerances = tolerances_py

    # Spatial reconciliation: detect renamed elements via geometry matching
    if progress_callback: progress_callback(25, " Reconciling spatial data...")
    renames = spatial_reconcile_and_remap_using_geom(pr1, pr2, g1, g2)
    if progress_callback: progress_callback(35, " Spatial reconciliation done...")

    # Compare sections
    if progress_callback: progress_callback(40, "Comparing sections...")
    diffs, headers = compare_sections(pr1.sections, pr2.sections, pr1.headers, pr2.headers, progress_callback)

    # Inject warning sections so frontend can display them
    for sec in warnings:
        if sec not in diffs:
            diffs[sec] = DiffSection()
            headers[sec] = []

    # Force renamed items into "changed" even if attributes are identical

    for sec, mapping in renames.items():
        if sec not in diffs:
            diffs[sec] = DiffSection()
            headers[sec] = pr1.headers.get(sec) or pr2.headers.get(sec, [])
        
        for old_id in mapping:
            if old_id not in diffs[sec].changed:
                v1 = pr1.sections.get(sec, {}).get(old_id, [])
                v2 = pr2.sections.get(sec, {}).get(old_id, [])
                diffs[sec].changed[old_id] = (v1, v2)

    # Filter by tolerance
    if progress_callback: progress_callback(90, "Filtering by tolerance...")
    _filter_changes_by_tolerance(diffs, tolerances, renames)

    # Inject "New Name" column for sections with renames
    for sec in diffs:
        if sec in renames and renames[sec]:
            # Add header
            if sec in headers and "New Name" not in headers[sec]:
                headers[sec].insert(1, "New Name")

    # Detect geometry-only changes (coordinates changed but attributes didn't)
    geometry_changes = {"nodes": [], "links": [], "subs": []}

    # Collect IDs already flagged as added/removed
    all_added_nodes = set()
    all_removed_nodes = set()
    all_added_links = set()
    all_removed_links = set()
    all_added_subs = set()
    all_removed_subs = set()

    node_sections = ["JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"]
    link_sections = ["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"]

    for sec in node_sections:
        if sec in diffs:
            all_added_nodes.update(diffs[sec].added)
            all_removed_nodes.update(diffs[sec].removed)
    for sec in link_sections:
        if sec in diffs:
            all_added_links.update(diffs[sec].added)
            all_removed_links.update(diffs[sec].removed)
    if "SUBCATCHMENTS" in diffs:
        all_added_subs.update(diffs["SUBCATCHMENTS"].added)
        all_removed_subs.update(diffs["SUBCATCHMENTS"].removed)

    # Nodes: compare coordinates
    common_nodes = set(g1.nodes.keys()) & set(g2.nodes.keys()) - all_added_nodes - all_removed_nodes
    for nid in common_nodes:
        xy1 = g1.nodes[nid]
        xy2 = g2.nodes[nid]
        if xy1 != xy2:
            geometry_changes["nodes"].append(nid)

    # Links: compare vertex lists
    common_links = set(g1.links.keys()) & set(g2.links.keys()) - all_added_links - all_removed_links
    for lid in common_links:
        v1 = g1.links[lid]
        v2 = g2.links[lid]
        if v1 != v2:
            geometry_changes["links"].append(lid)

    # Subcatchments: compare polygon rings
    common_subs = set(g1.subpolys.keys()) & set(g2.subpolys.keys()) - all_added_subs - all_removed_subs
    for sid in common_subs:
        p1 = g1.subpolys[sid]
        p2 = g2.subpolys[sid]
        if p1 != p2:
            geometry_changes["subs"].append(sid)

    # Build output JSON
    if progress_callback: progress_callback(95, "Building output...")

    # Inject computed slope column for CONDUITS
    if "CONDUITS" in diffs:
        if "CONDUITS" in headers:
            headers["CONDUITS"].append("Slope")
        
        d = diffs["CONDUITS"]

        def fmt_slope(val):
            return f"{val:.6f}" if val is not None else ""

        for rid in d.added:
            vals = pr2.sections["CONDUITS"][rid]
            s = _calculate_slope(vals, pr2.sections)
            vals.append(fmt_slope(s))
            
        for rid in d.removed:
            vals = pr1.sections["CONDUITS"][rid]
            s = _calculate_slope(vals, pr1.sections)
            vals.append(fmt_slope(s))

            
        for rid in d.changed:
            old_vals, new_vals = d.changed[rid]
            s1 = _calculate_slope(old_vals, pr1.sections)
            s2 = _calculate_slope(new_vals, pr2.sections)
            old_vals.append(fmt_slope(s1))
            new_vals.append(fmt_slope(s2))
    
    # Section-level summary
    summary_rows = [
        {"Section": s, "AddedCount": len(d.added), "RemovedCount": len(d.removed), "ChangedCount": len(d.changed)}
        for s, d in diffs.items()
    ]

    # Build rich diff payload
    diffs_json = {}
    for sec, d in diffs.items():
        s1 = pr1.sections.get(sec, {})
        s2 = pr2.sections.get(sec, {})
        
        has_new_name_col = sec in headers and "New Name" in headers[sec]
        
        def get_vals(source, rid, is_file2=False):
            vals = source.get(rid, []) or []
            if has_new_name_col:
                # Pad with "NA" for Added/Removed items
                vals = list(vals)
                vals.insert(0, "NA")
            return vals

        changed_json = {}
        for rid in d.changed:
            old_vals_orig, new_vals_orig = d.changed[rid]
            
            # Compute diffs on original values (before column injection)
            field_diffs = _calculate_field_diffs(old_vals_orig, new_vals_orig, headers.get(sec, []), sec, pr1.sections, pr2.sections)

            # Inject "New Name" column
            if has_new_name_col:
                new_name_val = renames.get(sec, {}).get(rid, "NA")
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
            "added":   { rid: get_vals(s2, rid, True) for rid in d.added },
            "removed": { rid: get_vals(s1, rid, False) for rid in d.removed },
            "changed": changed_json
        }

    # Expose full hydrograph data for drill-down UI
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
        "warnings": warnings,
        "geometry_changes": geometry_changes
    }
    return json.dumps(out)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8: SHAPEFILE EXPORT
#   Generates a ZIP archive containing point (nodes), polyline (links), and
#   polygon (subcatchments) shapefiles with old/new/diff attribute columns.
# ═══════════════════════════════════════════════════════════════════════════════

# WKT definitions for supported coordinate reference systems
CRS_WKT = {
    "EPSG:3735": 'PROJCS["NAD83 / Ohio South (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",40.03333333333333],PARAMETER["standard_parallel_2",38.73333333333333],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",-82.5],PARAMETER["false_easting",1968500.000000001],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192,AUTHORITY["EPSG","9003"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","3735"]]',
    "EPSG:3733": 'PROJCS["NAD83 / Ohio North (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",41.7],PARAMETER["standard_parallel_2",40.43333333333333],PARAMETER["latitude_of_origin",39.66666666666666],PARAMETER["central_meridian",-82.5],PARAMETER["false_easting",1968500.000000001],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192,AUTHORITY["EPSG","9003"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","3733"]]',
    "EPSG:6499": 'PROJCS["NAD83(2011) / Michigan South (ft)",GEOGCS["NAD83(2011)",DATUM["NAD83_National_Spatial_Reference_System_2011",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1116"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","6318"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",43.66666666666666],PARAMETER["standard_parallel_2",42.1],PARAMETER["latitude_of_origin",41.5],PARAMETER["central_meridian",-84.36666666666666],PARAMETER["false_easting",13123359.58005249],PARAMETER["false_northing",0],UNIT["foot",0.3048,AUTHORITY["EPSG","9002"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","6499"]]',
    "EPSG:2272": 'PROJCS["NAD83 / Pennsylvania South (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",40.96666666666667],PARAMETER["standard_parallel_2",39.93333333333333],PARAMETER["latitude_of_origin",39.33333333333334],PARAMETER["central_meridian",-77.75],PARAMETER["false_easting",1968500.000000001],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192,AUTHORITY["EPSG","9003"]],AXIS["X",EAST],AXIS["Y",NORTH],AUTHORITY["EPSG","2272"]]',
}

def generate_shapefiles_zip(diffs_json_str: str, geometry_json_str: str, crs_id: str = None, file_prefix: str = "export") -> bytes:
    """Generate a ZIP archive containing point/line/polygon shapefiles from comparison results."""
    try:
        diffs_full = json.loads(diffs_json_str)
        # The 'diffs' key inside the full output holds the actual diffs
        diffs = diffs_full.get("diffs", {}) if "diffs" in diffs_full else diffs_full
        
        if "geometry" in diffs_full:
            geom = diffs_full["geometry"]
        else:
            geom = json.loads(geometry_json_str)
        nodes1 = geom.get("nodes1", {})
        nodes2 = geom.get("nodes2", {})
        links1 = geom.get("links1", {})
        links2 = geom.get("links2", {})
        subs1 = geom.get("subs1", {})
        subs2 = geom.get("subs2", {})
        
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            
            def get_dbf_fields(section_names, records):
                """Build DBF field definitions (old/new/diff columns, 10-char names)."""
                fields_map = {} # original_header -> dbf_name
                dbf_fields = []
                
                seen_dbf_names = set(["ID", "Status"])
                
                for sec in section_names:
                    headers = SECTION_HEADERS.get(sec, [])
                    val_headers = headers[1:] if headers else []
                    
                    for h in val_headers:
                        if h in fields_map:
                            continue
                            
                        safe_h = re.sub(r'[^a-zA-Z0-9]', '', h)
                        base_candidate = safe_h[:8]
                        # Old field
                        cand_o = base_candidate + "_1"
                        suffix = 1
                        orig_cand_o = cand_o
                        while cand_o in seen_dbf_names:
                            suffix_str = str(suffix)
                            cand_o = orig_cand_o[:10-len(suffix_str)] + suffix_str
                            suffix += 1
                        seen_dbf_names.add(cand_o)
                        dbf_fields.append((cand_o, f"OLD:{h}", "C", 100, 0))
                        
                        # New field
                        cand_n = base_candidate + "_2"
                        suffix = 1
                        orig_cand_n = cand_n
                        while cand_n in seen_dbf_names:
                            suffix_str = str(suffix)
                            cand_n = orig_cand_n[:10-len(suffix_str)] + suffix_str
                            suffix += 1
                        seen_dbf_names.add(cand_n)
                        dbf_fields.append((cand_n, f"NEW:{h}", "C", 100, 0))
                        
                        fields_map[h] = base_candidate

                # Diff fields
                diff_keys = set()
                for _, _, _, _, _, diff_map in records:
                    if diff_map:
                        diff_keys.update(diff_map.keys())
                
                for h in sorted(diff_keys):
                    safe_h = re.sub(r'[^a-zA-Z0-9]', '', h)
                    candidate = safe_h[:8] + "_D"
                    
                    # Ensure uniqueness
                    original_candidate = candidate
                    suffix = 1
                    while candidate in seen_dbf_names:
                        suffix_str = str(suffix)
                        base_len = 10 - len(suffix_str)
                        candidate = original_candidate[:base_len] + suffix_str
                        suffix += 1
                        
                    seen_dbf_names.add(candidate)
                    fields_map[f"DIFF:{h}"] = candidate
                    dbf_fields.append((candidate, f"DIFF:{h}", "N", 18, 5))
                        
                return dbf_fields

            def write_shapefile(name, shape_type, records, coords_lookup1, coords_lookup2, dbf_fields):
                
                shpio = io.BytesIO()
                shxio = io.BytesIO()
                dbfio = io.BytesIO()
                
                w = shapefile.Writer(shp=shpio, shx=shxio, dbf=dbfio)
                w.shapeType = shape_type
                w.field("ID", "C", 50)
                w.field("Status", "C", 20)
                
                header_to_dbf_idx = {}
                for i, (dbf_name, orig_header, ftype, flen, fdec) in enumerate(dbf_fields):
                    w.field(dbf_name, ftype, flen, fdec)
                    header_to_dbf_idx[orig_header] = i
                
                count = 0
                for eid, status, section, old_values, new_values, diff_map in records:
                    coords = None
                    if status == "Removed":
                        coords = coords_lookup1.get(eid)
                    else:
                        coords = coords_lookup2.get(eid)
                        
                    if not coords:
                        continue
                        
                    # Write geometry
                    if shape_type == shapefile.POINT:
                        # coords is (x, y)
                        w.point(coords[0], coords[1])
                    elif shape_type == shapefile.POLYLINE:
                        # coords is [(x, y), ...]
                        w.line([coords])
                    elif shape_type == shapefile.POLYGON:
                        clean_rings = []
                        for ring in coords:
                            if not ring: continue
                            if ring[0] != ring[-1]:
                                ring.append(ring[0])
                            clean_rings.append(ring)
                        
                        if clean_rings:
                            w.poly(clean_rings)
                    
                    # Build attribute record
                    rec_vals = []
                    for _, _, ftype, _, _ in dbf_fields:
                        if ftype == "N":
                            rec_vals.append(0)
                        else:
                            rec_vals.append("")
                    
                    # Map old/new values to DBF columns
                    headers = SECTION_HEADERS.get(section, [])
                    val_headers = headers[1:] if headers else []
                    
                    for i, val in enumerate(old_values):
                        if i < len(val_headers):
                            h = val_headers[i]
                            lookup_key = f"OLD:{h}"
                            if lookup_key in header_to_dbf_idx:
                                idx = header_to_dbf_idx[lookup_key]
                                rec_vals[idx] = str(val)

                    for i, val in enumerate(new_values):
                        if i < len(val_headers):
                            h = val_headers[i]
                            lookup_key = f"NEW:{h}"
                            if lookup_key in header_to_dbf_idx:
                                idx = header_to_dbf_idx[lookup_key]
                                rec_vals[idx] = str(val)

                    # Map diff values
                    if diff_map:
                        for k, v in diff_map.items():
                            lookup_key = f"DIFF:{k}"
                            if lookup_key in header_to_dbf_idx:
                                idx = header_to_dbf_idx[lookup_key]
                                rec_vals[idx] = v
                        
                    w.record(eid, status, *rec_vals)
                    count += 1
                    
                w.close()
                
                if count > 0:
                    zf.writestr(f"{name}.shp", shpio.getvalue())
                    zf.writestr(f"{name}.shx", shxio.getvalue())
                    zf.writestr(f"{name}.dbf", dbfio.getvalue())
                    
            # Write .prj if CRS is known
                    if crs_id and crs_id in CRS_WKT:
                        zf.writestr(f"{name}.prj", CRS_WKT[crs_id])

            # --- Prepare Data ---
            
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
                    
                    def get_v(source, eid):
                        v = source.get(eid, [])
                        return v

                    for eid in added:
                        if eid not in processed_ids:
                            records.append((eid, "Added", sec, [], get_v(s2, eid), {}))
                            processed_ids.add(eid)
                            
                    for eid in removed:
                        if eid not in processed_ids:
                            records.append((eid, "Removed", sec, get_v(s1, eid), [], {}))
                            processed_ids.add(eid)
                            
                    for eid in changed:
                        if eid not in processed_ids:
                            diff_data = d.get("changed", {}).get(eid, {})
                            
                            diff_map = {}
                            if isinstance(diff_data, dict) and "diff_values" in diff_data:
                                diff_map = diff_data["diff_values"]
                                
                            records.append((eid, "Changed", sec, get_v(s1, eid), get_v(s2, eid), diff_map))
                            processed_ids.add(eid)
                            
                    for eid in s2:
                        if eid not in added and eid not in changed and eid not in processed_ids:
                            v = get_v(s2, eid)
                            records.append((eid, "Unchanged", sec, v, v, {}))
                            processed_ids.add(eid)
                            
                return records

            # Nodes
            node_sections = ["JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"]
            node_records = collect_records(node_sections)
            node_fields = get_dbf_fields(node_sections, node_records)
            write_shapefile(f"nodes_{file_prefix}", shapefile.POINT, node_records, nodes1, nodes2, node_fields)
            
            # Links
            link_sections = ["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"]
            link_records = collect_records(link_sections)
            link_fields = get_dbf_fields(link_sections, link_records)
            write_shapefile(f"links_{file_prefix}", shapefile.POLYLINE, link_records, links1, links2, link_fields)
            
            # Subcatchments
            sub_sections = ["SUBCATCHMENTS"]
            sub_records = collect_records(sub_sections)
            sub_fields = get_dbf_fields(sub_sections, sub_records)
            write_shapefile(f"subs_{file_prefix}", shapefile.POLYGON, sub_records, subs1, subs2, sub_fields)
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return b""
        
    zip_buffer.seek(0)
    return zip_buffer.read()
