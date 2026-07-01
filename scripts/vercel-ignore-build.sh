#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# vercel-ignore-build.sh — Vercel "Ignored Build Step" (wired via vercel.json
#   ignoreCommand). Contract per Vercel docs:
#     exit 1  => PROCEED  (run build + create prod/preview deployment)
#     exit 0  => SKIP     (no build, no deployment — daily cap NOT consumed)
#
# Ticket: T-20260630-foot-VERCEL-DEPLOY-THROTTLE
#   풋 Vercel 프로젝트가 커밋마다 자동배포를 발화해 무료플랜 일일 배포한도
#   (>100/day)를 소진 → prod 갱신 차단되는 사고 재발 방지. docs/chore/test/
#   signals 등 "런타임 번들에 영향 없는" 커밋의 배포를 skip 하여 일일한도를
#   의미 있는(코드/에셋 변경) 배포에만 소비한다.
#
# 안전 원칙 (fail-safe = DEPLOY): 판단이 불확실하면 항상 PROCEED(exit 1) 한다.
#   → 진짜 코드 변경이 실수로 skip 되는 일은 절대 없다(AC3: deploy_flow 8단계
#     흐름 무변경 — 의미 있는 커밋은 종전과 동일하게 자동배포).
#   커밋의 "모든" 변경 파일이 아래 non-runtime 목록에 들 때만 skip 한다.
# ---------------------------------------------------------------------------
set -u

log() { echo "[ignore-build] $*"; }

# --- 비교 기준(parent) 결정 ------------------------------------------------
CUR="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"

if [ -n "$PREV" ] && git cat-file -e "${PREV}^{commit}" 2>/dev/null; then
  BASE="$PREV"
elif git rev-parse --verify -q "HEAD^" >/dev/null 2>&1; then
  BASE="HEAD^"
else
  log "no comparable parent (shallow/initial commit) -> PROCEED (fail-safe)"
  exit 1
fi

CHANGED="$(git diff --name-only "$BASE" "$CUR" 2>/dev/null)"
if [ -z "$CHANGED" ]; then
  if git diff --quiet "$BASE" "$CUR" 2>/dev/null; then
    log "no file changes vs ${BASE} -> PROCEED (retrigger/identical tree)"
  else
    log "could not compute diff vs ${BASE} -> PROCEED (fail-safe)"
  fi
  exit 1
fi

log "changed files vs ${BASE}:"
echo "$CHANGED" | sed 's/^/  /'

# --- non-runtime 경로 판정 --------------------------------------------------
# Vite FE 번들(tsc -b && vite build)에 들어가지 않는 파일들.
# src/ · public/ · index.html · package*.json · vite/tsconfig/tailwind/postcss
# · components.json · vercel.json 등 번들/배포설정에 영향을 주는 경로는 여기
# 포함되지 않으므로 자동으로 PROCEED 된다.
is_non_runtime() {
  case "$1" in
    # 운영 아티팩트 / 문서 / 로그 (레포에 동거하지만 앱과 무관)
    signals.md|bus.jsonl|QA_REPORT.md|LOGIC-LOCK-REGISTRY.md|README.md) return 0 ;;
    *.md)                              return 0 ;;
    *.jsonl)                           return 0 ;;
    docs/*|tickets/*|evidence/*|db-gate/*|retro/*|rollback/*) return 0 ;;
    _artifacts/*|_handoff/*|_supervisor/*|ops/*|migration_packages/*) return 0 ;;
    # 테스트 (번들 미포함)
    tests/*|playwright/*|playwright-report/*|test-results/*) return 0 ;;
    *.spec.ts|playwright.config.ts)    return 0 ;;
    # 운영 스크립트 (src 가 import 하지 않음 — 검증 완료)
    scripts/*)                         return 0 ;;
    # Supabase Edge Function/마이그레이션 (Vercel 번들 아님 — supabase CLI 로 별도 배포)
    supabase/*)                        return 0 ;;
    # CI / githooks (Vercel 빌드 산출물과 무관)
    .github/*|.githooks/*)             return 0 ;;
    *)                                 return 1 ;;
  esac
}

while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! is_non_runtime "$f"; then
    log "runtime-affecting change: ${f} -> PROCEED (build + deploy)"
    exit 1
  fi
done <<EOF
$CHANGED
EOF

log "all changes are non-runtime -> SKIP build (daily deploy cap preserved)"
exit 0
