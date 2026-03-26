/**
 * EmblemSVG — Shared Christus/cornerstone emblem, same as web.
 */
export default function EmblemSVG({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sacred Scripture Projector emblem">
      <rect x="12" y="46" width="48" height="18" rx="4" fill="#c9a84c" opacity="0.92"/>
      <path d="M14 46 Q36 10 58 46" stroke="#c9a84c" strokeWidth="4" strokeLinecap="round"/>
      <circle cx="36" cy="28" r="8" fill="#e8c97a"/>
      <ellipse cx="36" cy="42" rx="12" ry="10" fill="#e8c97a"/>
      <path d="M24 38 Q18 32 12 28" stroke="#e8c97a" strokeWidth="5" strokeLinecap="round"/>
      <path d="M48 38 Q54 32 60 28" stroke="#e8c97a" strokeWidth="5" strokeLinecap="round"/>
      <circle cx="36" cy="28" r="3" fill="#0a0a0f" opacity="0.7"/>
      <path d="M18 46 Q36 18 54 46" stroke="#e8c97a" strokeWidth="1.5" opacity="0.4"/>
    </svg>
  );
}
