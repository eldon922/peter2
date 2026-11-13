import { expect, it } from 'vitest';
import { throwMetaError } from './meta-api';
it('shows Meta actionable validation explanation instead of generic invalid parameter', async () => {
  await expect(
    throwMetaError(
      Response.json(
        {
          error: {
            code: 100,
            message: 'Invalid parameter',
            error_user_title: 'Invalid body',
            error_user_msg: 'Variables cannot be placed at the start or end.',
          },
        },
        { status: 400 }
      ),
      'Failed'
    )
  ).rejects.toThrow('(#100) Variables cannot be placed at the start or end.');
});
