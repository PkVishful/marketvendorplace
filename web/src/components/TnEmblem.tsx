export function TnEmblem({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <img
      src="/tn-emblem.svg"
      alt=""
      className={`flex-none rounded-full ${className}`}
      width={44}
      height={44}
    />
  );
}
