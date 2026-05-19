#!/usr/bin/env bash
# ============================================================
# check-chart-access-lock.sh
# CHART-ACCESS-LOCK 가드 — 차트 접근 필수 심볼 제거 방지 스캐너
#
# 원리:
#   blocked-symbols.sh (happy-flow-queue)는 금지 심볼이 있으면 차단.
#   이 스크립트는 반대: 필수 심볼이 없으면 차단.
#   차트 열림 5회+ 재발 히스토리 → 구조적 재회귀 방지.
#
# 사용법:
#   ./scripts/check-chart-access-lock.sh         # 기본 실행
#
# bypass (긴급 — 김주연 매니저 승인 필수):
#   BYPASS_CHART_LOCK=1 git push
#   ※ bypass 사용 시 반드시 planner 에 FOLLOWUP 발행 필요
#     (사유 + 김주연 매니저 승인 기록 포함)
#
# 차트 접근 경로 수정이 필요한 경우:
#   1. planner 에 FOLLOWUP 발행 → 수정 사유 + 대안 경로 명시
#   2. supervisor GO 판정 후 이 파일 해당 항목 active:false 변경
#   3. PR 에 승인 티켓 번호 + 승인자 명시 필수
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/chart-access-lock.json"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "=========================================================="
echo " CHART-ACCESS-LOCK 가드 — 차트 접근 필수 심볼 검사"
echo " 티켓: T-20260519-foot-CHART-ACCESS-LOCK"
echo "=========================================================="
echo ""

# ── bypass 체크 ──────────────────────────────────────────────
if [ "${BYPASS_CHART_LOCK:-}" = "1" ]; then
  echo -e "${YELLOW}⚠️  BYPASS_CHART_LOCK=1 감지. 검사 건너뜀.${NC}"
  echo -e "${YELLOW}   ※ planner 에 FOLLOWUP 발행 필수${NC}"
  echo -e "${YELLOW}   ※ 김주연 매니저 승인 기록 의무${NC}"
  echo ""
  exit 0
fi

# ── 사전 조건 확인 ───────────────────────────────────────────
if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}ERROR: 락 설정 파일 없음: $CONFIG_FILE${NC}"
  echo "  scripts/chart-access-lock.json 이 삭제되었습니다."
  echo "  T-20260519-foot-CHART-ACCESS-LOCK 티켓 확인 필요."
  exit 1
fi

# ── JSON 파싱 (python3 또는 node) ────────────────────────────
parse_patterns() {
  if command -v python3 &>/dev/null; then
    python3 - <<'PYEOF'
import json, sys, os

config_path = os.environ.get('CONFIG_FILE', '')
with open(config_path) as f:
    data = json.load(f)

for p in data.get('required_patterns', []):
    if p.get('active', False):
        # id|file|pattern|reason
        _id     = p['id']
        _file   = p['file']
        _pat    = p['pattern']
        _reason = p['reason']
        print(f"{_id}|{_file}|{_pat}|{_reason}")
PYEOF
  elif command -v node &>/dev/null; then
    node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE));
for (const p of data.required_patterns) {
  if (p.active) {
    console.log(p.id + '|' + p.file + '|' + p.pattern + '|' + p.reason);
  }
}
"
  else
    echo -e "${RED}ERROR: python3 또는 node 필요${NC}"
    exit 1
  fi
}

# ── 스캔 실행 ────────────────────────────────────────────────
MISSING_COUNT=0
MISSING_PATTERNS=()

export CONFIG_FILE="$CONFIG_FILE"

while IFS='|' read -r pat_id file pattern reason; do
  [ -z "$pat_id" ] && continue

  TARGET_FILE="$REPO_ROOT/$file"

  # 파일 존재 확인
  if [ ! -f "$TARGET_FILE" ]; then
    MISSING_COUNT=$((MISSING_COUNT + 1))
    MISSING_PATTERNS+=("$pat_id")

    echo -e "${RED}🚨 차트 락 위반 — 파일 삭제됨: [$pat_id]${NC}"
    echo -e "   파일: ${CYAN}$file${NC}"
    echo -e "   사유: $reason"
    echo ""
    continue
  fi

  # 패턴 존재 확인
  matches=$(grep -n "$pattern" "$TARGET_FILE" 2>/dev/null || true)

  if [ -z "$matches" ]; then
    MISSING_COUNT=$((MISSING_COUNT + 1))
    MISSING_PATTERNS+=("$pat_id")

    echo -e "${RED}🚨 차트 락 위반 — 필수 심볼 제거됨: [$pat_id]${NC}"
    echo -e "   파일:    ${CYAN}$file${NC}"
    echo -e "   패턴:    $pattern"
    echo -e "   사유:    $reason"
    echo ""
  else
    echo -e "${GREEN}✅ [$pat_id] OK — ${file}${NC}"
    echo "$matches" | head -3 | while IFS= read -r line; do
      echo -e "     ${CYAN}$line${NC}"
    done
  fi
done < <(parse_patterns)

# ── 결과 출력 ────────────────────────────────────────────────
echo ""
echo "=========================================================="
if [ "$MISSING_COUNT" -gt 0 ]; then
  echo -e "${RED}❌ FAIL — 차트 접근 필수 심볼 ${MISSING_COUNT}종 누락: ${MISSING_PATTERNS[*]}${NC}"
  echo ""
  echo "  차트 접근 경로 수정이 필요한 경우:"
  echo "    1. planner 에 FOLLOWUP 발행 (수정 사유 + 대안 경로 명시)"
  echo "    2. supervisor GO 판정 확인"
  echo "    3. scripts/chart-access-lock.json 해당 항목 active:false 변경"
  echo "    4. 김주연 매니저 현장 승인 획득"
  echo ""
  echo "  긴급 로컬 bypass (김주연 매니저 승인 + planner FOLLOWUP 의무):"
  echo "    BYPASS_CHART_LOCK=1 git push"
  echo "=========================================================="
  echo ""
  exit 1
else
  echo -e "${GREEN}✅ PASS — 차트 접근 필수 심볼 ${#MISSING_PATTERNS[@]}종 모두 정상 (클린)${NC}"
  echo "=========================================================="
  echo ""
  exit 0
fi
