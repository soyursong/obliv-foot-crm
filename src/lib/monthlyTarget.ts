/**
 * T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
 * 통계 > "01 매출통계" 최상단 — 이번 달 목표 매출(월별 저장/수정) + 목표 대비 달성률(%).
 *
 * 원칙:
 *  - 달성률 분자(당월 실매출) = **누적매출(순)** = pkg + single − refund (net, accounting_date).
 *    기존 매출통계 '총 매출(순)'/'누적매출(순)' SSOT(fetchRevenue = foot_stats_revenue RPC)를
 *    그대로 소비하며 새 매출 산식을 창작하지 않는다. MTM-RESTRUCTURE curMonthTotal과 동일 산식(정합).
 *    (planner FOLLOWUP MSG-20260804-101002-yms2 앵커 통지)
 *  - 목표금액 보존소 = 신규 monthly_sales_targets (ADDITIVE, clinic_id+year_month UNIQUE upsert).
 *    ★DA CONSULT-REPLY MSG-20260804-101213-0xck GO(조건부·ADDITIVE) 확정.
 *      · write(INSERT/UPDATE) = manager/admin 한정(RLS is_admin_or_manager). SELECT = 승인 staff 전원.
 *      · target_amount basis = CRM 누적매출(순)과 동일 = VAT 포함(부가세 포함) — 달성률 apples-to-apples.
 *      · updated_by = staff.id(엔티티 귀속) — auth.uid() 아님(fetchCurrentStaffId로 해석).
 *  - 월 스코프: 화면 선택기간(refISO)이 속한 '달' 기준(YYYY-MM). 기본 '이번 달'.
 */

import { supabase } from '@/lib/supabase';
import { fetchRevenue } from '@/lib/stats';

/** refISO('YYYY-MM-DD')가 속한 달의 키/경계. day-of-month 계산만 사용 → TZ 안전. */
export function monthScope(refISO: string): {
  yearMonth: string; // 'YYYY-MM'
  from: string;      // 'YYYY-MM-01'
  to: string;        // 'YYYY-MM-<말일>'
} {
  const [y, m] = refISO.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate(); // m(1-based) 말일. TZ 무관.
  const mm = String(m).padStart(2, '0');
  return {
    yearMonth: `${y}-${mm}`,
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(daysInMonth).padStart(2, '0')}`,
  };
}

/**
 * 현재 로그인 사용자의 staff.id 해석.
 * ⚠️ updated_by 는 staff 엔티티 귀속축(DA MSG-20260804-101213-0xck) — auth.uid()/user_profiles.id 아님.
 *   staff.id 는 별도 PK, staff.user_id = auth.uid() 로 연결(clinic_events RC 교훈).
 *   해석 실패 시 null(컬럼 nullable·ON DELETE SET NULL) — write 자체는 진행(telemetry 결손만).
 */
export async function fetchCurrentStaffId(clinicId: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', uid)
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .is('deleted_at', null) // T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT: 삭제 직원 제외
    .maybeSingle();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

/** 해당 월의 목표 매출 조회. 미설정 → null (0과 구분 — 달성률 '-' 처리 근거). */
export async function fetchMonthlyTarget(
  clinicId: string,
  yearMonth: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('monthly_sales_targets')
    .select('target_amount')
    .eq('clinic_id', clinicId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const v = (data as { target_amount: number | null }).target_amount;
  return v === null || v === undefined ? null : Number(v);
}

/** 목표 매출 upsert(월별 저장/수정). (clinic_id, year_month) UNIQUE 충돌 시 갱신. */
export async function upsertMonthlyTarget(
  clinicId: string,
  yearMonth: string,
  targetAmount: number,
  updatedBy: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('monthly_sales_targets')
    .upsert(
      {
        clinic_id: clinicId,
        year_month: yearMonth,
        target_amount: targetAmount,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,year_month' },
    );
  if (error) throw error;
}

/**
 * 당월 실매출(누적매출 순) = 해당 월 1일~말일 net 합.
 * net = package_amount + single_amount − refund_amount (기존 '총 매출(순)' 정의 불변).
 * 미래일(현재월)은 데이터 0이므로 합산에 영향 없음.
 */
export async function fetchMonthRevenueNet(
  clinicId: string,
  from: string,
  to: string,
): Promise<number> {
  const rows = await fetchRevenue(clinicId, from, to);
  let net = 0;
  for (const r of rows) {
    net += (r.package_amount ?? 0) + (r.single_amount ?? 0) - (r.refund_amount ?? 0);
  }
  return net;
}

/**
 * 달성률(%) = 당월 실매출 ÷ 목표매출 × 100.
 * 목표 미설정(null)·0·음수 → null(화면 '-'). 0 나눗셈·0% 오도 방지(AC-3).
 * 100% 초과는 상한 캡 없이 그대로 반환(시나리오 2-4).
 */
export function achievementRate(
  actualNet: number,
  target: number | null,
): number | null {
  if (target === null || !(target > 0)) return null;
  return (actualNet / target) * 100;
}
