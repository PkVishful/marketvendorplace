export function TnEmblem({
  className = 'h-11',
  tone = 'onDark',
}: {
  className?: string;
  /** onDark = navy hero/header; onLight = white surfaces */
  tone?: 'onDark' | 'onLight';
}) {
  return (
    // Source artwork is 1280x854 with the round emblem centred on white; its
    // ink occupies a 669x736 box, i.e. 86% of the frame height. object-cover
    // crops to the middle 854x854 and the scale below takes out the remaining
    // dead margin, so nearly every rendered pixel is emblem.
    //
    // That margin matters more than it looks: this seal carries a ring of Tamil
    // lettering, a gopuram and the Ashoka lions, and it is the *pixel count*
    // that decides whether any of it resolves. Below roughly 48px the ring text
    // degrades into a grey band — render it small and it will look blurred no
    // matter how clean the source is.
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
        className="h-full w-full scale-[1.14] object-cover"
        decoding="async"
      />
    </span>
  );
}
