/**
 * T-20260515-foot-SALES-TAB-TREATMENT
 * 매출집계 탭3 — 시술 종류별 매출
 *
 * T-20260725-foot-SALESTAB-TREATMENT-6BUCKET-WHITELIST
 *   (선행: T-20260725-foot-SALES-TREATMENT-TAB-WHITELIST6 — 화이트리스트 6버킷 도입)
 *   본 티켓: 버킷 분류 로직 이원화 제거 — resolveBucket 이 자체 키워드 판정을 재작성하지 않고
 *   PaymentMiniWindow 의 분류 SSOT(isCosmeticService / prepaidSessionType)를 **직접 import 재사용**.
 *   (결제창과 매출탭의 항목 귀속이 어긋나면 현장 혼란 → 단일 분류 소스로 일원화)
 *
 *   화이트리스트 6개 버킷만 표기. 6개 이외(수액·처방약·상병 등)는 이 탭 통계에서 제외(숨김),
 *   전체 합계는 6개 버킷 합산.
 *   버킷(표시명·순서 고정):
 *     1) 비가열레이저  2) 가열레이저  3) 포돌로게(내성)
 *     4) Reborn(각질)  5) 풋화장품    6) 진찰료(기본/서류/검사비)
 *   버킷 매칭 SSOT:
 *     - 화장품 = isCosmeticService(category/label === '풋화장품')  [PaymentMiniWindow export 재사용]
 *     - 레이저/포돌로게 = prepaidSessionType(코드우선 SZ035-30/35·BC1300MB08 + '비가열'>'가열' 순서 내장)
 *                          [PaymentMiniWindow export 재사용] · 'iv'(수액)은 6버킷 밖 → 제외
 *     - 진찰료 = category_label 기본/제증명/검사 (PMW 미분류 영역 → 로컬 판정 유지, 이원화 아님)
 *     - Reborn = DB 실제값 '리본'(RB001~003 / "리본 에센셜(각질)" 등) / '각질' 계열
 *                (영문 'Reborn' 매칭은 DB 0건 → 매칭 누락) · PMW 미분류 영역 → 로컬 판정 유지
 *   FE-only 표시 필터. no-DDL·no-schema. 원장 산식/날짜필터/시뮬 방어필터 무접촉.
 *
 * AC-1: services.name/category(_label) → 6개 버킷 매핑 후 버킷 단위 아코디언
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
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
// 버킷 분류 SSOT — 결제창(PaymentMiniWindow)과 동일 기준을 직접 재사용(이원화 방지).
import { isCosmeticService, prepaidSessionType } from '@/components/PaymentMiniWindow';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

// ─── 타입 ───────────────────────────────────────────────────────────────────

interface CheckInService {
  /** check_in_services.price — 시술별 청구금액. 안분 비율 산출에 사용. */
  price: number;
  /**
   * check_in_services.voided_at — soft-void 무효화 시각. NULL=유효, NOT NULL=비진성(집계 제외).
   * T-20260804-foot-COSMETIC-CORRECTION-CRM (Tier-C): 비진성 라인은 안분 base·기여에서 동시 제외.
   */
  voided_at: string | null;
  services: {
    name: string | null;
    category: string | null;
    /** services.category_label — 한글 대분류명. null이면 category 폴백 */
    category_label: string | null;
    /** services.service_code — prepaidSessionType 코드우선 매칭(SZ035-30/35·BC1300MB08)용 */
    service_code: string | null;
  } | null;
}

interface PaymentWithServices {
  id: string;
  amount: number;
  payment_type: string | null;
  status: string | null;
  accounting_date: string | null;
  /** 매출 방어필터용 — T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE */
  customer_id: string | null;
  check_ins: {
    check_in_services: CheckInService[] | null;
  } | null;
}

interface Props {
  filter: SalesFilterState;
}

// ─── 화이트리스트 6개 버킷 (T-20260725-foot-SALES-TREATMENT-TAB-WHITELIST6) ───
// 순서·표시명 고정. 이 6개만 표기하며 전체 합계도 이 6개 합산.

export type BucketId =
  | 'unheated'
  | 'heated'
  | 'podologue'
  | 'reborn'
  | 'cosmetic'
  | 'consult';

export const BUCKETS: { id: BucketId; label: string }[] = [
  { id: 'unheated', label: '비가열레이저' },
  { id: 'heated', label: '가열레이저' },
  { id: 'podologue', label: '포돌로게(내성)' },
  { id: 'reborn', label: 'Reborn(각질)' },
  { id: 'cosmetic', label: '풋화장품' },
  { id: 'consult', label: '진찰료(기본/서류/검사비)' },
];

// 진찰료 버킷 = 기본(진찰료·처치) + 서류(제증명) + 검사비(검사)
//   category_label: '기본' | '제증명' | '검사'  /  category: '기본' | '검사' | '진료'
const CONSULT_LABELS = ['기본', '제증명', '검사'];
const CONSULT_CATS = ['기본', '검사', '진료'];

/**
 * 시술 1건을 6개 화이트리스트 버킷 중 하나로 매핑. 미해당(수액·처방약·상병 등) → null(제외).
 * ★ 분류 이원화 방지: 화장품·레이저·포돌로게 판정은 PaymentMiniWindow 의 분류 SSOT를 직접 재사용한다.
 *   - 화장품     : isCosmeticService(category/label === '풋화장품') 우선 판정
 *                  (예: '발각질크림'은 각질 명칭이나 category='풋화장품' → 화장품 버킷)
 *   - 레이저/포돌로게: prepaidSessionType — 코드우선(SZ035-30/35·BC1300MB08) + '비가열'>'가열' 순서 내장.
 *                  반환 'iv'(수액)은 6버킷 밖 → 제외(null).
 *   - 진찰료     : category_label 기본/제증명/검사 (PMW 미분류 영역 → 로컬 판정)
 *   - Reborn     : DB 실제값 '리본'(RB001~003) / '각질' 계열 (PMW 미분류 영역 → 로컬 판정)
 */
export function resolveBucket(svc: CheckInService['services']): BucketId | null {
  if (!svc) return null;
  const name = svc.name ?? '';
  const cat = svc.category ?? '';
  const lab = svc.category_label ?? '';

  // 1) 풋화장품 — PaymentMiniWindow SSOT 재사용 (각질 명칭이어도 화장품 우선)
  if (isCosmeticService(svc)) return 'cosmetic';

  // 2) 진찰료(기본/서류=제증명/검사비=검사)
  if (CONSULT_LABELS.includes(lab) || CONSULT_CATS.includes(cat) || name.includes('진찰료')) {
    return 'consult';
  }

  // 3) 레이저/포돌로게 — PaymentMiniWindow SSOT 재사용 (코드우선 + 비가열>가열 순서 내장)
  switch (prepaidSessionType(svc)) {
    case 'unheated_laser':
      return 'unheated';
    case 'heated_laser':
      return 'heated';
    case 'podologue':
      return 'podologue';
    default:
      break; // 'iv'(수액) | null → 아래 Reborn 판정으로
  }

  // 4) Reborn(각질) — DB 실제값 '리본'(RB001~003) / '각질' 계열
  if (name.includes('리본') || name.includes('각질')) return 'reborn';

  // 5) 그 외(수액·처방약·상병 등) → 화이트리스트 제외
  return null;
}

// ─── 집계 로직 ──────────────────────────────────────────────────────────────

interface TreatmentStat {
  name: string;
  bucket: BucketId;
  count: number;
  revenue: number;
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
          id, amount, payment_type, status, accounting_date, customer_id,
          check_ins(
            check_in_services(
              price, voided_at,
              services(name, category, category_label, service_code)
            )
          )
        `)
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      // 방어필터: is_simulation=true 고객 결제 제외 (워크인 NULL 보존)
      const simIds = await getSimulationCustomerIds(clinic!.id);
      return excludeSimulationPaymentRows(
        (data ?? []) as unknown as PaymentWithServices[],
        simIds,
      );
    },
  });

  // 시술별 집계 (복합결제 안분)
  // AC-3: 복합결제 → check_in_services.price 비율로 결제금액 안분
  //        안분 후 합계 = 원 결제금액 (부동소수 오차는 마지막 항목에 보정)
  // WHITELIST6: resolveBucket === null 항목은 집계·합계에서 제외.
  const stats = useMemo<TreatmentStat[]>(() => {
    const map = new Map<string, TreatmentStat>();

    for (const p of payments) {
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      // T-20260804-foot-COSMETIC-CORRECTION-CRM (Tier-C): 비진성 soft-void 라인은 안분 base·기여에서 동시 제외.
      //   DA-20260805 census C2: 이 by-service breakdown 은 payload/전령 미feed(순수 표시) → filter GO(firewall breach 아님).
      //   voided 라인을 totalBase 에서도 빼야 잔여 genuine 라인이 결제액을 온전히 흡수(부분정정·과소귀속 방지).
      const svcs = (p.check_ins?.check_in_services ?? []).filter((cs) => !cs.voided_at);
      if (svcs.length === 0) continue;

      // 안분 기준: price 합계 (0이면 균등 분배)
      const totalBase = svcs.reduce((s: number, cs: CheckInService) => s + (cs.price ?? 0), 0);

      for (const cs of svcs) {
        const svc = cs.services;
        if (!svc?.name) continue;
        const bucket = resolveBucket(svc);
        if (!bucket) continue; // 화이트리스트 6개 이외 제외(숨김)

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
            bucket,
            count: 1,
            revenue: contrib,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [payments]);

  const totalRevenue = stats.reduce((s, st) => s + st.revenue, 0);
  const totalCount = stats.reduce((s, st) => s + st.count, 0);

  // 버킷별 그룹 — 화이트리스트 순서 고정 (매출순 정렬 X)
  const grouped = useMemo(() => {
    const byBucket = new Map<BucketId, TreatmentStat[]>();
    for (const s of stats) {
      const arr = byBucket.get(s.bucket) ?? [];
      arr.push(s);
      byBucket.set(s.bucket, arr);
    }
    // 버킷 내부 항목은 매출 desc
    return BUCKETS.map((b) => ({
      ...b,
      items: (byBucket.get(b.id) ?? []).sort((a, c) => c.revenue - a.revenue),
    }));
  }, [stats]);

  const toggleCat = (id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  // 화이트리스트 6개 버킷 전부 데이터 0 → 빈 상태 (AC-4)
  if (totalCount === 0) {
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
      {grouped.map(({ id, label, items }) => {
        const expanded = expandedCats.has(id);
        const catTotal = items.reduce((s, x) => s + x.revenue, 0);
        const catCount = items.reduce((s, x) => s + x.count, 0);
        const pct = totalRevenue > 0 ? (catTotal / totalRevenue) * 100 : 0;
        const hasItems = items.length > 0;

        return (
          <div
            key={id}
            data-testid={`sales-treatment-category-${id}`}
            className="rounded-lg border bg-background"
          >
            {/* 버킷 헤더 */}
            <button
              data-testid={`sales-treatment-category-btn-${id}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
              onClick={() => hasItems && toggleCat(id)}
              disabled={!hasItems}
              aria-expanded={expanded}
            >
              {hasItems ? (
                expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className={cn('font-semibold', !hasItems && 'text-muted-foreground')}>{label}</span>
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
                  data-testid={`sales-treatment-cat-total-${id}`}
                  className={cn('w-24 text-right font-semibold tabular-nums', catTotal < 0 && 'text-red-600')}
                >
                  {formatAmount(Math.round(catTotal))}원
                </span>
              </div>
            </button>

            {/* 소분류 (버킷 내 시술 항목) */}
            {expanded && hasItems && (
              <div
                data-testid={`sales-treatment-category-items-${id}`}
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

      {/* 전체 합계 — 화이트리스트 6개 버킷 합산 */}
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
