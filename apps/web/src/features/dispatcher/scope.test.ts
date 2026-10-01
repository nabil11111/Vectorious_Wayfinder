import { BOTH_DEPOTS } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { DEPOTS, SWITCH_CHOICES, depotsOf, scopeName } from './scope';

// What a dispatcher's pages read (spec 021, D-96): the depot the session is on, or with Both each depot apart,
// Peliyagoda then Kandy. Both is a choice of the switch and never a depot a read names.

it('AC-6 Both reads Peliyagoda then Kandy, and one depot reads only itself', () => {
  expect(BOTH_DEPOTS).toBe('Both');
  expect(depotsOf('Both')).toEqual(['Peliyagoda', 'Kandy']);
  expect(depotsOf('Kandy')).toEqual(['Kandy']);
  expect(depotsOf('Peliyagoda')).toEqual(['Peliyagoda']);
  expect(depotsOf(null)).toEqual([]);
  expect(depotsOf(undefined)).toEqual([]);
  expect(DEPOTS).toEqual(['Peliyagoda', 'Kandy']);
});

it('AC-7 the switch offers Peliyagoda, Kandy and Both, and the line under the name says Both depots', () => {
  expect(SWITCH_CHOICES).toEqual(['Peliyagoda', 'Kandy', 'Both']);
  expect(scopeName('Both')).toBe('Both depots');
  expect(scopeName('Kandy')).toBe('Kandy');
});
