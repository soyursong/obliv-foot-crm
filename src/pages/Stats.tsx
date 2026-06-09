import { useEffect, useState } from 'react';
import { useClinic } from '@/hooks/useClinic';
import {
  fetchCategoryRevenue,
  fetchConsultantPerf,
  fetchNoshowReturning,
  fetchRevenue,
  fetchTherapistSummary,
  fetchTherapistServices,
  resolveRange,
  describeStatsError,
  type CategoryRow,
  type ConsultantRow,
  type NoshowReturningRow,
  type RevenueRow,
  type TherapistSummaryRow,
  type TherapistServiceRow,
  type StatsRangePreset,
} from '@/lib/stats';
import RevenueSection from '@/components/stats/RevenueSection';
import CategorySection from '@/components/stats/CategorySection';
import ConsultantSection from '@/components/stats/ConsultantSection';
import NoshowReturningSection from '@/components/stats/NoshowReturningSection';
import TherapistStatsSection from '@/components/stats/TherapistStatsSection';

type StatsTab = 'revenue' | 'therapist';

const TABS: { key: StatsTab; label: string }[] = [
  { key: 'revenue',   label: '매출 통계' },
  { key: 'therapist', label: '치료사 통계' },
];

const PRESETS: { key: StatsRangePreset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'week',  label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'custom', label: '사용자 지정' },
];

export default function Stats() {
  const clinic = useClinic();
  const [tab, setTab] = useState<StatsTab>('revenue');
  const [preset, setPreset] = useState<StatsRangePreset>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo]     = useState<string>('');

  const [revenue, setRevenue]                       = useState<RevenueRow[]>([]);
  const [categories, setCategories]                 = useState<CategoryRow[]>([]);
  const [consultants, setConsultants]               = useState<ConsultantRow[]>([]);
  const [noshowReturning, setNoshowReturning]       = useState<NoshowReturningRow[]>([]);
  const [therapistSummary, setTherapistSummary]     = useState<TherapistSummaryRow[]>([]);
  const [therapistServices, setTherapistServices]   = useState<TherapistServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!clinic) return;
    if (preset === 'custom' && (!customFrom || !customTo)) return;

    const { from, to } = resolveRange(preset, customFrom, customTo);

    let aborted = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (tab === 'revenue') {
          const [rev, cat, cons, nsr] = await Promise.all([
            fetchRevenue(clinic.id, from, to),
            fetchCategoryRevenue(clinic.id, from, to),
            fetchConsultantPerf(clinic.id, from, to),
            fetchNoshowReturning(clinic.id, from, to),
          ]);
          if (aborted) return;
          setRevenue(rev);
          setCategories(cat);
          setConsultants(cons);
          setNoshowReturning(nsr);
        } else {
          const [summary, services] = await Promise.all([
            fetchTherapistSummary(clinic.id, from, to),
            fetchTherapistServices(clinic.id, from, to),
          ]);
          if (aborted) return;
          setTherapistSummary(summary);
          setTherapistServices(services);
        }
      } catch (e) {
        if (aborted) return;
        // AC-3: raw 원인(PostgREST code/message/hint)을 콘솔에 통째로 + 배너에 1줄로.
        console.error('[Stats] 통계 로드 실패', { tab, from, to, error: e });
        setError(describeStatsError(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [clinic, tab, preset, customFrom, customTo]);

  const { from: rangeFrom, to: rangeTo } = clinic
    ? resolveRange(preset, customFrom, customTo)
    : { from: '', to: '' };

  return (
    <div className="h-full flex flex-col gap-6 p-6 overflow-auto">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">통계 대시보드</h1>
          {clinic && rangeFrom && (
            <p className="text-xs text-muted-foreground mt-1">
              기간: {rangeFrom} ~ {rangeTo}
            </p>
          )}
          <div className="mt-3 flex rounded-md border overflow-hidden w-fit">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`stats-tab-${t.key}`}
                className={
                  tab === t.key
                    ? 'bg-teal-600 text-white px-4 py-1.5 text-xs font-semibold'
                    : 'text-muted-foreground hover:bg-muted px-4 py-1.5 text-xs font-medium transition'
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={
                  preset === p.key
                    ? 'bg-teal-50 text-teal-700 px-3 py-1.5 text-xs font-medium'
                    : 'text-muted-foreground hover:bg-muted px-3 py-1.5 text-xs font-medium transition'
                }
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-1 text-xs">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border rounded px-2 py-1"
              />
              <span className="text-muted-foreground">~</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border rounded px-2 py-1"
              />
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          통계를 불러오지 못했습니다: {error}
        </div>
      )}

      {tab === 'revenue' ? (
        <>
          <RevenueSection rows={revenue} loading={loading} />
          <CategorySection rows={categories} loading={loading} />
          <ConsultantSection rows={consultants} loading={loading} />
          <NoshowReturningSection rows={noshowReturning} loading={loading} />
        </>
      ) : (
        <TherapistStatsSection
          summary={therapistSummary}
          services={therapistServices}
          loading={loading}
        />
      )}
    </div>
  );
}
