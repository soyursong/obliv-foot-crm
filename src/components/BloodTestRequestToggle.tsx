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
//
// === T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION: 단독 검사신청 차단 해소(KOH 패턴 미러) ===
//   reporter 김주연 총괄 확정: "검사 신청 시스템으로 제약 걸지마, 현장 실장이 판단해 신청".
//   旣 차단점: svcs.length===0 게이트(L142) → 서비스 행 없는 환자는 ON 자체 불가.
//   [FIX] 쓰기를 단일 RPC request_blood_test_for_customer 로 전환(KohRequestToggle 단일 RPC 동형, 서버 SSOT):
//     · 서비스 행 보유 내원 → 그 내원 서비스 행 전체 blood_test_requested 동기화(旣 행별 루프 동작 보존).
//     · 서비스 행 없음 + ON → 서버가 최근 non-cancelled 내원에 피검사 요청 행 신규 생성(price=0 마커).
//     · 서비스 행 없음 + OFF → no-op. FE 는 분기/루프/차단 게이트 없음.
//   노출 게이트(hasCheckIn, AC-4)는 유지.
//
// === T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST (AC-4): 노출 게이트 KOH 정합 ===
//   [RC] 본 토글은 8d30bf64(2026-06-17 KOH 1:1 미러) 이후 갱신 없음. 그 사이 KohRequestToggle 은
//     4a9368a1(KOHTOGGLE-NOTRENDER: 재방문 시 토글 소멸 RC) + d97d8a35(KOH-BUTTON-ALL-CH: 체크인 전원 노출)
//     두 차례 게이트가 hasCheckIn(check_ins 직접 조회) 기반으로 교정됐으나, 피검사는 구(舊) svcs.length===0
//     게이트에 잔류 → svcs 임베드 쿼리(check_in_services!inner check_ins)가 비거나 에러나면 미노출.
//     현장 제보 "있다 없다 함 → 전체 안 보임"(MSG-aw1b)이 정확히 KOH 가 이미 고친 NOTRENDER 증상.
//   [FIX] 노출 게이트를 KOH 와 동일하게 hasCheckIn(체크인 내원 존재)로 전환 → svcs 쿼리 결과와 독립.
//     상태(anyOn)·쓰기(set_blood_test_requested)는 기존 svcs 기반 유지(서버 RPC/스키마 추가 없음, db_change=false).
//     svcs 비어있을 때 ON 시도 → 안내 토스트(무행위 silent 방지). 신규 행 생성은 본 스코프 밖(KOH request RPC 미보유).
//   결과지/목록탭/발행 RPC 없음(AC-4 원티켓 범위 밖).
//
// 스키마: blood_test_requested 는 ADDITIVE(DEFAULT false). 마이그 미적용 prod 도달 시 select 42703 → 폴백.

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

// T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST (AC-4): 노출 게이트 — KohRequestToggle 의 useHasCheckIn 동형.
//   customer 의 non-cancelled 내원 존재 여부(check_ins 직접 조회, svcs 임베드와 독립). 2번차트 환자는 사실상 항상 true.
function useHasCheckIn(customerId: string | null | undefined) {
  return useQuery<boolean>({
    queryKey: ['blood_has_checkin', customerId],
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

export default function BloodTestRequestToggle({
  customerId,
}: {
  customerId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const { data: target, isLoading } = useBloodServicesForCustomer(customerId);
  const { data: hasCheckIn, isLoading: ciLoading } = useHasCheckIn(customerId);
  const svcs = target?.svcs ?? [];

  const anyOn = svcs.some((s) => s.blood_test_requested);

  const mutation = useMutation({
    // T-20260623-PKGTAB-BLOODTEST-NOSVCROW-DECISION: 단일 RPC 위임(KohRequestToggle L119~127 동형).
    //   서버 SSOT — 서비스 행 있으면 동기화, 없으면 ON 시 신규 생성. FE 가 분기/루프 안 함.
    //   (旣 set_blood_test_requested 행별 루프 + svcs.length===0 차단 게이트 제거.)
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc('request_blood_test_for_customer', {
        p_customer_id: customerId,
        p_value: next,
      });
      if (error) throw error;
    },
    onSuccess: (_d, next) => {
      qc.invalidateQueries({ queryKey: ['blood_toggle_target', customerId] });
      qc.invalidateQueries({ queryKey: ['blood_has_checkin', customerId] });
      // 치료테이블 '균검사 & 피검사 대상자' 목록 즉시 반영.
      qc.invalidateQueries({ queryKey: ['exam_targets'] });
      toast.success(next ? '피검사 신청(ON)' : '피검사 신청 해제(OFF)');
    },
    onError: (e: Error) => {
      toast.error(`피검사 신청 변경 실패: ${e.message}`);
    },
  });

  // AC-4: 노출 게이트 KOH 정합 — 체크인 내원 있는 환자 전원 노출(svcs 쿼리 결과·이력 무관). 로딩/내원없음 → 미노출.
  if (!customerId || isLoading || ciLoading || !hasCheckIn) return null;

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
