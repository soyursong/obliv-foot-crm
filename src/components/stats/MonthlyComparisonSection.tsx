/**
 * T-20260804-foot-MTM-SALES-DASH-RESTRUCTURE (02) — 전월 대비 매출 추이.
 * 일자별(1일~말일) 당월 vs 전월 매출(순) 비교표. read-only 표시.
 *   - 전월 데이터 없음(신규 오픈 첫 달) → 전월/증감 컬럼 '-' (0 오도 금지, 시나리오 2-2).
 *   - 미래일(현재월) → 당월 컬럼 '-'.
 * 모노톤 컴팩트(CRM 기존 톤앤매너).
 *
 * T-20260805-foot-DAILYTREND-STAFF-BREAKDOWN-CLARIFY:
 *   (AC-B) 가독성 — 각 컬럼 헤더에 단위(원)·의미 명시.
 *     (안내 범례·실장 노트 박스는 STATS-EXTRA-DESC-BOX-REMOVE 로 제거됨. 표·산식 무접촉.)
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
  /**
   * T-20260810-foot-DAYCLOSE-MOMTREND-TITLE-REMOVE:
   *   섹션 제목('2. 전월 대비 매출 추이') 표시 여부. 기본 false(통계 화면 = 종전대로 제목 노출, 회귀 금지).
   *   일마감 '총 매출' 탭에서만 true — 김주연 총괄 요청으로 이 탭에서만 제목 라벨을 숨긴다(하위 표는 유지).
   *   공유 컴포넌트이므로 통계 화면(Stats.tsx)에는 이 prop 미전달 → 제목 계속 표시(AC-3 회귀 가드).
   */
  hideTitle?: boolean;
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
  hideTitle = false,
}: Props) {
  return (
    <section className="flex flex-col gap-4">
      {!hideTitle && (
        <h2 className="text-sm font-semibold text-muted-foreground">2. 전월 대비 매출 추이</h2>
      )}

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

              {/*
                합계(당월 전체 = 좌+우 합) — 2단 분할과 무관하게 1회만 표시, 값 불변(AC-3).
                T-20260809-foot-SALESCOMPARE-TOTAL-LABEL-SYNC (AC-1):
                  합계는 위 반쪽 표(1~15/16~말일)와 물리적으로 떨어진 별도 <table> 라 위쪽 머리글(당월/전월/증감)이
                  닿지 않아 "어느 게 당월/전월인지" 모호 → 합계 표에 자체 <thead> 머리글을 붙여 합계만 봐도 즉시 구분.
                  컬럼 순서·값·증감 산식은 위 반쪽 표와 동일(당월 → 전월 → 증감), 값 무접촉(AC-3).
                ★ AC-2 연동 불변식: 이 컴포넌트는 통계(Stats.tsx)·일마감(Closing.tsx)이 함께 소비하는 단일
                  공유 렌더러다. 라벨/레이아웃은 여기 1곳에서만 수정한다 — 소비처별 분기(한쪽에만 머리글 부여 등)
                  절대 금지. 여기를 고치면 통계·일마감 양쪽이 동일하게 반영된다.
              */}
              <div className="overflow-auto rounded-lg border bg-background text-xs">
                <table className="w-full border-collapse">
                  <thead className="bg-muted/70">
                    <tr data-testid="mtm-compare-total-head">
                      {['구분', '당월', '전월', '증감(당월−전월)'].map((h) => (
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
