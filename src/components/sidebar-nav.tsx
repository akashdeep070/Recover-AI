"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FlaskConical,
  LayoutDashboard,
  RefreshCcw,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";

const items = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/recoveries", label: "Recoveries", icon: RefreshCcw },
  { href: "/reviews", label: "Needs Review", icon: ShieldAlert },
  { href: "/lab", label: "Recovery Lab", icon: FlaskConical },
  { href: "/policies", label: "Policies", icon: SlidersHorizontal },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className="nav-list">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`nav-item ${active ? "nav-item-active" : ""}`}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
