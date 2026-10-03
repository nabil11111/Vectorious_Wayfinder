import type { ReceivingStatus } from '@wayfinder/contracts';
export const statusWords: Record<ReceivingStatus, string> = { unconfirmed: 'Not confirmed', ready: 'Ready to receive', unavailable: 'Temporarily unavailable' };
