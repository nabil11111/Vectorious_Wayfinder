import { z } from 'zod';

// Shared between the web app and the API. Keep it to shapes that cross the wire; no database types here.

export const ROLES = ['store_manager', 'dispatcher', 'loader', 'driver', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const BRANDS = ['Fresh', 'Style', 'Tech'] as const;
export const Brand = z.enum(BRANDS);
export type Brand = z.infer<typeof Brand>;

export const TEMPS = ['chilled', 'dry'] as const;
export const Temp = z.enum(TEMPS);
export type Temp = z.infer<typeof Temp>;

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
