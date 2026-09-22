# Doom WebAssembly provenance

- Upstream project: <https://github.com/jacobenget/doom.wasm>
- Pinned revision: `31cc1af9656a8184830090c4e9f268383f5d7e15`
- Build command: `PATH=/home/po1nt/.bun/bin:$PATH bun run build:doom`
- Local patch: `vendor/doom/doom-exit.patch`
- WASI SDK: `24.0` (`wasi-sdk-24.0-x86_64-linux.tar.gz`)
- Binaryen: `version_119` (`binaryen-version_119-x86_64-linux.tar.gz`)
- Upstream-declared WAD URL: <https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad>
- WAD retrieval URL: <https://deb.debian.org/debian/pool/non-free/d/doom-wad-shareware/doom-wad-shareware_1.9.fixed.orig.tar.gz>
- Artifact SHA-256: `55ffbee3aa481ca23ac99472e0635847fc314aac8ed84f40b1910976d1bf453a`

The Bun build script verifies fixed SHA-256 digests for the upstream source,
WASI SDK, Binaryen, and shareware archive before extracting them. It extracts a
fresh source tree, verifies the unmodified shareware WAD, applies the local
clean-exit patch, invokes the upstream Makefile with explicit compiler and
Binaryen paths, verifies the resulting WebAssembly module and imports, and then
copies the artifact and upstream GPLv2 license into this directory.

The patch also registers a void-returning wrapper for `G_CheckDemoStatus` so
WebAssembly can run the exit callback without an indirect-call signature trap.
The native ENDOOM process exit is disabled in the WebAssembly build so all
cleanup returns to `I_Quit` and reaches the imported lifecycle callback.
