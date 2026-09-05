export default function Loading() {
  return (
    <div className="page-stack" aria-busy="true" aria-label="Loading RecoverAI data">
      <div className="skeleton skeleton-title" />
      <div className="metric-grid">
        {[0, 1, 2, 3].map((item) => (
          <div className="skeleton skeleton-card" key={item} />
        ))}
      </div>
      <div className="skeleton skeleton-panel" />
    </div>
  );
}
