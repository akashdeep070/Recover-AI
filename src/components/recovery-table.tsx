"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { formatCurrency, formatDateTime, sentenceCase } from "@/lib/format";

export interface RecoveryRow {
  id: string;
  customerName: string;
  amountPaisa: number;
  failureReason: string;
  state: string;
  currentAction?: string;
  confidence?: number;
  lastActivity: string;
  source: string;
}

export function RecoveryTable({ rows }: { rows: RecoveryRow[] }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("ALL");
  const states = useMemo(() => ["ALL", ...new Set(rows.map((row) => row.state))], [rows]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (state === "ALL" || row.state === state) &&
        (!term ||
          [row.customerName, row.failureReason, row.currentAction ?? "", row.id].some((value) =>
            value.toLowerCase().includes(term),
          )),
    );
  }, [query, rows, state]);

  return (
    <section className="panel">
      <div className="panel-header recovery-toolbar">
        <div className="search-field">
          <Search aria-hidden="true" size={17} />
          <label className="sr-only" htmlFor="recovery-search">
            Search recoveries
          </label>
          <input
            id="recovery-search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customer, failure, action…"
          />
        </div>
        <div className="filter-field">
          <label htmlFor="recovery-state">State</label>
          <select
            id="recovery-state"
            className="select"
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            {states.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "All states" : sentenceCase(item)}
              </option>
            ))}
          </select>
        </div>
        <span className="result-count">
          {filtered.length} of {rows.length} cases
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table recoveries-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Revenue at risk</th>
              <th>Failure</th>
              <th>State</th>
              <th>Next / last action</th>
              <th>Confidence</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/recoveries/${row.id}`}>{row.customerName}</Link>
                  <div className="table-subline">
                    {row.source === "SIMULATOR" ? "Synthetic fixture" : "Razorpay Test Mode"}
                  </div>
                </td>
                <td className="numeric">{formatCurrency(row.amountPaisa)}</td>
                <td>{sentenceCase(row.failureReason)}</td>
                <td>
                  <StatusBadge value={row.state} />
                </td>
                <td>{row.currentAction ? sentenceCase(row.currentAction) : "—"}</td>
                <td className="numeric">
                  {row.confidence === undefined ? "—" : `${Math.round(row.confidence * 100)}%`}
                </td>
                <td className="muted">{formatDateTime(row.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="inline-empty">No cases match the current filters.</div>
        ) : null}
      </div>
    </section>
  );
}
