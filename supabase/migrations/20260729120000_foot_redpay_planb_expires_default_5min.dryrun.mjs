/**
 * DRY-RUN (No-Persistence): T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (TTL 축소 fold)
 *   20260729120000_foot_redpay_planb_expires_default_5min.sql
 *   (pending_payment.expires_at DEFAULT 10min → 5min 비파괴 값 조정)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip(top-level BEGIN;/COMMIT; 제거, sentinel-bypass 차단)
 *   ② plpgsql exception-handler(DO..EXECUTE..EXCEPTION) 무영속 실행
 *   ③ post-probe assertAbsent — dry-run 후 expires_at DEFAULT 에 '5 minutes'(00:05:00) 미영속 실측(INV-3).
 *      (무영속이면 DEFAULT 는 여전히 기존 '10 minutes'(00:10:00) → '5 minutes' 부재 = TRUE)
 *
 * 실행: (repo root) node supabase/migrations/20260729120000_foot_redpay_planb_expires_default_5min.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260729120000_foot_redpay_planb_expires_default_5min.sql');

// expires_at DEFAULT '5 minutes'(00:05:00) 미영속 실측 — dry-run 후 컬럼 DEFAULT 에 '00:05:00' 부재 = TRUE(absent).
// (interval '5 minutes' 는 pg_get_expr 에서 '00:05:00'::interval 로 표기됨)
const newDefaultAbsent = {
  label: "expires_at DEFAULT '5 minutes' on pending_payment (non-persistent)",
  sql: `SELECT NOT COALESCE(
          (SELECT pg_get_expr(d.adbin, d.adrelid)
             FROM pg_attrdef d
             JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE d.adrelid = 'public.pending_payment'::regclass
              AND a.attname = 'expires_at') ILIKE '%00:05:00%',
          FALSE) AS absent;`,
};

runDryrun({
  upPath: UP,
  assertAbsent: [ newDefaultAbsent ],
  passNote: "(expires_at DEFAULT 5분 값조정 무영속 검증 — dry-run 후 여전히 10분 DEFAULT)",
}).catch((e) => { console.error(e); process.exit(1); });
