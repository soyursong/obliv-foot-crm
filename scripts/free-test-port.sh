#!/usr/bin/env bash
# free-test-port.sh — Playwright E2E 전용 테스트 포트(8089)에 남은 잔여 dev 서버 프로세스 정리.
# 사용처: webServer 기동 실패("http://localhost:8089 is already used") 발생 시,
#         또는 test:e2e:clean 스크립트에서 테스트 실행 직전 자동 호출.
# usage: bash scripts/free-test-port.sh [PORT]   (기본 PORT=8089)
set -euo pipefail

PORT="${1:-8089}"
PIDS="$(lsof -ti:"${PORT}" 2>/dev/null || true)"

if [ -z "${PIDS}" ]; then
  echo "[free-test-port] port ${PORT} is free."
  exit 0
fi

echo "[free-test-port] port ${PORT} in use by PID(s): ${PIDS} — killing..."
# shellcheck disable=SC2086
kill ${PIDS} 2>/dev/null || true
sleep 1

# graceful kill 후에도 남으면 강제 종료
PIDS="$(lsof -ti:"${PORT}" 2>/dev/null || true)"
if [ -n "${PIDS}" ]; then
  echo "[free-test-port] still alive, force kill: ${PIDS}"
  # shellcheck disable=SC2086
  kill -9 ${PIDS} 2>/dev/null || true
  sleep 1
fi

if lsof -ti:"${PORT}" >/dev/null 2>&1; then
  echo "[free-test-port] ERROR: port ${PORT} still in use." >&2
  exit 1
fi
echo "[free-test-port] port ${PORT} freed."
