import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SidebarNav } from "@/components/sidebar-nav";

export const metadata: Metadata = {
  title: "RecoverAI — Revenue Recovery Controller",
  description: "Policy-governed AI revenue recovery for recurring payments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <div className="app-shell">
          <aside className="sidebar">
            <Link className="brand-block" href="/" aria-label="RecoverAI overview">
              <div className="brand-mark" aria-hidden="true">
                <span />
              </div>
              <div>
                <p className="brand-name">RecoverAI</p>
                <p className="brand-kicker">Revenue control</p>
              </div>
            </Link>
            <SidebarNav />
            <div className="sidebar-status">
              <div className="status-line">
                <span className="live-dot" /> Local control plane
              </div>
              <p>Mock decisions · PostgreSQL</p>
              <p>Razorpay Test Mode ready</p>
            </div>
          </aside>
          <main id="main-content" className="main-content" tabIndex={-1}>
            <div className="top-rail" role="status" aria-label="Data environment">
              <span className="environment-pill">
                <span className="live-dot" /> Simulator data
              </span>
              <span className="top-rail-note">Synthetic results — not production revenue</span>
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
