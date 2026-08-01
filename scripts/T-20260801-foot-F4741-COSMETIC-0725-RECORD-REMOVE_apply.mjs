/**
 * T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — archive-first APPLY (prod)
 *
 * ★ REGRAIN 2026-08-01 (DA Branch A GO 조건부). 삭제대상 = check_in_services 풋화장품 7/25 3라인(73,000),
 *   부모 check_in fdd5c165(미접촉 불변식). 前 payments 30a9ac47 그레인 = RETRACT-AS-MOOT.
 *
 * ⚠️ 3중 GATE: DA GO(✅) + 총괄(김주연) 재confirm + supervisor MIG-GATE 통과 전 --apply 금지.
 *    (soft-void 컬럼 부재 확인 → 물리 archive-first 경로. §3.1 대표게이트 불요=DA Q4.)
 *
 * 동작(단일 원자 트랜잭션):
 *   1) archive 테이블 생성(per-op unique): _archive_f4741_cosmetic_0725_cis_20260801 (LIKE check_in_services) + deny-all RLS.
 *   2) G-freeze(rows=3·속성) + G-parent(미결제) + G-refs(child 0) + Branch-C 가드(a/b/c) 재검증 → drift 시 RAISE(abort).
 *   3) archive INSERT (LIKE + SELECT * = 컬럼완전성 by-construction) → count==3 검증.
 *   4) DELETE 3라인 → rows-affected==3 & remaining==0 검증 (net-loss 0).
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

const CUSTOMER_ID = '259abd32-d784-4c45-b59e-1ccae1b69492';
const PARENT_CHECKIN = 'fdd5c165-8375-470e-9b9d-cad851de93a6';
const CIS_IDS = ['eeb760b3-6931-4b57-b05f-979f7cc1287e', '08162a7a-aa4e-411f-9824-0f2044c9f8ff', 'a2dbbbfa-c890-4397-bbaf-4ddf205d383f'];
const SVC_IDS = ['89095450-223f-4863-89a9-c7f32f62809d', 'e17ba3a3-4842-4097-87bc-0778a64d2755', 'cb6443a3-fe53-40e7-bd51-a4444d8a8966'];
const TWIN_CIS = ['5104417a-4520-4e3b-8666-1e79f987e8e8', '37e32d58-91bd-4762-81ab-a2484f2a3bfd', '54d94955-7934-420b-bc02-6dd3904a3991'];
const GUARD_PAYMENT = 'b7ab6496-9efc-429c-9d5c-60a248eabc15';
const ARCH_CIS = '_archive_f4741_cosmetic_0725_cis_20260801';
const TICKET = 'T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE';
const L = (a) => a.map((x) => `'${x}'`).join(',');

const APPLY = process.argv.includes('--apply');
if (!APPLY) {
  console.log('no-op: --apply 플래그 필요. (3중 GATE: DA GO✅ + 총괄 재confirm + supervisor MIG-GATE 선행 / HOLD)');
  process.exit(0);
}

const SQL = `
BEGIN;
-- 1) archive 테이블 (per-op unique, LIKE=컬럼완전성 by-construction / 제약 미상속)
CREATE TABLE IF NOT EXISTS public.${ARCH_CIS} (LIKE public.check_in_services);
ALTER TABLE public.${ARCH_CIS}
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_ticket text;
ALTER TABLE public.${ARCH_CIS} ENABLE ROW LEVEL SECURITY;  -- deny-all (PHI-인접 잔류 방어)

DO $$
DECLARE v_arch int; v_del int; v_remaining int; v_freeze int; v_parent_pay int;
        v_childfk int; v_pi int; v_sc int; v_twin int; v_guard int;
BEGIN
  -- [G-freeze] 대상 3행 + 속성(금액합 73000·부모·no-pkg) 재검증
  SELECT count(*) INTO v_freeze FROM public.check_in_services
   WHERE id IN (${L(CIS_IDS)}) AND check_in_id='${PARENT_CHECKIN}'
     AND is_package_session=false AND package_session_id IS NULL;
  IF v_freeze <> 3 THEN RAISE EXCEPTION 'G-freeze ABORT: 대상 3행 drift (matched=%)', v_freeze; END IF;
  IF (SELECT coalesce(sum(price),0) FROM public.check_in_services WHERE id IN (${L(CIS_IDS)})) <> 73000
    THEN RAISE EXCEPTION 'G-freeze ABORT: 금액합≠73000'; END IF;

  -- [G-parent] 부모 check_in 미결제(payments=0)
  SELECT count(*) INTO v_parent_pay FROM public.payments WHERE check_in_id='${PARENT_CHECKIN}';
  IF v_parent_pay <> 0 THEN RAISE EXCEPTION 'Branch-C ABORT: 부모 check_in payment 존재 (%)', v_parent_pay; END IF;

  -- [G-refs / HARD#1] cis 3행 참조 자식 0 (선언 FK + 데이터-값 settlement)
  SELECT count(*) INTO v_childfk FROM pg_constraint con
    JOIN pg_class pcl ON pcl.oid=con.confrelid
   WHERE con.contype='f' AND pcl.relname='check_in_services' AND pcl.relnamespace='public'::regnamespace;
  SELECT count(*) INTO v_pi FROM public.payment_items WHERE check_in_id='${PARENT_CHECKIN}' AND service_id IN (${L(SVC_IDS)});
  SELECT count(*) INTO v_sc FROM public.service_charges WHERE check_in_id='${PARENT_CHECKIN}' AND service_id IN (${L(SVC_IDS)});
  IF v_childfk <> 0 THEN RAISE EXCEPTION 'HARD#1 ABORT: 선언 inbound FK 발생 (%). cascade archive 재설계', v_childfk; END IF;
  IF (v_pi + v_sc) <> 0 THEN RAISE EXCEPTION 'Branch-C(a) ABORT: payment/allocation 링크 취득 (pi=% sc=%)', v_pi, v_sc; END IF;

  -- [Branch-C(b),(c)] 8/1 twin셋 3 실재 + b7ab6496 73000 active
  SELECT count(*) INTO v_twin FROM public.check_in_services WHERE id IN (${L(TWIN_CIS)});
  SELECT count(*) INTO v_guard FROM public.payments WHERE id='${GUARD_PAYMENT}' AND amount=73000 AND status='active';
  IF v_twin <> 3 THEN RAISE EXCEPTION 'Branch-C(b) ABORT: 8/1 twin셋 부재 (%)', v_twin; END IF;
  IF v_guard <> 1 THEN RAISE EXCEPTION 'Branch-C(c) ABORT: b7ab6496(73000) 부재/불일치'; END IF;

  -- 3) archive INSERT (LIKE + SELECT *)
  INSERT INTO public.${ARCH_CIS} SELECT c.*, now(), '${TICKET}' FROM public.check_in_services c WHERE c.id IN (${L(CIS_IDS)});
  GET DIAGNOSTICS v_arch = ROW_COUNT;
  IF v_arch <> 3 THEN RAISE EXCEPTION 'archive ABORT: cis archive=% (기대3)', v_arch; END IF;

  -- 4) DELETE 3라인 (자식 0 → dangling 무)
  DELETE FROM public.check_in_services WHERE id IN (${L(CIS_IDS)});
  GET DIAGNOSTICS v_del = ROW_COUNT;
  SELECT count(*) INTO v_remaining FROM public.check_in_services WHERE id IN (${L(CIS_IDS)});
  IF v_del <> 3 OR v_remaining <> 0 THEN
    RAISE EXCEPTION 'DELETE ABORT: deleted=% remaining=% (기대 3/0)', v_del, v_remaining;
  END IF;

  RAISE NOTICE 'APPLY OK: archived=% deleted=% remaining=% (net-loss 0)', v_arch, v_del, v_remaining;
END $$;
COMMIT;
`;

runSQL(SQL)
  .then(async () => {
    const rem = await runSQL(`select count(*)::int as n from public.check_in_services where id in (${L(CIS_IDS)});`);
    const arch = await runSQL(`select count(*)::int as n from public.${ARCH_CIS};`);
    console.log(`APPLY 완료: remaining_cis=${rem?.[0]?.n} (기대0) archived_cis=${arch?.[0]?.n} (기대3)`);
    console.log('※ 롤백: scripts/..._rollback.sql (archive → 원 테이블 복원)');
  })
  .catch((e) => { console.error('APPLY 실패(트랜잭션 롤백됨):', e.message); process.exit(1); });
