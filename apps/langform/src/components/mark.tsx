export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 36" aria-hidden="true" className={className}>
      <path d="M2 6h60M2 30h60" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <rect x="4" y="9" width="16" height="18" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="24" y="9" width="16" height="18" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="44" y="9" width="16" height="18" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
