#!/usr/bin/env python3
"""Patch iOS Info.plist after `cap add ios` to restore deep link URL scheme + camera usage."""
import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

URL_SCHEME = """
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.scripturesinview.mobile</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>scicp</string>
\t\t\t</array>
\t\t</dict>
\t</array>"""

CAMERA_USAGE = """
\t<key>NSCameraUsageDescription</key>
\t<string>Scriptures in View uses the camera to scan QR codes for session joining.</string>"""

if 'CFBundleURLTypes' not in content:
    content = content.replace('</dict>\n</plist>', URL_SCHEME + '\n</dict>\n</plist>', 1)
    print('✓ CFBundleURLTypes (scicp://) injected')
else:
    print('✓ URL scheme already present')

if 'NSCameraUsageDescription' not in content:
    content = content.replace('</dict>\n</plist>', CAMERA_USAGE + '\n</dict>\n</plist>', 1)
    print('✓ NSCameraUsageDescription injected')
else:
    print('✓ Camera usage already present')

with open(path, 'w') as f:
    f.write(content)
