import { describe, expect, it } from 'vitest';
import { demoId } from './demo-day';

describe('ids of seeded rows', () => {
  it('gives the same id for the same row every time', () => {
    expect(demoId('order', '2026-06-25:OUT002:chilled')).toBe(demoId('order', '2026-06-25:OUT002:chilled'));
    // Pinned, so a change to how ids are made cannot slip in unnoticed: other pieces point at these rows.
    expect(demoId('order', '2026-06-25:OUT002:chilled')).toBe('99ad1370-c157-54a8-a55e-ad41ae176e68');
  });

  it('gives a different id for another row or another kind of row', () => {
    const id = demoId('order', '2026-06-25:OUT002:chilled');
    expect(demoId('order', '2026-06-25:OUT002:dry')).not.toBe(id);
    expect(demoId('plan', '2026-06-25:OUT002:chilled')).not.toBe(id);
  });

  it('is shaped as a UUID the database accepts', () => {
    expect(demoId('fuel', '2026-06-22:VEH001')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
