// KohRequestToggle — 2번차트 패키지 탭 > 치료부위(발가락) 우측 상단 KOH 균검사 ON/OFF 토글
// Ticket: T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-1)
//         + T-20260616-foot-KOHTOGGLE-NOTRENDER (RC fix: 재방문 시 토글 소멸)
//
// 흐름: 환자가 KOH 균검사(service_name ILIKE 'KOH'|'진균검사')를 받은 적이 있으면 노출.
//   ON  → set_koh_requested RPC(승인 사용자 누구나, 치료사 포함 한 필드만) → check_in_services.koh_requested=true
//         → 진료대시보드 균검사지 목록에 active(신청)로 표시(AC-2).
//   OFF → koh_requested=false → 균검사지 목록 행 유지·비활성(inactive·회색)(AC-2, 목록 제거 안 함).
//   같은 내원(check_in)의 KOH service 가 여럿이면 전체 일괄 동기화.
//
// === T-20260616-foot-KOHTOGGLE-NOTRENDER (RC fix) ===
//   증상: KOH 검사 받은 환자라도 토글이 라이브에서 안 보임(김주연 총괄, 시크릿에서도 미표시).
//   RC: 기존 구현이 latestCheckIn(=customer 의 가장 최근 단일 내원) 하나에만 키잉.
//       KOH 검사 후 환자가 재방문(레이저 치료 등)하면 '최근 내원'엔 KOH service 가 없어 토글 소멸.
//       진단(diag2): KOH 보유 31내원 중 7건(23%)이 이 사유로 미노출.
//       특히 6/15 KOH 검사 → 6/16 재방문 환자 2명(83ab4fe1·16434582)이 정확히 그 케이스.
//   해결: checkInId(단일 내원) 대신 customerId 로, 그 환자의 non-cancelled 내원 전체에서
//       KOH service 보유한 '가장 최근 check_in' 을 타겟으로 선정. 그 내원의 KOH service 만 묶어 동기화.
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

interface KohTarget {
  checkInId: string; // KOH service 가 들어있는 가장 최근 내원 (없으면 '')
  svcs: KohSvcRow[];
}

// customer 의 KOH 검사 service 조회 — KohReportTab 과 동일한 service_name ILIKE 매칭(SSOT).
//   non-cancelled 내원 전체에서 KOH service 를 created_at DESC 로 가져와, 가장 최근 KOH 내원을 타겟으로 선정.
//   같은 내원(check_in)의 KOH service 만 묶는다(타 내원 KOH 는 섞지 않음 — 일괄 동기화 단위 보존).
//   koh_requested 컬럼 부재(마이그 적용 전) 시 1회 폴백 select → koh_requested=false 간주.
function useKohServicesForCustomer(customerId: string | null | undefined) {
  return useQuery<KohTarget>({
    queryKey: ['koh_toggle_target', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const empty: KohTarget = { checkInId: '', svcs: [] };
      if (!customerId) return empty;
      // 임베드(check_ins)는 !inner — customer_id·status 필터가 부모행을 실제로 제한.
      const SEL_WITH =
        'id, service_name, koh_requested, check_in_id, created_at, check_ins!inner(customer_id, status)';
      const SEL_WITHOUT =
        'id, service_name, check_in_id, created_at, check_ins!inner(customer_id, status)';
      const run = (sel: string) =>
        supabase
          .from('check_in_services')
          .select(sel)
          .eq('check_ins.customer_id', customerId)
          .neq('check_ins.status', 'cancelled')
          .or('service_name.ilike.%KOH%,service_name.ilike.%진균검사%')
          .order('created_at', { ascending: false });
      let { data, error } = await run(SEL_WITH);
      if (error && /koh_requested/.test(error.message ?? '')) {
        ({ data, error } = await run(SEL_WITHOUT));
      }
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      if (rows.length === 0) return empty;
      // 가장 최근 KOH service(created_at DESC 첫 행)의 내원을 타겟으로 — 그 내원의 KOH service 만 묶음.
      const targetCheckIn = String(rows[0]['check_in_id'] ?? '');
      const svcs = rows
        .filter((r) => String(r['check_in_id'] ?? '') === targetCheckIn)
        .map((r) => ({
          id: String(r['id']),
          service_name: String(r['service_name'] ?? ''),
          koh_requested: r['koh_requested'] === true,
        }));
      return { checkInId: targetCheckIn, svcs };
    },
    staleTime: 30_000,
  });
}

export default function KohRequestToggle({
  customerId,
}: {
  customerId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const { data: target, isLoading } = useKohServicesForCustomer(customerId);
  const svcs = target?.svcs ?? [];

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
      qc.invalidateQueries({ queryKey: ['koh_toggle_target', customerId] });
      // 진료대시보드 균검사지 목록(전 월) 즉시 반영.
      qc.invalidateQueries({ queryKey: ['koh_report'] });
      toast.success(next ? 'KOH 균검사 신청(ON)' : 'KOH 균검사 신청 해제(OFF)');
    },
    onError: (e: Error) => {
      toast.error(`KOH 신청 변경 실패: ${e.message}`);
    },
  });

  // KOH 검사 이력 없음(또는 로딩 중) → 미노출(현장: KOH 검사 받은 환자에게만 보임).
  if (!customerId || isLoading || svcs.length === 0) return null;

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
