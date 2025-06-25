#!/usr/bin/env python3
"""
Simple HTTP Server for QR Scanner App
Serves files locally to avoid CORS errors when testing
Includes QR code generation functionality
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import json
import urllib.parse
import argparse
from pathlib import Path
import io
import base64
import shutil

# Try to import QR code library
try:
    import qrcode
    from qrcode.image.styledpil import StyledPilImage
    from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
    QR_AVAILABLE = True
except ImportError:
    QR_AVAILABLE = False

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def log_message(self, format, *args):
        # Custom log format
        print(f"[{self.address_string()}] {format % args}")
    
    def do_GET(self):
        # Handle QR generator routes
        if self.path.startswith('/qr/'):
            self.handle_qr_request()
        elif self.path == '/generator' or self.path == '/generator/':
            self.serve_qr_generator_page()
        else:
            # Default file serving
            super().do_GET()
    
    def handle_qr_request(self):
        """Handle QR code generation requests"""
        if not QR_AVAILABLE:
            self.send_error(500, "QR code library not installed. Run: pip install qrcode[pil]")
            return
        
        try:
            # Parse the path: /qr/index or /qr/custom?text=...
            path_parts = self.path.split('/')
            if len(path_parts) < 3:
                self.send_error(400, "Invalid QR request")
                return
            
            qr_type = path_parts[2].split('?')[0]  # Remove query params
            
            if qr_type == 'custom':
                # Handle custom text QR
                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                text = params.get('text', [''])[0]
                if not text:
                    self.send_error(400, "Missing text parameter")
                    return
                self.generate_qr_page(text, "Custom QR Code", "#666666")
            
            elif qr_type.isdigit():
                # Handle preset QR by index
                index = int(qr_type)
                qr_data = self.load_qr_data()
                if not qr_data or index >= len(qr_data['qrCodes']):
                    self.send_error(404, "QR code not found")
                    return
                
                qr = qr_data['qrCodes'][index]
                qr_image_path = f"qr-images/qr_{index}.png"
                self.generate_qr_page(qr['text'], qr['name'], qr['color'], qr_image_path)
            
            else:
                self.send_error(400, "Invalid QR request")
        
        except Exception as e:
            self.send_error(500, f"QR generation error: {str(e)}")
    
    def serve_qr_generator_page(self):
        """Serve the QR generator selection page"""
        try:
            qr_data = self.load_qr_data()
            if not qr_data:
                self.send_error(500, "Could not load QR data")
                return
            
            html = self.generate_qr_selector_html(qr_data)
            
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(html.encode())
        
        except Exception as e:
            self.send_error(500, f"Generator page error: {str(e)}")
    
    def load_qr_data(self):
        """Load QR codes from JSON file"""
        try:
            with open('qr-data.json', 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading QR data: {e}")
            return None
    
    def generate_qr_page(self, text, name, color, qr_image_path=None):
        """Generate a single QR code display page"""
        try:
            if qr_image_path and os.path.exists(qr_image_path):
                # Use pre-generated image
                img_src = f"/{qr_image_path}"
            else:
                # Generate QR code on-demand (fallback)
                qr = qrcode.QRCode(
                    version=1,
                    error_correction=qrcode.constants.ERROR_CORRECT_L,
                    box_size=10,
                    border=4,
                )
                qr.add_data(text)
                qr.make(fit=True)
                
                # Create QR code image
                img = qr.make_image(fill_color="black", back_color="white")
                
                # Convert to base64 for embedding in HTML
                buffer = io.BytesIO()
                img.save(buffer, format='PNG')
                img_str = base64.b64encode(buffer.getvalue()).decode()
                img_src = f"data:image/png;base64,{img_str}"
            
            # Generate HTML page
            html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR Code: {name}</title>
    <style>
        body {{
            font-family: 'Arial', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 30px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }}
        .qr-image {{
            background: white;
            padding: 20px;
            border-radius: 15px;
            margin: 20px 0;
            display: inline-block;
        }}
        .qr-info {{
            margin: 20px 0;
        }}
        .color-indicator {{
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin: 10px auto;
            border: 3px solid white;
            background-color: {color};
        }}
        .back-link {{
            color: white;
            text-decoration: none;
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 20px;
            transition: all 0.3s ease;
            margin-top: 20px;
            display: inline-block;
        }}
        .back-link:hover {{
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }}
        h1 {{ margin-bottom: 10px; }}
        .text-content {{
            word-break: break-all;
            background: rgba(255, 255, 255, 0.1);
            padding: 10px;
            border-radius: 10px;
            margin: 10px 0;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{name}</h1>
        <div class="qr-image">
            <img src="{img_src}" alt="QR Code" />
        </div>
        <div class="qr-info">
            <div class="color-indicator"></div>
            <div class="text-content">{text}</div>
        </div>
        <a href="/generator" class="back-link">← Back to Generator</a>
        <br><br>
        <a href="/" class="back-link">📱 Go to Scanner</a>
    </div>
</body>
</html>
            """
            
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(html.encode())
        
        except Exception as e:
            self.send_error(500, f"QR generation failed: {str(e)}")
    
    def generate_qr_selector_html(self, qr_data):
        """Generate the QR code selector page"""
        preset_options = ""
        preset_grid = ""
        
        for i, qr in enumerate(qr_data['qrCodes']):
            preset_options += f'<option value="{i}">{qr["name"]} - {qr["text"][:30]}{"..." if len(qr["text"]) > 30 else ""}</option>\n'
            preset_grid += f"""
            <div class="preset-card" onclick="window.location.href='/qr/{i}'">
                <div class="preset-info">
                    <h4>{qr['name']}</h4>
                    <p>{qr['text']}</p>
                    <div class="preset-color" style="background-color: {qr['color']};"></div>
                </div>
            </div>
            """
        
        return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR Code Generator</title>
    <style>
        body {{
            font-family: 'Arial', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
        }}
        .header {{
            text-align: center;
            margin-bottom: 30px;
        }}
        .back-link {{
            color: white;
            text-decoration: none;
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 20px;
            transition: all 0.3s ease;
            display: inline-block;
        }}
        .back-link:hover {{
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }}
        .controls {{
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            margin-bottom: 30px;
            backdrop-filter: blur(10px);
        }}
        select, input, button {{
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            border: none;
            border-radius: 8px;
            font-size: 16px;
        }}
        button {{
            background: linear-gradient(45deg, #ff6b6b, #ee5a52);
            color: white;
            cursor: pointer;
            transition: all 0.3s ease;
        }}
        button:hover {{
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }}
        .preset-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        .preset-card {{
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            border: 2px solid transparent;
        }}
        .preset-card:hover {{
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.3);
        }}
        .preset-info h4 {{
            margin: 0 0 10px 0;
            color: white;
        }}
        .preset-info p {{
            margin: 0 0 15px 0;
            color: rgba(255, 255, 255, 0.8);
            word-break: break-all;
            font-size: 14px;
        }}
        .preset-color {{
            width: 30px;
            height: 30px;
            border-radius: 50%;
            margin: 0 auto;
            border: 2px solid white;
        }}
        .instructions {{
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
        }}
        label {{
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 QR Code Generator</h1>
            <a href="/" class="back-link">← Back to Scanner</a>
        </div>
        
        <div class="controls">
            <label for="qrSelect">Quick Select:</label>
            <select id="qrSelect" onchange="if(this.value) window.location.href='/qr/' + this.value">
                <option value="">Choose a preset QR code...</option>
                {preset_options}
            </select>
            
            <label for="customText">Or Create Custom QR Code:</label>
            <input type="text" id="customText" placeholder="Enter any text to generate QR code" />
            <button onclick="generateCustom()">Generate Custom QR Code</button>
        </div>
        
        <div class="preset-grid">
            {preset_grid}
        </div>
        
        <div class="instructions">
            <h3>📱 How to Test:</h3>
            <ol>
                <li>Click any preset QR code or generate a custom one</li>
                <li>Open the scanner on another device</li>
                <li>Point the scanner at the QR code</li>
                <li>Watch for the colored overlay when matched!</li>
            </ol>
        </div>
    </div>
    
    <script>
        function generateCustom() {{
            const text = document.getElementById('customText').value.trim();
            if (text) {{
                window.location.href = '/qr/custom?text=' + encodeURIComponent(text);
            }} else {{
                alert('Please enter some text first!');
            }}
        }}
        
        document.getElementById('customText').addEventListener('keypress', function(e) {{
            if (e.key === 'Enter') {{
                generateCustom();
            }}
        }});
    </script>
</body>
</html>
        """

def generate_all_qr_images(qr_data_file='qr-data.json', output_dir='qr-images'):
    """Generate all QR code images from JSON file on startup"""
    print("🎯 Pre-generating QR code images...")
    
    if not QR_AVAILABLE:
        print("❌ QR code library not available. Skipping QR generation.")
        return False
    
    try:
        # Clean existing directory
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
            print(f"🧹 Cleaned existing {output_dir} directory")
        
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        
        # Load QR data
        with open(qr_data_file, 'r') as f:
            qr_data = json.load(f)
        
        generated_count = 0
        for i, qr in enumerate(qr_data['qrCodes']):
            try:
                # Generate QR code
                qr_code = qrcode.QRCode(
                    version=1,
                    error_correction=qrcode.constants.ERROR_CORRECT_L,
                    box_size=10,
                    border=4,
                )
                qr_code.add_data(qr['text'])
                qr_code.make(fit=True)
                
                # Create QR code image
                img = qr_code.make_image(fill_color="black", back_color="white")
                
                # Save image
                img_path = os.path.join(output_dir, f"qr_{i}.png")
                img.save(img_path)
                
                print(f"   ✅ Generated QR {i}: {qr['name']}")
                generated_count += 1
                
            except Exception as e:
                print(f"   ❌ Failed to generate QR {i} ({qr['name']}): {e}")
        
        print(f"🎉 Generated {generated_count} QR code images in {output_dir}/")
        return True
        
    except Exception as e:
        print(f"❌ Failed to generate QR images: {e}")
        return False

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='QR Scanner Server with QR Generation')
    parser.add_argument('-p', '--port', type=int, default=8000, help='Port to run server on (default: 8000)')
    parser.add_argument('--host', default='localhost', help='Host to bind to (default: localhost)')
    args = parser.parse_args()
    
    # Configuration
    PORT = args.port
    HOST = args.host
    
    # Change to the directory containing the files
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    # Check if required files exist
    required_files = ['index.html', 'style.css', 'script.js', 'qr-data.json']
    missing_files = [f for f in required_files if not Path(f).exists()]
    
    if missing_files:
        print(f"❌ Missing files: {', '.join(missing_files)}")
        print("Make sure all files are in the same directory as server.py")
        sys.exit(1)
    
    # Pre-generate all QR code images
    generate_all_qr_images()
    
    # Create server
    try:
        with socketserver.TCPServer((HOST, PORT), CustomHTTPRequestHandler) as httpd:
            # Display URLs
            if HOST in ['0.0.0.0', '']:
                local_url = f"http://localhost:{PORT}"
                network_url = f"http://[your-ip]:{PORT}"
            else:
                local_url = f"http://{HOST}:{PORT}"
                network_url = local_url
            
            print("🚀 QR Scanner Server Starting...")
            print(f"📱 Server running on port: {PORT}")
            print(f"📁 Serving files from: {script_dir}")
            print("\n✅ Files found:")
            for file in required_files:
                print(f"   • {file}")
            
            print(f"\n🌐 Local access: {local_url}")
            if HOST in ['0.0.0.0', '']:
                print(f"📱 Network access: {network_url}")
            print("\n⏹️  Press Ctrl+C to stop the server\n")
            
            # Try to open browser automatically
            try:
                webbrowser.open(local_url)
                print("🔗 Browser opened automatically")
            except:
                print("💡 Please open the URL manually in your browser")
            
            # Start serving
            httpd.serve_forever()
            
    except OSError as e:
        if e.errno == 48:  # Address already in use
            print(f"❌ Port {PORT} is already in use")
            print(f"💡 Try running: lsof -ti:{PORT} | xargs kill")
            print("   Or use a different port by modifying the PORT variable")
        else:
            print(f"❌ Server error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\n⏹️  Server stopped by user")
        print("👋 Goodbye!")

if __name__ == "__main__":
    main() 