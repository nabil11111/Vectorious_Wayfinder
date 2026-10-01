import { ReceiptWrite, receiptView, StoreDeliveries, StoreDelivery, StoreOutlet } from '@wayfinder/contracts';
import { createPhoneQueue } from './queue';

// The shop's queue (spec 015, rule 6, D-57): the shared phone queue with the shop's parts. Its day is GET
// /store/deliveries and its receipts go to POST /store/receipts; the view is receiptView. Its key starts with
// `orders`, so the live stream's orders message starts its fetch, as do a clock or demo message and the minute's
// refetch. A record keeps the delivery as the form showed it, so a receipt waiting or refused on the phone is drawn
// from its own copy, applyReceipt of its request on that delivery, whether or not the deliveries still hold its stop.
// The shop's area starts it when it opens, and the tab that holds `wayfinder-shop` runs it while any shop page is open.
export const shopQueue = createPhoneQueue({
  name: 'shop',
  dayPath: '/store/deliveries',
  writePath: '/store/receipts',
  key: ['orders', 'deliveries'],
  shapes: { Day: StoreDeliveries, Write: ReceiptWrite, Shown: StoreDelivery.extend({ outlet: StoreOutlet.optional() }) },
  view: receiptView,
  accountOf: (deliveries) => deliveries.userId,
  // One receipt per delivery, and a delivery is one stop.
  recordOf: (write) => `stop:${write.stopId}`,
});
