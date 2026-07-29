/**
 * Assignments — [상담·치료사 배정] 통합 뷰 (사이드바 단일 메뉴)
 * T-20260617-foot-AUTOASSIGN-BALANCE-TOSS (시나리오 4·5·6)
 *
 * ── 구성(o2k7 17:13 / dva3 디자인: 모노톤·컴팩트) ──
 *  ① 오늘 배정 현황(상담/치료 축별) + [토스] + 수동 override
 *  ② 당김 후보(상담대기 10분+ 또는 미배정) + [당김]
 *  ③ 직원별 누적 배정 수 + 토스 N건 + 당김 N건 — 선택일 기준 [일누적]/[당월누적] 분리 (T-20260720-foot-ASSIGN-LABEL-DATE-SELECT)
 *
 *  자동배정 자체는 Dashboard 슬롯 진입 훅(maybeAutoAssign)에서 수행. 본 화면은 조회 + 토스/당김/수동.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Hand, RefreshCw, Users, ListOrdered, GripVertical, Loader2, Check } from 'lucide-react';
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
// T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: [확정]→상담대기방 발송 EF 이름 SSOT.
import { EDGE_FUNCTIONS } from '@/lib/externalServices';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate, seoulISODate, chartNoBadge, formatAmount } from '@/lib/format';
// T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK: [랭킹] 탭 데이터 소스 = R1 정합본(fetchConsultantPerf).
//   랭킹 재발명 금지 — CRM-ASSIGN-RANKING-FIX-R1 이 이미 재직필터+매출정합 교정한 실장 랭킹 산출값을 read-only 소비.
import { fetchConsultantPerf, type ConsultantRow } from '@/lib/stats';
// T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC §5: '당월 배정 예상 비율' = 기존 배정비율 설정값 재사용(신규 저장 0).
//   배정 비율 설정값 = assignment_daily_target_config(top/bottom) + interpolateDailyTargets 랭크별 목표(플레이북 [실행 1b]).
//   비율 = 랭크별 목표 ÷ Σ목표(스케일 불변). 재발명 금지 — 자동배정 엔진과 동일 산식 SSOT 소비. DB 무변경(READ-only).
import { fetchDailyTargetConfig, rankAssignmentRatios } from '@/lib/assignmentStrategy';
import { GATED_CAPABILITY_ITEMS, GATED_CAPABILITY_CODES } from '@/lib/treatmentRequestCodes';
import { elapsedMinutes } from '@/lib/elapsed';
import { STATUS_KO } from '@/lib/status';
import { toast } from '@/lib/toast';
import type { CheckIn, CheckInStatus, Staff, AssignmentAction, AssignmentRole } from '@/lib/types';
import {
  deriveConsultAxis,
  deriveTherapyAxis,
  isReturningAxis,
  tossAssignment,
  pullAssignment,
  manualAssign,
  softHideCheckIn,
  maybeAutoAssign,
  fetchTodayWorkingStaffIds,
  fetchTodayTempOffStaffIds,
  setStaffTempOff,
} from '@/lib/autoAssign';
// T-20260713-foot-CONSULT-AXIS-RECENCY-UNIFY: 상담 축(deriveConsultAxis)의 초진/재진 입력을 stored visit_type →
//   recency(365일) 배치 판정으로 통일. 배정 화면 표시·재진 상담칸 숨김이 접수분류·배지·엔진과 수렴(AC-3).
import { resolveVisitTypesByCheckIn } from '@/lib/visitRecency';
// T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL: 유입경로 표시/발송 라벨을 자동배정 균등 버킷
//   (deriveConsultAxis)에서 분리(DECOUPLE)한 SSOT. 재진='재진', 그 외=고객 실제 visit_route 원문.
import { consultInflowLabel } from '@/lib/consultInflowLabel';
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

// ── T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC: 랭킹 탭 날짜 구간 헬퍼(KST, DATE-only 순수) ──
//   fetchConsultantPerf(from,to) 는 DATE 문자열(YYYY-MM-DD)을 받는다(기존 monthStart 호출과 동일 grain).
//   UTC 기준 산술로 로컬 tz 흔들림 제거(assignmentStrategy.seoulWindowBounds 와 동일 계산 규약).
const pad2 = (n: number) => String(n).padStart(2, '0');
/** ISO(YYYY-MM-DD)에 days 를 더한 ISO 날짜(KST 달력일). */
function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
/** iso 가 속한 주의 월요일 ISO(월~일 주 정의). */
function mondayOfIso(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일..6=토
  return isoAddDays(iso, -((dow + 6) % 7));
}
/** iso 가 속한 달의 1일 ISO. */
function monthStartOfIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
/** 선택일 기준 4구간(월누적/이번주/직전주) DATE 경계 산출. */
function rankingRanges(selDateIso: string): {
  monthStart: string;
  thisWeekMon: string;
  prevWeekMon: string;
  prevWeekSun: string;
} {
  const thisWeekMon = mondayOfIso(selDateIso);
  return {
    monthStart: monthStartOfIso(selDateIso),
    thisWeekMon,
    prevWeekMon: isoAddDays(thisWeekMon, -7),
    prevWeekSun: isoAddDays(thisWeekMon, -1),
  };
}
/** 매출액 배열 → staffId별 순위(1위=최고매출, 동점 tie-break=이름). 0/미참여는 후순위. */
function rankByRevenue(
  ids: string[],
  revenueOf: (id: string) => number,
  nameOf: (id: string) => string,
): Map<string, number> {
  const sorted = [...ids].sort(
    (a, b) => revenueOf(b) - revenueOf(a) || nameOf(a).localeCompare(nameOf(b), 'ko'),
  );
  const m = new Map<string, number>();
  sorted.forEach((id, i) => m.set(id, i + 1));
  return m;
}

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
  // T-20260729-foot-ASSIGN-POPUP-DUPASSIGN-NAMETRUNC (Bug A): 배정 팝업 성함 = 고객 정본(customers.name) live 소스.
  //   RC = check_ins.customer_name 스냅샷이 등록 후 이름 정정을 반영하지 못해 성 누락('홍석' vs '장홍석') 등 발생(당월 3/439).
  //   chart_number 와 동일하게 customers 에서 live 로 읽어 표기 정합 확보(스냅샷 fallback 유지).
  name: string | null;
  visit_type: string | null;
  lead_source: string | null;
  visit_route: string | null;
  // T-20260724-foot-ASSIGNHIST-CHARTNO-CHART2-LINK (AC-1): 금일 배분 이력 고객 성함 옆 차트번호 병기용.
  //   presentation only — 저장값 미변경. 미발번(null)이면 chartNoBadge 가 표시 억제.
  chart_number: string | null;
  // T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC (AC-6): 2번차트 1구역 담당자 = read-only basis.
  //   수동배정 select default 프리셋 소스로만 읽음. 배정 write 는 check_ins.consultant_id/therapist_id 에만(RED LINE).
  assigned_staff_id: string | null;
}

// T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP 변경5: 건수 셀 클릭 → 고객 명단(성함+차트번호) drill-down.
//   count↔list 단일소스(THERAPIST-DESIGNATED AC2 패턴) — 셀 카운트 = 아래 배열 length 로 파생.
interface AssignDrillItem {
  key: string; // 리스트 React key(중복 배정 방지용 유니크). check_in id 또는 action id.
  name: string; // 고객 성함
  chartNumber: string | null; // 차트번호(미발번=null → chartNoBadge 표시 억제)
  customerId: string | null;
  // T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP 변경5 상세①(fqb6): 팝업 리스트 '일자별 그룹' 기준일(서울 YYYY-MM-DD).
  //   배정(초진/재진)=check_ins.checked_in_at, 토스/당김=assignment_actions.created_at. null=(날짜 미상) 그룹.
  date: string | null;
  // T-20260726-foot-ASSIGN-HIST-ROW-DELETE-ADMIN: admin 개별 행 삭제(soft-hide) 대상 check_in id.
  //   배정(초진/재진) 행만 non-null(itemFromCi 세팅) → drill 팝업에서 삭제 버튼 노출 대상.
  //   토스/당김 행은 audit 액션(assignment_actions) → null(삭제 비대상: 배정 정본 check_in 을 지우는 게 아님).
  checkInId: string | null;
}

export default function Assignments() {
  const clinic = useClinic();
  const { profile } = useAuth();

  // T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER: 기본순번 편집 권한 = admin/manager/director
  //   (staff 테이블 RLS=is_admin_or_manager(director 포함)와 정합). 그 외 역할은 버튼 비노출 + save 가드.
  const canEditRotation =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director';
  // T-20260724-foot-ASSIGNHIST-ROW-EDIT-DELETE 요청1(A): 금일 배분 이력 row 담당 수정 권한 = admin/manager/director.
  //   check_ins UPDATE RLS(is_admin_or_manager, director 포함)와 정합. 그 외 역할은 select 비노출(read-only 표시) + write 는 rows-affected 가드로 이중 차단.
  const canEditDistribution =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director';
  // T-20260726-foot-ASSIGN-HIST-ROW-DELETE-ADMIN: 직원별 누적 drill-down 배정 이력 행 삭제 = admin 한정.
  //   현장 요청(김주연 총괄) '관리자만' = cross_crm_data_contract staff role 8종 중 admin 한정(canEditDistribution 의
  //   admin/manager/director 와 구분). 서버측(AC3) = softHideCheckIn → check_ins UPDATE RLS(is_admin_or_manager)
  //   가 staff/counselor 를 차단(일반 스탭 서버 차단 충족). FE 버튼은 admin 에게만 노출.
  const isAdmin = profile?.role === 'admin';
  const [rotationOpen, setRotationOpen] = useState(false);

  // T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK: [랭킹] 탭 = 관리자(원장·총괄) 전용.
  //   판정 SSOT = 기존 role 체계(admin/manager/director) 재사용 — canEditRotation/Distribution 과 동일 술어(신규 role enum 신설 0).
  //   §2 서버사이드 게이트 완결(마이그 20260727120000 / DA Opt A): 랭킹·매출 데이터는 admin-gated SECDEF 래퍼
  //     `foot_stats_consultant_admin`(fetchConsultantPerf 진입) 를 통해서만 조회되며, 래퍼가 is_admin_or_manager()
  //     fail-closed(42501) 로 비admin 을 서버에서 거부한다. 구 `foot_stats_consultant` 는 authenticated EXECUTE
  //     회수됨 → 비admin 직접 호출도 거부(no-read-up 완결). 즉 아래 canViewRanking 은 UI 숨김(방어심층)이고,
  //     실 접근통제는 서버 래퍼가 강제한다(UI 우회해도 데이터 유출 0).
  const canViewRanking =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director';

  // [랭킹] 탭 데이터 — R1 정합 실장 랭킹(선택일 월누적 매출) + 배정건수.
  const [rankLoading, setRankLoading] = useState(false);
  const [perfRows, setPerfRows] = useState<ConsultantRow[]>([]); // 월매출(1일~선택일) — 순위 기준
  // T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC:
  //   #1 DatePicker — 랭킹 탭 전용 기준일(기본=오늘 KST). 직원별누적 selectedDate 와 분리(탭 간 커플링 방지).
  const [rankingDate, setRankingDate] = useState<string>(() => todaySeoulISODate());
  //   #4 전주매출(직전주 월~일) / 이번주매출(이번주 월~선택일) — 주간 랭킹 변동표 + 전주매출 컬럼 소스.
  const [prevWeekRevenue, setPrevWeekRevenue] = useState<Map<string, number>>(new Map());
  const [thisWeekRevenue, setThisWeekRevenue] = useState<Map<string, number>>(new Map());
  //   #6 배정 건 수 — 선택일 당일 check_ins.consultant_id 배정 수(배정 SSOT=check_ins, 재발명 금지).
  const [dayAssignCounts, setDayAssignCounts] = useState<Map<string, number>>(new Map());
  //   #5 당월 초진 예약 총건수(reservations visit_type='new', 취소 제외) × 랭크 배정비율 → 예상 배정건수.
  const [monthInitResvCount, setMonthInitResvCount] = useState<number>(0);
  const [dailyTargetCfg, setDailyTargetCfg] = useState<{ top: number; bottom: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  // T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: 오늘(KST) '임시 off' staff id 집합(자동배정 후보 제외 셋).
  //   출근(workingIds)·녹색 동그라미는 건드리지 않음 — 후보풀 필터(poolFor)에서만 차감.
  const [tempOff, setTempOff] = useState<Set<string>>(new Set());
  const [tempOffBusy, setTempOffBusy] = useState<Set<string>>(new Set()); // 토글 중복클릭 가드
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [customers, setCustomers] = useState<Map<string, CustomerLite>>(new Map());
  // T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE (2A): 초진/재진 판정을 고객단위 →
  //   **check_in 레코드 단위(시점정합)** 로 교정. check_in id → VisitType(recency+owner-forced pin).
  const [visitTypeByCi, setVisitTypeByCi] = useState<Map<string, string>>(new Map()); // 오늘 배정뷰
  const [monthVisitTypeByCi, setMonthVisitTypeByCi] = useState<Map<string, string>>(new Map()); // 당월 누적
  const [actions, setActions] = useState<AssignmentAction[]>([]);
  // T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-1: 당월 누적 '배정/재진' 카운트의 정본 = check_ins(내구 상태).
  //   audit 로그(assignment_actions)는 toss/당김 집계·방식표시용. 자동+수동 모두 check_ins.{role}_id 에
  //   확정 기록되므로, 집계를 그 공통 정본 경로로 통합하면 audit 로그 유실/지연과 무관하게 정확(1건당 1회).
  const [monthCheckIns, setMonthCheckIns] = useState<CheckIn[]>([]);
  const [monthCustomers, setMonthCustomers] = useState<Map<string, CustomerLite>>(new Map());
  const [slotEnter, setSlotEnter] = useState<Map<string, string>>(new Map());
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: [확정] 발송 진행 중인 배분 이력 행 id(중복 클릭 방지).
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  // T-20260618-foot-ASSIGN-CONSULT-THERAPY-TABS: 같은 화면 내 [상담]/[치료] 탭 분리
  // (사이드바 단일 메뉴 유지. active 탭 기준 role 필터만 — 배정/토스/당김 로직 불변)
  const [activeTab, setActiveTab] = useState<AssignmentRole>('consult');

  // T-20260720-foot-ASSIGN-LABEL-DATE-SELECT: [직원별 누적] 날짜 선택.
  //   선택일 기준으로 [일누적](선택일 당일) / [당월누적](선택일 월 1일~선택일) 을 연동 집계.
  //   초기값 = 오늘(KST). 오늘 선택 시 [당월누적] = 기존 '직원별 당월 누적' 수치와 동일(회귀0).
  const [selectedDate, setSelectedDate] = useState<string>(() => todaySeoulISODate());

  // T-20260729-foot-DAILY-TARGET-NEXTWEEK-AUTO: [일일 배정 목표] = 차주(다음 주 월~일) 요일별 초진 예약 건수 자동 표시.
  //   집계 SSOT = monthInitResvCount 와 동일 술어(reservations visit_type='new' + status!=cancelled + reservation_date DATE범위).
  //   read-only 파생 표시(write 0). null=로딩 중(미조회), 조회 후 0건 일자는 0으로 표시(AC-5).
  const [nextWeekTargets, setNextWeekTargets] = useState<Record<string, number> | null>(null);

  // ── T-20260729-foot-ASSIGN-TARGETCOL-STAFFCUMUL-EMPTY-WIRE (총괄 결정 B, 완성본) ──────────────
  //   '직원별 누적' 표 [일일 배정 목표] 컬럼 = 각 상담실장의 랭킹 기준 목표 자동 표시.
  //   산식(플레이북 실행 1b) = (선택일 초진 예약 수) × (그 실장의 랭킹 배정 비율).
  //     · 비율 SSOT = rankAssignmentRatios(랭킹 탭 '배정비율'과 동일 함수, 중복 산식 금지 / AC-4).
  //     · 기준일(AC-3) = selectedDate — 컬럼이 속한 [일누적] 그룹의 day grain(inDay(selectedDate))과 정합.
  //   접근통제(AC-4/시나리오4): 랭킹·매출 파생값 → canViewRanking(admin/manager/director) 전용.
  //     비admin 은 서버 SECDEF 래퍼(foot_stats_consultant_admin)가 42501 fail-closed → 아예 조회 불가 → '—' 유지.
  //   RED LINE(INV-1): customers.assigned_consultant_id 무접촉 — read-only 표시 파생만(실 배정 로직 불변).
  const [targetPerfRows, setTargetPerfRows] = useState<ConsultantRow[]>([]); // 선택일 월누적 매출(랭킹 순서)
  const [targetCfg, setTargetCfg] = useState<{ top: number; bottom: number } | null>(null); // 하루 목표건수 config
  const [selDayInitResvCount, setSelDayInitResvCount] = useState<number | null>(null); // 선택일 초진 예약 수(null=미조회)

  // T-20260710-foot-ASSIGNMENT-LIST-TAB: 상위 탭 3분기 [상담]/[치료]/[배정목록].
  //  · 상담/치료 → 기존 배정 운영 카드(①오늘현황 ②당김 ③금일배분 ④당월누적) 노출 + activeTab 동기화(로직 불변).
  //  · 배정목록 → 카테고리(상담/치료) 드롭 → 담당자(상담사/치료사) 드롭 → 선택 담당자 금일 배정 환자목록 read-only 표시.
  //  금일 배정 grain 실측(2026-07-10 prod): 앵커=check_ins(consultant_id/therapist_id). reservations엔 배정필드 부재
  //  (preferred_therapist_id=예약단계 선호값), visits 테이블 부재 → TREATING-DOCTOR-SELECT-SYNC 선례와 정합. DB무변경.
  // T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK: 상위 탭에 [랭킹] 추가('ranking').
  const [mainTab, setMainTab] = useState<'consult' | 'therapy' | 'list' | 'ranking'>('consult');
  const [listCategory, setListCategory] = useState<AssignmentRole>('consult'); // 드롭①
  const [listStaffId, setListStaffId] = useState<string>(''); // 드롭② ('' = 미선택 → AC5 전체 표시)

  // T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP 변경5: 직원별 누적 건수 셀 drill-down 다이얼로그.
  //   (staff+구간+지표) 로 고객 성함+차트번호 명단 표시. items = 셀 카운트와 단일소스(count↔list 정합).
  const [drillDialog, setDrillDialog] = useState<{
    staffName: string;
    scopeLabel: string; // '일누적' | '당월누적'
    metricLabel: string; // '배정(초진)' | '배정(재진)' | '토스' | '당김'
    items: AssignDrillItem[];
  } | null>(null);

  // T-20260726-foot-ASSIGN-HIST-ROW-DELETE-ADMIN: drill-down 배정 이력 행 삭제(soft-hide) 확인 타깃.
  //   itemKey = drillDialog.items 낙관적 제거용 React key. checkInId = soft-hide 대상.
  const [drillDeleteTarget, setDrillDeleteTarget] = useState<{
    checkInId: string;
    itemKey: string;
    name: string;
  } | null>(null);

  // 토스 다이얼로그
  const [tossTarget, setTossTarget] = useState<{
    checkIn: CheckIn;
    role: AssignmentRole;
    axis: string;
    fromStaffId: string | null;
  } | null>(null);
  const [tossReason, setTossReason] = useState('');
  // T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B: 배분 이력 row 삭제(soft-hide) 확인 다이얼로그 타깃.
  const [distDeleteTarget, setDistDeleteTarget] = useState<{
    checkIn: CheckIn;
    customerName: string;
    role: AssignmentRole;
  } | null>(null);
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
      // T-20260720-foot-ASSIGN-LABEL-DATE-SELECT: 누적 조회 하한 = 선택일이 속한 월의 1일.
      //   선택일이 과거 달이면 그 달 1일부터, 상한은 없음(now)까지 로드 → 선택 월분 + 오늘분(금일 배분 이력)
      //   을 모두 포함. 일/당월 분기는 아래 staffStats 에서 선택일 경계로 client-side 필터.
      //   선택일이 미래가 되지 않도록 날짜 picker max=오늘 로 제한(회귀0 보장: 오늘 선택 시 기존 범위와 동일).
      const monthStart = `${selectedDate.slice(0, 7)}-01T00:00:00+09:00`;

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
        .is('deleted_at', null) // R2B soft-hide 제외
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
          .select('id, name, visit_type, lead_source, visit_route, assigned_staff_id, chart_number')
          .in('id', custIds);
        for (const c of (custRows ?? []) as CustomerLite[]) custMap.set(c.id, c);
      }
      setCustomers(custMap);
      // T-20260727 RECLASS 2A: 축 파생 초진/재진을 **check_in 레코드 단위(시점정합)** recency 로 판정.
      //   (기존 T-20260713 고객단위 override 는 self-contamination 과다집계 RC → per-checkin 으로 교체.)
      //   deriveConsultAxis 는 visit_type='returning' 여부만 보므로 axisOf 가 이 맵을 우선 사용한다.
      {
        const vtMap = await resolveVisitTypesByCheckIn(
          ci.map((c) => ({ id: c.id, customer_id: c.customer_id, checked_in_at: c.checked_in_at })),
          clinic.id,
        );
        setVisitTypeByCi(vtMap as Map<string, string>);
      }

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
        .is('deleted_at', null) // R2B soft-hide 제외 (금일 배분 이력 + 배정 누적카운트 정본)
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
            .select('id, name, visit_type, lead_source, visit_route, assigned_staff_id, chart_number')
            .in('id', slice);
          for (const c of (rows ?? []) as CustomerLite[]) monthCustMap.set(c.id, c);
        }
      }
      setMonthCustomers(monthCustMap);
      // T-20260727 RECLASS 2A: 월간 상담 축(monthAxisOf)도 **check_in 레코드 단위(시점정합)** recency 로 판정.
      //   RC = 고객단위 판정이 과거날짜 자기 첫 완료방문을 "과거 done" 으로 잡아 순수초진을 재진 오승격.
      //   per-checkin 판정 = 각 배정 check_in 을 그 방문 시각 이전 done 방문에 대해서만 판정(+owner-forced pin).
      {
        const vtMonthMap = await resolveVisitTypesByCheckIn(
          monthCi.map((c) => ({ id: c.id, customer_id: c.customer_id, checked_in_at: c.checked_in_at })),
          clinic.id,
        );
        setMonthVisitTypeByCi(vtMonthMap as Map<string, string>);
      }

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
  }, [clinic, profile?.id, selectedDate]);

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
          // T-20260727 RECLASS 2A: 초진/재진 = check_in 레코드 단위(시점정합) recency + owner-forced pin.
          //   per-checkin 맵 우선, 미해소(폴백) 시에만 stored ci.visit_type.
          visit_type: visitTypeByCi.get(ci.id) ?? ci.visit_type,
          lead_source: cu?.lead_source,
          visit_route: cu?.visit_route,
        });
      }
      return deriveTherapyAxis(ci);
    },
    [customers, visitTypeByCi],
  );

  // ── 수동배정 select default 값 (AC-6, read-only 프리셋) ────────────────────────
  // T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC:
  //   상담 축 select 의 default 값 = 해당 방문 check_ins.consultant_id 가 이미 있으면 그 값(기존값 유지),
  //   IS NULL(미배정)이면 2번차트 담당자(customers.assigned_staff_id)로 프리셋.
  //   assigned_staff_id 는 read-only basis(RED LINE) — 이 값은 화면 default 표시일 뿐 자동 write 없음.
  //   실제 배정 write 는 onChange → doManual → check_ins.consultant_id/therapist_id 에만 발생.
  //   assigned_staff_id read 출처 = load() customers 벌크 select(park fetchAssignedStaffId 헬퍼와 동일 read
  //   의미를 배치화한 것; 양방향연동/엔진 코드는 미병합). 치료(therapist_id) 축은 프리셋 대상 아님(consultant_id 한정).
  const assignSelectValue = useCallback(
    (ci: CheckIn, role: AssignmentRole): string => {
      const assignedId = role === 'consult' ? ci.consultant_id : ci.therapist_id;
      if (assignedId) return assignedId; // 값 있으면 기존값 유지
      if (role === 'consult') {
        const cu = ci.customer_id ? customers.get(ci.customer_id) : null;
        return cu?.assigned_staff_id ?? ''; // consultant_id IS NULL → 2번차트 담당 프리셋
      }
      return '';
    },
    [customers],
  );

  // ── 직원별 누적 (일누적=선택일 / 당월누적=기준일 당월 강제 — check_ins 정본 + assignment_actions audit) ─────
  // T-20260720-foot-ASSIGN-LABEL-DATE-SELECT: [일누적] = 선택일 당일.
  // T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP 변경4: [당월누적] = 선택일과 무관하게 '기준일(오늘,KST)' 당월만 강제.
  //   각 지표는 카운트가 아닌 명단(AssignDrillItem[])으로 수집 → 셀 카운트 = length 파생(count↔list 단일소스, 변경5).
  interface StaffCount {
    assigned: AssignDrillItem[]; // 배정(초진) — 균등 대상(축≠재진, auto/manual/pull, 받은 사람)
    returning: AssignDrillItem[]; // 배정(재진) — 재진 배정(균등 제외)
    tossGiven: AssignDrillItem[]; // 토스 넘긴 사람
    pulled: AssignDrillItem[]; // 당김 받은 사람
  }
  interface StaffStat {
    staff: Staff;
    day: StaffCount; // [일누적] 선택일 당일
    month: StaffCount; // [당월누적] 기준일(오늘) 당월 1일~오늘
  }

  // T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX AC-1: 배정(균등)/재진 = check_ins(정본) 카운트.
  //   상담축: 고객 visit_type='returning' → 재진, else 균등. 치료축: 항상 균등(재진 축 미해당).
  //   토스/당김 = assignment_actions(audit) 카운트(from/to 기준). → 자동·수동 모두 정확 반영.
  const monthAxisOf = useCallback(
    (ci: CheckIn, role: AssignmentRole): string => {
      if (role === 'consult') {
        const cu = ci.customer_id ? monthCustomers.get(ci.customer_id) : null;
        return deriveConsultAxis({
          // T-20260727 RECLASS 2A: 초진/재진 = check_in 레코드 단위(시점정합) recency + owner-forced pin.
          //   과다집계 RC(고객단위 self-contamination) 교정 핵심 경로.
          visit_type: monthVisitTypeByCi.get(ci.id) ?? ci.visit_type,
          lead_source: cu?.lead_source,
          visit_route: cu?.visit_route,
        });
      }
      return deriveTherapyAxis(ci);
    },
    [monthCustomers, monthVisitTypeByCi],
  );

  const staffStats = useMemo<StaffStat[]>(() => {
    // [일누적] 선택일 경계(KST). 한국은 DST 없음 → 24h 가산으로 익일 00:00(상한 exclusive) 산출 안전.
    const selDayStartMs = new Date(`${selectedDate}T00:00:00+09:00`).getTime();
    const selDayEndExclMs = selDayStartMs + 24 * 60 * 60 * 1000;
    // [당월누적] 변경4 — 선택일과 무관하게 '기준일(오늘,KST)'의 당월(1일 00:00 ~ 오늘 24:00 exclusive)만 강제 집계.
    //   → 전월 데이터 자동 제외. 월경계 오프바이원: 상한을 (오늘+1일) 00:00 exclusive 로 두어 오늘분 포함·익월 배제.
    const todayIso = todaySeoulISODate();
    const nowMonthStartMs = new Date(`${todayIso.slice(0, 7)}-01T00:00:00+09:00`).getTime();
    const todayStartMs = new Date(`${todayIso}T00:00:00+09:00`).getTime();
    const nowMonthEndExclMs = todayStartMs + 24 * 60 * 60 * 1000;
    // 일누적(선택일 당일) / 당월누적(기준일 당월) 판정 헬퍼 — 두 구간은 이제 독립(선택일이 과거월이어도 당월은 오늘 기준).
    const inDay = (ms: number) => ms >= selDayStartMs && ms < selDayEndExclMs;
    const inMonth = (ms: number) => ms >= nowMonthStartMs && ms < nowMonthEndExclMs;

    // check_in id → row (토스/당김 audit 의 고객 성함·차트번호 join 용).
    const ciById = new Map<string, CheckIn>(monthCheckIns.map((c) => [c.id, c]));
    const itemFromCi = (ci: CheckIn): AssignDrillItem => {
      const cust = ci.customer_id ? monthCustomers.get(ci.customer_id) : null;
      return {
        key: ci.id,
        // Bug A: 고객 정본(customers.name) 우선 → 등록 후 이름 정정 반영(성 누락 방지). 스냅샷(customer_name) fallback.
        name: (cust?.name ?? ci.customer_name ?? '—').trim() || '—',
        chartNumber: cust?.chart_number ?? null,
        customerId: ci.customer_id ?? null,
        // 상세①: 배정 일자 = 체크인 시각(KST). 그룹 헤더 소스.
        date: ci.checked_in_at ? seoulISODate(ci.checked_in_at) : null,
        // ROW-DELETE-ADMIN: 배정(초진/재진) 행 = 이 check_in 이 soft-hide 삭제 대상.
        checkInId: ci.id,
      };
    };

    const byId = new Map<string, StaffStat>();
    const zero = (): StaffCount => ({ assigned: [], returning: [], tossGiven: [], pulled: [] });
    const ensure = (s: Staff): StaffStat => {
      let st = byId.get(s.id);
      if (!st) {
        st = { staff: s, day: zero(), month: zero() };
        byId.set(s.id, st);
      }
      return st;
    };
    // 상담사·치료사만 노출
    for (const s of staff) {
      if (s.role === 'consultant' || s.role === 'therapist') ensure(s);
    }
    // 배정(초진)/배정(재진) — check_ins 정본(자동+수동 공통, 1건당 1회 / 역할별 분리)
    //   day/month 각 구간에 checked_in_at 기준으로 명단 push(구간에 함께 속하면 둘 다 push).
    const bumpAssign = (st: StaffStat, isReturning: boolean, ms: number, item: AssignDrillItem) => {
      const key = isReturning ? 'returning' : 'assigned';
      if (inMonth(ms)) st.month[key].push(item);
      if (inDay(ms)) st.day[key].push(item);
    };
    for (const ci of monthCheckIns) {
      const ms = ci.checked_in_at ? new Date(ci.checked_in_at).getTime() : NaN;
      // 일누적(과거월 선택 가능) 또는 당월누적(오늘 기준) 중 어느 구간에도 안 걸리면 skip.
      if (Number.isNaN(ms) || (!inDay(ms) && !inMonth(ms))) continue;
      // T-20260729-foot-ASSIGN-POPUP-DUPASSIGN-NAMETRUNC (Bug B): 취소된 배정은 유효 배정이 아니므로 제외.
      //   RC = monthCheckIns 는 deleted_at IS NULL 만 필터(status 무관, '누적 카운트 done 포함' 의도) → status='cancelled'
      //   이면서 soft-hide(deleted_at) 되지 않은 check_in 이 배정 팝업/카운트에 유령으로 잔존. 동일 고객이 취소 후 타 실장으로
      //   재배정(done)되면 두 실장 팝업에 동시 노출(F-5247 장홍석: 최현희 cancelled + 강경민 done). 당월 유령후보 9건.
      //   done 은 완료된 실제 배정이므로 유지 — cancelled 만 배제(원내 대기 목록의 done/cancelled 제외와 정합).
      if (ci.status === 'cancelled') continue;
      if (ci.consultant_id) {
        const s = staff.find((x) => x.id === ci.consultant_id);
        if (s && s.role === 'consultant') {
          bumpAssign(ensure(s), monthAxisOf(ci, 'consult') === 'returning', ms, itemFromCi(ci));
        }
      }
      if (ci.therapist_id) {
        const s = staff.find((x) => x.id === ci.therapist_id);
        if (s && s.role === 'therapist') {
          bumpAssign(ensure(s), monthAxisOf(ci, 'therapy') === 'returning', ms, itemFromCi(ci));
        }
      }
    }
    // 토스(넘긴 사람) / 당김(받은 사람) — assignment_actions audit (created_at 기준 구간 판정)
    //   고객 명단 = action.check_in_id → check_in → 고객(성함/차트번호). ci 미조회 시 명단만 '(고객 정보 없음)'.
    for (const a of actions) {
      const ms = new Date(a.created_at).getTime();
      if (Number.isNaN(ms) || (!inDay(ms) && !inMonth(ms))) continue;
      const ci = a.check_in_id ? ciById.get(a.check_in_id) : null;
      // 상세①: 토스/당김 그룹 일자 = 액션 발생일(KST) — 체크인일이 아닌 토스/당김한 날 기준.
      // ROW-DELETE-ADMIN: 토스/당김 행은 audit 액션 → checkInId=null(삭제 비대상). itemFromCi 의 checkInId 상속 차단.
      const item: AssignDrillItem = ci
        ? { ...itemFromCi(ci), key: a.id, date: seoulISODate(a.created_at), checkInId: null }
        : { key: a.id, name: '(고객 정보 없음)', chartNumber: null, customerId: null, date: seoulISODate(a.created_at), checkInId: null };
      if (a.action_type === 'toss' && a.from_staff_id) {
        const s = staff.find((x) => x.id === a.from_staff_id);
        if (s) {
          const st = ensure(s);
          if (inMonth(ms)) st.month.tossGiven.push(item);
          if (inDay(ms)) st.day.tossGiven.push(item);
        }
      }
      if (a.action_type === 'pull_in' && a.to_staff_id) {
        const s = staff.find((x) => x.id === a.to_staff_id);
        if (s) {
          const st = ensure(s);
          if (inMonth(ms)) st.month.pulled.push(item);
          if (inDay(ms)) st.day.pulled.push(item);
        }
      }
    }
    const wantRole = activeTab === 'consult' ? 'consultant' : 'therapist';
    return Array.from(byId.values())
      .filter((st) => st.staff.role === wantRole)
      .sort((x, y) => y.month.assigned.length - x.month.assigned.length);
  }, [staff, actions, monthCheckIns, monthCustomers, monthAxisOf, activeTab, selectedDate]);

  // T-20260729-foot-ASSIGN-TARGETCOL-STAFFCUMUL-EMPTY-WIRE (총괄 결정 B):
  //   '일일 배정 목표' = (선택일 초진 예약 수) × (그 실장 랭킹 배정 비율). 느슨결합 단일 지점 유지.
  //   비율 SSOT = rankAssignmentRatios(랭킹 탭과 동일 함수). 랭킹은 상담실장(consultant) 개념 →
  //   치료사(therapy 탭)·비admin 은 랭킹 파생 목표 부재 → null('—'). 상담실장이 랭킹에 없으면(매출 0 등) 목표 0.
  const targetRatios = useMemo(
    () => rankAssignmentRatios(targetPerfRows, targetCfg),
    [targetPerfRows, targetCfg],
  );
  const dailyTargetOf = useCallback(
    (st: StaffStat): number | null => {
      // 접근통제 + 랭킹 개념 게이트: admin 전용 + 상담(consultant) 탭 + 산식 입력 로딩 완료.
      if (!canViewRanking) return null;
      if (st.staff.role !== 'consultant') return null; // 치료사는 랭킹 배정 비율 대상 아님
      if (targetRatios == null || selDayInitResvCount == null) return null; // config 미설정/미조회 → '—'
      const ratio = targetRatios.get(st.staff.id) ?? 0; // 랭킹 미포함 실장 = 비율 0 → 목표 0(AC-2 '0이면 0')
      return Math.round(selDayInitResvCount * ratio);
    },
    [canViewRanking, targetRatios, selDayInitResvCount],
  );

  // ── T-20260729-foot-DAILY-TARGET-NEXTWEEK-AUTO ────────────────────────────────
  //   [일일 배정 목표] = 차주(다음 주) 요일별 초진 예약 건수 자동 계산 + 실시간 반영.
  //   주 경계 = 월~일(ISO week). 오늘(KST)이 속한 주의 월요일 +7일 = 다음 주 월요일, +6일 = 다음 주 일요일.
  //   confirm_pending(AC-1): 월~일 기본값으로 착수(현장 이견 시 fast-fix).
  const nextWeekRange = useMemo(() => {
    const nextMon = isoAddDays(mondayOfIso(todaySeoulISODate()), 7);
    const nextSun = isoAddDays(nextMon, 6);
    const days = Array.from({ length: 7 }, (_, i) => isoAddDays(nextMon, i)); // [월..일] 7개 ISO
    return { nextMon, nextSun, days };
  }, []);

  // 집계: 차주 범위 초진 예약을 reservation_date(방문일) 기준 일자별 카운트.
  //   술어 SSOT = monthInitResvCount 와 동일(visit_type='new' + status!=cancelled). 취소=집계 제외(AC-2/AC-4).
  const fetchNextWeekTargets = useCallback(async () => {
    if (!clinic) return;
    const { nextMon, nextSun } = nextWeekRange;
    const { data, error } = await supabase
      .from('reservations')
      .select('reservation_date')
      .eq('clinic_id', clinic.id)
      .eq('visit_type', 'new')
      .neq('status', 'cancelled')
      .gte('reservation_date', nextMon)
      .lte('reservation_date', nextSun);
    if (error) {
      console.warn('[Assignments] next-week target load failed:', error);
      return; // 실패 시 직전 표시 유지(빈 상태로 덮어쓰지 않음)
    }
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as { reservation_date: string | null }[]) {
      const d = r.reservation_date;
      if (!d) continue;
      const key = d.slice(0, 10); // DATE 'YYYY-MM-DD'
      counts[key] = (counts[key] ?? 0) + 1;
    }
    setNextWeekTargets(counts);
  }, [clinic, nextWeekRange]);

  // [상담]/[치료] 탭 진입 시 조회(랭킹/배정목록 탭에서는 미조회 — egress 절감).
  useEffect(() => {
    if (mainTab !== 'consult' && mainTab !== 'therapy') return;
    void fetchNextWeekTargets();
  }, [mainTab, fetchNextWeekTargets]);

  // 실시간 반영(AC-3/AC-4): reservations 변경 구독 → 재조회. 기존 realtime 패턴 재사용(Reservations.tsx 동형).
  useEffect(() => {
    if (!clinic) return;
    if (mainTab !== 'consult' && mainTab !== 'therapy') return;
    const ch = supabase
      .channel(`assign_nextweek_target_${clinic.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinic.id}` },
        () => {
          void fetchNextWeekTargets();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [clinic, mainTab, fetchNextWeekTargets]);

  // ── T-20260729-foot-ASSIGN-TARGETCOL: '일일 배정 목표' 산식 입력 3종 병렬 조회 ──────────────
  //   ① 선택일 월누적 매출(랭킹 순서) = fetchConsultantPerf(선택일 1일~선택일) — 랭킹 탭과 동일 진입점(SECDEF admin-gated).
  //   ② 하루 목표건수 config(top/bottom) = fetchDailyTargetConfig — 랭킹 비율 SSOT 입력.
  //   ③ 선택일 초진 예약 수 = reservations(visit_type='new' + status!=cancelled + reservation_date=선택일).
  //      술어 SSOT = fetchNextWeekTargets/monthInitResvCount 와 동일(취소 제외). day 경계 = [selectedDate, +1일).
  const fetchDailyTargetInputs = useCallback(async () => {
    if (!clinic || !canViewRanking) return; // 비admin → 서버 42501, 미조회(표시 '—' 유지)
    const clinicId = clinic.id;
    const monthStart = `${selectedDate.slice(0, 7)}-01`;
    try {
      const [perf, cfg, dayResv] = await Promise.all([
        fetchConsultantPerf(clinicId, monthStart, selectedDate),
        fetchDailyTargetConfig(clinicId),
        supabase
          .from('reservations')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId)
          .eq('visit_type', 'new')
          .neq('status', 'cancelled')
          .gte('reservation_date', selectedDate)
          .lt('reservation_date', isoAddDays(selectedDate, 1)),
      ]);
      setTargetPerfRows(perf);
      setTargetCfg(cfg ? { top: cfg.top_rank_target, bottom: cfg.bottom_rank_target } : null);
      setSelDayInitResvCount(dayResv.count ?? 0);
    } catch (e) {
      // 실패 시 직전 표시 유지(빈 상태로 덮어쓰지 않음). 상담 탭 진입 전 최초엔 selDayInitResvCount=null → '—'.
      console.warn('[Assignments] daily target inputs load failed:', e);
    }
  }, [clinic, canViewRanking, selectedDate]);

  // [상담] 탭 진입/선택일 변경 시 조회(랭킹 파생 = 상담실장 개념 → 치료 탭 미조회, egress 절감).
  useEffect(() => {
    if (mainTab !== 'consult') return;
    void fetchDailyTargetInputs();
  }, [mainTab, fetchDailyTargetInputs]);

  // 실시간 반영(시나리오3): reservations 변경 → 선택일 초진예약수 재조회 → 목표 즉시 갱신.
  useEffect(() => {
    if (!clinic || !canViewRanking || mainTab !== 'consult') return;
    const ch = supabase
      .channel(`assign_dailytarget_input_${clinic.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinic.id}` },
        () => {
          void fetchDailyTargetInputs();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [clinic, canViewRanking, mainTab, fetchDailyTargetInputs]);

  // ── [랭킹] 탭 (T-20260726-...-ADMINLOCK + T-20260727-foot-RANKING-TAB-DATEPICKER-6SPEC) ──────
  //  · 데이터 소스 = fetchConsultantPerf (CRM-ASSIGN-RANKING-FIX-R1 정합본: 재직 실장만 + 매출 총액 정합).
  //    랭킹 산식/집계를 이 탭에서 새로 만들지 않는다(재발명 금지). R1 산출값을 date-range 재호출로 read-only 소비.
  //  · #1 선택일(rankingDate) 기준 6-read 병렬(모두 READ, DB 무변경):
  //     ① 월매출(1일~선택일) = 순위 기준  ② 전주매출(직전주 월~일)  ③ 이번주매출(이번주 월~선택일, 변동표용)
  //     ④ 당일 배정건수(check_ins.consultant_id — 배정 SSOT, deleted_at + cancelled 제외)  ⑤ 당월 초진예약 총건수
  //     ⑥ 배정비율 설정값(assignment_daily_target_config — 플레이북 [실행 1b], 신규 저장 0)
  //  · 표시 read-only. customers.assigned_consultant_id 무접촉(RED LINE). admin 전용 탭 진입 시에만 fetch.
  //  · TM 제외 판단(#6): check_ins.consultant_id 배정은 데스크 상담배정 SSOT이며 lead_source 미보유(TM 판별자 부재).
  //    reservations 조인 TM 필터는 신뢰불가 + 기존 배정건수 정의(check_ins 전건)와 정합 붕괴 → TM 별도필터 미적용(전건 집계).
  useEffect(() => {
    if (mainTab !== 'ranking' || !canViewRanking || !clinic) return;
    let cancelled = false;
    void (async () => {
      setRankLoading(true);
      const clinicId = clinic.id;
      const { monthStart, thisWeekMon, prevWeekMon, prevWeekSun } = rankingRanges(rankingDate);
      const dayStart = `${rankingDate}T00:00:00+09:00`;
      const dayEndExcl = `${isoAddDays(rankingDate, 1)}T00:00:00+09:00`;
      const monthEndExcl = `${isoAddDays(monthStart, 32).slice(0, 7)}-01`; // 선택일 달의 다음달 1일(DATE)
      try {
        const [monthPerf, prevPerf, thisPerf, dayCi, initResv, tgtCfg] = await Promise.all([
          fetchConsultantPerf(clinicId, monthStart, rankingDate),
          fetchConsultantPerf(clinicId, prevWeekMon, prevWeekSun),
          fetchConsultantPerf(clinicId, thisWeekMon, rankingDate),
          supabase
            .from('check_ins')
            .select('consultant_id')
            .eq('clinic_id', clinicId)
            .not('consultant_id', 'is', null)
            .is('deleted_at', null)
            // T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE: 취소건 배정 카운트 배제.
            //   staffStats(누적/드릴 팝업, a7885a99)·금일 배분 이력 표(8ff93685)에서 확립한 불변식
            //   ('cancelled' 는 배정 카운트/표시에서 제외 — done 등 활성 배정만 집계)을 [랭킹] 탭 '당일 배정건수'
            //   집계에도 동일 적용. 이전엔 deleted_at 만 필터 → cancelled(비-soft-hide) 배정이 유령으로 과다카운트.
            //   배정 규칙/assigned_consultant_id 무변경(집계 필터만, RED LINE 무접촉).
            .neq('status', 'cancelled')
            .gte('checked_in_at', dayStart)
            .lt('checked_in_at', dayEndExcl),
          supabase
            .from('reservations')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', clinicId)
            .eq('visit_type', 'new')
            .neq('status', 'cancelled')
            .gte('reservation_date', monthStart)
            .lt('reservation_date', monthEndExcl),
          fetchDailyTargetConfig(clinicId),
        ]);
        if (cancelled) return;
        const toRevMap = (rows: ConsultantRow[]) => {
          const m = new Map<string, number>();
          for (const r of rows) m.set(r.consultant_id, r.total_amount ?? 0);
          return m;
        };
        setPerfRows(monthPerf);
        setPrevWeekRevenue(toRevMap(prevPerf));
        setThisWeekRevenue(toRevMap(thisPerf));
        const dc = new Map<string, number>();
        for (const r of (dayCi.data ?? []) as { consultant_id: string | null }[]) {
          if (r.consultant_id) dc.set(r.consultant_id, (dc.get(r.consultant_id) ?? 0) + 1);
        }
        setDayAssignCounts(dc);
        setMonthInitResvCount(initResv.count ?? 0);
        setDailyTargetCfg(
          tgtCfg ? { top: tgtCfg.top_rank_target, bottom: tgtCfg.bottom_rank_target } : null,
        );
      } catch (e) {
        if (!cancelled) {
          setPerfRows([]);
          setPrevWeekRevenue(new Map());
          setThisWeekRevenue(new Map());
          setDayAssignCounts(new Map());
          setMonthInitResvCount(0);
          setDailyTargetCfg(null);
          console.warn('[Assignments] ranking load failed:', e);
        }
      } finally {
        if (!cancelled) setRankLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mainTab, canViewRanking, clinic, rankingDate]);

  interface RankingRow {
    rank: number;
    consultantId: string;
    name: string;
    monthRevenue: number; // #2 월매출(1일~선택일)
    prevWeekRevenue: number; // #4 전주매출(직전주 월~일)
    avgTicket: number | null; // 객단가(유지) = ARPU(avg_amount)
    expectedRatio: number | null; // #5 랭크 배정비율(0~1). cfg 부재=null → '—'
    expectedCount: number | null; // #5 예상 배정건수 = round(당월 초진예약 × 비율)
    dayAssignCount: number; // #6 당일 누적 배정건수
  }
  const rankingRows = useMemo<RankingRow[]>(() => {
    const sorted = [...perfRows].sort(
      (a, b) =>
        (b.total_amount ?? 0) - (a.total_amount ?? 0) ||
        (a.name ?? '').localeCompare(b.name ?? '', 'ko'),
    );
    // #5 배정비율 = rankAssignmentRatios(단일 산식 SSOT). 직원별 누적 표 '일일 배정 목표' 컬럼과 동일 함수 공유(중복 산식 금지).
    const ratios = rankAssignmentRatios(perfRows, dailyTargetCfg);
    return sorted.map((r, i) => {
      const ratio = ratios?.get(r.consultant_id) ?? null;
      return {
        rank: i + 1,
        consultantId: r.consultant_id,
        name: r.name ?? '—',
        monthRevenue: r.total_amount ?? 0,
        prevWeekRevenue: prevWeekRevenue.get(r.consultant_id) ?? 0,
        avgTicket: r.avg_amount ?? null,
        expectedRatio: ratio,
        expectedCount: ratio != null ? Math.round(monthInitResvCount * ratio) : null,
        dayAssignCount: dayAssignCounts.get(r.consultant_id) ?? 0,
      };
    });
  }, [perfRows, prevWeekRevenue, dayAssignCounts, monthInitResvCount, dailyTargetCfg]);

  // ── #3 하단 실장별 랭킹 변동표 (주간 기준 — 전주 순위 vs 이번주 순위, 각 매출 desc) ──────────
  //  기준 확정(#4): 주간(직전주 월~일 vs 이번주 월~선택일). 스펙 예시(전주 순위/이번주 순위) 정합.
  //  delta = prevRank − thisRank ( >0 = 순위 상승 ↑N / <0 = 하락 ↓N / 0 = 유지 - ).
  interface VariationRow {
    consultantId: string;
    name: string;
    prevRank: number | null;
    thisRank: number | null;
    delta: number | null;
  }
  const variationRows = useMemo<VariationRow[]>(() => {
    const ids = perfRows.map((r) => r.consultant_id);
    const nameMap = new Map(perfRows.map((r) => [r.consultant_id, r.name ?? '—']));
    const nameOf = (id: string) => nameMap.get(id) ?? '—';
    const prevRankMap = rankByRevenue(ids, (id) => prevWeekRevenue.get(id) ?? 0, nameOf);
    const thisRankMap = rankByRevenue(ids, (id) => thisWeekRevenue.get(id) ?? 0, nameOf);
    return ids
      .map((id) => {
        const pr = prevRankMap.get(id) ?? null;
        const tr = thisRankMap.get(id) ?? null;
        return {
          consultantId: id,
          name: nameOf(id),
          prevRank: pr,
          thisRank: tr,
          delta: pr != null && tr != null ? pr - tr : null,
        };
      })
      .sort((a, b) => (a.thisRank ?? 9999) - (b.thisRank ?? 9999));
  }, [perfRows, prevWeekRevenue, thisWeekRevenue]);

  // ── AC-3: 금일 배분 이력(read-only) — 오늘 배정된 check_ins(정본). 방식=assignment_actions 최신 action 파생.
  interface TodayDistRow {
    id: string;
    checkIn: CheckIn; // 요청1(A) row 담당 수정용 — doManual(check_ins per-visit UPDATE) 대상
    customerName: string;
    // T-20260724-foot-ASSIGNHIST-CHARTNO-CHART2-LINK: 성함 옆 차트번호 병기(AC-1) + 2번차트 링크(AC-2) 앵커.
    //   customerId = customers PK(동명이인 오라우팅 방지 식별자). chartNumber = null 이면 미발번(성함 단독).
    customerId: string | null;
    chartNumber: string | null;
    role: AssignmentRole;
    staffId: string | null;
    method: string; // 자동 | 수동 | 토스 | 당김 | —
    at: string; // ISO (action created_at 우선, 없으면 checked_in_at)
    // T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: [확정] 발송 게이트 바인딩.
    inflow: string; // 유입경로(축 라벨: TM/인바운드/워크인/재진 …) — 발송 포맷 '[유입경로]'.
    notifyStatus: string | null; // check_ins.consult_notify_status (NULL=미확정, 'sent'=발송됨)
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
      // T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE (Bug A 잔여면): 금일 배분 이력도 취소 배정을 제외.
      //   ASSIGN-POPUP-DUPASSIGN-NAMETRUNC 는 staffStats(누적/드릴 팝업)에만 cancelled 가드를 넣었고 이 표는 누락 —
      //   deleted_at 만 필터하는 monthCheckIns 특성상 cancelled(비-soft-hide) 배정이 유령으로 잔존(당월 9건).
      //   동일 고객이 취소 후 타 실장 재배정(done)되면 이 표에도 두 실장 행이 동시 노출(1환자 2실장). '활성배정만' 불변식 일관 적용.
      if (ci.status === 'cancelled') continue;
      const push = (role: AssignmentRole, staffId: string | null) => {
        if (!staffId) return;
        if (role !== activeTab) return;
        const act = latestAct.get(`${ci.id}:${role}`);
        const cust = ci.customer_id ? monthCustomers.get(ci.customer_id) : null;
        rows.push({
          id: `${ci.id}:${role}`,
          checkIn: ci,
          // T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE (Bug B 잔여면): 성함 = 고객 정본(customers.name) live 우선.
          //   ASSIGN-POPUP 는 드릴 팝업(itemFromCi)만 교정 — 이 표는 여전히 스냅샷(customer_name)을 읽어 성 누락('홍석') 잔존.
          //   drill 팝업과 동일 경로로 통일(정본 우선, 스냅샷 fallback). 당월 불일치 3/435(장홍석·김구엽·박경수).
          customerName: cust?.name ?? ci.customer_name ?? '—',
          customerId: ci.customer_id ?? null,
          chartNumber: cust?.chart_number ?? null,
          role,
          staffId,
          method: act ? (METHOD_KO[act.action_type] ?? '—') : '—',
          at: act?.created_at ?? ci.checked_in_at!,
          // T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL (DECOUPLE): 유입경로 라벨을 균등 버킷
          //   축(deriveConsultAxis)에서 분리 → 고객 실제 visit_route 원문 노출(재진은 '재진'). 네이버·지인소개·공홈
          //   등 실값 소실('워크인' 접힘) 해소. 발송 게이트/상태는 consult 행에만 의미. 배정 로직 무변경.
          inflow: role === 'consult' ? consultInflowLabel(axisOf(ci, 'consult'), cust) : '',
          notifyStatus: ci.consult_notify_status ?? null,
        });
      };
      push('consult', ci.consultant_id);
      push('therapy', ci.therapist_id);
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [monthCheckIns, actions, activeTab, monthCustomers, axisOf]);

  // T-20260724-foot-ASSIGNHIST-ROW-EDIT-DELETE 요청1(A): 금일 배분 이력 row 담당 수정 옵션.
  //   현재 탭(activeTab) 역할의 active staff 전체(출근 무관 — 과거배정 담당이 비출근일 수 있어 전체 노출). 이름 정렬.
  const distEditStaffOptions = useMemo<Staff[]>(() => {
    const target = activeTab === 'consult' ? 'consultant' : 'therapist';
    return staff
      .filter((s) => s.role === target)
      .sort((a, b) =>
        (a.display_name ?? a.name).trim().localeCompare((b.display_name ?? b.name).trim(), 'ko'),
      );
  }, [staff, activeTab]);

  // ── [배정목록] 탭 — 카테고리 담당자 드롭 옵션 + 선택 담당자 금일 배정 환자목록 ─────────
  // T-20260710-foot-ASSIGNMENT-LIST-TAB
  //   담당자 옵션 = 해당 role(consultant/therapist) 전체 active staff(출근 무관 — 과거/전체 조회 가능). 이름 정렬.
  const listStaffOptions = useMemo<Staff[]>(() => {
    const target = listCategory === 'consult' ? 'consultant' : 'therapist';
    return staff
      .filter((s) => s.role === target)
      .sort((a, b) =>
        (a.display_name ?? a.name).trim().localeCompare((b.display_name ?? b.name).trim(), 'ko'),
      );
  }, [staff, listCategory]);

  // 선택 담당자(미선택 시 카테고리 전체)의 금일 배정 환자목록.
  //   앵커 = check_ins(정본, monthCheckIns 를 오늘로 필터 → done 포함/cancelled 제외). 배정 = consultant_id(상담)/therapist_id(치료).
  //   배정시각 = 해당 role 최신 assignment_action(auto/manual/toss/pull) created_at 우선, 없으면 checked_in_at.
  interface ListRow {
    id: string;
    checkIn: CheckIn;
    customerName: string;
    staffId: string;
    status: CheckInStatus;
    axis: string;
    at: string; // ISO 배정시각(action 우선, fallback checked_in_at)
  }
  const assignmentListRows = useMemo<ListRow[]>(() => {
    const todayIso = todaySeoulISODate();
    const todayStartMs = new Date(`${todayIso}T00:00:00+09:00`).getTime();
    // check_in_id:role → 최신 action(created_at desc) — 배정시각 파생용(todayDistribution 과 동일 규칙).
    const latestAct = new Map<string, AssignmentAction>();
    for (const a of actions) {
      if (!a.check_in_id || a.role !== listCategory) continue;
      if (new Date(a.created_at).getTime() < todayStartMs) continue;
      const key = `${a.check_in_id}:${a.role}`;
      const prev = latestAct.get(key);
      if (!prev || a.created_at > prev.created_at) latestAct.set(key, a);
    }
    const rows: ListRow[] = [];
    for (const ci of monthCheckIns) {
      if (!ci.checked_in_at || new Date(ci.checked_in_at).getTime() < todayStartMs) continue;
      if (ci.status === 'cancelled') continue; // 취소 건은 '금일 배정 환자' 아님
      const staffId = listCategory === 'consult' ? ci.consultant_id : ci.therapist_id;
      if (!staffId) continue; // 미배정 제외
      if (listStaffId && staffId !== listStaffId) continue; // 담당 선택 시 그 담당만 (AC4). 미선택=전체 (AC5)
      const act = latestAct.get(`${ci.id}:${listCategory}`);
      rows.push({
        id: `${ci.id}:${listCategory}`,
        checkIn: ci,
        customerName: ci.customer_name ?? '—',
        staffId,
        status: ci.status,
        axis: monthAxisOf(ci, listCategory),
        at: act?.created_at ?? ci.checked_in_at,
      });
    }
    // 배정시각 오름차순(먼저 배정된 순)
    return rows.sort((a, b) => a.at.localeCompare(b.at));
  }, [monthCheckIns, actions, listCategory, listStaffId, monthAxisOf]);

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

  // T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B: 배분 이력 row 삭제(soft-hide) 실행.
  //   확인 다이얼로그(distDeleteTarget) '확인' → softHideCheckIn(check_ins.deleted_at 세팅, hard-DELETE 금지).
  //   권한 = admin/manager/원장(canEditDistribution) + 서버 RLS 이중. rows-affected 가드는 helper 내부.
  const doSoftHideDist = async () => {
    if (!distDeleteTarget || !clinic || busy) return;
    setBusy(true);
    const res = await softHideCheckIn({
      checkInId: distDeleteTarget.checkIn.id,
      deletedBy: profile?.id ?? null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success('배분 이력에서 삭제했습니다.');
      setDistDeleteTarget(null);
      void load();
    } else {
      toast.error(res.message ?? '삭제 실패');
    }
  };

  // T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: 금일 배분 이력 [확정] → 상담대기방(C0B4HEC9SHH) 발송 게이트.
  //   현행 자동발송 없음(factual_check: chat.postMessage prod 미배선) → [확정] 클릭 시에만 발송(신규 배선).
  //   멱등: 서버 EF 가 조건부 claim(consult_notify_status IS NULL → 'sending' → 'sent') rows-affected 로 이중발송 차단.
  //   상태 지속(check_ins.consult_notify_status, 3-state) → 새로고침·다중 사용자에도 '발송됨' 유지.
  //   RED LINE INV-1: 발송상태 컬럼만 write, consultant_id/매출귀속 무접촉.
  const doConfirmNotify = async (r: TodayDistRow) => {
    if (!clinic || notifyingId) return;
    if (r.role !== 'consult') return; // '상담 대기중' 발송 = 상담 배정 한정
    if (r.notifyStatus === 'sent' || r.notifyStatus === 'sending') return; // 이미 발송됨/발송중(멱등)
    setNotifyingId(r.id);
    try {
      const { data, error } = await supabase.functions.invoke(EDGE_FUNCTIONS.SEND_CONSULT_NOTIFY, {
        body: { check_in_id: r.checkIn.id, clinic_id: clinic.id, inflow: r.inflow },
      });
      const res = (data ?? {}) as { ok?: boolean; sent?: boolean; alreadySent?: boolean; error?: string };
      if (error || res.error || res.ok === false) {
        toast.error(res.error ?? error?.message ?? '발송 실패');
        return;
      }
      if (res.alreadySent) {
        toast.success('이미 발송된 건입니다.');
      } else {
        toast.success(`${staffName(r.staffId)} · ${r.customerName}님 상담대기방 발송 완료`);
      }
      void load(); // consult_notify_status 재조회 → '발송됨' 반영
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '발송 실패');
    } finally {
      setNotifyingId(null);
    }
  };

  // T-20260726-foot-ASSIGN-HIST-ROW-DELETE-ADMIN: 직원별 누적 drill-down 배정 이력 행 삭제(soft-hide).
  //   admin 한정(isAdmin 게이트 + 서버 check_ins UPDATE RLS is_admin_or_manager 이중). 확인 다이얼로그 경유.
  //   실행 후 (a) drill 팝업 items 에서 해당 행 낙관적 제거(행 사라짐) (b) load() → 직원별 누적 셀 재계산(누적 1 감소).
  const doSoftHideDrill = async () => {
    if (!drillDeleteTarget || !clinic || busy) return;
    setBusy(true);
    const res = await softHideCheckIn({
      checkInId: drillDeleteTarget.checkInId,
      deletedBy: profile?.id ?? null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success('배정 이력에서 삭제했습니다.');
      // (a) 팝업 리스트에서 해당 행 즉시 제거 — items 는 클릭시점 스냅샷이라 수동 필터.
      setDrillDialog((prev) =>
        prev ? { ...prev, items: prev.items.filter((it) => it.key !== drillDeleteTarget.itemKey) } : prev,
      );
      setDrillDeleteTarget(null);
      // (b) 직원별 누적 셀 재계산(deleted_at IS NULL 필터 → 누적 수치 실시간 반영, AC4).
      void load();
    } else {
      toast.error(res.message ?? '삭제 실패');
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
          {/* T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK §3: '배정 순번 설정' 진입 버튼을
              헤더(우측)에서 제거 → [랭킹] 탭 내부로 이동(중복 노출 금지). 트리거 위치만 재배치,
              RotationOrderDialog 저장/데이터 경로 무접촉. */}
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

      {/* [상담]/[치료]/[배정목록] 탭 — 같은 화면 내 파트별 분리.
          상담/치료 = 배정 운영 카드(role 필터). 배정목록 = 담당자별 금일 환자목록 조회(T-20260710-foot-ASSIGNMENT-LIST-TAB). */}
      <Tabs
        value={mainTab}
        onValueChange={(v) => {
          const next = v as 'consult' | 'therapy' | 'list' | 'ranking';
          // T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK: 비admin 이 (URL/이벤트 조작 등으로) ranking 진입 시도 시 무시(이중 가드).
          if (next === 'ranking' && !canViewRanking) return;
          setMainTab(next);
          // 상담/치료 탭은 기존 운영 카드의 role 필터(activeTab) 동기화. 배정목록/랭킹은 자체 조회.
          if (next === 'consult' || next === 'therapy') setActiveTab(next);
        }}
      >
        <TabsList className="h-auto gap-1 p-1" data-testid="assignments-role-tabs">
          <TabsTrigger value="consult" className="px-4 py-1.5 text-sm" data-testid="assignments-tab-consult">
            상담
          </TabsTrigger>
          <TabsTrigger value="therapy" className="px-4 py-1.5 text-sm" data-testid="assignments-tab-therapy">
            치료
          </TabsTrigger>
          <TabsTrigger value="list" className="px-4 py-1.5 text-sm" data-testid="assignments-tab-list">
            배정목록
          </TabsTrigger>
          {/* T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK: [랭킹] = 관리자(원장·총괄) 전용. 비admin 은 탭 자체 미노출(UI 숨김). */}
          {canViewRanking && (
            <TabsTrigger value="ranking" className="px-4 py-1.5 text-sm" data-testid="assignments-tab-ranking">
              랭킹
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {/* ── [상담]/[치료] 탭: 기존 배정 운영 카드(①~④). 배정목록·랭킹 탭에서는 미노출. ── */}
      {(mainTab === 'consult' || mainTab === 'therapy') && (
        <>
      {/* ⓪ 일일 배정 목표 (차주 초진 예약) — T-20260729-foot-DAILY-TARGET-NEXTWEEK-AUTO.
          차주(다음 주 월~일) 요일별 초진(신규 첫 방문) 예약 건수 = 그 날의 배정 목표. read-only, 실시간 자동 갱신. */}
      {/* T-20260729-foot-RANKING-NEXTWEEK-CARD-MONOTONE-COMPACT: 화려한 emerald 색·큰 크기 → 기존 표/테이블 톤에 맞춘
          모노톤(무채색 bg-muted) + 컴팩트(테이블 헤더 수준 패딩·폰트). 데이터·집계·실시간 구독 로직은 무접촉(스타일만). */}
      <Card data-testid="assignments-nextweek-target-card">
        <CardHeader className="py-2">
          <CardTitle className="text-sm">일일 배정 목표 · 차주 초진 예약</CardTitle>
          <p className="text-xs text-muted-foreground">
            다음 주({nextWeekRange.nextMon.slice(5).replace('-', '.')}~{nextWeekRange.nextSun.slice(5).replace('-', '.')}) 요일별 초진(신규 첫 방문) 예약 건수입니다. 예약 생성·취소 시 자동으로 갱신됩니다.
          </p>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="grid grid-cols-7 gap-1" data-testid="nextweek-target-grid">
            {nextWeekRange.days.map((d, i) => {
              const dow = ['월', '화', '수', '목', '금', '토', '일'][i];
              const count = nextWeekTargets ? (nextWeekTargets[d] ?? 0) : null; // null=로딩, 조회 후 0건=0(AC-5)
              // 모노톤: 주말(토·일)은 무채색 강조(text-foreground), 평일은 muted. 색상 hue 제거.
              const dowClass = i === 5 || i === 6 ? 'text-foreground' : 'text-muted-foreground';
              return (
                <div
                  key={d}
                  data-testid={`nextweek-target-cell-${d}`}
                  className="flex flex-col items-center gap-0.5 rounded border bg-muted/40 px-2 py-2 text-center"
                >
                  <span className={`text-xs font-medium ${dowClass}`}>{dow}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {d.slice(5).replace('-', '.')}
                  </span>
                  <span
                    className="text-base font-semibold tabular-nums text-foreground"
                    data-testid={`nextweek-target-count-${d}`}
                  >
                    {count == null ? '·' : count}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
                  // AC-6: 미배정(consultant_id IS NULL) 상담 축은 2번차트 담당자로 default 프리셋. 값 있으면 그 값.
                  const selectVal = assignSelectValue(ci, role);
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
                        {role === 'consult' && isReturningAxis(axis) ? (
                          // T-20260701-foot-REVISIT-CONSULTANT-ASSIGN-HIDE (AC-1): 재진 상담 실장 배정 칸 숨김 → 치료사 배정만.
                          //   재진 판정 SSOT = isReturningAxis(axisOf→deriveConsultAxis) — autoAssign·NewCheckInDialog 와 동일 소스(AC-4).
                          //   치료(therapy) 탭·초진(신규) 상담은 불변(select 정상 노출, AC-2).
                          <span
                            data-testid={`assign-consult-hidden-${ci.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            재진 — 상담 배정 없음
                          </span>
                        ) : (
                          <select
                            data-testid={role === 'consult' ? `assign-consult-select-${ci.id}` : undefined}
                            className="rounded border bg-background px-1.5 py-1 text-xs"
                            value={selectVal}
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
                            {/* 출근 풀에 없지만 현재 배정/프리셋된 사람 보존 노출 (프리셋=2번차트 담당이 비출근/비상담직군일 때 포함) */}
                            {selectVal && !poolFor(role).some((s) => s.id === selectVal) && (
                              <option value={selectVal}>{staffName(selectVal)} (비출근)</option>
                            )}
                          </select>
                        )}
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
              (오늘 {activeTab === 'consult' ? '상담' : '치료'} 배정 {todayDistribution.length}건
              {canEditDistribution ? ' · 담당 수정 가능' : ' · 표시 전용'})
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
                  {/* T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: 발송(확정) 열 — 상담 탭 한정(치료 탭 무의미) */}
                  {activeTab === 'consult' && (
                    <th className="px-2 py-2 text-right font-medium">발송</th>
                  )}
                  {/* T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B: 삭제 열 — admin/manager/원장 한정 노출 */}
                  {canEditDistribution && (
                    <th className="px-2 py-2 text-right font-medium">삭제</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {todayDistribution.length === 0 && (
                  <tr>
                    <td
                      colSpan={4 + (activeTab === 'consult' ? 1 : 0) + (canEditDistribution ? 1 : 0)}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      오늘 배분된 건이 없습니다.
                    </td>
                  </tr>
                )}
                {todayDistribution.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    {/* T-20260724-foot-ASSIGNHIST-CHARTNO-CHART2-LINK:
                        AC-1 성함 옆 차트번호 병기(미발번=성함 단독, 잔여기호 금지).
                        AC-2 성함 클릭 → 고객 2번차트(/chart/:customerId) 별도 팝업창(window.open).
                        customerId=customers PK 기준 → 동명이인 오라우팅 방지. customer_id 없으면 링크 비활성.
                        (Closing.tsx CLOSING-CHARTNUM-POPUP window.open 패턴 재사용) */}
                    <td className="px-3 py-2 font-medium">
                      {r.customerId ? (
                        <button
                          type="button"
                          data-testid={`dist-chart-link-${r.id}`}
                          className="text-left text-teal-600 hover:text-teal-700 hover:underline"
                          onClick={() =>
                            window.open(
                              `${window.location.origin}/chart/${r.customerId}`,
                              `foot-chart-${r.customerId}`,
                              'width=1200,height=900,scrollbars=yes,resizable=yes',
                            )
                          }
                        >
                          {r.customerName}
                        </button>
                      ) : (
                        r.customerName
                      )}
                      {r.chartNumber && (
                        <span className="ml-1 font-mono text-[11px] font-normal text-teal-600">
                          {chartNoBadge(r.chartNumber)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {/* T-20260724-foot-ASSIGNHIST-ROW-EDIT-DELETE 요청1(A): admin/manager/director 는 담당 인라인 수정.
                          write 타깃 = check_ins.consultant_id/therapist_id(per-visit, doManual) 만. assigned_staff_id 무접점(RED LINE).
                          권한 없으면 기존대로 read-only 표시. */}
                      {canEditDistribution ? (
                        <select
                          data-testid={`dist-edit-select-${r.id}`}
                          className="rounded border bg-background px-1.5 py-1 text-xs"
                          value={r.staffId ?? ''}
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.value && e.target.value !== r.staffId)
                              void doManual(r.checkIn, r.role, e.target.value);
                          }}
                        >
                          {distEditStaffOptions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {(s.display_name ?? s.name).trim()}
                            </option>
                          ))}
                          {/* 옵션 풀에 없는 현재 담당(비활성/타역할) 보존 노출 */}
                          {r.staffId && !distEditStaffOptions.some((s) => s.id === r.staffId) && (
                            <option value={r.staffId}>{staffName(r.staffId)}</option>
                          )}
                        </select>
                      ) : (
                        staffName(r.staffId)
                      )}
                    </td>
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
                    {/* T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY 변경2: 발송(확정) 셀 — 상담 탭 한정.
                        상태 3-state(멱등): 미확정 → [확정] 버튼 / 발송중 / 발송됨.
                        클릭 시에만 send-consult-notify EF → 상담대기방(C0B4HEC9SHH) 발송(자동발송 없음).
                        멱등: 서버 조건부 claim + notifyStat!=='미확정' 시 버튼 비노출 → 이중발송 방지.
                        T-20260729-foot-CONFIRM-BTN-ROLE-OPEN: 역할 제한(canEditDistribution) 제거 —
                          코디네이터 포함 전 역할이 [확정] 버튼 표시+클릭 가능. '미확정' 텍스트 폴백 렌더 경로도 제거.
                          (총괄 지시: 접근제어 완화. sent/sending 건은 role 무관 배지로 멱등 유지.) */}
                    {activeTab === 'consult' && (
                      <td className="px-2 py-2 text-right">
                        {r.notifyStatus === 'sent' ? (
                          <Badge variant="teal" className="font-normal" data-testid={`dist-notify-sent-${r.id}`}>
                            발송됨
                          </Badge>
                        ) : r.notifyStatus === 'sending' ? (
                          <Badge variant="secondary" className="font-normal" data-testid={`dist-notify-sending-${r.id}`}>
                            발송중
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid={`dist-confirm-btn-${r.id}`}
                            disabled={busy || notifyingId !== null}
                            className="h-7 px-2 text-xs text-teal-700 hover:bg-teal-50 hover:text-teal-800"
                            onClick={() => void doConfirmNotify(r)}
                          >
                            {notifyingId === r.id ? '발송 중…' : '확정'}
                          </Button>
                        )}
                      </td>
                    )}
                    {/* T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B: 삭제(soft-hide) — 전 행 노출(test 조건 없음).
                        클릭 → 확인 다이얼로그(distDeleteTarget). admin/manager/원장 한정. */}
                    {canEditDistribution && (
                      <td className="px-2 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`dist-delete-btn-${r.id}`}
                          disabled={busy}
                          className="h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() =>
                            setDistDeleteTarget({
                              checkIn: r.checkIn,
                              customerName: r.customerName,
                              role: r.role,
                            })
                          }
                        >
                          삭제
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ③ 직원별 누적 (선택일 기준 [일누적]/[당월누적] 분리) — T-20260720-foot-ASSIGN-LABEL-DATE-SELECT */}
      <Card data-testid="assignments-monthly-card">
        <CardHeader className="py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm">직원별 누적</CardTitle>
            {/* 날짜 선택 UI — 기존 CRM 컴포넌트(native date input) 재사용. max=오늘(미래 선택 차단·회귀0 보장). */}
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="assign-accum-date" className="font-medium text-muted-foreground">
                기준일
              </label>
              <input
                id="assign-accum-date"
                data-testid="assignments-accum-date"
                type="date"
                value={selectedDate}
                max={todaySeoulISODate()}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                className="rounded border bg-background px-2 py-1"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* T-20260629-foot-ASSIGNMONTHLY-SCROLL-REMOVE: 스크롤/높이 제한 제거 → 직원 수만큼 전체 펼침.
              T-20260720: 일누적/당월누적 2그룹 → 컬럼 증가로 좁은 태블릿 대비 x축 스크롤만 허용. */}
          <div className="overflow-x-auto">
            {/* T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP 변경1: '역할' 컬럼 제거(데이터 존치, 표시만).
                변경2/3: 일누적=[일일 배정 목표/배정(초진)/배정(재진)/토스/당김], 당월누적=[총 누적 배정/배정(초진)/배정(재진)/토스/당김]. */}
            <table className="w-full min-w-[680px] text-xs">
              <thead className="border-y bg-muted text-muted-foreground">
                {/* 1단: [일누적]/[당월누적] 그룹 헤더 (각 5지표) */}
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium" rowSpan={2}>직원</th>
                  <th
                    className="border-l px-2 py-1.5 text-center font-semibold text-foreground"
                    colSpan={5}
                    data-testid="accum-group-day"
                  >
                    일누적
                  </th>
                  <th
                    className="border-l px-2 py-1.5 text-center font-semibold text-foreground"
                    colSpan={5}
                    data-testid="accum-group-month"
                  >
                    당월누적
                  </th>
                </tr>
                {/* 2단: 각 그룹의 5지표 */}
                <tr>
                  <th className="border-l px-2 py-1.5 text-right font-medium">일일 배정 목표</th>
                  <th className="px-2 py-1.5 text-right font-medium">배정(초진)</th>
                  <th className="px-2 py-1.5 text-right font-medium">배정(재진)</th>
                  <th className="px-2 py-1.5 text-right font-medium">토스</th>
                  <th className="px-2 py-1.5 text-right font-medium">당김</th>
                  <th className="border-l px-2 py-1.5 text-right font-medium">총 누적 배정</th>
                  <th className="px-2 py-1.5 text-right font-medium">배정(초진)</th>
                  <th className="px-2 py-1.5 text-right font-medium">배정(재진)</th>
                  <th className="px-2 py-1.5 text-right font-medium">토스</th>
                  <th className="px-2 py-1.5 text-right font-medium">당김</th>
                </tr>
              </thead>
              <tbody>
                {staffStats.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
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
                    {/* 변경1: '역할' 컬럼 제거(데이터 존치, 표시만) */}
                    {(() => {
                      const staffLabel = (st.staff.display_name ?? st.staff.name).trim();
                      // 변경5: 클릭 가능 건수 셀 — count↔list 단일소스(셀 표시값 = items.length).
                      //   0건이어도 클릭 가능(빈 상태 안내). 좌측경계(border-l)는 그룹 첫 셀에만.
                      const cell = (
                        items: AssignDrillItem[],
                        scopeLabel: string,
                        metricLabel: string,
                        testid: string,
                        leftBorder: boolean,
                      ) => (
                        <td className={(leftBorder ? 'border-l ' : '') + 'px-2 py-2 text-right'}>
                          <button
                            type="button"
                            data-testid={testid}
                            onClick={() =>
                              setDrillDialog({ staffName: staffLabel, scopeLabel, metricLabel, items })
                            }
                            className="inline-flex min-w-[1.5rem] justify-end tabular-nums underline-offset-2 hover:underline focus:underline focus:outline-none"
                          >
                            {items.length}
                          </button>
                        </td>
                      );
                      const dayTarget = dailyTargetOf(st);
                      const monthTotal = st.month.assigned.length + st.month.returning.length;
                      return (
                        <>
                          {/* [일누적] 선택일 당일 */}
                          <td
                            className="border-l px-2 py-2 text-right text-muted-foreground"
                            data-testid={`accum-day-target-${st.staff.id}`}
                          >
                            {dayTarget == null ? '—' : dayTarget.toLocaleString()}
                          </td>
                          {cell(st.day.assigned, '일누적', '배정(초진)', `accum-day-assigned-${st.staff.id}`, false)}
                          {cell(st.day.returning, '일누적', '배정(재진)', `accum-day-returning-${st.staff.id}`, false)}
                          {cell(st.day.tossGiven, '일누적', '토스', `accum-day-toss-${st.staff.id}`, false)}
                          {cell(st.day.pulled, '일누적', '당김', `accum-day-pull-${st.staff.id}`, false)}
                          {/* [당월누적] 기준일(오늘) 당월 1일~오늘 (변경4) */}
                          <td
                            className="border-l px-2 py-2 text-right font-semibold"
                            data-testid={`accum-month-total-${st.staff.id}`}
                          >
                            {monthTotal}
                          </td>
                          {cell(st.month.assigned, '당월누적', '배정(초진)', `accum-month-assigned-${st.staff.id}`, false)}
                          {cell(st.month.returning, '당월누적', '배정(재진)', `accum-month-returning-${st.staff.id}`, false)}
                          {cell(st.month.tossGiven, '당월누적', '토스', `accum-month-toss-${st.staff.id}`, false)}
                          {cell(st.month.pulled, '당월누적', '당김', `accum-month-pull-${st.staff.id}`, false)}
                        </>
                      );
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
        </>
      )}

      {/* ── [배정목록] 탭: 카테고리(상담/치료) 드롭 → 담당자 드롭 → 선택 담당자 금일 배정 환자목록 ── */}
      {/* T-20260710-foot-ASSIGNMENT-LIST-TAB. read-only 조회(DB무변경). 앵커=check_ins. */}
      {mainTab === 'list' && (
        <Card data-testid="assignments-list-card">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">배정목록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 드롭다운 2단 — 태블릿 큰 터치 타깃 */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">카테고리</label>
                <select
                  data-testid="list-category-select"
                  className="w-full rounded border bg-background px-2 py-2 text-sm"
                  value={listCategory}
                  onChange={(e) => {
                    setListCategory(e.target.value as AssignmentRole);
                    setListStaffId(''); // 카테고리 전환 시 담당 선택 초기화(직전 목록 잔존 X — 시나리오2)
                  }}
                >
                  <option value="consult">상담</option>
                  <option value="therapy">치료</option>
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {listCategory === 'consult' ? '상담사' : '치료사'}
                </label>
                <select
                  data-testid="list-staff-select"
                  className="w-full rounded border bg-background px-2 py-2 text-sm"
                  value={listStaffId}
                  onChange={(e) => setListStaffId(e.target.value)}
                >
                  <option value="">전체 ({listCategory === 'consult' ? '상담사' : '치료사'} 전원)</option>
                  {listStaffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.display_name ?? s.name).trim()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 금일 배정 환자목록 */}
            <div className="rounded border">
              <div className="border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                금일 배정 환자{' '}
                <span className="font-semibold text-foreground">{assignmentListRows.length}</span>명
                {listStaffId
                  ? ` · ${staffName(listStaffId)}`
                  : ` · ${listCategory === 'consult' ? '상담사' : '치료사'} 전체`}
              </div>
              <div className="max-h-[52vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 border-b bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">환자</th>
                      {!listStaffId && <th className="px-2 py-2 text-left font-medium">담당</th>}
                      <th className="px-2 py-2 text-left font-medium">상태</th>
                      <th className="px-2 py-2 text-left font-medium">축</th>
                      <th className="px-2 py-2 text-right font-medium">배정시각</th>
                    </tr>
                  </thead>
                  <tbody data-testid="list-patient-rows">
                    {assignmentListRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={listStaffId ? 4 : 5}
                          className="px-3 py-8 text-center text-muted-foreground"
                          data-testid="list-empty"
                        >
                          금일 배정된 환자가 없습니다.
                        </td>
                      </tr>
                    )}
                    {assignmentListRows.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <span className="font-medium">{r.customerName}</span>
                          {r.checkIn.queue_number != null && (
                            <span className="ml-1 text-muted-foreground">#{r.checkIn.queue_number}</span>
                          )}
                        </td>
                        {!listStaffId && (
                          <td className="px-2 py-2 text-muted-foreground">{staffName(r.staffId)}</td>
                        )}
                        <td className="px-2 py-2">
                          <Badge variant="outline" className="font-normal">
                            {STATUS_KO[r.status] ?? r.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant={r.axis === 'returning' ? 'secondary' : 'teal'} className="font-normal">
                            {listCategory === 'consult' ? '상담' : '치료'}·{AXIS_KO[r.axis] ?? r.axis}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right text-muted-foreground">
                          {r.at
                            ? new Date(r.at).toLocaleTimeString('ko-KR', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Seoul',
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── [랭킹] 탭: 실장 랭킹(순위/이름/누적매출/배정건수) — 관리자 전용. ──
          T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK.
          데이터 = R1 정합본(fetchConsultantPerf: 재직 실장만 + 매출정합). 순위=당월 누적매출 desc. read-only.
          ⚠ canViewRanking 이중 가드 — 비admin 은 여기 도달 불가(탭 미노출 + onValueChange 차단 + 아래 && 가드). */}
      {mainTab === 'ranking' && canViewRanking && (
        <div className="space-y-4">
        <Card data-testid="assignments-ranking-card">
          <CardHeader className="py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-sm">실장 랭킹</CardTitle>
                <p className="text-xs text-muted-foreground">
                  재직 상담 실장 기준 · 월매출(1일~선택일) 순 · 관리자 전용
                </p>
              </div>
              {/* #1 DatePicker — 기존 CRM 컴포넌트(native date input) 재사용(신규 npm 0). 기본=오늘, max=오늘(미래 차단). */}
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="ranking-date" className="font-medium text-muted-foreground">
                  기준일
                </label>
                <input
                  id="ranking-date"
                  data-testid="ranking-date"
                  type="date"
                  value={rankingDate}
                  max={todaySeoulISODate()}
                  onChange={(e) => {
                    if (e.target.value) setRankingDate(e.target.value);
                  }}
                  className="rounded border bg-background px-2 py-1"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[64vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-y bg-muted text-muted-foreground">
                  <tr>
                    <th className="w-14 px-3 py-2 text-center font-medium">순위</th>
                    <th className="px-3 py-2 text-left font-medium">이름</th>
                    <th className="px-3 py-2 text-right font-medium">월매출</th>
                    <th className="px-3 py-2 text-right font-medium">전주매출</th>
                    <th className="px-3 py-2 text-right font-medium">객단가</th>
                    <th className="px-3 py-2 text-right font-medium">당월 배정 예상 비율</th>
                    <th className="px-3 py-2 text-right font-medium">배정 건 수</th>
                  </tr>
                </thead>
                <tbody data-testid="ranking-rows">
                  {rankLoading && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground" data-testid="ranking-loading">
                        랭킹 불러오는 중…
                      </td>
                    </tr>
                  )}
                  {!rankLoading && rankingRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground" data-testid="ranking-empty">
                        표시할 랭킹 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                  {!rankLoading &&
                    rankingRows.map((r) => (
                      <tr key={r.consultantId} className="border-b last:border-0 hover:bg-muted/20" data-testid="ranking-row">
                        <td className="px-3 py-2.5 text-center font-semibold tabular-nums">{r.rank}</td>
                        <td className="px-3 py-2.5 font-medium">{r.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-testid="ranking-revenue">
                          {formatAmount(r.monthRevenue)}원
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-testid="ranking-prevweek-revenue">
                          {formatAmount(r.prevWeekRevenue)}원
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-testid="ranking-avg-ticket">
                          {r.avgTicket != null ? `${formatAmount(r.avgTicket)}원` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-testid="ranking-expected-ratio">
                          {r.expectedRatio != null
                            ? `${Math.round(r.expectedRatio * 100)}% (${r.expectedCount ?? 0}건)`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-testid="ranking-assign-count">
                          {r.dayAssignCount.toLocaleString('ko-KR')}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!rankLoading && dailyTargetCfg == null && rankingRows.length > 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="ranking-ratio-note">
                ※ 배정 예상 비율은 [배정 순번 설정]의 하루 목표건수(배정 비율)가 설정되어야 표시됩니다.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── #3 하단 실장별 랭킹 변동표(주간: 전주 순위 → 이번주 순위, ↑N/↓N/-) ── */}
        <Card data-testid="assignments-ranking-variation-card">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">실장별 랭킹 변동 (주간)</CardTitle>
            <p className="text-xs text-muted-foreground">
              직전 주(월~일) 대비 이번 주(월~선택일) 매출 순위 변동
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[40vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-y bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">실장명</th>
                    <th className="px-3 py-2 text-center font-medium">전주 순위</th>
                    <th className="px-3 py-2 text-center font-medium">이번주 순위</th>
                    <th className="px-3 py-2 text-center font-medium">변동</th>
                  </tr>
                </thead>
                <tbody data-testid="ranking-variation-rows">
                  {!rankLoading && variationRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground" data-testid="ranking-variation-empty">
                        표시할 변동 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                  {!rankLoading &&
                    variationRows.map((v) => (
                      <tr key={v.consultantId} className="border-b last:border-0 hover:bg-muted/20" data-testid="ranking-variation-row">
                        <td className="px-3 py-2.5 font-medium">{v.name}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {v.prevRank != null ? `${v.prevRank}위` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {v.thisRank != null ? `${v.thisRank}위` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-semibold tabular-nums" data-testid="ranking-variation-delta">
                          {v.delta == null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : v.delta > 0 ? (
                            <span className="text-emerald-600">↑{v.delta}</span>
                          ) : v.delta < 0 ? (
                            <span className="text-red-500">↓{Math.abs(v.delta)}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── [랭킹] 탭 §3: '배정 순번 설정' 통합(T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK).
            헤더 우측에 있던 '배정 순번 설정' 진입 버튼을 이 탭 안으로 이동(원 위치 제거 = 중복노출 금지).
            버튼은 기존 RotationOrderDialog 를 그대로 열며 저장/데이터 경로 무접촉(재배치만).
            canViewRanking(=admin/manager/director) 탭 게이트 + canEditRotation 동일 술어로 이중 정합. */}
        {canEditRotation && (
          <Card data-testid="assignments-rotation-card">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">배정 순번 설정</CardTitle>
              <p className="text-xs text-muted-foreground">
                자동배정 기본순번 · 치료 파트 가능 시술 편집 · 관리자 전용
              </p>
            </CardHeader>
            <CardContent className="pb-4">
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
            </CardContent>
          </Card>
        )}
        </div>
      )}

      {/* T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP 변경5: 직원별 누적 건수 셀 → 고객 명단 drill-down.
          THERAPIST-DESIGNATED(designated-dialog) 패턴 재사용 — 성함+차트번호 리스트, count↔list 단일소스. */}
      <Dialog open={!!drillDialog} onOpenChange={(o) => !o && setDrillDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="accum-drill-title">
              {drillDialog?.staffName} · {drillDialog?.scopeLabel} {drillDialog?.metricLabel}
            </DialogTitle>
            <DialogDescription>
              {drillDialog?.metricLabel} {drillDialog?.items.length ?? 0}건 · 고객 성함과 차트번호입니다.
            </DialogDescription>
          </DialogHeader>
          {(drillDialog?.items.length ?? 0) === 0 ? (
            <div
              data-testid="accum-drill-empty"
              className="py-8 text-center text-sm text-muted-foreground"
            >
              해당 내역이 없습니다.
            </div>
          ) : (
            <div data-testid="accum-drill-list" className="max-h-[60vh] space-y-3 overflow-auto">
              {(() => {
                // 변경5 상세①②(fqb6, 목업 F0BKYPYK8TW) — 일자별 그룹 + 가로 2단(2열) 나열.
                //   최신 일자 상단(내림차순). 성함/차트번호 클릭 → 2번차트(ASSIGNHIST-CHARTNO-CHART2-LINK 재사용).
                const items = drillDialog?.items ?? [];
                const groups = new Map<string, AssignDrillItem[]>();
                for (const it of items) {
                  const d = it.date ?? '날짜 미상';
                  const arr = groups.get(d);
                  if (arr) arr.push(it);
                  else groups.set(d, [it]);
                }
                const keys = Array.from(groups.keys()).sort((a, b) => {
                  if (a === '날짜 미상') return 1; // 날짜미상 그룹은 맨 아래
                  if (b === '날짜 미상') return -1;
                  return b.localeCompare(a); // YYYY-MM-DD 내림차순 = 최신 일자 상단
                });
                // 상세②: 신규 라우팅 신설 금지 — 기존 2번차트 window.open 패턴 재사용.
                const openChart2 = (cid: string) =>
                  window.open(
                    `${window.location.origin}/chart/${cid}`,
                    `foot-chart-${cid}`,
                    'width=1200,height=900,scrollbars=yes,resizable=yes',
                  );
                return keys.map((dkey) => {
                  const list = groups.get(dkey) ?? [];
                  // 헤더 표기 26-07-25 (YY-MM-DD). 날짜미상은 원문 유지.
                  const header = dkey === '날짜 미상' ? dkey : dkey.slice(2);
                  return (
                    <div key={dkey} data-testid={`accum-drill-group-${dkey}`}>
                      <div
                        data-testid="accum-drill-date-header"
                        className="mb-1 border-b pb-0.5 text-xs font-semibold text-muted-foreground"
                      >
                        {header}
                      </div>
                      {/* 가로 2단(2열) — 항목 홀수면 grid 가 마지막 행 우측 칸 자동 공백 처리 */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {list.map((it) => {
                          const inner = (
                            <>
                              <span data-testid="accum-drill-name" className="truncate font-medium">
                                {it.name}
                              </span>
                              <span
                                data-testid="accum-drill-chartno"
                                className="shrink-0 font-mono text-xs"
                              >
                                {chartNoBadge(it.chartNumber)}
                              </span>
                            </>
                          );
                          // ROW-DELETE-ADMIN: 배정(초진/재진) 행(checkInId 존재)만 admin 삭제 버튼 노출.
                          //   토스/당김 행(checkInId=null)·비-admin 은 미노출. 서버측 RLS 이중 차단(AC3).
                          const canDeleteRow = isAdmin && !!it.checkInId;
                          return (
                            <div
                              key={it.key}
                              data-testid="accum-drill-item"
                              className="flex min-w-0 items-center gap-1"
                            >
                              {it.customerId ? (
                                // 성함/차트번호 어느 쪽을 눌러도(버블링) 2번차트 open
                                <button
                                  type="button"
                                  data-testid={`accum-drill-chart-link-${it.key}`}
                                  onClick={() => openChart2(it.customerId!)}
                                  className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1 py-1.5 text-left text-teal-600 hover:bg-teal-50 hover:underline"
                                >
                                  {inner}
                                </button>
                              ) : (
                                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 py-1.5 text-muted-foreground">
                                  {inner}
                                </div>
                              )}
                              {canDeleteRow && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`accum-drill-delete-btn-${it.key}`}
                                  disabled={busy}
                                  className="h-7 shrink-0 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                                  onClick={() =>
                                    setDrillDeleteTarget({
                                      checkInId: it.checkInId!,
                                      itemKey: it.key,
                                      name: it.name,
                                    })
                                  }
                                >
                                  삭제
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* T-20260725-foot-ASSIGNHIST-DELETE-ALLROWS-R2B: 배분 이력 row 삭제 확인 다이얼로그.
          '확인' → soft-hide(deleted_at 세팅, 복원가능). 파괴적이지 않지만 오삭제 표면 넓어 확인 필수. */}
      <Dialog open={!!distDeleteTarget} onOpenChange={(o) => !o && setDistDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>배분 이력 삭제</DialogTitle>
            <DialogDescription>
              {distDeleteTarget && (
                <>
                  <span className="font-medium text-foreground">{distDeleteTarget.customerName}</span> ·{' '}
                  {distDeleteTarget.role === 'consult' ? '상담' : '치료'} 배정 줄을 금일 배분 이력에서
                  삭제할까요? 실제로는 화면에서만 숨겨지며 되살릴 수 있습니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDistDeleteTarget(null)}
              disabled={busy}
              data-testid="dist-delete-cancel-btn"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doSoftHideDist()}
              disabled={busy}
              data-testid="dist-delete-confirm-btn"
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* T-20260726-foot-ASSIGN-HIST-ROW-DELETE-ADMIN: 직원별 누적 drill-down 배정 이력 행 삭제 확인 다이얼로그.
          admin 한정. '확인' → soft-hide(deleted_at 세팅, 복원가능) + 누적 셀 실시간 재계산. */}
      <Dialog open={!!drillDeleteTarget} onOpenChange={(o) => !o && setDrillDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>배정 이력 삭제</DialogTitle>
            <DialogDescription>
              {drillDeleteTarget && (
                <>
                  <span className="font-medium text-foreground">{drillDeleteTarget.name}</span> 배정 이력
                  줄을 삭제할까요? 직원별 누적 수치에서 빠집니다. 실제로는 화면에서만 숨겨지며 되살릴 수
                  있습니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDrillDeleteTarget(null)}
              disabled={busy}
              data-testid="accum-drill-delete-cancel-btn"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doSoftHideDrill()}
              disabled={busy}
              data-testid="accum-drill-delete-confirm-btn"
            >
              삭제
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
//   T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN: 치료 파트 행에 가능 시술(프리컨디셔닝/포돌로게/리본)
//   체크박스 3개 embed. caps != null 일 때만 노출(상담 파트는 미노출). 저장 백엔드 = therapist_capabilities(DA 질의A (ii)).
function SortableRotationRow({
  staff, index, canEdit, testid, caps, onToggleCap, capDisabled,
}: {
  staff: RotaStaff;
  index: number;
  canEdit: boolean;
  testid: string;
  /** 이 치료사의 현재 capability 코드 집합. undefined = capability UI 미노출(상담 파트). */
  caps?: Set<string>;
  onToggleCap?: (code: string) => void;
  /** capability 소스 부재(테이블 미적용) 등으로 체크박스 비활성. */
  capDisabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: staff.id,
    disabled: !canEdit,
  });
  const showCaps = caps !== undefined;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`rounded-lg border bg-muted/20 px-3 py-2 ${isDragging ? 'shadow-md ring-2 ring-primary/40' : ''}`}
      data-testid={`rotation-row-${testid}-${index}`}
    >
      <div className="flex items-center gap-2">
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

      {/* 가능 시술 capability 체크박스(치료 파트만) — 태블릿 큰 터치 타깃(min-h 44). */}
      {showCaps && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`rotation-caps-${testid}-${index}`}>
          {GATED_CAPABILITY_ITEMS.map((item) => {
            const checked = !!caps?.has(item.code);
            return (
              <button
                key={item.code}
                type="button"
                disabled={!canEdit || !!capDisabled}
                onClick={() => onToggleCap?.(item.code)}
                data-testid={`rotation-cap-${testid}-${index}-${item.code}`}
                data-checked={checked}
                aria-pressed={checked}
                className={[
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left transition',
                  'min-h-[40px] text-[12px] font-medium',
                  checked
                    ? 'border-teal-400 bg-teal-50 text-teal-800'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
                  (!canEdit || capDisabled) ? 'cursor-not-allowed opacity-60' : '',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-teal-500 bg-teal-500 text-white' : 'border-neutral-300 bg-white',
                  ].join(' ')}
                >
                  {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      )}
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
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [colMissing, setColMissing] = useState(false);
  const [consult, setConsult] = useState<RotaStaff[]>([]);
  const [therapy, setTherapy] = useState<RotaStaff[]>([]);
  // T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN: 치료사별 가능 시술 capability.
  //   caps=현재 편집 상태, capBaseline=로드 시점(저장 delta 산출용). staffId → capability_code Set.
  const [caps, setCaps] = useState<Map<string, Set<string>>>(new Map());
  const [capBaseline, setCapBaseline] = useState<Map<string, Set<string>>>(new Map());
  const [capMissing, setCapMissing] = useState(false); // therapist_capabilities 테이블 부재 → 체크박스 비활성

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
    const therapistRows = rows.filter((r) => r.role === 'therapist').sort(sortFn);
    setConsult(rows.filter((r) => r.role === 'consultant').sort(sortFn).map((r) => ({ id: r.id, name: r.name })));
    setTherapy(therapistRows.map((r) => ({ id: r.id, name: r.name })));
    setColMissing(false);

    // capability 로드(graceful) — therapist_capabilities 부재 시 체크박스 비활성만, 순번 편집엔 무영향.
    const therapistIds = therapistRows.map((r) => r.id);
    const capMap = new Map<string, Set<string>>();
    therapistIds.forEach((id) => capMap.set(id, new Set()));
    if (therapistIds.length > 0) {
      const { data: capRows, error: capErr } = await supabase
        .from('therapist_capabilities')
        .select('staff_id, capability_code')
        .in('staff_id', therapistIds);
      if (capErr) {
        setCapMissing(true);
      } else {
        setCapMissing(false);
        for (const r of (capRows ?? []) as { staff_id: string; capability_code: string }[]) {
          if (!capMap.has(r.staff_id)) capMap.set(r.staff_id, new Set());
          capMap.get(r.staff_id)!.add(r.capability_code);
        }
      }
    }
    // 편집 상태·baseline 을 독립 복제(delta 비교용).
    const clone = (m: Map<string, Set<string>>) => new Map([...m].map(([k, v]) => [k, new Set(v)] as const));
    setCaps(clone(capMap));
    setCapBaseline(clone(capMap));
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

  // capability 체크 토글(치료 파트) — 로컬 상태만 변경, 실제 반영은 [순번 저장].
  const toggleCap = (staffId: string, code: string) => {
    if (!canEdit || capMissing) return;
    setCaps((prev) => {
      const next = new Map([...prev].map(([k, v]) => [k, new Set(v)] as const));
      const set = next.get(staffId) ?? new Set<string>();
      if (set.has(code)) set.delete(code);
      else set.add(code);
      next.set(staffId, set);
      return next;
    });
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

      // ── capability 저장(delta) — 체크 신설=insert / 언체크=delete. baseline 대비 변경분만.
      //    THERAPIST-SKILL AC-1: 저장 = therapist_capabilities 행 upsert/delete(현장 체크박스 불변).
      if (!capMissing) {
        const inserts: { staff_id: string; capability_code: string; clinic_id: string; created_by: string | null }[] = [];
        const deletes: { staff_id: string; code: string }[] = [];
        const allowed = new Set(GATED_CAPABILITY_CODES);
        for (const s of therapy) {
          const cur = caps.get(s.id) ?? new Set<string>();
          const base = capBaseline.get(s.id) ?? new Set<string>();
          for (const code of cur) {
            if (allowed.has(code) && !base.has(code)) {
              inserts.push({ staff_id: s.id, capability_code: code, clinic_id: clinicId, created_by: profile?.id ?? null });
            }
          }
          for (const code of base) {
            if (!cur.has(code)) deletes.push({ staff_id: s.id, code });
          }
        }
        const capOps: PromiseLike<{ error: unknown }>[] = [];
        if (inserts.length > 0) {
          capOps.push(
            supabase.from('therapist_capabilities')
              .upsert(inserts, { onConflict: 'staff_id,capability_code' }),
          );
        }
        for (const d of deletes) {
          capOps.push(
            supabase.from('therapist_capabilities')
              .delete().eq('staff_id', d.staff_id).eq('capability_code', d.code),
          );
        }
        const capResults = await Promise.all(capOps);
        const capFailed = capResults.find((r) => r.error);
        if (capFailed?.error) {
          const msg = (capFailed.error as { message?: string })?.message ?? String(capFailed.error);
          toast.error(`가능 시술 저장 실패: ${msg}`);
          setSaving(false);
          return;
        }
      }

      toast.success('배정 순번·가능 시술을 저장했습니다 (새 배정부터 반영)');
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
    withCaps = false, // 치료 파트만 true → 가능 시술 체크박스 노출
  ) => (
    <div className="flex-1 min-w-0" data-testid={`rotation-part-${testid}`}>
      <p className="mb-1.5 text-sm font-semibold">{title} <span className="text-xs text-muted-foreground">({list.length}명)</span></p>
      {withCaps && (
        <p className="mb-2 text-[11px] text-muted-foreground" data-testid="rotation-caps-hint">
          치료사별 가능 시술을 체크하면 금일 치료유형에 맞는 치료사에게만 자동배정됩니다.
          {capMissing && ' (가능 시술 설정은 잠시 후 이용 가능합니다.)'}
        </p>
      )}
      {list.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">등록된 직원이 없습니다.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(list, setList)}>
          <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {list.map((s, i) => (
                <SortableRotationRow
                  key={s.id}
                  staff={s}
                  index={i}
                  canEdit={canEdit && !saving}
                  testid={testid}
                  caps={withCaps ? (caps.get(s.id) ?? new Set<string>()) : undefined}
                  onToggleCap={withCaps ? (code) => toggleCap(s.id, code) : undefined}
                  capDisabled={capMissing}
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="rotation-order-dialog">
        <DialogHeader>
          <DialogTitle>자동배정 기본순번 설정</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : colMissing ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            순번 컬럼이 아직 적용되지 않았습니다. 잠시 후 다시 시도해주세요.
          </p>
        ) : (
          <div className="flex flex-col gap-3 md:flex-row">
            {renderList('상담 파트', consult, setConsult, 'consult')}
            {renderList('치료 파트', therapy, setTherapy, 'therapy', true)}
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
