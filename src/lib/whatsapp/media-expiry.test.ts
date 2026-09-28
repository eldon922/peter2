import { describe, it, expect } from 'vitest'
import { isMetaMediaIdExpired } from './media-expiry'

const NOW = Date.parse('2026-09-28T00:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString()

describe('isMetaMediaIdExpired', () => {
  it('is fresh well inside the 30-day window', () => {
    expect(isMetaMediaIdExpired(daysAgo(1), NOW)).toBe(false)
    expect(isMetaMediaIdExpired(daysAgo(28), NOW)).toBe(false)
  })

  it('expires one day early (day 29) to leave a safety margin', () => {
    expect(isMetaMediaIdExpired(daysAgo(29), NOW)).toBe(true)
    expect(isMetaMediaIdExpired(daysAgo(31), NOW)).toBe(true)
  })

  it('does not block on an unknown or garbage time', () => {
    expect(isMetaMediaIdExpired(null, NOW)).toBe(false)
    expect(isMetaMediaIdExpired(undefined, NOW)).toBe(false)
    expect(isMetaMediaIdExpired('not-a-date', NOW)).toBe(false)
  })

  it('accepts a Date', () => {
    expect(isMetaMediaIdExpired(new Date(NOW - 40 * 86_400_000), NOW)).toBe(true)
  })
})
