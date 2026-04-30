import { useEffect, useState } from 'react';
import { useClinic } from '@/hooks/useClinic';
import {
  fetchCategoryRevenue,
  fetchConsultantPerf,
  fetchNoshowReturning,
  fetchRevenue,
  resolveRange,
  type CategoryRow,
  type ConsultantRow,
  type NoshowReturningRow,
  type RevenueRow,
  type StatsRangePreset,
} from '@/lib/stats';
import RevenueSection from '@/components/stats/RevenueSection';
import CategorySection from '@/components/stats/CategorySection';
import ConsultantSection from '@/components/stats/ConsultantSection';
import NoshowReturningSection from '@/components/stats/NoshowReturningSection';

const PRESETS: { key: StatsRangePreset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'week',  label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'custom', label: '사용자 지정' },
];

export default function Stats() {
  const clinic = useClinic();
  const [preset, setPreset] = useState<StatsRangePreset>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo]     = useState<string>('');

  const [revenue, setRevenue]                       = useState<RevenueRow[]>([]);
  const [categories, setCategories]                 = useState<CategoryRow[]>([]);
  const [consultants, setConsultants]               = useState<ConsultantRow[]>([]);
  const [noshowReturning, setNoshowReturning]       = useState<NoshowReturningRow[]>([]);
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
      } catch (e) {
        if (aborted) return;
        const msg = e instanceof Error ? e.message : '통계 불러오기 실패';
        setError(msg);
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [clinic, preset, customFrom, customTo]);

  const { from: rangeFrom, to: rangeTo } = clinic
    ? resolveRange(preset, customFrom, customTo)
    : { from: '', to: '' };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">통계 대시보드</h1>
          {clinic && rangeFrom && (
            <p className="text-xs text-muted-foreground mt-1">
              기간: {rangeFrom} ~ {rangeTo}
            </p>
          )}
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

      <RevenueSection rows={revenue} loading={loading} />
      <CategorySection rows={categories} loading={loading} />
      <ConsultantSection rows={consultants} loading={loading} />
      <NoshowReturningSection rows={noshowReturning} loading={loading} />
    </div>
  );
}
