# Share screen on Wayland with nobody at the Bazzite

Status: design

Written 2026-11-02 against branch `tailnet` (DuoDesk 2.5.0-tailnet.1, Electron 38.8.6), `xdg-desktop-portal` 1.22.1 and `xdg-desktop-portal-kde` 6.7.5 on both Bazzites. The path in Pick was proven on `bazzite-go` with throwaway scripts in `/tmp/ddrd` (Evidence). No fork code is changed yet.

## End goal

A peer starts viewing a Bazzite's screen and gets the picture with no "Share screen with Chromium" dialog and nobody at the Bazzite. This still holds after DuoDesk restarts and after a reboot.

## Cause

`linux/pcscreen.js` `_applyOnce()` calls `desktopCapturer.getSources({types: ['screen']})` each time sharing starts. On Wayland, Chromium answers that with a new portal ScreenCast session, and KDE's ScreenCast portal shows its dialog unless the request carries a restore token from an earlier session. Chromium never keeps one across starts:

- WebRTC's `RestoreTokenManager` (`modules/desktop_capture/linux/wayland/restore_token_manager.cc`) keeps tokens in a map in memory, keyed by a source id from `GetUnusedId()`, a counter that starts again with each process.
- `BaseCapturerPipeWire` takes a new id for each capturer and sends a token only when `selected_source_id_` already has one (`base_capturer_pipewire.cc` `Start()`). Each `getSources()` makes a new capturer, so even within one run there is no token, and the dialog comes back each time.
- KDE skips its dialog with no token only in the RemoteDesktop portal: `src/remotedesktop.cpp` `isAppMegaAuthorized()` reads permission store table `kde-authorized`, key `remote-desktop`. The ScreenCast portal (`src/screencast.cpp`) has no such check.

So the "Allow restoring on future sessions" checkbox does nothing useful for DuoDesk: Chromium does not send the token back.

Which app the portal sees (this decides which permission row matters):

- DuoDesk's own process moves itself into a systemd scope `app-org.chromium.Chromium-<pid>.scope` (Chromium's `SetSystemdScopeUnitNameForXdgPortal()`; the name does not follow `CHROME_DESKTOP`, tested). `xdg-desktop-portal` turns that into app id `org.chromium.Chromium` only if `org.chromium.Chromium.desktop` exists (`xdp-app-info-host.c` `get_app_from_pid()`). On `bazzite` it exists (the Chromium flatpak), on `bazzite-go` it does not, so there the id is empty.
- A process started in a scope named `app-duodesk-<anything>.scope` gets app id `duodesk`, because `~/.local/share/applications/duodesk.desktop` exists on both machines. KDE's dialog then says "DuoDesk is asking for special privileges".

## Options

| | What | Fork change | Security cost | Latency and quality | One-time setup |
| --- | --- | --- | --- | --- | --- |
| A | A helper opens a RemoteDesktop portal session with screen sharing, allowed ahead of time for app id `duodesk`, and republishes each monitor as a PipeWire camera "DuoDesk Screen N". The sender opens that camera with `getUserMedia` instead of a `desktop` source | new `linux/screenportal.py` (~110 lines), ~30 lines in `pcscreen.js`, ~10 in `sender-renderer.js`, 1 in `main.js` | Any program of Raphant's that starts itself in an `app-duodesk-*` scope can watch the screen and move the pointer with no dialog. A program running as him can already type and click through `/dev/uinput` (his account has `rw` on it) and read his files, so the new power is silent screen capture. KDE shows a "Remote control session started" notification at each start. The camera row lets every app with that app id open cameras without the portal's question (on `bazzite`: the Chromium flatpak and Electron apps, whose websites still get Chromium's own camera question; on the Go: every program without a `.desktop` match) | Measured on the Go: 1920×1200 at 58 fps, 25 ms median from a change on screen to the frame in Electron (min 10 ms, 26 changes). One more copy than today (BGRx to BGRA in the helper), 2-7 % of one core of the Go's Ryzen Z2 Extreme. Full resolution, no colour loss before the encoder. Cursor drawn into the picture | `flatpak permission-set kde-authorized remote-desktop duodesk yes` and `flatpak permission-set devices camera <id> yes` (`org.chromium.Chromium` on `bazzite`, `""` on the Go). Both can be run over ssh |
| B | Make Chromium's own token last: a small `LD_PRELOAD` library around GLib's D-Bus calls sets `persist_mode` 2 in `SelectSources`, adds the token saved on disk, and saves the new token from each `Start` answer | new C file in `linux-helper/` (~120 lines), launch with `LD_PRELOAD` | None new: the portal's own token, per output | Same as today (Chromium's own capture) | Someone at the Bazzite clicks the dialog once, with "Allow restoring" on. Again after a monitor changes or KDE changes its restore format. Breaks if Chromium stops using GLib's D-Bus. Window capture (`pcapps.js`) uses the same calls, so tokens must be kept apart by type. Not tried |
| C | As A, but through a v4l2loopback device instead of a PipeWire camera | as A, plus a device | as A, without the camera row | YUYV: colour loss | Root. On the Go, OBS already set the module's options, so `linux/vcam.js` can only add a device until the next boot (its comment). After each reboot it needs root again. Fails the goal |
| D | Something already in Electron or Chromium | none | none | none | There is none: `desktopCapturer` has no token API, the tokens live only in memory (Cause), and no switch changes that |

## Pick

**A.** It is the only option proven to give no dialog the first time, with nobody present, and the setup is two commands that Raphant can run over ssh. B keeps Chromium's own capture, but it needs a person at the Bazzite once (and again whenever KDE drops the token), it patches Chromium from outside, and it was not tried.

What A costs Raphant, in short: one more copy per frame (measured: 25 ms median end to end at 60 fps; today's path was not measured, see Tests 3), a "Remote control session started" notification at each share, the security cost in the table, and a dependency on the host's `/usr/bin/python3` with GObject and the GStreamer PipeWire plugin. Both Bazzites have these (GStreamer 1.28.8). Where they are missing, the fork falls back to today's path.

Not covered by A:

- **Per-app windows** (`linux/pcapps.js`, `getSources({types: ['window']})`): a RemoteDesktop session gives only whole monitors (`remotedesktop.cpp` `continueStart()`), so windows still ask.
- **Extend** (`vdd.js` virtual monitor): `continueStart()` can make a KWin virtual output (source type 4, fixed 1920×1080) with no dialog. Untried; Extend keeps today's path for now.

Gaps outside the dialog that still block "after a reboot" (Evidence, seen):

1. `bazzite` has no autologin (`/etc/plasmalogin.conf` `[Autologin]` is empty). After a reboot it waits at the login screen, so no session exists to share.
2. `bazzite-go` logs in by itself, but into Game Mode (`/etc/sddm.conf.d/zz-holo-autologin.conf`: `Session=gamescope-session-ogui-steam.desktop`), where KDE's portal is not running.
3. On both, DuoDesk is a transient unit (`systemd-run --user --unit=duodesk-app`), and neither has `~/.config/autostart/twindesk.desktop`. After a reboot DuoDesk does not start.
4. A screen that is off sends no new frames: with the Go's `eDP-1` off, Electron got 2.3 frames a second, all the same frame. `kscreen-doctor --dpms on` brought it back to 58. Change 5 handles this.
5. `bazzite` has no `Autolock` set in `kscreenlockerrc`, so KDE's default (lock after 5 minutes) applies. Guessed: the viewer then sees the lock screen and can type the password through DuoDesk's uinput input. The Go has `Autolock=false`.

## Changes

| # | File + function | What changes | Size |
| --- | --- | --- | --- |
| 1 | new `linux/screenportal.py` (from `/tmp/ddrd/rd.py`) | On the session bus: `RemoteDesktop.CreateSession`, `SelectDevices` (`types` 2, pointer; KDE refuses 0), `ScreenCast.SelectSources` (`types` 1 monitor, `multiple` true, `cursor_mode` 2), `RemoteDesktop.Start`, `ScreenCast.OpenPipeWireRemote`. For each stream: `pipewiresrc fd=<fd> path=<node> do-timestamp=true ! videoconvert ! videorate ! video/x-raw,format=BGRA,framerate=<fps>/1 ! pipewiresink mode=provide sync=false stream-properties="props,media.type=Video,media.category=Capture,media.class=Video/Source,media.role=Camera,node.description=DuoDesk Screen N"`. Prints one JSON line per event (`started` with each stream's `mapping_id`, `position`, `size`). Exits when stdin closes or the portal closes the session. Run as `systemd-run --user --scope --quiet --unit=app-duodesk-<random>.scope -- /usr/bin/python3 -I screenportal.py --fps <fps>`: the scope name is what gives app id `duodesk`, and `--scope` keeps it a child of DuoDesk with its stdin and stdout | ~110 lines |
| 2 | `linux/pcscreen.js` `_applyOnce()`, Wayland and Mirror only | Start the helper (change 1) instead of `getSources()`. Pick the stream whose `position` equals `d.bounds` x, y (both are logical pixels on Wayland), then `sender.start({cameraLabel: 'DuoDesk Screen N', ...})`. If the helper prints `error`, or no `started` comes within 5 s, stop it and use today's `getSources()` path. `_stopSend()` stops the helper. Keep the helper running while only the bitrate or size changes | ~30 lines |
| 3 | `linux/sender-renderer.js` `start(m)` | When `m.cameraLabel` is set: find the `videoinput` with that label (as the `audioLabel` lookup below it does for sound) and call `getUserMedia({video: {deviceId: {exact}, width: {ideal: m.width}, height: {ideal: m.height}, frameRate: {ideal: fps}, resizeMode: 'crop-and-scale'}})`. Everything after `getUserMedia` stays the same. Update the `m:` comment, and the `opts` comment on `linux/sender.js` `start()` | ~10 lines |
| 4 | `linux/main.js`, the `enable-features` switch (line 77) | `'WebRTCPipeWireCapturer,WebRtcPipeWireCamera'`. A second `appendSwitch('enable-features', ...)` would replace the first | 1 line |
| 5 | same place as change 2 | Before starting the helper, run `kscreen-doctor --dpms on`, so a screen that went dark sends frames | 1 line |

Formats: the helper must send BGRA (or YUY2). With NV12, Electron 38's video capture service crashed ("Detected crash of video capture service"). With I420, no frame arrived. A fixed `framerate` is needed: with KWin's `0/1`, Chromium stopped with "no more input formats". `media.type=Video` is needed on the camera node: without it, WirePlumber's `canLink()` will not link it.

One-time setup on each Bazzite, for `docs-okf/install.md`:

```
flatpak permission-set kde-authorized remote-desktop duodesk yes
flatpak permission-set devices camera org.chromium.Chromium yes   # bazzite; on bazzite-go: ""
```

To undo: `flatpak permission-remove kde-authorized remote-desktop duodesk` and `flatpak permission-remove devices camera <id>`. Both rows live in files under `~/.local/share/flatpak/db/` (`kde-authorized`, `devices`), so they stay after a reboot.

## Tests

1. **Dialog, two arms** (each Bazzite, fork build, a peer starts viewing). Arm without the two rows: KDE's "Remote Control" dialog appears and the viewer waits (predicted: as in Evidence, arm A). Arm with them: no dialog, the picture arrives within 1 s, KDE shows "Remote control session started", and `journalctl --user -u plasma-xdg-desktop-portal-kde` has no `MegaAuth` line. Predicted: no dialog in 10 of 10 starts.
2. **Restart and reboot.** Stop and start `duodesk-app` the way `install.md` says, then view again: no dialog. Reboot only after reboot gaps 1-3 are closed: no dialog. Predicted from code, since nothing is kept in memory: the rows are in files, the app id comes from the scope name and `duodesk.desktop`.
3. **Latency, two arms** (on `bazzite`, which has a person to click today's dialog once). Same page as `/tmp/ddrd/camapp`: a full-screen window turns black and white every 300 ms and times how long until a captured frame shows the change. Arm today's path (`desktop` source) vs arm A (camera). Predicted: A's median at most 17 ms (one frame at 60 Hz) above today's; the Go measured 25 ms median for A.
4. **Screen off.** Let the Go's screen turn off, then view. Without change 5: one still frame, about 2 frames a second. With change 5: about 58 frames a second.
5. **High refresh.** On a 120 Hz or 144 Hz display, `--fps` 120: check that the track reports 120 (`getSettings().frameRate`) and that the measured rate follows. Not tried; only 60 was measured.

## Evidence

Seen = I ran it or read it. Guessed = reasoning only. Proof scripts are in `/tmp/ddrd` on `bazzite` and `bazzite-go` (`rd.py`, `camapp/`, `armD.sh`, `cost.sh`); `/tmp` is emptied at reboot.

- **Seen: the dialog comes from KDE's ScreenCast portal, and only RemoteDesktop can skip it.** `/tmp/xdpk/src` (`xdg-desktop-portal-kde` v6.7.5): `src/remotedesktop.cpp` `Start()` calls `isAppMegaAuthorized(app_id)` (table `kde-authorized`, key `remote-desktop`, value `yes` for the app id; `""` means host apps with no known id). `src/screencast.cpp` has no such call, only `persist_mode` with `restore_data`. See: `grep -n isAppMegaAuthorized /tmp/xdpk/src/src/*.cpp`.
- **Seen: Chromium keeps its tokens in memory only.** `webrtc.googlesource.com/src` main, read 2026-11-02 (copies in `/tmp/wrtc`): `restore_token_manager.cc` (a map and a counter); `base_capturer_pipewire.cc` lines ~74, ~106, ~158 (new id per capturer; token sent only for an id it already has). Guessed: Electron 38's Chromium (140) does the same; the main branch was read, not branch 140.
- **Seen: which scope and app id.** On the Go, `/proc/<duodesk pid>/cgroup` = `app-org.chromium.Chromium-120878.scope`. A test Electron with `CHROME_DESKTOP=duodesk.desktop` still got `app-org.chromium.Chromium-<pid>.scope`. `org.chromium.Chromium.desktop` exists on `bazzite` (`~/.local/share/flatpak/exports/share/applications/`) and not on the Go. See: `cat /proc/$(systemctl --user show -p MainPID --value duodesk-app)/cgroup`.
- **Seen: arm A, no permission (Go).** `rd.py` in scope `app-duodesk-armA27643.scope`: `CreateSession`, `SelectDevices` and `SelectSources` answered, `Start` did not answer in 12 s. The screenshot (`/tmp/ddrd/armA.png`) shows KDE's "Remote Control" dialog: "DuoDesk is asking for special privileges: See what's on the screen, Control input devices", Approve and Deny. The portal log: `MegaAuth: Failed to lookup permissions: "No entry for remote-desktop"`. When the script closed the session, the dialog started to fade out (`afterA.png`); the next screenshots were blank because the screen had turned off, so its closing is seen only in part. Nobody clicked it.
- **Seen: arm B, with `kde-authorized remote-desktop duodesk yes` (Go).** Same script and scope: `Start` answered at once with `{"node": 93, "mapping_id": "eDP-1", "position": [0, 0], "size": [1129, 706], "source_type": 1}`, and frames came at 1920×1200. This ran in 6 separate processes (arm B, two arm C tries, two arm D runs, the cost run), each a new session with no dialog. That is what a DuoDesk restart does. See: `ssh raphant@bazzite-go /tmp/ddrd/armD.sh`.
- **Seen: the camera reaches Electron 38 with no dialog (Go, with also `devices camera "" yes`).** `/tmp/ddrd/electron` (Electron 38.8.6 copied from `linux/node_modules/electron/dist`) with `WebRtcPipeWireCamera` listed "DuoDesk Screen 1". `getUserMedia` gave `width 1920, height 1200, frameRate 60`. With the screen on: 58.5 fps, 26 black/white changes timed at median 25 ms (10-38 ms). A saved frame (`/tmp/ddrd/cam-frame.png`) shows the white window with the cursor at the right edge. The camera row is not proven needed by a test; it is read from `xdg-desktop-portal` 1.22.1 `src/camera.c` `query_permission_sync()`, which asks when the row is unset or `ask`.
- **Seen: cost.** The camera node appeared 0.22 s after the helper started. Helper CPU while Electron read 60 fps: 5 %, 7 %, 2 % (three `top` samples, one core = 100 %). Go: AMD Ryzen Z2 Extreme, 16 threads. See: `/tmp/ddrd/cost.sh`.
- **Seen: format and linking failures** (Changes, Formats). Electron's log for NV12: `Detected crash of video capture service`. For KWin's variable rate: `video_capture_pipewire.cc:400 PipeWire stream state error: no more input formats`. Without `media.type`: WirePlumber's info log showed `... target not found` and `Stream/Input/Unknown`; its `linking-utils.lua` `canLink()` first compares `media.type`.
- **Seen: remote input needs no dialog.** `linux-helper/src/wl.c` opens `/dev/uinput`. `getfacl /dev/uinput` on both Bazzites: `user:raphant:rw-` (a seat rule for the logged-in user). Guessed: it works while his session is the active one on the seat, locked or not, and not at the login screen. Not run with nobody present.
- **Seen: the reboot gaps.** `bazzite`: `systemctl status display-manager` = `plasmalogin.service`, `/etc/plasmalogin.conf` `[Autologin]` empty. Go: `/etc/sddm.conf.d/zz-bazzite-autologin.conf` `User=raphant` and `zz-holo-autologin.conf` `Session=gamescope-session-ogui-steam.desktop`. Both: `systemctl --user cat duodesk-app` is under `/run/user/1000/systemd/transient/`, and there is no `~/.config/autostart/twindesk.desktop`. Go `kreadconfig6 --file kscreenlockerrc --group Daemon --key Autolock` = `false`; on `bazzite` it is unset. Guessed: KDE's default is to lock after 5 minutes.
- **Seen: screen off.** Go `/sys/class/drm/card1-eDP-1/dpms` = `Off` during the first full run: 2.3 fps and an all-black frame. After `kscreen-doctor --dpms on`: `On`, 57.9 fps.
- **Guessed: `bazzite` behaves like the Go.** Same package versions (`rpm -q`), GStreamer 1.28.8 with `pipewiresrc`, `pipewiresink`, `videoconvert`, `videorate` under `/usr/bin/python3`. No permission or session test was run there.
- **Settings left on the Go:** `kde-authorized remote-desktop duodesk yes` and `devices camera "" yes` (set 2026-11-02, for these tests and for Pick A). Remove with the two `permission-remove` commands above.
