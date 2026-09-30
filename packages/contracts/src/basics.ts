import { z } from 'zod';

// The words every piece shares. They sit in their own file so the other contract files can use them: a file
// that index.ts passes on cannot import from index.ts, which has not run yet when that file loads.

export const ROLES = ['store_manager', 'dispatcher', 'loader', 'driver', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const BRANDS = ['Fresh', 'Style', 'Tech'] as const;
export const Brand = z.enum(BRANDS);
export type Brand = z.infer<typeof Brand>;

export const TEMPS = ['chilled', 'dry'] as const;
export const Temp = z.enum(TEMPS);
export type Temp = z.infer<typeof Temp>;
