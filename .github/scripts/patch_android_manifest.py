#!/usr/bin/env python3
"""Patch AndroidManifest.xml after `cap add android` to restore deep links + permissions."""
import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

DEEP_LINKS = """
            <!-- Deep link: scicp://session/CODE -->
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="scicp" />
            </intent-filter>

            <!-- Deep link: https://cap-teyyko.live/client?session=CODE -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="cap-teyyko.live" android:pathPrefix="/client" />
            </intent-filter>"""

PERMISSIONS = """
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />"""

if 'scicp' not in content:
    content = content.replace('        </activity>', DEEP_LINKS + '\n        </activity>', 1)
    print('✓ Deep link intent-filters injected')
else:
    print('✓ Deep links already present')

if 'POST_NOTIFICATIONS' not in content:
    content = content.replace('</manifest>', PERMISSIONS + '\n</manifest>', 1)
    print('✓ Notification permissions injected')
else:
    print('✓ Permissions already present')

with open(path, 'w') as f:
    f.write(content)
