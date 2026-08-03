/**
 * cband/supabaseAttemptStore.ts — cband_payment_attempts / payments 채널쓰기 실 저장소
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · 실 DB store)
 *   SSOT = memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_cband_cat_direct_pay_3way_canon_20260731.md
 *   verdict = GO_ADDITIVE_WITH_CORRECTIONS (DA-20260731-FOOT-CBAND-CAT-3WAY-CANON, zpas)
 *
 * paymentFlow.ts 의 AttemptStore 인터페이스를 supabase 로 구현한다.
 *
 * ── ★ 3-way CANON 저장레이아웃 (external_* 착지 · dead-column-free, K1~K7) ─────────
 *   LIVE prod introspection(ref rxlomoozakkjesdqjtvd, 2026-07-31) 확정:
 *     · payments 실컬럼 = external_approval_no / external_tid / external_trxid / accounting_date /
 *       is_simulation / method … 존재.  **pos_provider / pos_transaction_id / pos_response = 부재(dead)** ·
 *       pg_* 부재.  → 구 commit(66b8ca27/c2199d0f)의 pos_* write 는 dead-column 참조(런타임 오류) → 폐기.
 *   K1 payment write:
 *     · AUTHNO → payments.external_approval_no  (matcher 674/693/697 독출 = dedup 앵커)
 *     · TID    → payments.external_tid          (matcher 독출 = dedup 앵커) + attempt.cat_tid(원본)
 *     · 채널='cband' 판별자 → payments.payment_attempt_id(FK, NOT NULL) = CAT-origin (provider 컬럼 신설/부활 안 함)
 *     · external_trxid 는 **절대 write 금지 = RedPay 예약키**(Coban 이 채우면 reconcile 오링크).
 *     · BINDING#3 매출일자 앵커 = 승인일자(TRANDATE) → payments.accounting_date(INSERT/감지시각 금지).
 *   K2 raw 응답 → cband_payment_attempts.raw_response(정규화·PCI 가드) — payments 미착지.
 *   K5 cross-path = ③ DEDUP(격리 아님): external_approval_no+external_tid+payment_attempt_id 를 payments INSERT 와
 *     함께 채워 매칭 pool 정상 편입 → RedPay 피드행 R 도착 시 매처가 R↔P 매칭·reconciled_at set·P2 INSERT skip(흡수).
 *   멱등(§5): insert-first UNIQUE(clinic_id,msg_trace)[L1] + payments.payment_attempt_id partial UNIQUE[L2, 이중수납 2차방어]
 *     + catClient 앱뮤텍스[L3]. 승인 성공 시 rows-affected assert(cross_crm_write_rowcheck INV-W2/W5).
 *   C5 취소(0430) = foot 기존 refund 경로 계승(payment_type='refund', method='card', external_* 동일착지, payment_attempt_id).
 *   C6 테스트금액(1001~1006) = is_simulation=true(attempt·payments 패리티, 매출/감사 제외).
 *
 * ── ★ DDL 게이트 (data policy §S2.4) ─────────────────────────────────────────
 *   순 DDL(ADDITIVE) = 신규테이블 cband_payment_attempts 1개(mig 20260731190000, raw_response+PCI가드+is_simulation trg) +
 *     payments.payment_attempt_id FK(+partial UNIQUE)(mig 20260731190500) + 선택 payments.merchant_no. pos_* · pg_* 무접촉.
 *   기능플래그(VITE_CBAND_PAY) OFF 로 격리 → DDL 적용·MIG-GATE 통과 전 런타임 미도달(프로덕션 무접점).
 */

import { supabase } from '@/lib/supabase';
import { CbandConcurrentPaymentError, type AttemptRecord, type AttemptStore, type OpenPaymentProbe } from './paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL } from './protocol';

/**
 * ★3-way canon: 코밴 CAT 결제의 채널 식별은 provider 컬럼이 아니라 **payments.payment_attempt_id IS NOT NULL**(FK)로 한다.
 *   (LIVE prod 에 pos_provider/pg_provider 컬럼 부재 = dead-column. 부활 금지.)
 *   판독기/UI/refund 렌더는 이 술어를 CAT-origin 판별자로 소비한다.
 */
export const CBAND_ORIGIN_DISCRIMINATOR = 'payment_attempt_id IS NOT NULL' as const;

/** TRANDATE(YYMMDD) → ISO date(YYYY-MM-DD). 파싱 실패 시 null(트리거 default 유지). */
function yymmddToISODate(yymmdd: string | null | undefined): string | null {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** postgres unique_violation(23505) 판별 — 중복 승인콜백(멱등 skip) 식별. */
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '');
}

export const supabaseAttemptStore: AttemptStore = {
  async insertAttempt(rec: AttemptRecord): Promise<{ id: string }> {
    // ★insert-first: 송신 전 저장. UNIQUE(clinic_id,msg_trace) 위반(중복) 시 error → 상위가 송신 중단(멱등 L1).
    //   C4: .select('id') 로 RETURNING → 0-row+error=null(RLS 거부 등) 도 silent write-failure 로 승격.
    //   취소(0430)는 원거래 AUTHNO 를 auth_no 로 insert-time 저장(실측#2: 취소 AUTHNO=원거래 동일, tran_type 으로만 구분).
    //   ★반환된 attempt.id = 승인 성공 시 payments.payment_attempt_id(FK, CAT-origin 판별자)로 착지.
    const isCancel = rec.tranType === TRANTYPE_CANCEL;
    const { data, error } = await supabase
      .from('cband_payment_attempts')
      .insert({
        clinic_id: rec.clinicId,
        check_in_id: rec.checkInId,
        customer_id: rec.customerId,
        msg_trace: rec.msgTrace,
        merno: rec.merno,
        tran_type: rec.tranType,
        cat_tid: rec.tid,
        requested_amount: rec.amount,
        status: 'requested',
        auth_no: isCancel ? rec.originalAuthNo : null,
        is_simulation: rec.isSimulation,
      })
      .select('id');
    if (error) {
      // ★AC-6-1 동시성 잠금: L2 partial UNIQUE(clinic_id, check_in_id) WHERE status='requested' 위반(23505)
      //   = 동일 환자 in-flight 존재(두 실장 다른 PC 동시결제) → CbandConcurrentPaymentError 로 승격.
      //   runPaymentFlow 가 잡아 송신하지 않고 '확인 필요' 정지(과금 0). L1(msg_trace) 충돌도 동일 안전처리(송신 금지).
      if (isUniqueViolation(error)) {
        throw new CbandConcurrentPaymentError('patient_in_progress', `이미 진행 중인 결제가 있습니다(insert-first 잠금): ${error.message}`);
      }
      throw new Error(`결제 시도 기록 실패(insert-first): ${error.message}`);
    }
    const attemptId = data?.[0]?.id as string | undefined;
    if (!attemptId) {
      // 0-row + error=null = RLS 거부/스코프 불일치(INV-W2). 추적 불가 상태로 과금 금지 → 송신 중단.
      throw new Error('결제 시도 기록 실패(insert-first): 0행 반영(권한/스코프 확인 필요).');
    }
    return { id: attemptId };
  },

  async updateAttempt(msgTrace: string, patch: Partial<AttemptRecord>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.authNo !== undefined) row.auth_no = patch.authNo;
    if (patch.responseCode !== undefined) row.response_code = patch.responseCode;
    // ★K2: raw(정규화·PCI-safe) 를 raw_response(jsonb)에 보존. DB BEFORE INSERT/UPDATE PCI 가드가 2차 방어.
    if (patch.rawResponse !== undefined) row.raw_response = patch.rawResponse;
    const { error } = await supabase
      .from('cband_payment_attempts')
      .update(row)
      .eq('msg_trace', msgTrace);
    if (error) {
      // 상태 갱신 실패는 결제 성립을 되돌리지 않는다(insert-first 레코드가 이미 추적 근거). 로그만.
      console.error(`결제 시도 상태 갱신 실패(msg_trace=${msgTrace}):`, error.message);
    }
  },

  async recordCardPayment(rec: AttemptRecord & { authNo: string; attemptId: string }): Promise<void> {
    const isCancel = rec.tranType === TRANTYPE_CANCEL;
    // ★K1(3-way canon, external_* 착지 · dead-column-free):
    //   external_approval_no=AUTHNO · external_tid=TID · payment_attempt_id=attemptId(FK, CAT-origin 판별자) · merchant_no=MERNO(§9 필수).
    //   pos_provider/pos_transaction_id 는 prod 부재(dead) → write 금지. external_trxid 는 NULL 유지(RedPay 예약키).
    //   C5 취소 성공 = 수납취소(payment_type='refund', 기존 규약 계승 — 신규 refund 모델 발명 금지).
    //   ★K5 ③ DEDUP: external_approval_no+external_tid+payment_attempt_id 를 payments INSERT 와 함께 원자 write →
    //     매칭 pool(reconciled_at NULL ∧ external_trxid NULL) 정상 편입 → RedPay 피드행 R 도착 시 매처가 흡수(P2 skip).
    //     선행/별도 statement 금지(transient window 회피 — 단일 INSERT 에 3필드 동시 착지).
    //   ★L2 멱등 2차방어: payments.payment_attempt_id partial UNIQUE — 중복 승인콜백 INSERT = 23505 → 멱등 skip(이중수납 차단).
    //   C4: .select('id') 로 rows-affected assert(silent write-failure 금지).
    const { data, error } = await supabase
      .from('payments')
      .insert({
        clinic_id: rec.clinicId,
        check_in_id: rec.checkInId,
        customer_id: rec.customerId,
        amount: rec.amount,
        method: 'card',
        installment: 0,
        payment_type: isCancel ? 'refund' : 'payment',
        external_approval_no: rec.authNo,     // ★K1 AUTHNO canonical home(LIVE·matcher 독출=dedup 앵커).
        external_tid: rec.tid,                // ★K1 TID(LIVE·matcher 독출=dedup 앵커).
        merchant_no: rec.merno,               // ★§9 MERNO 저장 필수(총괄) — mig190500 착지 컬럼에 값-write(ADDITIVE·DDL무변). A11/A12 MERNO 대사 조인 + DEDUP(K5) MERNO 축.
        payment_attempt_id: rec.attemptId,    // ★K1 CAT-origin 판별자(FK) + L2 이중수납 2차방어(partial UNIQUE).
        // external_trxid 미기입(NULL 유지) = RedPay 예약 매칭키.
        is_simulation: rec.isSimulation,      // ★C6 테스트금액 격리(payments 패리티).
        memo: isCancel ? '코밴 단말 결제취소' : '코밴 단말 카드결제',
      })
      .select('id');
    if (error) {
      // ★L2 멱등: payment_attempt_id partial UNIQUE 위반(23505) = 중복 승인콜백 → 이중수납 방지, 멱등 no-op.
      if (isUniqueViolation(error)) {
        console.warn(`수납 기록 멱등 skip(중복 승인콜백, attempt=${rec.attemptId}): ${error.message}`);
        return;
      }
      throw new Error(`수납 기록 실패: ${error.message}`);
    }
    const paymentId = data?.[0]?.id as string | undefined;
    if (!paymentId) {
      // 0-row + error=null = RLS 거부/스코프 불일치(INV-W5). 수납 미영속인데 성공 오인 금지.
      throw new Error('수납 기록 실패: 0행 반영(권한/스코프 확인 필요).');
    }
    // ★BINDING#3: accounting_date = 승인일자(TRANDATE). payments INSERT 트리거는 created_at KST 로 stamp 하므로,
    //   UPDATE(트리거 재발화 없음)로 승인일자를 덮어써 late/일경계 drift 를 방지. 승인일자 파싱 실패 시 트리거 default 유지.
    const acctDate = yymmddToISODate(rec.approvalDate);
    if (acctDate) {
      const { error: acctErr } = await supabase
        .from('payments')
        .update({ accounting_date: acctDate })
        .eq('id', paymentId);
      if (acctErr) console.error(`매출일자(accounting_date) 착지 실패(payment_id=${paymentId}):`, acctErr.message);
    }
    // ★승인 성공 → attempt.payment_id 역링크(관측/조인 편의). 링크 실패는 수납 성립을 되돌리지 않음(로그만).
    //   정본 판별자는 payments.payment_attempt_id(위 INSERT 에 원자 착지) — 이 역링크는 보조.
    const { error: linkErr } = await supabase
      .from('cband_payment_attempts')
      .update({ payment_id: paymentId, updated_at: new Date().toISOString() })
      .eq('id', rec.attemptId);
    if (linkErr) {
      console.error(`수납-시도 역링크 실패(attempt=${rec.attemptId}, payment_id=${paymentId}):`, linkErr.message);
    }
  },

  async probeConcurrent(q: { clinicId: string; checkInId: string | null; merno: string | null }): Promise<OpenPaymentProbe> {
    // ★AC-6-2 버튼 순간 서버 재확인(순수 read, no-DDL). 스키마 무접촉 — cband_payment_attempts SELECT(count/head) 만.
    //   조회 실패는 상위(precheckConcurrentPayment)가 degrade-open 처리(L2 하드백스톱 유효).
    const clinicId = q.clinicId;
    async function existsAttempt(
      filter: Record<string, string>,
      label: string,
    ): Promise<boolean> {
      let query = supabase
        .from('cband_payment_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId);
      for (const [col, val] of Object.entries(filter)) query = query.eq(col, val);
      const { count, error } = await query;
      if (error) throw new Error(`동시결제 재확인 실패(${label}): ${error.message}`);
      return (count ?? 0) > 0;
    }

    let patientInProgress = false;
    let patientCompleted = false;
    let terminalBusy = false;

    if (q.checkInId) {
      patientInProgress = await existsAttempt({ check_in_id: q.checkInId, status: 'requested' }, '환자 진행중');
      // 완료(승인 0210)만 confirm 유도 대상 — 취소(0430)/실패는 재결제 경고 아님.
      patientCompleted = await existsAttempt(
        { check_in_id: q.checkInId, status: 'approved', tran_type: TRANTYPE_APPROVE },
        '환자 완료',
      );
    }
    if (q.merno) {
      terminalBusy = await existsAttempt({ merno: q.merno, status: 'requested' }, '단말 사용중');
    }
    return { patientInProgress, patientCompleted, terminalBusy };
  },
};
