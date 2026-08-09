#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# T-20260807-foot-CFPAGES-ASSET-404-HTML-IMMUTABLE  (DoD#4)
#
# CF Pages 자산-404 서버오답 재발 상시 감시.
# wrangler pages dev(로컬 workerd/miniflare = 프로덕션 CF Pages 런타임)로
# dist 를 서빙하고 아래 DoD 를 curl 로 강제 검증한다.
#
#   DoD#1  없는 /assets/*        → 404 (200 HTML 아님)
#   DoD#2  실존 /assets/*.js     → 200 · JS MIME · immutable 유지
#   DoD#3  SPA 라우트(/dashboard) → 200 HTML (fallback·라우팅 과차단 없음)
#
# 선행: dist/ 빌드 산출물 존재(= `npm run build`). functions/ + public/_redirects
#       + public/_headers 가 함께 반영돼야 한다.
# 실패 시 non-zero 종료 → 머지 차단.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${CFCHECK_PORT:-8791}"
BASE="http://127.0.0.1:${PORT}"

if [[ ! -d dist/assets ]]; then
  echo "❌ dist/assets 없음 — 먼저 'npm run build' 필요"
  exit 1
fi

# 실존 자산 1개를 런타임에 발견(해시 파일명 → 하드코딩 불가)
REAL_ASSET_FILE="$(ls dist/assets/*.js 2>/dev/null | head -1 || true)"
if [[ -z "$REAL_ASSET_FILE" ]]; then
  echo "❌ dist/assets/*.js 실존 자산 없음"
  exit 1
fi
REAL_ASSET="/assets/$(basename "$REAL_ASSET_FILE")"

# wrangler 는 CF 공식 CLI — package.json 의존성에 추가하지 않고 핀 버전으로 온디맨드 실행
# (신규 npm 의존성 커밋 회피). 로컬/CI 공통. 필요 시 WRANGLER_CMD 로 override.
WRANGLER_CMD="${WRANGLER_CMD:-npx --yes wrangler@4.119.0}"

echo "▶ wrangler pages dev 기동 (port ${PORT})…"
$WRANGLER_CMD pages dev dist --port "$PORT" --ip 127.0.0.1 \
  --compatibility-date=2024-01-01 > /tmp/cfcheck-wrangler.log 2>&1 &
WPID=$!
cleanup() { kill "$WPID" 2>/dev/null || true; }
trap cleanup EXIT

# ready 대기(최대 90s) — 로그의 "Ready on http" 라인으로 우리 wrangler 기동을 확증
# (동일 포트를 다른 프로세스가 선점한 상태에서 curl 성공을 ready 로 오인하지 않도록)
READY=0
for _ in $(seq 1 90); do
  if grep -q "Ready on http" /tmp/cfcheck-wrangler.log 2>/dev/null; then READY=1; break; fi
  if ! kill -0 "$WPID" 2>/dev/null; then
    echo "❌ wrangler 프로세스 조기 종료"; tail -30 /tmp/cfcheck-wrangler.log; exit 1
  fi
  sleep 1
done
if [[ "$READY" -ne 1 ]]; then
  echo "❌ wrangler 서버 기동 실패(timeout)"; tail -30 /tmp/cfcheck-wrangler.log; exit 1
fi
sleep 1

FAIL=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

# 응답 status / content-type / cache-control 을 개행 구분 3줄로 안전 캡처
probe() { curl -s -o /dev/null -w '%{http_code}\n%{content_type}\n%header{cache-control}\n' "$1"; }

# ── DoD#1: 없는 자산 → 404 (200 HTML 아님) ──────────────
echo "── DoD#1: 없는 /assets/* → 404"
OUT="$(probe "${BASE}/assets/does-not-exist-xyz-$$.js")"
S="$(sed -n 1p <<<"$OUT")"; CT="$(sed -n 2p <<<"$OUT")"
if [[ "$S" == "404" ]]; then pass "status=404 (ctype=$CT)"; else fail "expected 404, got $S (ctype=$CT)"; fi
if [[ "$CT" == text/html* ]]; then fail "없는 자산이 HTML 로 회신됨(SPA fallback 누수): $CT"; fi

# ── DoD#2: 실존 자산 → 200 · JS MIME · immutable ─────────
echo "── DoD#2: 실존 ${REAL_ASSET} → 200 · JS MIME · immutable"
OUT="$(probe "${BASE}${REAL_ASSET}")"
S="$(sed -n 1p <<<"$OUT")"; CT="$(sed -n 2p <<<"$OUT")"; CC="$(sed -n 3p <<<"$OUT")"
if [[ "$S" == "200" ]]; then pass "status=200"; else fail "expected 200, got $S"; fi
if [[ "$CT" == *javascript* ]]; then pass "JS MIME=$CT"; else fail "JS MIME 아님: $CT"; fi
if [[ "$CC" == *immutable* ]]; then pass "immutable 유지 ($CC)"; else fail "immutable 유실: $CC"; fi

# ── DoD#3: SPA 라우트 → 200 HTML ─────────────────────────
echo "── DoD#3: SPA 라우트 /dashboard → 200 HTML"
OUT="$(probe "${BASE}/dashboard")"
S="$(sed -n 1p <<<"$OUT")"; CT="$(sed -n 2p <<<"$OUT")"
if [[ "$S" == "200" ]]; then pass "status=200"; else fail "expected 200, got $S"; fi
if [[ "$CT" == text/html* ]]; then pass "HTML 유지 ($CT)"; else fail "HTML 아님(SPA fallback 과차단?): $CT"; fi

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "❌ CF Pages 자산-404 검증 실패 — 재발/회귀 가능. 머지 차단."
  exit 1
fi
echo "✅ CF Pages 자산-404 검증 통과 (DoD#1~3)"
