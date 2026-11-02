// Tailnet fork (docs-okf/tailnet-fork.md). GPL-3.0, see LICENSE.
// Tests for shared/tailnet.js (which peers get beacons) and the address rule in linux/discovery.js
// and mac/discovery.js _onMessage (a LAN address wins while it is fresh).
// Run with: node shared/test/tailnet.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tailnet = require('../tailnet.js');
const P = require('../protocol.js');

// The shape of `tailscale status --json` (1.104.2 on bazzite), trimmed to the fields that matter.
const ME = 6267634383389516;
const status = {
  Self: { HostName: 'bazzite', UserID: ME, OS: 'linux', TailscaleIPs: ['100.87.100.106', 'fd7a:115c:a1e0::e13a:646b'] },
  Peer: {
    a: { HostName: 'raphant-endeavouros', UserID: ME, Online: true, OS: 'linux', TailscaleIPs: ['100.87.254.4', 'fd7a::1'] },
    b: { HostName: 'Raphael’s MacBook Pro', UserID: ME, Online: true, OS: 'macOS', TailscaleIPs: ['100.73.82.100', 'fd7a::2'] },
    c: { HostName: 'bazzite-go', UserID: ME, Online: true, OS: 'linux', TailscaleIPs: ['100.123.170.66', 'fd7a::3'] },
    d: { HostName: 'DESK-111111', UserID: ME, Online: false, OS: 'windows', TailscaleIPs: ['100.68.230.105'] },
    e: { HostName: 'nps-gate-7', UserID: ME, Online: false, OS: 'linux', TailscaleIPs: ['100.122.71.107'] },
    f: { HostName: 'Pixel 10 Pro XL', UserID: ME, Online: true, OS: 'android', TailscaleIPs: ['100.105.218.88'] },
    g: { HostName: 'localhost', UserID: ME, Online: true, OS: 'iOS', TailscaleIPs: ['100.78.204.35'] },
    h: { HostName: 'localhost', UserID: 7302208256317230, Online: true, OS: 'iOS', TailscaleIPs: ['100.126.213.9'] }, // shared in by another user
    i: { HostName: 'v6only', UserID: ME, Online: true, OS: 'linux', TailscaleIPs: ['fd7a::9'] },
  },
};
const MINE = ['100.87.254.4', '100.73.82.100', '100.123.170.66'];

// peers(): this user's online computers, IPv4 only.
assert.deepStrictEqual(tailnet.peers(status), MINE);
assert.deepStrictEqual(tailnet.peers({ ...status, Self: undefined }), []); // logged out: no Self
assert.deepStrictEqual(tailnet.peers(null), []);
assert.deepStrictEqual(tailnet.peers({ Self: { UserID: ME } }), []); // no peers

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duodesk-tailnet-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok) => {
  for (let i = 0; i < 100 && !ok(); i++) await wait(20);
};

(async () => {
  // No Tailscale anywhere: an empty list, nothing thrown.
  tailnet.BINS.splice(0, tailnet.BINS.length, path.join(dir, 'missing-1'), path.join(dir, 'missing-2'));
  assert.deepStrictEqual(tailnet.addresses(), []);
  await wait(200);
  assert.deepStrictEqual(tailnet.addresses(), []);

  // The first path missing, the next one a fake CLI: the module asks it and keeps its answer.
  const fake = path.join(dir, 'tailscale');
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  fs.writeFileSync(fake, '#!/bin/sh\ncat "$(dirname "$0")/status.json"\n', { mode: 0o755 });
  tailnet.BINS.splice(0, tailnet.BINS.length, path.join(dir, 'missing'), fake);
  // Older than REFRESH_MS is the only trigger; move the clock instead of waiting 30 s.
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  tailnet.addresses();
  Date.now = realNow;
  await until(() => tailnet.addresses().length);
  assert.deepStrictEqual(tailnet.addresses(), MINE);
  assert(tailnet.has('100.73.82.100'));
  assert(!tailnet.has('192.168.1.162'));

  // The address rule, on both apps' Discovery (no socket: start() is never called).
  for (const file of ['../../linux/discovery.js', '../../mac/discovery.js']) {
    const { Discovery } = require(file);
    const disc = file.includes('mac') ? new Discovery({ macId: 'self', macName: 'me', fp: '' }) : new Discovery({ id: 'self', name: 'me' });
    const beacon = (address) => disc._onMessage(Buffer.from(JSON.stringify({ t: P.T.BEACON, v: P.PROTOCOL_VERSION, id: 'mac', name: 'Mac', os: P.OS.MAC, port: P.PORT })), { address, port: P.DISCOVERY_PORT });
    let changes = 0;
    disc.on('change', () => changes++);

    // Only on the tailnet (away from home): the tailnet address.
    beacon('100.73.82.100');
    assert.strictEqual(disc.get('mac').address, '100.73.82.100', file);
    // Home: heard on both, round after round; the LAN address wins and stays.
    changes = 0;
    for (let i = 0; i < 5; i++) {
      beacon('192.168.1.162');
      beacon('100.73.82.100');
    }
    assert.strictEqual(disc.get('mac').address, '192.168.1.162', file);
    assert.strictEqual(changes, 1, file + ': one change (tailnet to LAN), no swapping');
    // Left home: no LAN beacon for longer than DEVICE_STALE_MS, so the tailnet address takes over.
    disc.found.get('mac').lanAt -= P.DEVICE_STALE_MS + 1;
    beacon('100.73.82.100');
    assert.strictEqual(disc.get('mac').address, '100.73.82.100', file);
    disc.stop();
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('tailnet: all tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
