import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TherapistSummaryRow, TherapistServiceRow } from '@/lib/stats';

interface Props {
  summary: TherapistSummaryRow[];
  services: TherapistServiceRow[];
  loading: boolean;
}

const BAR_COLORS = ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#f59e0b', '#10b981'];

// 지표2: 시술 4종 정규 순서 (0건도 한 줄로 표기해 카드 높이/구성 일관 유지)
const TREATMENT_TYPES = ['비가열', '가열', '포돌로게', 'Re:Born'] as const;

function EmptyOrLoading({ loading }: { loading: boolean }) {
  return (
    <div className="text-center text-sm text-muted-foreground py-12">
      {loading ? '로딩 중…' : '데이터 없음'}
    </div>
  );
}

export default function TherapistStatsSection({ summary, services, loading }: Props) {
  // 지표2: 치료사별 시술 분포 그룹화
  const servicesByTherapist = useMemo(() => {
    const map = new Map<string, { name: string; rows: TherapistServiceRow[] }>();
    for (const r of services) {
      const entry = map.get(r.therapist_id) ?? { name: r.name, rows: [] };
      entry.rows.push(r);
      map.set(r.therapist_id, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [services]);

  // 지표1 차트 데이터 (평균 치료시간이 있는 치료사만)
  const avgChartData = useMemo(
    () =>
      summary
        .filter((r) => r.avg_treatment_minutes != null)
        .map((r) => ({ name: r.name, minutes: r.avg_treatment_minutes as number })),
    [summary],
  );

  return (
    <div className="flex flex-col gap-8">
      {/* ── 지표1: 평균 치료시간 ── */}
      <section className="flex flex-col gap-3" data-testid="therapist-metric-avgtime">
        <h2 className="text-sm font-semibold text-muted-foreground">1. 치료사 기준 평균 치료시간</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">치료사별 평균 치료시간 (분)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || summary.length === 0 ? (
              <EmptyOrLoading loading={loading} />
            ) : (
              <>
                {avgChartData.length > 0 && (
                  <div className="h-56 w-full mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={avgChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} unit="분" width={44} />
                        <Tooltip formatter={(v) => [`${Number(v)}분`, '평균 치료시간']} />
                        <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                          {avgChartData.map((_, i) => (
                            <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">치료사</th>
                        <th className="pb-2 font-medium text-right">평균 치료시간</th>
                        <th className="pb-2 font-medium text-right">산출 건수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((r) => (
                        <tr key={r.therapist_id} className="border-b last:border-0">
                          <td className="py-2 font-medium">{r.name}</td>
                          <td className="py-2 text-right tabular-nums">
                            {r.avg_treatment_minutes != null
                              ? `${r.avg_treatment_minutes.toFixed(1)}분`
                              : <span className="text-muted-foreground">데이터 없음</span>}
                          </td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {r.treatment_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── 지표2: 시술 종류 분포 (4종) + 시술별 평균 소요시간 ── */}
      <section className="flex flex-col gap-3" data-testid="therapist-metric-services">
        <h2 className="text-sm font-semibold text-muted-foreground">
          2. 치료사별 시술 분포 · 시술별 평균 소요시간
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">치료사 × 시술 4종 [비가열/가열/포돌로게/Re:Born]</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || servicesByTherapist.length === 0 ? (
              <EmptyOrLoading loading={loading} />
            ) : (
              /* 박스 1개 = 치료사 1명 (회색 카드). 데스크탑 4열, 태블릿 3열, 모바일 2열 */
              <div
                className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
                data-testid="svcdist-box-grid"
              >
                {servicesByTherapist.map((t) => {
                  const total = t.rows.reduce((s, r) => s + r.cnt, 0);
                  // 시술 4종 정규 순서로 정렬 (없는 종류는 0건으로 채워 누락 방지)
                  const byType = new Map(t.rows.map((r) => [r.treatment_type, r]));
                  const lines = TREATMENT_TYPES.map((type) => {
                    const r = byType.get(type);
                    return {
                      type,
                      cnt: r?.cnt ?? 0,
                      avg_minutes: r?.avg_minutes ?? null,
                    };
                  });
                  return (
                    <div
                      key={t.name}
                      data-testid="svcdist-box"
                      className="rounded-lg bg-white border p-3 flex flex-col gap-2"
                    >
                      {/* 카드 헤더: 치료사명 + 총 N건 */}
                      <div className="flex items-baseline justify-between gap-2 border-b pb-2">
                        <span className="font-semibold text-sm truncate">{t.name}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          총 {total}건
                        </span>
                      </div>
                      {/* 카드 본문: 시술 4종 각각 한 줄 (시술명 · N건 · 평균 N.N분) */}
                      <div className="flex flex-col gap-1.5">
                        {lines.map((l) => (
                          <div
                            key={l.type}
                            data-testid="svcdist-line"
                            className="flex items-baseline justify-between gap-2 text-xs"
                          >
                            <span className="text-muted-foreground truncate">{l.type}</span>
                            <span className="tabular-nums whitespace-nowrap">
                              <span className="font-semibold text-foreground">{l.cnt}</span>건
                              <span className="text-muted-foreground ml-1.5">
                                평균 {l.avg_minutes != null ? `${l.avg_minutes.toFixed(1)}분` : '-'}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── 지표3: 지정 치료사 비율 (옵션 B: 지정치료사=내원 치료사 일치 비율) ── */}
      <section className="flex flex-col gap-3" data-testid="therapist-metric-designated">
        <h2 className="text-sm font-semibold text-muted-foreground">3. 지정 치료사 비율</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">치료사별 지정 비율 (지정 일치 내원 / 전체 내원)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || summary.length === 0 ? (
              <EmptyOrLoading loading={loading} />
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">치료사</th>
                      <th className="pb-2 font-medium text-right">지정 일치 내원</th>
                      <th className="pb-2 font-medium text-right">전체 내원</th>
                      <th className="pb-2 font-medium text-right">지정 비율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.therapist_id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{r.name}</td>
                        <td className="py-2 text-right tabular-nums">{r.designated_count}</td>
                        <td className="py-2 text-right tabular-nums">{r.total_checkin_count}</td>
                        <td className="py-2 text-right tabular-nums font-medium">
                          {r.designated_rate != null
                            ? `${r.designated_rate.toFixed(1)}%`
                            : <span className="text-muted-foreground font-normal">데이터 없음</span>}
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

      {/* ── 지표4: 체험 → 결제 전환율 ── */}
      <section className="flex flex-col gap-3" data-testid="therapist-metric-conversion">
        <h2 className="text-sm font-semibold text-muted-foreground">4. 체험 → 결제 전환율</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">치료사별 체험→패키지 전환율</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || summary.length === 0 ? (
              <EmptyOrLoading loading={loading} />
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">치료사</th>
                      <th className="pb-2 font-medium text-right">체험 건수</th>
                      <th className="pb-2 font-medium text-right">전환 건수</th>
                      <th className="pb-2 font-medium text-right">전환율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.therapist_id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{r.name}</td>
                        <td className="py-2 text-right tabular-nums">{r.experience_total}</td>
                        <td className="py-2 text-right tabular-nums">{r.experience_converted}</td>
                        <td className="py-2 text-right tabular-nums font-medium">
                          {r.conversion_rate != null
                            ? `${r.conversion_rate.toFixed(1)}%`
                            : <span className="text-muted-foreground font-normal">-</span>}
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
    </div>
  );
}
