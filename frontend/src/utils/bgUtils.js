/**
 * Maps known Church CDN image hashes to their locally-bundled equivalents.
 * Applied whenever a theme background_url arrives from a socket event or
 * is restored from storage, so offline Electron always renders images.
 */
const CDN_TO_LOCAL = {
  'ae2c3112eda211edae1aeeeeac1ef8149c058327': '/bg/bg-default.jpg',
  '5a979a326ee432c192220903e9c48b5332409a34': '/bg/bg-nt-light.jpg',
  'b1a19c15b0a1fd4b274d6e3decde033329db53f2': '/bg/bg-nt-dark.jpg',
  '850c3faf9ed39b2193c9280a929f73469094982c': '/bg/bg-ot-dark.jpg',
  '91a96141d4471eac93f6d58e7d6db42cd6fd4192': '/bg/bg-ot-light.jpg',
  'bc303ddc99f44c59f8c3b0743367f2180c9e91ef': '/bg/bg-bom-dark.jpg',
  'c827eb43191d54ef97f880db05170ad2a31ad643': '/bg/bg-bom-light.jpg',
  'd424eaa659d3102b717c1825b0e48388d689a966': '/bg/bg-dc-dark.jpg',
  'd51970e2a6003156c90973409c0c94f44c0d9b64': '/bg/bg-dc-light.jpg',
  '4b344419a83be3d625e222be5c77c4453b0e0184': '/bg/bg-pgp-light.jpg',
  'b4c6ca482db211efb2a5eeeeac1ea3e2eeb3cea8': '/bg/bg-pgp-dark.jpg',
};

const CDN_PATTERN = /https?:\/\/[^\s'"]+\/imgs\/([a-f0-9]{40})\/full\/[^\s'")]*/g;

/**
 * Replaces any Church CDN image URL in a CSS background-url string with the
 * locally-bundled /bg/ equivalent. Falls through unchanged for unknown hashes
 * or non-CDN URLs, so custom user backgrounds are never affected.
 *
 * @param {string|undefined} bgUrl  — CSS value like "url('https://...'), gradient(...)"
 * @returns {string|undefined}
 */
export function normalizeBgUrl(bgUrl) {
  if (!bgUrl) return bgUrl;
  return bgUrl.replace(CDN_PATTERN, (match, hash) => {
    const local = CDN_TO_LOCAL[hash];
    return local ? local : match;
  });
}

/**
 * Normalizes a full theme object in-place (new object), replacing any known
 * CDN background_url with its local counterpart.
 *
 * @param {object|undefined} theme
 * @returns {object|undefined}
 */
export function normalizeThemeBg(theme) {
  if (!theme) return theme;
  const normalized = normalizeBgUrl(theme.background_url);
  if (normalized === theme.background_url) return theme;
  return { ...theme, background_url: normalized };
}
