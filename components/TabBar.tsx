"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, GarageIcon, ScanIcon } from "./icons";

const TABS = [
  { href: "/", label: "Garage", Icon: GarageIcon },
  { href: "/scan", label: "Scan", Icon: ScanIcon },
  { href: "/stats", label: "Stats", Icon: ChartIcon },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabs">
      {TABS.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`tab${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
