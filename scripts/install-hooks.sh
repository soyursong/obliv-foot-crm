#!/usr/bin/env bash
# install-hooks.sh
# CHART-ACCESS-LOCK 가드 git hook 설치
# T-20260519-foot-CHART-ACCESS-LOCK
#
# 사용법:
#   bash scripts/install-hooks.sh
#
# 새 개발자 온보딩 / 클론 후 반드시 실행.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_SRC="$SCRIPT_DIR/git-hooks/pre-push"
HOOK_DST="$REPO_ROOT/.git/hooks/pre-push"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "CHART-ACCESS-LOCK 가드 hook 설치"
echo "================================="

if [ ! -f "$HOOK_SRC" ]; then
  echo "ERROR: $HOOK_SRC 없음"
  exit 1
fi

# 기존 hook 백업
if [ -f "$HOOK_DST" ]; then
  cp "$HOOK_DST" "${HOOK_DST}.bak.$(date +%Y%m%d%H%M%S)"
  echo -e "${YELLOW}기존 pre-push hook 백업됨${NC}"
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"

echo -e "${GREEN}✅ pre-push hook 설치 완료: $HOOK_DST${NC}"
echo ""
echo "동작 확인:"
echo "  git push 시 자동으로 check-chart-access-lock.sh 실행"
echo "  bypass (김주연 매니저 승인 필수): BYPASS_CHART_LOCK=1 git push"
echo ""
