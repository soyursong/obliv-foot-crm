// packageCreditLedger — 패키지 선납 크레딧 원장(package_credit_ledger) 소비 API (FE end-state)
// T-20260715-foot-PKG-REGEN-LEDGER-FE-CONVERGE
//
// 배경: 부모 구조 lane(T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK)이 신설한
//   · package_credit_ledger(charge/use/refund/transfer, append-only, balance=Σamount 파생, §10-5 ledger-SSOT)
//   · packages.superseded_by(재생성 lineage: old→new)
//   · package_amendments(재생성 audit child)
//   · package_credit_balance(account_id[, account_type]) RPC(잔액=원장 합 파생)
//   를 FE 가 소비하도록 수렴한다. 형제 백필로 원장이 채워진 뒤 소비(구조 선착지 §10-7).
//
// 원칙(SSOT / 무회귀):
//   1. 원장이 크레딧 권위 grain. balance=Σ(파생). packages.paid_amount 는 원장에서 파생되는 표시 캐시로 격하.
//   2. 재생성 = paid_amount '수동 bump' 금지. old.superseded_by=new.id lineage + 미사용 크레딧을
//      원장 re-anchor(use old / charge new, reanchored_from=old)로 이관 + package_amendments audit.
//      new.paid_amount 는 '원장 파생값'으로 sync(수동 입력 아님 → paid_amount→ledger 이관, AC1).
//   3. 모든 원장 mirror write 는 best-effort — 정본 write-path(recordManualPayment)를 절대
//      블록/롤백하지 않는다(AC3). 원장 미적용(마이그 전)·RLS 거부 환경에서도 graceful no-op(회귀 0).
//   4. 병렬 write 경로 신설 아님 — 크레딧 charge 는 canonical(package_payments/payments) 기록에
//      부수(mirror)되고, 재생성만 이 모듈의 단일 트랜잭션형 헬퍼로 수렴한다.
import { supabase } from './supabase';

/** 원장 tx 종류. charge=선납(+), use=소진/carry-out(−), refund=환불(−), transfer=양도(±). */
export type CreditTxType = 'charge' | 'use' | 'refund' | 'transfer';

export interface CreditTxInput {
  clinicId: string;
  customerId: string;
  /** 크레딧 계정 앵커(account_type='package' → packages.id). */
  packageId: string;
  /** 원(charge=+, use/refund=−를 호출측이 부호로 전달). */
  amount: number;
  /** 이 tx 를 만든 수납행(있으면). 현금흐름 traceability. */
  sourcePaymentId?: string | null;
  /** 재생성 re-anchor 시 원 소속 패키지(lineage). */
  reanchoredFrom?: string | null;
  memo?: string | null;
}

/**
 * 원장 tx 1건 append(INSERT). best-effort — 실패해도 throw 하지 않는다(정본 결제/재생성 흐름 무영향).
 * 원장 미적용(테이블 없음)·RLS 거부 시 조용히 no-op(false 반환) → 회귀 0.
 */
export async function appendCreditTx(txType: CreditTxType, input: CreditTxInput): Promise<boolean> {
  try {
    const { error } = await supabase.from('package_credit_ledger').insert({
      clinic_id: input.clinicId,
      customer_id: input.customerId,
      account_type: 'package',
      account_id: input.packageId,
      tx_type: txType,
      amount: input.amount,
      source_payment_id: input.sourcePaymentId ?? null,
      reanchored_from: input.reanchoredFrom ?? null,
      memo: input.memo ?? null,
    });
    if (error) {
      console.warn(`[packageCreditLedger] ${txType} tx 기록 skip(무영향): ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[packageCreditLedger] tx 기록 예외(무영향):', e);
    return false;
  }
}

/** 크레딧 charge(선납 +) mirror. canonical 패키지 결제 기록에 부수(best-effort). */
export function recordCreditCharge(input: CreditTxInput): Promise<boolean> {
  return appendCreditTx('charge', { ...input, amount: Math.abs(input.amount) });
}

/** 크레딧 use(소진/carry-out −) — 부호 강제(음수). best-effort. */
export function recordCreditUse(input: CreditTxInput): Promise<boolean> {
  return appendCreditTx('use', { ...input, amount: -Math.abs(input.amount) });
}

/**
 * 원장 파생 잔액(= Σamount) 조회. package_credit_balance RPC 경유(§10-5, 저장 balance 없음).
 * 원장 미적용/RPC 부재 시 null 반환 → 콜러는 기존 paid_amount 폴백(회귀 0).
 */
export async function getCreditBalance(packageId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('package_credit_balance', { p_account_id: packageId });
    if (error) return null;
    return data == null ? null : Number(data);
  } catch {
    return null;
  }
}

/**
 * 원장에 해당 패키지 계정의 tx 가 1건이라도 존재하는지(= 원장이 이 패키지의 권위 소스인지).
 * 존재하면 잔액을 원장 기준으로, 아니면 기존 paid_amount 폴백으로 표시한다(전환기 정합).
 */
export async function hasLedgerEntries(packageId: string): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('package_credit_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('account_type', 'package')
      .eq('account_id', packageId);
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * superseded_by lineage 를 따라 현행(최신) 패키지 id 로 수렴.
 * 재생성으로 old→new 가 연결되면 old.superseded_by=new.id → 표시/잔액 계산이 항상 현행을 가리키게 한다.
 * 순환 방지(최대 16홉). 원장/컬럼 미적용 시 입력 id 그대로 반환(graceful).
 */
export async function resolveActivePackageId(packageId: string): Promise<string> {
  let current = packageId;
  for (let hop = 0; hop < 16; hop++) {
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('superseded_by')
        .eq('id', current)
        .maybeSingle();
      if (error || !data) return current;
      const next = (data as { superseded_by?: string | null }).superseded_by;
      if (!next || next === current) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
}

/** 재생성 대상 패키지의 클론에 필요한 구성 필드(항목별 회수·수가). */
export interface RegenPackageSource {
  id: string;
  clinic_id: string;
  customer_id: string;
  package_name: string;
  package_type?: string | null;
  total_sessions?: number | null;
  total_amount: number;
  paid_amount?: number | null;
  consultation_fee?: number | null;
  heated_sessions?: number | null;
  heated_unit_price?: number | null;
  unheated_sessions?: number | null;
  unheated_unit_price?: number | null;
  podologe_sessions?: number | null;
  podologe_unit_price?: number | null;
  iv_sessions?: number | null;
  iv_unit_price?: number | null;
  iv_company?: string | null;
  trial_sessions?: number | null;
  trial_unit_price?: number | null;
  reborn_sessions?: number | null;
  reborn_unit_price?: number | null;
  treatment_type?: string | null;
  reference_price?: number | null;
  template_id?: string | null;
  status?: string;
}

export interface RegeneratePackageParams {
  /** 재생성 원본(현 활성 패키지). */
  source: RegenPackageSource;
  /** 새 패키지 총 계약금(구성 변경 시 조정). 미지정 시 원본 total_amount 유지. */
  newTotalAmount?: number;
  /** 새 패키지명(미지정 시 원본명 유지). */
  newPackageName?: string;
  /**
   * 이관할 미사용 크레딧(원). 미지정 시 calc_refund_amount(미사용분 상당액) → 실패 시 원장잔액 → paid_amount 순 폴백.
   * 이 금액을 old→new 로 원장 re-anchor(use old / charge new)한다(고아 credit 0).
   */
  carryCredit?: number;
  reason?: string | null;
  actor?: string | null;
}

export interface RegeneratePackageResult {
  newPackageId: string;
  carriedCredit: number;
  ledgerReanchored: boolean;
}

/**
 * 패키지 재생성 end-state — paid_amount 수동 bump 제거, 원장 re-anchor + superseded_by lineage.
 *
 * 순서(클라이언트 비원자 — 실패 시 부분상태 최소화):
 *   1) 이관 크레딧 산출(carryCredit 우선 → calc_refund_amount → 원장잔액 → paid_amount).
 *   2) 신규 패키지 INSERT(구성 클론, paid_amount=0 출발, superseded_by=NULL, status='active').
 *   3) 원본 UPDATE(superseded_by=new.id + status='cancelled') — 낙관적 경합 가드(status='active').
 *      실패 시 신규 패키지 롤백(delete) 후 throw(고아 신규 방지).
 *   4) 원장 re-anchor: use(old, −carry, reanchored_from=old) + charge(new, +carry, reanchored_from=old). best-effort.
 *   5) package_amendments(regenerate) audit append. best-effort.
 *   6) new.paid_amount = 원장 파생값 sync(수동 아님 → paid_amount→ledger 이관 완료). best-effort.
 *
 * @throws 신규 INSERT 실패 / 원본 lineage UPDATE 실패(부분상태) 시.
 */
export async function regeneratePackage(params: RegeneratePackageParams): Promise<RegeneratePackageResult> {
  const { source } = params;
  const clinicId = source.clinic_id;
  const customerId = source.customer_id;

  // ── 1) 이관 크레딧 산출 ────────────────────────────────────────────────
  let carry = params.carryCredit;
  if (carry == null) {
    // 미사용분 상당액(참고표시와 동일 SSOT, calc_refund_amount = 무영속 SQL 함수).
    try {
      const { data } = await supabase.rpc('calc_refund_amount', { p_package_id: source.id });
      const q = (data ?? null) as { refund_amount?: number } | null;
      if (q?.refund_amount != null) carry = q.refund_amount;
    } catch { /* 폴백 진행 */ }
  }
  if (carry == null) {
    const bal = await getCreditBalance(source.id);
    if (bal != null) carry = bal;
  }
  if (carry == null) carry = source.paid_amount ?? 0;
  carry = Math.max(0, Math.round(carry));

  // ── 2) 신규 패키지 INSERT(구성 클론) ───────────────────────────────────
  const newTotal = params.newTotalAmount ?? source.total_amount;
  const clone: Record<string, unknown> = {
    clinic_id: clinicId,
    customer_id: customerId,
    package_name: (params.newPackageName ?? source.package_name),
    package_type: source.package_type ?? 'custom',
    total_sessions: source.total_sessions ?? 0,
    total_amount: newTotal,
    paid_amount: 0, // 원장에서 파생 sync(6단계) — 수동 bump 아님.
    status: 'active',
    consultation_fee: source.consultation_fee ?? 0,
    heated_sessions: source.heated_sessions ?? 0,
    heated_unit_price: source.heated_unit_price ?? 0,
    unheated_sessions: source.unheated_sessions ?? 0,
    unheated_unit_price: source.unheated_unit_price ?? 0,
    podologe_sessions: source.podologe_sessions ?? 0,
    podologe_unit_price: source.podologe_unit_price ?? 0,
    iv_sessions: source.iv_sessions ?? 0,
    iv_unit_price: source.iv_unit_price ?? 0,
    iv_company: source.iv_company ?? null,
    trial_sessions: source.trial_sessions ?? 0,
    trial_unit_price: source.trial_unit_price ?? 0,
    reborn_sessions: source.reborn_sessions ?? 0,
    reborn_unit_price: source.reborn_unit_price ?? 0,
    treatment_type: source.treatment_type ?? null,
    reference_price: source.reference_price ?? null,
    template_id: source.template_id ?? null,
    memo: `재생성(원본 ${source.id})`,
  };
  const { data: inserted, error: insErr } = await supabase
    .from('packages')
    .insert(clone)
    .select('id')
    .single();
  if (insErr || !inserted) {
    throw new Error(`재생성 실패(신규 패키지 생성): ${insErr?.message ?? '알 수 없음'}`);
  }
  const newPackageId = (inserted as { id: string }).id;

  // ── 3) 원본 lineage UPDATE(superseded_by + cancelled) ─────────────────
  const { data: updated, error: updErr } = await supabase
    .from('packages')
    .update({ superseded_by: newPackageId, status: 'cancelled' })
    .eq('id', source.id)
    .eq('status', 'active') // 낙관적 경합 가드
    .select('id');
  if (updErr || (updated ?? []).length !== 1) {
    // 부분상태 방지 — 방금 만든 신규 패키지 롤백(결제/세션 없어 삭제 안전).
    await supabase.from('packages').delete().eq('id', newPackageId);
    throw new Error(
      `재생성 실패(원본 계보 연결): ${updErr?.message ?? '원본 상태가 이미 변경되었거나 권한이 없습니다'}`,
    );
  }

  // ── 4) 원장 re-anchor(use old / charge new) — 크레딧 이관(고아 0) ───────
  let ledgerReanchored = false;
  if (carry > 0) {
    const outOk = await recordCreditUse({
      clinicId, customerId, packageId: source.id, amount: carry,
      reanchoredFrom: source.id, memo: `재생성 carry-out → ${newPackageId}`,
    });
    const inOk = await recordCreditCharge({
      clinicId, customerId, packageId: newPackageId, amount: carry,
      reanchoredFrom: source.id, memo: `재생성 carry-in ← ${source.id}`,
    });
    ledgerReanchored = outOk && inOk;
  }

  // ── 5) audit child(regenerate) ────────────────────────────────────────
  try {
    await supabase.from('package_amendments').insert({
      package_id: source.id,
      superseded_by: newPackageId,
      amendment_type: 'regenerate',
      reason: params.reason ?? null,
      before_snapshot: { status: source.status ?? 'active', total_amount: source.total_amount, paid_amount: source.paid_amount ?? 0 },
      after_snapshot: { new_package_id: newPackageId, total_amount: newTotal, carried_credit: carry },
      actor: params.actor ?? null,
    });
  } catch (e) {
    console.warn('[packageCreditLedger] amendments 기록 skip(무영향):', e);
  }

  // ── 6) new.paid_amount = 원장 파생값 sync(수동 bump 아님) ──────────────
  try {
    const bal = await getCreditBalance(newPackageId);
    const derived = bal != null ? bal : carry; // 원장 우선, 미적용 시 이관액
    await supabase.from('packages').update({ paid_amount: derived }).eq('id', newPackageId);
  } catch (e) {
    console.warn('[packageCreditLedger] paid_amount 파생 sync skip(무영향):', e);
  }

  return { newPackageId, carriedCredit: carry, ledgerReanchored };
}
