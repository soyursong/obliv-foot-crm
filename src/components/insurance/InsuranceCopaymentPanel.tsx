/**
 * InsuranceCopaymentPanel — 결제 다이얼로그 내 급여 진료비 미리보기
 *
 * T-20260504-foot-INSURANCE-COPAYMENT
 *
 * - 환자 등급(insurance_grade) 표시
 * - 클리닉의 급여 항목 (services where is_insurance_covered=true) 다중 선택
 * - 선택된 서비스별 calc_copayment RPC 호출 → 합계 표시
 * - 비급여 항목은 별 panel 없이 PaymentDialog 메모에 안내
 *
 * 기존 결제 로직 미변경 — 본인부담 미리보기/안내 전용. 실제 결제 row는 기존 흐름 그대로 payments / package_payments 에 기록.
 *
 * 제출 시 service_charges 테이블에 산출 이력 INSERT (감사·STATS용).
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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
      if (!cancelled) {
        setResults(map);
        setCalcLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIds, customerId, checkIn.clinic_id]);

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

  const persistCharges = async () => {
    if (!customerId) return;
    if (selectedIds.size === 0) return;
    setSaving(true);

    // 선택된 서비스별 산출 결과를 service_charges 에 INSERT
    const rows: Array<Record<string, unknown>> = [];
    for (const sid of selectedIds) {
      const r = results.get(sid);
      const svc = services.find((s) => s.id === sid);
      if (!r || !svc) continue;
      rows.push({
        clinic_id: checkIn.clinic_id,
        check_in_id: checkIn.id,
        customer_id: customerId,
        service_id: sid,
        is_insurance_covered: svc.is_insurance_covered,
        hira_score: svc.hira_score,
        base_amount: r.base_amount,
        insurance_covered_amount: r.insurance_covered_amount,
        copayment_amount: r.copayment_amount,
        exempt_amount: r.exempt_amount,
        customer_grade_at_charge: r.applied_grade,
        copayment_rate_at_charge: r.applied_rate,
      });
    }
    if (rows.length === 0) {
      setSaving(false);
      return;
    }
    const { error } = await supabase.from('service_charges').insert(rows);
    setSaving(false);
    if (error) {
      // Toast 는 호출자 부담 — 패널은 in-place 메시지만 (PaymentDialog 의 toast 사용 안 함)
      setSavedAt(`저장 실패: ${error.message}`);
      return;
    }
    setSavedAt(`${rows.length}건 산출 이력 저장 완료`);
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
                  ※ 등급 검증일 {verifiedAt.slice(0, 10)} 기준
                </div>
              )}
            </div>
          )}

          {/* 산출 이력 저장 (감사용) */}
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
              {savedAt && <span className="text-[11px] text-muted-foreground">{savedAt}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
