#!/usr/bin/env bash
# check-perm-migration-hold.sh
# ─────────────────────────────────────────────────────────────────────────────
# T-20260725-foot-PERMISSION-PARITY-PLAYBOOK STEP 2 (INV-2 server-first 강제).
#
# 목적: 권한(role/RLS 정책/권한 컬럼) 관련 마이그레이션이 `.DDL_DIFF_HOLD` 상태로
#   방치(drift)되는 것을 머지 게이트로 차단한다. 권한 '확대'는 RLS 를 먼저 랜딩·확인한
#   뒤 FE 를 여는 것이 원칙(INV-2). 권한 마이그가 HOLD 로 남아 있는데 FE 만 머지되면
#   lock-out-in-disguise / silent 0-row 사고가 재발한다.
#
# 정책(레포 convention 존중):
#   `.DDL_DIFF_HOLD` 자체는 이 레포의 '정상' 대기상태(= supervisor DDL-diff 게이트 전
#   apply 보류)다. 따라서 HOLD 존재만으로 무조건 fail 하지 않는다. 대신 권한-관련 HOLD
#   마이그는 반드시 아래 LEDGER(추적 원장)에 등록되어 있어야 한다. 미등록(untracked)
#   권한 HOLD = 책임소재 불명의 drift → FAIL. 새 권한 HOLD 를 추가하려면 추적 티켓과
#   함께 LEDGER 에 등재해야 머지된다(= "그 상태론 머지 불가"의 실현).
#
# 통과 조건(AC): 권한 컬럼/정책 `.DDL_DIFF_HOLD` 중 LEDGER 미등록 0건.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

MIG_DIR="supabase/migrations"

# ── LEDGER: 추적 중인 권한 HOLD 마이그(basename) ──────────────────────────────
#   STEP3(HOLD 드리프트 종결)가 data-architect CONSULT + supervisor DDL-diff 게이트
#   통과 후 이들을 랜딩/롤백하면 여기서 제거된다. 그 전까지는 '추적된 pending'으로 허용.
#   ★신규 항목 추가 시 반드시 (추적 티켓 ID)를 주석으로 남길 것.
LEDGER=(
  # T-20260619-foot-ROLE-MATRIX-3TIER-RBAC / STEP3 (DA CONSULT + supervisor DDL-diff 대기)
  "20260619220000_user_profiles_has_ops_authority_additive.sql.DDL_DIFF_HOLD"
  # T-20260620-foot-MUNJIEUN-ROLE-DIRECTOR / STEP3 (위 컬럼 랜딩 후 has_ops_authority=true set)
  "20260620020500_munjieun_has_ops_authority_set.sql.DDL_DIFF_HOLD"
)

in_ledger() {
  local name="$1"
  for e in "${LEDGER[@]}"; do [ "$e" = "$name" ] && return 0; done
  return 1
}

# 권한-관련 판정: 파일명 또는 내용에 role/RLS 권한 시그널이 있으면 true.
is_perm_related() {
  local f="$1"
  case "$(basename "$f")" in
    *has_ops_authority*|*_rls_*|*_perm*|*role*|*policy*|*grant*) return 0 ;;
  esac
  grep -qiE "CREATE[[:space:]]+POLICY|ALTER[[:space:]]+POLICY|has_ops_authority|GRANT[[:space:]]|user_profiles.*role|check.*role" "$f" 2>/dev/null
}

fail=0
untracked=()

if [ -d "$MIG_DIR" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    base="$(basename "$f")"
    if is_perm_related "$f"; then
      if ! in_ledger "$base"; then
        untracked+=("$base")
        fail=1
      fi
    fi
  done < <(find "$MIG_DIR" -maxdepth 1 -name "*.DDL_DIFF_HOLD" 2>/dev/null | sort)
fi

echo "── STEP2 server-first HOLD gate ──────────────────────────────"
echo "  LEDGER(추적된 권한 HOLD): ${#LEDGER[@]}건"
for e in "${LEDGER[@]}"; do
  if [ -e "$MIG_DIR/$e" ]; then echo "    · $e  [pending — STEP3 DA gate]"; else echo "    · $e  [ledger에 있으나 파일 부재 → STEP3 종결됨, ledger에서 제거 가능]"; fi
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "❌ 미등록(untracked) 권한 .DDL_DIFF_HOLD 마이그 발견:"
  for u in "${untracked[@]}"; do echo "    ✗ $u"; done
  echo ""
  echo "  INV-2(server-first): 권한 마이그를 HOLD 로 두려면 추적 티켓과 함께 이 스크립트의"
  echo "  LEDGER 배열에 등재해야 합니다. FE 를 먼저 여는 lock-out-in-disguise 를 차단합니다."
  exit 1
fi

echo ""
echo "✅ 미등록 권한 HOLD 0건 (server-first 정합)"
exit 0
