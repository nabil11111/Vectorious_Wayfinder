import type { IssueDecision, IssueKind, Notification, NotificationKind } from '@wayfinder/contracts';
import cartons from '@/assets/icons/icon-goods-cartons.png';
import damaged from '@/assets/icons/icon-damaged.png';
import deliveryWindow from '@/assets/icons/icon-delivery-window.png';
import orderDelivered from '@/assets/icons/icon-order-delivered.png';
import orderList from '@/assets/icons/icon-order-list.png';
import orderPlaced from '@/assets/icons/icon-order-placed.png';
import orderWaiting from '@/assets/icons/icon-order-waiting.png';
import driver from '@/assets/icons/icon-person-driver.png';
import route from '@/assets/icons/icon-route.png';
import backToDepot from '@/assets/icons/icon-second-trip.png';
import shortfall from '@/assets/icons/icon-shortfall.png';
import sync from '@/assets/icons/icon-sync.png';
import warning from '@/assets/icons/icon-warning.png';

// Every row's picture comes from the design's 3D icon sheet (spec 025), as the bell's own does.

export const KIND_ICON: Record<NotificationKind, string> = {
  order_placed: orderPlaced, delivery_planned: deliveryWindow, order_moved: orderWaiting, truck_left: route, driver_arrived: driver,
  delivered: orderDelivered, refused: damaged, shop_closed: warning, report_answered: orderList,
  problem: warning, truck_ready: cartons, truck_back: backToDepot,
  plan_out: orderList, plan_changed: sync, plan_taken_back: orderWaiting, flag_answered: shortfall,
  trip_sent: route, trip_changed: sync, problem_answered: backToDepot,
};

// A new problem by its kind: short at the dock, refused at the door, a closed shop, a shop's report.
export const ISSUE_ICON: Record<IssueKind, string> = { loading: shortfall, refused: damaged, closed: warning, receipt: orderList };

// The dispatcher's answers at a glance (AC-3b): each answer kind's picture. Its short form is written once beside the
// answer's words (driverAnswerShort in the contracts), so the driver's card, the trip's top line and the bell's row show
// the same picture and the same words.
export const ANSWER_ICON: Record<IssueDecision, string> = {
  bring_back: backToDepot, try_again: sync, go_short: shortfall, load_all: cartons, send_replacements: orderPlaced, no_replacement: shortfall,
};
// The driver reads "Send replacements" as bringing the cartons back, which is what they do; the replacements are the shop's.
export const driverAnswerIcon = (decision: IssueDecision) => ANSWER_ICON[decision === 'send_replacements' ? 'bring_back' : decision];

export function iconOf(item: Pick<Notification, 'kind' | 'issueKind' | 'decision'>): string {
  if (item.kind === 'problem_answered' && item.decision) return driverAnswerIcon(item.decision);
  if (item.decision) return ANSWER_ICON[item.decision];
  if (item.issueKind) return ISSUE_ICON[item.issueKind];
  return KIND_ICON[item.kind];
}
