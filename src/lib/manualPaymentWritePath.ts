// manualPaymentWritePath — 수기수납(영수증/일마감) 정본 write-path 단일 SSOT
// T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC (옵션A, 김주연 총괄 확정)
//
// 배경(RC MSG-0dtm/7xw1): 수기 결제입력이 정본 package_payments/payments 를 만들지 않아
//   (a) 고객박스 미수 미해소  (b) 2번차트 수납내역 미표시  (c) 칸반 payment_waiting 미해소.
//   → 스태프가 저장 시 '귀속 대상'을 수기 선택하고, 그 선택대로 정본 행을 만든다(옵션A).
//
// 옵션A 3분기 (AC7: 병렬 write 경로 신설 금지 — 이 함수가 유일 정본 경로):
//   'package'  활성 패키지 잔금 → package_payments INSERT + packages.paid_amount 재집계 (미수 해소)
//   'checkin'  payment_waiting 내원 → payments INSERT(check_in 귀속) + 칸반 해소(status='done' 등)
//   'single'   둘다無 → payments INSERT(check_in_id NULL) 단건
//
// 매출 이중계상 방지(revenue_source_split): 본 경로는 canonical(payments/package_payments)만 생성한다.
//   호출측(일마감 수기입력)은 canonical 라우팅 시 closing_manual_payments 를 만들지 않아 net-zero 를 유지한다.
//
// 분할결제(복수 결제수단, 카드+이체 등) — 단일 SSOT 수렴 (2026-07-24 형제티켓 통합):
//   두 진입점(영수증 팝업 = T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD /
//    일마감 수기 = T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC)이 동일한 splits 배열 규약으로
//   이 함수 하나로 수렴한다. input.splits 지정 시 각 행이 canonical(payments/package_payments) 1행이 되고,
//   미수 해소·paid_amount 재집계·칸반 해소 side-effect 는 splits '합산' 기준 1회만 적용한다.
//   → 병렬 write 경로 신설 없음(AC7 유지) · leg합=총액 · canonical↔manual 상호배타(이중계상 0).
//   splits 미지정 시 amount/method 단건 경로 UNCHANGED(단건 fallback 회귀 안전).
//
// 스키마 변경 없음(기존 테이블/컬럼만 사용, 다중 INSERT) → data-architect CONSULT 불요. db_change=false.
import { supabase } from './supabase';
import { applyStatusFlagTransition, type FlagTransitionActor } from './statusFlagTransition';

export type PayMethod = 'card' | 'cash' | 'transfer';

/** 분할결제 행(복수 결제수단) — 결제수단 1종 + 금액 1건. 각 행이 canonical payment row 1개로 생성된다.
 *  카드+이체 등 다-결제수단을 splits 배열로 표현. (영수증 팝업·일마감 수기 공통 규약) */
export interface PaymentSplit {
  method: PayMethod;
  amount: number;
}

/** 칸반 귀속에 필요한 check_in 최소 형태(status 는 문자열 허용 — 호출측 로딩 편의). */
export interface ManualPayCheckIn {
  id: string;
  clinic_id: string;
  status: string;
  status_flag_history: unknown[];
  customer_id: string | null;
}

/** 옵션A 귀속 대상 */
export type ManualPayAttribution =
  | { kind: 'package'; packageId: string }
  | { kind: 'checkin'; checkIn: ManualPayCheckIn }
  | { kind: 'single' };

export interface RecordManualPaymentInput {
  clinicId: string;
  customerId: string;
  /** 단일 결제 금액 (하위호환). splits 미지정 시 method 와 함께 단일 행으로 정규화된다. */
  amount?: number;
  /** 단일 결제수단 (하위호환). splits 미지정 시 amount 와 함께 단일 행으로 정규화된다. */
  method?: PayMethod;
  /** 분할결제 다-결제수단 행(카드+이체 등). 지정 시 amount/method 대신 이 배열이 정본 소스가 된다.
   *  각 행은 canonical(package_payments/payments) 1행으로 기록되고,
   *  side-effect(미수 해소·paid_amount 재집계·칸반 해소)는 splits '합산' 기준 1회만 적용된다.
   *  미지정(또는 빈 배열) 시 amount/method 단건 경로 UNCHANGED(단건 회귀 안전). */
  splits?: PaymentSplit[];
  attribution: ManualPayAttribution;
  /** 메모(선택). 미지정 시 라우팅별 기본 메모.
   *  주의: '영수증 업로드'로 시작하면 2번차트 수납내역에서 제외됨(CHART2-RECEIPT-RESTRUCTURE 필터). */
  memo?: string;
  /** 결제일 귀속 override — 과거일 결제 시 created_at 세팅(Closing 은 created_at 기준 일자집계). */
  createdAtOverride?: string;
  /** 칸반 status_flag 이력 감사용 actor(선택). */
  actor?: FlagTransitionActor;
}

export interface RecordManualPaymentResult {
  route: ManualPayAttribution['kind'];
  /** 칸반 payment_waiting → done 전이 성공 여부(checkin 라우팅에서만 의미). */
  kanbanResolved: boolean;
  /** 기록된 canonical 행 수(분할결제 시 2+). */
  splitCount: number;
}

/**
 * 입력을 splits 배열로 정규화(하위호환) — 단일 합산지점.
 * splits 지정 시 그대로, 아니면 amount+method 단일 행. 각 행 검증(amount>0, method 존재).
 * 0원 행은 호출측에서 제외하는 것을 전제하되, 방어적으로 여기서도 amount>0 을 강제한다.
 */
function normalizeSplits(input: RecordManualPaymentInput): PaymentSplit[] {
  const splits = (input.splits && input.splits.length > 0)
    ? input.splits
    : (input.amount != null && input.method != null)
      ? [{ method: input.method, amount: input.amount }]
      : [];
  if (splits.length === 0) throw new Error('결제 행이 없습니다');
  for (const s of splits) {
    if (!(s.amount > 0)) throw new Error('금액이 올바르지 않습니다');
    if (!s.method) throw new Error('결제수단이 올바르지 않습니다');
  }
  return splits;
}

/**
 * 수기수납 정본 write. 옵션A 귀속 선택에 따라 canonical 행을 생성한다.
 * 분할결제(카드+이체 등)는 splits 배열로 전달 — 각 행이 canonical 1행이 되고, 미수/집계는 splits 합으로 정합.
 *   (병렬 write 경로 신설 없이 이 SSOT 위에서 행 확장 — 영수증 팝업·일마감 수기 공통 경로)
 * @throws 결제 행 INSERT 실패 시(칸반/플래그 부수효과 실패는 흡수 — 결제는 유지).
 */
export async function recordManualPayment(
  input: RecordManualPaymentInput,
): Promise<RecordManualPaymentResult> {
  const { clinicId, customerId, attribution, memo, createdAtOverride, actor } = input;
  const splits = normalizeSplits(input);

  const createdAtField = createdAtOverride ? { created_at: createdAtOverride } : {};

  // ── 'package' — 활성 패키지 잔금 결제 → 미수 해소 ─────────────────────────
  if (attribution.kind === 'package') {
    // 분할결제: 행 별 package_payments 1행씩. 매출 이중계상 방지 = 행 합 = 총액(각 행 canonical 1회만).
    const { error: ppErr } = await supabase.from('package_payments').insert(
      splits.map((s) => ({
        clinic_id: clinicId,
        package_id: attribution.packageId,
        customer_id: customerId,
        amount: s.amount,
        method: s.method,
        installment: 0,
        payment_type: 'payment',
        fee_kind: 'package',
        memo: memo ?? '수기수납(패키지 잔금)',
        ...createdAtField,
      })),
    );
    if (ppErr) throw new Error(`패키지 결제 기록 실패: ${ppErr.message}`);
    // packages.paid_amount 재집계(PKG-REVENUE-SPLIT 동일 로직) — 미수 파생값 정합(행 합 반영).
    const { data: sum } = await supabase
      .from('package_payments')
      .select('amount, payment_type')
      .eq('package_id', attribution.packageId);
    const total = (sum ?? []).reduce(
      (acc, r) => acc + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    await supabase.from('packages').update({ paid_amount: total }).eq('id', attribution.packageId);
    return { route: 'package', kanbanResolved: false, splitCount: splits.length };
  }

  // ── 'checkin' — payment_waiting 내원 결제 → 수납내역 표시 + 칸반 해소 ──────
  if (attribution.kind === 'checkin') {
    const ci = attribution.checkIn;
    // 분할결제: 행 별 payments 1행씩(동일 check_in_id 귀속). 2번차트 수납내역에 행 별 표시.
    const { error: pErr } = await supabase.from('payments').insert(
      splits.map((s) => ({
        clinic_id: clinicId,
        check_in_id: ci.id,
        customer_id: customerId,
        amount: s.amount,
        method: s.method,
        installment: 0,
        payment_type: 'payment',
        memo: memo ?? '영수증 수납',
        ...createdAtField,
      })),
    );
    if (pErr) throw new Error(`결제 기록 실패: ${pErr.message}`);

    // 칸반 해소: payment_waiting → done (PaymentMiniWindow 동선 재사용). best-effort 부수효과.
    let kanbanResolved = false;
    const { error: ciErr } = await supabase
      .from('check_ins')
      .update({ status: 'done' })
      .eq('id', ci.id);
    if (!ciErr) {
      kanbanResolved = true;
      await supabase.from('status_transitions').insert({
        check_in_id: ci.id,
        clinic_id: ci.clinic_id,
        from_status: ci.status,
        to_status: 'done',
      }).then(() => {}, () => {});
      try {
        await applyStatusFlagTransition(
          { id: ci.id, status_flag_history: (ci.status_flag_history ?? []) as Parameters<typeof applyStatusFlagTransition>[0]['status_flag_history'] },
          'dark_gray',
          actor ?? { id: null, name: null, role: null },
        );
      } catch { /* 플래그 실패는 결제/상태전이를 롤백하지 않음 */ }
    } else {
      console.error('칸반 status=done 전이 실패(결제는 정상 기록):', ciErr.message);
    }
    return { route: 'checkin', kanbanResolved, splitCount: splits.length };
  }

  // ── 'single' — 단건 결제(귀속 없음) ─────────────────────────────────────
  // 분할결제: 행 별 payments 1행씩(check_in_id NULL). 각 행 canonical 1회 → 이중계상 없음.
  const { error: sErr } = await supabase.from('payments').insert(
    splits.map((s) => ({
      clinic_id: clinicId,
      check_in_id: null,
      customer_id: customerId,
      amount: s.amount,
      method: s.method,
      installment: 0,
      payment_type: 'payment',
      memo: memo ?? '영수증 수납(단건)',
      ...createdAtField,
    })),
  );
  if (sErr) throw new Error(`단건 결제 기록 실패: ${sErr.message}`);
  return { route: 'single', kanbanResolved: false, splitCount: splits.length };
}
