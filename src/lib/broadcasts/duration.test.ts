import { expect, it } from 'vitest';
import { durationParts } from './duration';

it('formats durations across minute and day boundaries and clamps expired countdowns', () => {
  expect(durationParts(61500)).toEqual({ days: 0, time: '00:01:01' });
  expect(durationParts(90061000)).toEqual({ days: 1, time: '01:01:01' });
  expect(durationParts(-1000)).toEqual({ days: 0, time: '00:00:00' });
});
