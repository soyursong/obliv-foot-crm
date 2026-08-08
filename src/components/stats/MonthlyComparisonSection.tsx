/**
 * T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE (02) — 전월 대비 매출 추이.
 * 일자별(1일~말일) 당월 vs 전월 매출(순) 비교표. read-only 표시.
 *   - 전월 데이터 없음(신규 오픈 첫 달) → 전월/증감 컬럼 '-' (0 오도 금지, 시나리오 2-2).
 *   - 미래일(현재월) → 당월 컬럼 '-'.
 * 모노톤 컴팩트(CRM 기존 톤앤매너).
 *
 * T-20260805-foot-DAILYTREND-STAFF-BREAKDOWN-CLARIFY:
 *   (AC-B) 가독성 — 각 컬럼 헤더에 단위(원)·의미 명시 + "이 표 읽는 법" 범례 추가.
 *   (AC-A) 실장별 표 추가 — 일별 매출 추이를 담당실장 단위로도 표시(기존 표 대체 아님·추가).
 *     실장별 총매출 = SALESAGG-STAFF-4METRIC-REDEFINE 정의(패키지 결제 + 급여 본인부담금)
 *     를 일자 grain으로 소비(mtmSales.fetchStaffDailyBreakdown). 미지정 매출은 '미지정' 버킷.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  MonthlyComparison,
  StaffDailyBreakdown,
  DailyComparePoint,
} from '@/lib/mtmSales';

interface Props {
  data: MonthlyComparison | null;
  staffBreakdown: StaffDailyBreakdown | null;
  loading: boolean;
  /**
   * T-20260808-foot-DAYCLOSE-REVENUE-COMPARE-TAB (AC-3, GO_WARN 경계):
   *   실장별 개인 매출 성과 표(카드 #2) 노출 여부. 기본 true(통계 화면 = 관리자 전용, 기존 동작 불변).
   *   일마감 탭(전직원 open)에서는 false — reporter 명시 요청 데이터('일자별 매출 비교 당월 vs 전월', 카드 #1)만
   *   노출하고, 실장 개인성과(원래 /admin/sales=admin/manager/director 전용)는 staff 에게 새로 노출하지 않는다.
   */
  showStaffBreakdown?: boolean;
}

/**
 * T-20260808-foot-SALESCOMPARE-2COL-15DAY-LAYOUT:
 *   일자별 비교표를 좌우 2단(좌 1~15일 / 우 16~말일)으로 재배치하기 위한 반쪽 렌더러.
 *   헤더 + 본문 행만 렌더한다 — 합계(당월 전체)는 2단과 무관하게 표 하단에서 1회만 표시(값 불변, AC-3).
 *   표시 레이아웃 전용: 매출 산식/집계/값 무접촉(mtmSales SSOT 발산 금지, db_change=false).
 */
function DailyCompareHalf({ points }: { points: DailyComparePoint[] }) {
  return (
    <div className="overflow-auto rounded-lg border bg-background text-xs">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/70">
          <tr>
            {['일자', '당월 매출(원)', '전월 매출(원)', '증감(당월−전월, 원)'].map((h) => (
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
          {points.map((p) => {
            // 증감 = 당월 − 전월. 어느 한쪽이라도 null이면 '-'.
            const diff =
              p.current !== null && p.previous !== null ? p.current - p.previous : null;
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
      </table>
    </div>
  );
}

export default function MonthlyComparisonSection({
  data,
  staffBreakdown,
  loading,
  showStaffBreakdown = true,
}: Props) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-muted-foreground">2. 전월 대비 매출 추이</h2>

      {/* AC-B(가독성): 이 표가 무슨 값인지 즉시 판별 가능하도록 읽는 법(범례) 명시. */}
      <div
        data-testid="mtm-compare-legend"
        className="rounded-md border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-800"
      >
        <b>이 표 읽는 법</b> — 하루하루의 <b>총 매출(순매출)</b>을 이번 달과 지난달로 나란히 비교한 표예요.
        <span className="mx-1">·</span>
        <b>당월 매출</b> = 이번 달({data?.curLabel ?? '이번 달'}) 해당 일자 매출
        <span className="mx-1">·</span>
        <b>전월 매출</b> = 지난달({data?.prevLabel ?? '지난달'}) 같은 일자 매출
        <span className="mx-1">·</span>
        <b>증감</b> = 당월 − 전월 (<span className="text-emerald-700">초록=증가</span> /{' '}
        <span className="text-rose-700">빨강=감소</span>)
        <span className="mx-1">·</span>
        <b>‘-’</b> = 데이터 없음(아직 지나지 않은 날짜 또는 지난달 기록 없음). 금액 단위는 <b>원</b>.
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            일자별 매출 비교 (당월 vs 전월)
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
            <div data-testid="mtm-monthly-compare" className="flex flex-col gap-3">
              {/*
                좌우 2단 재배치(T-20260808-SALESCOMPARE-2COL-15DAY):
                  좌 = 1~15일 / 우 = 16~말일. 우측 끝날짜는 data.points(=말일까지) 기준으로 동적이라
                  30/31·2월 28/29에도 하드코딩 없이 빈칸·깨짐 없음(AC-2). 값·합계·증감은 불변(AC-3).
                반응형(AC-5): 기본 1열 세로 스택(좌 1~15 → 우 16~말일 순서 유지), md 이상에서 좌우 2열.
              */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <DailyCompareHalf points={data.points.filter((p) => p.day <= 15)} />
                <DailyCompareHalf points={data.points.filter((p) => p.day >= 16)} />
              </div>

              {/* 합계(당월 전체 = 좌+우 합) — 2단 분할과 무관하게 1회만 표시, 값 불변(AC-3). */}
              <div className="overflow-auto rounded-lg border bg-background text-xs">
                <table className="w-full border-collapse">
                  <tbody>
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
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AC-A: 실장별 일별 매출 추이 표 (추가 — 기존 비교표 대체 아님). */}
      {/* T-20260808-foot-DAYCLOSE-REVENUE-COMPARE-TAB: showStaffBreakdown=false 시 카드 #2 숨김(일마감 탭 = 전직원 노출 경계). */}
      {showStaffBreakdown && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            실장별 일별 매출
            {staffBreakdown && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                당월 {staffBreakdown.monthLabel} · 담당실장 기준
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* 무슨 값인지 명확화(가독성) + 산식 출처 명시. */}
          <div
            data-testid="mtm-staff-daily-note"
            className="mb-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-800"
          >
            각 <b>담당실장</b>이 맡은 고객의 <b>일자별 매출</b>이에요. 실장 매출 = <b>패키지 결제</b>
            {' '}+ <b>급여 본인부담금</b> (담당실장별 매출 정의와 동일). 담당실장이 지정되지 않은 매출은
            {' '}<b>‘미지정’</b> 칸에 모읍니다. 금액 단위는 <b>원</b>, <b>‘-’</b>는 아직 지나지 않은 날짜예요.
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">로딩 중…</div>
          ) : !staffBreakdown || staffBreakdown.staff.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">데이터 없음</div>
          ) : (
            <div
              data-testid="mtm-staff-daily"
              className="overflow-auto rounded-lg border bg-background text-xs"
            >
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-muted/70">
                  <tr>
                    <th className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground">
                      일자
                    </th>
                    {staffBreakdown.staff.map((s) => (
                      <th
                        key={s.id}
                        data-testid={`mtm-staff-col-${s.id}`}
                        className="whitespace-nowrap border-b px-3 py-2 text-right font-medium text-muted-foreground"
                      >
                        {s.name}
                        <span className="ml-0.5 text-[10px] font-normal">(원)</span>
                      </th>
                    ))}
                    <th className="whitespace-nowrap border-b px-3 py-2 text-right font-semibold text-muted-foreground">
                      일 합계(원)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {staffBreakdown.rows.map((row) => (
                    <tr
                      key={row.day}
                      data-testid={`mtm-staff-row-${row.day}`}
                      className="border-b transition hover:bg-muted/30"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium">{row.day}일</td>
                      {staffBreakdown.staff.map((s) => (
                        <td
                          key={s.id}
                          className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums"
                        >
                          {row.isFuture ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            `${formatAmount(row.byStaff[s.id] ?? 0)}원`
                          )}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium">
                        {row.isFuture ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          `${formatAmount(row.total)}원`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold">
                    <td className="whitespace-nowrap px-3 py-2">합계</td>
                    {staffBreakdown.staff.map((s) => (
                      <td
                        key={s.id}
                        data-testid={`mtm-staff-total-${s.id}`}
                        className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
                      >
                        {formatAmount(s.total)}원
                      </td>
                    ))}
                    <td
                      data-testid="mtm-staff-grand-total"
                      className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-teal-700"
                    >
                      {formatAmount(staffBreakdown.grandTotal)}원
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </section>
  );
}
