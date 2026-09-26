#!/usr/bin/env bash
# P4.M3.T3: verifies docs/deploy.md §3 ("Remote access: token + TLS") end to
# end on a Linux host. It runs aeosd exactly as the doc says (token file,
# loopback bind), puts BOTH documented reverse proxies in front of it (the
# Caddyfile with a local CA in place of ACME; the nginx server block verbatim,
# with a self-signed cert in place of Let's Encrypt), and checks over verified
# TLS: /healthz and the UI shell stay open, /v1 needs the bearer token, the
# SSE stream arrives unbuffered, and the terminal WebSocket upgrades through
# the proxy. It also checks that aeosd refuses a non-loopback bind with no
# token.
#
# Needs: a built repo (pnpm build), node 22, caddy, nginx, openssl, curl.
# Usage: scripts/release/verify-remote-tls.sh [workdir]
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
W=$(mkdir -p "${1:-$(mktemp -d)}" && cd "${1:-.}" && pwd)
CADDY=${CADDY:-caddy}
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  [ -f "$W/nginx.pid" ] && kill "$(cat "$W/nginx.pid")" 2>/dev/null
}
trap cleanup EXIT

TOKEN=$(openssl rand -hex 24); mkdir -p "$W/etc" && echo "$TOKEN" > "$W/etc/token"
AEOS_API_TOKEN_FILE=$W/etc/token AEOS_HOST=127.0.0.1 AEOS_HOME=$W/home AEOS_PROVIDER=fake \
  node "$REPO/apps/aeosd/dist/main.js" run > "$W/aeosd.log" 2>&1 & PIDS+=($!)
for _ in $(seq 30); do curl -sf --noproxy '*' http://127.0.0.1:7777/healthz >/dev/null && break; sleep 1; done

cat > "$W/Caddyfile" <<C
aeos.localhost:8443 {
  reverse_proxy 127.0.0.1:7777 {
    flush_interval -1        # stream events (SSE) without buffering
  }
}
C
XDG_DATA_HOME=$W/xdg XDG_CONFIG_HOME=$W/xdg "$CADDY" run --config "$W/Caddyfile" --adapter caddyfile > "$W/caddy.log" 2>&1 & PIDS+=($!)

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=aeos.localhost \
  -addext subjectAltName=DNS:aeos.localhost -keyout "$W/key.pem" -out "$W/cert.pem" 2>/dev/null
cat > "$W/nginx.conf" <<N
events {}
http {
  server {
    listen 9443 ssl;
    server_name aeos.localhost;
    ssl_certificate     $W/cert.pem;
    ssl_certificate_key $W/key.pem;

    location / {
      proxy_pass http://127.0.0.1:7777;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;       # terminal takeover (WebSocket)
      proxy_set_header Connection "upgrade";
      proxy_buffering off;                          # event stream (SSE)
      proxy_read_timeout 1h;
    }
  }
}
N
nginx -c "$W/nginx.conf" -p "$W" -g "pid $W/nginx.pid; error_log $W/nginx-error.log;"
sleep 3

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then echo "  PASS $1 ($2)"; pass=$((pass + 1))
  else echo "  FAIL $1 (got '$2', want '$3')"; fail=$((fail + 1)); fi
}
for proxy in "caddy:8443:$W/xdg/caddy/pki/authorities/local/root.crt" "nginx:9443:$W/cert.pem"; do
  IFS=: read -r name port ca <<< "$proxy"
  B=https://aeos.localhost:$port
  C=(curl -sS --noproxy aeos.localhost --cacert "$ca" --resolve "aeos.localhost:$port:127.0.0.1")
  echo "== $name (verified TLS)"
  check "healthz open"      "$("${C[@]}" -o /dev/null -w '%{http_code}' $B/healthz)" 200
  check "healthz body"      "$("${C[@]}" $B/healthz)" '{"status":"ok"}'
  check "UI shell open"     "$("${C[@]}" -o /dev/null -w '%{http_code}' $B/)" 200
  check "/v1 no token"      "$("${C[@]}" -o /dev/null -w '%{http_code}' $B/v1/workspaces)" 401
  check "/v1 wrong token"   "$("${C[@]}" -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong-wrong-wrong-wrong' $B/v1/workspaces)" 401
  check "/v1 with token"    "$("${C[@]}" -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" $B/v1/workspaces)" 200
  check "SSE unbuffered"    "$("${C[@]}" -N --max-time 3 "$B/v1/events?token=$TOKEN" 2>/dev/null | head -c 12)" ': connected'
  check "SSE no token"      "$("${C[@]}" -o /dev/null -w '%{http_code}' --max-time 3 $B/v1/events)" 401
  # an unknown session closes with 1008 — reaching that close proves the upgrade crossed the proxy
  ws=$(NODE_EXTRA_CA_CERTS=$ca node -e "
    const dns = require('dns'); const lookup = dns.lookup;
    dns.lookup = (h, ...a) => lookup(h === 'aeos.localhost' ? '127.0.0.1' : h, ...a);
    const ws = new WebSocket('wss://aeos.localhost:$port/v1/sessions/nope/attach?token=$TOKEN');
    ws.onopen = () => process.stdout.write('open,');
    ws.onclose = (e) => { console.log(e.code); process.exit(0); };
    ws.onerror = () => {};
    setTimeout(() => { console.log('timeout'); process.exit(0); }, 5000);")
  check "WS via proxy"      "$ws" "open,1008"
done

echo "== non-loopback bind without a token"
refusal=$(env -u AEOS_API_TOKEN -u AEOS_API_TOKEN_FILE AEOS_HOST=0.0.0.0 AEOS_PORT=7788 AEOS_HOME=$W/home2 AEOS_PROVIDER=fake \
  timeout 15 node "$REPO/apps/aeosd/dist/main.js" run 2>&1 | grep -c 'refusing to bind 0.0.0.0 without AEOS_API_TOKEN')
check "refused" "$refusal" 1

echo "RESULT pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
