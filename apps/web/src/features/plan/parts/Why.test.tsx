import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Why } from './Why';
it('Q1 names the quiet planner reason disclosure', () => {
  const html = renderToStaticMarkup(<Why title="Fresh Nugegoda" reasons={[{ key: 'order', reason: 'The actual planner reason.' }]} />);
  expect(html).toContain('Plan reason: Fresh Nugegoda'); expect(html).toContain('Plan reason'); expect(html).not.toContain('why?');
});
