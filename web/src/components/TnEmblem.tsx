export function TnEmblem({
  className = 'h-11',
  tone = 'onDark',
}: {
  className?: string;
  /** onDark = navy hero/header; onLight = white surfaces */
  tone?: 'onDark' | 'onLight';
}) {
  return (
    // Vector source, so the seal stays crisp at every size it is used at.
    // The raster it replaced was measured getting ~36 device pixels in the top
    // bar, which is far too few for a ring of Tamil lettering, a gopuram and
    // the Ashoka lions — that shortfall, not any filter, was the "blur".
    //
    // object-contain rather than cover: the SVG is the emblem alone on
    // transparency, so it needs fitting inside the white badge, not cropping.
    <span
      className={`inline-grid aspect-square shrink-0 place-items-center overflow-hidden rounded-full bg-white ${
        tone === 'onDark'
          ? 'shadow-[0_2px_8px_rgba(0,0,0,0.25)] ring-1 ring-white/25'
          : 'ring-1 ring-line'
      } ${className}`}
    >
      <img
        src="/tn-emblem.svg"
        alt="Government of Tamil Nadu emblem"
        className="h-[92%] w-[92%] object-contain"
        decoding="async"
      />
    </span>
  );
}
