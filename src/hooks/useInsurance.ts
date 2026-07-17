/**
 * 건보 본인부담 산출 훅 — T-20260504-foot-INSURANCE-COPAYMENT
 *
 * - useCalcCopayment: 단일 service × customer 산출 (RPC calc_copayment)
 * - useCalcCopaymentBatch: 여러 서비스 한번에 (병렬)
 * - updateInsuranceGrade: 고객 등급 수동 갱신 + verified_at 자동
 *
 * 서버 RPC가 진실의 원천. 클라이언트는 호출만.
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  CopaymentResult,
  InsuranceGrade,
  InsuranceGradeSource,
} from '@/lib/insurance';

interface CalcParams {
  serviceId: string | null | undefined;
  customerId: string | null | undefined;
  clinicId: string | null | undefined;
  visitDate?: string;
}

interface CalcCopaymentRpcRow {
  base_amount: number;
  insurance_covered_amount: number;
  copayment_amount: number;
  exempt_amount: number;
  applied_rate: number;
  applied_grade: InsuranceGrade;
  /** 데이터 불완전 BLOCK (calc_copayment v1.2+). 구버전 RPC 는 undefined → false 처리. */
  data_incomplete?: boolean;
}

/** 단일 서비스 본인부담 산출 (RPC) */
export function useCalcCopayment({ serviceId, customerId, clinicId, visitDate }: CalcParams) {
  const [data, setData] = useState<CopaymentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId || !customerId || !clinicId) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: rows, error: rpcErr } = await supabase.rpc('calc_copayment', {
        p_service_id: serviceId,
        p_customer_id: customerId,
        p_clinic_id: clinicId,
        p_visit_date: visitDate ?? new Date().toISOString().slice(0, 10),
      });
      if (cancelled) return;
      setLoading(false);
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      // PG returns table → array of 1 row
      const row = (rows as CalcCopaymentRpcRow[] | null)?.[0];
      if (row) {
        setData({
          base_amount: row.base_amount,
          insurance_covered_amount: row.insurance_covered_amount,
          copayment_amount: row.copayment_amount,
          exempt_amount: row.exempt_amount,
          applied_rate: Number(row.applied_rate),
          applied_grade: row.applied_grade,
          data_incomplete: row.data_incomplete ?? false,
        });
      } else {
        setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, customerId, clinicId, visitDate]);

  return { data, loading, error };
}

/** 여러 서비스 일괄 산출 — 결제 다이얼로그/세부내역서용 */
export async function calcCopaymentBatch(
  serviceIds: string[],
  customerId: string,
  clinicId: string,
  visitDate?: string,
): Promise<Map<string, CopaymentResult>> {
  const date = visitDate ?? new Date().toISOString().slice(0, 10);
  const results = await Promise.all(
    serviceIds.map(async (sid) => {
      const { data, error } = await supabase.rpc('calc_copayment', {
        p_service_id: sid,
        p_customer_id: customerId,
        p_clinic_id: clinicId,
        p_visit_date: date,
      });
      if (error) return [sid, null] as const;
      const row = (data as CalcCopaymentRpcRow[] | null)?.[0];
      return [
        sid,
        row
          ? {
              base_amount: row.base_amount,
              insurance_covered_amount: row.insurance_covered_amount,
              copayment_amount: row.copayment_amount,
              exempt_amount: row.exempt_amount,
              applied_rate: Number(row.applied_rate),
              applied_grade: row.applied_grade,
              data_incomplete: row.data_incomplete ?? false,
            }
          : null,
      ] as const;
    }),
  );
  const map = new Map<string, CopaymentResult>();
  for (const [sid, res] of results) {
    if (res) map.set(sid, res);
  }
  return map;
}

/**
 * 건보 등급 확정 재정산 — T-20260714-foot-INSGRADE-VERIFY-RESETTLE (SSOT §2-2-5)
 *
 * grade=null 급여방문에서 general 30% 로 잠정징수된 수납을, 등급 확정 후 확정 본인부담과
 * 대조해 차액(refund/추가징수)을 산출·처리한다. 서버 RPC resettle_insurance_grade 가 진실의
 * 원천 — calc_copayment authority 위에서만 산출(병렬 계산경로 신설 금지).
 *
 * ★ dryRun=true(기본) = 미리보기(write 없음). commit(dryRun=false) = Layer2 MONEY(실 refund/추가징수)
 *   → 대표·회계 게이트(money_gate) 해제 후에만 호출. UX 는 기본 미리보기로 금액을 노출하고, 실 처리는
 *   게이트 확인 다이얼로그를 거친다.
 * ★ 재정산은 등급이 이미 확정(customers.insurance_grade 갱신)된 뒤 호출한다(§2-2-4 endgame).
 */
export interface ResettleResult {
  ok: boolean;
  dry_run?: boolean;
  committed?: boolean;
  blocked?: boolean;
  reason?: string;
  error?: string;
  confirmed_grade?: InsuranceGrade | null;
  covered_count?: number;
  confirmed_copay?: number;
  provisional_copay?: number;
  refund?: number;
  additional?: number;
  paid_total?: number;
  already_resettled?: boolean;
  orig_payment_id?: string | null;
  resettle_payment_id?: string | null;
}

export async function resettleInsuranceGrade(
  checkInId: string,
  opts?: { dryRun?: boolean; confirmedGrade?: InsuranceGrade | null; method?: string },
): Promise<ResettleResult> {
  const { data, error } = await supabase.rpc('resettle_insurance_grade', {
    p_check_in_id: checkInId,
    p_confirmed_grade: opts?.confirmedGrade ?? null,
    p_dry_run: opts?.dryRun ?? true,
    p_method: opts?.method ?? 'cash',
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return (data ?? { ok: false, error: '재정산 응답이 비어 있습니다.' }) as ResettleResult;
}

/** 고객 자격등급 수동 갱신 — verified_at 자동 갱신 */
export async function updateInsuranceGrade(
  customerId: string,
  grade: InsuranceGrade,
  source: InsuranceGradeSource,
  memo?: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('customers')
    .update({
      insurance_grade: grade,
      insurance_grade_source: source,
      insurance_grade_verified_at: new Date().toISOString(),
      insurance_grade_memo: memo ?? null,
    })
    .eq('id', customerId);
  return { error: error?.message ?? null };
}

/** 고객 등급 정보 단건 조회 */
export function useInsuranceGrade(customerId: string | null | undefined) {
  const [grade, setGrade] = useState<InsuranceGrade | null>(null);
  const [source, setSource] = useState<InsuranceGradeSource | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const { data } = await supabase
      .from('customers')
      .select('insurance_grade, insurance_grade_source, insurance_grade_verified_at, insurance_grade_memo')
      .eq('id', customerId)
      .maybeSingle();
    setLoading(false);
    if (data) {
      setGrade((data.insurance_grade ?? null) as InsuranceGrade | null);
      setSource((data.insurance_grade_source ?? null) as InsuranceGradeSource | null);
      setVerifiedAt(data.insurance_grade_verified_at ?? null);
      setMemo(data.insurance_grade_memo ?? null);
    }
  }, [customerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { grade, source, verifiedAt, memo, loading, refresh };
}
