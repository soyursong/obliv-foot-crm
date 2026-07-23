import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VISIT_ROUTE_OPTIONS } from '@/lib/types';
import type { VisitRouteResvRow } from '@/lib/stats';

/**
 * T-20260723-foot-STAT-NAEWON-TAB: 통계 대시보드 '내원 통계' 탭.
 * 선택 기간의 방문경로별 내원(방문 완료) 건수를 ① 요약 카드 ② 도넛+표 ③ 일별 누적 막대로 표시.
 *
 * 재사용(지시서 STEP1 #7): 요약 카드=RevenueSection KpiCard 스타일 / 도넛+표=CategorySection /
 *   일별 차트=RevenueSection 추이 차트 패턴(라인→누적 막대). 신규 디자인·신규 라이브러리 0(recharts 재사용).
 * 조회 전용 — DB write 없음. 방문경로 목록은 드롭다운 SSOT(VISIT_ROUTE_OPTIONS)에서 동적 렌더,
 *   실제 데이터에만 존재하는 legacy 값('인콜' 등)도 자동 흡수(하드코딩 금지).
 */
interface Props {
  rows: VisitRouteResvRow[];
  loading: boolean;
}

// CategorySection 동일 팔레트 재사용.
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#a855f7', '#64748b'];

const UNSET_LABEL = '미입력';

export default function VisitRouteSection({ rows, loading }: Props) {
  const agg = useMemo(() => {
    // 경로별 건수 집계. NULL/빈값 → '미입력' 버킷(§4 미입력 처리 — 숨기지 않고 별도 집계).
    const counts = new Map<string, number>();
    for (const r of rows) {
      const route = (r.visit_route ?? '').trim() || UNSET_LABEL;
      counts.set(route, (counts.get(route) ?? 0) + 1);
    }
    const total = rows.length;
    const unsetCount = counts.get(UNSET_LABEL) ?? 0;

    // 렌더 순서용 경로 유니버스: 드롭다운 SSOT 순서 우선 + 데이터에만 있는 값(legacy) 뒤에 append.
    const presentRoutes = Array.from(counts.keys()).filter((k) => k !== UNSET_LABEL);
    const ssotOrdered = (VISIT_ROUTE_OPTIONS as readonly string[]).filter((o) => presentRoutes.includes(o));
    const extras = presentRoutes.filter((p) => !(VISIT_ROUTE_OPTIONS as readonly string[]).includes(p));
    const orderedRoutes = [...ssotOrdered, ...extras];

    // 누적 막대 범례/색 안정용 키 순서(경로 + 미입력). 색상 index 고정.
    const routeKeys = [...orderedRoutes, ...(unsetCount > 0 ? [UNSET_LABEL] : [])];
    const colorOf = (route: string) => COLORS[routeKeys.indexOf(route) % COLORS.length];

    // ② 표: 경로별 건수·비중. 미입력 포함, 건수 내림차순. 0건 경로는 표에서 제외(검산은 유지).
    const table = [
      ...orderedRoutes.map((route) => ({ route, count: counts.get(route) ?? 0 })),
      { route: UNSET_LABEL, count: unsetCount },
    ]
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((x) => ({ ...x, ratio: total > 0 ? (x.count / total) * 100 : 0 }));

    // ① 최다 유입 경로: 미입력 제외한 실제 경로 중 최다. 없으면 null → '—'.
    const topRoute = table.filter((x) => x.route !== UNSET_LABEL).reduce<{ route: string; count: number } | null>(
      (best, cur) => (best === null || cur.count > best.count ? cur : best),
      null,
    );

    // 도넛 데이터(0건 제외).
    const donut = table.map((x) => ({ name: x.route, value: x.count }));

    // ③ 일별 추이: 일자 × 경로 누적. 날짜 오름차순.
    const dayMap = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const route = (r.visit_route ?? '').trim() || UNSET_LABEL;
      const d = r.reservation_date;
      if (!d) continue;
      if (!dayMap.has(d)) dayMap.set(d, {});
      const obj = dayMap.get(d)!;
      obj[route] = (obj[route] ?? 0) + 1;
    }
    const daily = Array.from(dayMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dt, obj]) => ({ dt, label: dt.slice(5), ...obj }));

    return { total, unsetCount, topRoute, table, donut, routeKeys, daily, colorOf };
  }, [rows]);

  const empty = !loading && agg.total === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ① 요약 카드 3개 (RevenueSection KpiCard 스타일 재사용) */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground">1. 내원 요약</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            title="총 내원 건수"
            value={loading ? '…' : `${agg.total.toLocaleString('ko-KR')}건`}
            accent="text-teal-700"
          />
          <SummaryCard
            title="최다 유입 경로"
            value={
              loading
                ? '…'
                : agg.topRoute
                  ? `${agg.topRoute.route} (${agg.topRoute.count.toLocaleString('ko-KR')}건)`
                  : '—'
            }
            accent="text-emerald-700"
          />
          <SummaryCard
            title="미입력 건수"
            value={loading ? '…' : `${agg.unsetCount.toLocaleString('ko-KR')}건`}
            accent="text-amber-700"
          />
        </div>
      </section>

      {/* ② 경로별 집계: 도넛 + 표 (CategorySection 재사용) */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground">2. 방문경로별 내원</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">경로 비중</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
              ) : agg.donut.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={agg.donut}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {agg.donut.map((d) => (
                        <Cell key={d.name} fill={agg.colorOf(d.name)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `${Number(v).toLocaleString('ko-KR')}건`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">경로별 건수</CardTitle>
            </CardHeader>
            <CardContent>
              {agg.table.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12">
                  {loading ? '로딩 중…' : '데이터 없음'}
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">방문경로</th>
                        <th className="pb-2 font-medium text-right">건수</th>
                        <th className="pb-2 font-medium text-right">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agg.table.map((r) => (
                        <tr key={r.route} className="border-b last:border-0">
                          <td className="py-2 font-medium">{r.route}</td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {r.count.toLocaleString('ko-KR')}
                          </td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {r.ratio.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {/* 검산: 경로별 합계(미입력 포함) = 총 내원 건수 */}
                      <tr className="border-t-2 font-semibold">
                        <td className="py-2">합계</td>
                        <td className="py-2 text-right tabular-nums">
                          {agg.total.toLocaleString('ko-KR')}
                        </td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">100.0%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ③ 일별 추이: 누적 막대 (RevenueSection 추이 차트 패턴) */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground">3. 일별 내원 추이</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">일자별 경로 누적</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center text-sm text-muted-foreground py-12">로딩 중…</div>
            ) : empty || agg.daily.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">데이터 없음</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={agg.daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v, name) => [`${Number(v).toLocaleString('ko-KR')}건`, name as string]} />
                  <Legend />
                  {agg.routeKeys.map((route) => (
                    <Bar key={route} dataKey={route} name={route} stackId="visit" fill={agg.colorOf(route)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SummaryCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
