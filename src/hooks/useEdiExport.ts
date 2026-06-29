/**
 * useEdiExport.ts — EDI 표준 청구명세서 export 데이터 로더 + 산출 마킹
 *
 * T-20260629-foot-EDI-EXPORT-IMPL
 * SSOT: edi_export_data_contract_20260629.md
 *
 * - useExportableClaims: 청구 목록 + 현재 export 상태(edi_submissions)
 * - loadClaimForExport: 청구 1건 → 4테이블 read → buildEdiExport(가드 포함) → EdiExportResult
 *     · 진료내역: logical view insurance_claim_items(AC-9) 사용 → body 와 동일 logical 컬럼.
 *     · 등급·율 스냅샷: service_charges(§2-2 SSOT)에서 service_id 로 조인.
 * - markExported: edi_submissions 에 export_status='exported' 기록(★transmitted 자동전이 없음, D2 가드).
 *
 * 가드 로직은 ediExport.ts(순수 함수) SSOT. 이 훅은 데이터 조립만.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  buildEdiExport,
  exportPayloadRef,
  payloadFingerprint,
  EDI_EXPORT_FORMAT_VERSION,
  type EdiExportInput,
  type EdiExportResult,
  type EdiItemInput,
  type EdiDiagnosisInput,
} from '@/lib/ediExport';

export interface ExportableClaimRow {
  id: string;
  customer_id: string;
  customer_name: string | null;
  chart_number: string | null;
  visit_date: string;
  claim_status: string;
  total_base: number;
  total_copayment: number;
  total_covered: number;
  check_in_id: string | null;
  export_status: string | null;      // null | 'draft' | 'exported'
  exported_at: string | null;
}

/** 청구 목록(클리닉) + export 상태. 취소 청구 제외. */
export function useExportableClaims(clinicId: string | null | undefined) {
  const [rows, setRows] = useState<ExportableClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('insurance_claims')
      .select(`
        id, customer_id, check_in_id, visit_date, claim_status,
        total_base, total_copayment, total_covered,
        customers ( name, chart_number ),
        edi_submissions ( export_status, exported_at )
      `)
      .eq('clinic_id', clinicId)
      .neq('claim_status', 'cancelled')
      .order('visit_date', { ascending: false })
      .limit(300);

    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    const mapped: ExportableClaimRow[] = (data ?? []).map((r: Record<string, unknown>) => {
      const cust = r.customers as { name?: string; chart_number?: string } | null;
      const subs = (r.edi_submissions as Array<{ export_status?: string; exported_at?: string }> | null) ?? [];
      // 가장 최근 export 상태(exported 우선)
      const exported = subs.find((s) => s.export_status === 'exported') ?? subs[0] ?? null;
      return {
        id: r.id as string,
        customer_id: r.customer_id as string,
        customer_name: cust?.name ?? null,
        chart_number: cust?.chart_number ?? null,
        visit_date: r.visit_date as string,
        claim_status: r.claim_status as string,
        total_base: (r.total_base as number) ?? 0,
        total_copayment: (r.total_copayment as number) ?? 0,
        total_covered: (r.total_covered as number) ?? 0,
        check_in_id: (r.check_in_id as string) ?? null,
        export_status: exported?.export_status ?? null,
        exported_at: exported?.exported_at ?? null,
      };
    });
    setRows(mapped);
  }, [clinicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh };
}

/**
 * 청구 1건 → 표준 명세서 logical export 결과(가드 포함).
 * RLS(approved + clinic_id) 가 행 접근을 강제 → 본인 clinic 청구만 로드 가능.
 */
export async function loadClaimForExport(claimId: string): Promise<EdiExportResult> {
  // ── 1. 헤더(insurance_claims) + 환자 + 클리닉(요양기관기호) ──
  const { data: claim, error: claimErr } = await supabase
    .from('insurance_claims')
    .select(`
      id, clinic_id, customer_id, check_in_id, visit_date,
      total_base, total_copayment, total_covered,
      customers ( name, chart_number ),
      clinics ( name, nhis_code )
    `)
    .eq('id', claimId)
    .maybeSingle();

  if (claimErr) {
    return { ok: false, block_code: 'NO_ITEMS', block_reason: `청구 로드 실패: ${claimErr.message}` };
  }
  if (!claim) {
    return { ok: false, block_code: 'NO_ITEMS', block_reason: '청구를 찾을 수 없습니다(권한 또는 삭제됨).' };
  }
  const cust = claim.customers as { name?: string; chart_number?: string } | null;
  const clinic = claim.clinics as { name?: string; nhis_code?: string } | null;

  // ── 2. 진료내역 — logical view insurance_claim_items(AC-9) ──
  const { data: itemRows, error: itemErr } = await supabase
    .from('insurance_claim_items')
    .select('service_id, hira_code, hira_score, quantity, base_amount, copayment_amount, insurance_covered_amount')
    .eq('claim_id', claimId);
  if (itemErr) {
    return { ok: false, block_code: 'NO_ITEMS', block_reason: `진료내역 로드 실패: ${itemErr.message}` };
  }

  // ── 3. 등급·율 스냅샷(service_charges, §2-2 SSOT) — check_in_id 로 ──
  const chargeBySvc = new Map<string, {
    grade: string | null;
    rate: number | null;
    covered: boolean;
    hira_score: number | null;
  }>();
  if (claim.check_in_id) {
    const { data: charges } = await supabase
      .from('service_charges')
      .select('service_id, customer_grade_at_charge, copayment_rate_at_charge, is_insurance_covered, hira_score, calculated_at')
      .eq('check_in_id', claim.check_in_id)
      .order('calculated_at', { ascending: false });
    for (const c of (charges ?? []) as Array<Record<string, unknown>>) {
      const sid = c.service_id as string;
      if (chargeBySvc.has(sid)) continue; // 최신(첫 행) 유지
      chargeBySvc.set(sid, {
        grade: (c.customer_grade_at_charge as string) ?? null,
        rate: (c.copayment_rate_at_charge as number) ?? null,
        covered: Boolean(c.is_insurance_covered),
        hira_score: (c.hira_score as number) ?? null,
      });
    }
  }

  // 서비스명(표시용)
  const serviceIds = Array.from(new Set((itemRows ?? []).map((i) => i.service_id as string)));
  const svcNameById = new Map<string, { name: string | null; hira_category: string | null }>();
  if (serviceIds.length > 0) {
    const { data: svcs } = await supabase
      .from('services')
      .select('id, name, hira_category')
      .in('id', serviceIds);
    for (const s of (svcs ?? []) as Array<Record<string, unknown>>) {
      svcNameById.set(s.id as string, {
        name: (s.name as string) ?? null,
        hira_category: (s.hira_category as string) ?? null,
      });
    }
  }

  const items: EdiItemInput[] = (itemRows ?? []).map((i) => {
    const sid = i.service_id as string;
    const charge = chargeBySvc.get(sid);
    const svc = svcNameById.get(sid);
    return {
      service_id: sid,
      service_name: svc?.name ?? null,
      hira_code: (i.hira_code as string) ?? null,
      hira_category: svc?.hira_category ?? null,
      base_amount: (i.base_amount as number) ?? 0,
      copayment_amount: (i.copayment_amount as number) ?? 0,
      insurance_covered_amount: (i.insurance_covered_amount as number) ?? 0,
      grade_at_charge: charge?.grade ?? null,
      copayment_rate_at_charge: charge?.rate ?? null,
      // 스냅샷 없으면 보수적으로 급여 처리(가드가 hira_score null+비general 이면 BLOCK)
      is_insurance_covered: charge ? charge.covered : true,
      hira_score_at_charge: charge ? charge.hira_score : (i.hira_score as number) ?? null,
    };
  });

  // ── 4. 상병내역(insurance_claim_diagnoses, KCD) ──
  const { data: dxRows } = await supabase
    .from('insurance_claim_diagnoses')
    .select('kcd_code, is_primary, sort_order')
    .eq('claim_id', claimId)
    .order('sort_order', { ascending: true });
  const diagnoses: EdiDiagnosisInput[] = (dxRows ?? []).map((d) => ({
    kcd_code: d.kcd_code as string,
    is_primary: Boolean(d.is_primary),
    sort_order: (d.sort_order as number) ?? 0,
  }));

  const input: EdiExportInput = {
    claim: {
      claim_id: claim.id as string,
      clinic_nhis_code: clinic?.nhis_code ?? null,
      clinic_name: clinic?.name ?? null,
      visit_date: claim.visit_date as string,
      patient_name: cust?.name ?? null,
      patient_chart_no: cust?.chart_number ?? null,
      total_base: (claim.total_base as number) ?? 0,
      total_copayment: (claim.total_copayment as number) ?? 0,
      total_covered: (claim.total_covered as number) ?? 0,
    },
    items,
    diagnoses,
  };

  return buildEdiExport(input);
}

/**
 * export 산출 마킹 — edi_submissions 에 exported 상태 기록.
 * ★ transmitted 자동전이 없음(D2 가드). export_status 는 'exported' 까지만.
 * 청구당 1행(claim_id) upsert.
 */
export async function markExported(
  claimId: string,
  payloadFingerprintStr: string,
  exportedBy: string | null,
): Promise<{ error: string | null; ref: string }> {
  const ref = exportPayloadRef(claimId, payloadFingerprintStr);

  // 기존 edi_submissions 행 조회(전송 추적 테이블 — 1차 수동 청구 시 보통 없음)
  const { data: existing } = await supabase
    .from('edi_submissions')
    .select('id')
    .eq('claim_id', claimId)
    .limit(1)
    .maybeSingle();

  const payload = {
    export_status: 'exported' as const,
    export_format_version: EDI_EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    exported_by: exportedBy,
    export_payload_ref: ref,
    // ★ edi_status(전송) 는 건드리지 않음 — D2 전송 보류, 자동전이 금지.
  };

  if (existing?.id) {
    const { error } = await supabase.from('edi_submissions').update(payload).eq('id', existing.id);
    return { error: error?.message ?? null, ref };
  }
  const { error } = await supabase.from('edi_submissions').insert({ claim_id: claimId, ...payload });
  return { error: error?.message ?? null, ref };
}

export { payloadFingerprint };
