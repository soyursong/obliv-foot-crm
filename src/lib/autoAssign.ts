/**
 * autoAssign — 상담/치료 자동배정·균등분배·토스(push)·당김(pull) 엔진
 * T-20260617-foot-AUTOASSIGN-BALANCE-TOSS
 *
 * ── 설계 근거(현장 확정 doc o2k7 17:13 + DA CONSULT-REPLY dfd8 17:27) ──
 *  트리거: 상담사 = [상담대기](consult_waiting) 슬롯 진입 시 / 치료사 = [치료대기](treatment_waiting) 진입 시.
 *  우선순위(0순위 지정 담당 우선 → 1순위 월 균등 least-loaded):
 *    상담 = customers.assigned_consultant_id(담당 실장) 우선 / 치료 = customers.designated_therapist_id(지정 치료사) 우선.
 *    지정자 당일 휴무 → 후보 풀에서 fallback(= least-loaded, o2k7 최종 권위로 '랜덤'→'이달 건수 적은 분' 정정).
 *  균등 sublogic(질문②): ① 이번 달 동일 축(axis) 배정 건수 최소 → ② 당일 배정 건수 최소 → ③ 랜덤.
 *  재진(returning) 축 = 월 균등 집계 제외, 카운트만 기록(별도).
 *  카운트 SSOT(DA dfd8 #2): 월 균등·토스 N건·당김 N건 전부 assignment_actions count(*) 파생.
 *
 * ── 당일 출근 후보 풀(o2k7 ③ / DA #5 GO_WARN) ──
 *  기존 [직원 근무 캘린더] 구글시트 read(lib/dutySheet.ts) 재사용. 시트는 "이름"만 알려주므로
 *  staff.name/display_name 매칭으로 출근 staff id 집합을 만든다.
 *  ※ 추가출근(ad-hoc) 수기 입력(#5 sub-feature)은 deferred(DA supplement 대기) — 본 엔진 미포함.
 *
 * ── 멱등(idempotent)·다중 클라이언트 안전 ──
 *  자동배정은 조건부 UPDATE(`consultant_id IS NULL` 가드 + `.select()`)로 단 1개 클라이언트만 성공시킨다.
 *  성공한 클라이언트만 assignment_actions(auto_assign) 로그를 남긴다(중복 로그 방지).
 *  best-effort: 어떤 실패도 throw 하지 않음(배정 실패가 슬롯 이동 동선을 막지 않도록).
 */
import { supabase } from './supabase';
import { fetchTodayAttendeeNames, DUTY_SHEET_GIDS } from './dutySheet';
import { todaySeoulISODate } from './format';
import type {
  AssignmentRole,
  AssignmentActionType,
  AssignmentAction,
  Staff,
  CheckInStatus,
} from './types';

/**
 * T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP:
 * 재진(returning) + 지정 담당자(0순위) 정상 배정 시 assignment_actions.reason 에 남기는 sentinel.
 *  · 카운트/부하 집계 정합 영향 0 — 배정 누적 SSOT=check_ins(Assignments §5b), computeLoad/fetchMonthActions 는
 *    reason 을 보지 않음 → ASSIGN-COUNT-TOSS-3FIX 보존(행은 그대로 INSERT, 표시만 억제).
 *  · AssignmentNotifyBell 만 이 reason 행을 '담당자 배정 알림' 노출에서 제외(이미 지정 담당 → 배정 인지 불필요).
 *  · 휴무·임시off·미지정·판정실패 → 지정담당 미선택(fallback) → sentinel 미부여 → 알림 노출(AC-3/AC-5 보수적 default).
 * (DB 무변경 — reason 은 기존 컬럼. 신규 enum/컬럼 0.)
 */
export const ASSIGN_SILENT_REASON = 'silent_revisit_designated';

/**
 * T-20260701-foot-DESIGNATED-STAFF-SHEET-MATCH-GUARD (배정 로직 무변경 · 관찰/경고 레이어):
 * 지정 담당(0순위)이 존재하나 당일 근무 미매칭(구글시트 이름매칭 실패/미출근) 또는 임시off 로
 * fallback(균등배정)된 케이스의 '이유'를 assignment_actions.reason 에 구조화 태그로 남긴다.
 *   형식: `designated_fallback:{kind}:{staffName}`
 *     kind = not_in_working_ids (근무목록 미매칭 — 시트/이름표기 확인 필요)
 *          | temp_off          (운영자가 임시휴무 토글 — 원인 명확)
 *   · reason 은 카운트/부하 집계 비참조(computeLoad/fetchMonthActions 는 reason 무관) → 집계 영향 0.
 *   · 재진 sentinel(ASSIGN_SILENT_REASON)과 상호배타(fallback ⇒ usedDesignated=false) →
 *     AssignmentNotifyBell 의 sentinel suppress 에 걸리지 않음 → 알림 노출 유지(AC-1/AC-2, 운영자 인지).
 *   · '지정치료사인데 왜 균등배정?' 오인 민원의 원인(시트미매칭 vs 임시off)을 운영자가 구분해 보게 함.
 * (DB 무변경 — reason 은 기존 자유텍스트 컬럼. 신규 enum/컬럼 0.)
 */
export const DESIGNATED_FALLBACK_PREFIX = 'designated_fallback';
export type DesignatedFallbackKind = 'not_in_working_ids' | 'temp_off';

/** fallback 사유 태그 문자열 생성. 구분자(: 개행) 충돌 방지 위해 이름을 sanitize. */
export function buildDesignatedFallbackReason(
  kind: DesignatedFallbackKind,
  staffName: string | null,
): string {
  const nm = (staffName ?? '').replace(/[:\r\n]/g, ' ').trim();
  return `${DESIGNATED_FALLBACK_PREFIX}:${kind}:${nm}`;
}

/** fallback 사유 태그 파싱. 태그가 아니면 null(일반 배정/재진 sentinel/토스 사유 등과 무충돌). */
export function parseDesignatedFallbackReason(
  reason: string | null | undefined,
): { kind: DesignatedFallbackKind; staffName: string } | null {
  if (!reason || !reason.startsWith(`${DESIGNATED_FALLBACK_PREFIX}:`)) return null;
  const rest = reason.slice(DESIGNATED_FALLBACK_PREFIX.length + 1);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;
  const kind = rest.slice(0, sep);
  const staffName = rest.slice(sep + 1).trim();
  if (kind !== 'not_in_working_ids' && kind !== 'temp_off') return null;
  return { kind, staffName };
}

// ── 축(axis) 파생 ─────────────────────────────────────────────────────────────

/** 상담 축 라벨(집계 그룹키). 재진='returning'(균등 제외). 그 외 = TM/인바운드/워크인. */
const CONSULT_AXES = ['TM', '인바운드', '워크인'] as const;

export function deriveConsultAxis(c: {
  visit_type?: string | null;
  lead_source?: string | null;
  visit_route?: string | null;
}): string {
  if (c.visit_type === 'returning') return 'returning';
  const raw = (c.visit_route ?? c.lead_source ?? '').trim();
  if ((CONSULT_AXES as readonly string[]).includes(raw)) return raw;
  // 지인소개·온라인·기타 등은 워크인 성격으로 수렴(균등 대상). 미상=워크인.
  return '워크인';
}

/** 재진 여부(월 균등 집계 제외 판정) */
export function isReturningAxis(axis: string | null | undefined): boolean {
  return axis === 'returning';
}

/** 치료 축 라벨: 본치료(main) / 포돌로게(podologue) / 체험(trial). best-effort 스냅샷. */
export function deriveTherapyAxis(ci: {
  treatment_kind?: string | null;
  treatment_category?: string | null;
  status_flag?: string | null;
}): string {
  const hay = `${ci.treatment_kind ?? ''} ${ci.treatment_category ?? ''}`.toLowerCase();
  if (hay.includes('podolog') || hay.includes('포돌')) return 'podologue';
  if (ci.status_flag === 'green' || hay.includes('trial') || hay.includes('체험')) return 'trial';
  return 'main';
}

// ── staff 역할 → 후보 풀 매핑 ─────────────────────────────────────────────────

const ROLE_STAFF_ROLE: Record<AssignmentRole, string> = {
  consult: 'consultant',
  therapy: 'therapist',
};

// ── 데이터 조회 ───────────────────────────────────────────────────────────────

/** 활성 staff 전체(이름 매칭·후보 풀용) */
export async function fetchActiveStaff(clinicId: string): Promise<Staff[]> {
  // ⚠ staff.display_name 컬럼은 DB 미존재(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션).
  //   select 포함 시 PostgREST 400 → staff=[] → 출근자 매칭·배정 풀 전부 공집합.
  //   (T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX) UI/매칭은 display_name ?? name fallback 유지.
  const { data } = await supabase
    .from('staff')
    .select('id, clinic_id, name, role, active, created_at')
    .eq('clinic_id', clinicId)
    .eq('active', true);
  return (data ?? []) as Staff[];
}

/**
 * 당일 출근한 staff id 집합 — 구글시트 근무 캘린더 read + 이름 매칭.
 * 시트 장애 시 graceful: 빈 set 반환 → 호출측에서 "출근자 미확인" 처리.
 */
export async function fetchTodayWorkingStaffIds(
  clinicId: string,
  staff?: Staff[],
): Promise<Set<string>> {
  const list = staff ?? (await fetchActiveStaff(clinicId));
  const allNames = list.map((s) => s.name);
  const today = todaySeoulISODate();
  let names: string[] = [];
  try {
    names = await fetchTodayAttendeeNames(today, DUTY_SHEET_GIDS, allNames);
  } catch {
    names = [];
  }
  const nameSet = new Set(names.map((n) => n.trim()));
  const ids = new Set<string>();
  for (const s of list) {
    const nm = (s.display_name ?? s.name ?? '').trim();
    if (nameSet.has(nm) || nameSet.has((s.name ?? '').trim())) ids.add(s.id);
  }
  return ids;
}

/**
 * 오늘(KST) '임시 off'(자동배정 임시제외) staff id 집합.
 * T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: 출근(workingIds)은 유지하되 자동배정 후보풀에서만 제외.
 *   row 존재 = 오늘 제외, 삭제 = 복귀. work_date 는 KST date(서버 default 와 동일 캐스트)로 판정.
 *   격리는 RLS(부모 staff join-via-parent)가 담당 → 별도 clinic 필터 불요(staff_id 전역유니크).
 *   장애 시 graceful: 빈 set 반환(제외 0 = 자동배정 동선 막지 않음).
 */
export async function fetchTodayTempOffStaffIds(): Promise<Set<string>> {
  const today = todaySeoulISODate(); // YYYY-MM-DD (KST)
  try {
    const { data } = await supabase
      .from('staff_temp_off')
      .select('staff_id')
      .eq('work_date', today);
    return new Set<string>((data ?? []).map((r) => (r as { staff_id: string }).staff_id));
  } catch {
    return new Set<string>();
  }
}

/**
 * 직원 '임시 off' 토글. on=true → 오늘(KST) row upsert(제외), false → delete(복귀).
 * 멱등: upsert(staff_id, work_date PK) / delete idempotent. 성공 여부 boolean.
 */
export async function setStaffTempOff(
  staffId: string,
  on: boolean,
  createdBy: string | null = null,
): Promise<boolean> {
  const today = todaySeoulISODate(); // KST date — 서버 default 와 동일 산출(UTC 자정 drift 방어)
  try {
    if (on) {
      const { error } = await supabase
        .from('staff_temp_off')
        .upsert(
          { staff_id: staffId, work_date: today, created_by: createdBy },
          { onConflict: 'staff_id,work_date' },
        );
      return !error;
    }
    const { error } = await supabase
      .from('staff_temp_off')
      .delete()
      .eq('staff_id', staffId)
      .eq('work_date', today);
    return !error;
  } catch {
    return false;
  }
}

/**
 * (clinic_id, role) 자동배정 기본순번 맵 — T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER.
 *   staff.assign_sort_order(ADDITIVE) 를 별도 조회. key=staffId, value=순번(작을수록 우선).
 *
 * ⚠ 사고 방지(T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX 교훈): 신규 컬럼을 fetchActiveStaff 의
 *   메인 select 에 넣으면 컬럼 미적용(마이그레이션 전) 시 PostgREST 42703 → staff=[] → 배정 전면 마비.
 *   → 순번은 독립 함수로 분리하고 어떤 오류든 빈 맵 반환(graceful). 빈 맵이면 pickLeastLoaded 가
 *   기존 random tie-break 로 자연 fallback → 자동배정 동선은 절대 막히지 않는다(컬럼 적용 전 배포 안전).
 */
export async function fetchAssignSortOrder(clinicId: string): Promise<Map<string, number>> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('id, assign_sort_order')
      .eq('clinic_id', clinicId)
      .eq('active', true);
    if (error) return new Map(); // 컬럼 미존재(42703) 등 — graceful 빈 맵
    const m = new Map<string, number>();
    for (const r of (data ?? []) as { id: string; assign_sort_order: number | null }[]) {
      if (r.assign_sort_order != null) m.set(r.id, r.assign_sort_order);
    }
    return m;
  } catch {
    return new Map();
  }
}

/** 이번 달(KST) assignment_actions 전체 — 균등/토스/당김 카운트 파생 SSOT */
export async function fetchMonthActions(clinicId: string): Promise<AssignmentAction[]> {
  const today = todaySeoulISODate(); // YYYY-MM-DD
  const monthStart = `${today.slice(0, 7)}-01T00:00:00+09:00`;
  const { data } = await supabase
    .from('assignment_actions')
    .select('*')
    .eq('clinic_id', clinicId)
    .gte('created_at', monthStart);
  return (data ?? []) as AssignmentAction[];
}

// ── 부하(load) 카운트 산출 ────────────────────────────────────────────────────

export interface LoadCounts {
  /** 월 균등 부하: 역할·축별 net(받음 − 토스로 넘김). 재진(returning)은 제외. key=staffId */
  monthlyByAxis: Map<string, number>;
  /** 당일 net 배정 건수(축 무관, 재진 제외). key=staffId */
  todayNet: Map<string, number>;
  /** 토스 N건(넘긴 사람 기준 누적). key=staffId */
  tossGiven: Map<string, number>;
  /** 당김 N건(받은 사람 기준 누적). key=staffId */
  pullCount: Map<string, number>;
}

function inc(m: Map<string, number>, k: string | null, d = 1) {
  if (!k) return;
  m.set(k, (m.get(k) ?? 0) + d);
}

/**
 * 균등 selection 을 위한 부하 카운트 산출.
 * @param role  consult|therapy
 * @param axis  대상 축(returning이면 균등 부하 산출 불필요 — 빈 맵)
 */
export function computeLoad(
  actions: AssignmentAction[],
  role: AssignmentRole,
  axis: string,
  todayIso: string,
): LoadCounts {
  const monthlyByAxis = new Map<string, number>();
  const todayNet = new Map<string, number>();
  const tossGiven = new Map<string, number>();
  const pullCount = new Map<string, number>();

  for (const a of actions) {
    const day = a.created_at.slice(0, 10); // created_at UTC지만 월/일 근사 — 표시·균등용으론 충분
    // 토스 N건(전 역할·전 축, 넘긴 사람)
    if (a.action_type === 'toss') inc(tossGiven, a.from_staff_id);
    // 당김 N건(전 역할·전 축, 받은 사람)
    if (a.action_type === 'pull_in') inc(pullCount, a.to_staff_id);

    if (a.role !== role) continue;
    if (isReturningAxis(a.axis)) continue; // 재진=균등 제외

    // 월 균등 부하(동일 축): 배정 받으면 +1, 토스로 넘기면 원담당 −1
    if (a.axis === axis) {
      if (a.action_type === 'toss') {
        inc(monthlyByAxis, a.to_staff_id, 1);
        inc(monthlyByAxis, a.from_staff_id, -1);
      } else {
        inc(monthlyByAxis, a.to_staff_id, 1);
      }
    }
    // 당일 net(축 무관)
    if (day >= todayIso) {
      if (a.action_type === 'toss') {
        inc(todayNet, a.to_staff_id, 1);
        inc(todayNet, a.from_staff_id, -1);
      } else {
        inc(todayNet, a.to_staff_id, 1);
      }
    }
  }
  return { monthlyByAxis, todayNet, tossGiven, pullCount };
}

// ── least-loaded 선택 ─────────────────────────────────────────────────────────

/**
 * 균등 우선순위: ① 이달 동일 축 배정 최소 → ② 당일 배정 최소 → ③ 기본순번(round-robin) → ④ 랜덤.
 *
 * T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER (Option B, 비파괴 확장):
 *   기존 3순위 '랜덤'을 '기본순번(assign_sort_order)'으로 격상하고 랜덤은 4순위로 강등.
 *   - 월초 전원 0건 → ①② 동률 → 순번 1번부터 배정(현장 AC 시나리오1 충족).
 *   - 배정될수록 ①(월 누적)이 올라가 다음 순번으로 자연 순환 = round-robin. 월균등 primary 비파괴.
 *   - 휴무/임시 off 직원은 호출 전 후보 풀에서 이미 제외(skip) → 자동으로 다음 순번 차례.
 *   - 순번 미지정(NULL)·동순번은 BIG 로 후순위 + 랜덤 tie-break(기존 동작 보존).
 *
 * @param candidates 후보 staff id 목록(이미 당일 출근 + 역할 − 임시off 필터됨)
 * @param load 부하 카운트
 * @param order (선택) staffId→기본순번 맵. 미전달/빈 맵이면 기존 random tie-break 로 동작(하위호환).
 */
export function pickLeastLoaded(
  candidates: string[],
  load: LoadCounts,
  order?: Map<string, number>,
): string | null {
  if (candidates.length === 0) return null;
  const NO_ORDER = Number.MAX_SAFE_INTEGER; // 순번 미지정 = 후순위
  const scored = candidates.map((id) => ({
    id,
    monthly: load.monthlyByAxis.get(id) ?? 0,
    today: load.todayNet.get(id) ?? 0,
    ord: order?.get(id) ?? NO_ORDER,
    rnd: Math.random(),
  }));
  scored.sort((a, b) =>
    a.monthly - b.monthly || a.today - b.today || a.ord - b.ord || a.rnd - b.rnd,
  );
  return scored[0].id;
}

// ── 로그 ──────────────────────────────────────────────────────────────────────

export interface LogInput {
  clinicId: string;
  checkInId: string | null;
  actionType: AssignmentActionType;
  role: AssignmentRole;
  axis: string | null;
  fromStaffId?: string | null;
  toStaffId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
}

export async function logAssignment(input: LogInput): Promise<void> {
  try {
    await supabase.from('assignment_actions').insert({
      clinic_id: input.clinicId,
      check_in_id: input.checkInId,
      action_type: input.actionType,
      role: input.role,
      axis: input.axis,
      from_staff_id: input.fromStaffId ?? null,
      to_staff_id: input.toStaffId ?? null,
      reason: input.reason ?? null,
      created_by: input.createdBy ?? null,
    });
  } catch (e) {
    console.warn('[autoAssign] logAssignment failed:', e);
  }
}

// ── 자동배정 메인 ─────────────────────────────────────────────────────────────

interface CheckInLite {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  status: CheckInStatus;
  consultant_id: string | null;
  therapist_id: string | null;
  treatment_kind?: string | null;
  treatment_category?: string | null;
  status_flag?: string | null;
}

/**
 * 슬롯 진입 시 자동배정. status 가 consult_waiting/treatment_waiting 일 때만 동작.
 * 멱등: 이미 담당자 배정돼 있으면 no-op. 조건부 UPDATE 로 다중 클라이언트 경합 안전.
 *
 * @param checkInId  배정 대상 check_in id
 * @param newStatus  진입한 status (consult_waiting → 상담사 / treatment_waiting → 치료사)
 * @param createdBy  처리자 user id(로그용)
 */
export async function maybeAutoAssign(
  checkInId: string,
  newStatus: CheckInStatus,
  createdBy: string | null = null,
): Promise<{
  assigned: boolean;
  staffId?: string;
  /**
   * T-20260701-DESIGNATED-STAFF-SHEET-MATCH-GUARD: 지정 담당이 있었으나 근무 미매칭/임시off 로
   * fallback(균등배정)된 경우의 사유(운영자 힌트용). 배정 결과 자체는 변경 없음.
   */
  designatedFallback?: { kind: DesignatedFallbackKind; staffName: string | null };
}> {
  const role: AssignmentRole | null =
    newStatus === 'consult_waiting' ? 'consult'
    : newStatus === 'treatment_waiting' ? 'therapy'
    : null;
  if (!role) return { assigned: false };

  try {
    // 1) check_in + customer 로드
    const { data: ci } = await supabase
      .from('check_ins')
      .select('id, clinic_id, customer_id, status, consultant_id, therapist_id, treatment_kind, treatment_category, status_flag')
      .eq('id', checkInId)
      .maybeSingle();
    if (!ci) return { assigned: false };
    const checkIn = ci as CheckInLite;

    // 이미 배정돼 있으면 멱등 skip
    const assignedCol = role === 'consult' ? 'consultant_id' : 'therapist_id';
    if (role === 'consult' && checkIn.consultant_id) return { assigned: false };
    if (role === 'therapy' && checkIn.therapist_id) return { assigned: false };

    let customer: {
      visit_type?: string | null;
      lead_source?: string | null;
      visit_route?: string | null;
      designated_therapist_id?: string | null;
      assigned_consultant_id?: string | null;
    } | null = null;
    if (checkIn.customer_id) {
      const { data: cu } = await supabase
        .from('customers')
        .select('visit_type, lead_source, visit_route, designated_therapist_id, assigned_consultant_id')
        .eq('id', checkIn.customer_id)
        .maybeSingle();
      customer = cu ?? null;
    }

    // 2) 축 파생
    const axis = role === 'consult'
      ? deriveConsultAxis(customer ?? {})
      : deriveTherapyAxis(checkIn);

    // 3) 후보 풀(당일 출근 + 역할 − 임시 off)
    //    T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: 출근(workingIds)은 유지하되 '임시 off' 직원은 후보 제외.
    const staff = await fetchActiveStaff(checkIn.clinic_id);
    const workingIds = await fetchTodayWorkingStaffIds(checkIn.clinic_id, staff);
    const tempOff = await fetchTodayTempOffStaffIds();
    const targetRole = ROLE_STAFF_ROLE[role];
    const pool = staff
      .filter((s) => s.role === targetRole && workingIds.has(s.id) && !tempOff.has(s.id))
      .map((s) => s.id);

    // 4) 0순위 — 지정 담당 우선(당일 출근 + 임시 off 아님 시). 임시 off 면 fallback(least-loaded).
    const designatedId = role === 'consult'
      ? (customer?.assigned_consultant_id ?? null)
      : (customer?.designated_therapist_id ?? null);

    // ── O2 병기(정합의존, T-20260701-DESIGNATED-STAFF-SHEET-MATCH-GUARD) ──────────
    //   지정 선택은 role 재검증 없이 designated_therapist_id=치료사 / assigned_consultant_id=실장
    //   데이터 정합을 전제한다. 지정자 staff.role 이 필드 의미와 어긋난 데이터면 '로그로만' 표면화한다.
    //   배정 로직·결과는 절대 변경하지 않는다(관찰 전용).
    if (designatedId) {
      const dStaff = staff.find((s) => s.id === designatedId);
      const expectedRole = ROLE_STAFF_ROLE[role]; // consult→consultant / therapy→therapist
      if (dStaff && dStaff.role !== expectedRole) {
        console.warn(
          `[autoAssign] O2 role mismatch: 지정자 ${dStaff.name ?? '?'}(${designatedId}) role='${dStaff.role}' ` +
            `이나 ${role} 필드(${role === 'consult' ? 'assigned_consultant_id' : 'designated_therapist_id'})는 ` +
            `'${expectedRole}' 를 기대함 — 데이터 정합 확인 필요(배정 로직 무변경).`,
        );
      }
    }

    let chosen: string | null = null;
    let usedDesignated = false; // 0순위 지정 담당이 선택됐는가(fallback 아님) — 알림 suppress 판정용
    // 지정자는 있으나 0순위 미발동(근무 미매칭/임시off)으로 fallback 된 경우의 사유(운영자 힌트/로그용).
    let designatedFallback: { kind: DesignatedFallbackKind; staffName: string | null } | null = null;
    if (designatedId && workingIds.has(designatedId) && !tempOff.has(designatedId)) {
      chosen = designatedId;
      usedDesignated = true;
    } else {
      // 4-b) 지정자가 존재하나 fallback 으로 빠진 케이스 감지·분류(배정 결과 무변경).
      //   not_in_working_ids: 당일 근무목록 미매칭 = 구글시트 이름매칭 실패/미출근(시트·이름표기 확인).
      //   temp_off          : 근무목록엔 있으나 운영자가 임시휴무 토글(원인 명확).
      if (designatedId) {
        const dName = staff.find((s) => s.id === designatedId)?.name ?? null;
        const kind: DesignatedFallbackKind = !workingIds.has(designatedId)
          ? 'not_in_working_ids'
          : 'temp_off';
        designatedFallback = { kind, staffName: dName };
        console.warn(
          `[autoAssign] designated fallback(${role}): designatedId=${designatedId} name=${dName ?? '?'} ` +
            `reason=${kind} — 지정 0순위 미발동, 균등배정으로 대체(배정 결과 무변경). ` +
            (kind === 'not_in_working_ids'
              ? '구글시트 근무목록 미매칭(이름표기/시트 확인).'
              : '임시휴무 토글됨.'),
        );
      }
      // 5) 1순위 — 월 균등 least-loaded (재진은 균등 무관하게 풀에서 최소 선택)
      //    T-20260629 ROTATION: 동률 시 기본순번(assign_sort_order)으로 round-robin tie-break.
      const actions = await fetchMonthActions(checkIn.clinic_id);
      const load = computeLoad(actions, role, axis, todaySeoulISODate());
      const order = await fetchAssignSortOrder(checkIn.clinic_id);
      chosen = pickLeastLoaded(pool, load, order);
    }

    if (!chosen) {
      // 출근 후보 없음 → 미배정 유지(수동 배정 대기). 이 분기는 의도된 동작이나,
      // staff=[](과거 display_name 400 사고) / 시트 read 실패 시에도 조용히 빠져 진단이 어려웠음
      // (T-20260618-foot-AUTOASSIGN-RUN-FAIL: RC=staff=[]). 무엇이 비었는지 1줄 남겨 가시화.
      console.warn(
        `[autoAssign] no-assign(${role}): staff=${staff.length} working=${workingIds.size} tempOff=${tempOff.size} pool=${pool.length}` +
          (staff.length === 0 ? ' ⚠staff공집합' : pool.length === 0 ? ' ⚠출근후보공집합' : ''),
      );
      return { assigned: false };
    }

    // 6) 조건부 UPDATE(멱등·경합 안전) — null 일 때만 set
    const { data: updated } = await supabase
      .from('check_ins')
      .update({ [assignedCol]: chosen })
      .eq('id', checkInId)
      .is(assignedCol, null)
      .select('id');

    if (!updated || updated.length === 0) {
      // 다른 클라이언트가 이미 배정 → 로그 중복 방지
      return { assigned: false };
    }

    // 7) 로그
    //    T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP: 재진 + 지정 담당(0순위) 정상 배정이면
    //    reason=sentinel → 알림 표시만 억제(카운트/부하 집계는 reason 무관, 영향 0). fallback(휴무/미지정)
    //    은 usedDesignated=false → 미부여 → 알림 노출(AC-3). 비재진은 회귀0(미부여).
    //    T-20260701-DESIGNATED-STAFF-SHEET-MATCH-GUARD: 지정자 fallback 이면 사유 태그를 남긴다.
    //    fallback ⇒ usedDesignated=false 이므로 sentinel 과 상호배타(한 배정에 둘 다일 수 없음).
    const reason = designatedFallback
      ? buildDesignatedFallbackReason(designatedFallback.kind, designatedFallback.staffName)
      : usedDesignated && customer?.visit_type === 'returning'
        ? ASSIGN_SILENT_REASON
        : null;
    await logAssignment({
      clinicId: checkIn.clinic_id,
      checkInId,
      actionType: 'auto_assign',
      role,
      axis,
      toStaffId: chosen,
      createdBy,
      reason,
    });
    return {
      assigned: true,
      staffId: chosen,
      designatedFallback: designatedFallback ?? undefined,
    };
  } catch (e) {
    console.warn('[autoAssign] maybeAutoAssign failed:', e);
    return { assigned: false };
  }
}

// ── 토스(push) ────────────────────────────────────────────────────────────────

/**
 * 토스 — 현재 담당을 명시적으로 재지정하거나 미배정으로 되돌림. 사유 필수(시나리오4).
 * T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-2: 랜덤 자동재배정 제거 — 호출측이 mode를 명시한다.
 *   mode='reassign' → toStaffId(당일 출근 목록에서 수동 선택)로 재배정.
 *   mode='unassign' → 담당 없음(NULL)으로 풀에 되돌림.
 * 토스 N건은 넘긴 사람(fromStaffId) 기준 +1 로 집계(별도 카운터 = assignment_actions count).
 * 결과는 check_ins.consultant_id/therapist_id(기존 경로) 반영 + assignment_actions(toss)에
 * 사유·이전(from)/이후(to) 담당 기록.
 */
export async function tossAssignment(opts: {
  checkInId: string;
  clinicId: string;
  role: AssignmentRole;
  axis: string | null;
  fromStaffId: string | null;
  /** 'reassign'=수동 지정 / 'unassign'=미배정으로 되돌림 (랜덤 기본값 없음, AC-2) */
  mode: 'reassign' | 'unassign';
  /** mode='reassign' 시 필수 — 당일 출근 목록에서 수동 선택한 담당 staff id */
  toStaffId?: string | null;
  reason: string;
  createdBy?: string | null;
}): Promise<{ ok: boolean; toStaffId?: string | null; message?: string }> {
  if (!opts.reason || !opts.reason.trim()) {
    return { ok: false, message: '토스 사유를 입력해주세요.' };
  }
  const next: string | null = opts.mode === 'unassign' ? null : (opts.toStaffId ?? null);
  if (opts.mode === 'reassign' && !next) {
    return { ok: false, message: '재배정할 담당자를 선택해주세요.' };
  }
  if (opts.mode === 'reassign' && next === opts.fromStaffId) {
    return { ok: false, message: '현재 담당과 다른 담당자를 선택해주세요.' };
  }
  try {
    const assignedCol = opts.role === 'consult' ? 'consultant_id' : 'therapist_id';
    const { error } = await supabase
      .from('check_ins')
      .update({ [assignedCol]: next })
      .eq('id', opts.checkInId);
    if (error) return { ok: false, message: error.message };
    await logAssignment({
      clinicId: opts.clinicId,
      checkInId: opts.checkInId,
      actionType: 'toss',
      role: opts.role,
      axis: opts.axis,
      fromStaffId: opts.fromStaffId,
      toStaffId: next, // unassign 시 null (미배정 기록)
      reason: opts.reason.trim(),
      createdBy: opts.createdBy ?? null,
    });
    return { ok: true, toStaffId: next };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ── 당김(pull) ────────────────────────────────────────────────────────────────

/**
 * 당김 — 대기 중(미배정 또는 상담대기 10분+) 건을 본인(toStaffId)에게 가져옴.
 * 원래 자리(슬롯)는 비워두고 cascade 없음(o2k7 ④). 당김 N건 = 받은 사람 +1.
 */
export async function pullAssignment(opts: {
  checkInId: string;
  clinicId: string;
  role: AssignmentRole;
  axis: string | null;
  toStaffId: string;
  createdBy?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  try {
    const assignedCol = opts.role === 'consult' ? 'consultant_id' : 'therapist_id';
    // fromStaff = 현재 배정자(있으면)
    const { data: ci } = await supabase
      .from('check_ins')
      .select(`${assignedCol}`)
      .eq('id', opts.checkInId)
      .maybeSingle();
    const fromStaffId = (ci as Record<string, string | null> | null)?.[assignedCol] ?? null;
    const { error } = await supabase
      .from('check_ins')
      .update({ [assignedCol]: opts.toStaffId })
      .eq('id', opts.checkInId);
    if (error) return { ok: false, message: error.message };
    await logAssignment({
      clinicId: opts.clinicId,
      checkInId: opts.checkInId,
      actionType: 'pull_in',
      role: opts.role,
      axis: opts.axis,
      fromStaffId,
      toStaffId: opts.toStaffId,
      createdBy: opts.createdBy ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ── 수동 배정(override, 통합 뷰에서 상시 보장) ────────────────────────────────

export async function manualAssign(opts: {
  checkInId: string;
  clinicId: string;
  role: AssignmentRole;
  axis: string | null;
  toStaffId: string;
  fromStaffId?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  try {
    const assignedCol = opts.role === 'consult' ? 'consultant_id' : 'therapist_id';
    const { error } = await supabase
      .from('check_ins')
      .update({ [assignedCol]: opts.toStaffId })
      .eq('id', opts.checkInId);
    if (error) return { ok: false, message: error.message };
    await logAssignment({
      clinicId: opts.clinicId,
      checkInId: opts.checkInId,
      actionType: 'manual',
      role: opts.role,
      axis: opts.axis,
      fromStaffId: opts.fromStaffId ?? null,
      toStaffId: opts.toStaffId,
      createdBy: opts.createdBy ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ── 실배정 부하 기록(SSOT 공백 보강) ──────────────────────────────────────────

/**
 * 자동배정 엔진 밖에서 일어나는 실배정(드래그-방 배정·결제담당 지정 등)을
 * assignment_actions(manual)에 사후 기록한다. check_ins 의 담당자 컬럼은 이미
 * 호출측에서 set 된 뒤(=현재상태) 이력만 추가하는 append-only 보강.
 *
 * 배경(T-20260622-foot-AUTOASSIGN-IMBYEOL-SKEW-FIX): 실배정 대부분이 자동배정
 * 엔진을 거치지 않아 assignment_actions 가 사실상 비어 있었고, computeLoad 가
 * 전원 0부하로 오판 → 균등 selection 무력화(임별 쏠림 증폭). 본 함수로 SSOT
 * 공백을 메워 신규·비지정 영역의 월 균등이 실제 부하를 인식하게 한다.
 *
 * 정책/구조 변경 없음(A안): computeLoad·우선순위·집계 로직은 그대로.
 * 멱등·best-effort: 담당 변화 없으면(=같은 사람) skip, 실패해도 throw 안 함.
 *
 * @param checkIn  배정 대상 check_in(축 파생용 treatment_kind/status_flag + customer_id)
 * @param toStaffId 새로 배정된 담당 staff id
 * @param fromStaffId 직전 담당(있으면) — 변화 판정·이력용
 */
export async function logRealAssignment(opts: {
  checkIn: {
    id: string;
    clinic_id: string;
    customer_id?: string | null;
    treatment_kind?: string | null;
    treatment_category?: string | null;
    status_flag?: string | null;
  };
  role: AssignmentRole;
  toStaffId: string | null;
  fromStaffId?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  try {
    if (!opts.toStaffId) return; // 미배정(해제)은 부하 기록 대상 아님
    // 담당 변화 없음(이미 같은 사람) → 중복 부하 기록 방지
    if (opts.toStaffId === (opts.fromStaffId ?? null)) return;

    // 축 파생: 치료=check_in 필드만으로 산출 / 상담=customer 보조조회(best-effort)
    let axis: string;
    if (opts.role === 'therapy') {
      axis = deriveTherapyAxis(opts.checkIn);
    } else {
      let customer: {
        visit_type?: string | null;
        lead_source?: string | null;
        visit_route?: string | null;
      } | null = null;
      if (opts.checkIn.customer_id) {
        const { data } = await supabase
          .from('customers')
          .select('visit_type, lead_source, visit_route')
          .eq('id', opts.checkIn.customer_id)
          .maybeSingle();
        customer = data ?? null;
      }
      axis = deriveConsultAxis(customer ?? {});
    }

    await logAssignment({
      clinicId: opts.checkIn.clinic_id,
      checkInId: opts.checkIn.id,
      actionType: 'manual',
      role: opts.role,
      axis,
      fromStaffId: opts.fromStaffId ?? null,
      toStaffId: opts.toStaffId,
      createdBy: opts.createdBy ?? null,
    });
  } catch (e) {
    console.warn('[autoAssign] logRealAssignment failed:', e);
  }
}
