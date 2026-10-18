#!/usr/bin/env bash
# Installs the RideArrivo data allocation virtual server into an existing FreeRADIUS 3.x.
# Safe to run again. Run as root on the RADIUS server:
#
#   apt install freeradius freeradius-rest freeradius-utils jq curl
#   sudo bash install.sh
#
# What it does: copies the REST module and the ra-data site, adds one $INCLUDE line to
# radiusd.conf (after a backup), enables them, disables the stock sites, and validates the
# result with `freeradius -CX`. It never overwrites ra-data.secret.conf or clients.conf.
set -euo pipefail

FR_DIR="${FR_DIR:-/etc/freeradius/3.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash install.sh)"; exit 1; }
[ -d "$FR_DIR" ] || { echo "FreeRADIUS config not found at $FR_DIR (set FR_DIR=...)"; exit 1; }
[ -f /usr/lib/freeradius/rlm_rest.so ] || [ -f /usr/lib/x86_64-linux-gnu/freeradius/rlm_rest.so ] \
  || [ -f /usr/lib/aarch64-linux-gnu/freeradius/rlm_rest.so ] \
  || { echo "rlm_rest is missing: apt install freeradius-rest"; exit 1; }

install -m 640 "$HERE/mods-available/ra_data_rest" "$FR_DIR/mods-available/ra_data_rest"
install -m 640 "$HERE/sites-available/ra-data" "$FR_DIR/sites-available/ra-data"

if [ ! -f "$FR_DIR/ra-data.secret.conf" ]; then
  install -m 640 "$HERE/ra-data.secret.conf.example" "$FR_DIR/ra-data.secret.conf"
  echo "Created $FR_DIR/ra-data.secret.conf. Edit it before starting the service."
fi
chown root:freerad "$FR_DIR/ra-data.secret.conf" 2>/dev/null || true

if ! grep -q 'ra-data.secret.conf' "$FR_DIR/radiusd.conf"; then
  cp -a "$FR_DIR/radiusd.conf" "$FR_DIR/radiusd.conf.pre-ra-data"
  # The include must come before anything that uses the variables, so put it right after "prefix".
  sed -i '0,/^prefix = /s//$INCLUDE ra-data.secret.conf\nprefix = /' "$FR_DIR/radiusd.conf"
fi

ln -sf ../mods-available/ra_data_rest "$FR_DIR/mods-enabled/ra_data_rest"
ln -sf ../sites-available/ra-data "$FR_DIR/sites-enabled/ra-data"
# The stock sites would also answer on 1812/1813 and accept test users.
rm -f "$FR_DIR/sites-enabled/default" "$FR_DIR/sites-enabled/inner-tunnel"
# The stock eap module insists on an "Auth-Type EAP" section from the default site, so it must go too.
rm -f "$FR_DIR/mods-enabled/eap"

freeradius -CX -d "$FR_DIR" >/tmp/ra-data-check.log 2>&1 \
  && echo "Configuration check passed." \
  || { echo "Configuration check FAILED, see /tmp/ra-data-check.log"; tail -20 /tmp/ra-data-check.log; exit 1; }

cat <<'N'

Next:
  1. Edit /etc/freeradius/3.0/ra-data.secret.conf (URL, vendor, secret).
  2. Add your gateway to /etc/freeradius/3.0/clients.conf (see clients.conf.example).
  3. systemctl enable --now freeradius      (or: freeradius -X to watch it live)
  4. Install the enforcer: see docs/data-allocation.md, section "Cutting people off".
N
