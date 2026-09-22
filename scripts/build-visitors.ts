// Preserve njs's supported `export default` syntax; bundling rewrites it to a
// named export, and njs does not implement the browser's full module syntax.
const source = await Bun.file('deploy/njs/visitors.ts').text();
const script = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(source);
await Bun.write('.artifacts/njs/visitors.js', script);

export {};
