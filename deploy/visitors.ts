import { Database } from 'bun:sqlite';

export function createVisitorHandler(db: Database, origins: string[]) {
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS visitors (
      site TEXT NOT NULL,
      id TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 1,
      ip TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      language TEXT NOT NULL,
      path TEXT NOT NULL,
      referrer TEXT NOT NULL,
      PRIMARY KEY (site, id)
    )`);
  const upsert = db.query(`INSERT INTO visitors
    (site, id, first_seen, last_seen, ip, user_agent, language, path, referrer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site, id) DO UPDATE SET
      last_seen = excluded.last_seen, visits = visitors.visits + 1,
      ip = excluded.ip, user_agent = excluded.user_agent,
      language = excluded.language,
      path = excluded.path, referrer = excluded.referrer`);
  const count = db.query('SELECT count(*) AS visitors FROM visitors WHERE site = ?');
  const record = db.transaction(
    (
      site: string,
      id: string,
      ip: string,
      agent: string,
      language: string,
      path: string,
      referrer: string,
    ) => {
      const now = new Date().toISOString();
      upsert.run(site, id, now, now, ip, agent, language, path, referrer);
      return count.get(site);
    },
  );
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store' };
    if (new URL(request.url).pathname !== '/api/visit')
      return new Response(null, { status: 404, headers });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    const site = request.headers.get('origin') || '';
    if (!origins.includes(site)) return new Response(null, { status: 403, headers });
    let body;
    try {
      const text = await request.text();
      if (text.length > 4096) return new Response(null, { status: 413, headers });
      body = JSON.parse(text);
      if (
        !body ||
        typeof body.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)
      )
        throw new Error('Invalid ID');
      if (
        typeof body.path !== 'string' ||
        !body.path.startsWith('/') ||
        body.path.startsWith('//') ||
        body.path.length > 1024
      )
        throw new Error('Invalid path');
      if (typeof body.referrer !== 'string' || body.referrer.length > 1024)
        throw new Error('Invalid referrer');
    } catch {
      return new Response(null, { status: 400, headers });
    }
    const result = record(
      site,
      body.id.toLowerCase(),
      (request.headers.get('x-real-ip') || '').slice(0, 64),
      (request.headers.get('user-agent') || '').slice(0, 1024),
      (request.headers.get('accept-language') || '').slice(0, 256),
      body.path.split(/[?#]/)[0]!,
      body.referrer.split(/[?#]/)[0]!,
    );
    return Response.json(result, { headers });
  };
}

if (import.meta.main) {
  const db = new Database(process.env.VISITOR_DB || '/var/lib/panicek-visitors/visitors.sqlite', {
    create: true,
  });
  Bun.serve({
    hostname: '127.0.0.1',
    port: 4381,
    maxRequestBodySize: 4096,
    fetch: createVisitorHandler(
      db,
      (process.env.VISITOR_ORIGINS || 'https://experiment.panicek.sk').split(','),
    ),
    error() {
      return new Response(null, { status: 500 });
    },
  });
}
