import type { SVGProps } from "react";

/** The app icon itself, small, so the wordmark and home screen match. */
export function FlameMark({ className }: { className?: string }) {
  // A local static asset; next/image would add nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src="/icon-192.png" alt="" aria-hidden="true" />;
}

/**
 * One line-icon set, drawn to the same grid so the app never mixes weights:
 * 24-unit box, 1.9 stroke, round caps. Sized by the surrounding CSS.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Tab icons. Two states drawn as one shape: the outline always, plus a soft
 * fill and a heavier stroke when the tab is active, so the bar reads as
 * "you are here" without a separate filled icon set.
 */
type TabIconProps = IconProps & { active?: boolean };

function tabProps(active: boolean | undefined): IconProps {
  return active ? { strokeWidth: 2.1 } : { strokeWidth: 1.7 };
}

export function GarageIcon({ active, ...props }: TabIconProps) {
  return (
    <Icon {...tabProps(active)} {...props}>
      {active && <path d="M2.5 9.5 12 3l9.5 6.5V20a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V9.5Z" fill="currentColor" fillOpacity="0.18" stroke="none" />}
      <path d="M2.5 9.5 12 3l9.5 6.5V20a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V9.5Z" />
      <path d="M7 21v-9.5h10V21" />
      <path d="M7 14.5h10M7 17.5h10" />
    </Icon>
  );
}

export function ScanIcon({ active, ...props }: TabIconProps) {
  return (
    <Icon {...tabProps(active)} {...props}>
      {active && <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.18" stroke="none" />}
      <path d="M3 8.5V6.5A3.5 3.5 0 0 1 6.5 3h2M21 8.5V6.5A3.5 3.5 0 0 0 17.5 3h-2M3 15.5v2A3.5 3.5 0 0 0 6.5 21h2M21 15.5v2a3.5 3.5 0 0 1-3.5 3.5h-2" />
      <path d="M7.5 8.5v7M10.5 8.5v7M13 8.5v7M16.5 8.5v7" />
    </Icon>
  );
}

export function ChartIcon({ active, ...props }: TabIconProps) {
  // A podium: the tallest step in the middle, the way a race result is shown.
  const steps = "M2.5 20.5V13a1.5 1.5 0 0 1 1.5-1.5h4.5V20.5M8.5 20.5V6A1.5 1.5 0 0 1 10 4.5h4A1.5 1.5 0 0 1 15.5 6v14.5M15.5 20.5V15a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 21.5 15v5.5";
  return (
    <Icon {...tabProps(active)} {...props}>
      {active && <path d={`${steps}H2.5Z`} fill="currentColor" fillOpacity="0.18" stroke="none" />}
      <path d={steps} />
      <path d="M2 20.5h20" />
      <path d="M12 8v4.5M10.6 9.4 12 8l1.4 1.4" />
    </Icon>
  );
}

export function GalleryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 19" />
    </Icon>
  );
}

export function TorchIcon({ on, ...props }: IconProps & { on?: boolean }) {
  return (
    <Icon {...props}>
      <path d="M7 3h10v3.5l-2 3V21H9V9.5l-2-3V3Z" />
      <path d="M7 6.5h10" />
      <path d="M12 12v3" />
      {on && <path d="M4.5 3.5 3 2M19.5 3.5 21 2M12 1.5V0" opacity="0.9" />}
    </Icon>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h3l1.5-2.5h7L17 8h3a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9.5A1.5 1.5 0 0 1 4 8Z" />
      <circle cx="12" cy="13.3" r="3.3" />
    </Icon>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 13.5h.01M17 13.5h.01M9 14h6" />
    </Icon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 20 .8-4L16.4 4.4a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4L8 19.2 4 20Z" />
      <path d="m14.5 6.3 3.2 3.2" />
    </Icon>
  );
}

export function BarcodeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6v12M8 6v12M11 6v12M14.5 6v12M17 6v12M20 6v12" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth="2.4" {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon strokeWidth="2.2" {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon strokeWidth="2.2" {...props}>
      <path d="M12 5v8M12 17.5v.01" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon strokeWidth="2.2" {...props}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </Icon>
  );
}

/** A die-cast silhouette for cars that have no photo yet. */
export function CarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 13.5 5 9.2A2 2 0 0 1 6.9 8h8.6a2 2 0 0 1 1.7.9l2.3 3.4 1.3.4a1.5 1.5 0 0 1 1.1 1.4V17h-2" />
      <path d="M3.5 13.5H2.6A.6.6 0 0 0 2 14.1V17h2" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M9 17h6M6.5 11.5h9.2" />
    </Icon>
  );
}
