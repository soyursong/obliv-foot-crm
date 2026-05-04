/**
 * useDutyRoster — 당일 근무원장님 조회 훅 + 유틸
 * T-20260502-foot-DUTY-ROSTER
 *
 * - useDutyDoctors(clinicId, date) : React Query hook — active director 목록
 * - fetchDutyDoctors(clinicId, date) : 비동기 one-shot fetch (DocumentPrintPanel 등 비훅 컨텍스트용)
 * - fetchDutyDoctorName(clinicId, date) : 서류 자동 바인딩용 — 1명이면 이름, 아니면 null
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ─── 타입 ───────────────────────────────────────────────────────────────────

export interface DutyDoctor {
  /** staff.id */
  id: string;
  name: string;
  role: string;
  roster_type: 'regular' | 'part';
  /** duty_roster.id */
  duty_roster_id: string;
}

// ─── 내부 공통 쿼리 ──────────────────────────────────────────────────────────

async function _fetchRaw(clinicId: string, date: string): Promise<DutyDoctor[]> {
  // Step 1: 해당 날짜 duty_roster 항목 조회 (resigned 제외)
  const { data: rosterRows, error } = await supabase
    .from('duty_roster')
    .select('id, roster_type, doctor_id')
    .eq('clinic_id', clinicId)
    .eq('date', date)
    .neq('roster_type', 'resigned');

  if (error || !rosterRows?.length) return [];

  // Step 2: 해당 staff 정보 조회 (active director만)
  const doctorIds = rosterRows.map((r: { id: string; roster_type: string; doctor_id: string }) => r.doctor_id);
  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, name, role')
    .in('id', doctorIds)
    .eq('active', true)
    .eq('role', 'director');

  if (!staffRows?.length) return [];

  return (staffRows as { id: string; name: string; role: string }[])
    .map((s) => {
      const entry = rosterRows.find(
        (r: { id: string; roster_type: string; doctor_id: string }) => r.doctor_id === s.id,
      )!;
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        roster_type: entry.roster_type as 'regular' | 'part',
        duty_roster_id: entry.id,
      };
    });
}

// ─── React Query 훅 ──────────────────────────────────────────────────────────

/**
 * 특정 날짜·클리닉의 근무 원장님(director) 목록 반환.
 * roster_type='resigned' 및 비활성 직원 자동 제외.
 */
export function useDutyDoctors(
  clinicId: string | null | undefined,
  date: string,
) {
  return useQuery<DutyDoctor[]>({
    queryKey: ['duty_doctors', clinicId, date],
    enabled: !!clinicId && !!date,
    staleTime: 60_000,
    queryFn: () => _fetchRaw(clinicId!, date),
  });
}

// ─── 비훅 유틸 ───────────────────────────────────────────────────────────────

/**
 * 비동기 one-shot fetch — hook을 쓸 수 없는 컨텍스트에서 사용.
 */
export async function fetchDutyDoctors(
  clinicId: string,
  date: string,
): Promise<DutyDoctor[]> {
  return _fetchRaw(clinicId, date);
}

/**
 * 서류 자동 바인딩용 편의 함수.
 * - 1명 근무 → 이름 반환
 * - 0명 또는 2명 이상 → null (UI에서 선택 유도)
 */
export async function fetchDutyDoctorName(
  clinicId: string,
  date: string,
): Promise<string | null> {
  const docs = await _fetchRaw(clinicId, date);
  return docs.length === 1 ? docs[0].name : null;
}
