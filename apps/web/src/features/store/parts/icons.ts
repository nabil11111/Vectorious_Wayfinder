import type { Brand, Temp } from '@wayfinder/contracts';
import call from '@/assets/icons/icon-call.png';
import chilled from '@/assets/icons/icon-chilled.png';
import deliveryWindow from '@/assets/icons/icon-delivery-window.png';
import goodsDry from '@/assets/icons/icon-goods-dry.png';
import orderList from '@/assets/icons/icon-order-list.png';
import orderPlaced from '@/assets/icons/icon-order-placed.png';
import orderWaiting from '@/assets/icons/icon-order-waiting.png';
import style from '@/assets/icons/icon-brand-style.png';
import tech from '@/assets/icons/icon-brand-tech.png';
import truck from '@/assets/icons/icon-truck-lorry.png';

// The design's own pictures, named by what they stand for on the shop's screens.
export const ICON = { today: deliveryWindow, orders: orderList, deliveries: truck, help: call, chilled, dry: goodsDry, style, tech, placed: orderPlaced, waiting: orderWaiting };

// The picture for a shop's goods: Fresh by temperature, Style and Tech by brand.
export const goodsIcon = (brand: Brand, temp: Temp) => (brand === 'Style' ? ICON.style : brand === 'Tech' ? ICON.tech : ICON[temp]);
