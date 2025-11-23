#!/usr/bin/env python3
"""
# ==============================================================================
# LOCAL DEVELOPMENT SERVER
# ==============================================================================
# This script runs a simple HTTP server to host the SWMM Comparison App locally.
# It is NOT required for the app to run if hosted elsewhere (e.g., GitHub Pages),
# but it is useful for local testing and development.
#
# USAGE:
#   Run this script with Python: `python server.py`
#   Then open http://localhost:8000 in your web browser.
# ==============================================================================
"""

import http.server
import socketserver
import webbrowser
import os
from pathlib import Path

# Port to serve the application on (default: 8000)
PORT = 8000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    Custom Request Handler to enable CORS and disable caching.
    
    This is necessary because:
    1. CORS (Cross-Origin Resource Sharing): Allows the browser to load resources
       if the origin doesn't match perfectly (useful for some dev setups).
    2. No-Cache: Ensures that when you modify code, the browser reloads the
       latest version instead of using a stale cached version.
    """
    
    def end_headers(self):
        # Add CORS headers to allow local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        
        # Cache control for development (disable caching)
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        
        super().end_headers()

    def log_message(self, format, *args):
        # Custom log format to keep the console output clean
        print(f"[{self.log_date_time_string()}] {format % args}")

def main():
    # 1. Change Working Directory
    #    Ensure we are serving files from the directory where this script is located.
    os.chdir(Path(__file__).parent)
    
    Handler = MyHTTPRequestHandler
    
    # 2. Start the Server
    #    Create a TCP server that listens on the specified port.
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print("=" * 60)
        print(f"SWMM Comparison App - Local Server")
        print("=" * 60)
        print(f"Server running at: {url}")
        print(f"Press Ctrl+C to stop the server")
        print("=" * 60)
        
        # 3. Open Browser
        #    Attempt to automatically open the default web browser to the app URL.
        try:
            webbrowser.open(url)
            print("Opening browser...")
        except Exception as e:
            print(f"Could not open browser automatically: {e}")
            print(f"Please open {url} manually in your browser")
        
        # 4. Serve Forever
        #    Keep the server running until the user presses Ctrl+C.
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped.")

if __name__ == "__main__":
    main()

