import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { meKey } from '@/features/auth/api';
import { retrySync, useSync } from '../queue';
import { NOT_SAVED_BAND, signInLine } from '../words';

const ACTION = '-my-2 shrink-0 rounded-md px-1 py-2 text-[13px] leading-4 font-bold text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

// The top of every driver screen, under the top bar: "Sign in again" when the session is gone, "Could not save on this
// phone." when the phone could not keep a refusal, then the screen's own band, the top line or a signal bar. On a phone
// it runs to the edges, as the frames draw it; from 768 px it sits in the column.
export function TopArea({ waitingRecords, children }: { waitingRecords: number; children?: ReactNode }) {
  const { signedOut, notSaved } = useSync();
  const qc = useQueryClient();
  return (
    <div className="-mx-4 -mt-4 mb-4 md:mx-0 md:mt-0 md:space-y-2">
      {signedOut && (
        // Sign in again (no frame): the writes wait under this account until the same driver signs in again. "Sign in"
        // opens the sign-in page, which comes back to /driver; the account stays kept on the phone meanwhile.
        <div className="flex items-center gap-3 border-b border-warn/40 bg-warn-tint px-4 py-3 md:rounded-[12px] md:border-b-0">
          <p role="alert" className="min-w-0 flex-1 text-[13px] leading-4 font-semibold text-warn-ink">{signInLine(waitingRecords)}</p>
          <button type="button" className={ACTION} onClick={() => qc.setQueryData(meKey, null)}>
            Sign in
          </button>
        </div>
      )}
      {notSaved && (
        // Not saved (no frame), from the sync loop: the record still waits and goes again by itself.
        <div className="flex items-center gap-3 border-b border-bad/30 bg-bad-tint px-4 py-3 md:rounded-[12px] md:border-b-0">
          <p role="alert" className="min-w-0 flex-1 text-[13px] leading-4 font-semibold text-bad">{NOT_SAVED_BAND}</p>
          <button type="button" className={ACTION} onClick={retrySync}>
            Try again
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
