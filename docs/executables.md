# Browser executables

Run `./programs/hello "your name"` for terminal output, or
`./programs/counter.js` for an interactive example. Programs are fetched when their
directory is first accessed. The runtime bundle loads only when a program runs.
No server process or extra nginx configuration is involved.

JavaScript is recognized by `.js`/`.mjs` or a first line of
`#!/usr/bin/env browser-js`. Wasm is recognized by its binary magic bytes, so it
needs no extension. Published files of these types receive mode 755 during
hydration. New files created with Vim or shell commands need `chmod +x file`.
Saved chmod changes override published defaults. Symlinks and copies work too;
an extensionless JavaScript copy needs the shebang to retain its type.

Commands currently must be standalone foreground invocations with a path, such
as `./hello` or `/programs/hello`. Literal arguments, single/double quotes and
escaped characters work. Shell expansions, environment assignments, pipelines,
redirects, background jobs and command lists are not supported for these
programs. Output goes to the terminal transcript; it is not shell pipeline data.
The displayed exit status belongs to the program; the shell's `$?` does not yet
receive asynchronous application exit codes.

## JavaScript

Programs are ES modules with a global `api`. Top-level await works. Alternatively,
export a default function, `export default async function(api) { ... }`; its
numeric return value becomes the exit status. Relative/external imports are not
supported. Bundle dependencies into the file.

```js
#!/usr/bin/env browser-js
api.print('Hello', api.args[0] || 'world');
```

| API                    | Behavior                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| `api.args`             | Read-only array of argument strings, excluding the executable path      |
| `api.print(...values)` | Plain text stdout with a newline; also `console.log`                    |
| `api.write(text)`      | Plain text stdout without an added newline                              |
| `api.error(...values)` | Plain text stderr with a newline; also `console.error`/`warn`           |
| `api.view(html)`       | Open or replace an HTML view and keep the program alive                 |
| `api.onEvent(handler)` | Receive `{type, id, value}` for click/input/change on elements with IDs |
| `api.exit(code = 0)`   | Finish; closes the view and terminates the worker                       |

A program without a view exits when module/default-function evaluation completes.
Await asynchronous work before returning. A program with a view must call
`api.exit` when finished, or the visitor can stop it. Events run in the worker;
program code does not get a DOM. Views support ordinary HTML controls and inline
CSS, not scripts, navigation, external assets or nested frames. See
[the counter example](../content/programs/counter.js).

## WebAssembly ABI

Export `main()` or `_start()` (the latter takes priority). Return an i32 exit code
or call `env.exit(code)`. Modules using memory imports below must export their
linear memory as `memory`. Initialize through the exported entry point: an
automatic Wasm start section cannot call memory-based host functions before
instantiation completes. All pointers and lengths are bytes; strings use UTF-8.

| Import from `env` | Signature and behavior                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `write`           | `(fd, pointer, length) -> i32`; fd 1 stdout or 2 stderr; returns length or -1 for unsupported fd                 |
| `exit`            | `(code) -> void`; ends execution                                                                                 |
| `arg_count`       | `() -> i32`; number of arguments, excluding executable path                                                      |
| `arg_len`         | `(index) -> i32`; UTF-8 argument length                                                                          |
| `arg_copy`        | `(index, pointer, capacity) -> i32`; copies bytes without NUL; returns length, or -1 if capacity is insufficient |
| `view`            | `(pointer, length) -> void`; display HTML and keep the program alive                                             |

For UI clicks, optionally export `on_event(id: i32)` and give controls numeric
HTML IDs. Invalid argument indexes and memory ranges fail the program safely.
This is a small browser ABI, not WASI or Emscripten emulation. Those binaries
need a compatible JS adapter/bundle. Doom retains its existing lazy adapter
because its renderer, controls and Wasm imports use a different contract.

## Isolation and limits

Programs execute in a dedicated worker owned by an iframe with an opaque origin.
They cannot access the portfolio DOM, origin storage or virtual filesystem.
Network connections and external resources are blocked by Content Security
Policy. UI markup is restricted to presentation elements and controls; messages
are accepted only from the owning frame. Executable paths remain within the
virtual filesystem and retain the existing lazy loader's traversal checks.

Stop or Ctrl+C terminates execution, including infinite loops. Runs also have a
five-minute ceiling, 1 MiB output limit, 256 KiB view limit and 10,000-message
limit. Exit statuses are 0–255; interruption is 130, timeout 124, runtime error 1.
The sandbox is not a browser-wide memory quota: a deliberately allocation-heavy
program can still exhaust browser resources.
