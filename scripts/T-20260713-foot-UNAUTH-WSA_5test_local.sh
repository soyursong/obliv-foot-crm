#!/usr/bin/env bash
# T-20260713-foot-UNAUTH WS-A — 행위 회귀 5테스트 (로컬 faithful-schema stub, 시크릿 0)
# check_ins.customer_name NOT NULL 등 prod 제약을 그대로 재현 → 마스킹 guard 경로의 hard-block 회귀를 잡는다.
#
# HERMETIC: 실행 중인 Postgres 서버가 없어도 스스로 임시(ephemeral) 클러스터를 기동한다.
#   - 기존 서버(default 소켓)가 accepting connections 이면 그대로 사용(하위호환).
#   - 아니면 mktemp 로 임시 datadir+소켓을 만들어 trust-auth 로 기동 → 테스트 → 자동 파기.
#   - 시크릿 0 · TCP 미개방(listen_addresses='') · 임시 소켓 dir → 기존 5432 서버와 무충돌.
# 사용: bash scripts/T-20260713-foot-UNAUTH-WSA_5test_local.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- pg 바이너리 위치(동일 bin dir에서 psql/pg_ctl/initdb 일괄 확보) ---
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@18/bin/psql)"
PGBIN="$(dirname "$PSQL")"
PG_CTL="$PGBIN/pg_ctl";   [ -x "$PG_CTL" ]   || PG_CTL="$(command -v pg_ctl   || echo /opt/homebrew/opt/postgresql@18/bin/pg_ctl)"
INITDB="$PGBIN/initdb";   [ -x "$INITDB" ]   || INITDB="$(command -v initdb   || echo /opt/homebrew/opt/postgresql@18/bin/initdb)"
PG_READY="$PGBIN/pg_isready"; [ -x "$PG_READY" ] || PG_READY="$(command -v pg_isready || echo /opt/homebrew/opt/postgresql@18/bin/pg_isready)"

HERMETIC=0
TMPROOT=""

cleanup() {
  local rc=$?
  if [ "$HERMETIC" = "1" ] && [ -n "$TMPROOT" ]; then
    "$PG_CTL" -D "$TMPROOT/data" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$TMPROOT" >/dev/null 2>&1 || true
  fi
  return $rc
}
trap cleanup EXIT

# --- 서버 준비: 기존 서버 재사용 or 임시 클러스터 기동 ---
if "$PG_READY" -q >/dev/null 2>&1; then
  echo "[env] 기존 Postgres 서버 재사용 (default 소켓)"
else
  echo "[env] 실행 중 서버 없음 → 임시(ephemeral) 클러스터 기동"
  HERMETIC=1
  TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/wsa5test.XXXXXX")"
  "$INITDB" -D "$TMPROOT/data" -U postgres --auth=trust --encoding=UTF8 >/dev/null 2>&1
  # TCP 미개방(-c listen_addresses=''), 임시 소켓 dir(-k) → 기존 서버와 무충돌
  "$PG_CTL" -D "$TMPROOT/data" -w \
    -o "-k $TMPROOT -c listen_addresses='' -p 5432" start >/dev/null 2>&1
  export PGHOST="$TMPROOT" PGPORT=5432 PGUSER=postgres
  echo "[env] 임시 클러스터 준비 완료: PGHOST=$TMPROOT"
fi

# --- 스텁 스키마 + WS-A 마이그(txn-control strip) 적재 후 5테스트 ---
"$PSQL" -d postgres -c "DROP DATABASE IF EXISTS wsa_stub;" -c "CREATE DATABASE wsa_stub;" >/dev/null
"$PSQL" -d wsa_stub -q -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true
"$PSQL" -d wsa_stub -q -f "$DIR/scripts/T-20260713-foot-UNAUTH-WSA_5test_stub_schema.sql" >/dev/null
grep -vE '^\s*(BEGIN|COMMIT)\s*;' "$DIR/supabase/migrations/20260713120000_selfcheckin_writepath_harden_masked_reject.sql" \
  | "$PSQL" -d wsa_stub -q -f - >/dev/null 2>&1 || true
"$PSQL" -d wsa_stub -f "$DIR/scripts/T-20260713-foot-UNAUTH-WSA_5test.sql"
"$PSQL" -d postgres -c "DROP DATABASE IF EXISTS wsa_stub;" >/dev/null
