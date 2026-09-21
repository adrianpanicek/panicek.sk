// just-bash's browser entry imports node:zlib for gzip commands.
import { gzipSync as gzip, gunzipSync as gunzip } from 'fflate';
export const constants = { Z_BEST_COMPRESSION: 9, Z_BEST_SPEED: 1, Z_DEFAULT_COMPRESSION: -1 };
type Options = { level?: number; maxOutputLength?: number };
export function gzipSync(data: Uint8Array, options?: Options) {
  const level = options?.level;
  const result = gzip(data, {
    level: (level === undefined || level < 0 ? 6 : level) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  });
  if (result.length > (options?.maxOutputLength ?? 8 * 1024 * 1024))
    throw new Error('gzip: output limit exceeded');
  return result;
}
export function gunzipSync(data: Uint8Array, options?: Options) {
  if (data.length < 18) throw new Error('gunzip: invalid gzip data');
  const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    data.length - 4,
    true,
  );
  const limit = options?.maxOutputLength ?? 8 * 1024 * 1024;
  if (size > limit) throw new Error('gunzip: output limit exceeded');
  // Supply bounded output storage instead of allowing an unbounded allocation.
  return gunzip(data, { out: new Uint8Array(size) });
}
