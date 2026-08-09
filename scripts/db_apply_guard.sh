#!/bin/bash
# ============================================================================
# db_apply_guard.sh — obliv-foot-crm prod DB apply 유일 chokepoint (SQL-file lane)
# ----------------------------------------------------------------------------
# 티켓 : T-20260801-meta-DBGATE-GUARD-XCRM-ROLLOUT (P0) — foot leg 이식 (crm 정본 참조)
#        계보 : 07-29 HONORSYS(784b8114) → scalp2 AC-3 08-03(ecc96a0f)
#               → body AC-2 08-05(f924e408) → crm 08-05(e1e4202) → foot(본건).
#        원본 계약 : T-20260731-meta-APPLY-BEFORE-GO-NONDESTRUCTIVE-DBGATE-HARDEN (P1)
#        supervisor CONSULT-REPLY MSG-20260731-142617-q8l6 (표면B guard AC-2)
#        = HONORSYS ed25519 GO-token(α) 재사용 + C20 evidence 로깅 계층.
#
# ── 이 guard 가 SQL-file(DDL) lane 의 유일한 prod apply 통로다(L1) ────────────
#   bare `npx supabase db query --linked ...` 직접 실행 금지(L2 규약).
#   prod DDL/SQL-file 은 이 guard 로만. ★ foot 티켓-전용 per-migration mjs 러너
#   (`scripts/apply_<ts>_foot_*.mjs` — 대부분 scripts/lib/foot_migration_ledger.mjs
#    의 applyMigration()/query() 로 Management API POST, `--apply` argv flag 단독)는
#   apply_gate_lib.mjs 의 `assertApplyGateForRunner()` 를 실제 COMMIT 직전 호출하는
#   것으로 chokepoint 통과 (foot 크로스 표면 — runner_gate_unwired 교훈).
#
# ── AC-4: canonical drift 산식 = md5(pg_proc.prosrc) 단일 ───────────────────
#   함수 body 지문은 md5(pg_proc.prosrc) 로만 대조한다.
#   ⚠ pg_get_functiondef 의 md5 와 혼용 금지(정규화 차이로 위양성/위음성 유발).
#
# ── 인터페이스: SQL 파일 단위만 ──────────────────────────────────────────────
#   db_apply_guard.sh <TICKET_ID> <sql_file> [--dry-run]
#   inline heredoc/문자열 금지 — sha256 binding 대상(파일)을 정의해야 하므로.
#   --dry-run : 게이트·핀·evidence 는 그대로 수행하되 ⑤apply 집행만 생략.
#
# ── 순서 · 전부 fail-closed ──────────────────────────────────────────────────
#   ① ref 해석(config.toml project_id)   ② env matrix pin 대조
#   ③ ref==prod → GO-token verify(부재/실패=abort)  ④ ref==dev → 통과+동일 evidence
#   ⑤ apply 집행(유일 chokepoint)         ⑥ evidence append
#   ref 해석/파싱 불능 = "prod 아님" 간주 금지 → abort(fail-closed).
#
# ── CRM-agnostic 환경 pin (이식 시 이 블록만 교체) ───────────────────────────
#   dev_ops_policy.md §환경매트릭스 / obliv-foot-crm 인프라:
#     foot prod = rxlomoozakkjesdqjtvd (운영)
#     foot dev  = (미생성) — dev_ops_policy §환경매트릭스 foot dev DB 미생성.
#                 body/scalp2 선례대로 DEV_REF empty-guard(fail-closed) 채택 — 추측 pin 금지.
#   DEV_REF 공란 → prod 이외 target = 미지 ref → fail-closed abort.
PROD_REF="rxlomoozakkjesdqjtvd"
DEV_REF=""
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
GATE_LIB="$SCRIPT_DIR/apply_gate_lib.mjs"
EVIDENCE_LOG="$REPO_ROOT/db-gate/_apply_evidence/apply_evidence.jsonl"

# ── RAISE: 명시 실패 + non-zero exit(fail-closed) ────────────────────────────
raise() { echo "[db_apply_guard][ABORT] $*" >&2; exit 1; }

# ── 인자 파싱 ────────────────────────────────────────────────────────────────
DRY_RUN=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --*) raise "알 수 없는 옵션: $arg" ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
[ "${#POSITIONAL[@]}" -eq 2 ] || {
  echo "usage: db_apply_guard.sh <TICKET_ID> <sql_file> [--dry-run]" >&2; exit 64;
}
TICKET_ID="${POSITIONAL[0]}"
SQL_FILE="${POSITIONAL[1]}"

[ -n "$TICKET_ID" ] || raise "TICKET_ID 비어있음"
[ -f "$SQL_FILE" ]  || raise "SQL 파일 없음: $SQL_FILE (inline heredoc 불가 — 파일 단위만)"
[ -f "$GATE_LIB" ]  || raise "게이트 라이브러리 없음: $GATE_LIB"

echo "════════════════════════════════════════════════════════════════════════"
echo " db_apply_guard — foot prod apply chokepoint (T-20260801 DBGATE-GUARD-XCRM)"
echo " ticket=$TICKET_ID  sql=$SQL_FILE  dry_run=$DRY_RUN"
echo "════════════════════════════════════════════════════════════════════════"

# ── ① ref 해석 (config.toml project_id + --linked 대상) ──────────────────────
CONFIG_TOML="$REPO_ROOT/supabase/config.toml"
[ -f "$CONFIG_TOML" ] || raise "config.toml 없음: $CONFIG_TOML (ref 해석 불능 → fail-closed)"
# project_id = "xxxx" 파싱. 불능 시 abort(prod 아님 간주 금지).
TARGET_REF="$(grep -E '^[[:space:]]*project_id[[:space:]]*=' "$CONFIG_TOML" \
  | head -1 | sed -E 's/^[^"]*"([^"]+)".*$/\1/')"
[ -n "$TARGET_REF" ] || raise "config.toml 에서 project_id 파싱 불능 → fail-closed abort"
echo "[①] resolved target_ref = $TARGET_REF (config.toml project_id; --linked 대상)"

# ── ② env matrix pin 대조 (prod=rxlomo / dev=미생성) ─────────────────────────
if [ "$TARGET_REF" = "$PROD_REF" ]; then
  LANE="prod"
elif [ -n "$DEV_REF" ] && [ "$TARGET_REF" = "$DEV_REF" ]; then
  LANE="dev"
else
  raise "target_ref=$TARGET_REF 가 env matrix pin(prod=$PROD_REF${DEV_REF:+/dev=$DEV_REF}) 어디에도 없음 → fail-closed abort (미지 ref)"
fi
echo "[②] env matrix pin 대조 통과 → lane=$LANE"

# ── sql sha256 (산식 SSOT = apply_gate_lib.migrationSha256) ──────────────────
SQL_SHA256="$(node "$GATE_LIB" sha256 "$SQL_FILE")"
echo "[--] sql_sha256 = $SQL_SHA256"

GO_TOKEN_PATH="null"
GO_ISSUED_AT="null"

# ── ③ ref==prod → GO-token verify (부재/실패 = abort) ───────────────────────
if [ "$LANE" = "prod" ]; then
  echo "[③] prod lane → DB-GATE GO 토큰 검증 (fail-closed)"
  # verify-json: 성공 시 gate JSON 만 stdout, 실패 시 non-zero + stderr code.
  if ! GATE_JSON="$(node "$GATE_LIB" verify-json "$TICKET_ID" "$SQL_FILE" --prod "$PROD_REF")"; then
    raise "DB-GATE GO 검증 실패 — supervisor 서명 GO-token 부재/무효/만료/불일치. prod APPLY 근거 없음."
  fi
  GO_TOKEN_PATH="$REPO_ROOT/db-gate/${TICKET_ID}_GO.token.json"
  GO_ISSUED_AT="$(printf '%s' "$GATE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).issuedAt||"null"))}catch(e){process.stdout.write("null")}})')"
  echo "[③] DB-GATE GO ✔  issued_at=$GO_ISSUED_AT"
else
  # ── ④ ref==dev → 통과(게이트 면제) 하되 동일 evidence 로깅 ──────────────────
  echo "[④] dev lane → DB-GATE GO 게이트 면제(dev 대상). 단 동일 evidence 로깅."
fi

# ── evidence 필드 확정 ───────────────────────────────────────────────────────
APPLY_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

append_evidence() {
  local status="$1"
  mkdir -p "$(dirname "$EVIDENCE_LOG")"
  # C20 계약 필드: go_token_path·go_issued_at·apply_ts·sql_sha256·target_ref·ticket_id
  node -e '
    const fs=require("fs");
    const [log,ticket,lane,ref,sha,tok,iss,ts,status,dry]=process.argv.slice(1);
    const rec={
      ticket_id:ticket, lane, target_ref:ref,
      sql_sha256:sha,
      go_token_path: tok==="null"?null:tok,
      go_issued_at: iss==="null"?null:iss,
      apply_ts:ts, status, dry_run: dry==="1",
      guard:"db_apply_guard.sh", schema_version:1
    };
    fs.appendFileSync(log, JSON.stringify(rec)+"\n");
    console.log("[⑥] evidence append →", log);
    console.log(JSON.stringify(rec,null,2));
  ' "$EVIDENCE_LOG" "$TICKET_ID" "$LANE" "$TARGET_REF" "$SQL_SHA256" \
    "$GO_TOKEN_PATH" "$GO_ISSUED_AT" "$APPLY_TS" "$status" "$DRY_RUN"
}

# ── ⑤ apply 집행 (유일 chokepoint) ──────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[⑤] --dry-run: apply 집행 생략(게이트/핀 통과 리허설). DB 무접점."
  append_evidence "dry_run"
  echo "[DONE] dry-run 통과 (lane=$LANE). 실제 apply 아님."
  exit 0
fi

echo "[⑤] apply 집행 → npx supabase db query --linked --file $SQL_FILE"
if npx supabase db query --linked --file "$SQL_FILE"; then
  # ── ⑥ evidence append ──────────────────────────────────────────────────────
  append_evidence "applied"
  echo "[DONE] apply 완료 + evidence 기록 (lane=$LANE, ticket=$TICKET_ID)."
  exit 0
else
  APPLY_RC=$?
  append_evidence "apply_failed"
  raise "apply 실패(rc=$APPLY_RC) — evidence 에 apply_failed 기록됨. 롤백/재검토 필요."
fi
