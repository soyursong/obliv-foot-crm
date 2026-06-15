// KohRequestToggle — 2번차트 패키지 탭 > 치료부위(발가락) 우측 상단 KOH 균검사 ON/OFF 토글
// Ticket: T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-1)
//
// 흐름: 금일 균검사(check_in_services.service_name ILIKE 'KOH'|'진균검사')가 있을 때만 노출.
//   ON  → set_koh_requested RPC(승인 사용자 누구나, 치료사 포함 한 필드만) → check_in_services.koh_requested=true
//         → 진료대시보드 균검사지 목록에 active(신청)로 표시(AC-2).
//   OFF → koh_requested=false → 균검사지 목록 행 유지·비활성(inactive·회색)(AC-2, 목록 제거 안 함).
//   같은 내원(check_in)의 KOH service 가 여럿이면 전체 일괄 동기화.
//
// 스키마: koh_requested 는 ADDITIVE(DEFAULT false). 마이그 미적용 prod 도달 시 select 42703 → 폴백(미노출).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { Switch } from '@/components/ui/switch';
import { FlaskConical, Loader2 } from 'lucide-react';

interface KohSvcRow {
  id: string;
  service_name: string;
  koh_requested: boolean;
}

// 금일 내원의 KOH 검사 service 조회 — KohReportTab 과 동일한 service_name ILIKE 매칭(SSOT).
//   koh_requested 컬럼 부재(마이그 적용 전) 시 1회 폴백 select → koh_requested=false 간주.
function useKohServicesForCheckIn(checkInId: string | null | undefined) {
  return useQuery<KohSvcRow[]>({
    queryKey: ['koh_services_for_checkin', checkInId],
    enabled: !!checkInId,
    queryFn: async () => {
      if (!checkInId) return [];
      const SEL_WITH = 'id, service_name, koh_requested';
      const SEL_WITHOUT = 'id, service_name';
      const run = (sel: string) =>
        supabase
          .from('check_in_services')
          .select(sel)
          .eq('check_in_id', checkInId)
          .or('service_name.ilike.%KOH%,service_name.ilike.%진균검사%');
      let { data, error } = await run(SEL_WITH);
      if (error && /koh_requested/.test(error.message ?? '')) {
        ({ data, error } = await run(SEL_WITHOUT));
      }
      if (error) throw error;
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
        id: String(r['id']),
        service_name: String(r['service_name'] ?? ''),
        koh_requested: r['koh_requested'] === true,
      }));
    },
    staleTime: 30_000,
  });
}

export default function KohRequestToggle({
  checkInId,
}: {
  checkInId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const { data: svcs = [], isLoading } = useKohServicesForCheckIn(checkInId);

  const anyOn = svcs.some((s) => s.koh_requested);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      // 같은 내원의 KOH service 전체에 동일 값 적용(부분 실패 시 throw).
      for (const s of svcs) {
        const { error } = await supabase.rpc('set_koh_requested', {
          p_check_in_service_id: s.id,
          p_value: next,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, next) => {
      qc.invalidateQueries({ queryKey: ['koh_services_for_checkin', checkInId] });
      // 진료대시보드 균검사지 목록(전 월) 즉시 반영.
      qc.invalidateQueries({ queryKey: ['koh_report'] });
      toast.success(next ? 'KOH 균검사 신청(ON)' : 'KOH 균검사 신청 해제(OFF)');
    },
    onError: (e: Error) => {
      toast.error(`KOH 신청 변경 실패: ${e.message}`);
    },
  });

  // 금일 균검사 service 없음(또는 로딩 중) → 미노출(현장: KOH 검사가 있을 때만 보임).
  if (!checkInId || isLoading || svcs.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50/60 px-2 py-1"
      data-testid="koh-request-toggle"
    >
      <FlaskConical className={`h-3.5 w-3.5 ${anyOn ? 'text-teal-600' : 'text-muted-foreground'}`} />
      <span className="text-[11px] font-semibold text-foreground">KOH 균검사</span>
      {mutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />
      ) : (
        <Switch
          checked={anyOn}
          onCheckedChange={(v) => mutation.mutate(v)}
          disabled={mutation.isPending}
          aria-label="KOH 균검사 신청"
          data-testid="koh-request-switch"
        />
      )}
      <span
        className={`text-[10px] font-medium ${anyOn ? 'text-teal-700' : 'text-muted-foreground/70'}`}
        data-testid="koh-request-state"
      >
        {anyOn ? '신청' : '미신청'}
      </span>
    </div>
  );
}
