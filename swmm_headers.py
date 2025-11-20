SECTION_HEADERS = {
    # --- Project-level / config sections ------------------------------------
    "TITLE": [],  # free text lines

    "OPTIONS": ["Option", "Value"],

    "REPORT": ["Keyword", "Value1", "Value2", "Value3"],

    "FILES": ["Action", "FileType", "FileName"],  # USE/SAVE, RAINFALL/RUNOFF/etc.

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

    "INFILTRATION": [
        "Subcatch",
        "P1", "P2", "P3", "P4", "P5",  # interpretation depends on method
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
        "Constituent",
        "Type",         # FLOW or pollutant name
        "TimeSeries",
        "ScaleFactor",
        "BaseLine",
        "Pattern1",
        "Pattern2",
        "Pattern3",
        "Pattern4"
    ],

    "DWF": [
        "Node",
        "Constituent",  # FLOW or pollutant name
        "Base1", "Base2", "Base3", "Base4",
        "Pattern1", "Pattern2", "Pattern3", "Pattern4"
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
