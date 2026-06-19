#!/usr/bin/env bash
set -u

# Temporary Render Hobby-plan keepalive for Sivan pilot testing.
# Remove this script and .github/workflows/uptime-ping.yml after the
# WhatsApp bot and backend move to always-on paid infrastructure.

DEFAULT_URLS="https://whatsapp-bot-ix7t.onrender.com/api/health,https://sivan-escrow-agent.onrender.com/api/health"
URLS="${UPTIME_PING_URLS:-$DEFAULT_URLS}"
TIMEOUT_SECONDS="${UPTIME_PING_TIMEOUT_SECONDS:-45}"
ATTEMPTS="${UPTIME_PING_ATTEMPTS:-3}"
RETRY_DELAY_SECONDS="${UPTIME_PING_RETRY_DELAY_SECONDS:-20}"
FAIL_WORKFLOW="${UPTIME_PING_FAIL_WORKFLOW:-false}"

failures=0

should_fail_workflow() {
  case "$(printf '%s' "$FAIL_WORKFLOW" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes) return 0 ;;
    *) return 1 ;;
  esac
}

IFS=',' read -ra targets <<< "$URLS"
for raw_url in "${targets[@]}"; do
  url="$(printf '%s' "$raw_url" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -z "$url" ]; then
    continue
  fi

  passed=0
  last_result=""
  attempt=1
  while [ "$attempt" -le "$ATTEMPTS" ]; do
    started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    result="$(curl -sS -L --connect-timeout 10 --max-time "$TIMEOUT_SECONDS" -o /dev/null -w '%{http_code} %{time_total}' "$url" 2>&1)"
    curl_status=$?
    last_result="$result"

    if [ "$curl_status" -eq 0 ]; then
      http_code="$(printf '%s' "$result" | awk '{print $1}')"
      case "$http_code" in
        2*|3*)
          echo "PASS uptime ping $url attempt=$attempt result=$result at $started_at"
          passed=1
          break
          ;;
      esac
    fi

    echo "WARN uptime ping attempt=$attempt url=$url result=$result at $started_at" >&2
    if [ "$attempt" -lt "$ATTEMPTS" ]; then
      sleep "$RETRY_DELAY_SECONDS"
    fi
    attempt=$((attempt + 1))
  done

  if [ "$passed" -ne 1 ]; then
    echo "WARN uptime ping did not receive a healthy response from $url after ${ATTEMPTS} attempts; last_result=$last_result" >&2
    echo "WARN keepalive is non-blocking by default because Render Hobby services can cold-start slowly" >&2
    if should_fail_workflow; then
      failures=$((failures + 1))
    fi
  fi
done

exit "$failures"
