# Production deployment

The portfolio is served at https://panicek.sk by nginx on `root@panicek.sk`.

- Active document root: `/srv/http/panicek/current` (release symlink).
- Server configuration: `/etc/nginx/`, managed directly on the host.

Production nginx configuration is intentionally not stored in this repository.
Website releases contain static assets only and never modify server configuration.

Only the apex HTTPS site's static routing changed. Existing TLS configuration,
MQTT proxy and subdomain server blocks remain in place. Existing apex files fall
back to `/usr/share/nginx/html`; `/temp/` remains available. The service worker
passes `/temp`, `/mqtt`, and `/.well-known` requests through to the server.

Markdown/text files are served as UTF-8 plain text. Assets use revalidation
(`Cache-Control: no-cache`) because bundle filenames are stable. nginx compresses
text assets. The visitor counter runs inside nginx through its njs module.
`https://panicek.sk` is the accepted visitor origin. Numeric UUID visit counters
persist at `/var/lib/nginx/portfolio-visitors/state.json`, outside static releases.
The former Bun/SQLite service is retired; its database is retained for rollback.

For manual deployment, build with Bun, upload `dist/` into a new release
directory, then atomically replace the `current` symlink. Keep the previous
release for rollback. Server configuration changes are managed separately:
back them up on the host, validate with `nginx -t`, and reload only on success.

## Automatic deployment

The public repository is `adrianpanicek/panicek.sk`, with `master` as its default
branch. The Build workflow checks and builds every push and pull request. A separate
test job downloads the built artifact and runs unit, build-output, and Chromium
browser tests. Every job uses Ubuntu 24.04. Publishing requires both the build
and test jobs to pass.
For pushes to master, its publish job packages the tested Actions artifact with
Bun and publishes `portfolio.zip` in a prerelease named
`master-RUN_ID-RUN_ATTEMPT`. PR builds cannot publish deployment releases.

`panicek-update.timer` runs the compiled Bun updater every two minutes, with up
to 15 seconds of jitter. It checks the latest successful push run of `build.yml`
on master. A new release is accepted only if it matches the current master SHA,
has a matching GitHub-provided SHA-256 digest, and contains a valid static site.
It checks master again immediately before switching the `current` symlink.
Archives are size-limited and cannot write outside the staging directory; all
entries are written as regular files, never executed. The previous release stays
available. Failed downloads, validation, and outdated builds leave the site alone.

The updater runs as `panicek-deploy`, writes only to `/srv/http/panicek`, and needs
no GitHub token. Its executable and service units are root-owned and are updated
manually, never from website artifacts. Source changes to `deploy/pull.ts` need
`bun run build:updater` and a separate server installation.

```sh
systemctl status panicek-update.timer
journalctl -u panicek-update.service -n 30
systemctl start panicek-update.service
systemctl stop panicek-update.timer
```

Deployment state is `/srv/http/panicek/.deployed.json`. To roll back, stop the
timer and restore `current` to the previous path recorded there. Re-enable the
timer after resolving the bad build. Previous releases are retained; remove old
inactive releases manually when no longer needed.

## Directory pages and lazy content

Place directory pages in `content/<name>/INDEX.md`. Each top-level content directory
gets a virtual symlink `/<name>` to `/home/web/<name>`, and a static shortcut for
first visits. For example `/blog/` opens `/home/web/blog/INDEX.md`. A directory
without `INDEX.md` displays its immediate entries. Raw file URLs remain raw.
The build rejects content symlinks, ambiguous names, and reserved shortcut names.
The ZIP packager expands generated shortcuts into regular files so the existing
static updater needs no symlink handling.

`filesystem.json` and `snapshot.json` contain only immediate home files, directory
markers, shortcuts, and system files. Nested content is published separately under
`/_files/home/web/`. Before deploying this build, the host must provide JSON
directory listings at that path and serve child files as their original bytes.
The filesystem reads these listings for `ls`, completion, and path traversal,
fetching immediate files when a directory is first accessed. Nested directories
remain unloaded until accessed. Loaded content is not persisted as a user edit.

The remote tree has no generated HTML indexes or compressed sibling files.
The host must reject ambiguous traversal encodings and prevent symlink escapes
from that tree; the preview server also checks real paths against its root.
Local shell symlinks resolve only within the browser filesystem and never become
host filesystem paths. The preview server emulates nginx JSON listings for local
development; there is no new production backend or change to `/api/visit`.

## nginx-native visitor counter

The njs handler is application code: `deploy/njs/visitors.ts`. Build it with
`bun run build:visitors` and install `.artifacts/njs/visitors.js` as
`/etc/nginx/njs/visitors.js` when updating the handler. Normal static deployments
do not replace it. Keep the nginx and njs module versions compatible.

The host connects `POST /api/visit` to `portfolioVisitors.visit`, with a 4 KiB
request limit and rate limiting. The handler expects a persistent numeric shared
dictionary named `portfolio_visitors`, without expiry or eviction. Its state
lives at `/var/lib/nginx/portfolio-visitors/state.json`; preserve it across releases
and keep its directory private and writable by the nginx worker account.
The administrative `snapshot` handler must never be exposed publicly.

The completed migration and rollback backups are retained on the server. The old
Bun service is retired; historical metadata remains in the SQLite backup. njs
stores only UUIDs and visit totals, checkpointed approximately once per second.
Monitor nginx errors for failed persistence or a full dictionary. The client
handles a counter failure without interrupting the portfolio.

`tests/njs-nginx.py` creates a temporary nginx configuration solely to test the
handler in isolation; it is not a production deployment template.
