// BloodTestRequestToggle — 2번차트 패키지 탭 > 치료부위 우측 상단, KOH 균검사 ON/OFF 토글 바로 하단 피검사(혈액검사) ON/OFF 토글
// Ticket: T-20260615-foot-BLOODTEST-TOGGLE-ADD (AC-1~4). KohRequestToggle 1:1 미러.
//
// 흐름(🅑 단순 신청 플래그): 환자의 가장 최근 non-cancelled 내원(서비스 보유)을 타겟으로,
//   ON  → set_blood_test_requested RPC(승인 사용자 누구나, 치료사 포함 한 필드만)
//         → 그 내원의 check_in_services 전체 blood_test_requested=true (2번차트 기록만, AC-2).
//   OFF → blood_test_requested=false (데이터 유지·행 삭제 아님). FE 가 false 를 비활성(회색) 렌더(AC-3).
//
// KOH 와의 차이: 피검사는 전용 service_name 이 없으므로 service_name 필터 없이
//   "가장 최근 내원의 서비스 행 전체"를 타겟으로 잡는다(KohRequestToggle 의 KOH service 필터만 제거).
//   → 내원(서비스) 기록 있는 환자에게 노출. 결과지/목록탭/발행 RPC 없음(AC-4, 범위 밖).
//
// 스키마: blood_test_requested 는 ADDITIVE(DEFAULT false). 마이그 미적용 prod 도달 시 select 42703 → 폴백(미노출).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { Switch } from '@/components/ui/switch';
import { Droplet, Loader2 } from 'lucide-react';

interface BloodSvcRow {
  id: string;
  blood_test_requested: boolean;
}

interface BloodTarget {
  checkInId: string; // 가장 최근 서비스 보유 내원 (없으면 '')
  svcs: BloodSvcRow[];
}

// customer 의 가장 최근 non-cancelled 내원(서비스 보유)을 타겟으로 선정.
//   그 내원의 check_in_services 전체를 묶는다(타 내원은 섞지 않음 — 일괄 동기화 단위 보존).
//   blood_test_requested 컬럼 부재(마이그 적용 전) 시 1회 폴백 select → false 간주.
function useBloodServicesForCustomer(customerId: string | null | undefined) {
  return useQuery<BloodTarget>({
    queryKey: ['blood_toggle_target', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const empty: BloodTarget = { checkInId: '', svcs: [] };
      if (!customerId) return empty;
      // 임베드(check_ins)는 !inner — customer_id·status 필터가 부모행을 실제로 제한.
      const SEL_WITH =
        'id, blood_test_requested, check_in_id, created_at, check_ins!inner(customer_id, status)';
      const SEL_WITHOUT =
        'id, check_in_id, created_at, check_ins!inner(customer_id, status)';
      const run = (sel: string) =>
        supabase
          .from('check_in_services')
          .select(sel)
          .eq('check_ins.customer_id', customerId)
          .neq('check_ins.status', 'cancelled')
          .order('created_at', { ascending: false });
      let { data, error } = await run(SEL_WITH);
      if (error && /blood_test_requested/.test(error.message ?? '')) {
        ({ data, error } = await run(SEL_WITHOUT));
      }
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      if (rows.length === 0) return empty;
      // 가장 최근 서비스(created_at DESC 첫 행)의 내원을 타겟으로 — 그 내원의 서비스 행만 묶음.
      const targetCheckIn = String(rows[0]['check_in_id'] ?? '');
      const svcs = rows
        .filter((r) => String(r['check_in_id'] ?? '') === targetCheckIn)
        .map((r) => ({
          id: String(r['id']),
          blood_test_requested: r['blood_test_requested'] === true,
        }));
      return { checkInId: targetCheckIn, svcs };
    },
    staleTime: 30_000,
  });
}

export default function BloodTestRequestToggle({
  customerId,
}: {
  customerId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const { data: target, isLoading } = useBloodServicesForCustomer(customerId);
  const svcs = target?.svcs ?? [];

  const anyOn = svcs.some((s) => s.blood_test_requested);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      // 같은 내원의 서비스 행 전체에 동일 값 적용(부분 실패 시 throw).
      for (const s of svcs) {
        const { error } = await supabase.rpc('set_blood_test_requested', {
          p_check_in_service_id: s.id,
          p_value: next,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, next) => {
      qc.invalidateQueries({ queryKey: ['blood_toggle_target', customerId] });
      toast.success(next ? '피검사 신청(ON)' : '피검사 신청 해제(OFF)');
    },
    onError: (e: Error) => {
      toast.error(`피검사 신청 변경 실패: ${e.message}`);
    },
  });

  // 내원(서비스) 기록 없음(또는 로딩 중) → 미노출(기록할 진료 레코드가 있어야 신청 가능).
  if (!customerId || isLoading || svcs.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50/60 px-2 py-1"
      data-testid="blood-test-request-toggle"
    >
      <Droplet className={`h-3.5 w-3.5 ${anyOn ? 'text-rose-600' : 'text-muted-foreground'}`} />
      <span className="text-[11px] font-semibold text-foreground">피검사</span>
      {mutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
      ) : (
        <Switch
          checked={anyOn}
          onCheckedChange={(v) => mutation.mutate(v)}
          disabled={mutation.isPending}
          aria-label="피검사 신청"
          data-testid="blood-test-request-switch"
        />
      )}
      <span
        className={`text-[10px] font-medium ${anyOn ? 'text-rose-700' : 'text-muted-foreground/70'}`}
        data-testid="blood-test-request-state"
      >
        {anyOn ? '신청' : '미신청'}
      </span>
    </div>
  );
}
