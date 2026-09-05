"use client";

import { CircleAlert, RotateCcw } from "lucide-react";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="empty-state" role="alert">
      <CircleAlert aria-hidden="true" size={28} />
      <h1>Control plane unavailable</h1>
      <p>RecoverAI could not load this view. No recovery action was executed.</p>
      <button className="button button-primary" onClick={reset}>
        <RotateCcw size={16} /> Try again
      </button>
    </section>
  );
}
