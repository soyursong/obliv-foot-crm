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
import {
  CbandConcurrentPaymentError, CBAND_ORPHAN_STALE_MINUTES,
  type AttemptRecord, type AttemptStore, type CbandAttemptView, type OpenPaymentProbe,
} from './paymentFlow';
import { TRANTYPE_APPROVE, TRANTYPE_CANCEL, type NormalizedResponse } from './protocol';

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

/**
 * ★T-20260804-foot-CBAND-RESPRECV-BANNER-RCA — raw_response PCI-safe 투영(원본 payload 제외).
 *   normalize() 의 NormalizedResponse 는 `raw`(단말 원본 payload 전체)를 임베드한다. 단말이 CARDNO 를
 *   미마스킹(평문 PAN)으로 반환하면 원본 payload 에 PAN 이 실려, 이를 그대로 raw_response 로 write 시
 *   BEFORE UPDATE PCI 가드(trg_cband_pa_pci_guard, Rule B: Luhn 13~19자리)가 RAISE → UPDATE 거부 →
 *   status='approved' 미승격(고아) → sweep→attention→false '확인 필요' 배너(수납은 정상 영속인데도).
 *   → 원본 payload(`raw`)만 제외하고 정규화·마스킹 감사필드는 전부 보존한다(저장완전성 유지).
 *     컬럼 계약(raw_response='정규화 응답 보존(PCI 가드)')상 원본 full payload 저장은 애초 계약 위반이었다.
 *   ★in-memory resp(`raw` 포함)는 classify 등에서 이미 소비 완료 — 여기(영속 경계)에서만 제외한다.
 */
function toPersistableRaw(resp: NormalizedResponse | null | undefined): Record<string, unknown> | null {
  if (!resp) return null;
  const { raw: _omitFullPayload, ...safe } = resp;  // ★단말 원본 payload(미마스킹 PAN/SAD 위험) 제외.
  return safe as Record<string, unknown>;
}

/**
 * ★T-20260804-foot-CBAND-ATTEMPT-UPDATEATTEMPT-SILENT-FAIL-AUDIT (AC-2) — 감사 write 유실 시 bounded 재시도.
 *   RESPRECV-BANNER-RCA(8c3aa1cf)는 감사 write 유실을 rows-affected(.select('id'))로 **표면화(로그)** 하고
 *   근본원인(raw payload PCI 트립)을 제거했다(AC-1·근본원인 = RCA에 이미 구현, 본 티켓은 중복 구현 안 함 = AC-4).
 *   본 티켓의 신규 facet = **최종 영속 보강**: RCA가 제거한 알려진 원인 외의 일시적 실패(네트워크 순단·
 *   경합·일시 RLS)에서도 raw_response/auth_no 가 조용히 유실되지 않도록 소량 재시도로 방어(DID-IT-PERSIST).
 *   ★불변식: throw 하지 않는다 — 승인 성공 후 이 지점 throw 는 payments 수납기록 성립을 되돌린다(무접점·회귀0).
 *     재시도 소진 시 큰 소리 표면화만(cross_crm_write_rowcheck 계약). 신규 DDL 0(outbox 미도입) = db_change:false.
 */
export const AUDIT_WRITE_MAX_ATTEMPTS = 3 as const;
/** 시도 간 backoff(ms). RLS/가드 같은 결정론적 실패엔 무효하나 일시장애엔 유효 — 짧게(총 <1s). */
export const AUDIT_WRITE_RETRY_DELAYS_MS = [150, 400] as const;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 감사 write 1회 시도 결과. ok=true=영속 확정, ok=false=유실(에러 또는 0행 반영). */
export interface AuditWriteOutcome {
  ok: boolean;
  detail?: string;
}

/**
 * ★AC-2 공용 재시도 래퍼(주입 가능 = 결정론 테스트). doWrite 를 최대 maxAttempts 회 시도,
 *   ok 되면 즉시 종료(영속 확정). 모두 실패하면 큰 소리 표면화 후 false 반환(throw 안 함).
 *   sleep 은 테스트에서 no-op 주입해 대기 없이 검증.
 * @returns 최종 영속 성공 여부(관측용).
 */
export async function persistAuditWriteWithRetry(
  doWrite: () => Promise<AuditWriteOutcome>,
  ctx: { label: string; msgTrace: string },
  opts: { maxAttempts?: number; delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const max = opts.maxAttempts ?? AUDIT_WRITE_MAX_ATTEMPTS;
  const delays = opts.delaysMs ?? AUDIT_WRITE_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let lastDetail = '미상';
  for (let attempt = 1; attempt <= max; attempt++) {
    let outcome: AuditWriteOutcome;
    try {
      outcome = await doWrite();
    } catch (e) {
      outcome = { ok: false, detail: (e as Error)?.message ?? String(e) };
    }
    if (outcome.ok) {
      if (attempt > 1) {
        console.warn(`[CBAND-AUDIT] ${ctx.label} 재시도 성공(msg_trace=${ctx.msgTrace}, ${attempt}/${max}) — 감사트레일 최종 영속.`);
      }
      return true;
    }
    lastDetail = outcome.detail ?? '미상';
    if (attempt < max) await sleep(delays[attempt - 1] ?? delays[delays.length - 1] ?? 0);
  }
  // ★재시도 소진 = 감사트레일 유실 위험. throw 금지(승인/수납 성립 보존), 큰 소리 표면화만(DID-IT-PERSIST 위반 경보).
  console.error(
    `[CBAND-AUDIT-WRITE-FAILURE] ${ctx.label} ${max}회 재시도 모두 실패(msg_trace=${ctx.msgTrace}): ${lastDetail}` +
      ` — raw_response/auth_no 유실 위험(cross_crm_write_rowcheck·DID-IT-PERSIST 위반).`,
  );
  return false;
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
    // ★FIX-2(MERNO-REQFIELD-BUG): 승인 응답에서 파싱한 MERNO 를 시도 레코드에도 각인(감사 정합).
    //   요청 시점 merno 는 빈값 → 응답 확정 후 이 경로로만 채워진다. null/부재는 그대로 둠(스킵).
    if (patch.merno !== undefined) row.merno = patch.merno;
    // ★K2: raw(정규화·PCI-safe) 를 raw_response(jsonb)에 보존. DB BEFORE INSERT/UPDATE PCI 가드가 2차 방어.
    //   ★RESPRECV-BANNER-RCA: 원본 단말 payload(resp.raw, 미마스킹 PAN 위험)를 제외해 PCI 가드 RAISE 로 인한
    //     status 미승격(고아→false 배너) 재발을 원천 차단(정규화·마스킹 감사필드는 전부 보존).
    if (patch.rawResponse !== undefined) row.raw_response = toPersistableRaw(patch.rawResponse);
    // ★저장완전성(RCA ★인과 + SILENT-FAIL-AUDIT AC-1/AC-2): rows-affected 검증 + 유실 시 bounded 재시도.
    //   0행/에러면 status·AUTHNO·raw 미영속 = 감사트레일 유실(+ false 배너 재발 위험). RCA(8c3aa1cf)가
    //   근본원인(raw payload PCI 트립)을 제거하고 유실을 표면화(AC-1)했고, 본 티켓은 그 위에 **재시도로
    //   최종 영속 보강**(AC-2)한다 — RCA가 제거한 원인 외 일시장애(순단/경합/일시 RLS)에서도 조용히 유실 안 됨.
    //   ★throw 금지: 승인 성공 후 여기서 throw 하면 payments 수납기록 성립이 되돌아간다(무접점·회귀0).
    await persistAuditWriteWithRetry(
      async () => {
        const { data, error } = await supabase
          .from('cband_payment_attempts')
          .update(row)
          .eq('msg_trace', msgTrace)
          .select('id');
        if (error) return { ok: false, detail: error.message };
        if (!data || data.length === 0) {
          // 0행 반영 = 가드 RAISE(error 경로) 외의 스코프/권한 불일치(INV-W2). status 미승격 위험 → 재시도 대상.
          return { ok: false, detail: '0행 반영(권한/스코프/가드 — INV-W2)' };
        }
        return { ok: true };
      },
      { label: '결제 시도 감사 갱신', msgTrace },
    );
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
        // ★FIX-2(MERNO-REQFIELD-BUG): MERNO 는 요청값(rec.merno, 이제 빈값)이 아니라 승인 '응답' 전문에서
        //   파싱한 값(rec.rawResponse.merno, normalize 가 MERNO/MERCHANTNO/MID 관대 추출)을 저장한다.
        //   응답에 MERNO 부재 시 null 저장(결제는 성공 처리 — AC-3). DA canonical('선택 payments.merchant_no', 응답 파생) 정합.
        merchant_no: rec.rawResponse?.merno ?? null,  // mig190500 착지 컬럼(ADDITIVE·DDL무변). A11/A12 대사 조인 + DEDUP(K5) MERNO 축.
        // ★CARDNO(마스킹) — DA-20260804-FOOT-CBAND-CARDNO-MASKED-PLACEMENT(§7-1 PRIMARY): payments.card_no_masked 착지.
        //   normalize(extractMaskedCardNo)가 마스킹 마커(*/X) 있는 값만 verbatim 캡처(평문 PAN 은 null). DB BEFORE 가드가 2차 방어.
        //   mig 20260804193000(card_no_masked + payments-scoped PCI 가드) 착지 컬럼. attempt read-through 아님(§7-1 REJECT: attempt lossy).
        card_no_masked: rec.rawResponse?.cardNoMasked ?? null,
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

  async listRecentAttempts(q: { clinicId: string; checkInId: string; limit?: number }): Promise<CbandAttemptView[]> {
    // ★T-20260803-foot-CBAND-PAYRESULT-SWEEP AC-2: 상세시트 재진입 재표시용 순수 read(기존 SELECT RLS).
    //   PCI/PII 원문(raw_response) 미조회 — 표시에 필요한 subset(msg_trace/status/금액/시각/AUTHNO/응답코드)만.
    const { data, error } = await supabase
      .from('cband_payment_attempts')
      .select('id, msg_trace, status, tran_type, requested_amount, created_at, auth_no, response_code')
      .eq('clinic_id', q.clinicId)
      .eq('check_in_id', q.checkInId)
      .order('created_at', { ascending: false })
      .limit(q.limit ?? 10);
    if (error) throw new Error(`코밴 결제 시도 조회 실패: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      msgTrace: r.msg_trace as string,
      status: r.status as AttemptRecord['status'],
      tranType: r.tran_type as AttemptRecord['tranType'],
      amount: (r.requested_amount as number) ?? 0,
      createdAt: r.created_at as string,
      authNo: (r.auth_no as string | null) ?? null,
      responseCode: (r.response_code as string | null) ?? null,
    }));
  },

  async sweepStaleRequested(q: { clinicId: string; checkInId?: string; staleMinutes?: number }): Promise<{ swept: number }> {
    // ★T-20260803-foot-CBAND-PAYRESULT-SWEEP AC-1 기회주의 스윕(기존 UPDATE RLS, 스키마 무변).
    //   자기 clinic 의 오래된 고아('requested', staleMinutes 초과)를 'attention'(확인 필요) 승격.
    //   ★멱등/안전: status UPDATE 만 — payments 미생성(이중수납 0). 'requested'→'attention' 이탈로
    //     L2 partial UNIQUE(WHERE status='requested')에서 자연 해제(in-flight 잠금 영구점유 방지).
    //     PCI 가드 트리거는 raw_response 무변경(NEW.raw_response 불변) → 통과. 이미 승격된 건은 WHERE 로 자연 제외(재실행 no-op).
    //   실패는 삼킴(로그만) — 재표시/상세시트를 막지 않는다(soft 강화).
    const staleMs = (q.staleMinutes ?? CBAND_ORPHAN_STALE_MINUTES) * 60_000;
    const cutoffIso = new Date(Date.now() - staleMs).toISOString();
    // ★T-20260804-foot-CBAND-RESPRECV-BANNER-RCA 힐(HEAL): status='requested' 인데 payment_id 가 있는 행은
    //   이미 수납 영속됨(recordCardPayment 성공 → 백링크). PCI 가드로 approved 승격 UPDATE 만 거부돼 생긴 desync →
    //   'approved' 로 자가치유한다. payment_id NOT NULL ⟺ recordCardPayment 성공 ⟺ 승인(근거 게이팅·오승격 0·멱등).
    //   이렇게 하면 (a) 기왕 고착된 행이 재표시 진입 시 스스로 해소되고 (b) 아래 승격에서 자연 제외된다.
    {
      let healQ = supabase
        .from('cband_payment_attempts')
        .update({ status: 'approved' })
        .eq('clinic_id', q.clinicId)
        .eq('status', 'requested')
        .not('payment_id', 'is', null);
      if (q.checkInId) healQ = healQ.eq('check_in_id', q.checkInId);
      const { error: healErr } = await healQ.select('id');
      if (healErr) console.error(`코밴 수납-영속 desync 힐 실패(clinic=${q.clinicId}):`, healErr.message);
    }
    // 승격(PROMOTE): 진짜 고아(payment_id 없음 + stale)만 'attention'. ★수납된 행(payment_id IS NOT NULL)은
    //   위 힐로 이미 approved 이거나 아래 .is('payment_id', null) 로 제외 — 수납완료 결제를 false 로 확인필요 표시하지 않음.
    let query = supabase
      .from('cband_payment_attempts')
      .update({ status: 'attention' })
      .eq('clinic_id', q.clinicId)
      .eq('status', 'requested')
      .is('payment_id', null)
      .lt('created_at', cutoffIso);
    if (q.checkInId) query = query.eq('check_in_id', q.checkInId);
    const { data, error } = await query.select('id');
    if (error) {
      console.error(`코밴 고아 결제 스윕 실패(clinic=${q.clinicId}):`, error.message);
      return { swept: 0 };
    }
    return { swept: data?.length ?? 0 };
  },
};
