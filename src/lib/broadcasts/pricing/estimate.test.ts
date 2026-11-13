import { expect, it } from 'vitest';
import { estimateBroadcastCost } from './estimate';
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
  expect(result.minimum).toBeCloseTo(expected * 0.9);
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
