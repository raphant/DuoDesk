# Tailnet fork of DuoDesk

Status: code done, not yet on bazzite-go or the Mac

Written 2026-11-02 against upstream `50125ca` (v2.5.0). Changes 1-7 built the same day on branch `tailnet` of the fork `raphant/DuoDesk` (remote `fork`); test 1 passes and a dev run on `bazzite` sends beacons to the tailnet (see Progress). Next: builds (Build and release), then tests 2-6 on the three computers.

## Progress

- [x] Changes 1-7, with three changes to the plan (Plan changes below).
- [x] Test 1: `node shared/test/tailnet.js` prints `tailnet: all tests passed`. Without change 4 (upstream `discovery.js`), the same test fails: the address stays `100.73.82.100` where `192.168.1.162` was expected.
- [x] Other tests still pass: every `shared/test/*.js`, `linux/mesh/test/*.js` and `mac/mesh/test/*.js`, except `mac/mesh/test/load-all.js`, which fails the same way on upstream `50125ca` on Linux (`build Input: TypeError`). `shared/test/movebench.js` is a benchmark tool, not a test.
- [x] Dev run on `bazzite` (2026-11-02): the app started (`DuoDesk 2.5.0-tailnet.1 started (linux x64, Electron 38.8.6)`, no discovery errors) and listened on UDP 47801. A 6-second `tailscale debug capture` (no sudo: `raphant` is the Tailscale operator) showed it sending, to each of `100.123.170.66`, `100.73.82.100` and `100.87.254.4`, 4 beacons and 1 probe: one beacon every 2 s, one probe every 10 s. The found list stayed empty, as expected: no other computer runs the fork yet.
- [ ] Builds: Linux AppImage, Mac dmg.
- [ ] Tests 2-6.

### Plan changes (2026-11-02)

- `shared/test/updates.js` asserted `REPO === '0xCodez/DuoDesk'`; it now asserts `'raphant/DuoDesk'` (change 5 broke it otherwise).
- `linux/package-lock.json` and `mac/package-lock.json` carry the new version too (their top two `version` lines), so the next `npm install` does not rewrite them.
- Test 1 also checks change 4 on both `Discovery` classes (no socket opened), and runs `addresses()` against a fake `tailscale` script. For that, `shared/tailnet.js` exports its `BINS` list.

### Dev setup that worked on bazzite (2026-11-02)

- `cd linux && npm install`: npm 11 skipped Electron's download step ("install scripts not yet covered by allowScripts"), and running `node node_modules/electron/install.js` by hand under Node 26 stopped after the first file of the zip, with exit code 0. What worked: unzip the cached `~/.cache/AppImage-Cache/electron/*/electron-v38.8.6-linux-x64.zip` into `linux/node_modules/electron/dist` and write `electron` into `linux/node_modules/electron/path.txt`.
- Run: `cd linux && env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron . --user-data-dir=/tmp/ddtail/userdata --hidden`. The throwaway profile keeps `~/.config/MacShare` untouched. Without `linux-helper/bin` (not built) the shared mouse and keyboard do not work, but discovery does.
- See the beacons: `timeout 9 tailscale debug capture -o /tmp/ddtail/cap.pcap`. The file has Tailscale's own link type (`tcpdump` prints `UNSUPPORTED`); the IPv4 packet starts 4 bytes into each record on the outbound path (`0000`).
- Mac tests: `cd mac && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts` gives them `ws`.

## End goal

`bazzite`, `bazzite-go` and the personal Mac find and reach each other over Tailscale, on the same Wi-Fi or not. "Tailnet ready" means all of these pass, with the fork on all three and `bazzite-go` on a phone hotspot (a different network from the other two):

1. **Found away from home.** Overview's found list on each computer shows the other two within 35 s, each with its `100.x` address under its name.
2. **Reconnect after leaving home.** Pair `bazzite-go` with the Mac at home. Move `bazzite-go` to the hotspot. It reconnects by itself within 30 s. Its saved address (`~/.config/MacShare/pairing.json`, field `address`) is now `100.73.82.100`.
3. **Everything works over it.** Over that link: the other screen, sound, clipboard, a file send, and the shared mouse and keyboard.
4. **Home again prefers Wi-Fi.** Back on the home Wi-Fi, the found list shows `192.168.1.x` addresses and they stay put (no swapping to `100.x` and back).
5. **No Tailscale, no change.** On a computer without Tailscale, the app finds devices on Wi-Fi as upstream does.
6. **Updates come from the fork.** About › Check for updates asks `raphant/DuoDesk`, never `0xCodez/DuoDesk`.

## Changes

One new shared module and small edits at the call sites. All of it also runs in Multi-device mode (`linux/mesh/main.js` and `mac/mesh/main.js` use the same `Discovery` class). Built: 33 lines added to existing files, 55 in `shared/tailnet.js`, 97 in the test (`git diff --stat 50125ca tailnet -- linux mac shared`).

| # | File + function | What changes | Why | Size |
| --- | --- | --- | --- | --- |
| 1 | new `shared/tailnet.js`: `addresses()`, `has(address)`, `peers(status)` | `addresses()` returns the IPv4 addresses of this Tailscale user's computers that are online (`Peer[].UserID == Self.UserID`, `Online`, `OS` is `linux`, `macOS` or `windows`). It reads `tailscale status --json` in the background, at most every 30 s, and returns the last answer at once. It tries `tailscale`, then `/usr/local/bin/tailscale`, then `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. No Tailscale: an empty list. `has(address)` says whether an address is in that list. `peers(status)` is the filter, kept separate for the test | The tailnet has no broadcast, so each computer has to be told whom to beacon to. The OS filter keeps beacons off phones (four iPhones and a Pixel are on this tailnet; a packet every 2 s would wake them). The user filter drops devices other people shared in (`chelseamutah1@`, `nancynanje@`). The Mac paths are needed because an app started from the Dock gets a short `PATH` | ~45 lines |
| 2 | `linux/discovery.js` and `mac/discovery.js`, `_beacon()` | After the broadcast loop: `for (const a of tailnet.addresses()) this._send(msg, a);` | Beacons go to each tailnet computer one by one, every `BEACON_MS` (2 s), so they appear in the found list and stay in it (they drop after `DEVICE_STALE_MS`, 10 s, of silence). Not in `_targets()`: on the Mac, `_send` uses `_targets()` to decide that the Local Network permission is missing, and a unicast that fails is not that | 1 line each |
| 3 | same files, `probe()` (the branch with no address) | Same line, so probes go to tailnet computers too | Start, "Look again" and Refresh find them at once. An upstream app on the tailnet answers a probe with a beacon, so it is found too | 1 line each |
| 4 | same files, `_onMessage()` | The found entry gets a `lanAt` time (the last beacon that came from outside the tailnet). A beacon from a tailnet address keeps the old address while `lanAt` is less than `DEVICE_STALE_MS` old: `address: tailnet.has(rinfo.address) && old && Date.now() - (old.lanAt \|\| 0) < P.DEVICE_STALE_MS ? old.address : rinfo.address` | At home each computer is heard twice per beacon round, by broadcast (LAN address) and by tailnet. Without this, the found address swaps between the two every round, `'change'` fires each time, and the reconnect code in `linux/link.js` `_scheduleReconnect()` and `mac/link.js` `_scheduleReconnect()` saves whichever came last. With it: LAN at home, tailnet within 10 s of leaving. Test 5 checks it is worth keeping | 3 lines each |
| 5 | `shared/updates.js`, `REPO` | `'raphant/DuoDesk'` | The update check never offers an upstream build that lacks the change | 1 line |
| 6 | `linux/package.json`, `mac/package.json`, `version` | `2.5.0-tailnet.1` (start the number again at each upstream merge) | About shows a fork build apart from upstream. Pairing checks only `PROTOCOL_VERSION`, so fork and upstream still pair. The updater compares the part after `-` as text, so `tailnet.10` would count as older than `tailnet.9`; starting again at each merge avoids that | 1 line each |
| 7 | new `shared/test/tailnet.js` | `peers()` on a saved, trimmed `tailscale status --json`; `addresses()` with no CLI and with a fake one; change 4 on both `Discovery` classes (run as `node shared/test/tailnet.js`, like the other shared tests) | The filter and the address rule are the parts most likely to go wrong | ~100 lines |

Not changed, and why:

- **Reconnect** (`linux/link.js`, `mac/link.js`, `linux/mesh/links.js` `_resolve()`): all three already take the address from `discovery.get()` before each try, so they follow change 4.
- **WebRTC** (`linux/screen.js`, `linux/sound-renderer.js`, `linux/wired.js`, `mac/audio-rtc.js`, `mac/capture.js`, ...): `iceServers: []` gives only host candidates, and `WebRtcHideLocalIpsWithMdns` is already off in both `main.js` files. On Linux, Electron offers the `tailscale0` address as a host candidate and connects over it (Evidence). The Mac is likely the same (Open questions 1).
- **`ownAddresses()`** (`linux/main.js`, `linux/mesh/main.js`; the Mac ranks inside `pushState()`): the `tailscale0` address is already in the list, ranked last. The list is used for Overview's "your address" line and Copy, the phone QR link (first four), Wake (`wol.info` address), and Multi-device's join-everyone grant (`addrs`, where the tailnet address is the last one tried). Nothing needs it first.
- **Firewall:** already open on both Bazzites, and the Mac's is off (Evidence).
- **Bluetooth:** a paired host that discovery sees is reached over IP (`linux/link.js` `_connect()`: `viaBle` needs `!this.resolveAddress(hostId)`), so a tailnet address keeps sessions off Bluetooth and off the Wi-Fi hotspot hand-over (`shared/netlink.js`).
- **Windows:** skipped. Change 2 and 3 would be one line each in `windows/discovery.js`, but the Windows CLI path is a guess and there is no Windows machine online to test on.
- **Android:** out of scope; change 1 keeps beacons off phones.

## Build and release

| | Linux AppImage (both Bazzites) | Mac dmg (arm64) |
| --- | --- | --- |
| Pick | The fork's own GitHub Actions, `Build Linux` (`.github/workflows/build-linux.yml`), run by hand (`workflow_dispatch`) with `ref` = the fork branch and `tag` = `v2.5.0-tailnet.1` | Build on the Mac itself: `cd mac && npm install && npm run dist && npm run dmg` |
| Why | No secrets needed. Without `ANDROID_KEYSTORE` the job looks for the full Android APK in the fork's releases, finds none, warns, and builds without it (only phones use it) | `mac/build-app.sh` signs with a self-signed certificate it keeps in `~/.twindesk-signing`. The same certificate every build means Screen Recording, Accessibility and Input Monitoring stay allowed across updates. A CI runner makes a new certificate (or signs ad-hoc) every run, so every update would need all three allowed again. A dmg built on the Mac is not downloaded, so Gatekeeper does not block it |
| Needs | Actions switched on in the fork (GitHub turns them off in new forks; Actions tab › enable). After the run, mark the release as not a prerelease (`gh release edit v2.5.0-tailnet.1 --repo raphant/DuoDesk --prerelease=false --latest`): `shared/updates.js` asks GitHub for `releases/latest`, which skips prereleases, and the workflow makes prereleases | Xcode (present, Swift 6.3.3), Node (present at `/opt/homebrew/bin/node`, v26.12.0, not on the SSH `PATH`). Back up `~/.twindesk-signing` after the first build (the script's own advice) |
| Fallback | Local build on `bazzite` in a distrobox from `ubuntu:24.04` (the CI image) with `build-essential`, the X11 dev packages listed in the workflow, `libglib2.0-dev` and Node 20, then `cd linux && npm install && npm run dist`. Copy the AppImage to `bazzite-go` with `scp` | `Build macOS` in the fork's Actions, then allow the three permissions again after each update and clear the download quarantine |

To put the Mac dmg on the same release, upload it by hand: `gh release upload v2.5.0-tailnet.1 mac/dist/*.dmg --repo raphant/DuoDesk`. Without it the Mac's update check finds a release with no Mac file and says nothing (`pickAsset()` returns null).

## Tests

Each test: two arms, same machines, same place, prediction written first.

1. **Peer filter** (`shared/test/tailnet.js`, no network). Arm A: `peers()` on the saved status from `bazzite`. Arm B: the same status, all peers. Predict A = exactly `100.87.254.4`, `100.73.82.100`, `100.123.170.66`; B also holds the iPhones, the Pixel and the two shared-in devices. Third arm: no `tailscale` found → `addresses()` is `[]`, no throw. **Passed 2026-11-02** (arm A and the no-CLI arm; Progress).
2. **Found away from home.** `bazzite-go` on the phone hotspot, `bazzite` and the Mac at home. Arm A: upstream 2.5.0 on all three. Arm B: the fork on all three. Predict A: `bazzite-go` is in nobody's found list and finds nobody. B: every found list shows the other two within 35 s with `100.x` addresses.
3. **Reconnect after leaving home.** Pair `bazzite-go` with the Mac on the home Wi-Fi, then move `bazzite-go` to the hotspot. Arm A: upstream. Arm B: fork. Predict A: stays "Reconnecting" for good; `pairing.json` keeps the `192.168.1.162` address. B: connected again within 30 s; `pairing.json` holds `100.73.82.100`.
4. **Media over the tailnet.** From test 3 arm B, open the other screen and turn on sound. Arm A: `bazzite-go` on the hotspot (tailnet path). Arm B: both at home (LAN path). Predict: both arms show the screen and play sound. While it runs, `ss -uanp` on `bazzite-go` shows DuoDesk's UDP socket talking to `100.73.82.100` in A and to `192.168.1.162` in B. If `tailscale ping 100.73.82.100` says "via DERP" in A, expect a visibly lower frame rate there.
5. **Address swapping at home.** Both on the home Wi-Fi, fork running, 60 s. Arm A: with change 4. Arm B: a dev build without change 4. Count `'change'` events from `discovery` (a temporary `console.log` in a dev run). Predict A: the found address stays `192.168.1.x`, about 0 changes. B: the address swaps every round, about 30 to 60 changes. If B shows no swapping, drop change 4.
6. **Updater.** Arm A: upstream app, About › Check for updates. Arm B: fork. Predict A offers `0xCodez` releases; B shows `raphant/DuoDesk`'s `v2.5.0-tailnet.1` as current, no update offered.

## Open questions

1. **Does Electron on the Mac offer the `utun4` address as a WebRTC host candidate?** Chromium's interface list keeps an interface that is up and running and not loopback, `vmnet` or `vnic` (Evidence), and `utun4` is up and running, so likely yes. Not run. Settle: test 4, or run the 40-line script in `/tmp/ddtail/app` on the Mac with Electron (it prints every candidate and connects two peers over `100.x` only).
2. **Does the Mac app find the Tailscale CLI when started from the Dock?** The three paths in change 1 cover it; not run from a GUI app. Settle: test 2 on the Mac.
3. **At home, does WebRTC pick the tailnet pair over the Wi-Fi pair?** On `bazzite` the Wi-Fi candidate carries `network-cost 50` and the `tailscale0` one carries none. WebRTC prefers the lower cost, so at home media may already run through Tailscale. This is upstream behavior today, not something the fork adds. Settle: test 4 arm B. If it does, and it is slower, a later change can drop `100.x` candidates while a LAN pair works.
4. **Can the Mac's Local Network warning flicker?** `mac/discovery.js` `_send()` marks the permission as given after any send that works, except to `255.255.255.255`. If the permission is missing and sends to `utun4` are allowed anyway, the warning would turn on and off every round. Only matters when the permission is missing. Settle: turn the permission off for DuoDesk in System Settings › Privacy › Local Network and watch Overview for 30 s.
5. **Does a DERP relay carry the screen well enough?** Today the Go and the Mac reach each other directly at home (3 ms). On a hotspot NAT, Tailscale may fall back to its relay (`dfw`). Settle: test 4 arm A with `tailscale ping`.

## Evidence

Seen = I ran it or read it. Guessed = reasoning only.

- **Seen: discovery is broadcast only.** `linux/discovery.js` and `mac/discovery.js`, `_targets()` = each interface's broadcast address plus `255.255.255.255`; `_beacon()` and `probe()` send to those. See: `sed -n '/_targets()/,/^  }/p' linux/discovery.js`.
- **Seen: on the Mac, `_targets()` also decides the Local Network permission.** `mac/discovery.js` `_send()`: `LOCAL_NETWORK_ERRORS.has(err.code) && ... && this._targets().has(address)`, with a comment that a unicast failing with `EHOSTUNREACH` "isn't the permission". This is why changes 2 and 3 do not touch `_targets()`.
- **Seen: reconnect saves what discovery last saw.** `linux/link.js` `_scheduleReconnect()` (line ~507) and `mac/link.js` `_scheduleReconnect()` (line ~338) copy `resolveAddress()` / `resolve()` into the saved pairing. `linux/mesh/links.js` `_resolve()` asks discovery first too.
- **Seen: `_onMessage()` takes the sender's address from each packet** (`address: rinfo.address`) and emits `'change'` when it differs from the old one. That is where the swapping in change 4 comes from. The swapping itself is guessed until test 5.
- **Seen: tailnet peer list.** `tailscale status --json` on `bazzite` (1.104.2): `Self.UserID` 6267634383389516 (`raphant@github`); online peers with that user and a computer OS: `raphant-endeavouros` 100.87.254.4, `Raphael’s MacBook Pro` 100.73.82.100 (`OS: macOS`), `bazzite-go` 100.123.170.66. Also four iPhones (`OS: iOS`, one of them another user's), a Pixel (`android`), and shared-in devices with other `UserID`s. A prototype of change 1 (`/tmp/ddtail/proto/tailnet.js`, run with `node`) returned exactly those three addresses in 8 ms. See: `node /tmp/ddtail/proto/tailnet.js`.
- **Seen: the Mac CLI.** `/usr/local/bin/tailscale` exists on the Mac, but it is a 2-line shell script that runs `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, and `/usr/local/bin` is not on the SSH `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`). `/usr/local/bin/tailscale status --json` works (1.102.4, the standalone `io.tailscale.ipn.macsys` app). See: `ssh raphael@100.73.82.100 'cat /usr/local/bin/tailscale; echo $PATH'`. Guessed: an app started from the Dock gets the same short `PATH`.
- **Seen: Linux Electron offers and uses the tailnet address for WebRTC.** In `/tmp/ddtail/app` (Electron 43.1.1 from `~/.cache/electron`, with `WebRtcHideLocalIpsWithMdns` off as the app has it), the candidate list held `100.87.100.106 ... typ host` (no network cost) next to `192.168.1.160 ... typ host ... network-cost 50`. Two peers given only `100.x` candidates reached "connected" and sent a message; the selected pair was `100.87.100.106 -> 100.87.100.106 udp`. This was on one machine, and the app pins Electron 38.8.6 (`linux/package-lock.json`). See: `cd /tmp/ddtail && env -u ELECTRON_RUN_AS_NODE ./electron/electron --no-sandbox --disable-gpu /tmp/ddtail/app`.
- **Seen, then guessed: the Mac's interface passes Chromium's filter.** `ifconfig` on the Mac: `utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280`, `inet 100.73.82.100 --> 100.73.82.100 netmask 0xffffffff`. Chromium's `IfaddrsToNetworkInterfaceList()` (`net/base/network_interfaces_getifaddrs.cc`, main branch, read 2026-11-02) skips only interfaces that are down, not running, loopback, or named `vmnet` / `vnic`. Not run on the Mac (Open questions 1).
- **Seen: MTU.** `tailscale0` on both Bazzites and `utun4` on the Mac have MTU 1280. Guessed: WebRTC's packets (about 1200 bytes plus headers) fit under it.
- **Seen: firewalls.** On `bazzite` and `bazzite-go`: `firewall-cmd --get-zone-of-interface=tailscale0` says `no zone`; default zone `FedoraWorkstation` lists `1025-65535/tcp 1025-65535/udp`, which covers `PORT` 47800 and `DISCOVERY_PORT` 47801. Mac: `socketfilterfw --getglobalstate` says disabled.
- **Seen: the tailnet path is direct at home.** `tailscale ping` from `bazzite`: `bazzite-go` via `192.168.1.242:41641` in 3 ms, the Mac via `192.168.1.162:41641` in 3 ms.
- **Seen: `ownAddresses()` uses.** `linux/main.js`: Overview (`addresses` in `buildState`, shown at `linux/ui-overview.js` line 215), `qrPairView()`, `Wake` (`address: () => ownAddresses()[0]`). `linux/mesh/main.js`: also `AutoJoin` `addrs`. `mac/mesh/autojoin.js` `localAddrs()` sorts private ranges first and keeps `100.x` after them. No change needed.
- **Seen: pairing checks only the protocol number.** `shared/pairlimit.js` `versionMessage()` and `linux/hostpair.js` compare `PROTOCOL_VERSION` (1), not the app version.
- **Seen: updater.** `shared/updates.js`: `REPO = '0xCodez/DuoDesk'`, asks `releases/latest`; `compare()` compares the part after `-` as text. Both workflows create releases with `--prerelease`. Guessed from GitHub's API docs, not run: `releases/latest` skips prereleases.
- **Seen: Mac signing.** `mac/build-app.sh` signs with `MAC_IDENTITY`, else "TwinDesk Self-Signed" from `mac/scripts/signing-identity.sh` (kept in `~/.twindesk-signing`, made once per build machine), else ad-hoc. The script's header says why: macOS keeps the permissions per signature. On the Mac: no `~/.twindesk-signing` yet, no `/Applications/DuoDesk.app`, Xcode with Swift 6.3.3, `/opt/homebrew/bin/node` v26.12.0.
- **Seen: build inputs.** Both workflows run on `v*` tag pushes or by hand; the Linux one needs no secrets (`.github/actions/android-full/action.yml` falls back to a release APK, else warns). `linux/installer/build.js` and `mac/build-app.sh` copy every `shared/*.js`, so a new shared file ships without list edits. `bazzite-go` runs the `bazzite-deck` image and has `distrobox`, `toolbox` and `podman`.
