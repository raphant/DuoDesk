// Tailnet fork (raphant/DuoDesk, docs-okf/tailnet-fork.md). GPL-3.0, see LICENSE.
// Tailscale peers for discovery: this user's computers on the tailnet that are online. The tailnet
// has no broadcast, so linux/discovery.js and mac/discovery.js send their beacons and probes to each
// of these addresses as well, and keep a device's LAN address while it is fresh (has()).
//
//   addresses() -> ['100.x.y.z', ...]  the last answer at once; asks Tailscale again in the
//                                      background when it is older than REFRESH_MS. No Tailscale: [].
//   has(address) -> true when address is one of them
//   peers(status) -> the filter, on the parsed output of `tailscale status --json` (tests)
'use strict';

const { execFile } = require('child_process');

const REFRESH_MS = 30000;
// An app started from the Dock or a desktop menu gets a short PATH: the Mac CLI is inside the app.
const BINS = ['tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
// Computers only: a beacon every 2 s would keep waking a phone.
const COMPUTERS = new Set(['linux', 'macOS', 'windows']);
const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

let list = [];
let askedAt = 0;
let asking = false;

function peers(status) {
  const me = status && status.Self && status.Self.UserID;
  if (!me) return [];
  return Object.values((status && status.Peer) || {})
    .filter((p) => p && p.Online && p.UserID === me && COMPUTERS.has(p.OS))
    .map((p) => (p.TailscaleIPs || []).find(isIPv4))
    .filter(Boolean);
}

function ask(i = 0) {
  asking = true;
  execFile(BINS[i], ['status', '--json'], { timeout: 5000, maxBuffer: 8 << 20 }, (err, out) => {
    if (err && i + 1 < BINS.length) return ask(i + 1);
    asking = false;
    askedAt = Date.now();
    try {
      list = err ? [] : peers(JSON.parse(out));
    } catch (e) {
      list = [];
    }
  });
}

function addresses() {
  if (!asking && Date.now() - askedAt > REFRESH_MS) ask();
  return list;
}

const has = (address) => list.includes(address);

module.exports = { addresses, has, peers, BINS };
