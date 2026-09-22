import { staticHandler } from './static-handler';
const server = Bun.serve({
  port: Number(process.env.PORT || 4321),
  hostname: '127.0.0.1',
  fetch: staticHandler('dist'),
});
console.log(`Portfolio preview: ${server.url}`);
