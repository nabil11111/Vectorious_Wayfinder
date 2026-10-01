// Remember my staff ID (spec 018, rule 6): only the staff ID, only on this device, written only after a sign-in that
// worked. Storage that throws or is empty never stops a sign-in: each read and write is caught and logged, and the
// form then starts empty.

export const REMEMBER_KEY = 'wayfinder-staff-id';

export type StaffIdStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Reaching the storage can throw too, when the browser blocks it.
const browserStorage = (): StaffIdStorage => window.localStorage;

export function rememberedStaffId(storage: () => StaffIdStorage = browserStorage): string {
  try {
    return storage().getItem(REMEMBER_KEY) ?? '';
  } catch (error) {
    console.warn('Could not read the remembered staff ID on this device.', error);
    return '';
  }
}

// After a sign-in that worked: keep the staff ID when Remember my staff ID was ticked, forget it when not.
export function keepStaffId(staffId: string, remember: boolean, storage: () => StaffIdStorage = browserStorage) {
  try {
    if (remember) storage().setItem(REMEMBER_KEY, staffId);
    else storage().removeItem(REMEMBER_KEY);
  } catch (error) {
    console.warn('Could not keep the staff ID on this device.', error);
  }
}
