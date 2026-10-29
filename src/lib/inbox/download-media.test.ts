import { expect, it } from 'vitest';
import { mediaDownloadName } from './download-media';

it('preserves original Unicode names and recovers legacy storage names', () => {
  expect(
    mediaDownloadName(
      'Laporan akhir.pdf',
      '/api/whatsapp/media/123',
      'application/pdf'
    )
  ).toBe('Laporan akhir.pdf');
  expect(
    mediaDownloadName(
      null,
      'https://example.com/account/123456-photo.png?token=x',
      'image/png'
    )
  ).toBe('photo.png');
  expect(
    mediaDownloadName(null, '/api/whatsapp/media/123456', 'image/jpeg')
  ).toBe('attachment.jpg');
  expect(mediaDownloadName('../report.pdf', '', '')).toBe('.._report.pdf');
});
