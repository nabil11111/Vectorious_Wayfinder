import { z } from 'zod';
import { Role } from './basics';

// Shared between the web app and the API. Keep it to shapes that cross the wire; no database types here.
export * from './demo';
export * from './basics';

// A person signs in with their staff ID and a four-digit PIN (spec 018). The staff ID is matched whatever its case and
// the spaces around it. One that is not a letter, a dash and three digits is simply unknown, never a wrong shape.
export const LoginRequest = z.object({
  staffId: z.string().trim().min(1).max(16).toUpperCase(),
  pin: z.string().regex(/^\d{4}$/),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// The codes the sign-in adds to the shared error shape. A body of the wrong shape is invalid_input (400), and the
// address limit's too_many_attempts (429) is not a lock.
//   bad_credentials  401  An unknown staff ID, a wrong PIN or an account that is switched off.
//                         "Staff ID or PIN isn't correct. Try again."
//   locked           429  The fifth wrong PIN in a row for a staff ID, and every sign-in to it for 15 minutes after.
//                         "Too many tries. Wait 15 minutes, or contact your depot."
export const AUTH_ERROR_CODES = ['bad_credentials', 'locked'] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

// For a dispatcher, depotId is the depot their session works on: their own until they switch (spec 020), and
// BOTH_DEPOTS ('Both') while the session is on both depots together (spec 021).
export const Me = z.object({
  id: z.string(),
  username: z.string(),
  staffId: z.string(),
  displayName: z.string(),
  role: Role,
  depotId: z.string().nullable(),
  outletId: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

// Both depots together (spec 021, D-96): the scope a dispatcher's Me.depotId and the D-95 header name while the session
// is on both depots. It is no depot of the list: a read still names one depot, and a plan belongs to one.
export const BOTH_DEPOTS = 'Both';

// PUT /me/depot: the dispatcher's depot switch (spec 020, D-93). depotId is a depot on the list or BOTH_DEPOTS (spec
// 021). It answers Me with the chosen depot, or with 'Both'. Only a dispatcher may switch (403 forbidden), and only to a
// depot on the list or to Both, written exactly so (400 unknown_record).
export const SwitchDepotRequest = z.object({
  depotId: z.string().min(1).max(64),
});
export type SwitchDepotRequest = z.infer<typeof SwitchDepotRequest>;

// The query every dispatcher read takes (spec 021): ?depot= names the depot the read is for. A session on one depot
// may name only that depot, or none (409 depot_changed for another). A session on Both must name one (400 pick_a_depot)
// that is on the list (400 unknown_record). pick_a_depot and depot_changed are cross-cutting codes, like signed_out: a
// plan write on Both is refused with 409 pick_a_depot too.
export const DepotRead = z.object({ depot: z.string().min(1).max(64).optional() });
export type DepotRead = z.infer<typeof DepotRead>;

// Every error the API sends has this shape, so screens can show one message and act on one code.
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export * from './planning';
export * from './store';
export * from './admin';
export * from './plans';
export * from './issues';
export * from './loading';
export * from './driver';
export * from './operations';
export * from './receipt';
export * from './lookup';
export * from './notifications';
