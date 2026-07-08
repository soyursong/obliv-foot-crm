/**
 * useTreatmentStandardPrices — 시술유형별 1회 정상가(정찰가) 마스터 SSOT
 * T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE (탭1 정찰가 기준표 / AC-8·AC-10)
 *
 * DA CONSULT-REPLY(DA-20260708-FOOT-PKGSTATS) canonical:
 *  · 마스터 = treatment_standard_prices (전용 테이블). UNIQUE(clinic_id, treatment_type), RLS clinic 격리.
 *  · prefill = 커스텀 생성 시 treatment_type 선택 → 이 마스터의 standard_price 를 packages.reference_price 로
 *    복사(스냅샷). live join 아님 — 마스터 값이 나중에 바뀌어도 과거 패키지 할인율 소급 변동 없음.
 *  · 5토큰 = TREATMENT_TYPES(비가열/가열/포돌로게/수액/Re:Born). 저장 canonical, 표시라벨은 treatmentTypeLabel.
 *
 * 방어: 마이그 미배포 환경(42P01 relation 없음)에서도 앱이 죽지 않도록 빈 맵으로 degrade.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TREATMENT_TYPES, type TreatmentType, type TreatmentStandardPrice } from '@/lib/types';

export type StandardPriceMap = Record<TreatmentType, number | null>;

function emptyMap(): StandardPriceMap {
  return TREATMENT_TYPES.reduce((acc, t) => {
    acc[t] = null;
    return acc;
  }, {} as StandardPriceMap);
}

async function fetchStandardPrices(clinicId: string): Promise<{ rows: TreatmentStandardPrice[]; map: StandardPriceMap; available: boolean }> {
  const { data, error } = await supabase
    .from('treatment_standard_prices')
    .select('id, clinic_id, treatment_type, standard_price, updated_by, created_at, updated_at')
    .eq('clinic_id', clinicId);
  if (error) {
    // 테이블 미배포(42P01) → degrade(빈 맵, prefill 비활성). 그 외 에러는 전파.
    if (/treatment_standard_prices|42P01|does not exist|relation/i.test(error.message ?? '')) {
      return { rows: [], map: emptyMap(), available: false };
    }
    throw error;
  }
  const rows = (data ?? []) as TreatmentStandardPrice[];
  const map = emptyMap();
  for (const r of rows) {
    if ((TREATMENT_TYPES as readonly string[]).includes(r.treatment_type)) {
      map[r.treatment_type] = r.standard_price;
    }
  }
  return { rows, map, available: true };
}

export function useTreatmentStandardPrices(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['treatment_standard_prices', clinicId],
    enabled: !!clinicId,
    staleTime: 30_000,
    queryFn: () => fetchStandardPrices(clinicId!),
  });

  /** 탭1 정찰가 기준표 저장 — clinic×treatment_type upsert(멱등, UNIQUE 충돌 시 갱신). */
  const saveStandardPrice = useCallback(
    async (treatmentType: TreatmentType, price: number, updatedBy?: string | null) => {
      if (!clinicId) throw new Error('clinicId 필요');
      const { error } = await supabase
        .from('treatment_standard_prices')
        .upsert(
          {
            clinic_id: clinicId,
            treatment_type: treatmentType,
            standard_price: Math.max(0, Math.round(price || 0)),
            updated_by: updatedBy ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clinic_id,treatment_type' },
        );
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['treatment_standard_prices', clinicId] });
    },
    [clinicId, qc],
  );

  return {
    ...query,
    map: query.data?.map ?? emptyMap(),
    rows: query.data?.rows ?? [],
    available: query.data?.available ?? false,
    saveStandardPrice,
  };
}
