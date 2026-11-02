// TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// shared/updates.js pickAsset: each computer finds its own download among a release's files,
// with the Mac's disk images named DuoDesk-<version>-<arch>.dmg (mac/build-dmg.sh). Upstream
// TwinDesk's files (TwinDesk-*) are never picked, and a release with none of DuoDesk's isn't an update.
'use strict';

const assert = require('assert');
const { Updates, pickAsset, formatReleaseNotes, REPO } = require('../updates.js');

// Updates come from the tailnet fork's repository, not upstream DuoDesk's or TwinDesk's.
assert.strictEqual(REPO, 'raphant/DuoDesk');

const files = (...names) => names.map((name) => ({ name, browser_download_url: 'https://example.invalid/' + name, size: 1 }));
const pick = (assets, platform, arch, prefer) => (pickAsset(assets, platform, arch, prefer) || {}).name || null;
const OTHERS = ['DuoDesk-2.3.0-amd64.deb', 'DuoDesk-2.3.0-x86_64.AppImage', 'DuoDesk-2.3.0.apk', 'DuoDesk-2.3.0-full.apk',
  'DuoDesk-Setup-2.3.0.exe', 'DuoDesk-Setup-2.3.0-arm64.exe'];

// Versioned, both Macs: each its own.
const both = files(...OTHERS, 'DuoDesk-2.3.0-arm64.dmg', 'DuoDesk-2.3.0-x64.dmg');
assert.strictEqual(pick(both, 'mac', 'arm64'), 'DuoDesk-2.3.0-arm64.dmg');
assert.strictEqual(pick(both, 'mac', 'x64'), 'DuoDesk-2.3.0-x64.dmg');
// The order on the release doesn't matter.
assert.strictEqual(pick(both.slice().reverse(), 'mac', 'arm64'), 'DuoDesk-2.3.0-arm64.dmg');
assert.strictEqual(pick(both.slice().reverse(), 'mac', 'x64'), 'DuoDesk-2.3.0-x64.dmg');
// Only Apple Silicon's on the release yet: an Intel Mac isn't given it (the release page opens instead).
const armOnly = files(...OTHERS, 'DuoDesk-2.3.0-arm64.dmg');
assert.strictEqual(pick(armOnly, 'mac', 'arm64'), 'DuoDesk-2.3.0-arm64.dmg');
assert.strictEqual(pick(armOnly, 'mac', 'x64'), null);
// Upstream TwinDesk's builds are never offered, on any platform.
const upstream = files('TwinDesk-2.6.0-amd64.deb', 'TwinDesk-2.6.0-x86_64.AppImage', 'TwinDesk-Setup-2.6.0.exe',
  'TwinDesk-Setup-2.6.0-arm64.exe', 'TwinDesk-2.6.0-arm64.dmg', 'TwinDesk-2.6.0-x64.dmg', 'TwinDesk.dmg', 'Twindesk_intel.dmg');
for (const [platform, arch] of [['mac', 'arm64'], ['mac', 'x64'], ['win', 'x64'], ['win', 'arm64'], ['linux', 'x64']]) {
  assert.strictEqual(pick(upstream, platform, arch), null);
  assert.strictEqual(pick(upstream.concat(both), platform, arch).startsWith('DuoDesk-'), true);
}
// The other platforms are unaffected by the Mac's names.
assert.strictEqual(pick(both, 'win', 'x64'), 'DuoDesk-Setup-2.3.0.exe');
assert.strictEqual(pick(both, 'win', 'arm64'), 'DuoDesk-Setup-2.3.0-arm64.exe');
assert.strictEqual(pick(both, 'linux', 'x64'), 'DuoDesk-2.3.0-x86_64.AppImage');
assert.strictEqual(pick(both, 'linux', 'x64', 'deb'), 'DuoDesk-2.3.0-amd64.deb');

// Release notes formatting (Quotio-style markdown parser)
const notes = `## What's Changed
* Fix KVM socket backpressure coalescing by @0xCodez in #54
* Add Homebrew Cask and headless installer by @user in #60
* Performance **improvements** and \`zero-gc\` latency

Check details at https://github.com/0xCodez/DuoDesk`;

const formatted = formatReleaseNotes(notes);
assert(formatted.includes('<h4 class="updater-heading">What&#39;s Changed</h4>') || formatted.includes('What&#39;s Changed') || formatted.includes('What\'s Changed'));
assert(formatted.includes('<ul class="updater-list">'));
assert(formatted.includes('<span class="updater-mention">@0xCodez</span>'));
assert(formatted.includes('<span class="updater-issue">#54</span>'));
assert(formatted.includes('<strong>improvements</strong>'));
assert(formatted.includes('<code class="mono">zero-gc</code>'));
assert(formatted.includes('https://github.com/0xCodez/DuoDesk') && !formatted.includes('<a '));

// HTML escaping verification
const dirty = '## <script>alert(1)</script>\n* <img src=x onerror=alert(2)>';
const safe = formatReleaseNotes(dirty);
assert(!safe.includes('<script>'));
assert(!safe.includes('<img'));
assert(safe.includes('&lt;script&gt;'));
assert(safe.includes('&lt;img'));

// Empty notes fallback
assert(formatReleaseNotes('').includes('No release notes provided'));

// Updates class skip & unskip logic
let savedSettings = { updates: { auto: true, notified: '', skipped: '' } };
let notificationCalled = 0;
let modalCalled = 0;
let changed = 0;

const u = new Updates({
  current: '2.3.0',
  platform: 'win',
  arch: 'x64',
  getSettings: () => savedSettings,
  save: () => {},
  notify: (title, body, onClick) => {
    notificationCalled++;
    if (onClick) onClick();
  },
  onChange: () => { changed++; },
  onShowModal: () => { modalCalled++; },
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tag_name: 'v2.4.0',
      name: 'DuoDesk 2.4.0',
      body: notes,
      published_at: '2026-10-27T10:00:00Z',
      html_url: 'https://github.com/0xCodez/DuoDesk/releases/tag/v2.4.0',
      assets: [{ name: 'DuoDesk-Setup-2.4.0.exe', browser_download_url: 'https://example.invalid/DuoDesk-Setup-2.4.0.exe', size: 1024 }],
    }),
  }),
});

(async () => {
  await u.check(true);
  assert.strictEqual(u.status.available, true);
  assert.strictEqual(u.status.latest, '2.4.0');
  assert.strictEqual(u.status.skipped, false);
  assert.strictEqual(u.status.promptUpdate, true);
  assert.strictEqual(notificationCalled, 1);
  assert.strictEqual(modalCalled, 1);
  assert.strictEqual(u.view.skippedVersion, '');
  assert.strictEqual(u.status.releaseNotes, notes);

  // Skip version 2.4.0
  u.skip('2.4.0');
  assert.strictEqual(savedSettings.updates.skipped, '2.4.0');
  assert.strictEqual(u.status.skipped, true);
  assert.strictEqual(u.view.skippedVersion, '2.4.0');

  // Next check with skipped version will not prompt or notify
  notificationCalled = 0;
  modalCalled = 0;
  await u.check(false);
  assert.strictEqual(notificationCalled, 0);
  assert.strictEqual(modalCalled, 0);
  assert.strictEqual(u.status.skipped, true);
  assert.strictEqual(u.status.promptUpdate, false);

  // Unskip
  u.unskip();
  assert.strictEqual(savedSettings.updates.skipped, '');
  assert.strictEqual(u.status.skipped, false);

  // A newer upstream TwinDesk release (no DuoDesk file on it): not an update, nothing announced.
  let upstreamNotified = 0;
  const up = new Updates({
    current: '2.3.0', platform: 'win', arch: 'x64',
    getSettings: () => ({ updates: { auto: true, notified: '', skipped: '' } }),
    notify: () => { upstreamNotified++; }, onShowModal: () => { upstreamNotified++; },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v2.6.0', name: 'TwinDesk 2.6.0',
      assets: [{ name: 'TwinDesk-Setup-2.6.0.exe', browser_download_url: 'https://example.invalid/TwinDesk-Setup-2.6.0.exe', size: 1 }] }) }),
  });
  await up.check(true);
  assert.strictEqual(up.status.available, false);
  assert.strictEqual(up.status.download, null);
  assert.strictEqual(up.status.promptUpdate, false);
  assert.strictEqual(upstreamNotified, 0);
  assert.strictEqual(up.url, up.status.releaseUrl);

  console.log('updates: ok');
})();
