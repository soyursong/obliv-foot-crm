#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Edge Function 배포 래퍼 — colima/virtiofs eszip ENOENT 항구 회피
#   ref: T-20260716-foot-REDPAY-RESOLVER-SLUG-P0-HOTFIX
#
# 왜:
#   `supabase functions deploy` 는 edge-runtime 컨테이너(colima) 안에서 eszip 를 만들고
#   그 결과 output.eszip 를 호스트의 $TMPDIR(=/var/folders/…) bind-mount 로 되읽는다.
#   그런데 macstudio(M3 Ultra) colima 는 virtiofs 로 $HOME 만 마운트하고 /var/folders 는
#   마운트하지 않는다. → 컨테이너가 output.eszip 를 써도 호스트에는 안 보임
#   → CLI 가 "failed to open eszip: ENOENT … output.eszip" 로 배포 실패.
#
# 해결:
#   CLI 임시 디렉터리를 colima 가 실제로 공유하는 $HOME 하위로 지정(TMPDIR=$HOME/.supabase-tmp).
#   그러면 bind-mount 왕복이 정상 동작해 eszip 가 호스트로 되읽힌다. (검증: alpine bind-mount 왕복 OK)
#
# 사용:
#   scripts/ef_deploy.sh <function-name> [extra supabase args…]
#   예) scripts/ef_deploy.sh redpay-reconcile
#   PROJECT_REF 환경변수 미설정 시 foot prod(rxlomoozakkjesdqjtvd) 기본.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FN="${1:?usage: ef_deploy.sh <function-name> [extra args…]}"
shift || true
PROJECT_REF="${PROJECT_REF:-rxlomoozakkjesdqjtvd}"

TMPROOT="$HOME/.supabase-tmp"
mkdir -p "$TMPROOT"

echo "[ef_deploy] fn=$FN project=$PROJECT_REF TMPDIR=$TMPROOT/"
TMPDIR="$TMPROOT/" supabase functions deploy "$FN" --project-ref "$PROJECT_REF" "$@"
