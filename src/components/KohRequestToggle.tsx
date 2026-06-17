// KohRequestToggle — 2번차트 패키지 탭 > 치료부위(발가락) 우측 상단 KOH 균검사 ON/OFF 토글
// Ticket: T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-1)
//         + T-20260616-foot-KOHTOGGLE-NOTRENDER (RC fix: 재방문 시 토글 소멸)
//         + T-20260616-foot-KOH-BUTTON-ALL-CH (이력 무관 체크인 전원 노출 + ON 시 검사요청 신규 생성)
//
// 흐름(BUTTON-ALL-CH, 피검사 토글 8d30bf64 동형): 체크인 내원이 있는 환자 전원에게 노출(KOH 이력 무관).
//   기본 OFF. reporter 김주연 총괄 확정(②) "피검사처럼 기본 고정값".
//   ON  → request_koh_for_customer RPC(승인 사용자 누구나, 치료사 포함):
//          · KOH 보유 내원 존재 → 그 내원의 KOH service 전체 koh_requested=true(旣 동작 보존, 시나리오2).
//          · KOH 이력 없음 → 가장 최근 non-cancelled 내원에 KOH 검사요청 행 신규 생성(시나리오1).
//         → 진료대시보드 균검사지 목록에 active(신청)로 표시(AC-2).
//   OFF → koh_requested=false → 목록 행 유지·비활성(이력 없으면 no-op). 목록 제거 안 함.
//
// === T-20260616-foot-KOHTOGGLE-NOTRENDER (RC fix, 보존) ===
//   KOH 보유 내원 타겟팅 = customer 의 non-cancelled 내원 전체에서 KOH service 보유 '가장 최근 check_in'.
//   재방문(레이저 등)으로 최근 내원에 KOH 가 없어도 KOH 보유 내원을 추적해 상태 반영. RPC 가 동일 로직 SSOT.
//
// 노출 게이트: '체크인 내원 존재'(hasCheckIn). KOH service 유무가 아님(BUTTON-ALL-CH 핵심 변경점).
// 상태(anyOn): KOH 보유 내원의 koh_requested. 이력 없으면 false(기본 OFF).
// 스키마: koh_requested 는 ADDITIVE(DEFAULT false). 마이그 미적용 prod 도달 시 select 42703 → 폴백.

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

// BUTTON-ALL-CH 노출 게이트 — customer 의 non-cancelled 내원 존재 여부(이력 무관 전원 노출).
//   KOH service 유무와 독립. 2번차트 환자는 체크인이 있으므로 사실상 항상 true(피검사 동형 항상 표시).
function useHasCheckIn(customerId: string | null | undefined) {
  return useQuery<boolean>({
    queryKey: ['koh_has_checkin', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      if (!customerId) return false;
      const { data, error } = await supabase
        .from('check_ins')
        .select('id')
        .eq('customer_id', customerId)
        .neq('status', 'cancelled')
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
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
  const { data: hasCheckIn, isLoading: ciLoading } = useHasCheckIn(customerId);
  const svcs = target?.svcs ?? [];

  // 상태: KOH 보유 내원의 koh_requested. 이력 없으면 false(기본 OFF).
  const anyOn = svcs.some((s) => s.koh_requested);

  const mutation = useMutation({
    // BUTTON-ALL-CH: 단일 RPC 위임 — 이력 있으면 동기화, 없으면 ON 시 신규 생성. FE 가 분기 안 함(서버 SSOT).
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc('request_koh_for_customer', {
        p_customer_id: customerId,
        p_value: next,
      });
      if (error) throw error;
    },
    onSuccess: (_d, next) => {
      qc.invalidateQueries({ queryKey: ['koh_toggle_target', customerId] });
      qc.invalidateQueries({ queryKey: ['koh_has_checkin', customerId] });
      // 진료대시보드 균검사지 목록(전 월) 즉시 반영.
      qc.invalidateQueries({ queryKey: ['koh_report'] });
      toast.success(next ? 'KOH 균검사 신청(ON)' : 'KOH 균검사 신청 해제(OFF)');
    },
    onError: (e: Error) => {
      toast.error(`KOH 신청 변경 실패: ${e.message}`);
    },
  });

  // BUTTON-ALL-CH: 체크인 내원 있는 환자 전원 노출(이력 무관). 로딩/내원없음 → 미노출.
  if (!customerId || isLoading || ciLoading || !hasCheckIn) return null;

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
