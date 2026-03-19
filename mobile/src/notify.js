/**
 * Android Local Notification helper.
 * Wraps @capacitor/local-notifications with permission handling.
 * Falls back silently on web / when permission is denied.
 */

let LN = null;
let permissionGranted = null; // null = unchecked, true/false after check

async function getPlugin() {
  if (LN) return LN;
  try {
    const mod = await import('@capacitor/local-notifications');
    LN = mod.LocalNotifications;
    return LN;
  } catch {
    return null;
  }
}

/** Request notification permission (idempotent). */
export async function requestNotificationPermission() {
  const plugin = await getPlugin();
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
  const plugin = await getPlugin();
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
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await plugin.cancel({ notifications: [{ id }] });
  } catch {}
}
