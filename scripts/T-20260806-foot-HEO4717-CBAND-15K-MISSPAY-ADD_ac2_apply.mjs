/**
 * T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD — AC-2 APPLY RUNNER
 *   현은호(F-4717) "케어 토어 밴드" 15,000 카드 결제 누락분 사후기록(payments INSERT 1건).
 *
 * ── comp-gate RESOLVED (김주연 총괄, thread 1785980401.321779) ──
 *   고객 F-4717 / 케어토어밴드(service e17ba3a3, 정가 15,000) / 15,000원 실수금 완료 /
 *   결제일 2026-07-28(방문 당일) / 결제수단 카드.
 *
 * ── write target (DA CONSULT-REPLY MSG-20260806-102803-0uof) ──
 *   payments INSERT — recordManualPayment 'checkin' 라우트 페이로드와 동형.
 *   package_id=NULL(CTB=비패키지 소매) · method=card · created_at=결제일(07-28 KST) ·
 *   pg_provider=external/manual → external_* 전부 NULL(VAN raw 승격 HARD REJECT, orphan 아님).
 *   check_in_id=c33dfc76(07-28 done returning)로 bind → orphan payment 회피(gate plan verify-gate).
 *
 * ── AC-2 SOP 봉투 (Cross-CRM Data-Correction Backfill SOP) ──
 *   · target-set freeze + freeze 재검증 abort  (txn 내 RAISE EXCEPTION on drift)
 *   · 단일 트랜잭션 · rows-affected=1  (RETURNING INTO 검증)
 *   · service_role 컨텍스트 (Management API /database/query)
 *   · 롤백 SQL 동봉 (아래 ROLLBACK_SQL — 추가행 hard-DELETE by id, guarded)
 *   · 판정근거 스냅샷: AC-0 census + AC-2 reverify (별도 파일)
 *
 * ── 실행 모드 ──
 *   node ..._ac2_apply.mjs            → DRY-RUN (무영속, 강제 ROLLBACK, POSTCHECK 반환). 기본.
 *   node ..._ac2_apply.mjs --apply    → APPLY   (COMMIT). supervisor AC-5 GO 후에만.
 *
 * 인증 컨텍스트: Supabase Management API(/database/query, SUPABASE_ACCESS_TOKEN) = service_role 상당, RLS 미적용.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOK) { throw new Error('SUPABASE_ACCESS_TOKEN 필요'); }

const APPLY = process.argv.includes('--apply');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, text: t };
}
const j = (x) => JSON.stringify(x, null, 2);

// ── 확정 상수 (comp-gate + AC-0/AC-2 reverify) ──
const CID = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';   // 현은호 F-4717
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 종로 풋
const CI = 'c33dfc76-cda5-48e6-9b34-277281b26626';     // 07-28 done returning check_in
const AMOUNT = 15000;
const METHOD = 'card';
const CREATED_AT = '2026-07-28 03:00:00+00';           // = 2026-07-28 12:00 KST (07-28 KST 확정, 명확 mid-day)
const MEMO = '케어토어밴드(케어 토어 밴드) 15,000 카드 — 결제 누락 사후기록. '
  + 'T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD · 김주연 총괄 comp-gate confirm 2026-08-06 · '
  + 'VAN 미매칭(external/manual · pg 미결속)';

// ── freeze 재검증 + 단일 txn INSERT + POSTCHECK (plpgsql DO 블록) ──
//   DRY-RUN: 마지막에 RAISE EXCEPTION 'DRYRUN_OK ...' → 무영속 강제 ROLLBACK + 숫자 error text 반환.
//   APPLY  : RAISE NOTICE 로 종료 → 블록 정상 COMMIT. 이후 별도 POSTCHECK SELECT.
function buildDo(dryrun) {
  const finalRaise = dryrun
    ? `RAISE EXCEPTION 'DRYRUN_OK new_id=% before=% after=% delta=% dupe15k=% ci_bind=%', v_new, v_before, v_after, (v_after - v_before), v_cnt, v_ci;`
    : `RAISE NOTICE 'APPLY_OK new_id=% before=% after=% delta=% dupe15k=%', v_new, v_before, v_after, (v_after - v_before), v_cnt;`;
  return `
DO $$
DECLARE
  v_dupe int; v_ci uuid; v_new uuid; v_before bigint; v_after bigint; v_cnt int; v_rows int;
BEGIN
  -- (freeze 재검증 #1) F-4717 15,000 active payment = 0 이어야 착수. 아니면 ABORT(이미 기록/drift).
  SELECT count(*) INTO v_dupe FROM payments
    WHERE customer_id = '${CID}' AND amount = ${AMOUNT}
      AND status = 'active' AND deleted_at IS NULL AND cancelled_at IS NULL;
  IF v_dupe <> 0 THEN
    RAISE EXCEPTION 'FREEZE_ABORT: F-4717 amount=15000 active payment already exists (count=%). no-op.', v_dupe;
  END IF;

  -- (freeze 재검증 #2) bind check_in c33dfc76 실재 + F-4717 귀속 + done.
  SELECT id INTO v_ci FROM check_ins
    WHERE id = '${CI}' AND customer_id = '${CID}' AND clinic_id = '${CLINIC}';
  IF v_ci IS NULL THEN
    RAISE EXCEPTION 'FREEZE_ABORT: bind check_in c33dfc76 not found for F-4717.';
  END IF;

  -- BEFORE: 07-28 KST clinic single-payment 순매출(v_daily_revenue single leg 동일 산식)
  SELECT COALESCE(sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END), 0) INTO v_before
    FROM payments
    WHERE clinic_id = '${CLINIC}' AND status = 'active'
      AND (created_at AT TIME ZONE 'Asia/Seoul')::date = DATE '2026-07-28';

  -- INSERT (recordManualPayment 'checkin' 라우트 페이로드 동형 · 단일행 · rows-affected=1)
  INSERT INTO payments
    (clinic_id, check_in_id, customer_id, amount, method, installment, payment_type, memo, created_at)
  VALUES
    ('${CLINIC}', '${CI}', '${CID}', ${AMOUNT}, '${METHOD}', 0, 'payment', ${MEMO_SQL()}, '${CREATED_AT}')
  RETURNING id INTO v_new;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ROWCHECK_ABORT: expected rows-affected=1, got %.', v_rows;
  END IF;

  -- AFTER: 동일 산식 재계산 (delta 는 +15000 exactly 이어야)
  SELECT COALESCE(sum(CASE WHEN payment_type='refund' THEN -amount ELSE amount END), 0) INTO v_after
    FROM payments
    WHERE clinic_id = '${CLINIC}' AND status = 'active'
      AND (created_at AT TIME ZONE 'Asia/Seoul')::date = DATE '2026-07-28';

  -- POSTCHECK: delta 정확히 +15000, dupe15k 정확히 1
  IF (v_after - v_before) <> ${AMOUNT} THEN
    RAISE EXCEPTION 'POSTCHECK_ABORT: 07-28 delta expected +15000, got %.', (v_after - v_before);
  END IF;
  SELECT count(*) INTO v_cnt FROM payments
    WHERE customer_id = '${CID}' AND amount = ${AMOUNT} AND status = 'active' AND deleted_at IS NULL;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'POSTCHECK_ABORT: F-4717 15000 count expected 1, got %.', v_cnt;
  END IF;

  ${finalRaise}
END $$;`;
}
// memo 안전 인용(작은따옴표 이스케이프) — SQL 리터럴 주입 방지
function MEMO_SQL() { return `'${MEMO.replace(/'/g, "''")}'`; }

console.log(`════════ AC-2 ${APPLY ? 'APPLY (COMMIT)' : 'DRY-RUN (무영속)'} ════════`);
console.log(`  대상: F-4717(${CID}) · CTB 15,000 card · created_at=${CREATED_AT}(07-28 KST) · bind ci=${CI}`);
console.log(`  package_id=NULL · external_*=NULL(external/manual) · status=active(default) · is_simulation=false(default)\n`);

const res = await q(buildDo(!APPLY));
console.log(`HTTP ${res.status}`);
console.log(res.text);

if (!APPLY) {
  // DRY-RUN: DRYRUN_OK error text 파싱 → 무영속 확인
  if (res.text.includes('DRYRUN_OK')) {
    console.log('\n✅ DRY-RUN PASS (무영속 ROLLBACK). 위 error text 의 delta=15000 · dupe15k=1 확인.');
  } else if (res.text.includes('FREEZE_ABORT') || res.text.includes('POSTCHECK_ABORT') || res.text.includes('ROWCHECK_ABORT')) {
    console.log('\n⛔ DRY-RUN ABORT — 위 사유 확인. INSERT 착수 금지.');
  } else {
    console.log('\n⚠ 예상 밖 응답 — 검토 필요.');
  }
  // 무영속 재확인(post-probe): 여전히 0건이어야
  const probe = await q(`SELECT count(*)::int AS c FROM payments WHERE customer_id='${CID}' AND amount=${AMOUNT} AND status='active' AND deleted_at IS NULL`);
  console.log('\n── post-probe (무영속 재확인, 여전히 0 이어야) ──'); console.log(probe.text);
} else {
  // APPLY: 커밋 후 독립 POSTCHECK SELECT
  const post = await q(`
    SELECT id, check_in_id, customer_id, amount, method, payment_type, status, is_simulation,
           package_id, external_approval_no, external_trxid, created_at,
           (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date, memo
    FROM payments WHERE customer_id='${CID}' AND amount=${AMOUNT} AND status='active' AND deleted_at IS NULL`);
  console.log('\n── APPLY POSTCHECK: 신규 payment 행 ──'); console.log(post.text);
  const rev = await q(`SELECT dt, clinic_id, single_revenue, package_revenue, net_revenue FROM v_daily_revenue WHERE dt=DATE '2026-07-28' AND clinic_id='${CLINIC}'`);
  console.log('\n── APPLY POSTCHECK: v_daily_revenue[2026-07-28] ──'); console.log(rev.text);
  console.log('\n롤백 SQL(필요시):');
  console.log(`  DELETE FROM payments WHERE customer_id='${CID}' AND amount=${AMOUNT} AND check_in_id='${CI}' AND memo LIKE '케어토어밴드%누락 사후기록%';`);
}
