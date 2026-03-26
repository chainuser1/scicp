/**
 * Android Local Notification helper.
 * Wraps @capacitor/local-notifications with permission handling.
 * Falls back silently on web / when permission is denied.
 */
import { LocalNotifications } from '@capacitor/local-notifications';

let permissionGranted = null; // null = unchecked, true/false after check

function getPlugin() {
  try {
    // Verify the plugin is actually available (not just the JS stub)
    if (typeof LocalNotifications?.checkPermissions === 'function') return LocalNotifications;
  } catch { /* plugin not available */ }
  return null;
}

/** Request notification permission (idempotent). */
export async function requestNotificationPermission() {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const { display } = await plugin.checkPermissions();
    if (display === 'granted') { permissionGranted = true; return true; }
    const req = await plugin.requestPermissions();
    permissionGranted = req.display === 'granted';
    return permissionGranted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

/** Show a local notification. Auto-requests permission on first call. */
export async function notify(title, body, { id, ongoing = false } = {}) {
  if (permissionGranted === null) await requestNotificationPermission();
  if (!permissionGranted) return;
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.schedule({
      notifications: [{
        title,
        body,
        id: id ?? Math.floor(Math.random() * 100000),
        ongoing,
        autoCancel: !ongoing,
        sound: null,
        channelId: 'default',
        smallIcon: 'ic_notification',
      }],
    });
  } catch (err) {
    console.warn('[notify] schedule failed:', err?.message);
  }
}

/** Cancel a notification by id. */
export async function cancelNotification(id) {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.cancel({ notifications: [{ id }] });
  } catch {}
}
