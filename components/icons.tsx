/** Miniature of the app icon: a flaming five-spoke wheel in the card palette. */
export function FlameMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M21 9.5 C 15.5 7.5 12.5 8.5 9.5 10.5 C 10.5 8.7 9.8 6.8 8.2 5.6 C 6.8 7.4 5.2 8.8 3.2 10 C 4.6 11 4.2 12.4 3 13.8 C 7.4 14.8 11.4 16.6 15 19.4 C 17 20.9 19 21.9 21 22.3 Z"
        fill="#e8231d"
        stroke="#00295d"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="21.5" cy="16" r="9" fill="#00295d" />
      <circle cx="21.5" cy="16" r="7.4" fill="#e8231d" />
      <circle cx="21.5" cy="16" r="5.8" fill="#ffd100" />
      <g stroke="#00295d" strokeWidth="1.5" strokeLinecap="round">
        <path d="M21.5 14.3 V10.8" />
        <path d="M23.1 15.4 L26.4 14.4" />
        <path d="M22.5 17.4 L24.6 20.2" />
        <path d="M20.5 17.4 L18.4 20.2" />
        <path d="M19.9 15.4 L16.6 14.4" />
      </g>
      <circle cx="21.5" cy="16" r="1.9" fill="#00295d" />
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
