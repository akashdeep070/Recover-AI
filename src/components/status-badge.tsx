import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { sentenceCase } from "@/lib/format";

const successful = new Set(["RECOVERED", "ALLOW", "EXECUTED", "APPROVED", "COMPLETED", "PASS"]);
const warning = new Set(["ESCALATED", "PENDING", "SCHEDULED", "WAITING", "REVIEW", "MODIFIED"]);
const danger = new Set(["FAILED", "BLOCK", "STOPPED", "CANCELLED", "FAIL"]);

export function StatusBadge({ value }: { value: string }) {
  const tone = successful.has(value)
    ? "success"
    : warning.has(value)
      ? "warning"
      : danger.has(value)
        ? "danger"
        : "neutral";
  const Icon =
    tone === "success"
      ? CircleCheck
      : tone === "warning"
        ? Clock3
        : tone === "danger"
          ? CircleAlert
          : value === "ALLOW"
            ? ShieldCheck
            : value === "STOP"
              ? CircleMinus
              : CircleDashed;
  return (
    <span className={`status-badge status-${tone}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2} />
      {sentenceCase(value)}
    </span>
  );
}
