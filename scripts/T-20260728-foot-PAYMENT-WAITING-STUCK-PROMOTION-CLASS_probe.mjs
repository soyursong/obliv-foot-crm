/**
 * T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS — DIAGNOSTIC PROBE (READ-ONLY, prod write 0)
 *
 * 목적 (AC1/AC2/AC4):
 *  - foot check_ins.status='payment_waiting' 전수 열거
 *  - DA GO_WARN §1-D 버킷 분해:
 *      (a) 정정대상: 동일자 reconciled payment 존재 + checked_in date < today (승격 안전)
 *      (b) 정상대기: payment 무/취소/노쇼/refund → 승격 시 가짜완료 날조 → EXCLUDE
 *  - per-row 판정근거 스냅샷(payments·status_transitions·customer)
 *  - 8명 실고객(엘런·양재경·정성호·현은호·장선영·박경수·강성민·조재훈) orphan-pay ∩ same-day payment_waiting 교집합 재확인
 *
 * 안전: 오직 SELECT (service_role REST). UPDATE/INSERT/DELETE 없음. prod write 0.
 *       apply(백필)는 별도 _apply.mjs (supervisor DB 게이트 + freeze 재검증 後).
 *
 * 근거 문서: agents/docs/data_correction_backfill_sop.md (§0-2 소스, §1-D 버킷, §2 지문, §3 안전4종)
 *            티켓 frontmatter risk_reason (DA CONSULT-REPLY MSG-8fb8 Q3)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// --- env ---
function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const TZ = 'Asia/Seoul';
// KST 'YYYY-MM-DD' from a timestamptz
function kstDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  // KST = UTC+9
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}
function kstTodayStr() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}

const out = {
  ticket: 'T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS',
  generated_at: new Date().toISOString(),
  kst_today: kstTodayStr(),
  schema: {},
  total_payment_waiting: 0,
  bucket_a_promotable: [],
  bucket_a_test_excluded: [],  // 이름/플래그상 테스트 계정 (승격 조건 충족하나 apply 제외 — §2-F under-correct)
  bucket_b_exclude: [],
  named_customers_crosscheck: {},
  freeze_pk_bucket_a: [],
};
const log = (...a) => console.log(...a);

async function tableColumns(table) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return { error: error.message, cols: null };
  return { error: null, cols: data && data[0] ? Object.keys(data[0]) : [] };
}

// external/reconciled payment 판정 (하드닝): 취소·환불·음수·void·soft-delete·simulation 제외
//  - prod 실측 payments.status 분포 = {active, deleted}. 'deleted'(+deleted_at)는 정정근거 될 수 없음.
//  - is_simulation=true(테스트/샌드박스 결제) 제외 (T-20260731-foot-TESTPAY-SANDBOX-EXCLUDE 정합).
function isPositiveReconciledPayment(p) {
  const amt = Number(p.amount ?? p.paid_amount ?? p.total_amount ?? 0);
  const status = (p.status ?? '').toLowerCase();
  const badStatus = ['cancelled', 'canceled', 'void', 'voided', 'refunded', 'refund', 'reversed', 'failed', 'deleted'];
  if (p.deleted_at) return false;              // soft-delete 결제 = 정정근거 무효
  if (p.is_simulation === true) return false;  // 시뮬레이션/테스트 결제 제외
  if (badStatus.includes(status)) return false;
  if (amt <= 0) return false;                  // 환불(음수)·0원 제외
  return true;
}

async function main() {
  // ── [0] 스키마 introspection ──
  log('── [0] check_ins / payments 스키마 introspection ──');
  const ci = await tableColumns('check_ins');
  const pay = await tableColumns('payments');
  out.schema.check_ins_cols = ci.cols;
  out.schema.payments_cols = pay.cols;
  out.schema.check_ins_has_completed_at = ci.cols?.includes('completed_at') ?? false;
  out.schema.check_ins_has_updated_at = ci.cols?.includes('updated_at') ?? false;
  log('  check_ins cols:', ci.cols?.join(', '));
  log('  payments cols :', pay.cols?.join(', '));
  log('  completed_at 존재:', out.schema.check_ins_has_completed_at);

  const PAY_AMT_COL = ['amount', 'paid_amount', 'total_amount'].find((c) => pay.cols?.includes(c)) ?? 'amount';
  const PAY_DATE_COL = ['paid_at', 'created_at', 'payment_date'].find((c) => pay.cols?.includes(c)) ?? 'created_at';
  out.schema.pay_amount_col = PAY_AMT_COL;
  out.schema.pay_date_col = PAY_DATE_COL;

  // ── [1] payment_waiting 전수 ──
  log('── [1] check_ins.status=payment_waiting 전수 ──');
  const { data: waits, error: wErr } = await db
    .from('check_ins')
    .select('*')
    .eq('status', 'payment_waiting')
    .order('checked_in_at', { ascending: true });
  if (wErr) { console.error('❌ check_ins query:', wErr.message); process.exit(1); }
  out.total_payment_waiting = waits.length;
  log(`  총 ${waits.length}건`);

  const today = kstTodayStr();

  for (const w of waits) {
    const ciDate = kstDate(w.checked_in_at);
    const custId = w.customer_id;

    // customer 스냅샷
    let cust = null;
    if (custId) {
      const { data: cd } = await db.from('customers').select('id,name,chart_number,visit_type,phone,is_simulation').eq('id', custId).maybeSingle();
      cust = cd ?? null;
    }
    const isTestCustomer = (cust?.is_simulation === true) || /테스트|test|더미|dummy|샘플|sample/i.test(cust?.name ?? '');

    // 이 check_in 에 직접 귀속된 payments
    const { data: linkedPays } = await db.from('payments').select('*').eq('check_in_id', w.id);
    // 동일 고객 · 동일자(checked_in date) payments (orphan-pay: check_in_id NULL 포함)
    let sameDayPays = [];
    if (custId && ciDate) {
      const { data: cp } = await db.from('payments').select('*').eq('customer_id', custId);
      sameDayPays = (cp ?? []).filter((p) => kstDate(p[PAY_DATE_COL]) === ciDate);
    }

    // 정정판정: linked positive payment 우선, 없으면 same-day orphan positive
    const linkedPositive = (linkedPays ?? []).filter(isPositiveReconciledPayment);
    const sameDayPositive = sameDayPays.filter(isPositiveReconciledPayment);
    const hasReconciled = linkedPositive.length > 0 || sameDayPositive.length > 0;
    const isPast = ciDate && ciDate < today; // 당일 정체는 정상 진행중일 수 있음 → 제외

    const paySnap = (linkedPositive.length ? linkedPositive : sameDayPositive).map((p) => ({
      id: p.id, check_in_id: p.check_in_id, amount: Number(p[PAY_AMT_COL] ?? 0),
      method: p.method ?? p.payment_method ?? null, status: p.status ?? null,
      external_status: p.external_status ?? null, reconciled_at: p.reconciled_at ?? null,
      is_simulation: p.is_simulation ?? null, deleted_at: p.deleted_at ?? null,
      paid_at: p[PAY_DATE_COL], pay_date_kst: kstDate(p[PAY_DATE_COL]),
    }));

    const row = {
      check_in_id: w.id,
      clinic_id: w.clinic_id,
      customer_id: custId,
      customer_name: cust?.name ?? null,
      chart_number: cust?.chart_number ?? null,
      customer_visit_type: cust?.visit_type ?? null,
      checked_in_at: w.checked_in_at,
      checked_in_date_kst: ciDate,
      updated_at: w.updated_at ?? null,
      completed_at_current: w.completed_at ?? null,
      linked_payment_count: (linkedPays ?? []).length,
      linked_positive_count: linkedPositive.length,
      sameday_payment_count: sameDayPays.length,
      sameday_positive_count: sameDayPositive.length,
      has_reconciled_positive: hasReconciled,
      is_past_day: isPast,
      payments_evidence: paySnap,
      // completed_at 교정값: 최우선 = reconciled payment일, 폴백 = checked_in_at (DA: payment일/checked_in_at 기준)
      completed_at_corrected: paySnap.length ? paySnap[paySnap.length - 1].paid_at : w.checked_in_at,
    };

    if (hasReconciled && isPast && isTestCustomer) {
      row.test_flag = cust?.is_simulation === true ? 'is_simulation' : 'name_pattern';
      out.bucket_a_test_excluded.push(row);
    } else if (hasReconciled && isPast) {
      out.bucket_a_promotable.push(row);
      out.freeze_pk_bucket_a.push({ check_in_id: w.id, expected_status: 'payment_waiting', completed_at_corrected: row.completed_at_corrected });
    } else {
      row.exclude_reason = !hasReconciled
        ? 'no_reconciled_positive_payment (미수/취소/노쇼/환불 → 승격 시 가짜완료 날조)'
        : 'checked_in today (당일 정상 진행중 가능 → 정체 미확정)';
      out.bucket_b_exclude.push(row);
    }
  }

  // ── [2] 8명 실고객 crosscheck ──
  const NAMED = ['엘런', '양재경', '정성호', '현은호', '장선영', '박경수', '강성민', '조재훈'];
  for (const nm of NAMED) {
    const inA = out.bucket_a_promotable.filter((r) => r.customer_name === nm);
    const inB = out.bucket_b_exclude.filter((r) => r.customer_name === nm);
    out.named_customers_crosscheck[nm] = {
      in_bucket_a: inA.map((r) => ({ check_in_id: r.check_in_id, date: r.checked_in_date_kst, visit_type: r.customer_visit_type })),
      in_bucket_b: inB.map((r) => ({ check_in_id: r.check_in_id, date: r.checked_in_date_kst, reason: r.exclude_reason })),
    };
  }

  // ── 요약 ──
  log('\n════════ 요약 ════════');
  log(`총 payment_waiting        : ${out.total_payment_waiting}`);
  log(`(a) 정정대상(승격 안전)   : ${out.bucket_a_promotable.length}`);
  log(`(a-test) 테스트계정 제외  : ${out.bucket_a_test_excluded.length}  [${out.bucket_a_test_excluded.map((r) => r.customer_name).join(', ')}]`);
  log(`(b) 정상대기(EXCLUDE)     : ${out.bucket_b_exclude.length}`);
  log(`completed_at 컬럼 존재    : ${out.schema.check_ins_has_completed_at}`);
  log('\n[8명 crosscheck]');
  for (const nm of NAMED) {
    const c = out.named_customers_crosscheck[nm];
    log(`  ${nm}: a=${c.in_bucket_a.length} b=${c.in_bucket_b.length}`);
  }

  const outFile = `db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_probe_evidence.json`;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  log(`\n📄 evidence → ${outFile}`);
  // freeze셋 별도 파일(apply 재사용)
  fs.writeFileSync(
    `db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_freeze.json`,
    JSON.stringify({ generated_at: out.generated_at, kst_today: out.kst_today, freeze: out.freeze_pk_bucket_a }, null, 2)
  );
  log(`📄 freeze → db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_freeze.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
