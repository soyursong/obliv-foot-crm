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
