/**
 * T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — archive-first APPLY (prod)
 *
 * ⚠️ GATE: DA CONSULT GO + 현장(김주연 총괄) 재confirm + supervisor DB-GATE 통과 전 실행 금지.
 *          provenance 상 대상행은 실 VAN카드 승인건과 auto_matched 된 실결제(중복 없음).
 *          파괴적 삭제이므로 게이트 없이는 --apply 하지 말 것.
 *
 * 동작(단일 원자 트랜잭션):
 *   1) archive 테이블 2종 생성(per-op unique):
 *      - _archive_f4741_cosmetic_0725_payment_20260801 (LIKE payments) : payment 본행 전컬럼 보존
 *      - _archive_f4741_cosmetic_0725_links_20260801 : SET NULL 자식 링크 원본(순소실0·가역)
 *   2) G-freeze/G-active/G-refs 재검증 → drift 시 RAISE(abort)
 *   3) archive INSERT (컬럼완전성 by-construction: LIKE + SELECT *)
 *   4) DELETE payment 1행 (SET NULL 자식 링크 자동 NULL) → rows-affected=1 & remaining=0 검증
 *
 * 실행:  node scripts/..._apply.mjs --apply    (플래그 없으면 no-op)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REF = 'rxlomoozakkjesdqjtvd';
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}

const TARGET_PAYMENT_ID = '30a9ac47-b90d-4ee7-b4f2-7b1861264afc';
const CUSTOMER_ID = '259abd32-d784-4c45-b59e-1ccae1b69492';
const ARCH_PAY = '_archive_f4741_cosmetic_0725_payment_20260801';
const ARCH_LINK = '_archive_f4741_cosmetic_0725_links_20260801';
const TICKET = 'T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE';

const APPLY = process.argv.includes('--apply');
if (!APPLY) {
  console.log('no-op: --apply 플래그 필요. (GATE: DA GO + 현장 재confirm + supervisor DB-GATE 선행)');
  process.exit(0);
}

const SQL = `
BEGIN;
-- 1) archive 테이블 (per-op unique, LIKE=컬럼완전성 by-construction / 제약 미상속)
CREATE TABLE IF NOT EXISTS public.${ARCH_PAY} (LIKE public.payments);
ALTER TABLE public.${ARCH_PAY}
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_ticket text;
CREATE TABLE IF NOT EXISTS public.${ARCH_LINK} (
  child_table text, child_id uuid, link_col text, orig_payment_id uuid,
  archived_at timestamptz DEFAULT now(), archived_ticket text
);
-- deny-all RLS (PHI 잔류 방어)
ALTER TABLE public.${ARCH_PAY} ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.${ARCH_LINK} ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE v_pay int; v_arch int; v_lnk int; v_remaining int;
        v_active int; v_cascade int; v_blocker int;
BEGIN
  -- [G-freeze/G-active] 대상 실재 + active + 속성 재검증
  SELECT count(*) INTO v_active FROM public.payments
   WHERE id='${TARGET_PAYMENT_ID}' AND customer_id='${CUSTOMER_ID}'
     AND accounting_date='2026-07-25' AND amount=10500 AND status='active'
     AND is_simulation=false AND check_in_id IS NULL AND service_charge_id IS NULL
     AND package_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.payment_items pi WHERE pi.payment_id='${TARGET_PAYMENT_ID}');
  IF v_active <> 1 THEN RAISE EXCEPTION 'G-freeze/active ABORT: 대상 속성 drift (matched=%)', v_active; END IF;

  -- [G-refs] CASCADE/blocker 자식 0 재검증 (SET NULL 2건만 허용)
  SELECT
    (SELECT count(*) FROM public.claim_diagnoses WHERE payment_id='${TARGET_PAYMENT_ID}')
   +(SELECT count(*) FROM public.payment_items WHERE payment_id='${TARGET_PAYMENT_ID}')
   INTO v_cascade;
  SELECT
    (SELECT count(*) FROM public.package_credit_ledger WHERE source_payment_id='${TARGET_PAYMENT_ID}')
   +(SELECT count(*) FROM public.payments WHERE parent_payment_id='${TARGET_PAYMENT_ID}')
   INTO v_blocker;
  IF v_cascade <> 0 THEN RAISE EXCEPTION 'G-refs ABORT: CASCADE child 발생 (%). archive 재설계 필요', v_cascade; END IF;
  IF v_blocker <> 0 THEN RAISE EXCEPTION 'G-refs ABORT: blocker child 발생 (%). re-anchor 필요', v_blocker; END IF;

  -- 3) archive: payment 본행 + SET NULL 링크원본
  INSERT INTO public.${ARCH_PAY} SELECT p.*, now(), '${TICKET}' FROM public.payments p WHERE p.id='${TARGET_PAYMENT_ID}';
  GET DIAGNOSTICS v_arch = ROW_COUNT;
  INSERT INTO public.${ARCH_LINK}(child_table, child_id, link_col, orig_payment_id, archived_ticket)
  SELECT 'redpay_raw_transactions', id, 'matched_payment_id', matched_payment_id, '${TICKET}'
    FROM public.redpay_raw_transactions WHERE matched_payment_id='${TARGET_PAYMENT_ID}'
  UNION ALL
  SELECT 'payment_reconciliation_log', id, 'payment_id', payment_id, '${TICKET}'
    FROM public.payment_reconciliation_log WHERE payment_id='${TARGET_PAYMENT_ID}';
  GET DIAGNOSTICS v_lnk = ROW_COUNT;
  IF v_arch <> 1 THEN RAISE EXCEPTION 'archive ABORT: payment archive=% (기대1)', v_arch; END IF;

  -- 4) DELETE 본행 (SET NULL 자식 링크 자동 NULL)
  DELETE FROM public.payments WHERE id='${TARGET_PAYMENT_ID}';
  GET DIAGNOSTICS v_pay = ROW_COUNT;
  SELECT count(*) INTO v_remaining FROM public.payments WHERE id='${TARGET_PAYMENT_ID}';
  IF v_pay <> 1 OR v_remaining <> 0 THEN
    RAISE EXCEPTION 'DELETE ABORT: deleted=% remaining=% (기대 1/0)', v_pay, v_remaining;
  END IF;

  RAISE NOTICE 'APPLY OK: archived_payment=% archived_links=% deleted=% remaining=%', v_arch, v_lnk, v_pay, v_remaining;
END $$;
COMMIT;
`;

runSQL(SQL)
  .then(async () => {
    // 사후 검증
    const rem = await runSQL(`select count(*)::int as n from public.payments where id='${TARGET_PAYMENT_ID}';`);
    const arch = await runSQL(`select count(*)::int as n from public.${ARCH_PAY};`);
    const lnk = await runSQL(`select count(*)::int as n from public.${ARCH_LINK};`);
    console.log(`APPLY 완료: remaining_payment=${rem?.[0]?.n} archived_payment=${arch?.[0]?.n} archived_links=${lnk?.[0]?.n}`);
    console.log('※ 롤백: scripts/..._rollback.sql');
  })
  .catch((e) => { console.error('APPLY 실패(트랜잭션 롤백됨):', e.message); process.exit(1); });
