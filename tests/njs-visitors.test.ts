import { test, expect, afterEach } from 'bun:test';
import visitors from '../deploy/njs/visitors';

const records = new Map<string, number>();
afterEach(() => {
  records.clear();
  delete (globalThis as any).ngx;
});
function request(body: unknown, method = 'POST', origin = 'https://panicek.sk') {
  (globalThis as any).ngx = {
    shared: {
      portfolio_visitors: {
        incr(key: string, delta: number, initial: number) {
          const value = (records.get(key) ?? initial) + delta;
          records.set(key, value);
          return value;
        },
        size() {
          return records.size;
        },
      },
    },
  };
  const result = { status: 0, text: '' };
  const r = {
    method,
    headersIn: { Origin: origin },
    headersOut: {} as Record<string, string>,
    requestText: typeof body === 'string' ? body : JSON.stringify(body),
    error() {},
    return(status: number, text = '') {
      result.status = status;
      result.text = text;
    },
  };
  return { r, result };
}
const body = (id: string = crypto.randomUUID()) => ({ id, path: '/', referrer: '' });
test('njs counter deduplicates IDs and atomically counts visits', () => {
  const data = body();
  for (const id of [data.id, data.id.toUpperCase()]) {
    const { r, result } = request({ ...data, id });
    visitors.visit(r);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({ visitors: 1 });
    expect(r.headersOut['Cache-Control']).toBe('no-store');
  }
  expect(records.get(data.id)).toBe(2);
  const { r, result } = request(body());
  visitors.visit(r);
  expect(JSON.parse(result.text)).toEqual({ visitors: 2 });
});
test('njs rejects malformed requests without counting them', () => {
  for (const [data, method, origin, status] of [
    [body(), 'GET', 'https://panicek.sk', 405],
    [body(), 'POST', 'https://evil.example', 403],
    ['{', 'POST', 'https://panicek.sk', 400],
    [body('invalid'), 'POST', 'https://panicek.sk', 400],
    [{ ...body(), path: '//example.org' }, 'POST', 'https://panicek.sk', 400],
    ['x'.repeat(4097), 'POST', 'https://panicek.sk', 413],
  ] as const) {
    const { r, result } = request(data, method, origin);
    visitors.visit(r);
    expect(result.status).toBe(status);
  }
  expect(records.size).toBe(0);
});
test('full shared dictionary fails without resetting or evicting visitors', () => {
  const { r, result } = request(body());
  (globalThis as any).ngx.shared.portfolio_visitors.incr = () => {
    throw new Error('full');
  };
  visitors.visit(r);
  expect(result.status).toBe(503);
});
