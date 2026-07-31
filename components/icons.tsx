export function FlameMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M13.4 1.6c.9 3.6-.5 5.6-2.3 7.4-2 2-4.4 3.8-4.4 7.2A7.3 7.3 0 0 0 14 23c4 0 7-3 7-6.9 0-2.7-1.2-4.4-2.6-6-.4 1.2-1.2 2-2.2 2.3.6-3.4-.6-8.2-2.8-10.8Z"
        fill="var(--accent)"
      />
      <path
        d="M8.4 12.6c-2 1.4-3.4 3-3.4 5.1C5 20.7 7.6 23 10.8 23c-2-1.4-3-3.2-3-5.2 0-1.9.3-3.6.6-5.2Z"
        fill="var(--gold)"
      />
    </svg>
  );
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
