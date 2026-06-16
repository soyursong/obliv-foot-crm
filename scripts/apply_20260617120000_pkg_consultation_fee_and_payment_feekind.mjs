/**
 * T-20260616-foot-PKG-OUTSTANDING-BALANCE
 * ADDITIVE: packages.consultation_fee (INTEGER NOT NULL DEFAULT 0)
 *         + package_payments.fee_kind (TEXT NOT NULL DEFAULT 'package' CHECK in package/consultation)
 *
 * 비파괴: ADD COLUMN IF NOT EXISTS + DEFAULT → 기존 행 backfill-safe, 멱등(재실행 no-op).
 * data-architect CONSULT GO (2026-06-16). rollback = DROP COLUMN (.rollback.sql).
 *
 * 실행: SUPABASE_ACCESS_TOKEN=xxx node scripts/apply_20260617120000_pkg_consultation_fee_and_payment_feekind.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

async function runQuery(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

// 사전 probe: 기존 컬럼 충돌 없음 확인(이미 있으면 IF NOT EXISTS 로 no-op).
const SQL_PROBE = `
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='packages' AND column_name='consultation_fee') AS has_consultation_fee,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='package_payments' AND column_name='fee_kind') AS has_fee_kind,
  (SELECT count(*) FROM public.package_payments) AS existing_payment_rows;
`;

const SQL_APPLY = `
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS consultation_fee INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.packages.consultation_fee IS '진료비 금액(패키지 금액 total_amount 과 별도, 합산 단일표기 금지). NOT NULL DEFAULT 0. T-20260616-foot-PKG-OUTSTANDING-BALANCE';

ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS fee_kind TEXT NOT NULL DEFAULT 'package';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_payments_fee_kind_check'
      AND conrelid = 'public.package_payments'::regclass
  ) THEN
    ALTER TABLE public.package_payments
      ADD CONSTRAINT package_payments_fee_kind_check
      CHECK (fee_kind IN ('package','consultation'));
  END IF;
END $$;
COMMENT ON COLUMN public.package_payments.fee_kind IS '결제 귀속: package(패키지 결제) / consultation(진료비 결제). 기존 행=package backfill. T-20260616-foot-PKG-OUTSTANDING-BALANCE';
`;

const SQL_VERIFY = `
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='packages' AND column_name='consultation_fee') AS consultation_fee_ok,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='package_payments' AND column_name='fee_kind') AS fee_kind_ok,
  (SELECT count(*) FROM pg_constraint
     WHERE conname='package_payments_fee_kind_check'
       AND conrelid='public.package_payments'::regclass) AS check_ok,
  (SELECT count(*) FROM public.package_payments WHERE fee_kind <> 'package') AS nonpackage_backfill_rows;
`;

async function main() {
  console.log('· probe...');
  console.log(JSON.stringify(await runQuery(SQL_PROBE, 'probe'), null, 2));

  console.log('· apply...');
  await runQuery(SQL_APPLY, 'apply');

  console.log('· verify...');
  const v = await runQuery(SQL_VERIFY, 'verify');
  console.log(JSON.stringify(v, null, 2));

  const row = Array.isArray(v) ? v[0] : v?.[0];
  if (row && row.consultation_fee_ok === 1 && row.fee_kind_ok === 1 && row.check_ok === 1 && row.nonpackage_backfill_rows === 0) {
    console.log('✅ PKG-OUTSTANDING migration applied & verified (existing payments backfilled to fee_kind=package).');
  } else {
    console.error('⚠ verify mismatch — 수동 점검 필요:', row);
    process.exit(2);
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
