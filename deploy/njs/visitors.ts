interface VisitorRequest {
  method: string;
  headersIn: Record<string, string | undefined>;
  headersOut: Record<string, string>;
  requestText?: string;
  return(status: number, body?: string): void;
  error(message: string): void;
}
declare const ngx: {
  shared: {
    portfolio_visitors: {
      incr(key: string, delta: number, initial: number): number;
      size(): number;
      items(maxCount: number): [string, number][];
    };
  };
};

function visit(r: VisitorRequest) {
  r.headersOut['Cache-Control'] = 'no-store';
  r.headersOut['Content-Type'] = 'application/json';
  if (r.method !== 'POST') {
    r.return(405);
    return;
  }
  if (r.headersIn.Origin !== 'https://panicek.sk') {
    r.return(403);
    return;
  }
  const text = r.requestText || '';
  if (text.length > 4096) {
    r.return(413);
    return;
  }
  let body;
  try {
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
  } catch (error) {
    r.return(400);
    return;
  }
  try {
    // A single atomic operation inserts new visitors or increments existing visits.
    // No expiry or eviction: capacity exhaustion must not silently forget identities.
    const dictionary = ngx.shared.portfolio_visitors;
    dictionary.incr(body.id.toLowerCase(), 1, 0);
    r.return(200, JSON.stringify({ visitors: dictionary.size() }));
  } catch (error) {
    r.error('Visitor dictionary unavailable or full');
    r.return(503);
  }
}
// Administrative handler: bind only to a root-only Unix socket during migration.
function snapshot(r: VisitorRequest) {
  const dictionary = ngx.shared.portfolio_visitors;
  const entries = dictionary.items(dictionary.size());
  const state: Record<string, { value: number }> = {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    state[entry[0]] = { value: entry[1] };
  }
  r.return(200, JSON.stringify(state));
}
export default { visit, snapshot };
