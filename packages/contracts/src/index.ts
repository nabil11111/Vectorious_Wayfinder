import { z } from 'zod';
import { Role } from './basics';

// Shared between the web app and the API. Keep it to shapes that cross the wire; no database types here.
export * from './demo';
export * from './basics';

export const LoginRequest = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const Me = z.object({
  id: z.string(),
  username: z.string(),
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
