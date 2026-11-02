// TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Share screen on Wayland with no dialog (docs-okf/wayland-screen-prompt.md): runs screenportal.py,
// which opens a RemoteDesktop portal session and republishes each monitor as a PipeWire camera,
// "DuoDesk Screen <connector>". pcscreen.js asks start(fps) for the cameras, and the sender opens
// one by its label (sender-renderer.js, cameraLabel). Any failure (no Python GObject or GStreamer,
// not set up, a dialog would show) resolves null, with the reason in `error`: the caller then uses
// desktopCapturer (the portal's dialog). Needs both permission rows of
// linux/scripts/unattended-setup.sh, and the app in its own scope (scope.js).
// Event: 'exit' when a running helper ends (the portal closed the session, a picture stopped).
// After two of those in a minute, start() gives up (null) until the minute has passed.
'use strict';
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const scope = require('./scope');

const PYTHON = '/usr/bin/python3';
const SCRIPT = path.join(__dirname, 'screenportal.py');
const START_MS = 8000; // the helper gives up on Start after 5 s itself

// Whether permission table devices, key camera, says yes for "duodesk" (synchronous, for main.js:
// Chromium's PipeWire camera is switched on only then, since without the row the first
// enumerateDevices() would show the portal's camera dialog).
function cameraAllowed() {
  try {
    const out = execFileSync('busctl', ['--user', 'call', 'org.freedesktop.impl.portal.PermissionStore', '/org/freedesktop/impl/portal/PermissionStore',
      'org.freedesktop.impl.portal.PermissionStore', 'Lookup', 'ss', 'devices', 'camera'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    return /"duodesk" 1 "yes"/.test(out);
  } catch (_) {
    return false;
  }
}

class ScreenPortal extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.streams = null; // [{label, node, mapping_id, position: [x, y], size: [w, h]}] while running
    this.error = '';
    this.starting = null;
    this.ends = []; // when running helpers ended (Date.now()), for start()'s give-up rule
  }

  // The cameras, starting the helper when it isn't running; null on failure (see `error`).
  start(fps) {
    if (this.streams) return Promise.resolve(this.streams);
    if (!this.starting) this.starting = this._start(fps).finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start(fps) {
    if (!(await scope.ready)) { this.error = 'DuoDesk has no scope of its own'; return null; }
    // A helper that keeps ending would open a portal session (and a KDE notice) every few seconds.
    this.ends = this.ends.filter((t) => Date.now() - t < 60000);
    if (this.ends.length >= 2) { this.error = 'the helper ended twice in the last minute'; return null; }
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(PYTHON, ['-I', SCRIPT, '--fps', String(fps || 60)], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        this.error = e.message;
        return resolve(null);
      }
      this.proc = proc;
      let buf = '';
      let err = '';
      let done = false;
      const finish = (streams, error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (streams && this.proc !== proc) { streams = null; error = 'stopped while starting'; } // stop() came first
        this.error = error || '';
        this.streams = streams;
        if (!streams) this._kill(proc);
        resolve(streams);
      };
      const timer = setTimeout(() => finish(null, 'no answer from the helper'), START_MS);
      proc.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          let m = null;
          try { m = JSON.parse(line); } catch (_) { continue; }
          if (m.event === 'started' && Array.isArray(m.streams) && m.streams.length) finish(m.streams);
          else if (m.event === 'error') {
            console.warn(`screenportal: ${m.step}: ${m.message}`);
            if (!done) finish(null, `${m.step}: ${m.message}`);
          }
        }
      });
      proc.stderr.on('data', (d) => { err = (err + d).slice(-500); });
      proc.on('error', (e) => finish(null, e.message));
      proc.on('exit', (code) => {
        finish(null, 'the helper ended (' + code + ')' + (err ? ': ' + err.trim().split('\n').pop() : ''));
        if (this.proc !== proc) return;
        this.proc = null;
        const was = !!this.streams;
        this.streams = null;
        if (was) { this.ends.push(Date.now()); this.emit('exit'); }
      });
    });
  }

  // Ends the session (the helper closes it when its stdin closes).
  stop() {
    const proc = this.proc;
    this.proc = null;
    this.streams = null;
    if (proc) this._kill(proc);
  }

  _kill(proc) {
    try { proc.stdin.end(); } catch (_) { /* gone */ }
    setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill(); }, 2000).unref();
  }
}

module.exports = { ScreenPortal, cameraAllowed };
