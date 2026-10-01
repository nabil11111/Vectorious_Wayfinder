import { cn } from '@/lib/utils';

// The Wayfinder mark from the Figma file: a W drawn as one route through stop dots, ending in a pin. light is the
// sign-in page's version for the dark ink panel: a white route with its stops hollowed in ink, and the same orange pin.
export function Mark({ className, light = false }: { className?: string; light?: boolean }) {
  const route = light ? '#fff' : '#1F2933';
  const stop = light ? '#1F2933' : '#fff';
  return (
    <svg viewBox="0 0 100 72" className={className} aria-hidden="true">
      <polyline points="10,14 30,64 50,22 70,64 88,24" fill="none" stroke={route} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      {[[10, 14], [30, 64], [50, 22], [70, 64]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill={stop} stroke={route} strokeWidth="4" />
      ))}
      <path d="M88 28C81 20 77 16 77 11C77 4.93 81.93 0 88 0C94.07 0 99 4.93 99 11C99 16 95 20 88 28Z" fill="#EF6C00" />
      <circle cx="88" cy="11" r="4" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-heading text-lg font-bold', light && 'text-secondary-foreground', className)} aria-label="Wayfinder">
      <Mark light={light} className="h-[0.8em] w-auto" />
      <span aria-hidden="true">ayfinder</span>
    </span>
  );
}
