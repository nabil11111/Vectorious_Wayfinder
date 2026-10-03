import { z } from 'zod';

// A shop may receive goods before opening to customers. This is a dated, advisory statement by its manager,
// never a gate on the driver's work or evidence that the driver is physically at the shop (028 E).
export const ReceivingStatus = z.enum(['unconfirmed', 'ready', 'unavailable']);
export type ReceivingStatus = z.infer<typeof ReceivingStatus>;
export const ReceivingState = z.object({
  outletId: z.string().min(1), date: z.iso.date(), status: ReceivingStatus,
  note: z.string().max(200).nullable(), updatedAt: z.iso.datetime().nullable(), revision: z.number().int().min(0),
});
export type ReceivingState = z.infer<typeof ReceivingState>;

export const StoreReceiving = z.object({
  date: z.iso.date().nullable(), demoDay: z.number().int().min(1), state: ReceivingState.nullable(),
});
export type StoreReceiving = z.infer<typeof StoreReceiving>;

// The outlet comes from the signed-in account, never the body. A stale tab may not set a different day or
// replay a readiness declaration after the demo was reset; revision protects two managers at the same shop.
export const SaveReceivingRequest = z.strictObject({
  date: z.iso.date(), demoDay: z.number().int().min(1), revision: z.number().int().min(0),
  status: ReceivingStatus, note: z.string().trim().max(200),
});
export type SaveReceivingRequest = z.infer<typeof SaveReceivingRequest>;

export const ReceivingList = z.object({
  date: z.iso.date().nullable(), depot: z.string(), states: z.array(ReceivingState),
});
export type ReceivingList = z.infer<typeof ReceivingList>;
