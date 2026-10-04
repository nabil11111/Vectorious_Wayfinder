import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { reasonWords } from '../words';
import { Why } from './Why';
it('Q1 names the quiet planner reason disclosure', () => {
  const html = renderToStaticMarkup(<Why title="Fresh Nugegoda" reasons={[{ key: 'order', reason: 'The actual planner reason.' }]} />);
  expect(html).toContain('Plan reason: Fresh Nugegoda'); expect(html).toContain('Plan reason'); expect(html).not.toContain('why?');
  expect(reasonWords('Rank 14: new order; chilled; Fresh Dehiwala closes 07:45; Fresh; joined Chaminda\'s reefer truck on its run to Colombo, fills an existing run'))
    .toBe('New chilled order for Fresh Dehiwala. The shop closes at 07:45. Added to Chaminda\'s refrigerated truck, which was already going to Colombo. The planner placed it 14th.');
});
