# Data allocation (Administration > Data Allocation)

RideArrivo buys mobile data in bulk (for example 1.5 TB on MTN) and gives every employee a
**daily** allowance of 500 MB, 1 GB, 2 GB, 3 GB or 5 GB. This feature is the ledger, the
rules and the control screen. A FreeRADIUS server in front of the office gateway enforces
the rules at the network edge.

## The one network fact you must plan around

An MTN MiFi is a SIM with a Wi-Fi radio. It counts data against the SIM and has no idea who is
connected, and it cannot speak RADIUS. So nobody can cap "Ada gets 2 GB today" on a MiFi by itself.

To enforce per-person limits, people must connect **through a gateway you control**, and the
MiFi (or any 4G SIM) becomes that gateway's internet uplink:

```
 phones / laptops --Wi-Fi--> office gateway (MikroTik recommended) --WAN--> MiFi / 4G SIM(s) --> MTN
                                  |   RADIUS 1812/1813 + CoA 3799
                                  v
                            FreeRADIUS (ra-data site)
                                  |   HTTPS + shared secret
                                  v
                    Supabase Edge Function "data-radius"  -->  database (the ledger)
                                                                    ^
                              Administration > Data Allocation -----+
```

What the pool means: the 1.5 TB is the data you actually loaded onto the SIM(s) that feed the
gateway. This screen tracks how much of it people have used and stops everyone when it is empty.
It cannot top up an MTN SIM for you.

If people keep using their own MiFi directly, the gateway never sees that traffic. The screen then
works as a ledger only: use the **Usage** button on a person's row to record what the MTN portal
shows. Nothing is enforced for them. Be clear with yourself about which mode each person is in.

## Rules the system applies

- The day is the **Africa/Lagos** calendar day. Allowances reset at 00:00 with no cron job.
- Unused data does not roll over, and unused allowance is never taken from the pool. Only real usage is.
- 1 GB is 1024 MB, the same as MTN counts.
- Daily plans: `500 MB, 1 GB, 2 GB, 3 GB, 5 GB`. Extra data for one day is an **adjustment** with a reason, kept in the audit trail.
- Out of data, plan suspended, no plan, employee deactivated, or pool empty: new logins are refused with a clear message, and open sessions are disconnected within about a minute.
- Network passwords are bcrypt hashed and shown once. Five wrong attempts lock the person for 15 minutes.
- If the workspace cannot be reached, logins are refused (fail closed) and the gateway resends its usage reports later, so usage is delayed, not lost.

## Set-up, step by step

### 1. Database and function (once)

```bash
supabase db push                                   # applies 20261018000000_data_allocation.sql
supabase secrets set DATA_RADIUS_SECRET="$(openssl rand -hex 32)"   # keep this value, you need it in step 2
supabase functions deploy data-radius --no-verify-jwt
```

`--no-verify-jwt` is required: FreeRADIUS has no workspace session. The function is protected by the
shared secret instead and returns 401 without it. The secret is never stored in git.

Open Administration > Data Allocation, click **1.5 TB**, then **Add to pool**. Pick a plan for each person.

### 2. FreeRADIUS server

Any small Linux box on the office network (a Raspberry Pi 4, an old PC, a cheap VPS reachable from the gateway).

```bash
sudo apt install freeradius freeradius-rest freeradius-utils jq curl
cd ops/freeradius
sudo bash install.sh
sudo nano /etc/freeradius/3.0/ra-data.secret.conf     # URL, vendor, and the secret from step 1
sudo nano /etc/freeradius/3.0/clients.conf            # add your gateway (see clients.conf.example)
sudo systemctl enable --now freeradius
```

`ra_data_vendor = "mikrotik"` also sends `Mikrotik-Total-Limit`, so a MikroTik stops the session itself the
moment the allowance is spent. Use `"generic"` for other gateways; the enforcer then does the cutting.

Check it before involving the gateway:

```bash
radtest ada@ridearrivo.com 'THEIR-PASSWORD' 127.0.0.1 0 testing123   # use your own client secret
```

You should see `Access-Accept` with `Session-Timeout` and, on mikrotik mode, `Mikrotik-Total-Limit`.

### 3. The gateway (MikroTik RouterOS v7 example)

Replace `192.168.88.10` with the FreeRADIUS server and the secret with the one in `clients.conf`.

```
/radius add service=hotspot address=192.168.88.10 secret=CHANGE_ME_gateway_shared_secret timeout=3s
/radius incoming set accept=yes port=3799
/ip hotspot profile set [find] use-radius=yes radius-accounting=yes radius-interim-update=received login-by=http-pap,https
```

- `radius-interim-update=received` makes the router honour the 60 second reporting interval the server asks for.
- `incoming accept=yes` is what lets the enforcer send Disconnect-Request.
- Use HTTPS hotspot login (give the hotspot a certificate) so the password is not typed over plain HTTP.
- PAP is required: the workspace checks the password against its bcrypt hash, which cannot be done with CHAP or MSCHAP.
- Point the router's WAN at the MiFi(s). If the MiFi has no Ethernet, use the router's Wi-Fi in station mode, or a 4G router with the SIM inside.

pfSense (captive portal), OpenWrt with CoovaChilli, and most hotspot gateways work the same way: RADIUS auth on 1812,
accounting on 1813, interim updates on, dynamic authorisation (CoA/Disconnect) on 3799.

### 4. Cutting people off (the enforcer)

Radius accounting tells the workspace how much has been used; the enforcer tells the gateway to hang up.

```bash
sudo install -m 755 ops/freeradius/ra-data-enforcer.sh /usr/local/bin/
sudo install -m 640 -o root -g freerad ops/freeradius/ra-data-nas.list.example /etc/freeradius/3.0/ra-data-nas.list
sudo nano /etc/freeradius/3.0/ra-data-nas.list        # gateway IP and its secret
sudo cp ops/freeradius/ra-data-enforcer.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ra-data-enforcer.timer
journalctl -u ra-data-enforcer -f                      # shows "disconnected ada@... (quota_exhausted)"
```

### 5. People

In Administration > Data Allocation press **Password** on a person's row and give it to them privately, or let them create
their own on their dashboard ("My data today"). They join the office Wi-Fi and sign in with their work email and that password.

When the first usage report arrives the **Gateway** tile turns green.

## What each part does if it breaks

| Failure | Result |
| --- | --- |
| Workspace or database unreachable | Logins refused. Gateway keeps accounting packets and resends. Existing sessions continue until the next successful report. |
| FreeRADIUS down | Gateway cannot authenticate new logins. Existing sessions keep running until they end. |
| Enforcer not running | People are refused at next login, but a session already past its limit keeps running. On MikroTik the `Mikrotik-Total-Limit` still stops it. |
| Wrong shared secret | Every request gets 401, so every login is refused. Fix `ra-data.secret.conf` and `supabase secrets`. |
| Gateway clock or NAS reboot resets its counters | A counter that goes backwards is charged as fresh usage. Retransmitted packets are never charged twice. |

## Files

- `supabase/migrations/20261018000000_data_allocation.sql`: tables, rules, administrator and RADIUS functions
- `supabase/checks/data-allocation.sql`: behaviour checks (47) for a scratch Postgres
- `supabase/functions/data-radius/` and `_shared/dataRadiusCore.ts`: the HTTP side FreeRADIUS calls
- `src/modules/AdminDataAllocation.tsx`: the Administration screen; `src/components/MyDataCard.tsx`: the dashboard card
- `ops/freeradius/`: module, site, installer, enforcer and systemd units
