import { expect, it } from 'vitest';
import { ScenarioReader } from './reader';

it('F5 aborts and drops a late comparison after depot, account, day, reset, input or vehicle changes', async () => {
  for (const change of ['depot', 'account', 'date', 'reset', 'orders', 'draft', 'vehicle']) {
    const reader = new ScenarioReader<number>();
    reader.invalidate('old');
    let resolve!: (n: number) => void;
    let signal!: AbortSignal;
    const pending = reader.run('old', (s) => { signal = s; return new Promise<number>((done) => { resolve = done; }); });
    reader.invalidate(change);
    expect(signal.aborted).toBe(true);
    resolve(1);
    expect(await pending).toBeUndefined();
    expect(await reader.run(change, async () => 2)).toBe(2);
  }
});
it('drops an earlier request even if a second comparison has the same identity', async () => {
  const reader = new ScenarioReader<number>(); reader.invalidate('same');
  let resolve!: (n: number) => void;
  const old = reader.run('same', () => new Promise<number>((done) => { resolve = done; }));
  expect(await reader.run('same', async () => 2)).toBe(2);
  resolve(1); expect(await old).toBeUndefined();
});
it('keeps real failures actionable but ignores aborted late failures', async () => {
  const reader = new ScenarioReader<number>(); reader.invalidate('old');
  await expect(reader.run('old', async () => { throw new Error('Planner unavailable'); })).rejects.toThrow('Planner unavailable');
  let reject!: (e: Error) => void;
  const old = reader.run('old', () => new Promise<number>((_done, fail) => { reject = fail; }));
  reader.invalidate(null); reject(new Error('Old account signed out'));
  expect(await old).toBeUndefined();
});
