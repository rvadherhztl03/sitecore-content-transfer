/**
 * The Content Transfer mark, as in public/brand/content-transfer-logo.svg, drawn inline so it needs no request.
 * Decorative: the app or screen name always sits beside it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#6E3FFF" />
      <rect x="11" y="23" width="25" height="25" rx="6" fill="none" stroke="#FFFFFF" strokeWidth="3.5" />
      <rect x="25" y="12" width="28" height="28" rx="7" fill="#FFFFFF" />
      <path d="M32.5 32.5 L45.5 19.5 M36 19.5 H45.5 V29" fill="none" stroke="#6E3FFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
