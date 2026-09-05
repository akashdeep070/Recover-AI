import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="empty-state">
      <SearchX size={28} />
      <h1>Recovery case not found</h1>
      <p>The case may have been removed from this local demo database.</p>
      <Link className="button button-primary" href="/recoveries">
        Return to recoveries
      </Link>
    </div>
  );
}
