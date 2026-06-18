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
 * 균등 우선순위(질문②): ① 이달 동일 축 배정 최소 → ② 당일 배정 최소 → ③ 랜덤.
 * @param candidates 후보 staff id 목록(이미 당일 출근 + 역할 필터됨)
 */
export function pickLeastLoaded(
  candidates: string[],
  load: LoadCounts,
): string | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((id) => ({
    id,
    monthly: load.monthlyByAxis.get(id) ?? 0,
    today: load.todayNet.get(id) ?? 0,
    rnd: Math.random(),
  }));
  scored.sort((a, b) =>
    a.monthly - b.monthly || a.today - b.today || a.rnd - b.rnd,
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
): Promise<{ assigned: boolean; staffId?: string }> {
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

    // 3) 후보 풀(당일 출근 + 역할)
    const staff = await fetchActiveStaff(checkIn.clinic_id);
    const workingIds = await fetchTodayWorkingStaffIds(checkIn.clinic_id, staff);
    const targetRole = ROLE_STAFF_ROLE[role];
    const pool = staff
      .filter((s) => s.role === targetRole && workingIds.has(s.id))
      .map((s) => s.id);

    // 4) 0순위 — 지정 담당 우선(당일 출근 시)
    const designatedId = role === 'consult'
      ? (customer?.assigned_consultant_id ?? null)
      : (customer?.designated_therapist_id ?? null);

    let chosen: string | null = null;
    if (designatedId && workingIds.has(designatedId)) {
      chosen = designatedId;
    } else {
      // 5) 1순위 — 월 균등 least-loaded (재진은 균등 무관하게 풀에서 최소 선택)
      const actions = await fetchMonthActions(checkIn.clinic_id);
      const load = computeLoad(actions, role, axis, todaySeoulISODate());
      chosen = pickLeastLoaded(pool, load);
    }

    if (!chosen) {
      // 출근 후보 없음 → 미배정 유지(수동 배정 대기). 이 분기는 의도된 동작이나,
      // staff=[](과거 display_name 400 사고) / 시트 read 실패 시에도 조용히 빠져 진단이 어려웠음
      // (T-20260618-foot-AUTOASSIGN-RUN-FAIL: RC=staff=[]). 무엇이 비었는지 1줄 남겨 가시화.
      console.warn(
        `[autoAssign] no-assign(${role}): staff=${staff.length} working=${workingIds.size} pool=${pool.length}` +
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
    await logAssignment({
      clinicId: checkIn.clinic_id,
      checkInId,
      actionType: 'auto_assign',
      role,
      axis,
      toStaffId: chosen,
      createdBy,
    });
    return { assigned: true, staffId: chosen };
  } catch (e) {
    console.warn('[autoAssign] maybeAutoAssign failed:', e);
    return { assigned: false };
  }
}

// ── 토스(push) ────────────────────────────────────────────────────────────────

/**
 * 토스 — 현재 담당을 무효화하고 다음 후보(least-loaded)로 재배정. 사유 필수(시나리오4).
 * 토스 N건은 넘긴 사람(fromStaffId) 기준 +1 로 집계(별도 카운터 = assignment_actions count).
 */
export async function tossAssignment(opts: {
  checkInId: string;
  clinicId: string;
  role: AssignmentRole;
  axis: string | null;
  fromStaffId: string | null;
  reason: string;
  createdBy?: string | null;
}): Promise<{ ok: boolean; toStaffId?: string; message?: string }> {
  if (!opts.reason || !opts.reason.trim()) {
    return { ok: false, message: '토스 사유를 입력해주세요.' };
  }
  try {
    const assignedCol = opts.role === 'consult' ? 'consultant_id' : 'therapist_id';
    const targetRole = ROLE_STAFF_ROLE[opts.role];
    const staff = await fetchActiveStaff(opts.clinicId);
    const workingIds = await fetchTodayWorkingStaffIds(opts.clinicId, staff);
    const actions = await fetchMonthActions(opts.clinicId);
    const axis = opts.axis ?? 'main';
    const load = computeLoad(actions, opts.role, axis, todaySeoulISODate());
    // 넘긴 사람 제외한 후보 풀에서 least-loaded
    const pool = staff
      .filter((s) => s.role === targetRole && workingIds.has(s.id) && s.id !== opts.fromStaffId)
      .map((s) => s.id);
    const next = pickLeastLoaded(pool, load);
    if (!next) {
      return { ok: false, message: '재배정할 출근 담당자가 없습니다.' };
    }
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
      toStaffId: next,
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
