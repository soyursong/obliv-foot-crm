/**
 * T-20260515-foot-SALES-TAB-DAILY
 * 일일결산 마감 뷰 — 듀얼 매트릭스 (발생기준 + 수납수단별) + 현금 시재 추적
 *
 * AC-1: 좌측 발생기준(세금속성별) / 우측 수납수단×세금속성 교차 매트릭스
 * AC-2: 좌우 합계 대사 — 불일치 시 경고 배너
 * AC-3: 현금 시재 (전일이월 + 당일수납 = 잔액)
 * AC-4: 글로벌 SalesFilterState.dateRange(accounting_date) 사용
 *
 * READ-ONLY — DB 변경 없음. payments + package_payments + daily_closings 조회만.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// 상수 / 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 우측 매트릭스 컬럼 — 세금속성 4종 */
const TAX_COLS = ['과세', '면세', '급여', '선수금'] as const;
type TaxCol = (typeof TAX_COLS)[number];

/** 우측 매트릭스 행 — 결제수단 4종 */
const METHOD_ROWS = ['현금', '카드', '이체', '선수금차감'] as const;
type MethodRow = (typeof METHOD_ROWS)[number];

/** DB method 값 → 한국어 행 매핑 */
const DB_METHOD_TO_ROW: Record<string, MethodRow> = {
  cash: '현금',
  card: '카드',
  transfer: '이체',
  membership: '선수금차감',
};

/** DB tax_type 값 → 한국어 열 매핑 (미분류는 면세 보수 처리) */
function taxTypeToCol(tt: string | null): TaxCol {
  if (tt === '과세_비급여') return '과세';
  if (tt === '면세_비급여') return '면세';
  if (tt === '급여') return '급여';
  if (tt === '선수금') return '선수금';
  return '면세'; // null or unknown → 면세(비급여)
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 타입
// ─────────────────────────────────────────────────────────────────────────────

interface RawPayment {
  method: string | null;
  tax_type: string | null;
  amount: number;
  payment_type: string | null;
}

interface DailyClosingRow {
  close_date: string;
  actual_cash_total: number;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 환불은 음수, 일반 결제는 양수 */
function net(p: RawPayment): number {
  return p.payment_type === 'refund' ? -p.amount : p.amount;
}

function fmtPrevDate(from: string): string {
  const d = new Date(from);
  return format(subDays(d, 1), 'yyyy-MM-dd');
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  filter: SalesFilterState;
}

export function SalesDailyTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const prevDate = fmtPrevDate(from);

  // ── 단건 결제 (accounting_date 기준) ───────────────────────────────────────
  const { data: payments = [], isLoading: payLoading } = useQuery<RawPayment[]>({
    queryKey: ['sales-daily-payments', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('method, tax_type, amount, payment_type')
        .eq('clinic_id', clinic!.id)
        .neq('status', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      return (data ?? []) as RawPayment[];
    },
  });

  // ── 패키지 결제 (accounting_date 기준) ─────────────────────────────────────
  const { data: pkgPayments = [], isLoading: pkgLoading } = useQuery<RawPayment[]>({
    queryKey: ['sales-daily-pkg-payments', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_payments')
        .select('method, tax_type, amount, payment_type')
        .eq('clinic_id', clinic!.id)
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      return (data ?? []) as RawPayment[];
    },
  });

  // ── 전일 마감 레코드 (현금 시재 이월용) ───────────────────────────────────
  const { data: prevClosing } = useQuery<DailyClosingRow | null>({
    queryKey: ['sales-daily-prev-closing', clinic?.id, prevDate],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_closings')
        .select('close_date, actual_cash_total, status')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', prevDate)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return (data as DailyClosingRow | null) ?? null;
    },
  });

  const isLoading = payLoading || pkgLoading;
  const allPayments = useMemo<RawPayment[]>(() => [...payments, ...pkgPayments], [payments, pkgPayments]);

  // ── 좌측 매트릭스: 발생 기준 집계 (세금속성별) ─────────────────────────────
  //   급여(본부금+공단청구액) / 비급여(과세+면세) / 선수금 / 할인 / 총진료비
  //   주의: 본부금·공단청구액은 DB에 별도 분리 필드 없음 → 급여합계로 단순 표시
  const left = useMemo(() => {
    let copay = 0;    // 급여 본부금 (급여 전체 — 공단청구 분리 불가)
    let claim = 0;    // 공단청구액 (현재 DB 미지원 → 0)
    let taxable = 0;  // 비급여 과세
    let taxfree = 0;  // 비급여 면세
    let prepaid = 0;  // 선수금차감
    // 할인 필드는 별도 DB 컬럼 없음 → 0

    for (const p of allPayments) {
      const n = net(p);
      const tt = p.tax_type ?? '';
      if (tt === '급여') {
        copay += n;
      } else if (tt === '과세_비급여') {
        taxable += n;
      } else if (tt === '면세_비급여') {
        taxfree += n;
      } else if (tt === '선수금') {
        prepaid += n;
      } else {
        // null or 미분류 → 면세 비급여 보수 처리
        taxfree += n;
      }
    }

    const total = copay + claim + taxable + taxfree + prepaid;
    return { copay, claim, taxable, taxfree, prepaid, discount: 0, total };
  }, [allPayments]);

  // ── 우측 매트릭스: 수납수단 × 세금속성 교차 ────────────────────────────────
  type Matrix = Record<MethodRow, Record<TaxCol, number>>;

  const rightMatrix = useMemo<Matrix>(() => {
    const m: Matrix = {
      '현금': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
      '카드': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
      '이체': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
      '선수금차감': { '과세': 0, '면세': 0, '급여': 0, '선수금': 0 },
    };
    for (const p of allPayments) {
      const row = DB_METHOD_TO_ROW[p.method ?? ''];
      const col = taxTypeToCol(p.tax_type);
      if (row) m[row][col] += net(p);
    }
    return m;
  }, [allPayments]);

  const rightRowTotals = useMemo<Record<MethodRow, number>>(() => {
    const t = {} as Record<MethodRow, number>;
    for (const row of METHOD_ROWS) {
      t[row] = TAX_COLS.reduce((s, col) => s + rightMatrix[row][col], 0);
    }
    return t;
  }, [rightMatrix]);

  const rightColTotals = useMemo<Record<TaxCol, number>>(() => {
    const t = {} as Record<TaxCol, number>;
    for (const col of TAX_COLS) {
      t[col] = METHOD_ROWS.reduce((s, row) => s + rightMatrix[row][col], 0);
    }
    return t;
  }, [rightMatrix]);

  const totalRight = TAX_COLS.reduce((s, col) => s + rightColTotals[col], 0);

  // AC-2: 좌우 대사 — 1원 이상 차이 시 경고
  const mismatch = allPayments.length > 0 && Math.abs(left.total - totalRight) >= 1;

  // ── AC-3: 현금 시재 ────────────────────────────────────────────────────────
  const cashCarryover = prevClosing?.actual_cash_total ?? 0;
  const cashIn = useMemo(
    () => allPayments.filter(p => p.method === 'cash').reduce((s, p) => s + net(p), 0),
    [allPayments],
  );
  // 지출(현금 출금)은 closing_manual_payments 기반이나 음수 방향성 구분 불가 → 0 표시
  // 일마감 페이지에서 수기 입력 후 actual_cash_total로 확정
  const cashBalance = cashCarryover + cashIn;

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        데이터 로딩 중…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="sales-daily-tab">
      {/* AC-2: 대사 불일치 경고 */}
      {mismatch && (
        <div
          data-testid="sales-daily-mismatch-warning"
          className="flex items-start gap-2.5 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <span>
            <strong>대사 불일치 감지</strong> — 발생기준 합계{' '}
            <strong>{formatAmount(left.total)}원</strong>과 실수납 합계{' '}
            <strong>{formatAmount(totalRight)}원</strong>이 다릅니다.
            차이: <strong>{formatAmount(Math.abs(left.total - totalRight))}원</strong>.
            결제 데이터를 확인해 주세요.
          </span>
        </div>
      )}

      {/* ── 듀얼 매트릭스 ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

        {/* 좌측: 발생 기준 집계 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">발생 기준 집계</CardTitle>
            <p className="text-xs text-muted-foreground">세금속성별 진료비 분류 (accounting_date 기준)</p>
          </CardHeader>
          <CardContent className="p-0">
            <table
              className="w-full text-sm"
              data-testid="sales-daily-left-matrix"
            >
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-20">구분</th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">항목</th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-28">금액</th>
                </tr>
              </thead>
              <tbody>
                {/* 급여 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 align-middle text-xs font-medium border-r bg-blue-50/50" rowSpan={2}>
                    급여
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">본부금</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.copay)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs text-muted-foreground">공단청구액</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{formatAmount(left.claim)}</td>
                </tr>

                {/* 비급여 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 align-middle text-xs font-medium border-r bg-emerald-50/50" rowSpan={2}>
                    비급여
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">과세</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.taxable)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs text-muted-foreground">면세</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.taxfree)}</td>
                </tr>

                {/* 선수금 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs font-medium border-r bg-purple-50/50">선수금</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">선수금차감</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatAmount(left.prepaid)}</td>
                </tr>

                {/* 할인 */}
                <tr className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 text-xs font-medium border-r bg-muted/30">할인</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">할인금액</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                    {left.discount > 0 ? `−${formatAmount(left.discount)}` : '—'}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td
                    colSpan={2}
                    className="py-3 px-3 font-semibold text-sm"
                  >
                    총진료비
                  </td>
                  <td
                    className={cn(
                      'py-3 px-3 text-right tabular-nums font-semibold text-base',
                      mismatch ? 'text-orange-700' : 'text-emerald-700',
                    )}
                    data-testid="sales-daily-left-total"
                  >
                    {formatAmount(left.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        {/* 우측: 수납수단 × 세금속성 교차 매트릭스 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">수납 수단별 집계</CardTitle>
            <p className="text-xs text-muted-foreground">결제수단 × 세금속성 교차 매트릭스</p>
          </CardHeader>
          <CardContent className="overflow-auto p-0">
            <table
              className="w-full min-w-[340px] text-sm"
              data-testid="sales-daily-right-matrix"
            >
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-24">수단</th>
                  {TAX_COLS.map(col => (
                    <th key={col} className="py-2 px-2 text-right text-xs font-medium text-muted-foreground">
                      {col}
                    </th>
                  ))}
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground">소계</th>
                </tr>
              </thead>
              <tbody>
                {METHOD_ROWS.map(row => (
                  <tr key={row} className="border-b hover:bg-muted/20">
                    <td className="py-2 px-3 text-xs font-medium">{row}</td>
                    {TAX_COLS.map(col => (
                      <td key={col} className="py-2 px-2 text-right tabular-nums text-xs">
                        {rightMatrix[row][col] !== 0
                          ? formatAmount(rightMatrix[row][col])
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {formatAmount(rightRowTotals[row])}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td className="py-3 px-3 font-semibold text-sm">합계</td>
                  {TAX_COLS.map(col => (
                    <td key={col} className="py-3 px-2 text-right tabular-nums text-xs font-medium">
                      {rightColTotals[col] !== 0
                        ? formatAmount(rightColTotals[col])
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  ))}
                  <td
                    className={cn(
                      'py-3 px-3 text-right tabular-nums font-semibold text-base',
                      mismatch ? 'text-orange-700' : 'text-emerald-700',
                    )}
                    data-testid="sales-daily-right-total"
                  >
                    {formatAmount(totalRight)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* AC-3: 현금 시재 추적표 */}
      <Card data-testid="sales-daily-cash-tracker">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">현금 시재 추적</CardTitle>
          <p className="text-xs text-muted-foreground">
            전일 이월금 + 당일 현금수납 = 잔액
            {prevClosing
              ? prevClosing.status === 'closed'
                ? ` (${prevDate} 마감 확정)`
                : ` (${prevDate} 임시저장)`
              : ' (전일 마감 레코드 없음 — 이월금 0 처리)'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* 전일 이월금 */}
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <div className="mb-1 text-xs text-muted-foreground">전일 이월금</div>
              <div className="tabular-nums text-sm font-semibold">{formatAmount(cashCarryover)}</div>
              {prevClosing && prevClosing.status !== 'closed' && (
                <div className="mt-0.5 text-[10px] font-medium text-amber-600">미확정</div>
              )}
            </div>

            {/* 당일 현금수납 */}
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <div className="mb-1 text-xs text-muted-foreground">당일 현금수납</div>
              <div
                data-testid="sales-daily-cash-in"
                className="tabular-nums text-sm font-semibold text-emerald-700"
              >
                + {formatAmount(cashIn)}
              </div>
            </div>

            {/* 지출 */}
            <div className="rounded-lg border bg-muted/20 p-3 text-center">
              <div className="mb-1 text-xs text-muted-foreground">지출</div>
              <div className="tabular-nums text-sm font-semibold text-muted-foreground">—</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">일마감 수기 처리</div>
            </div>

            {/* 잔액 */}
            <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-center">
              <div className="mb-1 text-xs font-medium text-teal-700">남은 현금 (추정)</div>
              <div
                data-testid="sales-daily-cash-balance"
                className="tabular-nums text-sm font-bold text-teal-700"
              >
                {formatAmount(cashBalance)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 빈 상태 */}
      {allPayments.length === 0 && (
        <div
          data-testid="sales-daily-empty"
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 py-12 text-center"
        >
          <span className="text-sm font-medium text-muted-foreground">결제 내역이 없습니다</span>
          <span className="text-xs text-muted-foreground">
            {from === to ? from : `${from} ~ ${to}`}
          </span>
        </div>
      )}
    </div>
  );
}
