import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { askBeforeSignOut, useLogout } from '@/features/auth/api';

// Presence matters too: typed invalid input and an explicitly entered zero are unsent input.
export function hasFormEdits(draft: {
  counts?: object; typed?: object; reasons?: object; note?: string; cold?: boolean; photo?: unknown; reason?: string;
}) {
  return [draft.counts, draft.typed, draft.reasons].some((held) => held && Object.keys(held).length > 0)
    || Boolean(draft.note?.length || draft.photo || draft.cold === false || (draft.reason && draft.reason !== 'short'));
}

export function DiscardDraft({ open, name, signingOut = false, onKeep, onDiscard }: {
  open: boolean; name: string; signingOut?: boolean; onKeep: () => void; onDiscard: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(opened) => { if (!opened) onKeep(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this {name}?</AlertDialogTitle>
          <AlertDialogDescription>Your unsent changes will be lost. Keep editing to retain everything you entered.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeep}>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>{signingOut ? 'Discard and sign out' : 'Discard and leave'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Drafts stay only in the mounted form; discarding or signing out never persists input for another account.
export function DirtyFormWarning({ dirty, name }: { dirty: boolean; name: string }) {
  const discarded = useRef(false);
  const logout = useLogout();
  const [signingOut, setSigningOut] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !discarded.current
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => { if (logout.isError) discarded.current = false; }, [logout.isError]);
  useEffect(() => askBeforeSignOut(() => {
    if (!dirty || discarded.current) return false;
    setSigningOut(true);
    return true;
  }), [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => { if (!discarded.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);
  return <DiscardDraft open={signingOut || blocker.state === 'blocked'} name={name} signingOut={signingOut}
    onKeep={() => { setSigningOut(false); if (blocker.state === 'blocked') blocker.reset(); }}
    onDiscard={() => {
      discarded.current = true;
      if (signingOut) { setSigningOut(false); logout.signOutAnyway(); }
      else if (blocker.state === 'blocked') blocker.proceed();
    }} />;
}
