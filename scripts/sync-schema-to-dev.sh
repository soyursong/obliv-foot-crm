#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# T-20260719-foot-HARNESS-TESTDB-ISOLATION — prod 스키마 → foot 전용 E2E/CI 격리 DB 동기화 런북
#   (scalp T-20260616-meta-AXTEAM-SCALP-NONPROD-SUPABASE 런북 복제 · foot 슬라이스)
#
#   격리 대상 dev 프로젝트: obliv-foot-dev (ref kcdqtyivtqcjmcrdjkqi, Seoul ap-northeast-2, PHI-0)
#   prod(무접점, read-only pg_dump): crm-obliv-foot (ref rxlomoozakkjesdqjtvd)
#
# 하는 일 (dev 프로젝트에만 write; prod 는 --schema-only read 만):
#   1) prod public 스키마 schema-only pg_dump  (데이터 0 — PHI 미유출)
#   2) dev 프로젝트에 스키마 복원
#   3) 합성 PHI-0 시드 (clinic1 · staff roster · DUMMY 고객1 is_simulation=true)
#   4) §1-α 번들-스모크 gate 검증 명령 출력
#
# ⚠ prod DB 비밀번호는 supervisor 보유 크리덴셜 (dev-foot 는 prod 무접점 = 이 티켓 db_change=false).
#   → 본 스크립트는 supervisor 가 PROD_DB_PASSWORD 를 주입해 실행하는 협업 provisioning 도구.
#
# 사용법:
#   export PROD_DB_PASSWORD='<crm-obliv-foot postgres 비밀번호>'
#   bash scripts/sync-schema-to-dev.sh
#   ( dev 접속정보는 .env.dev-isolation.local 에서 자동 로드 — gitignored )
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRED="$SCRIPT_DIR/.env.dev-isolation.local"

if [[ ! -f "$CRED" ]]; then
  echo "❌ $CRED 부재 — dev 프로젝트 provisioning 산출물(dev-foot 발행)을 먼저 확보하세요." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CRED"

: "${PROD_DB_PASSWORD:?PROD_DB_PASSWORD 를 export 하세요 (supervisor 보유 crm-obliv-foot postgres 비번)}"
: "${DEV_SUPABASE_POOLER_SESSION:?.env.dev-isolation.local 에 DEV_SUPABASE_POOLER_SESSION 필요}"

PROD_REF="rxlomoozakkjesdqjtvd"
PROD_CONN="postgresql://postgres.${PROD_REF}:${PROD_DB_PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
DUMP="/tmp/foot_prod_schema_$(date +%s 2>/dev/null || echo dump).sql"

echo "📋 [1/4] prod public 스키마 schema-only 덤프 (데이터 미포함) …"
pg_dump "$PROD_CONN" \
  --schema=public \
  --schema-only \
  --no-owner --no-privileges \
  --no-comments \
  -f "$DUMP"
echo "    → $DUMP ($(wc -l < "$DUMP") 줄)"

echo "🏗  [2/4] dev(obliv-foot-dev) 스키마 복원 …"
psql "$DEV_SUPABASE_POOLER_SESSION" -v ON_ERROR_STOP=1 -f "$DUMP"

echo "🌱 [3/4] 합성 PHI-0 시드 (is_simulation=true) …"
psql "$DEV_SUPABASE_POOLER_SESSION" -v ON_ERROR_STOP=1 <<'SQL'
-- clinic 1 (jongno-foot) — 실제 시드는 스키마 seed_data 마이그와 동일 slug 사용.
-- 존재하면 skip (멱등). PHI 0 — DUMMY 만.
insert into public.clinics (id, name, slug)
  values (gen_random_uuid(), '종로 풋센터(DEV)', 'jongno-foot')
  on conflict (slug) do nothing;
-- 합성 DUMMY 고객 1 — is_simulation 으로 표기 (AC-2 전면 sim-flag 정합)
insert into public.customers (id, clinic_id, name, phone, visit_type, is_simulation)
  select gen_random_uuid(), c.id, 'DUMMY-DEV', '+821000000000', 'new', true
  from public.clinics c where c.slug='jongno-foot'
  on conflict do nothing;
SQL

echo "✅ [4/4] 완료. §1-α 번들-스모크 gate 는 아래로 검증:"
cat <<'GATE'
  # dev 브랜치 preview 번들 재빌드 후 (dev.obliv-foot-crm.pages.dev):
  #   grep A) dev DB ref ≥1 :  grep -rc "kcdqtyivtqcjmcrdjkqi" dist/assets/   # ≥1 GREEN
  #   grep B) prod DB ref =0 :  grep -rc "rxlomoozakkjesdqjtvd" dist/assets/   # =0  GREEN
  #   env-pair 매칭: origin(dev.obliv-foot-crm.pages.dev) ↔ ref(kcdqtyivtqcjmcrdjkqi)
GATE
echo "   두 grep GREEN + env-pair 매칭 확인 후에만 deploy-ready 보고 (배선 커밋만으론 미확증)."
