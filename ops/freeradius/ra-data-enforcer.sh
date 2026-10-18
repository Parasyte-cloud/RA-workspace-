#!/usr/bin/env bash
# Cuts off sessions that are out of data, suspended, belong to a deactivated employee, or
# sit on an empty pool. Run every minute by the systemd timer next to this file.
#
# How: asks the workspace which open sessions must stop (GET /over-quota), then sends each
# one a RADIUS Disconnect-Request (RFC 5176) on the gateway's CoA port. MikroTik, pfSense
# (captive portal), CoovaChilli and most hotspot gateways support it.
#
# Files (all in /etc/freeradius/3.0, readable by the user that runs this script):
#   ra-data.secret.conf   ra_data_base_url and ra_data_secret, shared with FreeRADIUS
#   ra-data-nas.list      one gateway per line:  <nas_ip> <coa_secret> [coa_port]   (default 3799)
#                         The secret is the gateway's RADIUS secret, as in clients.conf.
set -uo pipefail

CONF_DIR="${CONF_DIR:-/etc/freeradius/3.0}"
SECRET_CONF="$CONF_DIR/ra-data.secret.conf"
NAS_LIST="$CONF_DIR/ra-data-nas.list"

for need in curl jq radclient; do
  command -v "$need" >/dev/null || { echo "ra-data-enforcer: $need is not installed" >&2; exit 2; }
done
[ -r "$SECRET_CONF" ] || { echo "ra-data-enforcer: cannot read $SECRET_CONF" >&2; exit 2; }
[ -r "$NAS_LIST" ] || { echo "ra-data-enforcer: cannot read $NAS_LIST" >&2; exit 2; }

conf_value() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\(.*\)\"[[:space:]]*$/\1/p" "$SECRET_CONF" | head -n1; }
BASE_URL="$(conf_value ra_data_base_url)"
SECRET="$(conf_value ra_data_secret)"
[ -n "$BASE_URL" ] && [ -n "$SECRET" ] || { echo "ra-data-enforcer: URL or secret missing in $SECRET_CONF" >&2; exit 2; }

# The secret goes in a header file, not on the command line, so it never shows in `ps`.
HEADERS="$(mktemp)"; trap 'rm -f "$HEADERS"' EXIT
chmod 600 "$HEADERS"
printf 'X-Radius-Secret: %s\n' "$SECRET" > "$HEADERS"

RESPONSE="$(curl -fsS --max-time 15 -H @"$HEADERS" "$BASE_URL/over-quota")" || {
  echo "ra-data-enforcer: workspace not reachable, leaving sessions as they are" >&2; exit 1; }

COUNT="$(jq -r '.sessions | length' <<<"$RESPONSE")"
[ "$COUNT" -gt 0 ] || exit 0

jq -c '.sessions[]' <<<"$RESPONSE" | while read -r row; do
  nas_ip="$(jq -r .nas_ip <<<"$row")"
  sid="$(jq -r .session_id <<<"$row")"
  user="$(jq -r .username <<<"$row")"
  fip="$(jq -r .framed_ip <<<"$row")"
  reason="$(jq -r .reason <<<"$row")"

  line="$(awk -v ip="$nas_ip" '$1 == ip { print; exit }' "$NAS_LIST")"
  if [ -z "$line" ]; then
    echo "ra-data-enforcer: no entry for gateway $nas_ip in $NAS_LIST (session $sid of $user not cut)" >&2
    continue
  fi
  coa_secret="$(awk '{print $2}' <<<"$line")"
  coa_port="$(awk '{print ($3 == "" ? 3799 : $3)}' <<<"$line")"

  attrs="Acct-Session-Id = \"$sid\"\nUser-Name = \"$user\""
  [ -n "$fip" ] && attrs="$attrs\nFramed-IP-Address = $fip"

  out="$(printf "$attrs\n" | radclient -t 3 -r 2 "$nas_ip:$coa_port" disconnect "$coa_secret" 2>&1)"
  if grep -q "Disconnect-ACK" <<<"$out"; then
    echo "ra-data-enforcer: disconnected $user on $nas_ip ($reason)"
  elif grep -q "Disconnect-NAK" <<<"$out"; then
    # the gateway no longer has that session; its Accounting Stop will close it on our side
    echo "ra-data-enforcer: $nas_ip says session $sid is already gone ($user, $reason)"
  else
    echo "ra-data-enforcer: no answer from $nas_ip:$coa_port for $user ($reason). Is CoA/'incoming' enabled on the gateway?" >&2
  fi
done
