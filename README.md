# Wind

**A little closer.** A Discord-inspired, responsive one-to-one messenger with a real peer-to-peer transport, device identities, and a small signaling service.

## What works

- Local profiles: display name, bio, accent color, and cropped profile picture.
- Shareable invites, incoming/outgoing friend requests, presence, and friend management.
- Encrypted WebRTC text messages, emoji, typing indicators, delivery acknowledgements, and device-local history.
- Chunked, integrity-checked attachments up to 25 MB, with inline photos and video playback.
- YouTube, Vimeo, and direct HTTPS video embeds. Provider content loads only after a click.
- One-to-one voice/video calls, microphone mute, camera on/off, voice-to-video upgrade, and desktop screen sharing.
- Fingerprint comparison, pinned identity keys, and signed signaling envelopes.
- Desktop/mobile responsive interface and an installable PWA with an offline app shell.
- Electron desktop wrapper and generated Capacitor Android/iOS projects with camera/microphone permissions and Wind branding.

This is a working initial implementation, not a finished Discord replacement. There are no groups, offline message delivery, push notifications, background incoming calls, account recovery, identity export, multi-device sync, or mobile screen broadcasting. Both people must have Wind open and be online. Native installers have not been compiled or tested on macOS, Windows, iPhone, or Android in this Linux environment.

## Run here

Node 22.12+ is required. The repository lives at **`/srv/storage/repos/wind`**. The requested `/storage/repo/wind` path was absent; this existing repository is on the configured rotational HDD.

Before installing, building, or writing app data on this machine, verify the storage:

```sh
findmnt -T /srv/storage/repos/wind
lsblk -o NAME,TYPE,SIZE,ROTA,MOUNTPOINTS
```

The destination must resolve to the mounted `/srv/storage` HDD (`ROTA=1`). Never proceed on the SSD if the drive is missing. Project dependencies, build output, browser downloads, and caches belong on this HDD.

```sh
cd /srv/storage/repos/wind
export ELECTRON_CACHE=/srv/storage/cache/wind/electron
export ELECTRON_BUILDER_CACHE=/srv/storage/cache/wind/electron-builder
export PLAYWRIGHT_BROWSERS_PATH=/srv/storage/cache/wind/playwright
export TMPDIR=/srv/storage/cache/wind/tmp
mkdir -p "$ELECTRON_CACHE" "$ELECTRON_BUILDER_CACHE" "$PLAYWRIGHT_BROWSERS_PATH" "$TMPDIR"
npm ci
npm run dev
```

Open **http://localhost:5173**. Create profiles in two independent browser profiles or on two devices to try an invite. Two tabs sharing the same app storage have the same identity; only one signaling session per identity is supported.

Production build:

```sh
npm run build
npm start
```

The built app and signaling server are at **http://127.0.0.1:3001**. It binds to loopback by default. Use HTTPS for real devices: a remote plain HTTP origin cannot use WebCrypto, microphone, camera, or screen capture. A phone cannot connect to a laptop's `localhost` address.

## Connect real devices

1. Host `npm start` behind HTTPS (see `deploy/Caddyfile.example`). The reverse proxy must support WebSocket upgrades.
2. Open that HTTPS address on both devices. For packaged apps, enter the server's HTTPS **origin** in Settings, or build with `VITE_SIGNAL_URL=https://wind.example.com`.
3. Add native client origins to `ALLOWED_ORIGINS`. Typical values: `capacitor://localhost` (iOS), `https://localhost` (Android), and `wind://app` (Electron). Same-origin web clients are allowed automatically. Do not add `null` or a wildcard.
4. Share an invite over a trusted channel. The other person chooses **Add a friend**, pastes it, and sends a request. Accept it under **Requests**.
5. For verified identity, choose **Conversation options → Verify identity** and compare fingerprints using a separate trusted channel.

Server environment variables are documented in `.env.example`. Node and tsx do not load that file automatically. Export the variables, use your service manager, or run:

```sh
node --env-file=/srv/storage/data/wind/server.env dist-server/index.js
```

If testing from another local web origin, explicitly list it in `ALLOWED_ORIGINS`.

### NAT traversal / TURN

A public Google STUN server is configured by default. Direct connections can fail behind restrictive NATs and firewalls. Run coturn with TURN REST authentication (`use-auth-secret`, `static-auth-secret`) and set server-only variables:

```dotenv
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_SECRET=your-long-random-coturn-secret
```

`GET /config` issues one-hour HMAC credentials; the shared secret never enters the web bundle. Put bandwidth quotas, abuse controls, and appropriate network rules on a public relay. STUN/TURN operators see connection metadata. TURN relays encrypted packets; it does not terminate the peer encryption. Screen sharing transmits video only, without system audio.

### Linux service and HDD safety

`deploy/wind.service` is a system-service template. It uses `RequiresMountsFor=/srv/storage`, a mountpoint precheck, and loopback binding. The example expects `/srv/storage/data/wind/server.env` if environment configuration is needed. Verify the backing drive before creating that directory. It is not installed or started automatically.

Signaling is memory-only and does not store messages, files, identity keys, or a database. Profiles and online connection metadata live in server memory. Put reverse-proxy certificates, state, relay state, logs, and any future application data on the HDD too; configure those services to require the mount. Project files/builds remain under this repository. Never run containers until their storage is configured at `/srv/storage/containers`.

## Platform builds

| Target        | Source          | Build requirement                           | Limitations / validation                                                  |
| ------------- | --------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Web / PWA     | `src`, `public` | `npm run build`                             | Chromium integration tested. Use HTTPS; install from the browser.         |
| macOS         | `electron`      | macOS, `npm run desktop:package -- --mac`   | Real device, permissions, signing and notarization still need validation. |
| Windows       | `electron`      | Windows, `npm run desktop:package -- --win` | NSIS target. Hardware and signing validation pending.                     |
| iPhone / iPad | `ios`           | macOS, Xcode, Apple signing                 | Foreground WKWebView WebRTC. Native build/device tests pending.           |
| Android       | `android`       | Android Studio, JDK 21, Android SDK         | Foreground WebView WebRTC. Native build/device tests pending.             |

The Electron renderer is sandboxed, has no Node access, uses a secure local protocol, restricts permissions, blocks remote navigation, and opens external links in the system browser. Desktop screen capture presents a system picker or a source-selection menu. On this Linux host the wrapper requires the rotational `/srv/storage` mount and sets its app data to `/srv/storage/data/wind-desktop`, with cache under `/srv/storage/cache/wind/desktop`.

Desktop development, after `npm run build`:

```sh
npm run desktop
```

The packaged app serves its own UI. Set the signaling URL in Settings. Set `ELECTRON_CACHE` and `ELECTRON_BUILDER_CACHE` to HDD locations before downloading/building. On a different OS, override this machine's `.npmrc` cache path using `npm --cache <your-cache-path> ci`; choose an appropriate bulk-storage location. Do not commit signing keys.

Mobile projects are already generated. Build the web client with your server URL, then sync:

```sh
VITE_SIGNAL_URL=https://wind.example.com npm run mobile:sync
npm run mobile:android
# On macOS:
npm run mobile:ios
```

`ios/App/CapApp-SPM` uses Swift Package Manager; CocoaPods is not needed for the current plugin set. Camera and microphone usage descriptions are included in `Info.plist`. Android declares and requests camera/audio permissions through Capacitor and disables OS backup of app data. A user must grant permissions to call. System-level incoming calls, background execution, push notifications, and mobile screen capture require additional native work (including ReplayKit/MediaProjection); they are not provided by the WebView wrapper. Phones can view a desktop's shared screen.

### Build automation

`.github/workflows/build.yml` provides GitHub Actions jobs for browser validation, unsigned macOS/Windows desktop packages, an Android debug APK, and an unsigned iOS simulator app. Set repository variable `WIND_SIGNAL_URL` to preconfigure the HTTPS service. These jobs have not been run here. Simulator artifacts cannot be installed on an iPhone; physical iPhone distribution requires your Apple team, provisioning, and signing. CI runners use their own temporary caches; they do not run on this machine.

## Security model

Each installation generates a P-256 ECDSA identity. The private key is non-extractable through WebCrypto and stored as a CryptoKey in IndexedDB. The user ID is derived from a SHA-256 digest of its public key. A fresh challenge proves identity ownership to signaling on each connection. Signaling envelopes include sender, recipient, timestamp, unique ID, public profile, and payload in the signature; peers verify the signature and pin the key from the invite/request. Expired or duplicate envelopes are rejected. SDP signatures bind WebRTC's DTLS fingerprints to these identities.

WebRTC provides DTLS-encrypted data channels and DTLS-SRTP media. Wind does not implement its own encryption cipher. This is transport-level end-to-end protection between the two peer devices, including when relayed through TURN. Compare fingerprints out of band to authenticate a first contact. A compromised device or maliciously modified client can still access content; the signaling/web host must be trusted to serve the intended client code. The code has not received an independent security audit.

History and attachments are **not encrypted at rest**; they live in local IndexedDB. The browser/OS and app origin can access them. Protect device storage. Clearing browser/app data destroys the device identity and local history, with no recovery. No message payloads are sent through signaling. Public profiles, IP addresses, online status, recipients and SDP/ICE metadata are visible to the signaling operator. Profile names/photos are public to peers receiving an invite/request. The app asks before loading third-party video providers; doing so reveals viewer metadata to that provider. Fonts and icons are bundled locally.

## Verify

```sh
npm test
PLAYWRIGHT_BROWSERS_PATH=/srv/storage/cache/wind/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/srv/storage/cache/wind/playwright TMPDIR=/srv/storage/cache/wind/tmp npm run test:e2e
```

The integration suite builds and runs the production server, then uses isolated browser users. It covers friendship, text delivery, a multi-chunk attachment, inline photos, opt-in video embeds, voice/video calls, camera and microphone state, screen sharing, voice-to-video upgrade, history persistence, fingerprint verification, offline peers, and a 390px phone viewport. Fake camera/microphone/screen sources are used in the automated browser. The offline PWA shell and retained device identity are also tested. This does not replace physical-device or wide-area NAT testing.

The Linux Electron shell has also passed a smoke test for secure origin, profile setup, server configuration, authenticated connection, and absence of renderer Node access. Reproduce on this machine after building:

```sh
TMPDIR=/srv/storage/cache/wind/tmp ELECTRON_CACHE=/srv/storage/cache/wind/electron xvfb-run -a node scripts/smoke-desktop.mjs
```

An unpacked Linux build is available at `release/linux-unpacked/wind`; it passed the same desktop smoke test. To test that build, add `WIND_DESKTOP_EXECUTABLE=/srv/storage/repos/wind/release/linux-unpacked/wind` to the smoke command. The smoke test uses a temporary HDD data directory and removes it afterward. The dependency audit currently reports zero known vulnerabilities, including development dependencies. Targeted minimatch overrides keep the Electron packaging toolchain on patched versions.

`npm run icons` reproduces the native/PWA bitmap icons from the source SVG using Playwright. Generated build outputs are ignored by Git.

## Layout

- `src/App.tsx`, `src/styles.css` — interface and responsive layouts.
- `src/engine.ts` — peer connections, signaling, transfer protocol, calls.
- `src/identity.ts` — identities, invites, fingerprinting, local persistence.
- `src/media.tsx` — attachment rendering and consent-based embeds.
- `shared/protocol.ts` — schemas, limits and signature canonicalization.
- `server/index.ts` — authentication, presence, ephemeral signaling and static hosting.
- `electron`, `android`, `ios` — platform wrappers.
- `tests` — protocol/security tests and real browser integration flows.

Protocol references: [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections), [TURN](https://webrtc.org/getting-started/turn-server), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup).
