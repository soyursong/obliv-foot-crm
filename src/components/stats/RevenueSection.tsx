import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import type { RevenueRow } from '@/lib/stats';
import type { MtmCardMetrics } from '@/lib/mtmSales';

interface Props {
  rows: RevenueRow[];
  loading: boolean;
  // T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE (01): 매출통계 카드 확장 지표.
  //   급여/비급여/실시술(선수금차감)/내원환자/결제건수 = fetchMtmCardMetrics(read-only SSOT).
  //   예상월매출(추정) = projectMonthlyRevenue(당월 경과일 일평균×총일수) — 현재월만, 과거월 null('-').
  metrics?: MtmCardMetrics | null;
  projectedMonthly?: number | null;
}

// T-20260805-foot-SALESSTAT-TABLE-LAYOUT: 01 매출통계 프레젠테이션을 개별 카드 → 표(테이블)로 전환.
//   산식·데이터 소스 미접촉(AC-B) — 아래 값 계산 로직은 부모 배포본(062ac40e)과 동일, render markup만 교체.
//   스크린샷 '활실적 요약' 스타일 준용: 좌=구분(항목명), 우=값. 급여/비급여 = 합계|급여|비급여 열 분리(AC-A).
type StatRow =
  | { kind: 'single'; label: string; value: number | null; unit: string; emphasis?: boolean }
  | {
      kind: 'split';
      label: string;
      total: number | null;
      salary: number | null;
      nonSalary: number | null;
      unit: string;
    };

export default function RevenueSection({ rows, loading, metrics, projectedMonthly }: Props) {
  const totals = useMemo(() => {
    let pkg = 0;
    let single = 0;
    let refund = 0;
    for (const r of rows) {
      pkg += r.package_amount ?? 0;
      single += r.single_amount ?? 0;
      refund += r.refund_amount ?? 0;
    }
    return {
      pkg,
      single,
      refund,
      // 누적매출(순) = pkg + single − refund (기존 '총 매출(순)' 정의 불변 · SSOT).
      total: pkg + single - refund,
    };
  }, [rows]);

  // 객단가 = 누적매출(순) ÷ 내원환자 수. 내원환자 0 → null('-', 0 나눗셈 방지).
  const arpu = useMemo(() => {
    if (!metrics || metrics.visitPatients <= 0) return null;
    return totals.total / metrics.visitPatients;
  }, [metrics, totals.total]);

  // 급여/비급여: metrics 부재 시 null('-'). 합계 = 급여 + 비급여(AC 정합, 한쪽만 존재해도 정합).
  const salary = metrics ? metrics.salaryRevenue : null;
  const nonSalary = metrics ? metrics.nonSalaryRevenue : null;
  const salarySplitTotal = metrics ? metrics.salaryRevenue + metrics.nonSalaryRevenue : null;

  // 표 행 정의(현장 지정 순서 · 기존 카드 전 지표 보존 → 값 회귀 0).
  const statRows: StatRow[] = [
    { kind: 'single', label: '누적매출 (순)', value: totals.total, unit: '원', emphasis: true },
    { kind: 'single', label: '예상월매출 (추정)', value: projectedMonthly ?? null, unit: '원' },
    { kind: 'split', label: '급여 · 비급여 매출', total: salarySplitTotal, salary, nonSalary, unit: '원' },
    { kind: 'single', label: '패키지 판매액', value: totals.pkg, unit: '원' },
    { kind: 'single', label: '단건 매출', value: totals.single, unit: '원' },
    {
      kind: 'single',
      label: '실제 시술 매출 (선수금차감)',
      value: metrics ? metrics.actualTreatmentRevenue : null,
      unit: '원',
    },
    { kind: 'single', label: '환불액', value: totals.refund, unit: '원' },
    { kind: 'single', label: '내원환자 수', value: metrics ? metrics.visitPatients : null, unit: '명' },
    { kind: 'single', label: '결제건수', value: metrics ? metrics.paymentCount : null, unit: '건' },
    { kind: 'single', label: '객단가', value: arpu, unit: '원' },
  ];

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        label: r.dt.slice(5),
        package: r.package_amount,
        single: r.single_amount,
      })),
    [rows],
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">1. 매출 통계</h2>

      {/* 매출통계 요약 표 (카드 → 표 전환 · 좌:구분 / 우:값 · 급여/비급여=합계|급여|비급여) */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-sm tabular-nums"
              data-testid="revenue-summary-table"
            >
              <thead>
                <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">구분</th>
                  <th className="px-3 py-2 text-right font-medium">합계</th>
                  <th className="px-3 py-2 text-right font-medium">급여</th>
                  <th className="px-3 py-2 text-right font-medium">비급여</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((row) => (
                  <tr
                    key={row.label}
                    data-testid={`revenue-row-${row.kind === 'split' ? 'salary-split' : row.label}`}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <th
                      scope="row"
                      className={`px-3 py-2 text-left font-normal text-muted-foreground ${
                        row.kind === 'single' && row.emphasis ? 'font-semibold text-foreground' : ''
                      }`}
                    >
                      {row.label}
                    </th>
                    {row.kind === 'single' ? (
                      <td
                        colSpan={3}
                        className={`px-3 py-2 text-right ${
                          row.emphasis ? 'font-semibold text-foreground' : 'text-slate-800'
                        }`}
                        data-testid={`revenue-value-${row.label}`}
                      >
                        <ValueCell value={row.value} unit={row.unit} />
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">
                          <ValueCell value={row.total} unit={row.unit} />
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700" data-testid="revenue-salary">
                          <ValueCell value={row.salary} unit={row.unit} />
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700" data-testid="revenue-nonsalary">
                          <ValueCell value={row.nonSalary} unit={row.unit} />
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">일별 매출 추이</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
          ) : chartData.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${Math.round(v / 10000)}만`}
                />
                <Tooltip formatter={(v) => formatAmount(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="package" name="패키지" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="single" name="단건" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// 값 셀: null → '-'(muted, 회귀 0 · 기존 KpiCard 동작 준용). 숫자 → formatAmount + 단위.
function ValueCell({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <>{`${formatAmount(value)}${unit}`}</>;
}
