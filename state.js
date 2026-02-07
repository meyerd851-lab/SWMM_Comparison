// Shared application state
export const state = {
  LAST: { json: null, resultJson: null, currentSection: null },
  UI_MODE: 'INP', // 'INP' or 'RESULTS'
  FILES: { f1Name: null, f2Name: null, f1Bytes: null, f2Bytes: null },
  CURRENT_CRS: "EPSG:3735",
  SESSION_VERSION: 1,
  PROJECTIONS: {
    "EPSG:3735": "+proj=lcc +lat_0=38 +lon_0=-82.5 +lat_1=40.0333333333333 +lat_2=38.7333333333333 +x_0=600000 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs +type=crs",
    "EPSG:3733": "+proj=lcc +lat_0=39.6666666666667 +lon_0=-82.5 +lat_1=41.7 +lat_2=40.4333333333333 +x_0=600000 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs +type=crs",
    "EPSG:6499": "+proj=lcc +lat_0=41.5 +lon_0=-84.3666666666667 +lat_1=43.6666666666667 +lat_2=42.1 +x_0=3999999.999984 +y_0=0 +ellps=GRS80 +units=ft +no_defs +type=crs",
    "EPSG:2272": "+proj=lcc +lat_0=39.33333333333334 +lon_0=-77.75 +lat_1=40.96666666666667 +lat_2=39.93333333333333 +x_0=600000.00012192 +y_0=0.000121915682 +datum=NAD83 +units=us-ft +no_defs +type=crs"
  },
  XY_LATLNG_CACHE: new Map()
};

