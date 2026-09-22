# Production deployment

The portfolio is served at https://panicek.sk by nginx on `root@panicek.sk`.

- Active document root: `/srv/http/panicek/current` (release symlink).
- First release: `/srv/http/panicek/releases/20260920T231003Z`.
- Previous nginx configuration and landing page:
  `/srv/http/panicek/backups/20260920T231003Z/`.
- nginx configuration: `/etc/nginx/nginx.conf`.

Only the apex HTTPS site's static routing changed. Existing TLS configuration,
MQTT proxy and subdomain server blocks remain in place. Existing apex files fall
back to `/usr/share/nginx/html`; `/temp/` remains available. The service worker
passes `/temp`, `/mqtt`, and `/.well-known` requests through to the server.

Markdown/text files are served as UTF-8 plain text. Assets use revalidation
(`Cache-Control: no-cache`) because bundle filenames are stable. nginx compresses
text assets. The site itself remains static; the visitor counter uses the separate
`panicek-visitors` service backed by SQLite. Its compiled Bun executable and systemd
unit are installed manually, independently of the static artifact updater.
Both `panicek.sk` and `experiment.panicek.sk` are accepted origins, with separate counts.
The database is `/var/lib/panicek-visitors/visitors.sqlite` and remains outside releases.

The apex server includes `/etc/nginx/snippets/portfolio-locations.conf` for the
visitor endpoint and precompressed JavaScript. `/etc/nginx/conf.d/portfolio-http.conf`
defines its rate-limit zone and Brotli negotiation maps. Both are versioned in
`deploy/nginx/`. Static gzip is enabled, with `text/javascript` included in gzip types.

For subsequent deployments, build with Bun, upload `dist/` into a new release
directory, then atomically replace the `current` symlink. Retain the previous
release for rollback. The first-install script in `.artifacts/deploy` is specific
to the original nginx configuration and is not a general update script.

To roll back the initial nginx routing change, restore the backed-up nginx.conf,
run `nginx -t`, and reload nginx only if validation succeeds. The old static
files were left in place. To roll back a later portfolio release, point `current`
at the previous release.

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
