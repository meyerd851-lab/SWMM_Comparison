# core_results.py
# -----------------------------------------------------------------------------
# SWMM .RPT parser + comparator (schema/token-based, no fixed column spans)
# Adapted for Web Worker usage (no tkinter, no file I/O)
# -----------------------------------------------------------------------------

import re
import json
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple

# =============================================================================
# CONFIG
# =============================================================================
ABS_TOL = 1e-6
REL_TOL = 1e-6

CAPTURE_UNPARSED_ROWS = True
NA = "NA"

# =============================================================================
# SECTION SPECS (NO SPANS)
# =============================================================================
# schema types:
#   - "str": one token
#   - "num": one token numeric-ish
#   - "pct": one token percent-ish (numeric parse strips trailing % if present)
#   - "time": TWO tokens: days + hr:min  (e.g., "0  11:55")
#
SECTION_SPECS: Dict[str, Dict[str, Any]] = {
    # -------------------------------------------------------------------------
    # Existing sections
    # -------------------------------------------------------------------------
    "Node Depth Summary": {
        "id_col": "Node",
        "columns": [
            "Node",
            "Type",
            "Average Depth feet",
            "Maximum Depth feet",
            "Maximum HGL feet",
            "Time of Max Occurrence",
            "Reported Max Depth feet",
        ],
        "schema": ["str", "str", "num", "num", "num", "time", "num"],
    },

    "Node Inflow Summary": {
        "id_col": "Node",
        "columns": [
            "Node",
            "Type",
            "Maximum Lateral Inflow CFS",
            "Maximum Total Inflow CFS",
            "Time of Max Occurrence",
            "Lateral Inflow Volume 10^6 gal",
            "Total Inflow Volume 10^6 gal",
            "Flow Balance Error Percent",
        ],
        "schema": ["str", "str", "num", "num", "time", "num", "num", "pct"],
    },

    "Link Flow Summary": {
        "id_col": "Link",
        "columns": [
            "Link",
            "Type",
            "Maximum |Flow| CFS",
            "Time of Max Occurrence",
            "Maximum |Veloc| ft/sec",
            "Max/Full Flow",
            "Max/Full Depth",
        ],
        "schema": ["str", "str", "num", "time", "num", "num", "num"],
    },

    "Subcatchment Runoff Summary": {
        "id_col": "Subcatchment",
        "columns": [
            "Subcatchment",
            "Total Precip in",
            "Total Runon in",
            "Total Evap in",
            "Total Infil in",
            "Total Runoff in",
            "Total Runoff 10^6 gal",
            "Peak Runoff CFS",
            "Runoff Coeff",
        ],
        "schema": ["str", "num", "num", "num", "num", "num", "num", "num", "num"],
    },

    "Outfall Loading Summary": {
        # NOTE: Some reports include pollutant columns after Total Volume.
        # This spec covers the common hydraulic-only layout.
        "id_col": "Outfall",
        "columns": [
            "Outfall",
            "Flow Frequency",
            "Avg Flow CFS",
            "Max Flow CFS",
            "Total Volume 10^6 gal",
        ],
        "schema": ["str", "str", "num", "num", "num"],
    },

    # -------------------------------------------------------------------------
    # NEW sections
    # -------------------------------------------------------------------------
    "Node Flooding Summary": {
        "id_col": "Node",
        "columns": [
            "Node",
            "Hours Flooded",
            "Maximum Rate CFS",
            "Time of Max Occurrence",
            "Total Flood Volume 10^6 gal",
            "Maximum Ponded Depth Feet",
        ],
        "schema": ["str", "num", "num", "time", "num", "num"],
    },

    "Node Surcharge Summary": {
        "id_col": "Node",
        "columns": [
            "Node",
            "Type",
            "Hours Surcharged",
            "Max Height Above Crown Feet",
            "Min Depth Below Rim Feet",
        ],
        "schema": ["str", "str", "num", "num", "num"],
    },

    "Pump Summary": {
        "id_col": "Pump",
        "columns": [
            "Pump",
            "Percent Utilized",
            "Number of Start-Ups",
            "Min Flow CFS",
            "Avg Flow CFS",
            "Max Flow CFS",
            "Total Volume 10^6 gal",
            "Power Usage Kw-hr",
            "% Time Off Pump Curve Low",
            "% Time Off Pump Curve High",
        ],
        "schema": ["str", "num", "num", "num", "num", "num", "num", "num", "num", "num"],
    },


    "Storage Unit Summary": {
        "id_col": "Storage Unit",
        "columns": [
            "Storage Unit",
            "Average Volume 1000 ft^3",
            "Avg Pcnt Full",
            "Evap Loss Pcnt",
            "Exfil Loss Pcnt",
            "Maximum Volume 1000 ft^3",
            "Max Pcnt Full",
            "Time of Max Occurrence",
            "Maximum Outflow CFS",
        ],
        "schema": ["str", "num", "num", "num", "num", "num", "num", "time", "num"],
    },
}

# Metric Configuration for Computed Columns
METRIC_CONFIG = {
    "Link Flow Summary": ("Maximum |Flow| CFS", "pct", "% Diff Max Flow"),
    "Node Depth Summary": ("Reported Max Depth feet", "abs", "Diff Max Depth"),
    "Node Flooding Summary": ("Hours Flooded", "abs", "Diff Hours Flooded"),
    "Node Inflow Summary": ("Total Inflow Volume 10^6 gal", "pct", "% Diff Total Inflow"),
    "Node Surcharge Summary": ("Hours Surcharged", "abs", "Diff Hours Surcharged"),
    "Outfall Loading Summary": ("Total Volume 10^6 gal", "pct", "% Diff Total Volume"),
    "Subcatchment Runoff Summary": ("Total Runoff 10^6 gal", "pct", "% Diff Total Runoff"),
}



# =============================================================================
# REGEX / HELPERS
# =============================================================================
RE_STARS = re.compile(r"^\s*\*{3,}\s*$")
RE_DASH = re.compile(r"^\s*-{5,}\s*$")
RE_WARNING = re.compile(r"^\s*WARNING\s+\d+:", re.IGNORECASE)


def clean(line: str) -> str:
    return line.rstrip("\n").rstrip("\r")


def is_blank(line: str) -> bool:
    return line.strip() == ""


def as_number(s: str) -> Optional[float]:
    t = str(s).strip()
    if t == "" or t == "-" or t.lower() == "nan" or t == NA:
        return None
    t = t.replace(",", "")
    if t.endswith("%"):
        t = t[:-1].strip()
    try:
        return float(t)
    except ValueError:
        return None


# =============================================================================
# DATA STRUCTURES
# =============================================================================
@dataclass
class ParsedSection:
    name: str
    id_col: str
    columns: List[str]
    schema: List[str]
    rows: Dict[str, Dict[str, str]] = field(default_factory=dict)
    row_order: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_jsonable(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "id_col": self.id_col,
            "columns": self.columns,
            "schema": self.schema,
            "rows": self.rows,
            "row_order": self.row_order,
            "meta": self.meta,
        }


@dataclass
class RPTParseResult:
    header_lines: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    blocks: Dict[str, str] = field(default_factory=dict)
    sections: Dict[str, ParsedSection] = field(default_factory=dict)

    def to_jsonable(self) -> Dict[str, Any]:
        return {
            "header_lines": self.header_lines,
            "warnings": self.warnings,
            "blocks": self.blocks,
            "sections": {k: v.to_jsonable() for k, v in self.sections.items()},
        }


@dataclass
class SectionSideBySide:
    section: str
    id_col: str
    out_columns: List[str]
    rows: List[Dict[str, Any]]
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_jsonable(self) -> Dict[str, Any]:
        return {
            "section": self.section,
            "id_col": self.id_col,
            "out_columns": self.out_columns,
            "rows": self.rows,
            "meta": self.meta,
        }


@dataclass
class RPTSideBySideResult:
    blocks_side_by_side: Dict[str, Dict[str, Optional[str]]] = field(default_factory=dict)
    sections: List[SectionSideBySide] = field(default_factory=list)

    def to_jsonable(self) -> Dict[str, Any]:
        return {
            "blocks_side_by_side": self.blocks_side_by_side,
            "sections": [s.to_jsonable() for s in self.sections],
        }


# =============================================================================
# SECTION HEADER DETECTION
# =============================================================================
def find_star_headers(lines: List[str]) -> List[Tuple[str, int, int]]:
    """
    Find blocks like:
      ************
      Title
      ************
    Returns list of (title, title_line_index, after_header_index)
    """
    headers: List[Tuple[str, int, int]] = []
    i = 0
    n = len(lines)
    while i + 2 < n:
        if RE_STARS.match(clean(lines[i])) and RE_STARS.match(clean(lines[i + 2])):
            title = clean(lines[i + 1]).strip()
            headers.append((title, i + 1, i + 3))
            i += 3
        else:
            i += 1
    return headers


# =============================================================================
# TOKEN/SCHEMA TABLE PARSING
# =============================================================================
def expected_token_count(schema: List[str]) -> int:
    return sum(2 if t == "time" else 1 for t in schema)


def parse_row_by_schema(tokens: List[str], columns: List[str], schema: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    i = 0
    for col, typ in zip(columns, schema):
        if typ == "time":
            if i + 1 < len(tokens):
                out[col] = f"{tokens[i]} {tokens[i+1]}"
            elif i < len(tokens):
                out[col] = tokens[i]
            else:
                out[col] = ""
            i += 2
        else:
            out[col] = tokens[i] if i < len(tokens) else ""
            i += 1
    return out


def parse_table_section(section_name: str, section_lines: List[str]) -> ParsedSection:
    spec = SECTION_SPECS[section_name]
    cols: List[str] = spec["columns"]
    schema: List[str] = spec["schema"]
    id_col: str = spec["id_col"]

    ps = ParsedSection(
        name=section_name,
        id_col=id_col,
        columns=cols,
        schema=schema,
        rows={},
        row_order=[],
        meta={"unparsed_rows": []} if CAPTURE_UNPARSED_ROWS else {},
    )

    # Find the dashed table block inside this section
    i = 0
    n = len(section_lines)
    while i < n and not RE_DASH.match(clean(section_lines[i])):
        i += 1
    if i >= n:
        return ps

    # Find second dashed line (end of header)
    j = i + 1
    while j < n and not RE_DASH.match(clean(section_lines[j])):
        j += 1
    if j >= n:
        return ps

    # Data starts after j until first blank line
    k = j + 1
    exp = expected_token_count(schema)

    while k < n:
        line = clean(section_lines[k])
        if is_blank(line) or RE_STARS.match(line):
            break
        if RE_DASH.match(line):
            k += 1
            continue

        tokens = line.split()
        if len(tokens) < 2:
            k += 1
            continue

        if len(tokens) != exp and CAPTURE_UNPARSED_ROWS:
            ps.meta["unparsed_rows"].append(
                {
                    "raw": line,
                    "tokens": tokens,
                    "expected_tokens": exp,
                    "actual_tokens": len(tokens),
                }
            )

        row = parse_row_by_schema(tokens, cols, schema)
        rid = row.get(id_col, "").strip()
        if rid:
            ps.rows[rid] = row
            ps.row_order.append(rid)

        k += 1

    ps.meta["row_count"] = len(ps.row_order)
    ps.meta["expected_tokens_per_row"] = exp
    return ps


# =============================================================================
# FULL RPT PARSE
# =============================================================================
def parse_swmm_rpt(text: str) -> RPTParseResult:
    lines = text.splitlines()
    res = RPTParseResult()

    # header-ish lines until first stars divider
    i = 0
    n = len(lines)
    while i < n:
        line = clean(lines[i])
        if RE_WARNING.match(line):
            res.warnings.append(line.strip())
            i += 1
            continue
        if RE_STARS.match(line):
            break
        if not is_blank(line):
            res.header_lines.append(line)
        i += 1

    headers = find_star_headers(lines)

    # Parse each section in isolation: end at next section title line
    for idx, (title, title_line_idx, after_header_idx) in enumerate(headers):
        start = after_header_idx
        end = (headers[idx + 1][1] - 1) if (idx + 1 < len(headers)) else n
        section_lines = lines[start:end]

        if title in SECTION_SPECS:
            res.sections[title] = parse_table_section(title, section_lines)
        else:
            block = "\n".join(clean(x) for x in section_lines).strip()
            if block:
                res.blocks[title] = block

    return res


# =============================================================================
# SIDE-BY-SIDE TABLE BUILD
# =============================================================================
def values_equal(va: str, vb: str) -> bool:
    na = as_number(va)
    nb = as_number(vb)
    if na is not None and nb is not None:
        diff = abs(na - nb)
        tol = max(ABS_TOL, REL_TOL * max(abs(na), abs(nb)))
        return diff <= tol
    return str(va).strip() == str(vb).strip()


def build_section_side_by_side(
    sa: Optional[ParsedSection],
    sb: Optional[ParsedSection],
    section_name: str,
) -> SectionSideBySide:
    # Choose spec based on whichever exists
    if sa is not None:
        id_col, cols = sa.id_col, sa.columns
    elif sb is not None:
        id_col, cols = sb.id_col, sb.columns
    else:
        spec = SECTION_SPECS[section_name]
        id_col, cols = spec["id_col"], spec["columns"]

    base_cols = [c for c in cols if c != id_col]
    
    # Check for computed metric config
    metric_cfg = METRIC_CONFIG.get(section_name)
    computed_col_name = None
    if metric_cfg:
        computed_col_name = metric_cfg[2]
        # Insert computed column after Status or at end? user said part of table.

    
    out_cols = [id_col] + [f"{c} (A)" for c in base_cols] + [f"{c} (B)" for c in base_cols] + ["Status"]
    if computed_col_name:
        out_cols.append(computed_col_name)


    rows_a = sa.rows if sa else {}
    rows_b = sb.rows if sb else {}

    ids = sorted(set(rows_a.keys()) | set(rows_b.keys()))
    out_rows: List[Dict[str, Any]] = []

    for rid in ids:
        ra = rows_a.get(rid)
        rb = rows_b.get(rid)

        row_out: Dict[str, Any] = {id_col: rid}

        if ra is None and rb is not None:
            for c in base_cols:
                row_out[f"{c} (A)"] = NA
                row_out[f"{c} (B)"] = rb.get(c, NA)
            row_out["Status"] = "ONLY_IN_B"

        elif rb is None and ra is not None:
            for c in base_cols:
                row_out[f"{c} (A)"] = ra.get(c, NA)
                row_out[f"{c} (B)"] = NA
            row_out["Status"] = "ONLY_IN_A"

        else:
            changed = False
            for c in base_cols:
                va = (ra.get(c, NA) if ra else NA)
                vb = (rb.get(c, NA) if rb else NA)
                row_out[f"{c} (A)"] = va
                row_out[f"{c} (B)"] = vb
                if not values_equal(va, vb):
                    changed = True
            row_out["Status"] = "CHANGED" if changed else "SAME"

        # Compute Metric if configured
        if metric_cfg:
            src_col, mode, dest_col = metric_cfg
            # Get values (already retrieved or need parsing again?)
            # We have the raw rows ra/rb.
            # Convert to float
            val_a = as_number(ra.get(src_col, NA)) if ra else 0.0
            val_b = as_number(rb.get(src_col, NA)) if rb else 0.0
            
            # Handle None from as_number (e.g. if NA string)
            if val_a is None: val_a = 0.0
            if val_b is None: val_b = 0.0

            if mode == 'abs':
                diff = val_b - val_a
                row_out[dest_col] = f"{diff:.4f}"
            elif mode == 'pct':
                if abs(val_a) > 1e-9:
                    diff = ((val_b - val_a) / abs(val_a)) * 100.0
                    row_out[dest_col] = f"{diff:.2f}"
                elif abs(val_b) > 1e-9:
                    row_out[dest_col] = "100.00" # 0 -> something
                else:
                    row_out[dest_col] = "0.00"


        out_rows.append(row_out)

    meta = {
        "row_count": len(out_rows),
        "only_in_a": sum(1 for r in out_rows if r["Status"] == "ONLY_IN_A"),
        "only_in_b": sum(1 for r in out_rows if r["Status"] == "ONLY_IN_B"),
        "changed":   sum(1 for r in out_rows if r["Status"] == "CHANGED"),
        "same":      sum(1 for r in out_rows if r["Status"] == "SAME"),
    }

    return SectionSideBySide(
        section=section_name,
        id_col=id_col,
        out_columns=out_cols,
        rows=out_rows,
        meta=meta,
    )


def build_side_by_side(a_text: str, b_text: str) -> str:
    """
    Main entry point for comparison.
    Takes two RPT file content strings.
    Returns a JSON string of RPTSideBySideResult.
    """
    a = parse_swmm_rpt(a_text)
    b = parse_swmm_rpt(b_text)

    out = RPTSideBySideResult()

    # blocks side-by-side
    all_blocks = set(a.blocks.keys()) | set(b.blocks.keys())
    for name in sorted(all_blocks):
        out.blocks_side_by_side[name] = {"a": a.blocks.get(name), "b": b.blocks.get(name)}

    # section side-by-side
    all_sections = set(a.sections.keys()) | set(b.sections.keys())
    for sname in sorted(all_sections):
        out.sections.append(build_section_side_by_side(a.sections.get(sname), b.sections.get(sname), sname))

    return json.dumps(out.to_jsonable())
