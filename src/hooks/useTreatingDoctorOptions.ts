/**
 * useTreatingDoctorOptions — 진료의(treating_doctor) 선택 드롭다운 옵션 SSOT
 * T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC (요청 A/B 옵션 소스 + 요청 D 근무/휴무 disabled)
 *
 * DA CONSULT-REPLY(+ADDENDUM) canonical:
 *  · 옵션 소스 = clinic_doctors (active, clinic-scoped). treating_doctor_id FK = clinic_doctors(id).
 *    (staff(director)로 바꾸면 서류 발행 엔티티(clinic_doctors)와 재-divergence → 반려.)
 *  · 근무/휴무 판정 = clinic_doctors.staff_id ↔ duty_roster.doctor_id(→staff) 조인.
 *      근무(enabled)  ⇔ ∃ duty_roster r: r.clinic_id=cd.clinic_id AND r.date=date
 *                        AND r.doctor_id = cd.staff_id AND r.roster_type <> 'resigned'
 *      휴무(disabled) ⇔ cd.staff_id 연결됨(NOT NULL) AND 위 행 부재
 *    ⚠ duty_roster.doctor_id = clinic_doctors.id 직접조인 금지(엔티티 공간 상이 → 항상 공집합).
 *  · Edge: cd.staff_id IS NULL(미연결) → disabled 아님(enabled 유지) + advisory. over-disable < over-enable
 *    (브릿지 누락으로 실근무 원장을 오잠금하지 않음, AC4 '깨짐 없음' 정합).
 *  · roster_type 'regular'/'part'=근무, 'resigned'=근무 아님. 전원 휴무/로스터 0행 → 전 옵션 disabled 정상.
 *  · 실시간(AC6): duty_roster 변경 즉시 반영 — postgres_changes 구독 → invalidate + staleTime 짧게.
 *
 * disabled 는 filter(제외) 아님 — 옵션에 '표시하되 선택 불가'. UI(드롭다운)에서 disabled 처리.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface TreatingDoctorOption {
  /** clinic_doctors.id — check_ins.treating_doctor_id 에 저장되는 값 */
  id: string;
  name: string;
  license_no: string | null;
  seal_image_url: string | null;
  /** clinic_doctors.staff_id (duty_roster 조인 키). null=미연결 */
  staff_id: string | null;
  /** 오늘(date) 근무 등록 여부 */
  working: boolean;
  /** 표시하되 선택 불가(휴무). filter 아님 */
  disabled: boolean;
  /** staff_id 미연결 → 근무판정 불가(enabled 유지·advisory) */
  unlinked: boolean;
}

/**
 * canonical 근무/휴무 판정 (순수 함수 — DB 조회 결과 → 옵션 배열).
 * 조회와 분리해 단위테스트 가능(E2E spec 이 동일 로직을 직접 단언 → drift 방지).
 *  · working  ⇔ staff_id 연결(NOT NULL) AND workingStaffIds 포함
 *  · disabled ⇔ staff_id 연결됨 AND !working  (휴무: 표시하되 선택 불가 = filter 아님, 요청 D/AC6)
 *  · unlinked(staff_id NULL) → disabled 아님(enabled 유지) + advisory (over-disable 방지, AC4 '깨짐 없음')
 * @param cdRows active clinic_doctors 행(정렬됨). hasStaffIdCol=false면 staff_id 미배포 → 전원 unlinked.
 * @param workingStaffIds 당일 duty_roster 근무 staff id 집합(resigned 제외)
 */
export function computeTreatingDoctorOptions(
  cdRows: Array<Record<string, unknown>>,
  workingStaffIds: Set<string>,
  hasStaffIdCol: boolean,
): TreatingDoctorOption[] {
  return cdRows.map((c) => {
    const staffId = hasStaffIdCol ? ((c['staff_id'] as string | null) ?? null) : null;
    const unlinked = staffId == null;
    const working = !unlinked && workingStaffIds.has(staffId as string);
    // 미연결(unlinked) → disabled 아님(enabled+advisory). 연결됐는데 오늘 로스터 부재 → disabled.
    const disabled = !unlinked && !working;
    return {
      id: String(c['id']),
      name: String(c['name'] ?? ''),
      license_no: (c['license_no'] as string | null) ?? null,
      seal_image_url: (c['seal_image_url'] as string | null) ?? null,
      staff_id: staffId,
      working,
      disabled,
      unlinked,
    };
  });
}

async function fetchOptions(clinicId: string, date: string): Promise<TreatingDoctorOption[]> {
  // 1) 옵션 소스 = active clinic_doctors (clinic-scoped, sort_order)
  let cdRows: Array<Record<string, unknown>> = [];
  let hasStaffIdCol = true;
  {
    const { data, error } = await supabase
      .from('clinic_doctors')
      .select('id, name, license_no, seal_image_url, staff_id, sort_order')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      // 방어: staff_id 컬럼 미배포 환경(42703) → staff_id 없이 재조회(전원 unlinked=enabled).
      if (/staff_id|42703/.test(error.message ?? '')) {
        hasStaffIdCol = false;
        const { data: d2 } = await supabase
          .from('clinic_doctors')
          .select('id, name, license_no, seal_image_url, sort_order')
          .eq('clinic_id', clinicId)
          .eq('active', true)
          .order('sort_order', { ascending: true });
        cdRows = (d2 ?? []) as Array<Record<string, unknown>>;
      } else {
        throw error;
      }
    } else {
      cdRows = (data ?? []) as Array<Record<string, unknown>>;
    }
  }

  // 2) 당일 근무 staff 집합 (duty_roster.doctor_id, resigned 제외)
  const workingStaffIds = new Set<string>();
  if (hasStaffIdCol) {
    const { data: roster } = await supabase
      .from('duty_roster')
      .select('doctor_id, roster_type')
      .eq('clinic_id', clinicId)
      .eq('date', date)
      .neq('roster_type', 'resigned');
    for (const r of (roster ?? []) as Array<{ doctor_id: string | null }>) {
      if (r.doctor_id) workingStaffIds.add(r.doctor_id);
    }
  }

  // 3) canonical 근무/휴무 판정 (순수 로직 위임)
  return computeTreatingDoctorOptions(cdRows, workingStaffIds, hasStaffIdCol);
}

/**
 * 진료의 드롭다운 옵션 + 근무/휴무 disabled 상태.
 * @param clinicId 지점 id
 * @param date 근무판정 기준일(YYYY-MM-DD, KST). 대개 오늘(진료콜) 또는 조회일(진료환자이력).
 */
export function useTreatingDoctorOptions(
  clinicId: string | null | undefined,
  date: string,
) {
  const qc = useQueryClient();
  const query = useQuery<TreatingDoctorOption[]>({
    queryKey: ['treating_doctor_options', clinicId, date],
    enabled: !!clinicId && !!date,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: () => fetchOptions(clinicId!, date),
  });

  // AC6 실시간: duty_roster / clinic_doctors 변경 시 즉시 재계산(활성/비활성 실시간 반영).
  useEffect(() => {
    if (!clinicId) return;
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ['treating_doctor_options', clinicId, date] });
    const channel = supabase
      .channel(`treating_doctor_opts_${clinicId}_${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_roster', filter: `clinic_id=eq.${clinicId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clinic_doctors', filter: `clinic_id=eq.${clinicId}` }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clinicId, date, qc]);

  return query;
}
