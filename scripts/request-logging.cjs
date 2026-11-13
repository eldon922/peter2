// Loaded before Next's standalone server so completed API requests reach docker logs.
const { channel } = require('node:diagnostics_channel');
const started = new WeakMap();
channel('http.server.request.start').subscribe(({ request }) => {
  started.set(request, performance.now());
});
channel('http.server.response.finish').subscribe(({ request, response }) => {
  const pathname = (request.url || '/').split('?')[0];
  if (!pathname.startsWith('/api/')) return;
  const duration = Math.round(performance.now() - (started.get(request) ?? performance.now()));
  const line = `${new Date().toISOString()} ${request.method} ${pathname} ${response.statusCode} ${duration}ms\n`;
  (response.statusCode >= 500 ? process.stderr : process.stdout).write(line);
});
