/** The app icon itself, small, so the wordmark and home screen match. */
export function FlameMark({ className }: { className?: string }) {
  // A local static asset; next/image would add nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src="/icon-192.png" alt="" aria-hidden="true" />;
}

export function GarageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M3 10 12 4l9 6v10H3V10Z" strokeLinejoin="round" />
      <path d="M7 20v-5h10v5M7 17h10" strokeLinejoin="round" />
    </svg>
  );
}

export function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
      <path d="M3 12h18" strokeLinecap="round" />
    </svg>
  );
}

export function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  );
}
