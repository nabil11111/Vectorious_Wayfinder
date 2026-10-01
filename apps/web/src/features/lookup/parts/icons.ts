import type { Brand } from '@wayfinder/contracts';
import brandFresh from '@/assets/icons/icon-brand-fresh.png';
import brandStyle from '@/assets/icons/icon-brand-style.png';
import brandTech from '@/assets/icons/icon-brand-tech.png';
import orderWaiting from '@/assets/icons/icon-order-waiting.png';
import proofPhoto from '@/assets/icons/icon-proof-photo.png';
import route from '@/assets/icons/icon-route.png';
import shopFresh from '@/assets/icons/icon-shop-fresh.png';
import shopStyle from '@/assets/icons/icon-shop-style.png';
import shopTech from '@/assets/icons/icon-shop-tech.png';
import { vehicleIcon } from '@/features/plan/parts/icons';

// The design's own pictures on the look-up pages (Dispatcher · Orders, · History and · Fleet): each brand's goods
// beside its card, each brand's shop on an order's row and its detail, the waiting box on Skipped lately and on what
// was not delivered, the proof photo on shop confirmations and proofs, and each vehicle by its kind.

const BRAND: Record<Brand, string> = { Fresh: brandFresh, Style: brandStyle, Tech: brandTech };
// A mixed-brand trip has no brand picture in the design, so its group takes the route's, as on Live day.
export const brandIcon = (brand: Brand | null) => (brand ? BRAND[brand] : route);

const SHOP: Record<Brand, string> = { Fresh: shopFresh, Style: shopStyle, Tech: shopTech };
export const shopIcon = (brand: Brand) => SHOP[brand];

export const ICON = { waiting: orderWaiting, proof: proofPhoto };

export const vehiclePicture = (vehicle: { type: 'truck' | 'van'; temp: 'reefer' | 'ambient' }) => vehicleIcon(vehicle);
