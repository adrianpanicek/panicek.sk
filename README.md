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

Browser tests require Chromium and Firefox. Install them with
`bunx playwright install chromium firefox`. `CHROMIUM_PATH` can point to an existing
Chromium executable; Firefox uses the Playwright installation. Start the preview server before
running them; `TEST_URL` overrides the default local URL. Screenshots are saved in
`.artifacts/`.

Build output minifies JavaScript, HTML, and CSS compiled from `src/styles.scss`.
The page preloads the encoded virtual filesystem so contacts can render as soon
as the shell is ready.

Use `bun run format` to format source files and `bun run format:check` to verify
formatting. GitHub Actions installs from the lockfile, checks formatting and types,
builds, and runs unit, Chromium, and Firefox browser tests on pushes and pull requests.
Chromium tests cover the terminal, Vim, downloads, executables, visitor counter,
and DOOM against the built artifact. Firefox coverage currently checks the shell,
rendered CRT distortion, shadow-mode bloom omission, scrolling, toggle persistence, curved
mouse pointer, and narrow layout.
`bun run test:browser:ci` starts and stops its own preview server. Publishing
requires all tests to pass. Jobs use Ubuntu 24.04, and browser diagnostics are
retained for seven days.

## Browser feature support

This matrix describes the current implementation, reviewed on 2026-09-23, for
modern browser engines with JavaScript enabled.

- ✅ Enabled by the website; not a guarantee that every browser/version was tested.
- 🟡 Expected or enabled but not verified in this browser.
- ❌ Disabled by the website or unavailable; not necessarily a browser limitation.
- ⚠️ A limitation was observed; see the notes below.

| Website feature                                                          | Chrome / Edge / Chromium                             | Firefox (Gecko)                     | Safari (WebKit)                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| Prerendered portfolio, published raw files, metadata and social previews | ✅                                                   | ✅                                  | 🟡                                     |
| Shell commands, pipes, redirects, completion, history and interruption   | ✅                                                   | ✅ basic commands tested            | 🟡                                     |
| Input highlighting, multiline input and native selection/copy/paste      | ✅                                                   | 🟡                                  | 🟡                                     |
| Markdown rendering, internal navigation and decoded contacts             | ✅                                                   | 🟡                                  | 🟡                                     |
| Images, responsive image layout and lazy loading                         | ✅                                                   | 🟡                                  | 🟡                                     |
| YouTube embeds and fallback links                                        | ✅ third-party access required                       | 🟡 third-party access required      | 🟡 third-party access required         |
| Lazy directories, directory listings and nested files                    | ✅                                                   | 🟡                                  | 🟡                                     |
| Local filesystem persistence and reset                                   | ✅ IndexedDB required                                | 🟡 IndexedDB required               | 🟡 IndexedDB required                  |
| Raw URLs for local edits, new files and symlinks                         | ✅ service worker required                           | ⚠️ Uncontrolled-tab case; see below | 🟡 service worker required             |
| Embedded Vim editor, save and unsaved-change protection                  | ✅                                                   | 🟡                                  | 🟡                                     |
| File downloads with `save`, binary files and retry links                 | ✅ download permissions apply                        | 🟡 download permissions apply       | 🟡 download permissions apply          |
| Sandboxed JavaScript executables and interactive program views           | ✅                                                   | 🟡                                  | 🟡                                     |
| Raw WebAssembly executables                                              | ✅ WebAssembly required                              | 🟡 WebAssembly required             | 🟡 WebAssembly required                |
| DOOM game                                                                | ✅ desktop requirements below                        | 🟡 same requirements                | 🟡 same requirements                   |
| DOOM WebGL curvature and bloom                                           | ✅                                                   | 🟡                                  | 🟡                                     |
| CRT VGA font, static scanlines, phosphor texture and edge shading        | ✅                                                   | ✅                                  | 🟡                                     |
| Terminal / Vim barrel distortion                                         | ✅ SVG filter                                        | ✅ Distortion-only SVG filter       | 🟡 SVG; visuals/performance unverified |
| Terminal / Vim highlight bloom                                           | ✅                                                   | ✅ Optional; slower                 | 🟡                                     |
| Phosphor-style text and image glow                                       | ✅ Via bloom                                         | ✅ 5px text and image glow          | 🟡                                     |
| Terminal moving refresh band                                             | ✅                                                   | ✅ Separate flat overlay            | 🟡                                     |
| Pixel-style CRT mouse pointer                                            | ✅ Curved CRT + mouse                                | ✅ Curved CRT + mouse               | 🟡                                     |
| CRT toggle and remembered preference                                     | ✅ localStorage for persistence                      | ✅ localStorage for persistence     | 🟡 localStorage for persistence        |
| Reduced-motion behavior                                                  | ✅ Band, caret and typing animation                  | ✅ Band, caret and typing animation | 🟡                                     |
| Responsive terminal and editor layout                                    | ✅ narrow viewports tested                           | ✅ narrow terminal tested           | 🟡                                     |
| Visitor counter                                                          | ✅ storage and collector required                    | 🟡 same requirements                | 🟡 same requirements                   |
| gzip / Brotli asset delivery                                             | ✅ plain response fallback                           | ✅ plain response fallback          | 🟡 plain response fallback             |
| Automated browser coverage                                               | ✅ Chromium suite; Chrome/Edge not separately tested | ✅ Shell/CRT suite                  | ❌                                     |

Browser settings and device capabilities also matter:

- Service-worker routes require HTTPS (or localhost), successful activation, and
  browser storage. Published files still have static routes before activation.
  Local edits stay in this browser; the service worker is not a full offline cache.
  A supplemental Firefox Vim check found a tab without a controlling service
  worker: edits persisted and raw navigation in a new tab worked, but a same-tab
  fetch of a saved file returned the static 404. This also reproduced with CRT
  off, so Firefox raw-file coverage remains incomplete independently of rendering.
- Storage restrictions or clearing site data affect filesystem persistence,
  remembered CRT settings, and visitor identity. Multiple automatic downloads
  can require permission; transcript links let the visitor retry individual files.
- DOOM requires WebAssembly and WebGL. Its launch gate requires a fine pointer,
  no coarse primary pointer, and a viewport of at least 640×480; it expects a
  physical keyboard. Touch-only phones/tablets are intentionally rejected.
  Firefox's reduced terminal effects do **not** alter the separate DOOM shader.
- With JavaScript disabled, the prerendered ABOUT page and published raw links
  remain available; the shell, decoded contacts, Vim, programs, local filesystem
  routes, visitor counter, and interactive CRT controls do not.
- Mobile support follows the actual engine, not just the browser's brand.
  These desktop test results do not certify Android or iOS devices; touch input
  uses no custom CRT pointer in any engine.

## Edit the portfolio

Edit `content/ABOUT.md`, `content/CAREER.md`, and `content/CONTACTS.md`. Every file
under `content/`, including nested files, is published beneath `/home/web/` and
seeded into the shell. Add only files intended for public access.

A link such as `[Career](CAREER.md)` types `cat ~/CAREER.md | render` character by character,
then executes it. Escape or Ctrl+C cancels the animation and restores any input
draft. Reduced-motion preferences skip the typing delay. The footer animations
toggle saves your preference and disables typing, scroll easing, and CSS animations.
Relative links resolve from the displayed document, not the current shell
directory. External links behave normally. With JavaScript disabled or a modified
click, blog index and article links open their prerendered pages; other Markdown
links open raw files. Normal blog clicks update the URL without reloading and retain scrollback,
with the new command aligned near the top of the viewport. Navigation scrolls
with quadratic easing and stops when the user scrolls or interacts; startup
does not scroll. The next prompt stays directly below the last output.

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

`bloom: on` selects the original highlight-extraction SVG bloom; `bloom: off`
selects the text shadows and image glow described below. Both modes keep
distortion, and the choice persists in this browser. Firefox defaults to off
for performance; other browsers default to on. The effects are never stacked.
The footer has a Home link on the left and reset filesystem, visitor count (when
available), CRT and bloom controls on the right, separated by `|`. Home navigates
to the site homepage.

Firefox retains the same viewport-wide barrel distortion and curved mouse
pointer, along with the VGA font, static scanlines, edge shading and blinking
caret. By default its SVG graph contains only the displacement map and displacement stage;
the highlight extraction, blur and arithmetic composite used for bloom are omitted.
A centered 5px text shadow at 35% opacity adds glow to all visible terminal text,
including the transcript, command line, footer and Vim content. Markdown images
keep a sharp foreground above a small canvas copy of their own colors. The copy
is enlarged by 8%, blurred by 5px, drawn at 60% opacity, and faded along all four
edges. Its longest side is capped at 256 pixels and it is painted from the loaded
image without another request or pixel readback. Animated images keep a static
glow sample rather than repainting it every frame. This approximates bloom
without extracting highlights inside the foreground image. Offset glyph
copies are not used. The transparent command textarea is
excluded to avoid drawing a second copy of the input. CRT-off and print disable
the glow.
The moving refresh band runs in a separate fixed overlay outside the filtered
viewport. Only the band is flat; the content, scanlines and pointer stay curved.
The overlay animates its transform, never intercepts input, and is hidden when
CRT is off, reduced motion is requested, printing, or DOOM supplies its own band.
Native HTML selection, links, input, images,
and the Vim editor remain in place; no canvas reconstruction is involved.

### Firefox distortion performance

Before adding the independent refresh overlay, a local headless Firefox 155 test
at 1920×1080 and device scale 1 measured equal five-second samples:
23.96 → 0.98 CPU-seconds while idle with the caret visible,
and 25.63 → 19.81 CPU-seconds during scripted scrolling, compared with the original
bloom and refresh-band implementation. Both scrolling samples produced about
60 animation frames per second. CPU-seconds sum work across browser processes
and cores; these are environment-specific measurements, not a universal FPS or
power guarantee.

A follow-up five-second test of the distortion-only page measured 1.00 CPU-second
idle with the band hidden and 2.03 with the independent overlay; scrolling used
19.69 and 20.15 CPU-seconds respectively, at about 59–60 frames per second.
Putting the animated band back inside the filter used 17.47 CPU-seconds idle in
the preceding comparison. The overlay therefore adds some compositing cost,
but avoids the much larger cost of filtering the animation with the whole page.

The all-text glow prioritizes appearance. Earlier all-text blur trials slowed
scrolling in Firefox; performance measurements above predate this stronger glow.
Image glow uses a separate, downsampled color copy; neither effect implements
full highlight extraction. A subsequent five-second comparison measured 2.35
CPU-seconds idle and about 54 scrolling frames per second with the previous image
drop shadow, versus 2.33 CPU-seconds idle and about 49 scrolling frames per second
with the masked image copy. The new image appearance adds some scrolling cost;
the earlier faster figures do not describe the current combination of effects.

Mozilla tracks incomplete WebRender acceleration for these SVG filters in
[bug 1896740](https://bugzilla.mozilla.org/show_bug.cgi?id=1896740), with details
about `feDisplacementMap` and `feImage` in
[bug 1972363, comment 6](https://bugzilla.mozilla.org/show_bug.cgi?id=1972363#c6).
The Firefox path reduces the filter graph instead of disabling distortion.
Removing the bloom primitives matters: merely bypassing bloom in the final
composite left substantial work in our measurements. A viewport-sized source
map and the legacy `filterRes` attribute did not provide a useful improvement,
so the shared 256×256 displacement map is retained.

The Firefox browser regression checks screenshot pixels to verify a straight
source line actually bends, even before the client bundle loads. It also checks
that bloom primitives are absent, the refresh band animates outside the filter,
its visibility follows CRT/reduced-motion/DOOM/print state, and scrolling,
pointer visibility, CRT toggling, shell input and narrow layouts work. Performance
still depends on viewport size, device pixel ratio, hardware and browser version;
the distortion-only mode is not as cheap as turning CRT off.

A WebGL terminal remains a possible larger redesign, but is not required for
this improvement. DOOM already uses its own WebGL compositor. Applying the same
approach to live HTML would require a render surface plus matching selection,
input, accessibility and pointer behavior: WebGL's
[`texImage2D` inputs](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D)
do not include an arbitrary live HTML tree.

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

## Blog

Open `/blog` or `/home/web/blog` (trailing slashes also work). The build creates
both the physical `dist/blog -> ./home/web/blog` symlink and the shell's
`/blog -> /home/web/blog` symlink. The homepage includes a blog link.

Create a directory yourself, for example `content/blog/my-first-post/`, and add
an `INDEX.md` containing the post. Directory names become the post URLs; no IDs
are generated. Keep the post's images and attachments in the same directory
(subdirectories are supported). The first paragraph becomes the clickable preview.
Use YAML frontmatter at the beginning of every post:

```md
---
title: My post title
date: 2026-09-23
tags: [Rust, Electronics]
thumbnail: cover.jpg
---

# My post title

The first paragraph introduces the post. Its text links to this INDEX.md from
both the main blog index and tag indexes.

![A photograph](cover.jpg)

[Download the attachment](schematic.pdf)
```

`title`, `date` (a valid `YYYY-MM-DD`), and `tags` (an array, possibly empty) are
required. `thumbnail` is optional and must point to an image inside the post's
own directory. With a thumbnail, the preview includes a linked image; without
one, it contains the linked title and first paragraph. Inline formatting and
links become plain text inside the clickable paragraph. Metadata stays in the raw
Markdown file and is hidden when the terminal renders it. Tags are case-sensitive.
All post directories are published; there is no draft or scheduled-publication flag.

Every `bun run build` scans posts, validates their metadata, and generates:

- `blog/INDEX.md`: latest posts, newest date first (directory name breaks date ties).
- `blog/pages/2/INDEX.md`, etc.: older posts, with 10 posts per page.
- `blog/tags/INDEX.md`: all tags and post counts.
- `blog/tags/<tag-id>/INDEX.md`: posts for a tag, also paginated at 10.

Tag IDs are stable hashes, so punctuation and Unicode tags have safe paths.
Indexes are plain Markdown with relative links to post `INDEX.md` files.
The existing terminal renderer handles previews and navigation.

Generation runs in a temporary content copy before static publishing and lazy
filesystem indexing; it does not rewrite source posts or trigger watch loops.
`content/blog/INDEX.md` is a fallback placeholder; the build replaces it in the
staged copy. `pages/` and `tags/` are reserved for generated output, rebuilt from
current posts each time. Invalid metadata or missing thumbnail files fail the build
with the offending post path. To generate indexes separately in a staging copy,
run `bun run build:blog /path/to/staged/blog` (this replaces that directory's
`INDEX.md`, `pages/`, and `tags/`).

### Index templates

Blog indexes use [Handlebars](https://handlebarsjs.com/guide/expressions.html) at
build time. Edit these templates to change their Markdown layout:

- `scripts/templates/blog/index.md.hbs`: blog pages and individual tag pages.
- `scripts/templates/blog/tags.md.hbs`: the directory of tags and post counts.

The development watcher rebuilds when either template changes. Handlebars is a
build-only dependency; template files and the engine are not shipped to browsers.
Post files remain ordinary Markdown and are not processed as templates.

The listing template receives `title`, `blogUrl`, `showBlogLink`, `tagsUrl`, `page`, `pageCount`,
`newerUrl`, `olderUrl`, and `posts`. Each post has `title`, `date`, `excerpt`, `url`,
`thumbnailUrl`, and `tags` (each with `name` and `url`). Optional URLs are `null`.
The tags template receives `blogUrl` and `tags`, each with `name`, `url`, and `count`.
All URLs are relative to the generated index, including pagination and tag pages.

For example, a minimal listing template is:

```handlebars
#
{{md title}}

{{#each posts}}
  ## [{{md title}}]({{url}}) [{{md excerpt}}]({{url}})

{{else}}
  No posts yet.
{{/each}}
```

Use `{{md value}}` for text inside Markdown headings and link labels. HTML
escaping is disabled because these templates produce Markdown; the `md` helper
escapes Markdown punctuation and HTML characters without double escaping.
Use URL fields directly, such as `({{url}})`. Normal Handlebars loops and
conditionals (`each`, `if`, `unless`) are available. Strict template checking makes
unknown fields fail the build instead of silently generating broken indexes.

### Display preferences

The CRT and bloom buttons save both choices in localStorage under
`portfolio:config`, for example `{"crt":false,"bloom":true}`. The saved settings
apply during early page startup and remain in effect across reloads and new tabs
on the same origin. Existing `portfolio:crt` and `portfolio:bloom` preferences are
read for compatibility and carried into the shared configuration on the next
change. If browser storage is blocked or corrupted, the controls still work and
use browser defaults when no valid saved choice is available.

Direct directory URLs, such as `/blog` and `/home/web/blog`, open only that
directory's index or listing. Entering a blog index or article sets the shell's
working directory to `~/blog`, including direct loads and blog links. The homepage introduction and contacts load only
at `/` or `/index.html`. Published directories with `INDEX.md` also prerender
that document in their HTML; service-worker directory navigation starts with an
empty shell while the current local or published content loads.

JavaScript hides the static transcript before first paint, types the startup
command into the empty console, and then shows its output. Without JavaScript,
the prerendered content stays visible; a failed shell load restores that content.
Blog links contain absolute URLs to the rendered directory pages, and each page
has its own canonical URL in the sitemap. Reduced motion skips the typing delay.

### Commands after rendering Markdown

Use the optional `on_render` YAML field to run a command after a document renders:

```md
---
on_render: 'cat ~/ABOUT.md | render'
---

# My page
```

The command and its output appear after the document in the terminal. It runs
in the existing browser virtual filesystem, using the current shell directory;
`~` always resolves to `/home/web`. It runs when opening a directory index,
following a Markdown link, or using `render`/`cat file.md | render`. Reading a raw
file or using plain `cat` does not execute it. Metadata stays hidden in rendered
Markdown. Static HTML without JavaScript does not execute commands.

No published article or generated index currently opts into a render hook.
Articles show only their own content; the footer's Home link returns to the
homepage. The optional hook mechanism remains available for explicitly authored
page behavior.

Hooks use the same sandbox and command limits as terminal commands. They can
modify the browser's virtual files, so use them only for intentional page behavior.
A document's hook runs at most once per render chain, with at most eight hooks
and a shared five-second deadline before starting further commands. Each command
also retains the shell's existing execution limit. Errors are shown without
removing the original document. Interactive editors and applications are unsupported.
