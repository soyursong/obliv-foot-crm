// T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED
// 건강생활유지비(의료급여 1종 공단 지원금) 잔액 방문 간 이월 — foot-local satellite 로더/영속.
//
// DA 설계 제약(SSOT: da_decision_foot_medaid1_healthfee_balance_persist_20260807):
//   · PRIMARY 저장 = satellite 1:1 {verified_balance, verified_at, verified_by} "스냅샷만 영속".
//   · ★현재잔액 = DERIVED — decrement write 금지:
//       current = verified_balance − Σ(HM payments net WHERE created_at >= verified_at)
//     → drift-free · 멱등 by-construction · double-decrement 구조불가 · Σ(payments)==payableTotal 불변(원장 무접점).
//   · 월전환 재확인(DoD#3) = verified_at 기준 stale 판정(월 경계 넘으면 재확인 유도).
import { supabase } from '@/lib/supabase';
import { seoulISODate, todaySeoulISODate } from '@/lib/format';

export interface HealthMaintenanceSnapshot {
  verified_balance: number;
  verified_at: string;
  verified_by: string | null;
}

export interface HealthMaintenanceBalanceState {
  /** 영속된 검증 스냅샷(없으면 null = 미저장). */
  snapshot: HealthMaintenanceSnapshot | null;
  /** verified_at 이후 차감된 HM 결제 순액(payment − refund). */
  deductedSinceVerified: number;
  /** 현재잔액(DERIVED) = verified_balance − deductedSinceVerified. 스냅샷 없으면 0. */
  current: number;
  /** 월 경계를 넘었는지(재확인 유도 대상). 스냅샷 없으면 false. */
  isStale: boolean;
}

const EMPTY: HealthMaintenanceBalanceState = {
  snapshot: null,
  deductedSinceVerified: 0,
  current: 0,
  isStale: false,
};

/** verified_at(TIMESTAMPTZ) 이 오늘(Asia/Seoul) 기준 다른 월이면 stale. */
export function isSnapshotStale(verifiedAt: string | null | undefined): boolean {
  if (!verifiedAt) return false;
  try {
    return seoulISODate(verifiedAt).slice(0, 7) !== todaySeoulISODate().slice(0, 7);
  } catch {
    return false;
  }
}

/**
 * 고객의 건강생활유지비 검증 스냅샷을 불러와 현재잔액을 payments 에서 파생한다.
 * satellite 부재/에러 시 EMPTY(잔액 0, 이월 없음) 폴백 — 회귀 안전.
 */
export async function loadHealthMaintenanceBalance(
  customerId: string | null | undefined,
): Promise<HealthMaintenanceBalanceState> {
  if (!customerId) return EMPTY;

  const { data: snap, error: snapErr } = await supabase
    .from('health_maintenance_balances')
    .select('verified_balance, verified_at, verified_by')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (snapErr || !snap) return EMPTY;

  const snapshot: HealthMaintenanceSnapshot = {
    verified_balance: Number(snap.verified_balance) || 0,
    verified_at: String(snap.verified_at),
    verified_by: snap.verified_by ?? null,
  };

  // Σ(HM payments net) WHERE created_at >= verified_at — decrement write 없이 파생.
  //   net = Σ(payment) − Σ(refund). 환불이 잔액을 되돌리므로 순액으로 차감.
  //   status='active' — void/취소된 결제행은 파생에서 제외(레포 payment-합산 관례: Customers/CustomerChart 동일).
  //   미필터 시 취소 결제가 파생 잔액을 영구 오차감. refund 는 별 payment_type='refund' 행으로 순액 반영.
  const { data: rows, error: payErr } = await supabase
    .from('payments')
    .select('amount, payment_type')
    .eq('customer_id', customerId)
    .eq('method', 'health_maintenance')
    .eq('status', 'active')
    .gte('created_at', snapshot.verified_at);

  let deducted = 0;
  if (!payErr && rows) {
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      deducted += r.payment_type === 'refund' ? -amt : amt;
    }
  }
  deducted = Math.max(0, deducted); // 방어: 환불>결제 이상치는 0 하한(음수 차감 금지)

  const current = Math.max(0, snapshot.verified_balance - deducted);

  return {
    snapshot,
    deductedSinceVerified: deducted,
    current,
    isStale: isSnapshotStale(snapshot.verified_at),
  };
}

/**
 * 스태프가 공단 포털에서 확인한 검증 잔액을 스냅샷으로 영속(upsert, customer_id 1:1).
 *   verified_at = now() 로 재기준선화 → 이후 HM payments 만 차감(과거 차감 이중반영 방지).
 *   ★ decrement write 아님 — 스냅샷(검증 잔액)만 영속. 현재잔액은 loadHealthMaintenanceBalance 가 파생.
 */
export async function persistHealthMaintenanceSnapshot(params: {
  customerId: string;
  clinicId: string;
  verifiedBalance: number;
  verifiedBy: string | null;
}): Promise<{ error: unknown | null; verifiedAt: string }> {
  const verifiedAt = new Date().toISOString();
  const { error } = await supabase.from('health_maintenance_balances').upsert(
    {
      customer_id: params.customerId,
      clinic_id: params.clinicId,
      verified_balance: Math.max(0, Math.round(params.verifiedBalance)),
      verified_at: verifiedAt,
      verified_by: params.verifiedBy,
      updated_at: verifiedAt,
    },
    { onConflict: 'customer_id' },
  );
  return { error, verifiedAt };
}
