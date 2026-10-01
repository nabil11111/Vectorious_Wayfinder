import type { Brand, Temp } from '@wayfinder/contracts';
import chilled from '@/assets/icons/icon-chilled.png';
import damaged from '@/assets/icons/icon-damaged.png';
import cartons from '@/assets/icons/icon-goods-cartons.png';
import goodsDry from '@/assets/icons/icon-goods-dry.png';
import noSignal from '@/assets/icons/icon-no-signal.png';
import tray from '@/assets/icons/icon-offline-queue.png';
import storeManager from '@/assets/icons/icon-person-store-manager.png';
import proofPhoto from '@/assets/icons/icon-proof-photo.png';
import shopFresh from '@/assets/icons/icon-shop-fresh.png';
import shopStyle from '@/assets/icons/icon-shop-style.png';
import shopTech from '@/assets/icons/icon-shop-tech.png';
import shortfall from '@/assets/icons/icon-shortfall.png';
import sync from '@/assets/icons/icon-sync.png';
import lorry from '@/assets/icons/icon-truck-lorry.png';
import reefer from '@/assets/icons/icon-truck-reefer.png';
import van from '@/assets/icons/icon-van.png';
import { ANSWER_ICON } from '@/features/notifications/icons';

// The design's own pictures on the driver's screens (spec 013, plan.md "Words"). The ticks are the outline set's, as
// the design draws them plain.
export const ICON = { noSignal, tray, sync, proofPhoto, damaged, shortfall, cartons, storeManager };

export const GOODS: Record<Temp, string> = { chilled, dry: goodsDry };

// A shop's picture by its brand, the Fresh shop when the brand is not known.
const SHOP: Record<Brand, string> = { Fresh: shopFresh, Style: shopStyle, Tech: shopTech };
export const shopIcon = (brand: Brand | null) => SHOP[brand ?? 'Fresh'];

// The service worker keeps every picture, but it only answers a page it controls, which the first page after it is
// installed is not. So the driver's area fetches every picture it can show as soon as it opens, while there is a
// signal, and holds on to them: a screen first drawn later with no signal still has its pictures.
// The answers' pictures too, which the trip's top line shows with no signal (spec 025).
const PICTURES = [...Object.values(ICON), chilled, goodsDry, shopFresh, shopStyle, shopTech, lorry, reefer, van, ...Object.values(ANSWER_ICON)];
let held: HTMLImageElement[] | null = null;
export function holdPictures() {
  held ??= PICTURES.map((src) => {
    const picture = new Image();
    picture.decoding = 'async';
    picture.src = src;
    return picture;
  });
}
