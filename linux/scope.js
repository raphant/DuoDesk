// TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// DuoDesk's own systemd scope, app-duodesk-<pid>.scope, so the desktop portal names this app
// "duodesk" (from duodesk.desktop) rather than "org.chromium.Chromium" (Chromium moves its main
// process into app-org.chromium.Chromium-<pid>.scope at start; its other processes stay where the
// app was started). The permission rows for sharing the screen with nobody there name "duodesk"
// (screenportal.py, linux/scripts/unattended-setup.sh). own() runs once at start (main.js) and moves
// the main process and everything under it; processes started later are born inside. `ready`
// resolves to the scope's name, or '' when it could not be made (no systemd user manager, no
// busctl): then the portal sees what it saw before.
'use strict';
const fs = require('fs');
const { execFile } = require('child_process');

const CHROMIUM = /\/app-org\.chromium\.Chromium[^/]*-\d+\.scope$/;
const OURS = /\/app-duodesk-[A-Za-z0-9]*\.scope$/;
let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

const cgroup = (pid) => {
  try { return fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().replace(/^0::/, ''); } catch (_) { return ''; }
};

// pid and every process under it (parents from /proc/<pid>/stat).
function tree(root) {
  const kids = new Map();
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let stat = '';
    try { stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8'); } catch (_) { continue; }
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(Number(name));
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || []));
  return out;
}

function busctl(args) {
  return new Promise((resolve, reject) => {
    execFile('busctl', ['--user', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', ...args],
      { timeout: 5000 }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
  });
}

async function own() {
  if (process.platform !== 'linux') return resolveReady('');
  try {
    // Wait for Chromium's own move (up to 10 s), else it would take the main process back after ours.
    for (let i = 0; i < 100 && !CHROMIUM.test(cgroup(process.pid)) && !OURS.test(cgroup(process.pid)); i++) await new Promise((r) => setTimeout(r, 100));
    if (OURS.test(cgroup(process.pid))) return resolveReady(cgroup(process.pid).split('/').pop());
    const unit = `app-duodesk-${process.pid}.scope`;
    let pids = tree(process.pid);
    const make = () => busctl(['StartTransientUnit', 'ssa(sv)a(sa(sv))', unit, 'fail', '1', 'PIDs', 'au', String(pids.length), ...pids.map(String), '0']);
    await make().catch(() => { pids = tree(process.pid); return make(); }); // once more if one of them just ended
    // A process started while we listed them: into the scope too.
    const left = tree(process.pid).filter((p) => !cgroup(p).endsWith('/' + unit) && cgroup(p));
    if (left.length) await busctl(['AttachProcessesToUnit', 'ssau', unit, '', String(left.length), ...left.map(String)]).catch(() => {});
    console.log(`scope: ${pids.length} processes in ${unit}`);
    resolveReady(unit);
  } catch (e) {
    console.warn('scope: stayed in ' + cgroup(process.pid) + ': ' + e.message);
    resolveReady('');
  }
}

module.exports = { own, ready };
