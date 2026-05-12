/**
 * Chart2InsuranceCalcPanel — 2번차트 건보 자격등급 변경 시 실시간 진료비 자동산정
 *
 * T-20260511-foot-C2-INSURANCE-AUTO-CALC
 * T-20260512-foot-TREATMENT-SET: serviceCodeFilter + diseaseCodes 추가
 *
 * - refreshTrigger 증가 시 자격등급 재조회 → calcCopaymentBatch 자동 실행
 * - 클리닉의 급여 서비스 전체 일괄 산정 결과를 compact 패널로 표시
 * - 비급여 항목: 정가만 표시 (기존 로직 동일)
 * - 등급 미확인: "일반(30%) 기본 적용" 안내 + 결과 표시
 * - [진료세트] serviceCodeFilter 제공 시 해당 service_code 서비스만 필터링
 * - [진료세트] diseaseCodes 제공 시 상병코드 배지로 표시
 *
 * 기존 자산 재사용:
 *   - calcCopaymentBatch (useInsurance.ts)
 *   - useInsuranceGrade (useInsurance.ts)
 *   - INSURANCE_GRADE_LABELS, HIRA_CATEGORY_LABELS (insurance.ts)
 */

import { useEffect, useMemo, useState } from 'react';
import { Hash, ShieldCheck, Syringe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatAmount } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useInsuranceGrade, calcCopaymentBatch } from '@/hooks/useInsurance';
import {
  HIRA_CATEGORY_LABELS,
  INSURANCE_GRADE_LABELS,
  type CopaymentResult,
  type HiraCategory,
  type InsuranceGrade,
} from '@/lib/insurance';

interface CoveredService {
  id: string;
  name: string;
  hira_code: string | null;
  hira_score: number | null;
  hira_category: HiraCategory | null;
  is_insurance_covered: boolean;
  price: number;
  service_code: string | null;
}

interface Props {
  customerId: string;
  clinicId: string;
  /**
   * InsuranceGradeSelect.onChanged 발생마다 증가하는 카운터.
   * 증가 시 useInsuranceGrade.refresh() → calcCopaymentBatch 재실행.
   */
  refreshTrigger?: number;
  /**
   * T-20260512-foot-TREATMENT-SET: 진료세트에서 선택된 삽입코드 목록.
   * 제공 시 해당 service_code 서비스만 필터링해서 표시.
   * 빈 배열이면 전체 표시.
   */
  serviceCodeFilter?: string[];
  /**
   * T-20260512-foot-TREATMENT-SET: 진료세트에서 선택된 상병코드 목록.
   * 배지로 표시만 (계산 없음).
   */
  diseaseCodes?: string[];
  /** 현재 선택된 진료세트 이름 (헤더에 표시) */
  activeSetName?: string;
}

export function Chart2InsuranceCalcPanel({
  customerId,
  clinicId,
  refreshTrigger = 0,
  serviceCodeFilter,
  diseaseCodes,
  activeSetName,
}: Props) {
  const { grade, verifiedAt, refresh: refreshGrade } = useInsuranceGrade(customerId);
  const [services, setServices] = useState<CoveredService[]>([]);
  const [results, setResults] = useState<Map<string, CopaymentResult>>(new Map());
  const [calcLoading, setCalcLoading] = useState(false);
  const [servicesLoaded, setServicesLoaded] = useState(false);

  // refreshTrigger 증가 시 등급 재조회 (InsuranceGradeSelect.onChanged 연동)
  useEffect(() => {
    if (refreshTrigger > 0) {
      refreshGrade();
    }
  }, [refreshTrigger, refreshGrade]);

  // 급여 서비스 1회 로드 (service_code 포함 — 진료세트 필터링용)
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('services')
        .select('id, name, hira_code, hira_score, hira_category, is_insurance_covered, price, service_code')
        .eq('clinic_id', clinicId)
        .eq('is_insurance_covered', true)
        .eq('active', true)
        .order('hira_category', { ascending: true })
        .order('name', { ascending: true });
      if (!cancelled) {
        setServices(
          ((data ?? []) as CoveredService[]).map((s) => ({
            id: s.id,
            name: s.name,
            hira_code: s.hira_code ?? null,
            hira_score: s.hira_score ?? null,
            hira_category: (s.hira_category ?? null) as HiraCategory | null,
            is_insurance_covered: !!s.is_insurance_covered,
            price: s.price ?? 0,
            service_code: (s as CoveredService).service_code ?? null,
          })),
        );
        setServicesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  // 등급 또는 서비스 목록 확정 시 일괄 산정
  useEffect(() => {
    if (!servicesLoaded || services.length === 0 || !customerId || !clinicId) return;
    let cancelled = false;
    (async () => {
      setCalcLoading(true);
      const map = await calcCopaymentBatch(
        services.map((s) => s.id),
        customerId,
        clinicId,
      );
      if (!cancelled) {
        setResults(map);
        setCalcLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grade, services, servicesLoaded, customerId, clinicId]);

  // T-20260512: totals는 filteredServices 기준으로만 합산
  // (hasFilter/filteredServices는 아래에서 정의되므로 여기서는 serviceCodeFilter로 판단)
  const totals = useMemo(() => {
    let base = 0;
    let covered = 0;
    let copay = 0;
    const hasF = serviceCodeFilter && serviceCodeFilter.length > 0;
    if (hasF) {
      // 필터 적용 시: filteredServices와 교차하는 results만 합산
      const codeSet = new Set(serviceCodeFilter!.map((c) => c.toUpperCase()));
      for (const svc of services) {
        if (!svc.service_code || !codeSet.has(svc.service_code.toUpperCase())) continue;
        const r = results.get(svc.id);
        if (r) {
          base += r.base_amount;
          covered += r.insurance_covered_amount;
          copay += r.copayment_amount;
        }
      }
    } else {
      for (const r of results.values()) {
        base += r.base_amount;
        covered += r.insurance_covered_amount;
        copay += r.copayment_amount;
      }
    }
    return { base, covered, copay };
  }, [results, services, serviceCodeFilter]);

  const isUnverified = !grade || grade === 'unverified';
  const gradeLabel = INSURANCE_GRADE_LABELS[(grade ?? 'unverified') as InsuranceGrade];

  // T-20260512-foot-TREATMENT-SET: 진료세트 필터 적용
  // serviceCodeFilter가 비어있지 않으면 해당 코드의 서비스만 표시
  const hasFilter = serviceCodeFilter && serviceCodeFilter.length > 0;
  const filteredServices = useMemo(() => {
    if (!hasFilter) return services;
    const codeSet = new Set(serviceCodeFilter!.map((c) => c.toUpperCase()));
    return services.filter(
      (s) => s.service_code && codeSet.has(s.service_code.toUpperCase()),
    );
  }, [services, serviceCodeFilter, hasFilter]);

  // 급여 서비스 없으면 패널 미렌더링
  // (필터 적용 시에는 필터 후 결과가 없어도 상병코드 섹션 때문에 렌더)
  if (servicesLoaded && services.length === 0 && !hasFilter) return null;

  // 카테고리별 그루핑 (필터 적용)
  const grouped = new Map<HiraCategory | 'other', CoveredService[]>();
  for (const s of filteredServices) {
    const k = (s.hira_category ?? 'other') as HiraCategory | 'other';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(s);
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/30 mt-2">
      {/* 헤더 */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-teal-100">
        <ShieldCheck className="h-3 w-3 text-teal-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-teal-800">
            급여 진료비 자동산정
          </span>
          {/* T-20260512: 진료세트 이름 표시 */}
          {activeSetName && (
            <span className="ml-1.5 text-[9px] text-teal-600 font-normal">
              ({activeSetName})
            </span>
          )}
        </div>
        <Badge
          variant={isUnverified ? 'secondary' : 'teal'}
          className="text-[9px] px-1 py-0 shrink-0"
        >
          {gradeLabel}
        </Badge>
        {calcLoading && (
          <span className="text-[9px] text-muted-foreground shrink-0">산출 중…</span>
        )}
      </div>

      <div className="px-2.5 py-2 space-y-1.5">
        {/* T-20260512: 상병코드 배지 표시 */}
        {diseaseCodes && diseaseCodes.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <Hash className="h-2.5 w-2.5 text-purple-500 shrink-0" />
            <span className="text-[9px] text-purple-600 font-medium mr-0.5">상병</span>
            {diseaseCodes.map((code) => (
              <span
                key={code}
                className="inline-flex items-center rounded px-1 py-0 bg-purple-50 border border-purple-200 text-[9px] font-mono text-purple-700"
              >
                {code}
              </span>
            ))}
          </div>
        )}

        {/* T-20260512: 필터 모드에서 매칭 서비스 없으면 안내 */}
        {hasFilter && filteredServices.length === 0 && servicesLoaded && (
          <div className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
            <div className="flex items-center gap-1">
              <Syringe className="h-2.5 w-2.5 shrink-0" />
              세트의 삽입코드와 일치하는 급여 서비스가 없습니다.
            </div>
            <div className="text-[9px] mt-0.5 text-amber-600">
              서비스 관리에서 service_code를 확인하세요.
            </div>
          </div>
        )}

        {/* 등급 미확인 안내 */}
        {isUnverified && filteredServices.length > 0 && (
          <div className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
            ⚠ 등급 미확인 — <strong>일반(30%)</strong> 기본 적용
          </div>
        )}

        {/* 카테고리별 서비스 목록 */}
        {Array.from(grouped.entries()).map(([cat, list]) => (
          <div key={cat} className="space-y-1">
            {grouped.size > 1 && (
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                {cat === 'other' ? '기타' : HIRA_CATEGORY_LABELS[cat as HiraCategory]}
              </div>
            )}
            {list.map((svc) => {
              const r = results.get(svc.id);
              return (
                <div
                  key={svc.id}
                  className="flex items-center justify-between gap-2 rounded border border-teal-100 bg-white px-2 py-1 text-[10px]"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-gray-900 truncate">{svc.name}</span>
                    {svc.hira_code && (
                      <span className="text-muted-foreground tabular-nums">
                        {svc.hira_code} · {svc.hira_score}점
                      </span>
                    )}
                  </div>
                  {r ? (
                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <span className="text-muted-foreground">
                        수가 {formatAmount(r.base_amount)}
                      </span>
                      <span className="font-semibold text-teal-700">
                        본인 {formatAmount(r.copayment_amount)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {formatAmount(svc.price)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* 합계 (산정 결과가 있을 때만) */}
        {results.size > 0 && (
          <div className="rounded border border-teal-200 bg-white px-2.5 py-1.5 space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">총 수가</span>
              <span className="tabular-nums">{formatAmount(totals.base)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">건보 부담</span>
              <span className="tabular-nums text-emerald-700">{formatAmount(totals.covered)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-semibold border-t border-teal-100 pt-0.5 mt-0.5">
              <span>본인 부담 합계</span>
              <span className="tabular-nums text-teal-700">{formatAmount(totals.copay)}</span>
            </div>
            {verifiedAt && (
              <div className="text-[9px] text-muted-foreground pt-0.5">
                ※ 등급 검증일 {verifiedAt.slice(0, 10)} 기준
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
