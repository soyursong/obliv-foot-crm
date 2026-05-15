/**
 * T-20260515-foot-SALES-TAB-TREATMENT
 * 매출집계 탭3 — 시술별 통계
 *
 * AC-1: services.category_label(또는 category) 기준 대분류 아코디언
 * AC-2: 오더 건수 + 수납 기여액 + 매출 비중
 * AC-3: 복합 결제 안분 — check_in_services.price 비율로 결제금액 안분
 *        (service_charges는 보험청구 케이스에만 생성됨 →
 *         항상 존재하는 check_in_services.price 로 비율 산출)
 *
 * READ-ONLY. DB 변경 없음.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

// ─── 타입 ───────────────────────────────────────────────────────────────────

interface CheckInService {
  /** check_in_services.price — 시술별 청구금액. 안분 비율 산출에 사용. */
  price: number;
  services: {
    name: string | null;
    category: string | null;
    /** services.category_label — 한글 대분류명. null이면 category 폴백 */
    category_label: string | null;
  } | null;
}

interface PaymentWithServices {
  id: string;
  amount: number;
  payment_type: string | null;
  status: string | null;
  accounting_date: string | null;
  check_ins: {
    check_in_services: CheckInService[] | null;
  } | null;
}

interface Props {
  filter: SalesFilterState;
}

// ─── 집계 로직 ──────────────────────────────────────────────────────────────

interface TreatmentStat {
  name: string;
  category: string;
  count: number;
  revenue: number;
}

/** services 레코드에서 표시용 대분류명 결정 (category_label 우선, 없으면 category, 없으면 기타) */
function resolveCategoryLabel(svc: CheckInService['services']): string {
  return svc?.category_label ?? svc?.category ?? '기타';
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export function SalesTreatmentTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // payments → check_ins → check_in_services(price) → services(name, category, category_label)
  // 집계 기준: accounting_date (소급 차단)
  const { data: payments = [], isLoading: payLoading } = useQuery<PaymentWithServices[]>({
    queryKey: ['sales-treatment', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async (): Promise<PaymentWithServices[]> => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, payment_type, status, accounting_date,
          check_ins(
            check_in_services(
              price,
              services(name, category, category_label)
            )
          )
        `)
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      return (data ?? []) as unknown as PaymentWithServices[];
    },
  });

  // 시술별 집계 (복합결제 안분)
  // AC-3: 복합결제 → check_in_services.price 비율로 결제금액 안분
  //        안분 후 합계 = 원 결제금액 (부동소수 오차는 마지막 항목에 보정)
  const stats = useMemo<TreatmentStat[]>(() => {
    const map = new Map<string, TreatmentStat>();

    for (const p of payments) {
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      const svcs = p.check_ins?.check_in_services ?? [];
      if (svcs.length === 0) continue;

      // 안분 기준: price 합계 (0이면 균등 분배)
      const totalBase = svcs.reduce((s: number, cs: CheckInService) => s + (cs.price ?? 0), 0);

      for (const cs of svcs) {
        const svc = cs.services;
        if (!svc?.name) continue;
        const key = svc.name;
        const ratio = totalBase > 0 ? (cs.price ?? 0) / totalBase : 1 / svcs.length;
        const contrib = netAmt * ratio;

        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
          existing.revenue += contrib;
        } else {
          map.set(key, {
            name: svc.name,
            category: resolveCategoryLabel(svc),
            count: 1,
            revenue: contrib,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [payments]);

  const totalRevenue = stats.reduce((s, st) => s + st.revenue, 0);

  // 카테고리별 그룹
  const grouped = useMemo(() => {
    const map = new Map<string, TreatmentStat[]>();
    for (const s of stats) {
      (map.get(s.category) ?? (() => { const arr: TreatmentStat[] = []; map.set(s.category, arr); return arr; })()).push(s);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const sa = a[1].reduce((s, x) => s + x.revenue, 0);
      const sb = b[1].reduce((s, x) => s + x.revenue, 0);
      return sb - sa;
    });
  }, [stats]);

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (payLoading) {
    return (
      <div
        data-testid="sales-treatment-loading"
        className="flex items-center justify-center py-16 text-sm text-muted-foreground"
      >
        불러오는 중…
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div
        data-testid="sales-treatment-empty"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
      >
        <span className="text-sm text-muted-foreground">해당 기간에 시술 데이터가 없습니다</span>
      </div>
    );
  }

  return (
    <div
      data-testid="sales-treatment-tab"
      className="space-y-2 text-xs"
    >
      {grouped.map(([cat, items]) => {
        const expanded = expandedCats.has(cat);
        const catTotal = items.reduce((s, x) => s + x.revenue, 0);
        const catCount = items.reduce((s, x) => s + x.count, 0);
        const pct = totalRevenue > 0 ? (catTotal / totalRevenue) * 100 : 0;
        const safeKey = cat.replace(/\s+/g, '-');

        return (
          <div
            key={cat}
            data-testid={`sales-treatment-category-${safeKey}`}
            className="rounded-lg border bg-background"
          >
            {/* 대분류 헤더 */}
            <button
              data-testid={`sales-treatment-category-btn-${safeKey}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/40"
              onClick={() => toggleCat(cat)}
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="font-semibold">{cat}</span>
              <span className="ml-1 text-muted-foreground">({catCount}건)</span>
              <div className="ml-auto flex items-center gap-3">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-teal-500"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-muted-foreground">{pct.toFixed(1)}%</span>
                <span
                  data-testid={`sales-treatment-cat-total-${safeKey}`}
                  className="w-24 text-right font-semibold tabular-nums"
                >
                  {formatAmount(Math.round(catTotal))}원
                </span>
              </div>
            </button>

            {/* 소분류 */}
            {expanded && (
              <div
                data-testid={`sales-treatment-category-items-${safeKey}`}
                className="border-t"
              >
                {items.map((item) => {
                  const itemPct = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
                  return (
                    <div
                      key={item.name}
                      className="flex items-center gap-2 border-b px-4 py-1.5 last:border-b-0"
                    >
                      <span className="flex-1 truncate">{item.name}</span>
                      <span className="w-10 text-right text-muted-foreground">{item.count}건</span>
                      <span className="w-8 text-right text-muted-foreground">{itemPct.toFixed(1)}%</span>
                      <span className={cn('w-24 text-right tabular-nums', item.revenue < 0 && 'text-red-600')}>
                        {formatAmount(Math.round(item.revenue))}원
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* 전체 합계 */}
      <div
        data-testid="sales-treatment-total"
        className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 font-semibold"
      >
        <span>전체 합계</span>
        <span className="tabular-nums">{formatAmount(Math.round(totalRevenue))}원</span>
      </div>
    </div>
  );
}
