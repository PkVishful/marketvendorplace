export function FeedSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rounded-xl border border-hair bg-surface p-4 shadow-card"
        >
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 flex-none animate-pulse rounded-lg bg-surface-2" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
