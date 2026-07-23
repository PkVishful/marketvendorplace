export function TnEmblem({
  className = 'h-11',
  tone = 'onDark',
}: {
  className?: string;
  /** onDark = navy hero/header; onLight = white surfaces */
  tone?: 'onDark' | 'onLight';
}) {
  return (
    // The source artwork is 1280x854 with the round emblem centred on white.
    // A square, overflow-hidden wrapper plus object-cover crops to the middle
    // 854x854 — exactly the emblem and a thin white margin — so the circle
    // reads as an intentional badge rather than a clipped rectangle.
    <span
      className={`inline-grid aspect-square shrink-0 place-items-center overflow-hidden rounded-full bg-white ${
        tone === 'onDark'
          ? 'shadow-[0_2px_8px_rgba(0,0,0,0.25)] ring-1 ring-white/25'
          : 'ring-1 ring-line'
      } ${className}`}
    >
      <img
        src="/tn-emblem.webp"
        alt="Government of Tamil Nadu emblem"
        className="h-full w-full object-cover"
        width={44}
        height={44}
        decoding="async"
      />
    </span>
  );
}
