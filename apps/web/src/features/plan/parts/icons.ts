import type { BoardVehicle, Brand } from '@wayfinder/contracts';
import brandFresh from '@/assets/icons/icon-brand-fresh.png';
import brandStyle from '@/assets/icons/icon-brand-style.png';
import brandTech from '@/assets/icons/icon-brand-tech.png';
import cutoff from '@/assets/icons/icon-cutoff.png';
import deliveryWindow from '@/assets/icons/icon-delivery-window.png';
import orderDelivered from '@/assets/icons/icon-order-delivered.png';
import orderWaiting from '@/assets/icons/icon-order-waiting.png';
import route from '@/assets/icons/icon-route.png';
import lorry from '@/assets/icons/icon-truck-lorry.png';
import reefer from '@/assets/icons/icon-truck-reefer.png';
import van from '@/assets/icons/icon-van.png';
import warning from '@/assets/icons/icon-warning.png';

// The design's own pictures, named by what they stand for on the plan board.
export const ICON = { unplanned: orderWaiting, trucks: lorry, done: orderDelivered, route, checks: warning, cutoff, day: deliveryWindow };

export const BRAND_ICON: Record<Brand, string> = { Fresh: brandFresh, Style: brandStyle, Tech: brandTech };

// A fridge truck, a truck or a van, as the frames draw each vehicle.
export const vehicleIcon = (vehicle: Pick<BoardVehicle, 'type' | 'temp'>) => (vehicle.type === 'van' ? van : vehicle.temp === 'reefer' ? reefer : lorry);
