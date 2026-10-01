// Another tab (no frame, spec 013, rule 10, and spec 015, rule 6): in every tab but the one that owns a queue, in
// place of the queue's screens, until that tab closes and this one takes over.
export const OTHER_TAB = 'Wayfinder is open in another tab.';

export function OtherTab() {
  return (
    <div role="status" className="rounded-[14px] bg-card px-5 py-5 shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
      <p className="text-[15px] leading-5 font-semibold">{OTHER_TAB}</p>
    </div>
  );
}
