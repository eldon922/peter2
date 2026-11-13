import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
it('logs completed API requests without query strings or request bodies', () => {
  const script = `const {channel}=require('node:diagnostics_channel');
    const request={method:'POST',url:'/api/whatsapp/templates/submit?access_token=secret',body:'private'};
    channel('http.server.request.start').publish({request});
    channel('http.server.response.finish').publish({request,response:{statusCode:502}});`;
  const result = spawnSync(
    process.execPath,
    ['--require', resolve('scripts/request-logging.cjs'), '-e', script],
    { encoding: 'utf8' }
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toMatch(
    /POST \/api\/whatsapp\/templates\/submit 502 \d+ms/
  );
  expect(result.stdout + result.stderr).not.toMatch(
    /secret|private|access_token/
  );
});
