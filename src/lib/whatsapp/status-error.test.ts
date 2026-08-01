import { describe, expect, it } from 'vitest'

import { formatStatusError } from './status-error'

describe('formatStatusError', () => {
  it('reports the messaging-limit failure from Meta’s own example payload', () => {
    // Copied verbatim from the failed-status example in the status
    // webhook reference — the 131049 messaging-limit drop, which is the
    // failure that used to leave the Error column blank.
    const text = formatStatusError([
      {
        code: 131049,
        title: 'This message was not delivered to maintain healthy ecosystem engagement.',
        message:
          'This message was not delivered to maintain healthy ecosystem engagement.',
        error_data: {
          details:
            'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
        },
      },
    ])

    // error_data.details wins: it's the extended explanation, and
    // `message` is documented as a duplicate of `title`.
    expect(text).toBe(
      '(#131049) In order to maintain a healthy ecosystem engagement, the message failed to be delivered.'
    )
  })

  it('falls through an empty field to the next populated one', () => {
    expect(
      formatStatusError([
        { code: 131048, error_data: { details: '  ' }, message: 'Quality status restriction' },
      ])
    ).toBe('(#131048) Quality status restriction')
  })

  it('does not repeat a code the text already carries', () => {
    expect(
      formatStatusError([{ code: 131026, message: '(#131026) Message undeliverable' }])
    ).toBe('(#131026) Message undeliverable')
  })

  it('still says something when Meta sends no errors array at all', () => {
    // The whole point: a failed row must never render a blank cell.
    expect(formatStatusError(undefined)).not.toBe('')
    expect(formatStatusError([])).not.toBe('')
  })

  it('says something when the error entry is empty', () => {
    expect(formatStatusError([{}])).toBe('Message failed')
  })

  it('truncates a runaway detail rather than pushing it into a table cell', () => {
    const text = formatStatusError([{ code: 1, error_data: { details: 'x'.repeat(900) } }])
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text.endsWith('…')).toBe(true)
  })
})
