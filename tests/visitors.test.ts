import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createVisitorHandler } from '../deploy/visitors';

test('visitor IDs deduplicate, metadata updates safely, and origins are isolated', async () => {
  const db = new Database(':memory:');
  const handle = createVisitorHandler(db, ['https://experiment.panicek.sk', 'https://panicek.sk']);
  const id = crypto.randomUUID();
  const request = (visitor: string = id, origin = 'https://experiment.panicek.sk') =>
    new Request('http://localhost/api/visit', {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-real-ip': '192.0.2.1',
        'user-agent': "test ' agent",
      },
      body: JSON.stringify({ id: visitor, path: '/', referrer: 'https://example.com/' }),
    });
  expect(await (await handle(request())).json()).toEqual({ visitors: 1 });
  expect(await (await handle(request())).json()).toEqual({ visitors: 1 });
  expect(await (await handle(request(crypto.randomUUID()))).json()).toEqual({ visitors: 2 });
  expect(db.query('SELECT visits, ip, user_agent FROM visitors WHERE id = ?').get(id)).toEqual({
    visits: 2,
    ip: '192.0.2.1',
    user_agent: "test ' agent",
  });
  expect((await handle(request(id, 'https://example.com'))).status).toBe(403);
  expect((await handle(request('bad'))).status).toBe(400);
  expect((await handle(new Request('http://localhost/api/visit'))).status).toBe(405);
  expect(db.query('SELECT count(*) AS total FROM visitors').get()).toEqual({ total: 2 });
  expect(await (await handle(request(id, 'https://panicek.sk'))).json()).toEqual({ visitors: 1 });
  expect(await (await handle(request())).json()).toEqual({ visitors: 2 });
  expect(db.query('SELECT count(*) AS total FROM visitors').get()).toEqual({ total: 3 });
  db.close();
});
