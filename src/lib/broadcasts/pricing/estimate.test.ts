import { expect, it } from 'vitest';
import { deliveryCostRange, estimateBroadcastCost } from './estimate';
import data from './rates.json';
it('uses category, recipient country and selected currency with a 10% failure range', () => {
  const result = estimateBroadcastCost(
    ['+6281234567890', '+14155551212'],
    'Marketing',
    'IDR'
  );
  const expected =
    data.rates.IDR.Indonesia.marketing +
    data.rates.IDR['North America'].marketing;
  expect(result.maximum).toBeCloseTo(expected);
  expect(result.minimum).toBeCloseTo(expected);
  expect(
    estimateBroadcastCost(['+6281234567890'], 'Utility', 'USD').maximum
  ).toBe(data.rates.USD.Indonesia.utility);
});
it('does not invent prices for unsupported currencies or invalid numbers', () => {
  expect(() =>
    estimateBroadcastCost(['+6281234567890'], 'Marketing', 'XYZ')
  ).toThrow();
  expect(() => estimateBroadcastCost(['0'], 'Marketing', 'USD')).toThrow();
});

it.each([
  [0, 0],
  [1, 1],
  [4, 4],
  [10, 9],
  [11, 10],
  [1001, 901],
])(
  'rounds 90 percent of %i recipients up to %i deliveries',
  (count, delivered) => {
    expect(deliveryCostRange(count * 2, count)).toEqual({
      minimum: delivered * 2,
      maximum: count * 2,
      delivered,
    });
  }
);
