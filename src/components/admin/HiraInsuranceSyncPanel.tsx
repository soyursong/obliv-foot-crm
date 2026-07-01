// HiraInsuranceSyncPanel — 심평원(HIRA) 급여목록 배치 동기화 현황 (read-only 로그)
// Ticket: T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE (AC-5 기능 보존)
//
// 추출 출처: InsuranceStatusTab(제거됨)의 "HIRA 배치 동기화 현황" 패널(Phase2, insurance_sync_runs).
//   급여여부 관리 탭 제거(AC-5) 시 이 Phase2 기능이 유실되지 않도록 별도 컴포넌트로 분리 →
//   DrugFoldersTab [전체보기] 하단(처방폴더 내 보조영역)으로 이전처 확정.
//
// 데이터: insurance_sync_runs (RLS read = admin/manager). 월간 엑셀(고시 개정) 배치 동기화 이력.
//   수동 설정 약품은 자동 갱신이 덮지 않음(수동 우선). 동기화 실패 시 직전 급여여부 유지(게이트 안전).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatDateTimeDots } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

// HIRA 배치 동기화 실행 로그 (T-20260609-foot-HIRA-INSURANCE-BATCH Phase2, insurance_sync_runs)
interface SyncRun {
  id: string;
  source_file: string | null;
  source_period: string | null;
  mode: string; // 'dry_run' | 'apply'
  status: string; // 'running' | 'success' | 'failed' | 'partial'
  total_rows: number;
  matched: number;
  updated: number;
  skipped_manual: number;
  unmatched: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  run_by: string | null;
}

interface HiraInsuranceSyncPanelProps {
  /** 조회 권한(admin/manager). RLS read 와 일치 — false 면 미조회/미노출. */
  canWrite: boolean;
}

export default function HiraInsuranceSyncPanel({ canWrite }: HiraInsuranceSyncPanelProps) {
  // HIRA 배치 동기화 현황 — 최근 실행 로그 read-only. RLS read=admin/manager.
  const { data: syncRuns, isLoading: syncLoading } = useQuery({
    queryKey: ['insurance_sync_runs'],
    enabled: canWrite,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('insurance_sync_runs')
        .select(
          'id,source_file,source_period,mode,status,total_rows,matched,updated,skipped_manual,unmatched,error_message,started_at,finished_at,run_by',
        )
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as SyncRun[];
    },
  });

  if (!canWrite) return null;

  // 마지막 "성공 apply" 동기화 시각 = 게이트 데이터 신선도 기준.
  const lastApply = (syncRuns ?? []).find((r) => r.mode === 'apply' && r.status === 'success');

  return (
    <div className="rounded-lg border bg-card" data-testid="insurance-sync-panel">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 bg-muted/20">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="text-sm font-semibold">심평원(HIRA) 급여목록 동기화 현황</span>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="insurance-sync-last">
          <Clock className="h-3 w-3" />
          {lastApply?.finished_at
            ? `마지막 동기화 ${formatDateTimeDots(lastApply.finished_at)}`
            : '동기화 이력 없음'}
        </span>
      </div>
      <div className="px-3 py-2.5 text-[11px] text-muted-foreground border-b bg-amber-50/40 flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        <span>
          급여목록 정본은 공개 API가 아니라 <strong>월간 엑셀(고시 개정 시)</strong>로 배포돼요. 운영자가 파일을 내려받아
          배치(<code className="text-[10px]">hira_insurance_sync</code>)로 동기화하며, <strong>수동 설정한 약품은 자동 갱신이 덮지 않습니다</strong>(수동 우선).
          동기화 실패 시 직전 급여여부가 그대로 유지돼요(처방 게이트 안전 동작).
        </span>
      </div>
      <div className="divide-y divide-border/40 max-h-72 overflow-y-auto" data-testid="insurance-sync-list">
        {syncLoading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : (syncRuns ?? []).length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground" data-testid="insurance-sync-empty">
            아직 동기화를 실행한 적이 없어요. (배치 실행 후 이력이 표시됩니다)
          </div>
        ) : (
          (syncRuns ?? []).map((run) => {
            const ok = run.status === 'success';
            const failed = run.status === 'failed';
            return (
              <div key={run.id} className="flex items-center gap-2 px-3 py-2 text-xs" data-testid="insurance-sync-row">
                {failed ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                ) : ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1 shrink-0 ${run.mode === 'apply' ? 'border-teal-200 text-teal-700 bg-teal-50' : 'border-border text-muted-foreground'}`}
                >
                  {run.mode === 'apply' ? '적용' : '시뮬'}
                </Badge>
                <span className="text-muted-foreground shrink-0">
                  {formatDateTimeDots(run.started_at)}
                </span>
                {run.source_period && <span className="text-[10px] text-muted-foreground shrink-0">{run.source_period}</span>}
                <span className="ml-auto text-right text-[10px] text-muted-foreground truncate">
                  {failed
                    ? `실패: ${run.error_message ?? '오류'}`
                    : `매칭 ${run.matched} · 갱신 ${run.updated} · 수동보존 ${run.skipped_manual} · 미매칭 ${run.unmatched}`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
