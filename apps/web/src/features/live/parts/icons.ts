import type { Brand, IssueKind } from '@wayfinder/contracts';
import alert from '@/assets/icons/icon-alert.png';
import brandFresh from '@/assets/icons/icon-brand-fresh.png';
import brandStyle from '@/assets/icons/icon-brand-style.png';
import brandTech from '@/assets/icons/icon-brand-tech.png';
import cutoff from '@/assets/icons/icon-cutoff.png';
import damaged from '@/assets/icons/icon-damaged.png';
import fuel from '@/assets/icons/icon-fuel.png';
import orderDelivered from '@/assets/icons/icon-order-delivered.png';
import orderList from '@/assets/icons/icon-order-list.png';
import orderPlaced from '@/assets/icons/icon-order-placed.png';
import orderWaiting from '@/assets/icons/icon-order-waiting.png';
import route from '@/assets/icons/icon-route.png';
import shopFresh from '@/assets/icons/icon-shop-fresh.png';
import shopStyle from '@/assets/icons/icon-shop-style.png';
import shopTech from '@/assets/icons/icon-shop-tech.png';
import shortfall from '@/assets/icons/icon-shortfall.png';
import timeBudget from '@/assets/icons/icon-time-budget.png';
import lorry from '@/assets/icons/icon-truck-lorry.png';
import { brandOfShop } from '@/features/loader/words';
import { vehicleIcon } from '@/features/plan/parts/icons';

// The design's own pictures on the dashboard and Live day (Dispatcher · Dashboard and · Live day): the tiles' bell,
// delivered box, lorry, placed box, fuel pump and waiting box, the next run's 4pm clock, Drops and events' clipboard
// and the brands. A missing report takes the design's stopwatch, its sign for a truck that is behind.
export const ICON = {
  alert, delivered: orderDelivered, trucks: lorry, nextRun: orderPlaced, fuel, deferred: orderWaiting, cutoff, events: orderList, watching: timeBudget,
};

// A mixed-brand trip has no brand picture in the design, so its group takes the route's.
const BRAND: Record<Brand, string> = { Fresh: brandFresh, Style: brandStyle, Tech: brandTech };
export const brandIcon = (brand: Brand | null) => (brand ? BRAND[brand] : route);

// A problem by its kind: the loader's short count, damaged goods the shop refused, the shop itself when closed, and
// a shop's report on its receipt, short like the loader's.
const SHOP: Record<Brand, string> = { Fresh: shopFresh, Style: shopStyle, Tech: shopTech };
const PROBLEM: Record<Exclude<IssueKind, 'closed'>, string> = { loading: shortfall, refused: damaged, receipt: shortfall };
export const problemIcon = (kind: IssueKind, shopName: string) => (kind === 'closed' ? SHOP[brandOfShop(shopName) ?? 'Fresh'] : PROBLEM[kind]);

export const truckIcon = (trip: { vehicleType: 'truck' | 'van'; vehicleTemp: 'reefer' | 'ambient' }) => vehicleIcon({ type: trip.vehicleType, temp: trip.vehicleTemp });
