import { Panel } from './Panel';

// The shop's note on a saved or sent receipt (Q-40), as it went with the report. Nothing when it wrote none.
export function ReceiptNote({ note }: { note: string | null | undefined }) {
  if (!note) return null;
  return (
    <Panel line className="mt-3 pt-3.5 pb-4">
      <h2 className="font-sans text-[13px] leading-4 font-semibold">Your note</h2>
      <p className="mt-1.5 text-[13px] leading-[18px] break-words whitespace-pre-line text-muted-foreground">{note}</p>
    </Panel>
  );
}
