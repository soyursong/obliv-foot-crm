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
// 스키마 변경 없음(기존 테이블/컬럼만 사용) → data-architect CONSULT 불요. db_change=false.
//
// T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD: 분할결제(복수 결제수단) 지원 추가.
//   input.splits 지정 시 각 행마다 payment/package_payments row 1개를 다중 INSERT하고,
//   미수 해소·paid_amount 재집계·칸반 해소 side-effect 는 분할 '합산' 기준 1회만 적용한다.
//   splits 미지정 시 amount/method 단건 경로 UNCHANGED(단건 fallback 회귀 안전). 스키마 변경 없음(다중 INSERT).
import { supabase } from './supabase';
import { applyStatusFlagTransition, type FlagTransitionActor } from './statusFlagTransition';

export type PayMethod = 'card' | 'cash' | 'transfer';

/** 분할결제 행(복수 결제수단) — 각 행이 payment row 1개로 생성된다.
 *  T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD */
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
  amount: number;
  method: PayMethod;
  /** 분할결제(복수 결제수단). 지정 시 각 행마다 payment row 1개 생성하고,
   *  side-effect(미수 해소·paid_amount 재집계·칸반 해소)는 분할 '합산' 기준 1회만 적용한다.
   *  미지정(또는 빈 배열) 시 amount/method 단건 경로 UNCHANGED(단건 회귀 안전).
   *  T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD */
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
}

/**
 * 수기수납 정본 write. 옵션A 귀속 선택에 따라 canonical 행을 생성한다.
 * @throws 결제 행 INSERT 실패 시(칸반/플래그 부수효과 실패는 흡수 — 결제는 유지).
 */
export async function recordManualPayment(
  input: RecordManualPaymentInput,
): Promise<RecordManualPaymentResult> {
  const { clinicId, customerId, amount, method, attribution, memo, createdAtOverride, actor } = input;

  // 분할결제 정규화: splits 지정 시 각 행, 미지정 시 단건 1행. 각 행 amount>0 검증(0원 행은 호출측에서 제외).
  // T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD — SSOT 단일경로(AC7) 유지: 병렬 write 경로 신설 없이 행만 확장.
  const rows: PaymentSplit[] =
    input.splits && input.splits.length > 0 ? input.splits : [{ method, amount }];
  if (rows.some((r) => !(r.amount > 0))) throw new Error('금액이 올바르지 않습니다');

  const createdAtField = createdAtOverride ? { created_at: createdAtOverride } : {};

  // ── 'package' — 활성 패키지 잔금 결제 → 미수 해소 ─────────────────────────
  if (attribution.kind === 'package') {
    const { error: ppErr } = await supabase.from('package_payments').insert(
      rows.map((r) => ({
        clinic_id: clinicId,
        package_id: attribution.packageId,
        customer_id: customerId,
        amount: r.amount,
        method: r.method,
        installment: 0,
        payment_type: 'payment',
        fee_kind: 'package',
        memo: memo ?? '수기수납(패키지 잔금)',
        ...createdAtField,
      })),
    );
    if (ppErr) throw new Error(`패키지 결제 기록 실패: ${ppErr.message}`);
    // packages.paid_amount 재집계(PKG-REVENUE-SPLIT 동일 로직) — 미수 파생값 정합.
    const { data: sum } = await supabase
      .from('package_payments')
      .select('amount, payment_type')
      .eq('package_id', attribution.packageId);
    const total = (sum ?? []).reduce(
      (s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    await supabase.from('packages').update({ paid_amount: total }).eq('id', attribution.packageId);
    return { route: 'package', kanbanResolved: false };
  }

  // ── 'checkin' — payment_waiting 내원 결제 → 수납내역 표시 + 칸반 해소 ──────
  if (attribution.kind === 'checkin') {
    const ci = attribution.checkIn;
    const { error: pErr } = await supabase.from('payments').insert(
      rows.map((r) => ({
        clinic_id: clinicId,
        check_in_id: ci.id,
        customer_id: customerId,
        amount: r.amount,
        method: r.method,
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
    return { route: 'checkin', kanbanResolved };
  }

  // ── 'single' — 단건 결제(귀속 없음) ─────────────────────────────────────
  const { error: sErr } = await supabase.from('payments').insert(
    rows.map((r) => ({
      clinic_id: clinicId,
      check_in_id: null,
      customer_id: customerId,
      amount: r.amount,
      method: r.method,
      installment: 0,
      payment_type: 'payment',
      memo: memo ?? '영수증 수납(단건)',
      ...createdAtField,
    })),
  );
  if (sErr) throw new Error(`단건 결제 기록 실패: ${sErr.message}`);
  return { route: 'single', kanbanResolved: false };
}
