import { pgEnum } from 'drizzle-orm/pg-core';
import { BRANDS, DOCK_TYPES, ORDER_STATUSES, ROLES, TEMPS } from '@wayfinder/contracts';

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
