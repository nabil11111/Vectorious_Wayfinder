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
