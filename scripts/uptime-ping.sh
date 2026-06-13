#!/usr/bin/env bash
set -u

# Temporary Render Hobby-plan keepalive for Sivan pilot testing.
# Remove this script and .github/workflows/uptime-ping.yml after the
# WhatsApp bot and backend move to always-on paid infrastructure.

DEFAULT_URLS="https://whatsapp-bot-ix7t.onrender.com/api/health,https://sivan-escrow-agent.onrender.com/api/health"
URLS="${UPTIME_PING_URLS:-$DEFAULT_URLS}"
TIMEOUT_SECONDS="${UPTIME_PING_TIMEOUT_SECONDS:-10}"

failures=0

IFS=',' read -ra targets <<< "$URLS"
for raw_url in "${targets[@]}"; do
  url="$(printf '%s' "$raw_url" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -z "$url" ]; then
    continue
  fi

  started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if result="$(curl -fsS --max-time "$TIMEOUT_SECONDS" --retry 1 --retry-delay 2 -o /dev/null -w '%{http_code} %{time_total}' "$url")"; then
    echo "PASS uptime ping $url $result at $started_at"
  else
    echo "FAIL uptime ping $url at $started_at" >&2
    failures=$((failures + 1))
  fi
done

exit "$failures"
