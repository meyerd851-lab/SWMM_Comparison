
import sys
import os
import json
import zipfile
import io
import shutil

# Add the project directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import core_web
import shapefile

def test_shapefile_export():
    print("Testing Shapefile Export...")

    # 1. Mock Data
    # We need to simulate the output of run_compare or at least the parts generate_shapefiles_zip needs.
    
    # Mock Sections (Parsed INP data)
    sections1 = {
        "JUNCTIONS": {
            "J1": ["100.0", "10.0", "0", "0", "0"], # Invert, MaxDepth, ...
        },
        "CONDUITS": {
            "C1": ["J1", "Out1", "400.0", "0.01", "0", "0", "0", "0"], # Length=400
        }
    }
    
    sections2 = {
        "JUNCTIONS": {
            "J1": ["100.0", "12.0", "0", "0", "0"], # MaxDepth changed to 12.0
            "J2": ["105.0", "15.0", "0", "0", "0"], # Added
        },
        "CONDUITS": {
            "C1": ["J1", "Out1", "400.0", "0.01", "0", "0", "0", "0"], # Same
            "C2": ["J2", "Out1", "200.0", "0.01", "0", "0", "0", "0"], # Added
        }
    }

    # Mock Diffs
    diffs = {
        "JUNCTIONS": {
            "added": {"J2": ["105.0", "15.0", "0", "0", "0"]},
            "removed": {},
            "changed": {
                "J1": {
                    "values": [["100.0", "10.0", "0", "0", "0"], ["100.0", "12.0", "0", "0", "0"]],
                    "diff_values": {"MaxDepth": 2.0}
                }
            }
        },
        "CONDUITS": {
            "added": {"C2": ["J2", "Out1", "200.0", "0.01", "0", "0", "0", "0"]},
            "removed": {},
            "changed": {}
        }
    }

    # Mock Geometry
    geometry = {
        "nodes1": {"J1": (0, 0)},
        "nodes2": {"J1": (0, 0), "J2": (10, 10)},
        "links1": {"C1": [(0, 0), (100, 0)]},
        "links2": {"C1": [(0, 0), (100, 0)], "C2": [(10, 10), (100, 0)]},
        "subs1": {},
        "subs2": {}
    }

    full_out = {
        "diffs": diffs,
        "geometry": geometry,
        "sections1": sections1,
        "sections2": sections2
    }

    # 2. Run Export
    zip_bytes = core_web.generate_shapefiles_zip(json.dumps(full_out), json.dumps(geometry))
    
    # 3. Inspect ZIP
    zip_buffer = io.BytesIO(zip_bytes)
    with zipfile.ZipFile(zip_buffer, 'r') as zf:
        print("Files in ZIP:", zf.namelist())
        
        # Extract to temp dir to read with shapefile reader
        temp_dir = "temp_shp_test"
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        os.makedirs(temp_dir)
        zf.extractall(temp_dir)
        
        # Check Nodes DBF
        print("\nChecking Nodes DBF...")
        try:
            r = shapefile.Reader(os.path.join(temp_dir, "nodes_export"))
            print("Fields:", [f[0] for f in r.fields[1:]]) # Skip deletion flag
            
            # Check if we have extra fields (we expect them after implementation)
            field_names = [f[0] for f in r.fields[1:]]
            
            # We expect Invert_O, Invert_N, MaxDepth_O, MaxDepth_N, etc.
            # Note: Field names are truncated. "InvertElev" -> "InvertEl_O", "InvertEl_N"
            
            expected_fields = ["MaxDepth_O", "MaxDepth_N", "MaxDepth_D"] 
            
            found_fields = False
            for f in expected_fields:
                if f in field_names:
                    found_fields = True
                    break
            
            if found_fields:
                print("SUCCESS: Found attribute fields in DBF.")
            else:
                print("NOTICE: Attribute fields NOT found (Expected before implementation).")

            for rec in r.records():
                print(rec)

        except Exception as e:
            print(f"Error reading nodes shapefile: {e}")

        # Check Links DBF
        print("\nChecking Links DBF...")
        try:
            r = shapefile.Reader(os.path.join(temp_dir, "links_export"))
            print("Fields:", [f[0] for f in r.fields[1:]])
            for rec in r.records():
                print(rec)
        except Exception as e:
            print(f"Error reading links shapefile: {e}")

        # Cleanup
        r.close()
        shutil.rmtree(temp_dir)

if __name__ == "__main__":
    test_shapefile_export()
