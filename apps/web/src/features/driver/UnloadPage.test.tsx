import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DriverStop, DriverTrip } from '@wayfinder/contracts';
import type { DriverView } from './view';
import type { Figures } from './words';
import { UnloadPage } from './UnloadPage';

const { step } = vi.hoisted(() => ({ step: vi.fn() }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./tally', () => ({ useTally: () => ({ countOf: () => 0, wrongOf: () => null, textOf: () => undefined, step, type: vi.fn(), leave: vi.fn() }) }));
const stop = { id: 'stop', seq: 1, shopName: 'Fresh Test', lines: [{ lineId: 'line', temp: 'dry', quantity: 100, name: 'Dry carton', unit: 'carton' }] } as DriverStop;
const trip = { stops: [stop], brand: 'Fresh' } as DriverTrip;
const figures = { byStop: [{ byLine: [{ loaded: 37, countTo: 100, short: 63 }] }] } as unknown as Figures;
function find(node: ReactNode, text: string): { onClick: () => void; disabled?: boolean } | undefined {
  if (Array.isArray(node)) return node.map((each) => find(each, text)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; onClick: () => void; disabled?: boolean }>(node)) return;
  if (node.props.children === text) return node.props;
  return find(node.props.children, text);
}
describe('explicit unload confirmation', () => {
  it('waits for confirmation and All unloaded uses the loaded amount rather than ordered amount', () => {
    const page = UnloadPage({ view: { waitingRecords: 0 } as DriverView, trip, figures, stop });
    expect(find(page, 'Done unloading')?.disabled).toBe(true);
    const all = find(page, 'All unloaded');
    expect(all).toBeDefined();
    all!.onClick();
    expect(step).toHaveBeenCalledWith('line', 37);
  });
});
