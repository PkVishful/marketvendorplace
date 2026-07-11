export function TnEmblem({
  className = 'h-11 w-auto',
  tone = 'onDark',
}: {
  className?: string;
  /** onDark = navy hero/header; onLight = white surfaces */
  tone?: 'onDark' | 'onLight';
}) {
  return (
    <img
      src="/tn-emblem.png"
      alt="Government of Tamil Nadu emblem"
      className={`flex-none object-contain ${
        tone === 'onDark' ? 'drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]' : ''
      } ${className}`}
      width={44}
      height={44}
      decoding="async"
    />
  );
}
