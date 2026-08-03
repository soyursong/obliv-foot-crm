/**
 * useVisitNatures — 접수 방문성격(visit_nature) 선택 드롭다운 옵션 로더
 * T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED (dev-foot)
 *
 * DA CONSULT-REPLY 조건부 GO(ADDITIVE) / SSOT da_decision_xcrm_visit_nature_axis_standardize_20260803.md.
 * inflow_channel lane(useInflowChannels)의 자매 축 — 동일 system_codes/code_availability 오버레이 패턴.
 *
 *  · 소스 = system_codes(code_type='visit_nature') ∩ code_availability 오버레이(센터별 노출).
 *  · foot 은 experience 미노출(body 전용) → RPC 가 new/revisit/fulfillment 3종만 반환.
 *  · RPC get_visit_natures(p_clinic_id) SECURITY DEFINER 로 조회(비-PHI 라벨만).
 *  · 배포순서 graceful: RPC 미가용/에러(42P01·미배포) 시 [] 반환(throw 안 함) →
 *    상위에서 available=false 로 판별하여 picker 미노출·forward default(visit_type 크로스워크)로 폴백(무중단).
 *  · visit_nature ⊥ inflow_channel ⊥ visit_type 직교 축(방화벽) — 서로 write 하지 않는다.
 *  · deriveDefault: 접수시점 visit_type → visit_nature forward default(new→new, returning→revisit). fulfillment 는 스태프 명시 선택.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface VisitNatureOption {
  code: string;
  label: string;
  series: string | null;
  sortOrder: number;
}

interface VisitNatureRpcRow {
  code: string;
  label: string;
  series: string | null;
  sort_order: number | null;
}

/** forward default 크로스워크 — 접수시점 visit_type → visit_nature (보수적: fulfillment 자동승격 금지). */
export function deriveVisitNatureDefault(visitType: string | null | undefined): string | null {
  if (visitType === 'new') return 'new';
  if (visitType === 'returning') return 'revisit';
  return null; // 미포착 → NULL(강제 대입 금지)
}

async function fetchVisitNatures(clinicId: string): Promise<VisitNatureOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_visit_natures', {
    p_clinic_id: clinicId,
  });
  if (error) {
    // deploy-order graceful: RPC 부재/에러 → 빈값(throw 금지) → picker 미노출·크로스워크 default 폴백.
    console.warn('[useVisitNatures] RPC 미가용 — 방문성격 picker 미노출(default 폴백):', error.message);
    return [];
  }
  return ((data ?? []) as VisitNatureRpcRow[])
    .map((r) => ({
      code: r.code,
      label: r.label,
      series: r.series ?? null,
      sortOrder: r.sort_order ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function useVisitNatures(clinicId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['visit-natures', clinicId ?? 'none'],
    enabled: !!clinicId,
    staleTime: 60_000,
    queryFn: () => fetchVisitNatures(clinicId!),
  });

  const options = query.data ?? [];
  return {
    ...query,
    options,
    /** RPC 가 실제 코드를 반환했는가(배포 완료). false = 미배포/오버레이 전부숨김 → picker 미노출. */
    available: options.length > 0,
    /** code 유효성(현 센터 노출 코드인가). */
    isValid: (code: string | null | undefined) => !!code && options.some((o) => o.code === code),
  };
}
