#!/usr/bin/env bash
# T-20260713-foot-UNAUTH WS-A — 행위 회귀 5테스트 (로컬 faithful-schema stub, 시크릿 0)
# check_ins.customer_name NOT NULL 등 prod 제약을 그대로 재현 → 마스킹 guard 경로의 hard-block 회귀를 잡는다.
# 사용: bash scripts/T-20260713-foot-UNAUTH-WSA_5test_local.sh
set -euo pipefail
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@18/bin/psql)"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
"$PSQL" -d postgres -c "DROP DATABASE IF EXISTS wsa_stub;" -c "CREATE DATABASE wsa_stub;" >/dev/null
"$PSQL" -d wsa_stub -q -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true
"$PSQL" -d wsa_stub -q -f "$DIR/scripts/T-20260713-foot-UNAUTH-WSA_5test_stub_schema.sql" >/dev/null
grep -vE '^\s*(BEGIN|COMMIT)\s*;' "$DIR/supabase/migrations/20260713120000_selfcheckin_writepath_harden_masked_reject.sql" \
  | "$PSQL" -d wsa_stub -q -f - >/dev/null 2>&1 || true
"$PSQL" -d wsa_stub -f "$DIR/scripts/T-20260713-foot-UNAUTH-WSA_5test.sql"
"$PSQL" -d postgres -c "DROP DATABASE IF EXISTS wsa_stub;" >/dev/null
