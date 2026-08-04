/**
 * T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE (02) — 전월 대비 매출 추이.
 * 일자별(1일~말일) 당월 vs 전월 매출(순) 비교표. read-only 표시.
 *   - 전월 데이터 없음(신규 오픈 첫 달) → 전월/증감 컬럼 '-' (0 오도 금지, 시나리오 2-2).
 *   - 미래일(현재월) → 당월 컬럼 '-'.
 * 모노톤 컴팩트(CRM 기존 톤앤매너).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MonthlyComparison } from '@/lib/mtmSales';

interface Props {
  data: MonthlyComparison | null;
  loading: boolean;
}

export default function MonthlyComparisonSection({ data, loading }: Props) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">2. 전월 대비 매출 추이</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            일자별 매출 비교
            {data && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                당월 {data.curLabel} vs 전월 {data.prevLabel}
                {!data.prevHasData && ' · 전월 데이터 없음'}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">로딩 중…</div>
          ) : !data || data.points.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">데이터 없음</div>
          ) : (
            <div
              data-testid="mtm-monthly-compare"
              className="overflow-auto rounded-lg border bg-background text-xs"
            >
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-muted/70">
                  <tr>
                    {['일자', '당월 매출', '전월 매출', '증감'].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap border-b px-3 py-2 text-right font-medium text-muted-foreground first:text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p) => {
                    // 증감 = 당월 − 전월. 어느 한쪽이라도 null이면 '-'.
                    const diff =
                      p.current !== null && p.previous !== null
                        ? p.current - p.previous
                        : null;
                    return (
                      <tr
                        key={p.day}
                        data-testid={`mtm-compare-row-${p.day}`}
                        className="border-b transition hover:bg-muted/30"
                      >
                        <td className="px-3 py-1.5 font-medium">{p.day}일</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {p.current === null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            `${formatAmount(p.current)}원`
                          )}
                        </td>
                        <td
                          data-testid={`mtm-compare-prev-${p.day}`}
                          className="px-3 py-1.5 text-right tabular-nums"
                        >
                          {p.previous === null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            `${formatAmount(p.previous)}원`
                          )}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-1.5 text-right tabular-nums',
                            diff !== null && diff > 0 && 'text-emerald-700',
                            diff !== null && diff < 0 && 'text-rose-700',
                          )}
                        >
                          {diff === null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            `${diff > 0 ? '+' : ''}${formatAmount(diff)}원`
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold">
                    <td className="px-3 py-2">합계</td>
                    <td
                      data-testid="mtm-compare-total-cur"
                      className="px-3 py-2 text-right tabular-nums"
                    >
                      {formatAmount(data.curMonthTotal)}원
                    </td>
                    <td
                      data-testid="mtm-compare-total-prev"
                      className="px-3 py-2 text-right tabular-nums"
                    >
                      {data.prevHasData ? (
                        `${formatAmount(data.prevMonthTotal)}원`
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {data.prevHasData ? (
                        `${data.curMonthTotal - data.prevMonthTotal > 0 ? '+' : ''}${formatAmount(
                          data.curMonthTotal - data.prevMonthTotal,
                        )}원`
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
