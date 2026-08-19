/**
 * InsuranceCopaymentPanel — 결제 다이얼로그 내 급여 진료비 미리보기
 *
 * T-20260504-foot-INSURANCE-COPAYMENT (최초 구현)
 * T-20260520-foot-INS-UI              (AC-4: insurance_claims 연동 / AC-5: 이중기록 방지)
 * T-20260810-foot-INS-CLAIM-AUTODRAFT (B-2: claim draft 생성을 DB 트리거로 일원화)
 *
 * 저장 전략:
 *  - service_charges (append-only 감사 로그) — 이 패널은 이 한 가지만 쓴다.
 *  - insurance_claims + claim_items 는 더 이상 여기서 쓰지 않는다.
 *    service_charges AFTER INSERT 트리거(trg_service_charges_autodraft →
 *    fn_build_insurance_claim_draft)가 수납확정 자동경로를 포함한 모든 service_charges
 *    쓰기에서 draft claim 을 금액 verbatim 으로 파생한다(단일 생성자 = 수동/자동 이중생성 방지).
 *    B-2 이전엔 이 패널(수동)에서만 claim 이 생겨 현장 자동경로는 명세 0건이었다 → 근본원인 해소.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatAmount, formatDateDots } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useInsuranceGrade, calcCopaymentBatch } from '@/hooks/useInsurance';
import { redistributeVisitCopaymentMap } from '@/lib/copayCalc';
import {
  HIRA_CATEGORY_LABELS,
  INSURANCE_GRADE_LABELS,
  type CopaymentResult,
  type HiraCategory,
  type InsuranceGrade,
} from '@/lib/insurance';
import type { CheckIn, Service } from '@/lib/types';

interface Props {
  checkIn: CheckIn;
}

interface CoveredService {
  id: string;
  name: string;
  hira_code: string | null;
  hira_score: number | null;
  hira_category: HiraCategory | null;
  is_insurance_covered: boolean;
  price: number;
  copayment_rate_override: number | null;
}

export function InsuranceCopaymentPanel({ checkIn }: Props) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<CoveredService[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, CopaymentResult>>(new Map());
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const customerId = checkIn.customer_id;
  const { grade, verifiedAt } = useInsuranceGrade(customerId);

  // 클리닉의 급여 서비스 로드
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('services')
        .select('id, name, hira_code, hira_score, hira_category, is_insurance_covered, price, copayment_rate_override, active')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('is_insurance_covered', true)
        .eq('active', true)
        .order('hira_category', { ascending: true })
        .order('name', { ascending: true });
      if (!cancelled) {
        setServices(((data ?? []) as (Service & CoveredService)[]).map((s) => ({
          id: s.id,
          name: s.name,
          hira_code: s.hira_code ?? null,
          hira_score: s.hira_score ?? null,
          hira_category: (s.hira_category ?? null) as HiraCategory | null,
          is_insurance_covered: !!s.is_insurance_covered,
          price: s.price ?? 0,
          copayment_rate_override: s.copayment_rate_override ?? null,
        })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, checkIn.clinic_id]);

  // 선택 변경 시 일괄 산출
  useEffect(() => {
    if (!customerId || selectedIds.size === 0) {
      setResults(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      setCalcLoading(true);
      const map = await calcCopaymentBatch(
        Array.from(selectedIds),
        customerId,
        checkIn.clinic_id,
      );
      // T-20260819-foot-COPAY-VISIT-GRAIN: 항목당 합산 → 방문 grain 재배분(의급 정액·노인 구간 총액 판정).
      //   copayFromBase 1회(방문 총액) + 비례배분+잔차. 비급여/미비 항목은 무변경(단건 결과 유지).
      const coveredIds = new Set(
        services.filter((s) => s.is_insurance_covered === true).map((s) => s.id),
      );
      const visitMap = redistributeVisitCopaymentMap(map, coveredIds, grade);
      if (!cancelled) {
        setResults(visitMap);
        setCalcLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIds, customerId, checkIn.clinic_id, services, grade]);

  const totals = useMemo(() => {
    let base = 0;
    let covered = 0;
    let copay = 0;
    for (const r of results.values()) {
      base += r.base_amount;
      covered += r.insurance_covered_amount;
      copay += r.copayment_amount;
    }
    return { base, covered, copay };
  }, [results]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 산출 이력 저장
   *
   * service_charges (append-only 감사 로그) 만 INSERT 한다.
   * insurance_claims / claim_items 는 DB 트리거(trg_service_charges_autodraft)가
   *   이 INSERT 를 받아 금액 verbatim 으로 draft claim 을 파생한다(B-2). 여기서 직접 쓰지 않는다
   *   — 단일 생성자로 일원화해 수동/자동 이중생성을 막는다.
   */
  const persistCharges = async () => {
    if (!customerId) return;
    if (selectedIds.size === 0) return;
    setSaving(true);
    setSavedAt(null);

    // ── 1. service_charges INSERT (append-only 감사) ──────────────────────
    const chargeRows: Array<Record<string, unknown>> = [];
    for (const sid of selectedIds) {
      const r = results.get(sid);
      const svc = services.find((s) => s.id === sid);
      if (!r || !svc) continue;
      chargeRows.push({
        clinic_id:                  checkIn.clinic_id,
        check_in_id:                checkIn.id,
        customer_id:                customerId,
        service_id:                 sid,
        is_insurance_covered:       svc.is_insurance_covered,
        hira_score:                 svc.hira_score,
        base_amount:                r.base_amount,
        insurance_covered_amount:   r.insurance_covered_amount,
        copayment_amount:           r.copayment_amount,
        exempt_amount:              r.exempt_amount,
        customer_grade_at_charge:   r.applied_grade,
        copayment_rate_at_charge:   r.applied_rate,
      });
    }

    if (chargeRows.length === 0) {
      setSaving(false);
      return;
    }

    const { error: chargeErr } = await supabase.from('service_charges').insert(chargeRows);
    setSaving(false);
    if (chargeErr) {
      setSavedAt(`저장 실패: ${chargeErr.message}`);
      return;
    }

    // insurance_claims / claim_items 는 DB 트리거(trg_service_charges_autodraft)가
    //   위 service_charges INSERT 를 받아 draft claim 을 금액 verbatim 으로 파생한다(B-2).
    //   클라이언트에서 직접 쓰지 않는다 — 단일 생성자로 수동/자동 이중생성 방지.
    setSavedAt(`${chargeRows.length}건 산출·청구 이력 저장 완료`);
  };

  const groupedServices = useMemo(() => {
    const map = new Map<HiraCategory | 'other', CoveredService[]>();
    for (const s of services) {
      const k = (s.hira_category ?? 'other') as HiraCategory | 'other';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [services]);

  const gradeLabel = INSURANCE_GRADE_LABELS[(grade ?? 'unverified') as InsuranceGrade];
  const isUnverified = !grade || grade === 'unverified';

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-teal-800"
      >
        <ShieldCheck className="h-4 w-4" />
        <span className="flex-1 text-left">급여 진료비 미리보기 (건강보험)</span>
        <Badge variant={isUnverified ? 'secondary' : 'teal'} className="text-[10px] px-1.5 py-0">
          {gradeLabel}
        </Badge>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-teal-200 px-3 py-3">
          {/* 등급 미설정 안내 */}
          {isUnverified && (
            <div className="rounded bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              ⚠ 자격등급이 미설정입니다. 고객 차트에서 자격등급을 먼저 입력하세요.
              산출 결과는 <strong>일반(30%)</strong> 기본값 기준입니다.
            </div>
          )}

          {/* 서비스 카테고리별 그룹 */}
          {services.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              등록된 급여 서비스가 없습니다. 서비스 관리에서 HIRA 코드/점수를 매핑해 주세요.
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">선택한 급여 항목별 본인부담 산출</Label>
              {Array.from(groupedServices.entries()).map(([cat, list]) => (
                <div key={cat} className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {cat === 'other' ? '기타' : HIRA_CATEGORY_LABELS[cat as HiraCategory]}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {list.map((svc) => {
                      const selected = selectedIds.has(svc.id);
                      const r = results.get(svc.id);
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => toggle(svc.id)}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition',
                            selected
                              ? 'border-teal-500 bg-teal-100/60'
                              : 'border-input bg-background hover:bg-muted',
                          )}
                        >
                          <span className="flex flex-1 items-center gap-1.5">
                            {selected ? <X className="h-3.5 w-3.5 text-teal-700" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
                            <span className="font-medium">{svc.name}</span>
                            {svc.hira_code && (
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                ({svc.hira_code} · {svc.hira_score}점)
                              </span>
                            )}
                            {/* T-20260725-HIRASCORE-NULL-GENERAL-DATAINCOMPLETE-PARITY-GUARD:
                                급여 서비스 × 수가 점수 미입력 = 데이터미비 → 정가 임시부과 경고 배지 (재발 예방 net) */}
                            {svc.is_insurance_covered && svc.hira_score == null && (
                              <span className="inline-flex w-fit items-center rounded bg-amber-100 px-1 py-px text-[9px] font-medium text-amber-800">
                                ⚠ 데이터미비 · 정가 임시부과
                              </span>
                            )}
                          </span>
                          {r && (
                            <span className="flex items-center gap-1.5 tabular-nums text-[11px]">
                              <span className="text-muted-foreground">수가 {formatAmount(r.base_amount)}</span>
                              <span className="font-semibold text-teal-700">본인 {formatAmount(r.copayment_amount)}</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 합계 */}
          {selectedIds.size > 0 && (
            <div className="space-y-1 rounded bg-white border border-teal-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">총 수가</span>
                <span className="tabular-nums">{formatAmount(totals.base)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">건보 부담</span>
                <span className="tabular-nums text-emerald-700">{formatAmount(totals.covered)}</span>
              </div>
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>본인 부담</span>
                <span className="tabular-nums text-teal-700">{formatAmount(totals.copay)}</span>
              </div>
              {calcLoading && <div className="text-[11px] text-muted-foreground">산출 중…</div>}
              {verifiedAt && (
                <div className="text-[10px] text-muted-foreground">
                  ※ 등급 검증일 {formatDateDots(verifiedAt)} 기준
                </div>
              )}
            </div>
          )}

          {/* 산출 이력 저장 (감사 + 청구 기록) */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={persistCharges}
                disabled={saving || calcLoading}
                className="h-8"
              >
                {saving ? '저장 중…' : '산출 이력 저장'}
              </Button>
              {savedAt && (
                <span
                  className={cn(
                    'text-[11px]',
                    savedAt.includes('실패') ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {savedAt}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
