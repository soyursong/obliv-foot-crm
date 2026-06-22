import { useEffect, useMemo, useState } from 'react';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import {
  fetchCategoryRevenue,
  fetchConsultantPerf,
  fetchNoshowReturning,
  fetchRevenue,
  fetchTherapistSummary,
  fetchTherapistServices,
  fetchTmAggregate,
  resolveRange,
  describeStatsError,
  type CategoryRow,
  type ConsultantRow,
  type NoshowReturningRow,
  type RevenueRow,
  type TherapistSummaryRow,
  type TherapistServiceRow,
  type TmAggregateData,
  type StatsRangePreset,
} from '@/lib/stats';
import { downloadConsultantSalesReport } from '@/lib/consultantSalesExport';
import { toast } from '@/lib/toast';
import { Download } from 'lucide-react';
import RevenueSection from '@/components/stats/RevenueSection';
import CategorySection from '@/components/stats/CategorySection';
import ConsultantSection from '@/components/stats/ConsultantSection';
import NoshowReturningSection from '@/components/stats/NoshowReturningSection';
import TherapistStatsSection from '@/components/stats/TherapistStatsSection';
import TmAggregateSection from '@/components/stats/TmAggregateSection';

type StatsTab = 'revenue' | 'therapist' | 'tm';

// T-20260610-foot-STATS-TM-AGGREGATE-TAB: 'TM집계' 탭 추가.
// AC5/AC6 — role 기반 가시성: TM 계정은 'TM집계' 탭만, 그 외 역할은 전체 + TM집계.
const TABS: { key: StatsTab; label: string }[] = [
  { key: 'revenue',   label: '매출 통계' },
  { key: 'therapist', label: '치료사 통계' },
  { key: 'tm',        label: 'TM집계' },
];

const PRESETS: { key: StatsRangePreset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'week',  label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'custom', label: '사용자 지정' },
];

export default function Stats() {
  const clinic = useClinic();
  const { profile } = useAuth();

  // AC5/AC6: role 기반 탭 가시성. TM 계정은 'TM집계' 탭만, 그 외 역할은 전체 노출.
  const isTmOnly = profile?.role === 'tm';
  const visibleTabs = useMemo(
    () => (isTmOnly ? TABS.filter((t) => t.key === 'tm') : TABS),
    [isTmOnly],
  );

  const [tab, setTab] = useState<StatsTab>('revenue');
  const [preset, setPreset] = useState<StatsRangePreset>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo]     = useState<string>('');

  // TM 계정은 진입 시 'TM집계' 탭으로 강제(나머지 탭 숨김). 다른 역할이 숨김 탭에 갇히면 첫 탭으로 복구.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0]?.key ?? 'revenue');
    }
  }, [visibleTabs, tab]);

  const [revenue, setRevenue]                       = useState<RevenueRow[]>([]);
  const [categories, setCategories]                 = useState<CategoryRow[]>([]);
  const [consultants, setConsultants]               = useState<ConsultantRow[]>([]);
  const [noshowReturning, setNoshowReturning]       = useState<NoshowReturningRow[]>([]);
  const [therapistSummary, setTherapistSummary]     = useState<TherapistSummaryRow[]>([]);
  const [therapistServices, setTherapistServices]   = useState<TherapistServiceRow[]>([]);
  const [tmData, setTmData]                         = useState<TmAggregateData | null>(null);
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
        } else if (tab === 'tm') {
          const data = await fetchTmAggregate(clinic.id, from, to);
          if (aborted) return;
          setTmData(data);
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

  // T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE:
  // 매출통계 탭 일간매출보고 다운로드 (실장별 매출/상담건수/객단가 + 총 매출액).
  // 데이터 소스 = 이미 로드된 consultants(foot_stats_consultant RPC).
  // AGG 다운로드 경로(Sales.tsx fetchSalesRawRows)와 코드/데이터 완전 분리.
  const handleExportSalesReport = () => {
    if (loading) return;
    if (consultants.length === 0) {
      toast.info('해당 기간에 실장별 매출 내역이 없습니다.');
      return;
    }
    try {
      downloadConsultantSalesReport(consultants, rangeFrom, rangeTo);
      toast.success(`일간매출보고 다운로드 완료 (실장 ${consultants.length}명)`);
    } catch (e) {
      console.error('[Stats] 일간매출보고 다운로드 실패', e);
      toast.error('다운로드 중 오류가 발생했습니다.');
    }
  };

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
            {visibleTabs.map((t) => (
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

          {/* T-20260622: 매출통계 탭 일간매출보고 다운로드 (매출집계 메뉴와 별개로 이 탭에도 제공) */}
          {tab === 'revenue' && (
            <button
              onClick={handleExportSalesReport}
              disabled={loading}
              data-testid="stats-revenue-export"
              className="flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              일간매출보고 다운로드
            </button>
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
      ) : tab === 'tm' ? (
        <TmAggregateSection
          data={tmData}
          loading={loading}
          currentUserId={profile?.id ?? null}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
        />
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
