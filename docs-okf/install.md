# Install DuoDesk on bazzite, bazzite-go and the personal Mac

Status: design

Written 2026-11-02. Nothing installed yet. Machine facts checked over SSH on 2026-11-02 (see Evidence).

## End goal

One desk across three computers, over the tailnet, at home and away:

| Machine | Tailnet IP | OS | DuoDesk file |
| --- | --- | --- | --- |
| `bazzite` (desktop) | 100.87.100.106 | Bazzite 44 KDE Wayland, x86_64 | AppImage |
| `bazzite-go` (handheld, Lenovo 83N0) | 100.123.170.66 | Bazzite 44 KDE Wayland, x86_64 | AppImage |
| personal Mac | 100.73.82.100 | macOS 26.5, arm64 | `.dmg` (arm64) |

Done when: the mouse crosses from `bazzite` to the Mac and the Go, and the clipboard works both ways, while the Go is on a different network (phone hotspot).

## Order

1. **Now: upstream 2.5.0, paired by tailnet IP.** Works at home. Away from home is the known risk (see Risks).
2. **Then: the fork's builds** (how they are made: `tailnet-fork.md`, Build and release).
   - Both Bazzites: download the fork's AppImage from `raphant/DuoDesk` releases into the same path. Pairing is kept in the app's settings, so no new pairing is expected (not tested).
   - Mac: build the dmg on the Mac itself, not from CI, so its self-signed certificate (`~/.twindesk-signing`) stays the same and macOS keeps the permissions across updates. Moving from the upstream dmg to the first fork build asks for the permissions once more.

## Steps

### 1. bazzite and bazzite-go (same steps; the Go over `ssh raphant@bazzite-go`)

Use the AppImage. The `.deb` and Arch packages can't install on Bazzite (image-based).

```sh
mkdir -p ~/.local/lib/duodesk
curl -L -o ~/.local/lib/duodesk/DuoDesk.AppImage \
  https://github.com/0xCodez/DuoDesk/releases/download/v2.5.0/DuoDesk-2.5.0-x86_64.AppImage
chmod +x ~/.local/lib/duodesk/DuoDesk.AppImage
```

Add a menu entry `~/.local/share/applications/duodesk.desktop` with `Exec=/home/raphant/.local/lib/duodesk/DuoDesk.AppImage`. From a T3 shell, launch with `env -u ELECTRON_RUN_AS_NODE`, or Electron exits silently.

On the Go, use Desktop Mode, not Game Mode.

### 2. Input group (the computer whose mouse and keyboard are shared: `bazzite`)

On Wayland, DuoDesk reads `/dev/input/event*` and writes `/dev/uinput`. Its Setup button (`linux/system.js` `fixInput`) runs `usermod -aG input raphant`. On Bazzite the `input` group is only in `/usr/lib/group`, not `/etc/group`, so that likely fails. Do it by hand, then log out and in:

```sh
grep -E '^input:' /usr/lib/group | sudo tee -a /etc/group
sudo usermod -aG input raphant
```

`/dev/uinput` is already writable on both Bazzites, so the Go may not need this unless its own mouse is shared.

### 3. Personal Mac

Download `DuoDesk-2.5.0-arm64.dmg` from the v2.5.0 release, drag to Applications. If macOS says "damaged":

```sh
xattr -dr com.apple.quarantine /Applications/DuoDesk.app
```

Then allow it in System Settings › Privacy & Security when it asks: Accessibility, Screen Recording, Input Monitoring.

### 4. Pair over the tailnet

On `bazzite`: Overview › **Connect by address** → `100.73.82.100`, confirm the code on the Mac. Again with `100.123.170.66` for the Go. Then line the three up on the layout map.

### 5. Test, one thing at a time

1. Mouse across the edge, each way.
2. Clipboard, text then a picture.
3. Send a file.
4. Away test: the Go on a phone hotspot. Does it reconnect by itself?

## Risks

- **Away from home** (seen in code, effect guessed): `linux/link.js` reconnect timer replaces the saved address with the one discovery last saw. At home that is the Wi-Fi IP; away, it keeps trying that Wi-Fi IP. Workaround: type the tailnet IP into Connect by address again. The fork fixes this (`tailnet-fork.md`).
- **Mesh across the tailnet** (guessed): "pair once, join all" may not reach a machine it can't hear by broadcast. Workaround: pair each by hand.
- **Screen and sound away from home** (guessed): these use WebRTC; whether it uses the tailnet interface is checked in `tailnet-fork.md`.
- Bazzite features that call `dnf install` (SSH server page) fail on an image-based system. Samba and v4l2loopback are already on both Bazzites, so the shared folder and virtual camera skip that path.

## Evidence

| Claim | Seen or guessed | How to see it |
| --- | --- | --- |
| Release v2.5.0 has the AppImage and arm64 dmg | seen | `gh release view v2.5.0 -R 0xCodez/DuoDesk` |
| Both Bazzites: KDE Wayland, smbd, v4l2loopback, libfuse.so.2, `/dev/uinput` writable | seen | `ssh raphant@bazzite-go 'command -v smbd; modinfo -F filename v4l2loopback; ls /usr/lib64/libfuse.so.2; test -w /dev/uinput && echo ok'` |
| `input` group only in `/usr/lib/group` | seen on `bazzite` | `grep ^input: /etc/group /usr/lib/group` |
| `usermod` fails without the `/etc/group` line | guessed | run step 2 without the first line |
| Ports 47800/tcp, 47801/udp open on the tailnet | seen | `firewall-cmd --get-zone-of-interface=tailscale0` (no zone → default `FedoraWorkstation`), `firewall-cmd --zone=FedoraWorkstation --list-ports` |
| Mac firewall off | seen | `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate` |
| Connect by address exists | seen | `linux/ipc.js` `connectAddress`, `linux/ui-overview.js` |
