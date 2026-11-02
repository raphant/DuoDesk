# TwinDesk — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
# Share screen on Wayland with nobody at the computer (docs-okf/wayland-screen-prompt.md). Started by
# screenportal.js as `/usr/bin/python3 -I screenportal.py --fps N`, from inside DuoDesk's own
# systemd scope (scope.js), so the desktop portal sees app id "duodesk". It opens a RemoteDesktop
# portal session with every monitor (KDE skips its dialog for an app id that has `yes` in
# permission table kde-authorized, key remote-desktop) and republishes each monitor as a PipeWire
# camera, "DuoDesk Screen <connector>", that the sender opens with getUserMedia (Chromium's
# WebRtcPipeWireCamera, permission table devices, key camera).
# stdout: one JSON line per event: {"event": "started", "streams": [{label, node, mapping_id,
# position, size}]} once, or {"event": "error", "step", "message"} and exit. Runs until stdin closes,
# the portal closes the session, or a picture stops. Changing the format: Electron 38 crashes on
# NV12 and gets nothing from I420; BGRA and YUY2 work.
import json
import os
import random
import re
import string
import sys

APP_ID = 'duodesk'
START_TIMEOUT_S = 5  # Start waits on a dialog when KDE does not skip it: give up instead
args = sys.argv[1:]
FPS = max(1, min(240, int(args[args.index('--fps') + 1]))) if '--fps' in args else 60


def out(**kw):
    print(json.dumps(kw), flush=True)


def die(step, message):
    out(event='error', step=step, message=str(message))
    sys.exit(1)


try:
    import gi
    gi.require_version('Gst', '1.0')
    from gi.repository import Gio, GLib, Gst
    Gst.init(None)
    for name in ('pipewiresrc', 'pipewiresink', 'videoconvert', 'videorate'):
        if not Gst.ElementFactory.find(name):
            die('gstreamer', 'missing GStreamer element ' + name)
except (ImportError, ValueError) as e:
    die('python', e)

# The portal names a host app after its systemd unit: app-duodesk-<x>.scope -> "duodesk".
try:
    unit = open('/proc/self/cgroup').read().strip().rsplit('/', 1)[-1]
except OSError as e:
    die('scope', e)
if not re.fullmatch(r'app-duodesk-[A-Za-z0-9]*\.scope', unit):
    die('scope', 'not in an app-duodesk scope: ' + unit)

bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def allowed(table, key):
    try:
        perms, _data = bus.call_sync('org.freedesktop.impl.portal.PermissionStore', '/org/freedesktop/impl/portal/PermissionStore',
                                     'org.freedesktop.impl.portal.PermissionStore', 'Lookup', GLib.Variant('(ss)', (table, key)),
                                     None, 0, 2000, None).unpack()
    except GLib.Error:
        return False
    return perms.get(APP_ID) == ['yes']


# Without both rows a dialog would show: fail at once, the caller uses the old path.
for table, key in (('kde-authorized', 'remote-desktop'), ('devices', 'camera')):
    if not allowed(table, key):
        die('permission', f'no "{APP_ID}" yes in {table} {key} (linux/scripts/unattended-setup.sh)')

PORTAL = ('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')
SIG = {'CreateSession': '(a{sv})', 'SelectDevices': '(oa{sv})', 'SelectSources': '(oa{sv})', 'Start': '(osa{sv})'}
sender = bus.get_unique_name()[1:].replace('.', '_')
loop = GLib.MainLoop()
session = None
pipes = []
result = {'code': 0}


def token():
    return 'dd' + ''.join(random.choice(string.ascii_lowercase) for _ in range(8))


def call(iface, method, params, then):
    # Portal calls answer through a Request object's Response signal.
    t = token()
    path = f'/org/freedesktop/portal/desktop/request/{sender}/{t}'

    def on_response(_c, _s, _p, _i, _n, p):
        bus.signal_unsubscribe(sub)
        code, res = p.unpack()
        if code:
            return fail(method, f'portal answered {code}')
        then(res)
    sub = bus.signal_subscribe(PORTAL[0], 'org.freedesktop.portal.Request', 'Response', path, None, 0, on_response)
    params[-1]['handle_token'] = GLib.Variant('s', t)
    try:
        bus.call_sync(PORTAL[0], PORTAL[1], 'org.freedesktop.portal.' + iface, method, GLib.Variant(SIG[method], tuple(params)), None, 0, -1, None)
    except GLib.Error as e:
        fail(method, e.message)


def fail(step, message):
    if result['code'] == 0:
        out(event='error', step=step, message=message)
    result['code'] = 1
    loop.quit()


def created(res):
    global session
    session = res['session_handle']
    bus.signal_subscribe(PORTAL[0], 'org.freedesktop.portal.Session', 'Closed', session, None, 0,
                         lambda *_: fail('session', 'the portal closed the session'))
    # KDE refuses a session with no device: the pointer, which DuoDesk does not use (it has uinput).
    call('RemoteDesktop', 'SelectDevices', [session, {'types': GLib.Variant('u', 2)}], devices)


def devices(_res):
    # types 1: monitors; multiple: one stream per monitor; cursor_mode 2: the cursor drawn into the picture
    call('ScreenCast', 'SelectSources', [session, {'types': GLib.Variant('u', 1), 'multiple': GLib.Variant('b', True),
                                                   'cursor_mode': GLib.Variant('u', 2)}], sources)


def sources(_res):
    timer = GLib.timeout_add_seconds(START_TIMEOUT_S, lambda: fail('Start', 'no answer (a dialog?)') or False)

    def then(res):
        GLib.source_remove(timer)
        started(res)
    call('RemoteDesktop', 'Start', [session, '', {}], then)


def started(res):
    streams = res.get('streams', [])
    if not streams:
        return fail('Start', 'no streams')
    try:
        r = bus.call_with_unix_fd_list_sync(PORTAL[0], PORTAL[1], 'org.freedesktop.portal.ScreenCast', 'OpenPipeWireRemote',
                                            GLib.Variant('(oa{sv})', (session, {})), GLib.VariantType('(h)'), 0, -1, None, None)
    except GLib.Error as e:
        return fail('OpenPipeWireRemote', e.message)
    fd = r[1].get(r[0].unpack()[0])
    told = []
    for i, (node, meta) in enumerate(streams):
        label = 'DuoDesk Screen ' + str(meta.get('mapping_id') or i + 1)
        p = Gst.parse_launch(f'pipewiresrc name=src do-timestamp=true keepalive-time=1000 ! videoconvert ! videorate ! '
                             f'video/x-raw,format=BGRA,framerate={FPS}/1 ! pipewiresink name=sink mode=provide sync=false')
        p.get_by_name('src').set_property('fd', os.dup(fd))
        p.get_by_name('src').set_property('path', str(node))
        props = Gst.Structure.new_empty('props')
        # media.type: WirePlumber links only nodes of the same type; media.role Camera: what Chromium lists.
        for k, v in (('media.type', 'Video'), ('media.category', 'Capture'), ('media.class', 'Video/Source'),
                     ('media.role', 'Camera'), ('node.description', label)):
            props.set_value(k, v)
        p.get_by_name('sink').set_property('stream-properties', props)
        pbus = p.get_bus()
        pbus.add_signal_watch()
        pbus.connect('message::error', lambda _b, m, label=label: fail('picture', f'{label}: {m.parse_error()[0].message}'))
        pbus.connect('message::eos', lambda *_, label=label: fail('picture', label + ' ended'))
        if p.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            return fail('picture', label + ' did not start')
        pipes.append(p)
        told.append({'label': label, 'node': node, 'mapping_id': meta.get('mapping_id'),
                     'position': list(meta.get('position', (0, 0))), 'size': list(meta.get('size', (0, 0)))})
    os.close(fd)
    out(event='started', streams=told)


def on_stdin(_fd, cond):
    if cond & (GLib.IO_HUP | GLib.IO_ERR) or not os.read(sys.stdin.fileno(), 4096):
        loop.quit()
        return False
    return True


GLib.io_add_watch(sys.stdin.fileno(), GLib.PRIORITY_DEFAULT, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, on_stdin)
call('RemoteDesktop', 'CreateSession', [{'session_handle_token': GLib.Variant('s', token())}], created)
if result['code'] == 0:  # a quit() before run() would be lost
    loop.run()
for p in pipes:
    p.set_state(Gst.State.NULL)
if session:
    try:
        bus.call_sync(PORTAL[0], session, 'org.freedesktop.portal.Session', 'Close', None, None, 0, 2000, None)
    except GLib.Error:
        pass
sys.exit(result['code'])
