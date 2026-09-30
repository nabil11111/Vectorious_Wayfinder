import { pgEnum } from 'drizzle-orm/pg-core';
import { BRANDS, DOCK_TYPES, ISSUE_KINDS, ISSUE_STATUSES, ORDER_STATUSES, ROLES, TEMPS, TRIP_STATUSES } from '@wayfinder/contracts';

export const roleEnum = pgEnum('role', ROLES);
export const brandEnum = pgEnum('brand', BRANDS);
export const tempEnum = pgEnum('temp', TEMPS);
export const dockTypeEnum = pgEnum('dock_type', DOCK_TYPES);
// vehicles.csv calls the fridge trucks "reefer" and the rest "ambient"; an order's temperature is chilled or dry.
export const parkingEnum = pgEnum('parking', ['normal', 'van_only', 'mall_dock']);
export const vehicleTempEnum = pgEnum('vehicle_temp', ['reefer', 'ambient']);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['truck', 'van']);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const planStatusEnum = pgEnum('plan_status', ['draft', 'published']);
export const tripStatusEnum = pgEnum('trip_status', TRIP_STATUSES);
// A problem's kind and whether the dispatcher has decided it (spec 012). A4 and A5 add kinds with add value.
export const issueKindEnum = pgEnum('issue_kind', ISSUE_KINDS);
export const issueStatusEnum = pgEnum('issue_status', ISSUE_STATUSES);
