import type { LoadingTruck, Temp } from '@wayfinder/contracts';
import chilled from '@/assets/icons/icon-chilled.png';
import goodsDry from '@/assets/icons/icon-goods-dry.png';
import dispatcher from '@/assets/icons/icon-person-dispatcher.png';
import { vehicleIcon } from '@/features/plan/parts/icons';

// The design's own pictures on the loader's screens: the van and the lorries, the chilled and dry goods on the
// flag's counter, and the dispatcher beside an answer.

export const truckIcon = (truck: Pick<LoadingTruck, 'vehicleType' | 'vehicleTemp'>) => vehicleIcon({ type: truck.vehicleType, temp: truck.vehicleTemp });

export const GOODS_ICON: Record<Temp, string> = { chilled, dry: goodsDry };

export const DISPATCHER_ICON = dispatcher;
