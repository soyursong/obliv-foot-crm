import { formatAmount } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeeklyRevenueRow } from '@/lib/mtmSales';

/**
 * T-20260814-foot-SALESSTAT-WEEKLY-AOV-ADD — 주단위 매출 breakdown 표 (객단가 포함).
 *   CEO 결정(b): 통계>매출통계에 여러 주를 나열하는 신규 '주별 매출' 표.
 *   각 주 행: 기간(주 범위) · 매출(순) · 내원환자수 · 객단가.
 *
 * ★객단가 = 주 매출 ÷ 주 내원환자수(fetchWeeklyRevenueBreakdown SSOT, 월간 매출통계 객단가 동일 정의).
 *   내원환자 0 → '-'(0-div 가드). 테스트고객·취소·삭제 체크인 제외(집계단 처리).
 */
interface Props {
  rows: WeeklyRevenueRow[];
  loading: boolean;
}

export default function WeeklyRevenueSection({ rows, loading }: Props) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">주단위 매출</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">주별 매출 · 객단가</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full border-collapse text-sm tabular-nums"
                data-testid="weekly-revenue-table"
              >
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">주 (기간)</th>
                    <th className="px-3 py-2 text-right font-medium">매출 (순)</th>
                    <th className="px-3 py-2 text-right font-medium">내원환자 수</th>
                    <th className="px-3 py-2 text-right font-medium">객단가</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.weekStart}
                      data-testid={`weekly-revenue-row-${r.weekStart}`}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal text-muted-foreground"
                      >
                        {r.label}
                      </th>
                      <td className="px-3 py-2 text-right font-medium text-slate-800">
                        {`${formatAmount(r.revenue)}원`}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {`${formatAmount(r.visitPatients)}명`}
                      </td>
                      <td
                        className="px-3 py-2 text-right text-slate-700"
                        data-testid={`weekly-revenue-arpu-${r.weekStart}`}
                      >
                        {r.arpu === null ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          `${formatAmount(Math.round(r.arpu))}원`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
