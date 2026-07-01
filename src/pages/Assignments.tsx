/**
 * Assignments — [상담·치료사 배정] 통합 뷰 (사이드바 단일 메뉴)
 * T-20260617-foot-AUTOASSIGN-BALANCE-TOSS (시나리오 4·5·6)
 *
 * ── 구성(o2k7 17:13 / dva3 디자인: 모노톤·컴팩트) ──
 *  ① 오늘 배정 현황(상담/치료 축별) + [토스] + 수동 override
 *  ② 당김 후보(상담대기 10분+ 또는 미배정) + [당김]
 *  ③ 직원별 당월 누적 배정 수 + 토스 N건 + 당김 N건 (assignment_actions count 파생 — 별도 카운터 없음)
 *
 *  자동배정 자체는 Dashboard 슬롯 진입 훅(maybeAutoAssign)에서 수행. 본 화면은 조회 + 토스/당김/수동.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Hand, RefreshCw, Users, ListOrdered, GripVertical, Loader2 } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate } from '@/lib/format';
import { elapsedMinutes } from '@/lib/elapsed';
import { STATUS_KO } from '@/lib/status';
import { toast } from '@/lib/toast';
import type { CheckIn, CheckInStatus, Staff, AssignmentAction, AssignmentRole } from '@/lib/types';
import {
  deriveConsultAxis,
  deriveTherapyAxis,
  tossAssignment,
  pullAssignment,
  manualAssign,
  maybeAutoAssign,
  fetchTodayWorkingStaffIds,
  fetchTodayTempOffStaffIds,
  setStaffTempOff,
} from '@/lib/autoAssign';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ── 상태 → 활성 축(role) 매핑 ───────────────────────────────────────────────────
const CONSULT_FLOW: CheckInStatus[] = ['consult_waiting', 'consultation', 'exam_waiting', 'examination'];
const THERAPY_FLOW: CheckInStatus[] = [
  'treatment_waiting',
  'preconditioning',
  'laser_waiting',
  'healer_waiting',
  'laser',
];
const PULL_WAIT_STATUSES: CheckInStatus[] = ['consult_waiting', 'treatment_waiting'];
const PULL_THRESHOLD_MIN = 10; // 미배정 대기 강조(amber) 임계. 당김 후보 자격 자체는 '미배정'만(PULLCAND-ASSIGNED-EXCLUDE)

function activeRole(status: CheckInStatus): AssignmentRole | null {
  if (CONSULT_FLOW.includes(status)) return 'consult';
  if (THERAPY_FLOW.includes(status)) return 'therapy';
  return null;
}

const AXIS_KO: Record<string, string> = {
  TM: 'TM',
  인바운드: '인바운드',
  워크인: '워크인',
  returning: '재진',
  main: '본치료',
  podologue: '포돌로게',
  trial: '체험',
};

interface CustomerLite {
  id: string;
  visit_type: string | null;
  lead_source: string | null;
  visit_route: string | null;
}

export default function Assignments() {
  const clinic = useClinic();
  const { profile } = useAuth();

  // T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER: 기본순번 편집 권한 = admin/manager/director
  //   (staff 테이블 RLS=is_admin_or_manager(director 포함)와 정합). 그 외 역할은 버튼 비노출 + save 가드.
  const canEditRotation =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director';
  const [rotationOpen, setRotationOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  // T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: 오늘(KST) '임시 off' staff id 집합(자동배정 후보 제외 셋).
  //   출근(workingIds)·녹색 동그라미는 건드리지 않음 — 후보풀 필터(poolFor)에서만 차감.
  const [tempOff, setTempOff] = useState<Set<string>>(new Set());
  const [tempOffBusy, setTempOffBusy] = useState<Set<string>>(new Set()); // 토글 중복클릭 가드
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [customers, setCustomers] = useState<Map<string, CustomerLite>>(new Map());
  const [actions, setActions] = useState<AssignmentAction[]>([]);
  // T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-1: 당월 누적 '배정/재진' 카운트의 정본 = check_ins(내구 상태).
  //   audit 로그(assignment_actions)는 toss/당김 집계·방식표시용. 자동+수동 모두 check_ins.{role}_id 에
  //   확정 기록되므로, 집계를 그 공통 정본 경로로 통합하면 audit 로그 유실/지연과 무관하게 정확(1건당 1회).
  const [monthCheckIns, setMonthCheckIns] = useState<CheckIn[]>([]);
  const [monthCustomers, setMonthCustomers] = useState<Map<string, CustomerLite>>(new Map());
  const [slotEnter, setSlotEnter] = useState<Map<string, string>>(new Map());
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // T-20260618-foot-ASSIGN-CONSULT-THERAPY-TABS: 같은 화면 내 [상담]/[치료] 탭 분리
  // (사이드바 단일 메뉴 유지. active 탭 기준 role 필터만 — 배정/토스/당김 로직 불변)
  const [activeTab, setActiveTab] = useState<AssignmentRole>('consult');

  // 토스 다이얼로그
  const [tossTarget, setTossTarget] = useState<{
    checkIn: CheckIn;
    role: AssignmentRole;
    axis: string;
    fromStaffId: string | null;
  } | null>(null);
  const [tossReason, setTossReason] = useState('');
  // T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-2: 재배정 방식(미배정/수동변경) + 수동 선택 담당.
  //   랜덤 자동재배정 제거 — 반드시 명시 선택. 기본값 = 'reassign'(수동 변경).
  const [tossMode, setTossMode] = useState<'reassign' | 'unassign'>('reassign');
  const [tossToStaffId, setTossToStaffId] = useState<string>('');

  const staffName = useCallback(
    (id: string | null): string => {
      if (!id) return '—';
      const s = staff.find((x) => x.id === id);
      return (s?.display_name ?? s?.name ?? '—').trim() || '—';
    },
    [staff],
  );

  const load = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    try {
      const todayIso = todaySeoulISODate();
      const monthStart = `${todayIso.slice(0, 7)}-01T00:00:00+09:00`;

      // 1) staff (active)
      // ⚠ staff.display_name 컬럼은 DB 미존재(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션).
      //   select에 포함 시 PostgREST 400 → 쿼리 전체 실패 → staff=[] → 배정 풀·통계 전부 0건.
      //   (T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX) UI는 display_name ?? name fallback 유지.
      const { data: staffRows } = await supabase
        .from('staff')
        .select('id, clinic_id, name, role, active, created_at, user_id')
        .eq('clinic_id', clinic.id)
        .eq('active', true);
      const staffList = (staffRows ?? []) as Staff[];
      setStaff(staffList);

      // 본인 staff id (당김 = 본인에게 배정)
      const mine = staffList.find((s) => s.user_id && s.user_id === profile?.id);
      setMyStaffId(mine?.id ?? null);

      // 2) 당일 출근자 (구글시트 근무 캘린더 read)
      const working = await fetchTodayWorkingStaffIds(clinic.id, staffList);
      setWorkingIds(working);

      // 2b) 오늘(KST) '임시 off' 제외 셋 (T-20260624-foot-ASSIGN-STAFF-TEMP-OFF)
      const off = await fetchTodayTempOffStaffIds();
      setTempOff(off);

      // 3) 오늘 원내 체크인 (done/cancelled 제외)
      const { data: ciRows } = await supabase
        .from('check_ins')
        .select('*')
        .eq('clinic_id', clinic.id)
        .gte('checked_in_at', `${todayIso}T00:00:00+09:00`)
        .not('status', 'in', '(done,cancelled)')
        .order('checked_in_at', { ascending: true });
      const ci = (ciRows ?? []) as CheckIn[];
      setCheckIns(ci);

      // 4) customers (상담 축 파생용)
      const custIds = Array.from(new Set(ci.map((c) => c.customer_id).filter(Boolean))) as string[];
      const custMap = new Map<string, CustomerLite>();
      if (custIds.length > 0) {
        const { data: custRows } = await supabase
          .from('customers')
          .select('id, visit_type, lead_source, visit_route')
          .in('id', custIds);
        for (const c of (custRows ?? []) as CustomerLite[]) custMap.set(c.id, c);
      }
      setCustomers(custMap);

      // 5) 당월 assignment_actions (토스 N건·당김 N건·금일 배분 '방식' 표시 SSOT)
      //    배정/재진 누적 카운트의 정본은 check_ins(아래 5b) — audit 로그는 toss/당김·방식용.
      const { data: actRows } = await supabase
        .from('assignment_actions')
        .select('*')
        .eq('clinic_id', clinic.id)
        .gte('created_at', monthStart);
      setActions((actRows ?? []) as AssignmentAction[]);

      // 5b) 당월 check_ins 전체 (배정 누적 카운트 + 금일 배분 이력 정본 — done/cancelled 포함)
      //     T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-1/AC-3: 자동·수동 배정 모두 여기 consultant_id/
      //     therapist_id 에 확정 기록되므로, 이 경로로 집계하면 audit 유실과 무관하게 정확.
      const { data: monthCiRows } = await supabase
        .from('check_ins')
        .select('*')
        .eq('clinic_id', clinic.id)
        .gte('checked_in_at', monthStart)
        .order('checked_in_at', { ascending: true });
      const monthCi = (monthCiRows ?? []) as CheckIn[];
      setMonthCheckIns(monthCi);

      // 5c) 당월 check_ins customers (상담 축 파생용) — 오늘분 custMap 의 상위집합
      const monthCustIds = Array.from(
        new Set(monthCi.map((c) => c.customer_id).filter(Boolean)),
      ) as string[];
      const monthCustMap = new Map<string, CustomerLite>();
      if (monthCustIds.length > 0) {
        // .in() 대용량 분할 (PostgREST URL 길이 한계 회피)
        const CHUNK = 200;
        for (let i = 0; i < monthCustIds.length; i += CHUNK) {
          const slice = monthCustIds.slice(i, i + CHUNK);
          const { data: rows } = await supabase
            .from('customers')
            .select('id, visit_type, lead_source, visit_route')
            .in('id', slice);
          for (const c of (rows ?? []) as CustomerLite[]) monthCustMap.set(c.id, c);
        }
      }
      setMonthCustomers(monthCustMap);

      // 6) 슬롯 진입 시각(당김 10분+ 판정) — 대기 상태로의 최신 transition
      const ciIds = ci.map((c) => c.id);
      const enterMap = new Map<string, string>();
      if (ciIds.length > 0) {
        const { data: trRows } = await supabase
          .from('status_transitions')
          .select('check_in_id, to_status, transitioned_at')
          .in('check_in_id', ciIds)
          .in('to_status', PULL_WAIT_STATUSES)
          .order('transitioned_at', { ascending: true });
        for (const t of (trRows ?? []) as Array<{
          check_in_id: string;
          transitioned_at: string;
        }>) {
          enterMap.set(t.check_in_id, t.transitioned_at); // ascending → 마지막 = 최신
        }
      }
      setSlotEnter(enterMap);
    } catch (e) {
      console.warn('[Assignments] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [clinic, profile?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // T-20260624-foot-ASSIGN-STAFF-TEMP-OFF AC4: 다중 운영자 동기화 — staff_temp_off Realtime 구독.
  //   한 단말에서 토글 → 다른 운영자 화면의 제외 셋(=자동배정 후보)도 즉시 갱신. 오늘(KST) 셋만 재조회.
  useEffect(() => {
    if (!clinic) return;
    const ch = supabase
      .channel(`staff_temp_off:${clinic.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_temp_off' },
        () => {
          void fetchTodayTempOffStaffIds().then(setTempOff);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [clinic]);

  // ── 임시 off 토글 ────────────────────────────────────────────────────────────
  // 출근(녹색 동그라미)은 유지, 자동배정 후보풀에서만 제외/복귀. row 존재=제외, 삭제=복귀.
  const toggleTempOff = useCallback(
    async (staffId: string) => {
      if (tempOffBusy.has(staffId)) return;
      const turningOn = !tempOff.has(staffId);
      setTempOffBusy((prev) => new Set(prev).add(staffId));
      // 낙관적 갱신
      setTempOff((prev) => {
        const next = new Set(prev);
        if (turningOn) next.add(staffId);
        else next.delete(staffId);
        return next;
      });
      const ok = await setStaffTempOff(staffId, turningOn, profile?.id ?? null);
      if (!ok) {
        // 롤백
        setTempOff((prev) => {
          const next = new Set(prev);
          if (turningOn) next.delete(staffId);
          else next.add(staffId);
          return next;
        });
        toast.error('임시 off 변경에 실패했습니다. 다시 시도해주세요.');
      } else {
        toast.success(turningOn ? '자동배정에서 제외했습니다 (출근 유지)' : '자동배정에 다시 포함했습니다');
      }
      setTempOffBusy((prev) => {
        const next = new Set(prev);
        next.delete(staffId);
        return next;
      });
    },
    [tempOff, tempOffBusy, profile?.id],
  );

  // ── 축 파생 헬퍼 ───────────────────────────────────────────────────────────
  const axisOf = useCallback(
    (ci: CheckIn, role: AssignmentRole): string => {
      if (role === 'consult') {
        const cu = ci.customer_id ? customers.get(ci.customer_id) : null;
        return deriveConsultAxis({
          visit_type: cu?.visit_type ?? ci.visit_type,
          lead_source: cu?.lead_source,
          visit_route: cu?.visit_route,
        });
      }
      return deriveTherapyAxis(ci);
    },
    [customers],
  );

  // ── 직원별 당월 누적 (assignment_actions count 파생) ─────────────────────────
  interface StaffStat {
    staff: Staff;
    assigned: number; // 균등 대상 배정(축≠재진, auto/manual/pull, 받은 사람)
    returning: number; // 재진 배정 카운트(균등 제외)
    tossGiven: number; // 토스 넘긴 사람 +1
    pulled: number; // 당김 받은 사람 +1
  }

  // T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-1: 배정(균등)/재진 = check_ins(정본) 카운트.
  //   상담축: 고객 visit_type='returning' → 재진, else 균등. 치료축: 항상 균등(재진 축 미해당).
  //   토스/당김 = assignment_actions(audit) 카운트(from/to 기준). → 자동·수동 모두 정확 반영.
  const monthAxisOf = useCallback(
    (ci: CheckIn, role: AssignmentRole): string => {
      if (role === 'consult') {
        const cu = ci.customer_id ? monthCustomers.get(ci.customer_id) : null;
        return deriveConsultAxis({
          visit_type: cu?.visit_type ?? ci.visit_type,
          lead_source: cu?.lead_source,
          visit_route: cu?.visit_route,
        });
      }
      return deriveTherapyAxis(ci);
    },
    [monthCustomers],
  );

  const staffStats = useMemo<StaffStat[]>(() => {
    const byId = new Map<string, StaffStat>();
    const ensure = (s: Staff): StaffStat => {
      let st = byId.get(s.id);
      if (!st) {
        st = { staff: s, assigned: 0, returning: 0, tossGiven: 0, pulled: 0 };
        byId.set(s.id, st);
      }
      return st;
    };
    // 상담사·치료사만 노출
    for (const s of staff) {
      if (s.role === 'consultant' || s.role === 'therapist') ensure(s);
    }
    // 배정/재진 — check_ins 정본(자동+수동 공통, 1건당 1회 / 역할별 분리)
    for (const ci of monthCheckIns) {
      if (ci.consultant_id) {
        const s = staff.find((x) => x.id === ci.consultant_id);
        if (s && s.role === 'consultant') {
          const st = ensure(s);
          if (monthAxisOf(ci, 'consult') === 'returning') st.returning += 1;
          else st.assigned += 1;
        }
      }
      if (ci.therapist_id) {
        const s = staff.find((x) => x.id === ci.therapist_id);
        if (s && s.role === 'therapist') {
          const st = ensure(s);
          if (monthAxisOf(ci, 'therapy') === 'returning') st.returning += 1;
          else st.assigned += 1;
        }
      }
    }
    // 토스 N건(넘긴 사람) / 당김 N건(받은 사람) — assignment_actions audit
    for (const a of actions) {
      if (a.action_type === 'toss' && a.from_staff_id) {
        const s = staff.find((x) => x.id === a.from_staff_id);
        if (s) ensure(s).tossGiven += 1;
      }
      if (a.action_type === 'pull_in' && a.to_staff_id) {
        const s = staff.find((x) => x.id === a.to_staff_id);
        if (s) ensure(s).pulled += 1;
      }
    }
    const wantRole = activeTab === 'consult' ? 'consultant' : 'therapist';
    return Array.from(byId.values())
      .filter((st) => st.staff.role === wantRole)
      .sort((x, y) => y.assigned - x.assigned);
  }, [staff, actions, monthCheckIns, monthAxisOf, activeTab]);

  // ── AC-3: 금일 배분 이력(read-only) — 오늘 배정된 check_ins(정본). 방식=assignment_actions 최신 action 파생.
  interface TodayDistRow {
    id: string;
    customerName: string;
    role: AssignmentRole;
    staffId: string | null;
    method: string; // 자동 | 수동 | 토스 | 당김 | —
    at: string; // ISO (action created_at 우선, 없으면 checked_in_at)
  }
  const todayDistribution = useMemo<TodayDistRow[]>(() => {
    const todayIso = todaySeoulISODate();
    // ISO 포맷 혼재(+00:00 / Z / +09:00) → 문자열 비교 금지, epoch(ms)로 비교.
    const todayStartMs = new Date(`${todayIso}T00:00:00+09:00`).getTime();
    const METHOD_KO: Record<string, string> = {
      auto_assign: '자동',
      manual: '수동',
      toss: '토스',
      pull_in: '당김',
    };
    // check_in_id+role → 최신 action (created_at desc)
    const latestAct = new Map<string, AssignmentAction>();
    for (const a of actions) {
      if (!a.check_in_id || new Date(a.created_at).getTime() < todayStartMs) continue;
      const key = `${a.check_in_id}:${a.role}`;
      const prev = latestAct.get(key);
      if (!prev || a.created_at > prev.created_at) latestAct.set(key, a);
    }
    const rows: TodayDistRow[] = [];
    for (const ci of monthCheckIns) {
      if (!ci.checked_in_at || new Date(ci.checked_in_at).getTime() < todayStartMs) continue;
      const push = (role: AssignmentRole, staffId: string | null) => {
        if (!staffId) return;
        if (role !== activeTab) return;
        const act = latestAct.get(`${ci.id}:${role}`);
        rows.push({
          id: `${ci.id}:${role}`,
          customerName: ci.customer_name ?? '—',
          role,
          staffId,
          method: act ? (METHOD_KO[act.action_type] ?? '—') : '—',
          at: act?.created_at ?? ci.checked_in_at!,
        });
      };
      push('consult', ci.consultant_id);
      push('therapy', ci.therapist_id);
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [monthCheckIns, actions, activeTab]);

  // ── 당김 후보(미배정 대기 건만) ──────────────────────────────────────────────
  // T-20260629-foot-PULLCAND-ASSIGNED-EXCLUDE: 담당자가 배정되면(수동·자동·토스 무관)
  //   당김 후보에서 즉시 제외. 후보 = assigned 가 NULL(미배정/대기)인 건만.
  //   기존엔 'unassigned || waitMin>=10' 이어서 배정됐어도 10분+ 대기면 잔존(강혜인 962분 잔존 버그).
  //   AC2/AC4: 배정 완료 건은 source 필터 단계에서 배제. waitMin 은 미배정 건의 대기시간 표시용으로만 유지.
  const pullCandidates = useMemo(() => {
    return checkIns
      .filter((ci) => PULL_WAIT_STATUSES.includes(ci.status))
      .map((ci) => {
        const role: AssignmentRole = ci.status === 'consult_waiting' ? 'consult' : 'therapy';
        const assignedId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
        const enterIso = slotEnter.get(ci.id) ?? ci.checked_in_at;
        const waitMin = enterIso ? elapsedMinutes(enterIso) : 0;
        const unassigned = !assignedId;
        const eligible = unassigned; // 배정된 건(수동/자동/토스)은 당김 후보 아님
        return { ci, role, assignedId, waitMin, unassigned, eligible };
      })
      .filter((x) => x.eligible && x.role === activeTab)
      .sort((a, b) => b.waitMin - a.waitMin)
      .slice(0, 50);
  }, [checkIns, slotEnter, activeTab]);

  // ── 액션 핸들러 ──────────────────────────────────────────────────────────────
  const openToss = (ci: CheckIn, role: AssignmentRole) => {
    const fromStaffId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
    setTossTarget({ checkIn: ci, role, axis: axisOf(ci, role), fromStaffId });
    setTossReason('');
    setTossMode('reassign'); // AC-2: 기본 수동 변경(랜덤 아님)
    setTossToStaffId('');
  };

  const confirmToss = async () => {
    if (!tossTarget || !clinic) return;
    if (!tossReason.trim()) {
      toast.error('토스 사유를 입력해주세요.');
      return;
    }
    if (tossMode === 'reassign' && !tossToStaffId) {
      toast.error('재배정할 담당자를 선택해주세요.');
      return;
    }
    setBusy(true);
    const res = await tossAssignment({
      checkInId: tossTarget.checkIn.id,
      clinicId: clinic.id,
      role: tossTarget.role,
      axis: tossTarget.axis,
      fromStaffId: tossTarget.fromStaffId,
      mode: tossMode,
      toStaffId: tossMode === 'reassign' ? tossToStaffId : null,
      reason: tossReason,
      createdBy: profile?.id ?? null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        tossMode === 'unassign'
          ? '토스 완료 — 미배정으로 되돌렸습니다.'
          : `토스 완료 → ${staffName(res.toStaffId ?? null)}`,
      );
      setTossTarget(null);
      void load();
    } else {
      toast.error(res.message ?? '토스 실패');
    }
  };

  const doPull = async (ci: CheckIn, role: AssignmentRole) => {
    if (!clinic) return;
    if (!myStaffId) {
      toast.error('본인 직원 정보를 찾을 수 없어 당김할 수 없습니다.');
      return;
    }
    setBusy(true);
    const res = await pullAssignment({
      checkInId: ci.id,
      clinicId: clinic.id,
      role,
      axis: axisOf(ci, role),
      toStaffId: myStaffId,
      createdBy: profile?.id ?? null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success('당김 완료 — 본인에게 배정되었습니다.');
      void load();
    } else {
      toast.error(res.message ?? '당김 실패');
    }
  };

  const doManual = async (ci: CheckIn, role: AssignmentRole, toStaffId: string) => {
    if (!clinic || !toStaffId) return;
    const fromStaffId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
    setBusy(true);
    const res = await manualAssign({
      checkInId: ci.id,
      clinicId: clinic.id,
      role,
      axis: axisOf(ci, role),
      toStaffId,
      fromStaffId,
      createdBy: profile?.id ?? null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`수동 배정 → ${staffName(toStaffId)}`);
      void load();
    } else {
      toast.error(res.message ?? '수동 배정 실패');
    }
  };

  // ── 미배정 일괄 자동배정 (T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL reopen#2, 갈래② 소급구제)
  //  이벤트구동 maybeAutoAssign 은 신규 체크인 생성/전이 시점에만 발화 → 그 전에 직접 INSERT 되어
  //  대기슬롯에 이미 떠 있는 미배정 건은 자동배정이 소급되지 않는다. 본 버튼은 현재 활성 탭(상담/치료)의
  //  미배정 대기 건을 기존 엔진(maybeAutoAssign)에 1클릭 일괄 통과시킨다. additive·DB무변경·엔진재사용.
  const unassignedNow = useMemo(
    () =>
      checkIns.filter((ci) => {
        if (!PULL_WAIT_STATUSES.includes(ci.status)) return false;
        const role: AssignmentRole = ci.status === 'consult_waiting' ? 'consult' : 'therapy';
        if (role !== activeTab) return false;
        const assignedId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
        return !assignedId;
      }),
    [checkIns, activeTab],
  );

  const doBatchAutoAssign = async () => {
    if (!clinic || busy) return;
    const targets = unassignedNow;
    if (targets.length === 0) {
      toast.info('미배정 대기 건이 없습니다.');
      return;
    }
    setBusy(true);
    let assigned = 0;
    let skipped = 0;
    for (const ci of targets) {
      try {
        const res = await maybeAutoAssign(ci.id, ci.status, profile?.id ?? null);
        if (res.assigned) assigned += 1;
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
    setBusy(false);
    if (assigned > 0 && skipped === 0) {
      toast.success(`일괄 자동배정 완료 — ${assigned}건 배정`);
    } else if (assigned > 0) {
      toast.success(`${assigned}건 배정 · ${skipped}건 미배정(출근 후보 없음 등)`);
    } else {
      toast.error('배정 0건 — 출근한 담당 후보가 없습니다. 근무 캘린더/출근 상태를 확인해주세요.');
    }
    void load();
  };

  // 역할별 후보(당일 출근) — 수동 배정 select 옵션
  const poolFor = useCallback(
    (role: AssignmentRole): Staff[] => {
      const target = role === 'consult' ? 'consultant' : 'therapist';
      // T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: 출근자 중 '임시 off' 제외 = 자동배정/수동 후보.
      return staff.filter((s) => s.role === target && workingIds.has(s.id) && !tempOff.has(s.id));
    },
    [staff, workingIds, tempOff],
  );

  // ── 렌더 ──────────────────────────────────────────────────────────────────────
  const allTodayRows = checkIns
    .map((ci) => ({ ci, role: activeRole(ci.status) }))
    .filter((x) => x.role !== null) as { ci: CheckIn; role: AssignmentRole }[];
  const todayRows = allTodayRows.filter((x) => x.role === activeTab);

  return (
    // T-20260618-foot-MENUSCROLL-EXISTPATIENT-Q: 페이지 최상위 자체 세로 스크롤.
    //   AdminLayout page-content-area(overflow-hidden) 안에서 각 페이지가 자체 스크롤 담당하는 패턴(Staff/Closing 동일).
    //   이전 TABSCROLL 수정은 카드 내부 목록 스크롤만 추가 → 세 카드(①42vh+②32vh+③32vh+헤더/탭) 합이 100vh 초과 시
    //   ③ '직원별 당월 누적'이 fold 아래로 잘려 도달 불가('현장 미체감'). h-full overflow-auto로 페이지 자체 스크롤 복원.
    <div className="h-full overflow-auto space-y-4 p-4" data-testid="assignments-scroll-root">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">상담·치료사 배정</h1>
          <span className="text-xs text-muted-foreground">
            출근 {workingIds.size}명 · 오늘 {allTodayRows.length}건
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL reopen#2: 미배정 일괄 자동배정(소급구제) */}
          <Button
            size="sm"
            onClick={() => void doBatchAutoAssign()}
            disabled={loading || busy || unassignedNow.length === 0}
            data-testid="batch-autoassign-btn"
          >
            미배정 일괄 자동배정{unassignedNow.length > 0 ? ` (${unassignedNow.length})` : ''}
          </Button>
          {canEditRotation && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRotationOpen(true)}
              disabled={loading || busy}
              data-testid="rotation-order-open-btn"
            >
              <ListOrdered className="mr-1 h-3.5 w-3.5" />
              배정 순번 설정
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || busy}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
        </div>
      </div>

      {/* T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER: 자동배정 기본순번 편집(admin) */}
      {canEditRotation && rotationOpen && clinic && (
        <RotationOrderDialog
          clinicId={clinic.id}
          canEdit={canEditRotation}
          onClose={() => setRotationOpen(false)}
          onSaved={() => { setRotationOpen(false); void load(); }}
        />
      )}

      {/* [상담]/[치료] 탭 — 같은 화면 내 파트별 분리 (active 탭 기준 role 필터) */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AssignmentRole)}>
        <TabsList className="h-auto gap-1 p-1" data-testid="assignments-role-tabs">
          <TabsTrigger value="consult" className="px-4 py-1.5 text-sm" data-testid="assignments-tab-consult">
            상담
          </TabsTrigger>
          <TabsTrigger value="therapy" className="px-4 py-1.5 text-sm" data-testid="assignments-tab-therapy">
            치료
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ① 오늘 배정 현황 */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">오늘 배정 현황</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL B: 목록만 스크롤(헤더 sticky 고정), 화면 짤림 방지 */}
          <div className="max-h-[42vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 border-y bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">고객</th>
                  <th className="px-2 py-2 text-left font-medium">상태</th>
                  <th className="px-2 py-2 text-left font-medium">축</th>
                  <th className="px-2 py-2 text-left font-medium">담당</th>
                  <th className="px-2 py-2 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody>
                {todayRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      오늘 배정 대상이 없습니다.
                    </td>
                  </tr>
                )}
                {todayRows.map(({ ci, role }) => {
                  const assignedId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
                  const axis = axisOf(ci, role);
                  return (
                    <tr key={ci.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <span className="font-medium">{ci.customer_name}</span>
                        {ci.queue_number != null && (
                          <span className="ml-1 text-muted-foreground">#{ci.queue_number}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="outline" className="font-normal">
                          {STATUS_KO[ci.status] ?? ci.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={axis === 'returning' ? 'secondary' : 'teal'} className="font-normal">
                          {role === 'consult' ? '상담' : '치료'}·{AXIS_KO[axis] ?? axis}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="rounded border bg-background px-1.5 py-1 text-xs"
                          value={assignedId ?? ''}
                          disabled={busy}
                          onChange={(e) => void doManual(ci, role, e.target.value)}
                        >
                          <option value="" disabled>
                            미배정
                          </option>
                          {poolFor(role).map((s) => (
                            <option key={s.id} value={s.id}>
                              {(s.display_name ?? s.name).trim()}
                            </option>
                          ))}
                          {/* 출근 풀에 없지만 현재 배정된 사람 보존 노출 */}
                          {assignedId && !poolFor(role).some((s) => s.id === assignedId) && (
                            <option value={assignedId}>{staffName(assignedId)} (비출근)</option>
                          )}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          disabled={busy || !assignedId}
                          onClick={() => openToss(ci, role)}
                        >
                          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
                          토스
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ② 당김 후보 */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">
            당김 후보 <span className="text-xs font-normal text-muted-foreground">(미배정 대기 건 — 담당자 배정 시 자동 제외)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL B: 목록만 스크롤(헤더 sticky 고정) */}
          <div className="max-h-[32vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 border-y bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">고객</th>
                  <th className="px-2 py-2 text-left font-medium">상태</th>
                  <th className="px-2 py-2 text-left font-medium">대기</th>
                  <th className="px-2 py-2 text-left font-medium">현재 담당</th>
                  <th className="px-2 py-2 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody>
                {pullCandidates.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      당김 가능한 대기 건이 없습니다.
                    </td>
                  </tr>
                )}
                {pullCandidates.map(({ ci, role, assignedId, waitMin, unassigned }) => (
                  <tr key={ci.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{ci.customer_name}</td>
                    <td className="px-2 py-2">
                      <Badge variant="outline" className="font-normal">
                        {STATUS_KO[ci.status] ?? ci.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      <span className={waitMin >= PULL_THRESHOLD_MIN ? 'font-semibold text-amber-600' : ''}>
                        {waitMin}분
                      </span>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {unassigned ? '미배정' : staffName(assignedId)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={busy || !myStaffId}
                        onClick={() => void doPull(ci, role)}
                      >
                        <Hand className="mr-1 h-3.5 w-3.5" />
                        당김
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ③-0 금일 배분 이력 (AC-3, read-only) — 당월 누적 상단. 오늘 배정된 건(고객/담당/방식/시각) */}
      <Card data-testid="assignments-today-distribution-card">
        <CardHeader className="py-3">
          <CardTitle className="text-sm">
            금일 배분 이력{' '}
            <span className="text-xs font-normal text-muted-foreground">
              (오늘 {activeTab === 'consult' ? '상담' : '치료'} 배정 {todayDistribution.length}건 · 표시 전용)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[28vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 border-y bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">고객</th>
                  <th className="px-2 py-2 text-left font-medium">담당</th>
                  <th className="px-2 py-2 text-left font-medium">방식</th>
                  <th className="px-2 py-2 text-right font-medium">시각</th>
                </tr>
              </thead>
              <tbody>
                {todayDistribution.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      오늘 배분된 건이 없습니다.
                    </td>
                  </tr>
                )}
                {todayDistribution.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.customerName}</td>
                    <td className="px-2 py-2">{staffName(r.staffId)}</td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={r.method === '자동' ? 'teal' : r.method === '—' ? 'outline' : 'secondary'}
                        className="font-normal"
                      >
                        {r.method}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {r.at ? new Date(r.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ③ 직원별 당월 누적 */}
      <Card data-testid="assignments-monthly-card">
        <CardHeader className="py-3">
          <CardTitle className="text-sm">직원별 당월 누적</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* T-20260629-foot-ASSIGNMONTHLY-SCROLL-REMOVE: 스크롤/높이 제한 제거 → 직원 수만큼 전체 펼침. 스크롤 컨테이너 사라져 thead sticky도 정리. */}
          <div>
            <table className="w-full text-xs">
              <thead className="border-y bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">직원</th>
                  <th className="px-2 py-2 text-left font-medium">역할</th>
                  <th className="px-2 py-2 text-right font-medium">배정(균등)</th>
                  <th className="px-2 py-2 text-right font-medium">재진</th>
                  <th className="px-2 py-2 text-right font-medium">토스</th>
                  <th className="px-2 py-2 text-right font-medium">당김</th>
                </tr>
              </thead>
              <tbody>
                {staffStats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      상담사·치료사가 없습니다.
                    </td>
                  </tr>
                )}
                {staffStats.map((st) => (
                  <tr key={st.staff.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{(st.staff.display_name ?? st.staff.name).trim()}</span>
                        {workingIds.has(st.staff.id) && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                            title="출근"
                          />
                        )}
                        {/* T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: 출근자에게만 '임시 off' 토글.
                            출근(동그라미)은 유지, 자동배정 후보에서만 제외/복귀. */}
                        {workingIds.has(st.staff.id) && (
                          <button
                            type="button"
                            data-testid={`temp-off-toggle-${st.staff.id}`}
                            disabled={tempOffBusy.has(st.staff.id)}
                            onClick={() => void toggleTempOff(st.staff.id)}
                            aria-pressed={tempOff.has(st.staff.id)}
                            title={
                              tempOff.has(st.staff.id)
                                ? '임시 off 상태 — 클릭 시 자동배정 복귀'
                                : '클릭 시 자동배정에서 잠시 제외 (출근 유지)'
                            }
                            className={
                              'ml-0.5 rounded-md border px-2 py-1 text-[11px] font-medium leading-none transition-colors disabled:opacity-50 ' +
                              (tempOff.has(st.staff.id)
                                ? 'border-amber-300 bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'border-border bg-muted text-muted-foreground hover:bg-muted/70')
                            }
                          >
                            {tempOff.has(st.staff.id) ? '복귀' : '임시 off'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {st.staff.role === 'consultant' ? '상담사' : '치료사'}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">{st.assigned}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{st.returning}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{st.tossGiven}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{st.pulled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 토스 다이얼로그 — 사유 필수(시나리오4) */}
      <Dialog open={!!tossTarget} onOpenChange={(o) => !o && setTossTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>토스 (재배정)</DialogTitle>
            <DialogDescription>
              {tossTarget && (
                <>
                  {tossTarget.checkIn.customer_name} · {tossTarget.role === 'consult' ? '상담' : '치료'} ·{' '}
                  현재 담당 {staffName(tossTarget.fromStaffId)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* AC-2: 재배정 방식 — 미배정 / 담당 변경(수동 선택). 랜덤 자동배정 제거. */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">재배정 방식</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={tossMode === 'reassign' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setTossMode('reassign')}
                  data-testid="toss-mode-reassign"
                >
                  {tossTarget?.role === 'consult' ? '상담사' : '치료사'} 변경
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tossMode === 'unassign' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => {
                    setTossMode('unassign');
                    setTossToStaffId('');
                  }}
                  data-testid="toss-mode-unassign"
                >
                  미배정
                </Button>
              </div>
            </div>

            {/* '변경' 선택 시 당일 출근 담당 목록(STAFF-ATTENDANCE consume·read) 수동 지정 */}
            {tossMode === 'reassign' && tossTarget && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {tossTarget.role === 'consult' ? '상담사' : '치료사'} 선택{' '}
                  <span className="text-destructive">*</span>{' '}
                  <span className="font-normal">(오늘 출근)</span>
                </label>
                <select
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  value={tossToStaffId}
                  onChange={(e) => setTossToStaffId(e.target.value)}
                  disabled={busy}
                  data-testid="toss-staff-select"
                >
                  <option value="" disabled>
                    담당 선택
                  </option>
                  {poolFor(tossTarget.role)
                    .filter((s) => s.id !== tossTarget.fromStaffId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {(s.display_name ?? s.name).trim()}
                      </option>
                    ))}
                </select>
                {poolFor(tossTarget.role).filter((s) => s.id !== tossTarget.fromStaffId).length === 0 && (
                  <p className="text-xs text-amber-600">
                    오늘 출근한 다른 {tossTarget.role === 'consult' ? '상담사' : '치료사'}가 없습니다. 미배정으로
                    되돌릴 수 있습니다.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                토스 사유 <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={tossReason}
                onChange={(e) => setTossReason(e.target.value)}
                placeholder="예) 신규 상담 진행 중이라 받을 수 없음"
                rows={3}
                data-testid="toss-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTossTarget(null)} disabled={busy}>
              취소
            </Button>
            <Button
              onClick={() => void confirmToss()}
              disabled={
                busy || !tossReason.trim() || (tossMode === 'reassign' && !tossToStaffId)
              }
              data-testid="toss-confirm-btn"
            >
              토스 확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 배정 기본순번 편집(admin) ────────────────────────────────────────────────
// T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER
//   상담(consultant)/치료(therapist) 파트별 active staff 를 동적 로드(입·퇴사 자동반영),
//   T-20260701-foot-ASSIGNORDER-ARROW-TO-DRAG: ↑/↓ 화살표 → @dnd-kit 드래그앤드롭(그룹 내 재정렬).
//   그룹별 독립 DndContext 로 상담↔치료 교차 이동 차단. 저장 시 staff.assign_sort_order = 위치(1-based) 일괄 UPDATE.
//   드래그는 로컬 순서만 바꾸고(기존 화살표와 동일), 실제 DB 반영은 [순번 저장] 버튼(저장경로 불변).
//   자동배정(pickLeastLoaded 3순위)이 저장 즉시 새 배정부터 반영(기배정 소급 X).
//   ⚠ assign_sort_order 컬럼 미적용 시 조회 error → 안내만 표시(배정 동선엔 무영향).
interface RotaStaff { id: string; name: string; }

// 드래그 가능한 순번 행 — QuickRxButtonsTab SortableQuickRxRow 패턴 미러(useSortable hook 규칙상 별도 컴포넌트).
function SortableRotationRow({
  staff, index, canEdit, testid,
}: {
  staff: RotaStaff;
  index: number;
  canEdit: boolean;
  testid: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: staff.id,
    disabled: !canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 ${isDragging ? 'shadow-md ring-2 ring-primary/40' : ''}`}
      data-testid={`rotation-row-${testid}-${index}`}
    >
      {/* 드래그 핸들 — admin/manager/director 전용, touch-none(태블릿 탭 오인식 방지) */}
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          tabIndex={-1}
          className="flex items-center justify-center min-w-[32px] min-h-[32px] -ml-1 rounded text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
          title="드래그하여 순서 변경"
          data-testid={`rotation-handle-${testid}-${index}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <Badge variant="outline" className="shrink-0 tabular-nums">{index + 1}</Badge>
      <span className="flex-1 truncate text-sm" data-testid={`rotation-name-${testid}-${index}`}>{staff.name}</span>
    </div>
  );
}

function RotationOrderDialog({
  clinicId,
  canEdit,
  onClose,
  onSaved,
}: {
  clinicId: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [colMissing, setColMissing] = useState(false);
  const [consult, setConsult] = useState<RotaStaff[]>([]);
  const [therapy, setTherapy] = useState<RotaStaff[]>([]);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    // 별도 조회(메인 staff 로드와 분리) — 컬럼 미존재 시 graceful.
    const { data, error } = await supabase
      .from('staff')
      .select('id, name, role, assign_sort_order')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .in('role', ['consultant', 'therapist']);
    if (error) {
      setColMissing(true);
      setLoading(false);
      return;
    }
    type Row = { id: string; name: string; role: string; assign_sort_order: number | null };
    const rows = (data ?? []) as Row[];
    const BIG = Number.MAX_SAFE_INTEGER;
    const sortFn = (a: Row, b: Row) =>
      (a.assign_sort_order ?? BIG) - (b.assign_sort_order ?? BIG) ||
      a.name.localeCompare(b.name, 'ko');
    setConsult(rows.filter((r) => r.role === 'consultant').sort(sortFn).map((r) => ({ id: r.id, name: r.name })));
    setTherapy(rows.filter((r) => r.role === 'therapist').sort(sortFn).map((r) => ({ id: r.id, name: r.name })));
    setColMissing(false);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => { void loadOrder(); }, [loadOrder]);

  // activationConstraint distance 8 — 태블릿에서 탭(클릭)과 드래그 구분(CHART-TAP-DELAY 교훈).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // 그룹 내 재정렬만 — 각 그룹이 독립 DndContext 라 교차 이동 불가. 로컬 순서만 변경(저장은 [순번 저장]).
  const handleDragEnd = (
    list: RotaStaff[],
    setList: (v: RotaStaff[]) => void,
  ) => (e: DragEndEvent) => {
    if (!canEdit) return;
    const { active, over } = e;
    if (!over || String(active.id) === String(over.id)) return;
    const oldIdx = list.findIndex((x) => x.id === String(active.id));
    const newIdx = list.findIndex((x) => x.id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    setList(arrayMove(list, oldIdx, newIdx));
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const ordered = [
        ...consult.map((s, i) => ({ id: s.id, ord: i + 1 })),
        ...therapy.map((s, i) => ({ id: s.id, ord: i + 1 })),
      ];
      // 파트별 1-based 순번 일괄 UPDATE. 멱등 — 동일 값 재저장 안전.
      const results = await Promise.all(
        ordered.map((o) =>
          supabase.from('staff').update({ assign_sort_order: o.ord }).eq('id', o.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        toast.error(`순번 저장 실패: ${failed.error.message}`);
        setSaving(false);
        return;
      }
      toast.success('배정 순번을 저장했습니다 (새 배정부터 반영)');
      onSaved();
    } catch (e) {
      toast.error(`순번 저장 실패: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const renderList = (
    title: string,
    list: RotaStaff[],
    setList: (v: RotaStaff[]) => void,
    testid: string,
  ) => (
    <div className="flex-1 min-w-0" data-testid={`rotation-part-${testid}`}>
      <p className="mb-2 text-sm font-semibold">{title} <span className="text-xs text-muted-foreground">({list.length}명)</span></p>
      {list.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">등록된 직원이 없습니다.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(list, setList)}>
          <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {list.map((s, i) => (
                <SortableRotationRow
                  key={s.id}
                  staff={s}
                  index={i}
                  canEdit={canEdit && !saving}
                  testid={testid}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="rotation-order-dialog">
        <DialogHeader>
          <DialogTitle>자동배정 기본순번 설정</DialogTitle>
          <DialogDescription>
            <GripVertical className="inline h-3.5 w-3.5 align-text-bottom" /> 핸들을 끌어 순서를 바꾼 뒤 저장하세요. 휴무·임시 off 직원은 자동으로 건너뛰고 다음 순번으로 배정됩니다.
            저장 후 새 배정부터 반영됩니다.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : colMissing ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            순번 컬럼이 아직 적용되지 않았습니다. 잠시 후 다시 시도해주세요.
          </p>
        ) : (
          <div className="flex flex-col gap-6 md:flex-row">
            {renderList('상담 파트', consult, setConsult, 'consult')}
            {renderList('치료 파트', therapy, setTherapy, 'therapy')}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>닫기</Button>
          <Button
            onClick={() => void save()}
            disabled={!canEdit || saving || loading || colMissing}
            data-testid="rotation-save-btn"
          >
            {saving ? '저장 중…' : '순번 저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
