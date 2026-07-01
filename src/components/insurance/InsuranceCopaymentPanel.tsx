/**
 * InsuranceCopaymentPanel — 결제 다이얼로그 내 급여 진료비 미리보기
 *
 * T-20260504-foot-INSURANCE-COPAYMENT (최초 구현)
 * T-20260520-foot-INS-UI              (AC-4: insurance_claims 연동 / AC-5: 이중기록 방지)
 *
 * 저장 전략:
 *  - service_charges (append-only 감사 로그) — 기존 흐름 유지 (AC-5)
 *  - insurance_claims + claim_items (현재 청구 상태 upsert) — 신규 (AC-4)
 *    check_in_id 기준으로 draft claim 1개만 유지.
 *    재저장 시: 기존 claim_items 삭제 → 재삽입, claim 합계 갱신.
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

  /**
   * 산출 이력 저장
   *
   * AC-5: service_charges 는 append-only 감사 로그 — 기존 로직 유지.
   * AC-4: insurance_claims 는 check_in_id 기준 upsert (draft 1건 유지).
   *        재저장 시 claim_items 를 삭제 후 재삽입하여 최신 상태 보존.
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
    if (chargeErr) {
      setSaving(false);
      setSavedAt(`저장 실패: ${chargeErr.message}`);
      return;
    }

    // ── 2. insurance_claims UPSERT (check_in_id 기준 draft 1건) ──────────
    // check_in_id 로 기존 draft claim 조회
    let claimId: string | null = null;

    const { data: existingClaim } = await supabase
      .from('insurance_claims')
      .select('id')
      .eq('check_in_id', checkIn.id)
      .eq('claim_status', 'draft')
      .maybeSingle();

    if (existingClaim?.id) {
      // 기존 claim 재사용 — claim_items 삭제 후 재삽입
      claimId = existingClaim.id;
      await supabase.from('claim_items').delete().eq('claim_id', claimId);

      // 합계 갱신
      const { error: updateErr } = await supabase
        .from('insurance_claims')
        .update({
          total_base:       totals.base,
          total_copayment:  totals.copay,
          total_covered:    totals.covered,
          visit_date:       checkIn.checked_in_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        })
        .eq('id', claimId);

      if (updateErr) {
        setSaving(false);
        setSavedAt(`청구 갱신 실패: ${updateErr.message}`);
        return;
      }
    } else {
      // 신규 claim 생성
      const { data: newClaim, error: claimErr } = await supabase
        .from('insurance_claims')
        .insert({
          clinic_id:     checkIn.clinic_id,
          customer_id:   customerId,
          check_in_id:   checkIn.id,
          visit_date:    checkIn.checked_in_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
          claim_status:  'draft',
          total_base:    totals.base,
          total_copayment: totals.copay,
          total_covered: totals.covered,
        })
        .select('id')
        .single();

      if (claimErr || !newClaim) {
        setSaving(false);
        setSavedAt(`청구 생성 실패: ${claimErr?.message ?? '알 수 없는 오류'}`);
        return;
      }
      claimId = newClaim.id;
    }

    // ── 3. claim_items INSERT ─────────────────────────────────────────────
    const itemRows: Array<Record<string, unknown>> = [];
    for (const sid of selectedIds) {
      const r = results.get(sid);
      const svc = services.find((s) => s.id === sid);
      if (!r || !svc) continue;
      itemRows.push({
        claim_id:           claimId,
        service_id:         sid,
        hira_code:          svc.hira_code,
        hira_score:         svc.hira_score,
        quantity:           1,
        base_amount:        r.base_amount,
        copayment_amount:   r.copayment_amount,
        covered_amount:     r.insurance_covered_amount,
      });
    }

    const { error: itemErr } = await supabase.from('claim_items').insert(itemRows);
    setSaving(false);

    if (itemErr) {
      setSavedAt(`항목 저장 실패: ${itemErr.message}`);
      return;
    }

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
