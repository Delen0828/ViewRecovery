#!/usr/bin/env bash

# Monitor the server/tunnel started by ocular-start-server-eyetracking.sh and,
# optionally, a browser process tree when the browser runs on this same host.
#
# Usage: ./monitor.sh [interval-seconds] [options]
#
# Options:
#   --browser-pid PID  Include PID and all descendants in client-side totals.
#   --log FILE         Write trends to FILE (default: logs/monitor-*.csv).
#   --no-log           Disable CSV trend logging.
#   --no-clear         Append samples instead of refreshing the terminal.
#   --once             Print one sample and exit.
#   -h, --help         Show this help.

set -u

SESSION="ViewRecover-eyetracking"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL=5
BROWSER_ROOT_PID="${MONITOR_BROWSER_PID:-}"
LOG_FILE=""
LOG_ENABLED=true
CLEAR_SCREEN=true
ONCE=false
INTERVAL_SET=false

usage() {
    sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --browser-pid)
            [ "$#" -ge 2 ] || { echo "Error: --browser-pid needs a PID." >&2; exit 1; }
            BROWSER_ROOT_PID="$2"
            shift 2
            ;;
        --log)
            [ "$#" -ge 2 ] || { echo "Error: --log needs a path." >&2; exit 1; }
            LOG_FILE="$2"
            LOG_ENABLED=true
            shift 2
            ;;
        --no-log)
            LOG_ENABLED=false
            shift
            ;;
        --no-clear)
            CLEAR_SCREEN=false
            shift
            ;;
        --once)
            ONCE=true
            CLEAR_SCREEN=false
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --*)
            echo "Error: unknown option '$1'." >&2
            usage >&2
            exit 1
            ;;
        *)
            $INTERVAL_SET && { echo "Error: interval specified twice." >&2; exit 1; }
            INTERVAL="$1"
            INTERVAL_SET=true
            shift
            ;;
    esac
done

if ! [[ "$INTERVAL" =~ ^([1-9][0-9]*|0[.][0-9]*[1-9][0-9]*|[1-9][0-9]*[.][0-9]+)$ ]]; then
    echo "Error: interval must be a positive number of seconds." >&2
    usage >&2
    exit 1
fi

if [ -n "$BROWSER_ROOT_PID" ] &&
   { ! [[ "$BROWSER_ROOT_PID" =~ ^[1-9][0-9]*$ ]] || [ ! -r "/proc/$BROWSER_ROOT_PID/status" ]; }; then
    echo "Error: browser PID '$BROWSER_ROOT_PID' is not a readable live process." >&2
    exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
    echo "Error: tmux is required." >&2
    exit 1
fi

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Error: tmux session '$SESSION' is not running." >&2
    echo "Start it with ./ocular-start-server-eyetracking.sh" >&2
    exit 1
fi

if $LOG_ENABLED; then
    if [ -z "$LOG_FILE" ]; then
        LOG_FILE="$APP_DIR/logs/monitor-$(date '+%Y%m%d-%H%M%S').csv"
    elif [[ "$LOG_FILE" != /* ]]; then
        LOG_FILE="$APP_DIR/$LOG_FILE"
    fi
    mkdir -p "$(dirname "$LOG_FILE")"
fi

process_tree() {
    local parent="$1"
    local child

    [ -r "/proc/$parent/status" ] || return
    printf '%s\n' "$parent"
    while read -r child; do
        [ -n "$child" ] || continue
        process_tree "$child"
    done < <(pgrep -P "$parent" 2>/dev/null || true)
}

make_pid_list() {
    local first=true pid
    for pid in "$@"; do
        $first || printf ','
        printf '%s' "$pid"
        first=false
    done
}

# Prints: process_count,cpu_percent,rss_kib,threads,fds,sockets
process_totals() {
    local list="$1" base pid fds=0 sockets=0
    [ -n "$list" ] || { echo "0,0,0,0,0,0"; return; }

    base="$(ps -p "$list" -o %cpu=,rss=,nlwp= 2>/dev/null | awk '
        { cpu += $1; rss += $2; threads += $3; count++ }
        END { printf "%d,%.1f,%.0f,%d", count, cpu, rss, threads }
    ')"
    [ -n "$base" ] || { echo "0,0,0,0,0,0"; return; }

    while read -r pid; do
        [ -d "/proc/$pid/fd" ] || continue
        fds=$((fds + $(find "/proc/$pid/fd" -maxdepth 1 -type l 2>/dev/null | wc -l)))
        sockets=$((sockets + $(find "/proc/$pid/fd" -maxdepth 1 -type l -lname 'socket:*' 2>/dev/null | wc -l)))
    done < <(printf '%s\n' "$list" | tr ',' '\n')
    printf '%s,%d,%d\n' "$base" "$fds" "$sockets"
}

print_processes() {
    local label="$1" list="$2"
    echo "$label"
    printf '%-7s %-7s %-7s %-10s %-7s %-10s %s\n' \
        "PID" "PPID" "%CPU" "RSS(MiB)" "THREADS" "ELAPSED" "COMMAND"
    ps -p "$list" -o pid=,ppid=,%cpu=,rss=,nlwp=,etime=,args= 2>/dev/null | awk '
        { printf "%-7s %-7s %-7s %-10.1f %-7s %-10s", $1, $2, $3, $4 / 1024, $5, $6
          for (i = 7; i <= NF; i++) printf " %s", $i
          printf "\n" }
    '
}

# cloudflared exposes Prometheus counters on a loopback TCP listener.
find_metrics_url() {
    local pid="$1" address=""
    command -v lsof >/dev/null 2>&1 || return
    address="$(lsof -Pan -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk '
        NR > 1 && $9 ~ /^127[.]0[.]0[.]1:[0-9]+$/ { print $9; exit }
    ')"
    [ -n "$address" ] && printf 'http://%s/metrics\n' "$address"
}

metric_sum() {
    local wanted="$1"
    awk -v wanted="$wanted" '
        /^[^#]/ {
            name = $1
            sub(/\{.*/, "", name)
            if (name == wanted) { value += $NF; found = 1 }
        }
        END { if (found) printf "%.17g", value }
    '
}

metric_average() {
    local wanted="$1"
    awk -v wanted="$wanted" '
        /^[^#]/ {
            name = $1
            sub(/\{.*/, "", name)
            if (name == wanted) { value += $NF; count++ }
        }
        END { if (count) printf "%.2f", value / count }
    '
}

counter_rate() {
    awk -v now="$1" -v before="$2" -v seconds="$3" 'BEGIN {
        if (now == "" || before == "" || seconds <= 0 || now < before) print "n/a"
        else printf "%.3f", (now - before) / seconds
    }'
}

byte_rate() {
    if [ "$1" = "n/a" ]; then
        printf 'n/a'
    else
        awk -v bytes="$1" 'BEGIN {
            if (bytes >= 1048576) printf "%.2f MiB/s", bytes / 1048576
            else printf "%.2f KiB/s", bytes / 1024
        }'
    fi
}

meminfo_kib() {
    awk -v wanted="$1" '$1 == wanted ":" { print $2 }' /proc/meminfo
}

pressure_avg10() {
    if [ -r "/proc/pressure/$1" ]; then
        awk '$1 == "some" {
            for (i=1; i<=NF; i++) if ($i ~ /^avg10=/) {
                sub(/^avg10=/, "", $i); print $i
            }
        }' "/proc/pressure/$1"
    else
        echo "n/a"
    fi
}

START_TIME="$(date +%s)"
SAMPLE_COUNT=0
SERVER_BASE_RSS=""
BROWSER_BASE_RSS=""
PREVIOUS_TIME=""
PREVIOUS_RX=""
PREVIOUS_TX=""
PREVIOUS_REQUESTS=""
PREVIOUS_LOST=""

if $LOG_ENABLED; then
    echo 'timestamp,elapsed_s,server_processes,server_cpu_pct,server_rss_mib,server_rss_delta_mib,server_threads,server_fds,server_sockets,browser_processes,browser_cpu_pct,browser_rss_mib,browser_rss_delta_mib,browser_threads,browser_fds,browser_sockets,tunnel_rx_kib_s,tunnel_tx_kib_s,tunnel_requests_s,tunnel_requests_total,tunnel_errors_total,tunnel_ha_connections,tunnel_active_requests,tunnel_rtt_ms,tunnel_lost_packets_s,host_mem_available_mib,host_swap_used_mib,host_load1,cpu_pressure_avg10,memory_pressure_avg10' > "$LOG_FILE"
fi

while true; do
    NOW="$(date +%s)"
    ELAPSED=$((NOW - START_TIME))
    SAMPLE_COUNT=$((SAMPLE_COUNT + 1))

    mapfile -t PANE_PIDS < <(tmux list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null)
    if [ "${#PANE_PIDS[@]}" -eq 0 ]; then
        echo "The tmux session '$SESSION' is no longer running."
        exit 1
    fi

    mapfile -t SERVER_PIDS < <(
        for pane_pid in "${PANE_PIDS[@]}"; do
            process_tree "$pane_pid"
        done | sort -n -u
    )
    SERVER_PID_LIST="$(make_pid_list "${SERVER_PIDS[@]}")"
    IFS=, read -r SERVER_COUNT SERVER_CPU SERVER_RSS SERVER_THREADS SERVER_FDS SERVER_SOCKETS \
        <<< "$(process_totals "$SERVER_PID_LIST")"
    [ -n "$SERVER_BASE_RSS" ] || SERVER_BASE_RSS="$SERVER_RSS"
    SERVER_RSS_MIB="$(awk -v n="$SERVER_RSS" 'BEGIN { printf "%.1f", n / 1024 }')"
    SERVER_RSS_DELTA="$(awk -v n="$SERVER_RSS" -v b="$SERVER_BASE_RSS" 'BEGIN { printf "%+.1f", (n-b)/1024 }')"

    BROWSER_COUNT=0 BROWSER_CPU=0 BROWSER_RSS=0 BROWSER_THREADS=0 BROWSER_FDS=0 BROWSER_SOCKETS=0
    BROWSER_RSS_MIB=0.0 BROWSER_RSS_DELTA=0.0 BROWSER_PID_LIST=""
    if [ -n "$BROWSER_ROOT_PID" ] && [ -r "/proc/$BROWSER_ROOT_PID/status" ]; then
        mapfile -t BROWSER_PIDS < <(process_tree "$BROWSER_ROOT_PID" | sort -n -u)
        BROWSER_PID_LIST="$(make_pid_list "${BROWSER_PIDS[@]}")"
        IFS=, read -r BROWSER_COUNT BROWSER_CPU BROWSER_RSS BROWSER_THREADS BROWSER_FDS BROWSER_SOCKETS \
            <<< "$(process_totals "$BROWSER_PID_LIST")"
        [ -n "$BROWSER_BASE_RSS" ] || BROWSER_BASE_RSS="$BROWSER_RSS"
        BROWSER_RSS_MIB="$(awk -v n="$BROWSER_RSS" 'BEGIN { printf "%.1f", n / 1024 }')"
        BROWSER_RSS_DELTA="$(awk -v n="$BROWSER_RSS" -v b="$BROWSER_BASE_RSS" 'BEGIN { printf "%+.1f", (n-b)/1024 }')"
    fi

    CLOUDFLARED_PID=""
    for pid in "${SERVER_PIDS[@]}"; do
        [ "$(ps -p "$pid" -o comm= 2>/dev/null)" = "cloudflared" ] && CLOUDFLARED_PID="$pid"
    done

    METRICS="" METRICS_URL=""
    if [ -n "$CLOUDFLARED_PID" ] && command -v curl >/dev/null 2>&1; then
        METRICS_URL="$(find_metrics_url "$CLOUDFLARED_PID")"
        [ -z "$METRICS_URL" ] || METRICS="$(curl --max-time 2 --fail --silent "$METRICS_URL" 2>/dev/null || true)"
    fi

    RX="" TX="" REQUESTS="" ERRORS="" HA="" ACTIVE="" RTT="" LOST=""
    if [ -n "$METRICS" ]; then
        RX="$(printf '%s\n' "$METRICS" | metric_sum quic_client_receive_bytes)"
        TX="$(printf '%s\n' "$METRICS" | metric_sum quic_client_sent_bytes)"
        [ -n "$RX" ] || RX="$(printf '%s\n' "$METRICS" | metric_sum process_network_receive_bytes_total)"
        [ -n "$TX" ] || TX="$(printf '%s\n' "$METRICS" | metric_sum process_network_transmit_bytes_total)"
        REQUESTS="$(printf '%s\n' "$METRICS" | metric_sum cloudflared_tunnel_total_requests)"
        ERRORS="$(printf '%s\n' "$METRICS" | metric_sum cloudflared_tunnel_request_errors)"
        HA="$(printf '%s\n' "$METRICS" | metric_sum cloudflared_tunnel_ha_connections)"
        ACTIVE="$(printf '%s\n' "$METRICS" | metric_sum cloudflared_tunnel_concurrent_requests_per_tunnel)"
        RTT="$(printf '%s\n' "$METRICS" | metric_average quic_client_smoothed_rtt)"
        LOST="$(printf '%s\n' "$METRICS" | metric_sum quic_client_lost_packets)"
    fi

    SAMPLE_SECONDS=0
    [ -z "$PREVIOUS_TIME" ] || SAMPLE_SECONDS=$((NOW - PREVIOUS_TIME))
    RX_RATE="$(counter_rate "$RX" "$PREVIOUS_RX" "$SAMPLE_SECONDS")"
    TX_RATE="$(counter_rate "$TX" "$PREVIOUS_TX" "$SAMPLE_SECONDS")"
    REQUEST_RATE="$(counter_rate "$REQUESTS" "$PREVIOUS_REQUESTS" "$SAMPLE_SECONDS")"
    LOST_RATE="$(counter_rate "$LOST" "$PREVIOUS_LOST" "$SAMPLE_SECONDS")"

    MEM_AVAILABLE="$(meminfo_kib MemAvailable)"
    SWAP_TOTAL="$(meminfo_kib SwapTotal)"
    SWAP_FREE="$(meminfo_kib SwapFree)"
    MEM_AVAILABLE_MIB="$(awk -v n="$MEM_AVAILABLE" 'BEGIN { printf "%.1f", n/1024 }')"
    SWAP_USED_MIB="$(awk -v t="$SWAP_TOTAL" -v f="$SWAP_FREE" 'BEGIN { printf "%.1f", (t-f)/1024 }')"
    LOAD1="$(awk '{print $1}' /proc/loadavg)"
    CPU_PRESSURE="$(pressure_avg10 cpu)"
    MEMORY_PRESSURE="$(pressure_avg10 memory)"
    TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

    $CLEAR_SCREEN && [ -t 1 ] && clear
    [ "$SAMPLE_COUNT" -eq 1 ] || $CLEAR_SCREEN || echo
    echo "ViewRecovery eye-tracking monitor"
    echo "Session: $SESSION    $TIMESTAMP    elapsed: ${ELAPSED}s"
    echo "Interval: ${INTERVAL}s    sample: $SAMPLE_COUNT    Ctrl-C stops monitoring"
    $LOG_ENABLED && echo "Trend log: $LOG_FILE" || echo "Trend log: disabled"
    echo

    print_processes "Server/tunnel processes:" "$SERVER_PID_LIST"
    printf '  total: %d processes | CPU: %s%% | RSS: %s MiB (%s MiB baseline delta) | threads: %d | FDs: %d | sockets: %d\n' \
        "$SERVER_COUNT" "$SERVER_CPU" "$SERVER_RSS_MIB" "$SERVER_RSS_DELTA" "$SERVER_THREADS" "$SERVER_FDS" "$SERVER_SOCKETS"

    echo
    echo "Cloudflare tunnel telemetry:"
    if [ -n "$METRICS" ]; then
        printf '  edge traffic: RX %s | TX %s | HTTP requests: %s/s (total %s)\n' \
            "$(byte_rate "$RX_RATE")" "$(byte_rate "$TX_RATE")" "$REQUEST_RATE" "${REQUESTS:-n/a}"
        printf '  active: %s | request errors: %s | HA connections: %s | mean QUIC RTT: %s ms | packet loss: %s/s\n' \
            "${ACTIVE:-n/a}" "${ERRORS:-n/a}" "${HA:-n/a}" "${RTT:-n/a}" "$LOST_RATE"
    else
        echo "  unavailable (no readable cloudflared metrics endpoint)"
    fi

    echo
    if [ -n "$BROWSER_PID_LIST" ]; then
        print_processes "Local browser tree (root PID $BROWSER_ROOT_PID):" "$BROWSER_PID_LIST"
        printf '  total: %d processes | CPU: %s%% | RSS: %s MiB (%s MiB baseline delta) | threads: %d | FDs: %d | sockets: %d\n' \
            "$BROWSER_COUNT" "$BROWSER_CPU" "$BROWSER_RSS_MIB" "$BROWSER_RSS_DELTA" "$BROWSER_THREADS" "$BROWSER_FDS" "$BROWSER_SOCKETS"
    elif [ -n "$BROWSER_ROOT_PID" ]; then
        echo "Local browser tree: root PID $BROWSER_ROOT_PID has exited."
    else
        echo "Client/browser: not monitored; it is not a tmux descendant."
        echo "  Same host: add --browser-pid MAIN_BROWSER_PID"
        echo "  Remote participant: use browser DevTools/client-side instrumentation."
    fi

    echo
    printf 'Host: available RAM %s MiB | swap used %s MiB | load(1m) %s | CPU PSI(10s) %s%% | memory PSI(10s) %s%%\n' \
        "$MEM_AVAILABLE_MIB" "$SWAP_USED_MIB" "$LOAD1" "$CPU_PRESSURE" "$MEMORY_PRESSURE"

    if $LOG_ENABLED; then
        RX_KIB_RATE="$(awk -v n="$RX_RATE" 'BEGIN {if(n=="n/a") print n; else printf "%.3f",n/1024}')"
        TX_KIB_RATE="$(awk -v n="$TX_RATE" 'BEGIN {if(n=="n/a") print n; else printf "%.3f",n/1024}')"
        echo "$TIMESTAMP,$ELAPSED,$SERVER_COUNT,$SERVER_CPU,$SERVER_RSS_MIB,$SERVER_RSS_DELTA,$SERVER_THREADS,$SERVER_FDS,$SERVER_SOCKETS,$BROWSER_COUNT,$BROWSER_CPU,$BROWSER_RSS_MIB,$BROWSER_RSS_DELTA,$BROWSER_THREADS,$BROWSER_FDS,$BROWSER_SOCKETS,$RX_KIB_RATE,$TX_KIB_RATE,$REQUEST_RATE,${REQUESTS:-n/a},${ERRORS:-n/a},${HA:-n/a},${ACTIVE:-n/a},${RTT:-n/a},$LOST_RATE,$MEM_AVAILABLE_MIB,$SWAP_USED_MIB,$LOAD1,$CPU_PRESSURE,$MEMORY_PRESSURE" >> "$LOG_FILE"
    fi

    PREVIOUS_TIME="$NOW"
    PREVIOUS_RX="$RX"
    PREVIOUS_TX="$TX"
    PREVIOUS_REQUESTS="$REQUESTS"
    PREVIOUS_LOST="$LOST"

    $ONCE && break
    sleep "$INTERVAL"
done
