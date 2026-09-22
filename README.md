# panicek.sk

A static personal portfolio styled after Adrián's st/Fish terminal. Bun builds
prerendered HTML and browser bundles; just-bash runs commands in a Web Worker.
The production site has no application server.

## Run locally

Requires Bun 1.4.2 or newer.

```sh
bun install --frozen-lockfile
bun run dev
```

Open http://127.0.0.1:4321. The development command watches content, source,
public assets, and build scripts. Refresh after a rebuild. Use `PORT=4322` to
choose another port.

```sh
bun run build       # static deployment output in dist/
bun run preview     # serve an existing build
bun run check       # TypeScript
bun test            # unit and generated-output tests; build first
bun run test:browser
```

Browser tests require Chromium. Install it with `bunx playwright install chromium`
or point `CHROMIUM_PATH` at an existing executable. Start the preview server before
running them; `TEST_URL` overrides the default local URL. Screenshots are saved in
`.artifacts/`.

Build output minifies JavaScript, HTML, and CSS compiled from `src/styles.scss`.
The page preloads the encoded virtual filesystem so contacts can render as soon
as the shell is ready.

Use `bun run format` to format source files and `bun run format:check` to verify
formatting. GitHub Actions installs from the lockfile, checks formatting and types,
builds, and runs unit and Chromium browser tests on pushes and pull requests.
Browser tests cover the terminal, Vim, and downloads against the built artifact.
`bun run test:browser:ci` starts and stops its own preview server. Publishing
requires all tests to pass. Jobs use Ubuntu 24.04, and browser diagnostics are
retained for seven days.

## Edit the portfolio

Edit `content/ABOUT.md`, `content/CAREER.md`, and `content/CONTACTS.md`. Every file
under `content/`, including nested files, is published beneath `/home/web/` and
seeded into the shell. Add only files intended for public access.

A link such as `[Career](CAREER.md)` types `cat ~/CAREER.md | render` character by character,
then executes it. Escape or Ctrl+C cancels the animation and restores any input
draft. Reduced-motion preferences skip the typing delay.
Relative links resolve from the displayed document, not the current shell
directory. External links behave normally. With JavaScript disabled or a modified
click, links open raw files.

Build output includes robots.txt, sitemap.xml, llms.txt, llms-full.txt, files.json,
canonical/social metadata, Person JSON-LD, and a terminal favicon. The sitemap and
agent index are generated from current Markdown files. The original CV and
editorial documents are not published. Ubuntu Mono is bundled with its license.

## Browser executables

Run `./programs/hello "your name"` or `./programs/counter.js` in the terminal.
JavaScript and raw Wasm files run locally with terminal output and optional UI.
See [the executable API and Wasm ABI](docs/executables.md) for authoring,
permissions, isolation and current shell limitations.

## Filesystem URLs

- `/home/web/CAREER.md`: absolute virtual path.
- `/~/CAREER.md`: home expansion for user `web`.
- `/~/notes/example.txt`: nested home file.
- `/tmp/example.txt`: any ordinary file created outside home.
- Directory URLs: render `INDEX.md` in the terminal, or list entries when it is absent.
- `/blog/`: a shortcut to `/home/web/blog/`; top-level content directories get matching shortcuts.

The service worker resolves filesystem paths, including symlinks, using the same
persisted data as the shell. Files edited or created in this browser are visible
through raw URLs even after the terminal tab closes. Text is served as plain text;
binary bytes use `application/octet-stream` (browsers may download them).

Before the first service worker activation, or without JavaScript, the static
host serves the published absolute files and mechanically generated `/~/` home
shortcuts. Private edits are never uploaded and cannot be shared by sending a URL.
A fresh visitor cannot resolve a private file or arbitrary virtual path before
visiting the homepage. Browsers normalize literal `.` and `..` URL segments before
requests; use the normalized absolute paths shown in directory listings.
`EXPERIENCE.md` is not an alias; the real career filename is `CAREER.md`.

`/` and `/index.html` remain the portfolio. `/assets/`, `/service-worker.js`,
`/filesystem.json`, `/snapshot.json`, `/_files/`, `/api/`, and `/favicon.svg` belong to the app and do
not serve writable virtual files. `/dev`, `/proc`, and `/sys` pseudo-files are not
persisted or published as raw files.

## Shell behavior

The user is `web`, hostname is `panicek.sk`, home is `/home/web`, and the prompt
follows the current directory: `web@panicek.sk ~ $`. The base font is 16px. Common tools include `ls`, `cat`, `find`, `grep`, `sed`, `awk`, `sort`,
`uniq`, `cut`, `tr`, `wc`, `xargs`, `cp`, `mv`, `rm`, `mkdir`, `ln`, `gzip`, and
`gunzip`, alongside shell pipes, redirection, conditionals, and loops.

- `help` shows navigation and controls.
- Tab completes paths; Up/Down browse session command history.
- Enter runs input; Shift+Enter adds a line. Multiline paste never auto-runs.
- Native text selection/copy/paste works; Ctrl+C interrupts when no text is selected.
- `clear` clears the transcript; Ctrl+L does the same when input has focus.
- `reset` asks before removing local edits and restoring published files.

Scrollback retains up to 50,000 lines, 8 MiB of text, or 2,000 command entries.
Older output is trimmed with a visible notice. Offscreen entries skip layout;
large plain output stays in a single text node. Commands run off the main thread,
with 1 MiB output and 8 MiB filesystem limits, and a 5-second execution budget
(7-second hard worker interruption fallback). Hard interruption can discard an
unfinished command's changes; earlier saved commands remain intact.

This is a Bash-style interpreter, **not a POSIX-compliant OS or PTY**. Full-screen
native programs, real processes/job control, and interactive stdin prompts
are not supported. The `vim` command opens the embedded browser editor described below. Directory and environment are preserved between command
submissions; functions, aliases, and shell options are scoped to an individual
submission. Network access, Python, SQLite, and JavaScript execution are disabled.
Command output is plain text by default. Use `cat ~/ABOUT.md | render` or
`render ~/ABOUT.md` for Markdown. Startup commands and Markdown links use this
explicit formatting step. `render` belongs at the end of a standalone pipeline;
redirecting or piping its output onward preserves the original Markdown text.
Headings, emphasis, code, quotes, lists, tables, and images are supported. Rich
formatting is limited to 32 KiB and 300 lines; larger results remain plain text.
When input comes from one file, relative links and images use its directory.
Generated input or input from multiple files uses the current shell directory.

Images use standard Markdown: `![Description](images/photo.png)` or an HTTPS URL.
Local images can be published under `content/` or saved in the virtual filesystem;
PNG, JPEG, GIF, WebP, AVIF, and SVG image requests receive the appropriate MIME
type. Raw file navigation remains unchanged. Images load lazily, fit the terminal
width, and do not send a Referer header. Raw HTML and unsafe URL schemes are blocked.

Contact details use `{{rot13:PAYLOAD}}` tokens in `content/CONTACTS.md`.
Only ABOUT.md is prerendered. JavaScript opens CONTACTS.md on startup and
ROT13-decodes tokens in any terminal output before Markdown formatting, including
`echo`, `cat`, and pipelines. Raw URLs, shell redirects, snapshots, and agent files
retain encoded text. Use single quotes around tokens in shell commands.
The generated llms.txt and llms-full.txt explain decoding for agents. This deters
basic plaintext scraping only; JavaScript-capable bots can recover the address.
Phone and WhatsApp links use `{{rot47:PAYLOAD}}` tokens because ROT47 also
obscures digits. It rotates printable ASCII characters (33–126) by 47; spaces
stay unchanged. Both token formats decode only for terminal display.

Run `vim ~/notes.txt` (or `vi`) for the lazy-loaded CodeMirror editor with Vim
keybindings. It supports normal/insert/visual modes, motions, undo, search, and
`:w`, `:q`, `:q!`, `:wq`, `:x`. Files save to the same browser filesystem and raw
URLs. Failed saves retain the buffer; `:q` refuses unsaved changes. The editor
preserves CRLF line endings and accepts UTF-8 text up to 1 MiB. It opens one file
at a time; use a standalone shell command without pipes or redirects. This is
Vim keybinding support, not a full Vim executable, plugin system, or Vimscript
runtime. Terminal and editor layouts use the available viewport width.

Download files with `save ~/ABOUT.md ~/portrait.txt` or
`/usr/sbin/save /tmp/image.png`. The executable lives in `/usr/sbin`, which is
on PATH. Filenames, globs, quoted paths, and symlinks use normal shell resolution;
file contents download byte-for-byte, including encoded contact tokens. Each file
gets a separate browser download and a transcript link for retrying it. Some
browsers require permission for multiple automatic downloads. Missing files and
directories report errors while valid arguments still download. A command can
prepare up to 100 files totaling 8 MiB.

## YouTube videos

Embed a video with Markdown image syntax:

```md
![Video title](https://www.youtube.com/watch?v=VIDEO_ID)
```

YouTube watch, short, live, embed, and youtu.be links are supported. `render`
creates a responsive, lazy-loaded player using youtube-nocookie.com, with an
ordinary YouTube link underneath. Standard Markdown links stay links. Raw files
and plain `cat` output retain the original Markdown.

## Image layout

Images fill the rendered content width by default. Set a pixel width and optional
alignment in the Markdown image title:

```md
![Portrait](portrait.png 'width=160 align=right')
![Diagram](diagram.png 'width=480 align=center')
```

Use `left` or `right` to wrap text around the image, or `center` to center it.
Width alone also works. Images always shrink to fit their container; floated
images stack above the text on screens up to 520px wide. Ordinary image titles
remain tooltips.

## CRT experiment

The `experiment/crt` branch adds scanlines, a subtle phosphor texture, edge
shading, highlight bloom, and viewport-wide barrel distortion
that simulates curved glass. Bloom affects images and Vim as well as
text. Effects are limited to the visible screen, with a faint refresh band
travelling from top to bottom every eight seconds. Reduced motion disables the band.
The terminal scrolls inside the screen, so the curve stays fixed as content moves. A pixel-style
mouse pointer is drawn inside the same CRT layer, beneath the scanlines, using
the same coordinates as the elements it points to. Mouse movement updates at most once per frame;
touch input uses no custom pointer. Turning CRT off restores the native cursor.
The footer's
`crt: on/off` button remembers the setting in this browser. Scanlines and the refresh band stay anchored to the viewport while content scrolls. Overlay layers never intercept input;
the displacement map is generated once, and the filter stays viewport-sized.

Firefox uses a lighter CRT mode with the same VGA font, static scanlines, and
edge shading, but no SVG curvature/bloom filter or moving refresh band. It uses
native page scrolling and the native cursor to avoid continuous full-screen
rasterization during idle caret blinking and scrolling.

CRT mode uses WebPlus IBM VGA 8x16 by VileR, a pixel-outline reproduction of
classic BIOS/VGA text-mode characters, at the existing responsive text size.
Vim uses the same font. The self-hosted webfont is 23 KB and includes extended
Unicode characters for accented text. The original font is distributed unchanged
under CC BY-SA 4.0; license and attribution are in `public/assets/IBM-VGA-*`.
[Font source](https://int10h.org/oldschool-pc-fonts/).
Turning CRT off restores Ubuntu Mono at 16px.

Run `bun run dev` to preview it locally. This branch builds and tests in GitHub
Actions but cannot publish deployment releases; only pushes to master can do that.

Local Markdown images reserve their intrinsic aspect ratio before loading; the
build reads dimensions from PNG, JPEG, GIF, WebP, AVIF, and SVG files. For remote
images, provide dimensions in the title, such as `"width=800 height=450"`.
The optional `align=left`, `align=right`, or `align=center` follows the dimensions.

## Compressed assets

The build writes maximum-compression gzip and Brotli variants of text assets.
The server negotiates Brotli or gzip when supported by the browser. Plain responses remain
available. Compression preserves the complete shell and its tools; the worker is
about 305 KB over Brotli or 382 KB over gzip, versus 1.34 MB uncompressed.
Tests check decompressed bytes and enforce 350 KB Brotli / 450 KB gzip budgets.

The portfolio host enables HTTP/2 and HTTP/3 on TCP/UDP port 443 and advertises
HTTP/3 using `Alt-Svc`, with HTTP/1.1 fallback.

## Social previews

Static Open Graph and Twitter/X card metadata includes a 1200×630 PNG preview,
image dimensions and alt text, title, description, and canonical URL. Crawlers do
not need JavaScript. The preview uses the existing portrait and terminal styling;
it adds no image request to normal page startup.

The default site origin is `https://panicek.sk`; override it with `SITE_ORIGIN`
when building for another deployment. Canonical, social, sitemap,
and discovery URLs use this origin. Regenerate the committed preview asset with
`bun scripts/social-card.ts` after installing Playwright Chromium; set
`CHROMIUM_PATH` when using an existing browser installation.

## Visitor counter

The static client sends a random UUID stored in `portfolio:visitor` in localStorage
once per page load to `POST /api/visit`. The footer displays the unique browser
count. Clearing storage, private browsing, and other devices create new identities;
this is not a count of distinct people. JavaScript-disabled visits are not counted.
If storage or the collector is unavailable, the terminal continues normally.

nginx handles the endpoint directly with njs; no standalone API process is needed.
`deploy/njs/visitors.ts` validates requests and atomically increments a numeric
shared-dictionary entry per UUID. The dictionary size is the unique-browser count.
It retains IDs and visit totals, without collecting new IP, user-agent, path, or
referrer records. The previous SQLite database remains archived for rollback.

Build the handler with `bun run build:visitors`. Its installation and nginx
configuration are managed on the server, outside this repository. See
[deployment notes](docs/deployment.md#nginx-native-visitor-counter).

The 16 MiB dictionary has no expiry or eviction. Its state is persisted outside
static releases at `/var/lib/nginx/portfolio-visitors/state.json`. njs writes updates
asynchronously, approximately once per second; abrupt host failure can lose the
latest unsaved updates. Normal reloads retain shared memory; restarts reload the
state file. Capacity exhaustion returns 503 and leaves the terminal usable.
Origin checks and nginx rate limits remain; client UUIDs are not proof of a person.

Run `python3 tests/njs-nginx.py .artifacts/njs/visitors.js` on a host with compatible
nginx/njs to test real concurrent requests, migration format, persistence, reloads,
and restarts using an isolated Unix socket. Override `NGINX_PATH` and `NJS_MODULE`
when installed outside the default paths.

## Lazy directories

Only immediate `/home/web/*` files and system files are included in startup data.
Nested directories load from nginx JSON autoindex under `/_files/home/web/`, shared
by shell commands, completion, the editor, downloads, and raw URLs. `ls` loads the
queried directory without recursively fetching its children. `llms-full.txt` embeds
immediate portfolio pages and links to nested pages, so it does not preload blog
bodies indirectly. Doom JavaScript and Wasm load only when launching `DOOM`.
See [deployment instructions](docs/deployment.md#directory-pages-and-lazy-content)
for the hosting requirements and traversal protections.
