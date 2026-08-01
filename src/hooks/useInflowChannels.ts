/**
 * useInflowChannels — 접수 유입경로(inflow_channel) 필수 선택 드롭다운 옵션 로더
 * T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE (dev-foot)
 *
 * DA CONSULT-REPLY 조건부 GO(ADDITIVE) / codify=cross_crm_data_contract.md §36(v1.66).
 * 5-CRM 물리 동일(happy-flow-queue 정본과 스키마 일치).
 *
 *  · 소스 = system_codes(code_type='inflow_channel') ∩ code_availability 오버레이(센터별 노출).
 *  · RPC get_inflow_channels(p_clinic_id) SECURITY DEFINER 로 조회(비-PHI 라벨만).
 *  · 배포순서 graceful: RPC 미가용/에러(42P01·미배포) 시 [] 반환(throw 안 함) →
 *    상위에서 available=false 로 판별하여 강제선택 게이트를 완화(무중단).
 *  · referral_source / visit_route(legacy) 와 무접점. canonical 코드값(inbound./partner./internal. prefix)만 취급.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface InflowChannelOption {
  code: string;
  label: string;
  series: string | null;
  sortOrder: number;
  requiresReason: boolean;
}

interface InflowRpcRow {
  code: string;
  label: string;
  series: string | null;
  sort_order: number | null;
  requires_reason: boolean | null;
}

async function fetchInflowChannels(clinicId: string): Promise<InflowChannelOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_inflow_channels', {
    p_clinic_id: clinicId,
  });
  if (error) {
    // deploy-order graceful: RPC 부재/에러 → 빈값(throw 금지) → 강제선택 게이트 완화.
    console.warn('[useInflowChannels] RPC 미가용 — 유입경로 강제선택 게이트 완화:', error.message);
    return [];
  }
  return ((data ?? []) as InflowRpcRow[])
    .map((r) => ({
      code: r.code,
      label: r.label,
      series: r.series ?? null,
      sortOrder: r.sort_order ?? 0,
      requiresReason: r.requires_reason === true,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function useInflowChannels(clinicId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['inflow-channels', clinicId ?? 'none'],
    enabled: !!clinicId,
    staleTime: 60_000,
    queryFn: () => fetchInflowChannels(clinicId!),
  });

  const options = query.data ?? [];
  return {
    ...query,
    options,
    /** RPC 가 실제 코드를 반환했는가(배포 완료). false = 미배포/오버레이 전부숨김 → 강제선택 게이트 완화. */
    available: options.length > 0,
    /** code → requiresReason 판별 (inbound.etc 사유 필수). */
    requiresReason: (code: string | null | undefined) =>
      !!code && options.some((o) => o.code === code && o.requiresReason),
  };
}
