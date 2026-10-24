/** Original friendly orange robot mascot for Sublet Sniper. */
export function Bot({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <line x1="32" y1="6" x2="32" y2="14" stroke="#EA580C" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="6" r="4" fill="#FB923C" />
      <rect x="6" y="27" width="5" height="12" rx="2.5" fill="#EA580C" />
      <rect x="53" y="27" width="5" height="12" rx="2.5" fill="#EA580C" />
      <rect x="10" y="14" width="44" height="40" rx="16" fill="#F97316" />
      <rect x="16" y="22" width="32" height="22" rx="10" fill="#FFF7ED" />
      <circle cx="25" cy="33" r="3.6" fill="#1C1917" />
      <circle cx="39" cy="33" r="3.6" fill="#1C1917" />
      <path d="M27 40 q5 3.5 10 0" stroke="#1C1917" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
