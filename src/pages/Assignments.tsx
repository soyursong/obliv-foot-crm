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
import { ArrowRightLeft, Hand, RefreshCw, Users } from 'lucide-react';

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
  fetchTodayWorkingStaffIds,
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
const PULL_THRESHOLD_MIN = 10; // o2k7: 상담대기 10분+ 또는 미배정

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

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [customers, setCustomers] = useState<Map<string, CustomerLite>>(new Map());
  const [actions, setActions] = useState<AssignmentAction[]>([]);
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

      // 5) 당월 assignment_actions (균등/토스/당김 카운트 SSOT)
      const { data: actRows } = await supabase
        .from('assignment_actions')
        .select('*')
        .eq('clinic_id', clinic.id)
        .gte('created_at', monthStart);
      setActions((actRows ?? []) as AssignmentAction[]);

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
    for (const a of actions) {
      // 토스 N건(넘긴 사람)
      if (a.action_type === 'toss' && a.from_staff_id) {
        const s = staff.find((x) => x.id === a.from_staff_id);
        if (s) ensure(s).tossGiven += 1;
      }
      // 당김 N건(받은 사람)
      if (a.action_type === 'pull_in' && a.to_staff_id) {
        const s = staff.find((x) => x.id === a.to_staff_id);
        if (s) ensure(s).pulled += 1;
      }
      // 배정(받은 사람) — auto_assign/manual/pull_in (토스 받음도 포함되나 별도 toss 카운터는 from 기준)
      if (
        (a.action_type === 'auto_assign' ||
          a.action_type === 'manual' ||
          a.action_type === 'pull_in' ||
          a.action_type === 'toss') &&
        a.to_staff_id
      ) {
        const s = staff.find((x) => x.id === a.to_staff_id);
        if (s) {
          const st = ensure(s);
          if (a.axis === 'returning') st.returning += 1;
          else st.assigned += 1;
        }
      }
    }
    const wantRole = activeTab === 'consult' ? 'consultant' : 'therapist';
    return Array.from(byId.values())
      .filter((st) => st.staff.role === wantRole)
      .sort((x, y) => y.assigned - x.assigned);
  }, [staff, actions, activeTab]);

  // ── 당김 후보(상담대기 10분+ 또는 미배정) ────────────────────────────────────
  const pullCandidates = useMemo(() => {
    return checkIns
      .filter((ci) => PULL_WAIT_STATUSES.includes(ci.status))
      .map((ci) => {
        const role: AssignmentRole = ci.status === 'consult_waiting' ? 'consult' : 'therapy';
        const assignedId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
        const enterIso = slotEnter.get(ci.id) ?? ci.checked_in_at;
        const waitMin = enterIso ? elapsedMinutes(enterIso) : 0;
        const unassigned = !assignedId;
        const eligible = unassigned || waitMin >= PULL_THRESHOLD_MIN;
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
  };

  const confirmToss = async () => {
    if (!tossTarget || !clinic) return;
    if (!tossReason.trim()) {
      toast.error('토스 사유를 입력해주세요.');
      return;
    }
    setBusy(true);
    const res = await tossAssignment({
      checkInId: tossTarget.checkIn.id,
      clinicId: clinic.id,
      role: tossTarget.role,
      axis: tossTarget.axis,
      fromStaffId: tossTarget.fromStaffId,
      reason: tossReason,
      createdBy: profile?.id ?? null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`토스 완료 → ${staffName(res.toStaffId ?? null)}`);
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

  // 역할별 후보(당일 출근) — 수동 배정 select 옵션
  const poolFor = useCallback(
    (role: AssignmentRole): Staff[] => {
      const target = role === 'consult' ? 'consultant' : 'therapist';
      return staff.filter((s) => s.role === target && workingIds.has(s.id));
    },
    [staff, workingIds],
  );

  // ── 렌더 ──────────────────────────────────────────────────────────────────────
  const allTodayRows = checkIns
    .map((ci) => ({ ci, role: activeRole(ci.status) }))
    .filter((x) => x.role !== null) as { ci: CheckIn; role: AssignmentRole }[];
  const todayRows = allTodayRows.filter((x) => x.role === activeTab);

  return (
    <div className="space-y-4 p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">상담·치료사 배정</h1>
          <span className="text-xs text-muted-foreground">
            출근 {workingIds.size}명 · 오늘 {allTodayRows.length}건
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

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
            당김 후보 <span className="text-xs font-normal text-muted-foreground">(상담대기 10분+ 또는 미배정)</span>
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

      {/* ③ 직원별 당월 누적 */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">직원별 당월 누적</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL B: 목록만 스크롤(헤더 sticky 고정) */}
          <div className="max-h-[32vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 border-y bg-muted text-muted-foreground">
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
                      {(st.staff.display_name ?? st.staff.name).trim()}
                      {workingIds.has(st.staff.id) && (
                        <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" title="출근" />
                      )}
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
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              토스 사유 <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={tossReason}
              onChange={(e) => setTossReason(e.target.value)}
              placeholder="예) 신규 상담 진행 중이라 받을 수 없음"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTossTarget(null)} disabled={busy}>
              취소
            </Button>
            <Button onClick={() => void confirmToss()} disabled={busy || !tossReason.trim()}>
              토스 확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
