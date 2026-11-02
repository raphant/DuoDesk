#!/bin/sh
# Share this computer's screen with nobody here (KDE Plasma on Wayland; docs-okf/wayland-screen-prompt.md).
# Sets, for the current user, the two desktop-portal permission rows that let DuoDesk (app id
# "duodesk", from its own scope, linux/scope.js) start sharing with no dialog:
#   kde-authorized remote-desktop duodesk yes   KDE starts a RemoteDesktop session with no dialog
#   devices        camera         duodesk yes   the portal gives DuoDesk the PipeWire cameras with no dialog
# Restart DuoDesk afterwards (it reads the camera row when it starts). No sudo.
# Usage: unattended-setup.sh          set them, then print both tables
#        unattended-setup.sh --undo   remove them, then print both tables
set -e
APP=duodesk
command -v flatpak >/dev/null 2>&1 || { echo "needs the flatpak command (its permission-set and permission-remove)" >&2; exit 1; }
if [ "$1" = "--undo" ]; then
  flatpak permission-remove kde-authorized remote-desktop "$APP" 2>/dev/null || true
  flatpak permission-remove devices camera "$APP" 2>/dev/null || true
  echo "Removed the \"$APP\" rows."
elif [ -z "$1" ]; then
  flatpak permission-set kde-authorized remote-desktop "$APP" yes
  flatpak permission-set devices camera "$APP" yes
  echo "Set: kde-authorized remote-desktop $APP yes; devices camera $APP yes."
  # The portal knows the app id only from a desktop file of that name.
  found=
  for d in "${XDG_DATA_HOME:-$HOME/.local/share}" $(echo "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" | tr ':' ' '); do
    [ -f "$d/applications/$APP.desktop" ] && found="$d/applications/$APP.desktop"
  done
  [ -n "$found" ] && echo "App id \"$APP\" comes from $found." || echo "Warning: no $APP.desktop in the applications folders: the portal will not know the name \"$APP\", and the dialog stays." >&2
else
  echo "usage: $0 [--undo]" >&2
  exit 2
fi
echo "Now:"
flatpak permissions kde-authorized 2>/dev/null | grep -w "$APP" || echo "  kde-authorized: no $APP row"
flatpak permissions devices 2>/dev/null | grep -w "$APP" || echo "  devices: no $APP row"
