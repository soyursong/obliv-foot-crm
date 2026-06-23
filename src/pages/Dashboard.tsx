// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. useChart() hook 경유만 허용. 변경 시 현장 승인 필수
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS, getEventCoordinates } from '@dnd-kit/utilities';
import { addDays, format, isSameDay, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  CreditCard,
  EyeOff,
  GripVertical,
  LayoutGrid,
  MapPin,
  Minus,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  User,
  Users,
  X,
  ZoomIn,
  Package,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { fetchEffectiveRoomAssignments } from '@/lib/roomAssignments';
import { stripSimulationRows } from '@/lib/simulationFilter';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { closeTimeFor, generateSlots, openTimeFor } from '@/lib/schedule';
import { STATUS_KO, VISIT_TYPE_KO, STATUS_COLOR, VISIT_TYPE_COLOR, STATUS_FLAG_CARD_BG, STATUS_FLAG_LABEL } from '@/lib/status';
import { applyStatusFlagTransition } from '@/lib/statusFlagTransition';
import { timelineVisitType } from '@/lib/timeline-routing';
import { formatAmount, maskPhoneTail, seoulISODate, cardDisplayName, phoneTailSuffix, chartNoBadge } from '@/lib/format';
import { normalizeToE164 } from '@/lib/phone';
import { cn } from '@/lib/utils';
import { nextSlotSortOrder as computeNextSlotSortOrder, compareSlotFifo } from '@/lib/slotOrder';
import { subscribeRefresh } from '@/lib/dashboardRefreshBus';
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import { NewCheckInDialog } from '@/components/NewCheckInDialog';
import { CheckInDetailSheet } from '@/components/CheckInDetailSheet';
import DoctorCallListBar from '@/components/DoctorCallListBar';
// T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [6]: 대시보드 달력 날짜 클릭 → 페이지 이동 없이
//   하단 인라인 현황(근무스케줄+인수인계) 표시. CalendarNoticePanel이 /admin?date=YYYY-MM-DD 로 네비게이트.
import DashboardDateDetail from '@/components/DashboardDateDetail';
import { PaymentDialog } from '@/components/PaymentDialog';
import { PaymentMiniWindow } from '@/components/PaymentMiniWindow';
import { StatusContextMenu } from '@/components/StatusContextMenu';
import { CustomerQuickMenu } from '@/components/CustomerQuickMenu';
import SendSmsDialog from '@/components/SendSmsDialog';
import { canAccess } from '@/lib/permissions';
import { CustomerHoverCard } from '@/components/CustomerHoverCard';
// T-20260601-foot-DASH-HSCROLL-CHART-LOC #3: 성함 옆 현재 배정 슬롯 이름
import { getAssignedSlotName } from '@/lib/checkin-slot';
// T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout 단일화로 이동
import { useChart } from '@/lib/chartContext';
// T-20260515-foot-CONTEXT-MENU-4ITEM: 진료차트 패널
import MedicalChartPanel from '@/components/MedicalChartPanel';
// T-20260611-foot-CTXMENU-UNIFY-CANONICAL: 대시보드 타임라인 예약 박스 우클릭 메뉴를
//   ReservationContextMenu(SMS/취소/완전삭제 3항목) → CustomerQuickMenu(5항목 canonical) 미러링으로 통일.
// T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV: [예약상세] 는 대시보드 로컬 팝업 대신 예약관리 정본 팝업으로
//   라우팅 위임(중복 마운트 제거) → ReservationDetailPopup 임베드/임포트 불요.
import { playOvertimeAlert } from '@/lib/audio';
import { autoDeductSession } from '@/lib/session';
import { promoteVisitTypeToReturning } from '@/lib/visitType';
// T-20260617-foot-AUTOASSIGN: 상담대기/치료대기 슬롯 진입 시 상담사/치료사 자동배정(best-effort)
import { maybeAutoAssign, logRealAssignment } from '@/lib/autoAssign';
// T-20260612-foot-MEDLAW22-B-GATE: 급여 방문 진료기록 미작성 → 완료 슬롯 이동 하드차단.
import { evaluateMedicalRecordGate } from '@/lib/medicalRecordGate';
import { elapsedMinutes, elapsedMMSS } from '@/lib/elapsed';
// T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 미수 배지 (소스=footBilling outstanding SSOT 재사용)
import { loadCustomerOutstanding, type CustomerOutstanding } from '@/lib/footBilling';
import { OutstandingDueBadge } from '@/components/PkgOutstandingBadge';
import type { CheckIn, CheckInRealtimeRow, CheckInStatus, Clinic, Reservation, Room, RoomFieldKey, Staff, StatusFlag, VisitType } from '@/lib/types';
// T-20260522-foot-TABLET-DUAL-LAYOUT: orientation 훅
import { useOrientation } from '@/hooks/useOrientation';


type TabKey = 'all' | 'new' | 'returning';

// ── 동의서 상태 컨텍스트 (카드 배지용) ────────────────────────────────────────
interface ConsentEntry {
  refundAt?: string;
  nonCoveredAt?: string;
}
/** 체크인 ID → 동의서 날짜 맵. DraggableCard에서 useContext로 읽어 배지 표시 */
const ConsentMapCtx = createContext<Map<string, ConsentEntry>>(new Map());

/** 체크인 ID → 체크리스트 완료 여부 맵 (T-20260430-foot-PRESCREEN-CHECKLIST) */
const ChecklistDoneCtx = createContext<Set<string>>(new Set());

/** 활성 패키지 보유 고객 customer_id 집합 (잔여>0) (T-20260522-foot-PKG-BOX-INDICATOR) */
const PkgHolderCtx = createContext<Set<string>>(new Set());

/** 활성 패키지 중 포돌로게(podologe_sessions>0) 보유 고객 customer_id 집합 (T-20260623-foot-PKGBOX-PODOLOGE-BADGE) */
const PodologeHolderCtx = createContext<Set<string>>(new Set());

/** ALT(올트) 활성 고객 customer_id 집합 (T-20260522-foot-ALT-BADGE) */
const AltHolderCtx = createContext<Set<string>>(new Set());

/** 고객 customer_id → 미수금 Map (T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN)
 *  소스 = loadCustomerOutstanding(SSOT). DraggableCard·통합시간표 카드가 useContext로 읽어 빨강 '미수' 배지 표시. */
const OutstandingMapCtx = createContext<Map<string, CustomerOutstanding>>(new Map());

/** T-20260522-foot-LASER-TIMER AC-3: 타이머 1분 이하 남은 check_in_id 집합 → amber 깜빡임 */
const TimerAlertCtx = createContext<Set<string>>(new Set());
/** T-20260523-foot-LASER-TIMER AC-3 보강: 만료(0:00 이후) check_in_id 집합 → red 깜빡임 */
const TimerExpiredCtx = createContext<Set<string>>(new Set());

// ── 카드 고객 이름 우클릭/롱프레스 핸들러 컨텍스트 ────────────────────────────
interface CardHandlers {
  onNameContext: (ci: CheckIn, e: React.MouseEvent) => void;
}
const CardHandlersCtx = createContext<CardHandlers | null>(null);

// ── 예약시간 맵 컨텍스트 (reservation_id → reservation_time) ──────────────────
/** DraggableCard에서 useContext로 읽어 CustomerHoverCard에 예약시간 전달 */
const ResvTimeMapCtx = createContext<Map<string, string>>(new Map());

// T-20260522-foot-DRAG-RESP-OPT: 드래그 반응속도 최적화 — TickCtx
// 역할: DraggableCard가 타이머 틱(10s)으로만 시간 표시를 갱신하고,
//        드래그 상태 변경(setDragging) 시에는 불필요한 re-render를 건너뛰도록 분리.
// - React.memo는 부모 re-render를 막지만 Context 구독은 memo를 우회함.
// - setDragging → tick 변경 없 → TickCtx 변경 없 → 카드 body 실행 생략
// - setTick(v+1) → TickCtx 값 변경 → 카드 body 실행(elapsedMMSS 갱신) ✓
const TickCtx = createContext(0);

// T-20260522-foot-SLOT-SNAP-FIX: S Pen 태블릿 drag ghost ↔ 실제 터치 포인트 정렬 보정
// DragOverlay가 드래그 노드 중심에서 시작하도록 activatorEvent 좌표 기반으로 transform 보정.
// @dnd-kit/modifiers 없이 getEventCoordinates (@dnd-kit/utilities 내장) 만으로 구현.
function snapToCursorModifier({
  activatorEvent,
  draggingNodeRect,
  transform,
}: {
  activatorEvent: Event | null;
  draggingNodeRect: { left: number; top: number; width: number; height: number } | null;
  transform: { x: number; y: number; scaleX: number; scaleY: number };
  [key: string]: unknown;
}) {
  if (draggingNodeRect && activatorEvent) {
    const coords = getEventCoordinates(activatorEvent as MouseEvent | TouchEvent);
    if (coords) {
      return {
        ...transform,
        x: transform.x + coords.x - draggingNodeRect.left - draggingNodeRect.width / 2,
        y: transform.y + coords.y - draggingNodeRect.top - draggingNodeRect.height / 2,
      };
    }
  }
  return transform;
}

// ── 차트번호 맵 컨텍스트 (customer_id → chart_number) ─────────────────────────
/** T-20260514-foot-CHART-NO-VISIBLE: 칸반·타임라인 카드 차트번호 상시 표시 (AC-1) */
const ChartNumberMapCtx = createContext<Map<string, string>>(new Map());

// ── 본인 staff id 컨텍스트 (A안: "내 담당" 배지) ──────────────────────────────
/** T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (A안): 로그인 사용자의 staff.id.
 *  카드의 consultant_id/therapist_id 가 이 값과 같으면 본인 담당 → "내 담당" 배지.
 *  role 무관(staff.user_id = profile.id 매칭) — 상담사/치료사 전 역할 커버. */
const MyStaffIdCtx = createContext<string | null>(null);

interface RoomAssignment {
  id: string;
  clinic_id: string;
  date: string;
  room_name: string;
  room_type: string;
  staff_id: string | null;
  staff_name: string | null;
}

interface PackageLabel {
  name: string;
  remaining: number;
  total: number;
  used: number;
}

// T-20260617-foot-PKGBOX-USED-FORMAT: 고객박스 패키지 표기를 "잔여/총"(예 12/12 — 다 쓴 것처럼 오인)
//   에서 "회차 번호"(N = used+1 = 오늘 회차)로 변경. 신규(used=0)=1회차, 6회 사용=7회차.
//   엣지: 전부 소진(used>=total)은 N=total+1(13회차) 방지 위해 "완료" 가드.
//   두 렌더 지점(L497·L683)이 이 단일 함수를 공유 → 표기 불일치 차단(AC-2).
function formatPkgLabel(p: PackageLabel): string {
  if (p.used >= p.total) return `${p.name} 완료 (${p.total}회)`;
  return `${p.name} ${p.used + 1}회차 / ${p.total}회`;
}

// T-20260618-foot-THERAPYWAIT-PKGSESSION-COMPACT: 치료대기 슬롯 카드 전용 간소 표기.
//   formatPkgLabel("N회차 / M회") 의 "회차"·"회" 라벨만 제거 → "N/M". N·M 값은 동일(used+1, total).
//   ⚠ 고객박스/그 외 칸반 슬롯은 formatPkgLabel(회차/회) 유지 — 본 함수는 치료대기 컬럼에서만 호출(AC-3 회귀 가드).
function formatPkgLabelCompact(p: PackageLabel): string {
  if (p.used >= p.total) return `${p.name} 완료 (${p.total})`;
  return `${p.name} ${p.used + 1}/${p.total}`;
}

// pointerWithin 우선, 없으면 closestCenter 폴백 — 방(room) 드롭 정확도 향상
const customCollision: CollisionDetection = (args) => {
  const pw = pointerWithin(args);
  if (pw.length > 0) {
    // room: 접두사가 있으면 최우선
    const roomHit = pw.find((c) => String(c.id).startsWith('room:'));
    if (roomHit) return [roomHit];
    return pw;
  }
  return closestCenter(args);
};

// ── 칸반 그룹 순서 정의 ────────────────────────────────────────────────────────
// T-20260508-foot-DASH-SLOT-REMOVE: new_queue, returning_queue 완전 삭제
// → 초진/재진 고객은 통합시간표에서 관리
// T-20260511-foot-DASH-BATCH-INDIVIDUAL: waiting_columns → 3개 독립 그룹 ID로 분리
// (치료대기·레이저대기·힐러대기 각각 배치편집 모드에서 개별 이동 가능)
// T-20260511-foot-DASH-BATCH-INDIVIDUAL v2: laser_rooms 는 항상 마지막 — 드래그로 뒤에 위치하면 자동 교정
// T-20260602-foot-CHECKIN-RECEIVING-SLOT AC-5: receiving_col 은 항상 맨 앞.
// 저장된 순서에 없으면 맨 앞에 주입, 있으면 맨 앞으로 끌어올림.
function ensureReceivingFirst(order: KanbanGroupId[]): KanbanGroupId[] {
  const rest = order.filter((id) => id !== 'receiving_col');
  return ['receiving_col', ...rest] as KanbanGroupId[];
}

function ensureLaserRoomsLast(order: KanbanGroupId[]): KanbanGroupId[] {
  const lrIdx = order.indexOf('laser_rooms');
  if (lrIdx === -1 || lrIdx === order.length - 1) return order;
  // laser_rooms 이후에 있는 항목들을 laser_rooms 앞으로 이동
  const before = order.slice(0, lrIdx);
  const after = order.slice(lrIdx + 1);
  return [...before, ...after, 'laser_rooms'] as KanbanGroupId[];
}

const DEFAULT_GROUP_ORDER = [
  // T-20260602-foot-CHECKIN-RECEIVING-SLOT AC-5: [접수중]은 항상 맨 앞 (ensureReceivingFirst로 강제)
  'receiving_col',
  'exam_section',
  'consult_waiting_col',
  'consult_rooms',
  'treatment_waiting_col',
  'laser_waiting_col',
  'healer_waiting_col',
  'treatment_rooms',
  'desk_section',
  'laser_rooms',
] as const;

type KanbanGroupId = (typeof DEFAULT_GROUP_ORDER)[number];

const KANBAN_GROUP_LABELS: Record<KanbanGroupId, string> = {
  receiving_col: '접수중',
  exam_section: '진료',
  consult_waiting_col: '상담대기',
  consult_rooms: '상담실',
  treatment_waiting_col: '치료대기',
  laser_waiting_col: '레이저대기',
  healer_waiting_col: '힐러대기',
  treatment_rooms: '치료실',
  desk_section: '데스크',
  laser_rooms: '레이저실',
};

// T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY: 대시보드 슬롯 높이 통일 기준.
//   모든 슬롯(치료대기·치료실·레이저실·수납대기·완료 + 비대상 stretch 슬롯) 컨테이너 높이를
//   이 '빈 상태 기준' 고정값으로 묶는다. 카드(고객박스)가 추가돼도 컨테이너 세로 성장 금지 → 내부 overflow-y:auto.
//
//   ── REOPEN/h2c8 기준값 변경 (김주연 총괄, ts 1781570110.451759) ──────────────────────
//   기존 calc(100vh - 200px)(= 뷰포트 꽉 채움, 800px 기준 600px)이 "상담실 제외하고 다 쓸데없이 길어짐".
//   상담실([상담실] 슬롯)은 fixed height 가 아니라 자연 콘텐츠 높이(헤더+룸 그리드, 실측 ~411px,
//   뷰포트 비의존)로 컴팩트하게 보이는데 나머지 bordered 슬롯만 600px 로 길었던 게 원인.
//   → 기준을 뷰포트 기반 calc → 상담실 자연 높이에 맞춘 420px 로 변경.
//   상담실은 viewport-independent(콘텐츠 결정)라 px 값이 화면 크기와 무관하게 상담실/상담대기와 정렬된다.
//
// T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY (REVERSAL 2026-06-17, scope② 4슬롯 통일):
//   김주연 총괄 원의도 재명시 — 고정 height + 내부 스크롤(c21eaa43)은 정반대였음.
//   신 스펙: 이 값을 "빈 상태 baseline = [상담대기] 칸 기준 최소 높이"(min-height)로 사용한다.
//   · 빈 상태: 모든 슬롯 minHeight = SLOT_COLUMN_HEIGHT → 세로 동일(AC-NEW-1).
//   · 카드 추가: 슬롯 칸이 콘텐츠만큼 자연 성장(고정값/내부 스크롤 X, AC-NEW-2/3).
//   · 형제 비연동: 부모 행 align-items:stretch → items-start 로 전환(한 슬롯 성장이 형제를
//     끌어올리지 않음). 각 슬롯이 자기 minHeight floor 위에서 독립 성장.
const SLOT_COLUMN_HEIGHT = '420px';

// T-20260622-foot-DASH-PAYMENT-WAITING-EMPTY-HEIGHT: 수납대기 scoped override(PAYMENT_WAITING_COLUMN_HEIGHT,
//   T-20260620 도입 max(560px,calc(100vh-170px)))는 빈 상태 과성장 회귀를 유발해 제거. 수납대기도 SLOT_COLUMN_HEIGHT(420px)
//   floor 로 통일 복귀 → 전 슬롯 빈 상태 동일 높이. naturalGrow 로 카드 추가 시 자연 성장은 유지.

// ── 그룹 정렬 핸들용 SortableGroupItem ────────────────────────────────────────
function SortableGroupItem({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        position: 'relative',
        zIndex: isDragging ? 50 : undefined,
      }}
    >
      {/* 드래그 핸들 (편집 모드 상단 배너) */}
      <div
        {...attributes}
        {...listeners}
        className="mb-1 cursor-grab active:cursor-grabbing flex items-center justify-center gap-1 rounded-lg border border-dashed border-teal-400 bg-teal-50/60 px-2 py-1 text-xs font-semibold text-teal-700 select-none hover:bg-teal-100/60 transition"
        title={`${label} — 드래그하여 순서 변경`}
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      {children}
    </div>
  );
}

const DROP_STATUS_FOR_ROOM: Record<string, CheckInStatus> = {
  examination: 'examination',
  consultation: 'consultation',
  treatment: 'preconditioning',
  laser: 'laser',
  // T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 제거 → heated_laser DnD 매핑 삭제
};

const ROOM_FIELD_MAP: Record<string, RoomFieldKey> = {
  examination: 'examination_room',
  consultation: 'consultation_room',
  treatment: 'treatment_room',
  laser: 'laser_room',
  // T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 제거 → heated_laser DnD 매핑 삭제
};

// T-20260614-foot-SLOT-CRUD-ALLTYPES: 슬롯 추가/삭제 대상 타입 라벨 (다이얼로그·버튼 표기)
const SLOT_TYPE_KO: Record<string, string> = {
  examination: '진료',
  consultation: '상담',
  treatment: '치료',
  laser: '레이저',
};

// T-20260522-foot-DRAG-RESP-OPT: React.memo + 커스텀 비교자
// 비교 대상: checkIn(동일 ref 여부) · compact · stageStart · packageLabel
// 의도적 제외: onClick / onContextMenu — 인라인 클로저라 매 render마다 새 ref지만
//   내부 handleCardClick/handleCardContext가 useCallback 안정적이므로 동작 동일.
// 효과: setDragging(card) 시 Dashboard 전체 re-render → 이 memo가 비(非)드래그 카드 생략
//       → drag start 첫 프레임에서 카드 body 재실행 0회 → 체감 반응속도 개선.
const DraggableCard = memo(function DraggableCard({
  checkIn,
  compact,
  stageStart,
  packageLabel,
  pkgLabelCompact,
  onClick,
  onContextMenu,
}: {
  checkIn: CheckIn;
  compact?: boolean;
  stageStart?: string;
  packageLabel?: PackageLabel | null;
  // T-20260618-foot-THERAPYWAIT-PKGSESSION-COMPACT: true면 패키지 카운터를 "N/M"(라벨 제거)로 표기. 치료대기 슬롯 전용.
  pkgLabelCompact?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  // TickCtx 구독: 타이머 틱(10s)이 바뀌면 이 카드도 re-render → elapsedMMSS 갱신
  // memo 비교자는 tick을 prop으로 받지 않으므로 부모 re-render에는 무반응
  useContext(TickCtx);
  const consentMap = useContext(ConsentMapCtx);
  const consentEntry = consentMap.get(checkIn.id);
  const checklistDoneSet = useContext(ChecklistDoneCtx);
  const isChecklistDone = checklistDoneSet.has(checkIn.id);
  const cardHandlers = useContext(CardHandlersCtx);
  const resvTimeMap = useContext(ResvTimeMapCtx);
  const reservationTime = checkIn.reservation_id ? (resvTimeMap.get(checkIn.reservation_id) ?? null) : null;
  // T-20260514-foot-CHART-NO-VISIBLE: AC-1 차트번호 상시 표시
  const chartNumberMap = useContext(ChartNumberMapCtx);
  const chartNum = checkIn.customer_id ? chartNumberMap.get(checkIn.customer_id) : undefined;
  // T-20260522-foot-PKG-BOX-INDICATOR: 활성 패키지 보유 여부
  const pkgHolderSet = useContext(PkgHolderCtx);
  const hasPkg = !!(checkIn.customer_id && pkgHolderSet.has(checkIn.customer_id));
  // T-20260623-foot-PKGBOX-PODOLOGE-BADGE: 활성 패키지 중 포돌로게(podologe_sessions>0) 보유 여부
  const podologeHolderSet = useContext(PodologeHolderCtx);
  const hasPodologe = !!(checkIn.customer_id && podologeHolderSet.has(checkIn.customer_id));
  // T-20260522-foot-ALT-BADGE: ALT 활성 여부
  const altHolderSet = useContext(AltHolderCtx);
  const isAlt = !!(checkIn.customer_id && altHolderSet.has(checkIn.customer_id));
  // T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 체크인 고객박스 미수 배지
  const outstandingMap = useContext(OutstandingMapCtx);
  const outstandingData = checkIn.customer_id ? outstandingMap.get(checkIn.customer_id) : undefined;
  // T-20260522-foot-LASER-TIMER AC-3 / T-20260523 보강: amber(warn) + red(expire)
  const timerAlertSet = useContext(TimerAlertCtx);
  const timerExpiredSet = useContext(TimerExpiredCtx);
  const isTimerWarn = timerAlertSet.has(checkIn.id);      // 1분 이하, amber
  const isTimerExpired = timerExpiredSet.has(checkIn.id); // 만료, red
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: checkIn.id,
    data: { checkIn },
  });
  const timeRef = stageStart ?? checkIn.checked_in_at;
  const mmss = elapsedMMSS(timeRef);
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.3 : 1,
    // T-20260506-foot-SLOT-VERTICAL-MOVE: 세로 터치 드래그 시 브라우저 스크롤 인터셉트 방지
    touchAction: 'none',
    // T-20260511-foot-DASH-DRAG-PERF: GPU 레이어 승격 힌트 → 드래그 중 합성 레이어 재사용
    willChange: isDragging ? 'transform' : undefined,
  };

  // T-20260507-REMOVE-AUTO-COLOR: 시간 기반 자동 색 변경 완전 삭제. 수동 STATUS-COLOR-FLAG만 사용.
  const flagBg = checkIn.status_flag && checkIn.status_flag !== 'white'
    ? STATUS_FLAG_CARD_BG[checkIn.status_flag]
    : '';

  // T-20260601-foot-DASH-HSCROLL-CHART-LOC #3: 성함 옆 현재 배정 슬롯 이름
  const slotName = getAssignedSlotName(checkIn);

  // T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (A안): 본인 담당 카드 판정 ("내 담당" 배지)
  const myStaffId = useContext(MyStaffIdCtx);
  const isMine = !!myStaffId &&
    (checkIn.consultant_id === myStaffId || checkIn.therapist_id === myStaffId);

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        data-testid="checkin-card"
        data-checkin-id={checkIn.id}
        data-checkin-status={checkIn.status}
        data-checkin-visit-type={checkIn.visit_type}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          cardHandlers?.onNameContext(checkIn, e);
        }}
        title="드래그=이동 · 우클릭=고객차트·예약 · ⋮=상태변경 · 클릭=상세"
        className={cn(
          'cursor-grab touch-none rounded border px-1.5 py-1 text-xs shadow-sm transition hover:shadow active:cursor-grabbing',
          flagBg || 'bg-white',
          // T-20260523-foot-LASER-TIMER AC-3 보강: amber(warn) → red(expire) 2단계
          isTimerExpired ? 'laser-timer-expire'
            : isTimerWarn ? 'laser-timer-warn'
            : '',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 truncate">
            <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <CustomerHoverCard
              checkIn={checkIn}
              reservationTime={reservationTime}
              compact
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                cardHandlers?.onNameContext(checkIn, e);
              }}
            />
            {/* T-20260601-foot-DASH-HSCROLL-CHART-LOC #3: 성함 옆 현재 배정 슬롯 이름 */}
            {slotName && (
              <span
                data-testid="card-location-badge"
                className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded px-1 py-px whitespace-nowrap"
                title={`현재 위치: ${slotName}`}
              >
                <MapPin className="h-2 w-2" />
                {slotName}
              </span>
            )}
            {/* T-20260514-foot-CHART-NO-VISIBLE: AC-1 차트번호 상시 표시
                T-20260612-foot-CHARTNO-B2-P1: 미발번도 '#미발번' 명시 — 환자명 단독 노출 0(AC2). 조건부 → always-on. */}
            <span className="text-[10px] font-mono text-teal-600 shrink-0" data-testid="waiting-card-chartno">
              {chartNoBadge(chartNum ?? null)}
            </span>
            {checkIn.queue_number != null && (
              <span className="text-[10px] text-teal-600 shrink-0">#{checkIn.queue_number}</span>
            )}
          </div>
          <div className="flex items-center shrink-0">
            {/* 태블릿 터치 영역: min-w/h-[32px] V2 — T-20260512-foot-CUSTOMER-BOX-COMPACT-V2 */}
            <button
              data-testid="card-status-menu-btn"
              className="p-1 rounded hover:bg-gray-100 active:bg-gray-200 transition min-w-[32px] min-h-[32px] flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const syntheticEvent = { preventDefault: () => {}, stopPropagation: () => {}, clientX: rect.right, clientY: rect.bottom } as React.MouseEvent;
                onContextMenu?.(syntheticEvent);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="상태 변경"
            >
              <MoreVertical className="h-3 w-3 text-gray-500" />
            </button>
          </div>
        </div>
        {packageLabel && (
          <div data-testid="pkg-session-label" className="mt-0.5 text-xs text-violet-600 font-medium truncate">
            {pkgLabelCompact ? formatPkgLabelCompact(packageLabel) : formatPkgLabel(packageLabel)}
          </div>
        )}
        {/* 체크리스트 완료 배지 (T-20260430-foot-PRESCREEN-CHECKLIST) */}
        {isChecklistDone && (
          <div
            data-testid="checklist-done-badge"
            className="mt-0.5 text-[10px] text-teal-600 truncate"
          >
            📋 체크리스트 완료
          </div>
        )}
        {/* 동의서 서명 배지 (compact) */}
        {consentEntry?.refundAt && (
          <div
            data-testid="consent-badge-refund"
            className="mt-0.5 text-[10px] text-emerald-600 truncate"
          >
            ✓ 환불동의서 ({format(new Date(consentEntry.refundAt), 'M/d')})
          </div>
        )}
        {/* T-20260512-foot-CUSTOMER-BOX-COMPACT-V2: 시간행 text-[10px] 축소, Clock h-2 */}
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="tabular-nums font-mono text-muted-foreground">
            <Clock className="inline h-2 w-2 mr-0.5" />
            {mmss}
          </span>
          <div className="flex items-center gap-0.5">
            {/* T-20260502-foot-LASER-TIME-UNIT: 레이저실 카드에 시간 단위 배지 */}
            {checkIn.status === 'laser' && checkIn.laser_minutes != null && (
              <Badge className="h-3.5 px-0.5 text-[9px] bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
                {checkIn.laser_minutes}분
              </Badge>
            )}
            {/* T-20260516-foot-CONSULT-KANBAN-MISS AC-7: 상담실 실번호 카드 표시 */}
            {checkIn.status === 'consultation' && checkIn.consultation_room && (
              <Badge
                data-testid="consultation-room-badge"
                className="h-3.5 px-0.5 text-[9px] bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
              >
                {checkIn.consultation_room}
              </Badge>
            )}
            {checkIn.notes?.id_check_required && (
              <Badge variant="destructive" className="h-3.5 px-0.5 text-[9px]">신분증</Badge>
            )}
            {/* T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-8: 주민번호 매칭 미완료 데스크 알림 */}
            {checkIn.notes?.rrn_match_pending && (
              <Badge
                data-testid="rrn-match-pending-badge"
                className="h-3.5 px-0.5 text-[9px] bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100"
              >
                주번확인
              </Badge>
            )}
            {checkIn.priority_flag && (
              <Badge variant="destructive" className="h-3.5 px-0.5 text-[9px]">
                {checkIn.priority_flag}
              </Badge>
            )}
          </div>
        </div>
        {/* T-20260506-foot-SLOT-LAYOUT-REBUILD: 초진 딱지 → 연한노랑, 재진 → 없음 */}
        {/* T-20260522-foot-PKG-BOX-INDICATOR: 패키지 보유 배지 + 초진 딱지 동시 표시 가능 */}
        {/* T-20260522-foot-ALT-BADGE: ALT 배지 (메탈릭 실버) */}
        <div className="mt-0.5 flex items-center gap-0.5 flex-wrap">
          {/* T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (A안): 본인 담당 카드 "내 담당" 배지(파랑) */}
          {isMine && (
            <span
              data-testid="my-assignment-badge"
              className="inline-flex items-center bg-blue-500 text-white text-[9px] px-1 py-px rounded font-semibold"
            >
              내 담당
            </span>
          )}
          {checkIn.visit_type === 'new' && (
            <span className="bg-blue-100 text-blue-800 text-[9px] px-0.5 py-px rounded font-medium">초진</span>
          )}
          {/* T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 체크인 고객박스 미수 배지 (결제완료 시 자동 삭제) */}
          <OutstandingDueBadge data={outstandingData} />
          {hasPkg && (
            <span
              data-testid="pkg-holder-badge"
              className="inline-flex items-center gap-0.5 bg-violet-100 text-violet-700 text-[9px] px-0.5 py-px rounded font-medium"
            >
              <Package className="h-2 w-2" />
              패키지
            </span>
          )}
          {/* T-20260623-foot-PKGBOX-PODOLOGE-BADGE: 포돌로게 회차 보유 식별 배지 */}
          {hasPodologe && (
            <span
              data-testid="podologe-holder-badge"
              className="inline-flex items-center bg-pink-100 text-pink-700 text-[9px] px-0.5 py-px rounded font-bold"
            >
              PD
            </span>
          )}
          {isAlt && (
            <span
              data-testid="alt-badge"
              className="text-[9px] px-0.5 py-px rounded font-bold tracking-wide"
              style={{
                background: 'linear-gradient(135deg, #c8c8c8 0%, #e8e8e8 40%, #b0b0b0 60%, #d4d4d4 100%)',
                color: '#2a2a2a',
                border: '1px solid #a0a0a0',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6)',
              }}
            >
              ALT
            </span>
          )}
        </div>
      </div>
    );
  }

  // T-20260506-foot-CUSTOMER-BOX-COMPACT: 비-compact 카드 크기 30~40% 축소
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid="checkin-card"
      data-checkin-id={checkIn.id}
      data-checkin-status={checkIn.status}
      data-checkin-visit-type={checkIn.visit_type}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cardHandlers?.onNameContext(checkIn, e);
      }}
      title="드래그=이동 · 우클릭=고객차트·예약 · ⋮=상태변경 · 클릭=상세"
      className={cn(
        'cursor-grab touch-none rounded border p-1 shadow-sm transition hover:shadow active:cursor-grabbing',
        flagBg || 'bg-white',
        // T-20260523-foot-LASER-TIMER AC-3 보강: amber(warn) → red(expire) 2단계
        isTimerExpired ? 'laser-timer-expire'
          : isTimerWarn ? 'laser-timer-warn'
          : '',
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 truncate">
          <GripVertical className="h-3 w-3 text-gray-400 shrink-0" />
          {/* compact=true で名前フォントを text-sm に縮小 */}
          <CustomerHoverCard
            checkIn={checkIn}
            reservationTime={reservationTime}
            compact
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cardHandlers?.onNameContext(checkIn, e);
            }}
          />
          {/* T-20260601-foot-DASH-HSCROLL-CHART-LOC #3: 성함 옆 현재 배정 슬롯 이름 */}
          {slotName && (
            <span
              data-testid="card-location-badge"
              className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded px-1 py-px whitespace-nowrap"
              title={`현재 위치: ${slotName}`}
            >
              <MapPin className="h-2.5 w-2.5" />
              {slotName}
            </span>
          )}
          {/* T-20260514-foot-CHART-NO-VISIBLE: AC-1 차트번호 상시 표시
              T-20260612-foot-CHARTNO-B2-P1: 미발번도 '#미발번' 명시 — 환자명 단독 노출 0(AC2). 조건부 → always-on. */}
          <span className="text-[10px] font-mono text-teal-600 shrink-0" data-testid="waiting-card-chartno">
            {chartNoBadge(chartNum ?? null)}
          </span>
          {checkIn.queue_number != null && (
            <span className="text-[10px] text-teal-600 shrink-0">#{checkIn.queue_number}</span>
          )}
          {checkIn.customer_phone && (
            <span className="text-[10px] text-muted-foreground truncate">
              ···{maskPhoneTail(checkIn.customer_phone)}
            </span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          {/* 태블릿 터치 영역 유지 (min-w/h 32px V2) — T-20260512-foot-CUSTOMER-BOX-COMPACT-V2 */}
          <button
            data-testid="card-status-menu-btn"
            className="rounded hover:bg-gray-100 active:bg-gray-200 transition min-w-[32px] min-h-[32px] flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const syntheticEvent = { preventDefault: () => {}, stopPropagation: () => {}, clientX: rect.right, clientY: rect.bottom } as React.MouseEvent;
              onContextMenu?.(syntheticEvent);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="상태 변경"
          >
            <MoreVertical className="h-3 w-3 text-gray-400" />
          </button>
        </div>
      </div>
      {packageLabel && (
        <div data-testid="pkg-session-label" className="mt-0.5 text-[10px] text-violet-600 font-medium truncate">
          {pkgLabelCompact ? formatPkgLabelCompact(packageLabel) : formatPkgLabel(packageLabel)}
        </div>
      )}
      {/* 동의서 서명 배지 */}
      {consentEntry?.refundAt && (
        <div
          data-testid="consent-badge-refund"
          className="mt-0.5 text-[10px] text-emerald-600 truncate"
        >
          ✓ 환불동의서 ({format(new Date(consentEntry.refundAt), 'M/d')})
          {consentEntry.nonCoveredAt && (
            <span className="ml-1">· 비급여확인</span>
          )}
        </div>
      )}
      {/* 경과 시간 + 현진행단계 — T-20260512-foot-CUSTOMER-BOX-COMPACT-V2: text-[9px] 추가 축소 */}
      <div className="mt-0.5 flex items-center justify-between text-[9px]">
        <span className="text-muted-foreground tabular-nums font-mono">
          {mmss} {stageStart ? STATUS_KO[checkIn.status] ?? '경과' : '대기'}
        </span>
        <div className="flex items-center gap-0.5">
          {checkIn.notes?.id_check_required && (
            <Badge variant="destructive" className="h-3.5 px-0.5 text-[9px]">신분증</Badge>
          )}
          {/* T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-8: 주민번호 매칭 미완료 데스크 알림 */}
          {checkIn.notes?.rrn_match_pending && (
            <Badge
              data-testid="rrn-match-pending-badge"
              className="h-3.5 px-0.5 text-[9px] bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100"
            >
              주번확인
            </Badge>
          )}
          {checkIn.priority_flag && <Badge variant="destructive" className="h-3.5 px-0.5 text-[9px]">우선</Badge>}
        </div>
      </div>
      {/* T-20260513-foot-VISITTYPE-SIMPLIFY: 초진 딱지, 재진 → 없음 */}
      {/* T-20260522-foot-PKG-BOX-INDICATOR: 패키지 보유 배지 + 초진 딱지 나란히 */}
      {/* T-20260522-foot-ALT-BADGE: ALT 배지 (메탈릭 실버) */}
      <div className="mt-0.5 flex items-center gap-0.5 flex-wrap">
        {/* T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (A안): 본인 담당 카드 "내 담당" 배지(파랑) */}
        {isMine && (
          <span
            data-testid="my-assignment-badge"
            className="inline-flex items-center bg-blue-500 text-white text-[9px] px-1 py-px rounded font-semibold"
          >
            내 담당
          </span>
        )}
        {checkIn.visit_type === 'new' && (
          <span className="bg-yellow-100 text-yellow-800 text-[9px] px-0.5 py-px rounded font-medium">초진</span>
        )}
        {/* T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 체크인 고객박스 미수 배지 (결제완료 시 자동 삭제) */}
        <OutstandingDueBadge data={outstandingData} />
        {hasPkg && (
          <span
            data-testid="pkg-holder-badge"
            className="inline-flex items-center gap-0.5 bg-violet-100 text-violet-700 text-[9px] px-0.5 py-px rounded font-medium"
          >
            <Package className="h-2 w-2" />
            패키지
          </span>
        )}
        {/* T-20260623-foot-PKGBOX-PODOLOGE-BADGE: 포돌로게 회차 보유 식별 배지 */}
        {hasPodologe && (
          <span
            data-testid="podologe-holder-badge"
            className="inline-flex items-center bg-pink-100 text-pink-700 text-[9px] px-0.5 py-px rounded font-bold"
          >
            PD
          </span>
        )}
        {isAlt && (
          <span
            data-testid="alt-badge"
            className="text-[9px] px-0.5 py-px rounded font-bold tracking-wide"
            style={{
              background: 'linear-gradient(135deg, #c8c8c8 0%, #e8e8e8 40%, #b0b0b0 60%, #d4d4d4 100%)',
              color: '#2a2a2a',
              border: '1px solid #a0a0a0',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6)',
            }}
          >
            ALT
          </span>
        )}
      </div>
    </div>
  );
// T-20260522-foot-DRAG-RESP-OPT: memo 비교자 — data props만 비교, 핸들러 제외
}, (prev, next) =>
  prev.checkIn === next.checkIn &&
  prev.compact === next.compact &&
  prev.stageStart === next.stageStart &&
  prev.packageLabel === next.packageLabel &&
  prev.pkgLabelCompact === next.pkgLabelCompact
);

// T-20260623-foot-DASH-DONESLOT-BATCHEDIT-MOVE-REGRESSION: 완료 슬롯 칩 draggable 복구.
//   78167b2b(DASH-DONESLOT-NAMECHIP-COMPACT)에서 완료 카드를 성함칩 plain <button>으로 바꾸며
//   useDraggable 이 빠져 완료 환자를 다른 슬롯(치료대기·수납대기 등)으로 드래그 이동할 수 없게 된
//   회귀를 수정한다. 칩 비주얼(성함만·회색·초소형)과 정시그룹/우측단독 컬럼 레이아웃은 그대로 두고
//   useDraggable(data:{checkIn})만 재부착 → 기존 handleDragEnd 가 그대로 status/room 이동을 처리.
//   클릭(상세) vs 드래그 구분은 상위 DndContext sensors 의 distance(mouse 3 / touch 5px) constraint 가
//   담당하므로 onClick(handleCardClick)·onContextMenu 와 드래그가 충돌 없이 공존한다.
const DraggableDoneChip = memo(function DraggableDoneChip({
  checkIn,
  onClick,
  onContextMenu,
}: {
  checkIn: CheckIn;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: checkIn.id,
    data: { checkIn },
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.3 : 1,
    touchAction: 'none',
    willChange: isDragging ? 'transform' : undefined,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      data-testid="done-name-chip"
      data-checkin-id={checkIn.id}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e); }}
      title={`${checkIn.customer_name} · 드래그=이동`}
      className="max-w-[5.5rem] cursor-grab touch-none truncate rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700 hover:bg-gray-100 transition active:cursor-grabbing"
    >
      {checkIn.customer_name}
    </button>
  );
}, (prev, next) => prev.checkIn === next.checkIn);

function DroppableColumn({
  id,
  label,
  count,
  children,
  className,
  highlight,
  subtitle,
  invalidDrop,
  style,
  naturalGrow,
}: {
  id: string;
  label: string;
  count: number;
  children: React.ReactNode;
  className?: string;
  highlight?: string;
  subtitle?: React.ReactNode;
  invalidDrop?: boolean;
  // T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY (REVERSAL/SLOT-HEIGHT-UNIFY):
  //   style  — 외부에서 minHeight(SLOT_COLUMN_HEIGHT) 등 baseline floor 주입용.
  //   naturalGrow — true 면 본문의 고정 내부 스크롤(overflow-y-auto + max-h) 제거 →
  //                 카드 추가 시 컬럼이 콘텐츠만큼 세로로 자연 성장(보드 외곽 스크롤로 처리).
  //                 미지정(기본 false)이면 기존 내부 스크롤 유지 → 비대상 슬롯 동작 불변(AC-R1).
  style?: React.CSSProperties;
  naturalGrow?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-droppable-id={id}
      className={cn(
        'flex flex-col rounded-lg border bg-muted/20 transition-colors',
        isOver && !invalidDrop && 'border-teal-400 bg-teal-50/40',
        isOver && invalidDrop && 'border-red-300 bg-red-50/30 opacity-60',
        className,
      )}
      // T-20260522-foot-DRAG-RESP-OPT AC-3: 드롭 열 헤더·본문 tap delay 제거
      // 내부 draggable 카드는 touch-action:none 인라인 스타일로 자체 오버라이드
      style={{ touchAction: 'manipulation', ...style }}
    >
      <div className="px-2.5 py-1.5 border-b bg-muted/30 rounded-t-lg">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{label}</span>
          <div className="flex items-center gap-1.5">
            {highlight && (
              <span className={cn('text-xs font-medium', highlight)}>{count}</span>
            )}
            {!highlight && (
              <span className="text-xs text-muted-foreground">{count}</span>
            )}
          </div>
        </div>
        {subtitle && <div className="mt-0.5">{subtitle}</div>}
      </div>
      <div
        className={cn(
          'flex-1 p-1.5 space-y-1.5 min-h-[80px]',
          // naturalGrow: 내부 스크롤 캡 제거 → 콘텐츠만큼 컬럼 자연 성장(REVERSAL).
          // 기본(비대상): 기존 내부 스크롤 유지 → 동작 불변(AC-R1).
          !naturalGrow && 'overflow-y-auto max-h-[calc(100vh-220px)]',
        )}
      >
        {children}
      </div>
    </div>
  );
}


// T-20260508-foot-DASH-SLOT-REMOVE: TimeSlotAccordion 삭제
// (new_queue / returning_queue 칸반 열 제거로 더 이상 사용되지 않음)

// T-20260508-foot-DASH-SLOT-REMOVE: ReservationCard 삭제
// (new_queue / returning_queue 칸반 열 제거로 더 이상 사용되지 않음)

function RoomSlot({
  roomName,
  roomType,
  staffName,
  occupants,
  maxOccupancy,
  onCardClick,
  onCardContext,
  getStageStart,
  getPkgLabel,
  therapists,
  currentStaffId,
  onTherapistChange,
  isInactive,
  isMyRoom,
  canToggle,
  onToggle,
}: {
  roomName: string;
  roomType: string;
  staffName?: string | null;
  occupants: CheckIn[];
  maxOccupancy: number;
  onCardClick: (ci: CheckIn) => void;
  onCardContext?: (ci: CheckIn, e: React.MouseEvent) => void;
  getStageStart?: (ci: CheckIn) => string;
  getPkgLabel?: (ci: CheckIn) => PackageLabel | null;
  therapists?: Staff[];
  currentStaffId?: string | null;
  onTherapistChange?: (roomName: string, staffId: string | null, staffName: string | null) => void;
  // T-20260523-foot-ROOM-DISABLE-TOGGLE (AC-6/8/9 3차)
  isInactive?: boolean;
  isMyRoom?: boolean; // AC-9: 내 담당 방 하이라이트
  canToggle?: boolean;
  onToggle?: (target: 'today' | 'tomorrow') => void; // AC-8: 날짜 선택 토글
}) {
  const [showDatePicker, setShowDatePicker] = useState(false); // AC-8: 날짜 선택 팝오버

  const dropId = `room:${roomName}`;
  const isFull = occupants.length >= maxOccupancy;
  const { isOver, setNodeRef } = useDroppable({ id: dropId, data: { roomName, roomType, isFull } });
  const isEmpty = occupants.length === 0;
  // T-20260520-foot-LASER-DROPDOWN: laser 포함 — 장비명 드롭다운 regression 복구
  const showStaffDropdown = (roomType === 'treatment' || roomType === 'examination' || roomType === 'consultation' || roomType === 'laser') && therapists && onTherapistChange;
  const showStaffLabel = roomType !== 'laser' && roomType !== 'treatment' && roomType !== 'examination' && roomType !== 'consultation' && staffName;
  // T-20260520-foot-LASER-C5-COLOR: C5 = 치료실5(원장실) — 공간배정 Staff.tsx isC5와 동일 조건
  const isC5 = roomName === 'C5' && roomType === 'treatment';

  return (
    <div
      ref={setNodeRef}
      data-droppable-id={dropId}
      data-room-name={roomName}
      data-room-type={roomType}
      data-inactive={isInactive ? 'true' : undefined}
      data-my-room={isMyRoom ? 'true' : undefined}
      className={cn(
        'rounded-lg border bg-white/60 p-1.5 min-h-[70px] transition-colors relative',
        isInactive && 'opacity-50 bg-gray-100/60 border-dashed border-gray-300',
        !isInactive && isOver && !isFull && 'border-teal-400 bg-teal-50/50',
        !isInactive && isOver && isFull && 'border-red-400 bg-red-50/30 opacity-60',
        !isInactive && isEmpty && !isOver && 'border-dashed border-gray-200',
        !isInactive && !isEmpty && !isOver && !isFull && 'border-gray-300',
        !isInactive && isFull && !isOver && 'border-red-200',
        // T-20260520-foot-LASER-C5-COLOR: C5 보라색 테두리 (공간배정 border-purple-400 동일, AC-1·AC-3)
        !isInactive && isC5 && !isOver && 'border-2 border-purple-400',
        // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-9: 내 담당 방 teal 좌측 테두리 하이라이트
        !isInactive && isMyRoom && !isC5 && 'border-l-2 border-l-teal-400',
      )}
    >
      <div className="flex items-center justify-between px-1 mb-1 gap-1">
        <span className={cn('text-xs font-semibold shrink-0', isInactive ? 'text-gray-400' : 'text-gray-600')}>
          {roomName}
          {/* T-20260520-foot-LASER-C5-COLOR: C5 원장실 라벨 — Staff.tsx와 동일 (AC-1) */}
          {isC5 && !isInactive && <span className="ml-1 text-[10px] text-purple-600 font-normal">원장실</span>}
          {/* T-20260523-foot-ROOM-DISABLE-TOGGLE AC-9: 내 담당 방 뱃지 */}
          {isMyRoom && !isInactive && <span className="ml-1 text-[9px] text-teal-600 font-normal" title="내 담당 방">내 방</span>}
        </span>
        {/* T-20260523-foot-ROOM-DISABLE-TOGGLE AC-1: 비활성 뱃지 */}
        {/* AC-3: carry-over 여부 — laser/heated_laser는 활성화 전까지 유지 */}
        {isInactive && (() => {
          const isCarryOver = roomType === 'laser' || roomType === 'heated_laser';
          return (
            <span
              className="text-[10px] text-gray-400 flex items-center gap-0.5 shrink-0"
              title={isCarryOver ? '이 방은 다시 활성화할 때까지 비활성 상태가 유지됩니다' : '오늘만 비활성화됩니다'}
            >
              <EyeOff className="h-3 w-3" />
              {isCarryOver ? '비활성(유지)' : '비활성'}
            </span>
          );
        })()}
        {/* T-20260524-foot-DASH-NEXTDAY-OFF-HIDE AC-1: 내일 오프 뱃지 제거 (당일 대시보드 불필요) */}
        {/* T-20260523-foot-ROOM-DISABLE-TOGGLE AC-4: 비활성 방에 기존 예약 존재 시 경고 */}
        {isInactive && occupants.length > 0 && (
          <span className="text-[10px] text-amber-600 font-medium shrink-0" title="비활성 방에 배정된 환자가 있습니다">
            ⚠️ {occupants.length}명
          </span>
        )}
        {!isInactive && showStaffDropdown && (
          <select
            value={currentStaffId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const name = id ? therapists.find((s) => s.id === id)?.name ?? null : null;
              onTherapistChange(roomName, id, name);
            }}
            className="text-xs h-5 border border-gray-200 rounded bg-white/80 px-0.5 max-w-[80px] truncate text-muted-foreground"
          >
            {/* T-20260520-foot-LASER-DROPDOWN: laser는 "장비 선택" placeholder (AC-9) */}
            <option value="">{roomType === 'laser' ? '장비 선택' : '미배정'}</option>
            {therapists.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        {!isInactive && showStaffLabel && (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <User className="h-2.5 w-2.5" />
            {staffName}
          </span>
        )}
        {!isInactive && occupants.length > 0 && (
          <span className={cn(
            'text-[10px] tabular-nums',
            isFull ? 'text-red-600 font-medium' : 'text-muted-foreground',
          )}>
            {occupants.length}/{maxOccupancy}
          </span>
        )}
        {/* T-20260523-foot-ROOM-DISABLE-TOGGLE AC-1/6/7/8: 토글 버튼 */}
        {canToggle && onToggle && (() => {
          const isCarryOver = roomType === 'laser' || roomType === 'heated_laser';
          if (isInactive) {
            // 비활성 상태 → "활성화" 버튼 (오늘만, 날짜 선택 불필요)
            return (
              <button
                onClick={(e) => { e.stopPropagation(); onToggle('today'); }}
                title="방 활성화"
                className="ml-auto shrink-0 rounded px-1 py-0.5 text-[10px] font-medium border border-teal-300 text-teal-600 hover:bg-teal-50 transition"
              >
                활성화
              </button>
            );
          }
          // 활성 상태 → AC-8: 끄기 버튼 클릭 시 날짜 선택 팝오버
          return (
            <div className="relative ml-auto shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); setShowDatePicker((v) => !v); }}
                title={isCarryOver ? '방 비활성화 (활성화 전까지 유지)' : '방 비활성화 (오늘 또는 내일)'}
                className="rounded px-1 py-0.5 text-[10px] font-medium border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition"
                data-toggle-btn={roomName}
              >
                끄기▾
              </button>
              {/* AC-8: 날짜 선택 팝오버 */}
              {showDatePicker && (
                <div
                  className="absolute right-0 top-full mt-0.5 z-50 bg-white border border-gray-200 rounded shadow-md p-1 flex flex-col gap-0.5 min-w-[80px]"
                  data-date-picker={roomName}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowDatePicker(false); onToggle('today'); }}
                    className="text-[10px] px-2 py-1 rounded hover:bg-gray-100 text-left text-gray-700 font-medium"
                  >
                    오늘 끄기
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowDatePicker(false); onToggle('tomorrow'); }}
                    className="text-[10px] px-2 py-1 rounded hover:bg-indigo-50 text-left text-indigo-600 font-medium"
                  >
                    내일 미리 끄기
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
      {/* T-20260523-foot-ROOM-DISABLE-TOGGLE AC-7: 비활성 시 room_type별 안내 메시지 */}
      {isInactive && (
        <div className="px-1 pb-0.5 text-[9px] text-gray-400 leading-tight">
          {(roomType === 'laser' || roomType === 'heated_laser')
            ? '이 방은 다시 활성화할 때까지 비활성 상태가 유지됩니다'
            : '오늘만 비활성화됩니다'}
        </div>
      )}
      <div className={cn('space-y-1', isInactive && 'pointer-events-none')}>
        {occupants.map((ci, i) => (
          <div key={ci.id} style={{ opacity: i === 0 ? 1 : 0.7 }}>
            <DraggableCard checkIn={ci} compact stageStart={getStageStart?.(ci)} packageLabel={getPkgLabel?.(ci)} onClick={() => onCardClick(ci)} onContextMenu={onCardContext ? (e) => onCardContext(ci, e) : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE ─────────────────────────────
// 가열성레이저 드롭 슬롯(구 HeatedLaserDropSlot, T-MQ-20260506) 제거.
// 현장(김주연 총괄) 요청으로 대시보드 슬롯 목록에서 [가열성레이저] 항목 삭제.
// ※ 패키지 결제의 '가열/비가열' 회차 표기(session_type)는 별개 도메인 → 영향 없음.

function RoomSection({
  title,
  color,
  rooms,
  waitingStatus,
  waitingItems,
  roomType,
  checkIns,
  assignments,
  gridCols,
  onCardClick,
  onCardContext,
  getStageStart,
  getPkgLabel,
  therapists,
  onTherapistChange,
  inactiveRooms,
  myAssignedRoomNames,
  canToggle,
  onToggleRoom,
  // T-20260614-foot-SLOT-CRUD-ALLTYPES: 전 슬롯타입 추가/삭제 배치편집 오버레이
  batchEditMode,
  isToday,
  defaultRoomIds,
  onAddSlot,
  onDeleteSlot,
  // T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY: true면 부모가 준 고정 높이를 채우고 방 그리드는 내부 스크롤.
  fillHeight,
}: {
  title: string;
  color: string;
  rooms: Room[];
  waitingStatus?: CheckInStatus;
  waitingItems?: CheckIn[];
  roomType: string;
  checkIns: CheckIn[];
  assignments: RoomAssignment[];
  gridCols: string;
  onCardClick: (ci: CheckIn) => void;
  onCardContext?: (ci: CheckIn, e: React.MouseEvent) => void;
  getStageStart?: (ci: CheckIn) => string;
  getPkgLabel?: (ci: CheckIn) => PackageLabel | null;
  therapists?: Staff[];
  onTherapistChange?: (roomName: string, staffId: string | null, staffName: string | null) => void;
  // T-20260523-foot-ROOM-DISABLE-TOGGLE (AC-3 분기: roomType 전달)
  // T-20260524-foot-ROOM-NEXTDAY-STAFF AC-4: boolean(전체) 또는 per-room 함수 모두 허용
  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-6/8/9 (3차): 내일치 + 담당방 props
  inactiveRooms?: Set<string>;
  myAssignedRoomNames?: Set<string>; // AC-6/9: staff 담당 방 강조
  canToggle?: boolean | ((roomName: string) => boolean);
  onToggleRoom?: (roomName: string, roomType: string, target: 'today' | 'tomorrow') => void;
  // T-20260614-foot-SLOT-CRUD-ALLTYPES
  batchEditMode?: boolean;
  isToday?: boolean;
  defaultRoomIds?: Set<string>;
  onAddSlot?: (roomType: string) => void;
  onDeleteSlot?: (roomType: string, roomId: string, roomName: string) => void;
  fillHeight?: boolean; // T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY
}) {
  const getRoomOccupants = (roomName: string): CheckIn[] => {
    const field = ROOM_FIELD_MAP[roomType];
    const expectedStatus = DROP_STATUS_FOR_ROOM[roomType];
    return checkIns.filter((ci) => ci[field] === roomName && ci.status === expectedStatus);
  };

  const getStaff = (roomName: string): string | null => {
    const a = assignments.find((r) => r.room_name === roomName);
    return a?.staff_name ?? null;
  };

  const getStaffId = (roomName: string): string | null => {
    const a = assignments.find((r) => r.room_name === roomName);
    return a?.staff_id ?? null;
  };

  const showBatchEdit = !!(batchEditMode && isToday); // T-20260614-foot-SLOT-CRUD-ALLTYPES
  return (
    // T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY (REVERSAL): fillHeight면 부모(minHeight floor) flex-col 안에서
    //   grow(=flex:1 0 auto, basis auto)로 baseline 420 을 채우되, bed 콘텐츠가 baseline 을 넘으면 그만큼
    //   자연 성장한다(shrink-0 → 콘텐츠 밑으로 안 줄어듦). 부모가 fixed→minHeight 로 바뀌어 h-full(100% of auto)은
    //   붕괴하므로 grow 채택. (flex-1=basis0 은 420 에 캡돼 성장 불가 → AC-NEW-3 위배라 부적합.)
    <div className={cn('flex flex-col', fillHeight && 'grow shrink-0')}>
      <div className={cn('flex items-center text-xs font-bold px-2 py-1 rounded-t-lg', color)}>
        {title}
        <span className="ml-1.5 font-normal opacity-70">
          ({rooms.length}실)
        </span>
        {/* T-20260614-foot-SLOT-CRUD-ALLTYPES: AC-1 전 슬롯타입 "+" 추가 (오늘·편집모드만) */}
        {showBatchEdit && onAddSlot && (
          <button
            data-testid={`add-slot-btn-${roomType}`}
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-white hover:bg-neutral-900"
            title="슬롯 추가"
            onClick={() => onAddSlot(roomType)}
          >+ 추가</button>
        )}
      </div>
      {waitingStatus && waitingItems && waitingItems.length > 0 && (
        <DroppableColumn
          id={waitingStatus}
          label={STATUS_KO[waitingStatus]}
          count={waitingItems.length}
          className="rounded-none border-t-0 border-b-0"
        >
          {waitingItems.map((ci) => (
            <DraggableCard
              key={ci.id}
              checkIn={ci}
              compact
              stageStart={getStageStart?.(ci)}
              packageLabel={getPkgLabel?.(ci)}
              onClick={() => onCardClick(ci)}
              onContextMenu={onCardContext ? (e) => onCardContext(ci, e) : undefined}
            />
          ))}
        </DroppableColumn>
      )}
      {/* L-3: 그리드 갭 균일 — RoomSlot 내부(space-y-1)와 동일하게 1.5 유지, 가로/세로 동일 */}
      {/* T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY (REVERSAL): bed-grid 는 grow(basis auto)로 baseline 을
          채우되, content-start 로 bed 셀을 자연 높이(컴팩트)로 상단 정렬한다. content-start 없으면 grid
          align-content 기본 stretch 가 auto 행을 늘려 bed 셀이 비정상적으로 길어짐("보기싫다"의 실체).
          bed 가 baseline 을 넘으면 그리드가 콘텐츠만큼 성장(내부 스크롤 제거 — 보드 외곽 스크롤로 처리, AC-NEW-3).
          shrink-0 으로 콘텐츠 밑으로 줄지 않게 해 성장이 컨테이너로 전파된다. */}
      <div className={cn('grid gap-x-1.5 gap-y-1.5 p-1.5 bg-muted/10 rounded-b-lg border border-t-0', gridCols, fillHeight && 'grow shrink-0 content-start')}>
        {rooms.map((room) => {
          // T-20260614-foot-SLOT-CRUD-ALLTYPES: AC-2/3 기본=잠금, 세션 내 추가=삭제
          const isDefault = defaultRoomIds ? defaultRoomIds.has(room.id) : true;
          const slot = (
            <RoomSlot
              key={room.id}
              roomName={room.name}
              roomType={roomType}
              staffName={getStaff(room.name)}
              occupants={getRoomOccupants(room.name)}
              maxOccupancy={room.max_occupancy}
              onCardClick={onCardClick}
              onCardContext={onCardContext}
              getStageStart={getStageStart}
              getPkgLabel={getPkgLabel}
              therapists={therapists}
              currentStaffId={getStaffId(room.name)}
              onTherapistChange={onTherapistChange}
              isInactive={inactiveRooms?.has(room.name)}
              isMyRoom={myAssignedRoomNames?.has(room.name)}
              canToggle={typeof canToggle === 'function' ? canToggle(room.name) : canToggle}
              onToggle={onToggleRoom ? (target) => onToggleRoom(room.name, roomType, target) : undefined}
            />
          );
          if (!showBatchEdit) return slot;
          return (
            <div key={room.id} className="relative">
              {slot}
              <div className="absolute top-1 right-1 z-10">
                {isDefault ? (
                  <span className="text-[10px] text-gray-400" title="기본 슬롯은 삭제 불가">🔒</span>
                ) : (
                  <button
                    data-testid={`delete-slot-${room.id}`}
                    className="text-[10px] text-red-500 hover:text-red-700 px-1 rounded bg-white/90 border border-red-200 hover:bg-red-50"
                    title="슬롯 삭제"
                    onClick={(e) => { e.stopPropagation(); onDeleteSlot?.(roomType, room.id, room.name); }}
                  >✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── QuickResvDraft 타입 ────────────────────────────────────────────────────────
interface QuickResvDraft {
  date: string;
  time: string;
  name: string;
  phone: string;
  visit_type: VisitType;
  booking_memo: string; // T-20260504-foot-MEMO-RESTRUCTURE: 예약 경로 확인용
}

// ── MiniCalendar ───────────────────────────────────────────────────────────────
function MiniCalendar({
  selected,
  onSelect,
  month,
  onMonthChange,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  month: Date;
  onMonthChange: (d: Date) => void;
}) {
  const today = new Date();
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDow = new Date(year, m, 1).getDay(); // 0=Sun
  const startOffset = firstDow === 0 ? 6 : firstDow - 1; // Mon-first
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, m, d));

  const DOW_KO = ['월', '화', '수', '목', '금', '토', '일'];

  return (
    <div className="bg-white border rounded-xl shadow-lg p-3 w-56">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => onMonthChange(new Date(year, m - 1, 1))}
          className="p-0.5 rounded hover:bg-gray-100 transition"
        >
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <span className="text-xs font-semibold text-gray-800">
          {format(month, 'yyyy년 M월')}
        </span>
        <button
          onClick={() => onMonthChange(new Date(year, m + 1, 1))}
          className="p-0.5 rounded hover:bg-gray-100 transition"
        >
          <ChevronRight className="h-4 w-4 text-gray-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DOW_KO.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-gray-400">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="h-6 w-6" />;
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selected);
          const isSun = d.getDay() === 0;
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              className={cn(
                'rounded text-[11px] h-6 w-6 mx-auto flex items-center justify-center transition font-medium',
                isSelected && 'bg-teal-600 text-white',
                !isSelected && isToday && 'bg-teal-100 text-teal-700 font-semibold',
                !isSelected && !isToday && 'hover:bg-gray-100 text-gray-700',
                isSun && !isSelected && 'text-red-400',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-center">
        <button
          onClick={() => { onSelect(today); onMonthChange(today); }}
          className="text-[11px] text-teal-600 hover:text-teal-800 font-medium"
        >
          오늘로
        </button>
      </div>
    </div>
  );
}

// ── DashboardTimeline (통합 시간표) ───────────────────────────────────────────
// T-20260504-foot-SCHEDULE-UNIFIED-VIEW: 초진/재진 슬롯을 동일 타임라인 내 인라인 표시
// T-20260506-foot-SLOT-LAYOUT-REBUILD: SLOT_MAX 6명으로 확장 (30분당 4~6명 수용)
const SLOT_MAX = 6; // 초진/재진 슬롯 상한 (표시 전용, 차단 없음) — REWORK 이후 미사용, 삭제 금지
void SLOT_MAX; // suppress noUnusedLocals

/**
 * 예약/셀프접수 1건 미니 카드
 * T-20260506-foot-SLOT-LAYOUT-REBUILD:
 *   - 초진 = 파란 배지 / 재진 = 초록 배지 (T-20260513-foot-VISITTYPE-SIMPLIFY: 체험 제거)
 * @deprecated REWORK 이후 미사용 — 삭제 금지 (하위 호환 보존)
 */
// @ts-ignore -- 하위 호환 보존, 삭제 금지
function TimelineCard({
  name,
  visitType,
  dimmed,
  struck,
}: {
  name: string;
  visitType: 'new' | 'returning';
  dimmed?: boolean;
  struck?: boolean;
}) {
  // T-20260509-foot-SLOT-CARD-STYLE: 흰색 큰박스 (다른 슬롯 고객카드와 동일)
  // 컬러는 슬롯메뉴명(시간 헤더)에만 적용 → 카드 자체는 색상 중립
  const showBadge = visitType === 'new';

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs font-medium w-full shadow-sm',
        dimmed && 'opacity-50',
        struck && 'line-through opacity-30',
      )}
      title={name}
    >
      {showBadge && (
        <span className="shrink-0 bg-blue-200 text-blue-900 text-[9px] px-0.5 rounded leading-tight font-bold">초</span>
      )}
      <span className="truncate text-gray-800">{name}</span>
    </div>
  );
}

/**
 * T-20260508-foot-DASH-SLOT-REMOVE: 통합시간표 내 체크인 고객 인터랙티브 카드
 * - useDraggable → 칸반 열로 드래그 이동 가능 (DnD 컨텍스트를 타임라인까지 확장)
 * - onClick → CheckInDetailSheet 열기
 * - 초진(파란)/재진(초록) 2종 배지 (T-20260513-foot-VISITTYPE-SIMPLIFY: 체험 제거)
 */
// T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 배지 (공용)
//   WALKIN 'W' 배지(T-20260530-foot-WALKIN-TIMETABLE, ed79513) 동일 패턴 재사용.
//   --status-noshow CSS 변수(붉은 계열)로 일반 예약과 시각 구분(AC-3).
//   예약 카드(초진/재진)·체크인 카드 3곳에서 공통 사용.
function NoShowBadge() {
  return (
    <span
      className="text-[8px] px-0.5 rounded shrink-0 leading-tight font-bold text-white"
      style={{ backgroundColor: 'var(--status-noshow)' }}
      title="노쇼 (예약 미내원 처리)"
      data-testid="noshow-badge"
    >
      노쇼
    </span>
  );
}

function TimelineCheckInCard({
  checkIn,
  onClick,
  onContextMenu,
  offHourTime,
  isWalkIn,
  isNoShow,
}: {
  checkIn: CheckIn;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** T-20260530-foot-WALKIN-OFFHOUR-SLOT: 영업시간 외 클램핑된 실접수 시각 ('HH:mm'). undefined = 정상 */
  offHourTime?: string;
  /** T-20260530-foot-WALKIN-TIMETABLE: 워크인(예약 없이 당일 접수) 여부 → 'W' 배지 표시 */
  isWalkIn?: boolean;
  /** T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 처리된 예약 매칭 카드 → 노쇼 배지 표시 */
  isNoShow?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: checkIn.id,
    // T-20260515-foot-DASH-SLOT-DRAG: reservationId 추가 → timeslot 드롭 시 reservation_time 업데이트
    data: { checkIn, reservationId: checkIn.reservation_id },
  });

  const visitType = checkIn.visit_type as 'new' | 'returning';
  // T-20260509-foot-SLOT-CARD-STYLE: 흰색 큰박스 — 레이저실·치료실 카드와 동일 스타일
  const showBadge = visitType === 'new';
  // T-20260514-foot-CHART-NO-VISIBLE: AC-1 타임라인 카드 차트번호 상시 표시
  const timelineChartMap = useContext(ChartNumberMapCtx);
  const timelineChartNum = checkIn.customer_id ? timelineChartMap.get(checkIn.customer_id) : undefined;
  // T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 체크인 셀 미수 배지
  const timelineOutstandingMap = useContext(OutstandingMapCtx);
  const timelineOutstanding = checkIn.customer_id ? timelineOutstandingMap.get(checkIn.customer_id) : undefined;

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    // T-20260514-foot-CHECKIN-AUTO-STAGE AC-3: 내원 완료 카드는 CSS opacity-50으로 처리
    // 드래그 중에는 0.3으로 추가 감소, 비드래그 시 undefined로 CSS 클래스에 위임
    // T-20260614-foot-NOSHOW-SLOT-DIM: 노쇼 슬롯은 비드래그 시 흐림(0.55)으로 완화
    opacity: isDragging ? 0.3 : (isNoShow ? 0.55 : undefined),
    touchAction: 'none',
    // T-20260511-foot-DASH-DRAG-PERF: GPU 레이어 승격 힌트
    willChange: isDragging ? 'transform' : undefined,
    // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST AC-3: 노쇼 시각 구분 — 좌측 인셋 바
    // T-20260614-foot-NOSHOW-SLOT-DIM: 붉은 강조색 → muted 톤(--status-noshow-dim)으로 완화
    ...(isNoShow ? { boxShadow: 'inset 3px 0 0 var(--status-noshow-dim)' } : {}),
  };

  // 2번 박스 활성화 스타일: 방문유형 구분 — T-20260615-foot-THEME-MONO-REFINE-3AREA AC1
  // 초진=노랑/재진=초록 의미색(배경 채도) 제거 → 모노톤. 구분은 텍스트(초 배지)+보더 두께로만.
  //   초진 = 흰 배경 + 진한 보더(gray-400), 재진 = 옅은 회색 배경(gray-50) + 옅은 보더(gray-300).
  const box2Cls = visitType === 'returning'
    ? 'border-gray-300 bg-gray-50 hover:bg-gray-100'
    : 'border-gray-400 bg-white hover:bg-gray-100';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        // T-20260514-foot-CHECKIN-AUTO-STAGE AC-3: 내원 완료(체크인 있음) → opacity-50 희미 처리
        // 미내원(예약만) = Box1Card/Box2ReservationCard → 아래 따로 처리 (opacity-100)
        'flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold w-full shadow-sm cursor-grab active:cursor-grabbing transition opacity-50',
        box2Cls,
      )}
      title={`${cardDisplayName(checkIn)} — 드래그=다음단계 이동 · 클릭=상세`}
      data-testid="timeline-checkin-card"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e);
      }}
    >
      {showBadge && (
        <span className="shrink-0 bg-gray-300 text-gray-800 text-[9px] px-0.5 rounded leading-tight font-bold">
          초
        </span>
      )}
      <span className={cn('truncate', visitType === 'returning' ? 'text-gray-800' : 'text-gray-900')}>{cardDisplayName(checkIn)}</span>
      {/* T-20260514-foot-CHART-NO-VISIBLE: 차트번호 상시 표시 */}
      {timelineChartNum && (
        <span className="text-[9px] font-mono text-teal-600 shrink-0">#{timelineChartNum}</span>
      )}
      {/* T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 체크인 셀 미수 배지 */}
      <OutstandingDueBadge data={timelineOutstanding} />
      {/* T-20260530-foot-WALKIN-TIMETABLE: 워크인 배지 (예약 없는 당일 접수) */}
      {isWalkIn && (
        <span
          className="text-[8px] bg-violet-100 text-violet-700 px-0.5 rounded shrink-0 leading-tight font-bold"
          title="워크인 (예약 없이 당일 접수)"
          data-testid="walkin-badge"
        >
          W
        </span>
      )}
      {/* T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 배지 (워크인 'W' 배지와 동시 표시 가능 — AC-4) */}
      {isNoShow && <NoShowBadge />}
      {/* T-20260530-foot-WALKIN-OFFHOUR-SLOT: 영업시간 외 실접수 시각 배지 */}
      {offHourTime && (
        <span
          className="text-[8px] bg-orange-100 text-orange-700 px-0.5 rounded shrink-0 leading-tight"
          title={`실접수 ${offHourTime} (영업시간 외 → 슬롯 자동 배정)`}
        >
          {offHourTime}
        </span>
      )}
      {/* 드래그 힌트 화살표 */}
      <span className="text-[8px] opacity-50 shrink-0 ml-0.5">↗</span>
    </div>
  );
}

// T-20260515-foot-DASH-SLOT-DRAG: 예약시간 슬롯 계산 (module-level, handleDragEnd에서도 사용)
function resvToSlot(time: string | null | undefined): string {
  if (!time) return '00:00';
  const t = time.slice(0, 5);
  const [h, mm] = t.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${mm < 30 ? '00' : '30'}`;
}

// T-20260510-foot-DASH-SLOT-REWORK-P0: 1번 박스 — 초진 예약 (셀프접수 매칭 전, 미내원)
// T-20260514-foot-CHECKIN-AUTO-STAGE AC-3: 미내원 = opacity-100 진하게 (이전 opacity-75 → 제거)
// T-20260515-foot-DASH-SLOT-DRAG: DraggableBox1Card로 교체됨 (하위 호환 보존, 삭제 금지)
// @ts-ignore -- 하위 호환 보존, 삭제 금지
function Box1Card({ name, phone }: { name: string; phone: string }) {
  const tail = (phone ?? '').replace(/\D/g, '').slice(-4) || '????';
  return (
    <div
      className="flex items-center gap-1 rounded border border-gray-400 bg-white px-2 py-1 text-[10px] w-full select-none cursor-default"
      onClick={(e) => e.stopPropagation()}
      title="예약 등록됨 — 아직 미내원 (셀프접수 대기 중)"
    >
      {/* T-20260615-foot-THEME-MONO-REFINE-3AREA AC1: 초진 노랑 → 모노톤 (텍스트+보더로 구분) */}
      <span className="shrink-0 bg-gray-200 text-gray-700 text-[8px] px-0.5 rounded font-bold leading-tight">초</span>
      <span className="truncate text-gray-900 font-semibold">{name}</span>
      <span className="shrink-0 text-gray-500 font-mono ml-auto text-[9px]">{tail}</span>
    </div>
  );
}

// T-20260510-foot-DASH-SLOT-REWORK-P0: 재진 예약 2번 박스 (셀프접수 전, 차트 사전 접근)
// T-20260515-foot-DASH-SLOT-DRAG: DraggableBox2ResvCard로 교체됨 (하위 호환 보존, 삭제 금지)
// @ts-ignore -- 하위 호환 보존, 삭제 금지
function Box2ReservationCard({
  reservation,
  onClick,
}: {
  reservation: Reservation;
  onClick?: () => void;
}) {
  // T-20260514-foot-CHART-NO-VISIBLE: AC-1 재진 예약 카드 차트번호 상시 표시
  const resvChartMap = useContext(ChartNumberMapCtx);
  const resvChartNum = reservation.customer_id ? resvChartMap.get(reservation.customer_id) : undefined;

  return (
    <div
      className={cn(
        // T-20260615-foot-THEME-MONO-REFINE-3AREA AC1: 재진 초록 → 모노톤 (옅은 회색 배경+보더)
        'flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-semibold w-full shadow-sm',
        onClick ? 'cursor-pointer hover:bg-gray-100 hover:border-gray-400 transition' : 'cursor-default',
      )}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      title={`${cardDisplayName(reservation)} — 클릭하여 체크인 및 차트 열기`}
    >
      <span className="truncate text-gray-800">{cardDisplayName(reservation)}</span>
      {/* T-20260514-foot-CHART-NO-VISIBLE: 차트번호 상시 표시 */}
      {resvChartNum && (
        <span className="text-[9px] font-mono text-gray-500 shrink-0">#{resvChartNum}</span>
      )}
      {onClick && <span className="text-[9px] text-gray-400 shrink-0 ml-auto font-bold">↗</span>}
    </div>
  );
}

// T-20260515-foot-DASH-SLOT-DRAG: 타임라인 슬롯 드롭존 컴포넌트
// slotId = "timeslot-new:HH:MM" 또는 "timeslot-ret:HH:MM"
function SlotDropCell({
  slotId,
  children,
  className,
  onClick,
  title,
  'data-testid': dataTestId,
}: {
  slotId: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
  'data-testid'?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: slotId });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'ring-2 ring-inset ring-teal-400 bg-teal-50/40')}
      // T-20260522-foot-CHART-TAP-DELAY AC-3: 드롭 셀은 draggable 아님 → manipulation으로 300ms tap delay 제거
      // 내부 draggable 카드는 touch-action:none 인라인 스타일로 자체 오버라이드
      style={{ touchAction: 'manipulation' }}
      onClick={onClick}
      title={title}
      data-testid={dataTestId}
    >
      {children}
    </div>
  );
}

// T-20260515-foot-DASH-SLOT-DRAG: 초진 미내원 예약 드래그 가능 카드 (Box1Card 드래그 버전)
// T-20260519-foot-FIRSTVISIT-CHECKIN: 초진 예약 카드에 onSelect(차트조회) + onCheckIn(접수) 추가
// AC-1: '접수' 버튼 — DraggableBox2ResvCard onCheckIn 패턴 재사용
// AC-3: 카드 클릭 → onSelect 차트조회 (체크인 X)
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: DO NOT MODIFY — Chart Open Guard
// T-20260519-foot-CHART-OPEN-GUARD: DraggableBox1Card.onSelect 는
// 초진 고객의 1·2번 차트 열림 진입점. onClick→onSelect→ctxOpenChart 체인 유지 필수.
// 이 체인을 끊거나 onSelect 제거 시 초진 차트 열람 불가 재발.
// 회귀 방지 spec: tests/e2e/T-20260519-foot-CHART-OPEN-GUARD.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
function DraggableBox1Card({
  reservation,
  onSelect,
  onCheckIn,
  onContextMenu,
}: {
  reservation: Reservation;
  /** 카드 클릭 = 차트 조회 (체크인 X) — T-20260519-foot-FIRSTVISIT-CHECKIN AC-3 */
  onSelect?: () => void;
  /** 접수 버튼 클릭 = 체크인 생성 — T-20260519-foot-FIRSTVISIT-CHECKIN AC-1 */
  onCheckIn?: () => void;
  /** T-20260525-foot-RESV-CANCEL-CTX: 우클릭/롱프레스 컨텍스트메뉴 */
  onContextMenu?: (e: React.MouseEvent, reservation: Reservation) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `box1-${reservation.id}`,
    data: { reservationType: 'timeline-resv', reservationId: reservation.id, visitType: reservation.visit_type },
  });
  const tail = (reservation.customer_phone ?? '').replace(/\D/g, '').slice(-4) || '????';
  // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 처리된 미내원 예약 → 명단 유지 + 배지
  const isNoShow = reservation.status === 'noshow';
  // T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 초진 예약 셀 미수 배지
  const box1OutstandingMap = useContext(OutstandingMapCtx);
  const box1Outstanding = reservation.customer_id ? box1OutstandingMap.get(reservation.customer_id) : undefined;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        // T-20260614-foot-NOSHOW-SLOT-DIM: 노쇼 슬롯은 비드래그 시 흐림(0.55)으로 완화
        opacity: isDragging ? 0.4 : (isNoShow ? 0.55 : 1),
        touchAction: 'none',
        willChange: isDragging ? 'transform' : undefined,
        // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST AC-3: 노쇼 시각 구분 — 좌측 인셋 바
        // T-20260614-foot-NOSHOW-SLOT-DIM: 붉은 강조색 → muted 톤(--status-noshow-dim)으로 완화
        ...(isNoShow ? { boxShadow: 'inset 3px 0 0 var(--status-noshow-dim)' } : {}),
      }}
      {...attributes}
      {...listeners}
      className={cn(
        // T-20260615-foot-THEME-MONO-REFINE-3AREA AC1: 초진 노랑 → 모노톤 (흰 배경+진한 보더)
        'flex items-center gap-1 rounded border border-gray-400 bg-white px-2 py-1 text-[10px] w-full select-none',
        onSelect ? 'cursor-grab active:cursor-grabbing hover:bg-gray-100 hover:border-gray-500 transition' : 'cursor-default',
      )}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      onContextMenu={(e) => {
        // T-20260525-foot-RESV-CANCEL-CTX: 우클릭/태블릿 롱프레스 컨텍스트메뉴
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e, reservation);
      }}
      title={`${cardDisplayName(reservation)} — 드래그=시간변경 · 클릭=차트조회 · 우클릭=메뉴`}
      data-testid="box1-resv-card"
      data-noshow={isNoShow ? 'true' : undefined}
    >
      <span className="shrink-0 bg-gray-200 text-gray-700 text-[8px] px-0.5 rounded font-bold leading-tight">초</span>
      <span className="truncate text-gray-900 font-semibold">{cardDisplayName(reservation)}</span>
      <span className="shrink-0 text-gray-500 font-mono text-[9px]">{tail}</span>
      {/* T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 초진 예약 셀 미수 배지 */}
      <OutstandingDueBadge data={box1Outstanding} />
      {/* T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 배지 */}
      {isNoShow && <NoShowBadge />}
      {/* T-20260519-foot-FIRSTVISIT-CHECKIN AC-1: 접수 버튼 — DnD와 분리 위해 onPointerDown stopPropagation */}
      {onCheckIn && (
        <button
          type="button"
          className="shrink-0 ml-auto text-[9px] font-bold text-white bg-gray-700 hover:bg-gray-800 active:bg-gray-900 rounded px-1 py-0.5 leading-none transition cursor-pointer"
          title="접수 (체크인 시작)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onCheckIn(); }}
        >
          접수
        </button>
      )}
    </div>
  );
}

// T-20260515-foot-DASH-SLOT-DRAG: 재진 미내원 예약 드래그 가능 카드 (Box2ReservationCard 드래그 버전)
// T-20260515-foot-REVISIT-CLICK-AUTOCHECK: 카드 클릭(onSelect=차트조회)과 접수 버튼(onCheckIn=체크인)을 분리
// - onSelect: 카드 본문 클릭 → 차트 조회만 (체크인 X) — AC-1
// - onCheckIn: 내부 '접수' 버튼 클릭 → 체크인 생성 (4경로 중 하나) — AC-2
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: DO NOT MODIFY — Chart Open Guard
// T-20260519-foot-CHART-OPEN-GUARD: DraggableBox2ResvCard.onSelect 는
// 재진 고객의 1·2번 차트 열림 진입점. onClick→onSelect→ctxOpenChart 체인 유지 필수.
// 이 체인을 끊거나 onSelect 제거 시 재진 차트 열람 불가 재발.
// 회귀 방지 spec: tests/e2e/T-20260519-foot-CHART-OPEN-GUARD.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
function DraggableBox2ResvCard({
  reservation,
  onSelect,
  onCheckIn,
  onContextMenu,
}: {
  reservation: Reservation;
  /** 카드 클릭 = 차트 조회 (체크인 X) — T-20260515-foot-REVISIT-CLICK-AUTOCHECK AC-1 */
  onSelect?: () => void;
  /** 접수 버튼 클릭 = 체크인 생성 — T-20260515-foot-REVISIT-CLICK-AUTOCHECK AC-2 */
  onCheckIn?: () => void;
  /** T-20260525-foot-RESV-CANCEL-CTX: 우클릭/롱프레스 컨텍스트메뉴 */
  onContextMenu?: (e: React.MouseEvent, reservation: Reservation) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `box2r-${reservation.id}`,
    data: { reservationType: 'timeline-resv', reservationId: reservation.id, visitType: reservation.visit_type },
  });
  // T-20260609-foot-RESV-CARD-CHARTNUM-REMOVE: 재진 예약 카드 식별자는 핸드폰 뒷4자리만 표기.
  // (#차트번호 뱃지 제거 — 두 식별자 동시표출 방지. reporter 김주연 총괄 지시)
  // 결측/4자리 미만 → suffix 미렌더(빈 suffix 금지), 차트번호 fallback 없음 → 성함만 표기.
  const resvPhoneTail = phoneTailSuffix(reservation.customer_phone);
  // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 처리된 재진 미내원 예약 → 명단 유지 + 배지
  const isNoShow = reservation.status === 'noshow';
  // T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 재진 예약 셀 미수 배지
  const box2OutstandingMap = useContext(OutstandingMapCtx);
  const box2Outstanding = reservation.customer_id ? box2OutstandingMap.get(reservation.customer_id) : undefined;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        // T-20260614-foot-NOSHOW-SLOT-DIM: 노쇼 슬롯은 비드래그 시 흐림(0.55)으로 완화
        opacity: isDragging ? 0.4 : (isNoShow ? 0.55 : 1),
        touchAction: 'none',
        willChange: isDragging ? 'transform' : undefined,
        // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST AC-3: 노쇼 시각 구분 — 좌측 인셋 바
        // T-20260614-foot-NOSHOW-SLOT-DIM: 붉은 강조색 → muted 톤(--status-noshow-dim)으로 완화
        ...(isNoShow ? { boxShadow: 'inset 3px 0 0 var(--status-noshow-dim)' } : {}),
      }}
      {...attributes}
      {...listeners}
      className={cn(
        // T-20260615-foot-THEME-MONO-REFINE-3AREA AC1: 재진 초록 → 모노톤 (옅은 회색 배경+보더)
        'flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-semibold w-full shadow-sm',
        onSelect ? 'cursor-grab active:cursor-grabbing hover:bg-gray-100 hover:border-gray-400 transition' : 'cursor-default',
        // T-20260516-foot-HEALER-RESV-BTN AC-10: healer_flag=true인 재진 예약 → 노란색 깜빡 border
        reservation.healer_flag && 'healer-blink',
      )}
      onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      onContextMenu={(e) => {
        // T-20260525-foot-RESV-CANCEL-CTX: 우클릭/태블릿 롱프레스 컨텍스트메뉴
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e, reservation);
      }}
      title={reservation.healer_flag
        ? `${cardDisplayName(reservation)} — 힐러 치료 예정 · 드래그=시간변경 · 클릭=차트조회 · 우클릭=메뉴`
        : `${cardDisplayName(reservation)} — 드래그=시간변경 · 클릭=차트조회 · 우클릭=메뉴`}
      data-testid="box2-resv-card"
      data-noshow={isNoShow ? 'true' : undefined}
    >
      <span className="truncate text-gray-800">{cardDisplayName(reservation)}</span>
      {/* T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 재진 예약 셀 미수 배지 */}
      <OutstandingDueBadge data={box2Outstanding} />
      {/* T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 배지 */}
      {isNoShow && <NoShowBadge />}
      {/* T-20260609-foot-RESV-PATIENT-PHONE-SUFFIX: 핸드폰 뒷4자리 (초진 카드와 동일 포맷·통일) */}
      {resvPhoneTail && (
        <span data-testid="resv-phone-suffix" className="shrink-0 text-gray-500 font-mono text-[9px]">{resvPhoneTail}</span>
      )}
      {/* T-20260516-foot-HEALER-RESV-BTN AC-10: 힐러 배지 표시 */}
      {reservation.healer_flag && (
        <span className="shrink-0 text-[8px] font-bold text-yellow-700 bg-yellow-100 border border-yellow-300 rounded px-0.5 leading-tight">힐</span>
      )}
      {/* T-20260515-foot-REVISIT-CLICK-AUTOCHECK AC-2: 접수 버튼 — 카드 드래그(DnD) 와 분리 위해 onPointerDown stopPropagation */}
      {onCheckIn && (
        <button
          type="button"
          className="shrink-0 ml-auto text-[9px] font-bold text-white bg-gray-700 hover:bg-gray-800 active:bg-gray-900 rounded px-1 py-0.5 leading-none transition cursor-pointer"
          title="접수 (체크인 시작)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onCheckIn(); }}
        >
          접수
        </button>
      )}
    </div>
  );
}

// T-20260510-foot-DASH-SLOT-REWORK-P0: 통합 시간표 전면 리워크
// 3컬럼(시간 | 초진 | 재진) — 1번/2번 고객박스 이원화 + 셀프접수 자동매칭
// T-20260522-foot-TIMETABLE-FOLD: folded/onToggleFold props 추가 — 접기/펼치기 토글
function DashboardTimeline({
  date,
  reservations,
  selfCheckIns,
  onSlotClick,
  onCardClick,
  onCardContext,
  onReservationSelect,
  onReservationCheckIn,
  onReservationContext,
  onNameOpen,
  clinic,
  folded,
  onToggleFold,
  staffMap,
}: {
  date: Date;
  /** T-20260513-foot-TIMETABLE-20H: DB close_time 동적 참조 */
  clinic: Clinic | null;
  reservations: Reservation[];
  selfCheckIns: CheckIn[];
  onSlotClick: (slot: { date: string; time: string; visit_type?: VisitType }) => void;
  onCardClick?: (ci: CheckIn) => void;
  onCardContext?: (ci: CheckIn, e: React.MouseEvent) => void;
  /** 재진 예약 카드 클릭 → 차트 조회만 (체크인 X) — T-20260515-foot-REVISIT-CLICK-AUTOCHECK AC-1 */
  onReservationSelect?: (r: Reservation) => void;
  /** 초진/재진 접수 버튼 클릭 → 체크인 생성 — T-20260529-foot-RRN-SETTING-CHECK 복원 */
  onReservationCheckIn?: (r: Reservation) => void;
  /** T-20260525-foot-RESV-CANCEL-CTX: 예약 박스 우클릭/롱프레스 → 컨텍스트메뉴 */
  onReservationContext?: (r: Reservation, pos: { x: number; y: number }) => void;
  /** T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA (P0-C): 슬롯 명단 펼침(아코디언)
   *  이름 클릭 → 진료차트 열기. 기존엔 onClick 부재로 항상 silent fail이던 surface 복구.
   *  P0-C 하드닝(field-soak): 체크인 전 초진은 customer_id 미연결(고객 등록 전 예약)이 흔하다.
   *  customer_id 없으면 이름 fallback(handleReservationSelect 동일 로직)으로 차트를 연다 →
   *  신규 초진 명단 클릭 무반응(silent fail) 재발 차단. customerId=null + name 도 활성. */
  onNameOpen?: (customerId: string | null, name?: string | null) => void;
  /** T-20260522-foot-TIMETABLE-FOLD: 접힌 상태 (localStorage 유지) */
  folded?: boolean;
  /** T-20260522-foot-TIMETABLE-FOLD: 접기/펼치기 토글 콜백 */
  onToggleFold?: () => void;
  /** T-20260522-foot-TIMETABLE-FOLD: 치료사별 뷰 — 직원 이름 조회 맵 */
  staffMap?: Map<string, { name: string }>;
}) {
  // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-2: 현재 시각 상태화 — 30초마다 자동 갱신
  // 슬롯 전환(매 30분)·±1시간 하이라이트 자동 갱신에 필요
  // T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL AC-2: 이 30초 틱(≤60초)이 라이브 시간 마커
  //   위치도 함께 구동한다(별도 인터벌 불필요). AC-4: 언마운트 시 clearInterval 로 정리.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const isToday = isSameDay(date, now);
  const dateStr = format(date, 'yyyy-MM-dd');
  const currentH = now.getHours();
  const currentM = now.getMinutes();
  const currentSlot = `${String(currentH).padStart(2, '0')}:${currentM < 30 ? '00' : '30'}`;

  // T-20260522-foot-TIMETABLE-FOLD V2 AC-7: 시간대별 예약 명단 아코디언 상태
  // ChartNumberMapCtx: customer_id → chart_number 맵 (부모에서 주입)
  const chartMap = useContext(ChartNumberMapCtx);
  // expandedSlot: 현재 펼쳐진 슬롯 (null = 모두 접힘)
  // props 변경(reservations/selfCheckIns 갱신) 시 아코디언 내용 자동 갱신 — 추가 구독 불필요
  // T-20260526-foot-TIMETABLE-BROKEN AC-2: 자동 펼침 제거 (null 고정)
  // 이전: isToday ? currentSlot : null → 마운트 시 현재 슬롯 자동 펼침이 JS 에러 유발
  // 수정: 항상 null (사용자가 직접 탭을 눌러 펼칠 수 있음)
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);

  // T-20260523-foot-TIMETABLE-SCROLL AC-2: 현재 시간 슬롯 자동 스크롤 타깃 ref
  const currentSlotRef = useRef<HTMLDivElement>(null);
  // T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL: 세로 스크롤 컨테이너 ref (영업시간 외 클램핑용)
  const innerScrollRef = useRef<HTMLDivElement>(null);
  // T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL AC-1: 진입 시 1회만 자동 스크롤 (이후 사용자 스크롤 보존)
  const didInitialScrollRef = useRef(false);
  // scrollToNow 실제 정의는 renderSlots 산출 이후 (renderSlots 의존)

  // ── T-20260522-foot-TIMETABLE-FOLD: 치료사별 뷰 상태 ──────────────────────────

  // AC-5: 뷰 모드 sessionStorage 유지 ('time' | 'therapist')
  const [viewMode, setViewMode] = useState<'time' | 'therapist'>(() => {
    try { return (sessionStorage.getItem('foot-crm-timetable-viewmode') as 'time' | 'therapist') ?? 'time'; }
    catch { return 'time'; }
  });

  // AC-5: 접혀있는 치료사 ID Set — sessionStorage 세션 내 유지
  const [foldedTherapists, setFoldedTherapists] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem('foot-crm-therapist-fold');
      return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  // 치료사별 체크인 그룹 (checked_in_at 오름차순 정렬)
  // T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: 그룹핑 키를 "그날 배정 치료사(ci.therapist_id)"
  //   → "고객 상시 지정치료사(customers.designated_therapist_id)" 로 변경 (Q1=a 해석).
  //   지정치료사 미설정 환자는 '__none__'(미지정 섹션)으로 수용해 명단 누락 방지(Q2 baseline).
  const checkInsByTherapist = useMemo(() => {
    const groups = new Map<string, CheckIn[]>();
    for (const ci of selfCheckIns) {
      const key = ci.customers?.designated_therapist_id ?? '__none__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ci);
    }
    for (const [, cis] of groups) {
      cis.sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at));
    }
    return groups;
  }, [selfCheckIns]);

  const allTherapistKeys = useMemo(() => [...checkInsByTherapist.keys()], [checkInsByTherapist]);

  function setView(mode: 'time' | 'therapist') {
    setViewMode(mode);
    try { sessionStorage.setItem('foot-crm-timetable-viewmode', mode); } catch {/* ignore */}
  }
  function toggleTherapistFold(id: string) {
    setFoldedTherapists(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { sessionStorage.setItem('foot-crm-therapist-fold', JSON.stringify([...next])); } catch {/* ignore */}
      return next;
    });
  }
  // AC-4: 전체 접기
  function foldAllTherapists() {
    setFoldedTherapists(new Set(allTherapistKeys));
    try { sessionStorage.setItem('foot-crm-therapist-fold', JSON.stringify(allTherapistKeys)); } catch {/* ignore */}
  }
  // AC-4: 전체 펼치기
  function unfoldAllTherapists() {
    setFoldedTherapists(new Set());
    try { sessionStorage.removeItem('foot-crm-therapist-fold'); } catch {/* ignore */}
  }

  // T-20260513-foot-TIMETABLE-20H: 하드코딩 '20:00' → DB clinic.close_time 동적 참조
  // 기존: generateSlots('10:00', '20:00', 30) → 마지막 슬롯 19:30 (20:00 누락)
  // 수정: closeTimeFor(date, clinic) = '20:30' → 마지막 슬롯 20:00 포함
  const slots = clinic
    ? generateSlots(openTimeFor(clinic), closeTimeFor(date, clinic), clinic.slot_interval)
    : generateSlots('10:00', '20:00', 30);

  // ── 체크인 조회 맵 구성 ──────────────────────────────────────────────────────
  // reservation_id 우선, 없으면 customer_id 기반 (워크인 폴백)
  const checkInByResvId = new Map<string, CheckIn>();
  const checkInByCustomerId = new Map<string, CheckIn>();
  for (const ci of selfCheckIns) {
    if (ci.reservation_id) {
      checkInByResvId.set(ci.reservation_id, ci);
    } else if (ci.customer_id) {
      if (!checkInByCustomerId.has(ci.customer_id)) {
        checkInByCustomerId.set(ci.customer_id, ci);
      }
    }
  }

  // ── 슬롯별 데이터 분류 ───────────────────────────────────────────────────────
  interface SlotData {
    newBox1: Reservation[];     // 초진 예약 비활성 1번 박스 (셀프접수 대기)
    newBox2Ci: CheckIn[];       // 초진 체크인 활성 2번 박스
    retBox2Resv: Reservation[]; // 재진 예약 pre-checkin 활성 2번 박스
    retBox2Ci: CheckIn[];       // 재진 체크인 활성 2번 박스
  }
  const slotMap: Record<string, SlotData> = {};
  const ensure = (s: string): SlotData => {
    if (!slotMap[s]) slotMap[s] = { newBox1: [], newBox2Ci: [], retBox2Resv: [], retBox2Ci: [] };
    return slotMap[s];
  };
  // resvToSlot: module-level 함수 사용 (T-20260515-foot-DASH-SLOT-DRAG)

  const matchedCiIds = new Set<string>();
  // T-20260530-foot-WALKIN-OFFHOUR-SLOT: 영업시간 외 클램핑된 워크인의 실접수 시각 (ci.id → 'HH:mm')
  const offHourActualTimeMap = new Map<string, string>();
  // T-20260530-foot-WALKIN-TIMETABLE: 워크인 체크인 ID 집합 (예약 미매칭) → 'W' 배지 표시 기준
  const walkInCiIdSet = new Set<string>();
  // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 예약에 매칭된 체크인 ID 집합 → 체크인 카드 노쇼 배지 기준
  //   (예약 카드는 render 시 r.status === 'noshow' 직접 판정. 체크인 카드는 ci에 status 부재 → 별도 set)
  const noshowCiIdSet = new Set<string>();

  // 예약 처리 (cancelled 제외. noshow 는 유지하고 배지로 구분 — T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST)
  for (const r of reservations) {
    if (r.status === 'cancelled') continue;
    // T-20260611-foot-NOSHOW-BADGE-KEEP-INLIST: 노쇼 처리(status='noshow') 후에도 슬롯을 명단에 유지
    const isNoShow = r.status === 'noshow';
    const slot = resvToSlot(r.reservation_time);
    const sd = ensure(slot);

    // 매칭 체크인 탐색: reservation_id 우선 → customer_id 폴백
    const ci =
      checkInByResvId.get(r.id) ??
      (r.customer_id ? checkInByCustomerId.get(r.customer_id) : undefined);

    // T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY (Option A):
    //   routing은 매칭 체크인의 visit_type 우선, 없으면 예약 visit_type 폴백.
    //   현장 체크인 시점의 분류(ci.visit_type)가 당일 타임라인의 권위 기준.
    //   초진 체크인(ci.vt='new')이 재진 예약(r.vt='returning')에 매칭돼도 초진 구역에 표시.
    //   워크인 분기(아래 ci.visit_type 사용)와 동일 기준 → 매칭/워크인 일관.
    //   ci 없음(셀프접수 전)일 때만 r.visit_type 사용(기존 동작 유지).
    const effVisitType = timelineVisitType(ci?.visit_type, r.visit_type);

    if (effVisitType === 'new') {
      // 초진
      if (!ci) {
        // 셀프접수 전 → 1번 박스 (비활성). 노쇼도 미내원 → 1번 박스에 유지(배지 표시)
        if (r.status === 'confirmed' || isNoShow) sd.newBox1.push(r);
        // status='checked_in' + selfCheckIns에 없음 = 칸반으로 이동 완료 → 미표시
      } else {
        // 셀프접수 완료 → 2번 박스 (활성, 드래그/클릭)
        matchedCiIds.add(ci.id);
        sd.newBox2Ci.push(ci);
        if (isNoShow) noshowCiIdSet.add(ci.id);
      }
    } else {
      // 재진
      if (!ci) {
        // 셀프접수 전 → 2번 박스 (재진은 예약부터 활성, 차트 접근). 노쇼도 유지(배지 표시)
        if (r.status === 'confirmed' || isNoShow) sd.retBox2Resv.push(r);
        // status='checked_in' + 없음 = treatment_waiting 이상 이동 → 미표시
      } else {
        // 체크인 매칭 → 2번 박스 (활성)
        matchedCiIds.add(ci.id);
        sd.retBox2Ci.push(ci);
        if (isNoShow) noshowCiIdSet.add(ci.id);
      }
    }
  }

  // 워크인 체크인 (예약 미매칭 — 예약없이 당일 접수)
  // T-20260530-foot-WALKIN-OFFHOUR-SLOT:
  //   AC-1: 영업시간 전 접수 → 당일 첫 슬롯으로 클램핑 (예: 08:30 → 10:00)
  //   AC-2: 영업시간 후 접수 → 당일 마지막 슬롯으로 클램핑 (예: 20:15 → 마지막 슬롯)
  //   AC-4: 일요일 워크인 → 클램핑/이동/오류 없이 접수 시각 그대로 slot 매핑 (pass-through)
  //         현장 결정 2026-06-01 (김주연 총괄): 일요일 셀프접수는 CRM 테스트 용도로
  //         해당 시각 그대로 배정. A안(월요일 이동)·B안(오류) 모두 기각.
  //         평일/토 오프아워 이동 로직(AC-1/2)을 일요일에는 적용하지 않는다.
  //   AC-5: clinic.open_time / close_time 기준 (slots[] 가 이미 clinic 설정 사용)
  const firstSlot = slots[0] ?? '10:00';
  const lastSlot = slots[slots.length - 1] ?? '20:00';
  const isSunday = date.getDay() === 0; // 0=일요일 → 오프아워 클램핑 예외(pass-through)
  for (const ci of selfCheckIns) {
    if (matchedCiIds.has(ci.id)) continue;
    const d = new Date(ci.checked_in_at);
    const h = d.getHours();
    const mm = d.getMinutes();
    const rawSlot = `${String(h).padStart(2, '0')}:${mm < 30 ? '00' : '30'}`;
    // AC-4(일요일): pass-through — rawSlot 그대로. 평일/토(AC-1/2): 오프아워 클램핑.
    const slot = isSunday
      ? rawSlot
      : rawSlot < firstSlot ? firstSlot :
        rawSlot > lastSlot  ? lastSlot  :
        rawSlot;
    // 클램핑 발생 시(평일/토 한정) 실접수 시각 기록 → 카드 배지 표시. 일요일은 클램핑 없음.
    if (!isSunday && slot !== rawSlot) {
      offHourActualTimeMap.set(ci.id, format(d, 'HH:mm'));
    }
    // T-20260530-foot-WALKIN-TIMETABLE: 워크인 등록 → 'W' 배지 기준
    walkInCiIdSet.add(ci.id);
    const sd = ensure(slot);
    if (ci.visit_type === 'new') {
      sd.newBox2Ci.push(ci);
    } else {
      sd.retBox2Ci.push(ci);
    }
  }

  // T-20260530-foot-WALKIN-OFFHOUR-SLOT AC-4: 일요일 pass-through 렌더 슬롯 보정
  // 타임라인은 slots[] 에 존재하는 슬롯만 렌더한다. 일요일 워크인이 운영시간 범위
  // (clinic 설정 기반 slots) 밖 시각으로 접수된 경우에도 "그 시각 그대로" 표시되도록
  // slotMap 에 쌓인 실데이터 슬롯을 합쳐 정렬한다. 평일/토는 slots 그대로(무변경).
  const renderSlots = isSunday
    ? Array.from(new Set([...slots, ...Object.keys(slotMap)])).sort()
    : slots;

  // ── T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL ─────────────────────────────────
  // AC-1/AC-3: 현재 시각으로 스크롤. 현재 슬롯 행이 있으면 뷰포트 중앙으로,
  // 영업시간 외 등 그리드 범위 밖이면 가장 가까운 가장자리(첫/마지막 행)로 클램핑.
  const toMin = (s: string) => parseInt(s.slice(0, 2)) * 60 + parseInt(s.slice(3, 5));
  const scrollToNow = useCallback(() => {
    if (!isToday) return;
    // 1순위: 현재 슬롯 행 (정확한 시각 위치)
    if (currentSlotRef.current) {
      currentSlotRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // 폴백: 현재 슬롯 행이 없음(영업시간 외) → 첫/마지막 행으로 클램핑 (깨지지 않음)
    const container = innerScrollRef.current;
    if (!container || renderSlots.length === 0) return;
    const rows = container.querySelectorAll<HTMLElement>('[data-testid="timeline-slot-row"]');
    if (rows.length === 0) return;
    const nowMin = currentH * 60 + currentM;
    if (nowMin <= toMin(renderSlots[0])) {
      rows[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [isToday, renderSlots, currentH, currentM]);

  // AC-1: 진입 시 1회 자동 스크롤. 슬롯 전환(30분)마다 재스크롤하지 않음(사용자 스크롤 보존).
  //       다른 날짜로 이동 후 오늘로 복귀 시 플래그 리셋 → 재진입 시 다시 1회 스크롤.
  useEffect(() => {
    if (!isToday) { didInitialScrollRef.current = false; return; }
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    // 레이아웃/페인트 안정 후 스크롤 (슬롯 행 DOM 보장)
    const raf = requestAnimationFrame(() => scrollToNow());
    return () => cancelAnimationFrame(raf);
  }, [isToday, scrollToNow]);

  // T-20260522-foot-TIMETABLE-FOLD: 접힌 상태 — 세로 스트립만 표시 (토글 버튼 + 라벨)
  if (folded) {
    return (
      <div className="flex flex-col items-center bg-white border-r flex-1 min-h-0">
        <button
          type="button"
          onClick={onToggleFold}
          className="w-full flex flex-col items-center py-2 gap-1.5 hover:bg-teal-50 active:bg-teal-100 transition text-teal-700"
          title="시간표 펼치기"
          aria-label="시간표 펼치기"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="text-[9px] font-semibold text-gray-500 [writing-mode:vertical-lr] tracking-widest mt-1">
            통합 시간표
          </span>
        </button>
      </div>
    );
  }

  return (
    // T-20260514-foot-TIMETABLE-MOBILE-HSCROLL:
    // [overflow-x:clip] — X축 clip은 scroll context를 생성하지 않으므로
    // 하위 sticky left-0 이 외부(level-1) overflow-x-auto 컨테이너까지 전파됨.
    // overflow-y-hidden — 수직 팽창 억제 (내부 overflow-y-auto가 자체 처리).
    // md:overflow-hidden — PC에서 원래 동작 복원.
    <div className="flex flex-col bg-white [overflow-x:clip] overflow-y-hidden md:overflow-hidden flex-1 min-h-0">
      {/* 헤더 */}
      {/* T-20260510-foot-DASH-DUAL-HSCROLL: sticky 제거 → shrink-0으로 교체 (스크롤 컨테이너 밖이므로 sticky 불필요) */}
      {/* T-20260522-foot-TIMETABLE-FOLD: 접기 버튼 추가 */}
      <div className="text-xs font-semibold px-2 py-1.5 border-b bg-muted/20 text-gray-600 shrink-0 flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" /> 통합 시간표
        </span>
        <span className="flex items-center gap-0.5">
          {/* T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL AC-3: 지금 시간으로 이동 (오늘·시간표 뷰에서만) */}
          {isToday && viewMode === 'time' && (
            <button
              type="button"
              onClick={scrollToNow}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold text-teal-700 hover:bg-teal-100 active:bg-teal-200 transition"
              title="현재 시각으로 이동"
              aria-label="현재 시각으로 이동"
              data-testid="timeline-now-jump"
            >
              <Crosshair className="h-3 w-3" />
              지금
            </button>
          )}
          <button
            type="button"
            onClick={onToggleFold}
            className="rounded p-0.5 hover:bg-teal-100 text-gray-400 hover:text-teal-700 transition"
            title="시간표 접기"
            aria-label="시간표 접기"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {/* T-20260522-foot-TIMETABLE-FOLD: 뷰 모드 탭 (시간표 | 치료사별) */}
      <div className="flex shrink-0 border-b bg-white">
        <button
          type="button"
          onClick={() => setView('time')}
          className={cn(
            'flex-1 min-h-[44px] py-1.5 text-[10px] font-semibold border-b-2 transition flex items-center justify-center',
            viewMode === 'time'
              ? 'text-teal-700 border-teal-500 bg-teal-50/50'
              : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50',
          )}
        >
          시간표
        </button>
        <button
          type="button"
          onClick={() => setView('therapist')}
          className={cn(
            'flex-1 min-h-[44px] py-1.5 text-[10px] font-semibold border-b-2 transition flex items-center justify-center',
            viewMode === 'therapist'
              ? 'text-teal-700 border-teal-500 bg-teal-50/50'
              : 'text-gray-400 border-transparent hover:text-gray-600 hover:bg-gray-50',
          )}
        >
          치료사별
        </button>
      </div>
      {/* T-20260510-foot-DASH-DUAL-HSCROLL: 컬럼헤더를 스크롤 컨테이너 내부로 이동
          문제1 — 이중 X스크롤바: overflow-y-auto는 CSS 규격상 overflow-x도 auto로 강제 →
            overflow-x-hidden 명시로 내부 가로스크롤바 완전 제거
          문제2 — 컬럼 잘림/오정렬: 헤더가 overflow-y-auto 바깥에 있으면 Y스크롤바 폭(~15px)만큼
            열 너비가 헤더와 본문 사이에 어긋남 → 헤더를 안으로 이동해 자동 동기화
          T-20260514-foot-TIMETABLE-MOBILE-HSCROLL:
            [overflow-x:clip] → scroll context 미생성, sticky left-0 외부 전파 허용
            md:overflow-x-hidden → PC에서 원래 동작
          T-20260522-foot-TIMETABLE-SCROLL: portrait 세로 스크롤 — data-testid로 CSS max-height 바인딩 */}
      <div
        ref={innerScrollRef}
        data-testid="timeline-inner-scroll"
        className="flex-1 min-h-0 overflow-y-auto [overflow-x:clip] md:overflow-x-hidden"
      >
        {viewMode === 'therapist' ? (
          /* ── T-20260522-foot-TIMETABLE-FOLD: 치료사별 뷰 ─────────────────── */
          <div className="flex flex-col">
            {/* AC-4: 전체 접기/펼치기 — sticky top-0 */}
            <div className="flex items-center gap-1 px-2 py-1 border-b bg-gray-50 sticky top-0 z-10">
              <button
                type="button"
                onClick={foldAllTherapists}
                className="flex-1 min-h-[44px] text-[10px] font-medium text-gray-600 hover:text-teal-700 hover:bg-teal-50 rounded px-1.5 py-1 transition flex items-center justify-center"
              >
                전체 접기
              </button>
              <div className="w-px h-3 bg-gray-200 shrink-0" />
              <button
                type="button"
                onClick={unfoldAllTherapists}
                className="flex-1 min-h-[44px] text-[10px] font-medium text-gray-600 hover:text-teal-700 hover:bg-teal-50 rounded px-1.5 py-1 transition flex items-center justify-center"
              >
                전체 펼치기
              </button>
            </div>
            {allTherapistKeys.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-xs text-gray-400 gap-2">
                <Users className="h-6 w-6 opacity-30" />
                <span>오늘 배정된 치료사 없음</span>
              </div>
            ) : (
              [...checkInsByTherapist.entries()].map(([therapistId, cis]) => {
                // T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: 미설정 환자 섹션 = '미지정'
                const tname = therapistId === '__none__'
                  ? '미지정'
                  : staffMap?.get(therapistId)?.name ?? '치료사';
                const isFolded = foldedTherapists.has(therapistId);
                return (
                  <div key={therapistId} className="border-b last:border-0">
                    {/* AC-1: 행 헤더 chevron 토글 — AC-6: min-h-[44px] 터치 44px 확보 */}
                    <button
                      type="button"
                      onClick={() => toggleTherapistFold(therapistId)}
                      style={{ minHeight: '44px' }}
                      className="w-full flex items-center gap-2 px-2 bg-gray-50 hover:bg-teal-50 active:bg-teal-100 transition"
                      aria-expanded={!isFolded}
                      aria-label={`${tname} ${isFolded ? '펼치기' : '접기'}`}
                    >
                      {isFolded
                        ? <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-teal-600 shrink-0" />}
                      {/* AC-2: 접기 시 이름 + 예약건수만 표시 */}
                      <span className={cn(
                        'text-xs font-semibold flex-1 text-left truncate',
                        therapistId === '__none__' ? 'text-gray-400 italic' : 'text-gray-800',
                      )}>
                        {tname}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 tabular-nums shrink-0">
                        {cis.length}건
                      </span>
                    </button>
                    {/* 행 본문 — 접힌 상태엔 헤더만, 펼친 상태엔 체크인 목록 */}
                    {!isFolded && (
                      <div>
                        {cis.map((ci) => (
                          <div
                            key={ci.id}
                            onClick={() => onCardClick?.(ci)}
                            onContextMenu={onCardContext ? (e) => onCardContext(ci, e) : undefined}
                            className="flex items-center gap-1.5 px-2.5 py-2 border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition"
                          >
                            <span className="text-[10px] font-mono text-gray-400 shrink-0 w-9 tabular-nums leading-none">
                              {format(new Date(ci.checked_in_at), 'HH:mm')}
                            </span>
                            <span className="text-[11px] font-medium flex-1 truncate text-gray-800">
                              {cardDisplayName(ci)}
                            </span>
                            {/* T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: 지정치료사 환자 "지정" 배지 */}
                            {ci.customers?.designated_therapist_id && (
                              <Badge className="bg-indigo-100 text-indigo-700 border-transparent text-[9px] px-1 py-0 shrink-0 leading-tight">
                                지정
                              </Badge>
                            )}
                            <Badge className={cn(VISIT_TYPE_COLOR[ci.visit_type], 'text-[9px] px-1 py-0 shrink-0 leading-tight')}>
                              {VISIT_TYPE_KO[ci.visit_type]}
                            </Badge>
                            <Badge className={cn(STATUS_COLOR[ci.status], 'text-[9px] px-1 py-0 shrink-0 leading-tight')}>
                              {STATUS_KO[ci.status]}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* ── 기존 시간표 뷰 ─────────────────────────────────────────────── */
          <>
        {/* 컬럼 헤더 — 초진/재진: T-20260615-foot-THEME-MONO-REFINE-3AREA AC1 모노톤
             초진=옅은 회색 헤더(gray-100)+초 배지, 재진=더 옅은 회색(gray-50). 텍스트로 구분. */}
        <div className="grid grid-cols-[2.5rem_1fr_1fr] border-b sticky top-0 z-10 bg-white">
          {/* T-20260514-foot-TIMETABLE-MOBILE-HSCROLL: sticky left-0 z-20 — 코너 셀(시간 헤더)도 좌측 고정 */}
          <div className="py-1 border-r bg-gray-50 sticky left-0 z-20" data-testid="timeline-time-col" />
          <div className="py-1 text-[9px] font-bold text-gray-700 text-center border-r bg-gray-100 flex items-center justify-center gap-0.5">
            <span className="bg-gray-200 text-gray-800 text-[8px] px-0.5 rounded font-bold leading-tight">초</span>
            초진
          </div>
          <div className="py-1 text-[9px] font-bold text-gray-600 text-center bg-gray-50">
            재진
          </div>
        </div>
        {renderSlots.map((slot) => {
          const sd = slotMap[slot];
          const newBox1 = sd?.newBox1 ?? [];
          const newBox2Ci = sd?.newBox2Ci ?? [];
          const retBox2Resv = sd?.retBox2Resv ?? [];
          const retBox2Ci = sd?.retBox2Ci ?? [];
          const newCnt = newBox1.length + newBox2Ci.length;
          const retCnt = retBox2Resv.length + retBox2Ci.length;
          const hasAny = newCnt > 0 || retCnt > 0;
          const maxRows = Math.max(newCnt, retCnt, 1);

          const isCurrentSlot = isToday && slot === currentSlot;
          // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-2: ±1시간 활성/비활성 존 분화
          const slotMinutes = parseInt(slot.split(':')[0]) * 60 + parseInt(slot.split(':')[1]);
          const currentMinutes = currentH * 60 + currentM;
          const isPastSlot = isToday && slotMinutes < currentMinutes - 30;
          // ±1시간 범위 외 슬롯 = 비활성 존(베이지/흐림), ±1시간 이내 = 활성 존(흰/하이라이트)
          const isInactiveZone = isToday && Math.abs(slotMinutes - currentMinutes) > 60;

          // T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL AC-2: 현재 슬롯 내 분 위치 비율 → 라이브 마커 top%
          const slotInterval = clinic?.slot_interval ?? 30;
          const nowFraction = isCurrentSlot
            ? Math.min(1, Math.max(0, (currentMinutes - slotMinutes) / slotInterval))
            : 0;

          // T-20260522-foot-TIMETABLE-FOLD V2 AC-7: 아코디언용 예약 목록 구성
          // 초진(new) 우선, 재진(returning) 다음 — 슬롯 안의 모든 예약·체크인 합산
          // T-20260526-foot-TIMETABLE-BROKEN AC-2: null-safe 방어 코드 강화
          // T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: designatedTherapistId 추가 → 명단 "지정" 배지 판정
          type AccordionItem = { name: string | null; visitType: 'new' | 'returning'; customerId: string | null; designatedTherapistId: string | null };
          const accordionItems: AccordionItem[] = [];
          try {
            accordionItems.push(
              ...newBox1.map((r): AccordionItem => ({ name: r ? cardDisplayName(r) : null, visitType: 'new', customerId: r?.customer_id ?? null, designatedTherapistId: r?.customers?.designated_therapist_id ?? null })),
              ...newBox2Ci.map((ci): AccordionItem => ({ name: ci ? cardDisplayName(ci) : null, visitType: 'new', customerId: ci?.customer_id ?? null, designatedTherapistId: ci?.customers?.designated_therapist_id ?? null })),
              ...retBox2Resv.map((r): AccordionItem => ({ name: r ? cardDisplayName(r) : null, visitType: 'returning', customerId: r?.customer_id ?? null, designatedTherapistId: r?.customers?.designated_therapist_id ?? null })),
              ...retBox2Ci.map((ci): AccordionItem => ({ name: ci ? cardDisplayName(ci) : null, visitType: 'returning', customerId: ci?.customer_id ?? null, designatedTherapistId: ci?.customers?.designated_therapist_id ?? null })),
            );
          } catch {
            // 아코디언 데이터 구성 실패 시 빈 배열로 폴백 — 시간표 렌더링은 계속
          }
          const isExpanded = expandedSlot === slot;

          return (
            // T-20260522-foot-TIMETABLE-FOLD V2 AC-7: 슬롯 행 = flex-col 래퍼 (grid → 아코디언 지지 구조)
            // T-20260523-foot-TIMETABLE-SCROLL AC-1: currentSlot 행에 ref 부착 → scrollIntoView 타깃
            <div
              key={slot}
              ref={isCurrentSlot ? currentSlotRef : undefined}
              className={cn(
                'border-b border-gray-100',
                // T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL AC-2: 라이브 마커 absolute 기준점
                isCurrentSlot && 'relative',
                isPastSlot && 'opacity-55',
                // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-2: 비활성 존 베이지 배경
                isInactiveZone && 'bg-neutral-50',
              )}
              data-testid="timeline-slot-row"
              data-active-zone={isToday && !isInactiveZone ? 'true' : undefined}
            >
              {/* T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL AC-2: 라이브 시간 마커 (가로 표시줄)
                   현재 슬롯 행 안에서 분 비율(nowFraction)만큼 내려 그린다. pointer-events-none
                   으로 하위 클릭/드래그 방해 없음. z-30 으로 sticky 시간열(z-20)·헤더(z-10) 위. */}
              {isCurrentSlot && (
                <div
                  aria-hidden="true"
                  data-testid="timeline-now-marker"
                  className="pointer-events-none absolute inset-x-0 z-30 flex items-center -translate-y-1/2"
                  style={{ top: `${nowFraction * 100}%` }}
                >
                  <div className="h-[2px] flex-1 bg-rose-500/80" />
                  <span className="absolute left-10 -top-2 rounded bg-rose-500 px-1 py-0.5 text-[8px] font-bold leading-none text-white tabular-nums shadow-sm">
                    {String(currentH).padStart(2, '0')}:{String(currentM).padStart(2, '0')}
                  </span>
                </div>
              )}
              {/* ── 메인 슬롯 그리드 ── */}
              <div
                className="grid grid-cols-[2.5rem_1fr_1fr]"
                style={{ minHeight: hasAny ? `${maxRows * 28 + 8}px` : '36px' }}
              >
                {/* 시간 레이블 — AC-7: 버튼으로 전환 → 탭/클릭으로 아코디언 토글
                     T-20260514-foot-TIMETABLE-MOBILE-HSCROLL: sticky left-0 z-10
                     T-20260517-foot-TIMELINE-MINLABEL: 분 레이블 대비비 복원 */}
                <button
                  type="button"
                  onClick={() => setExpandedSlot((s) => (s === slot ? null : slot))}
                  className={cn(
                    'flex flex-col items-center justify-start pt-1.5 pb-1 border-r shrink-0 sticky left-0 z-10 w-full transition-colors',
                    // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-2: ±1시간 존 컬러 분화
                    isCurrentSlot
                      ? 'bg-teal-50 hover:bg-teal-100 active:bg-teal-200'
                      : isInactiveZone
                        ? 'bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300'
                        : 'bg-gray-50 hover:bg-gray-100 active:bg-gray-200',
                  )}
                  aria-expanded={isExpanded}
                  aria-label={`${slot} 슬롯 예약 명단 ${isExpanded ? '접기' : '펼치기'}`}
                  title={`${slot} — 탭하면 예약 명단 펼침`}
                  data-testid={`timeline-slot-time-${slot}`}
                >
                  <span
                    className={cn(
                      'text-[9px] font-mono tabular-nums leading-none',
                      isCurrentSlot ? 'text-teal-700 font-bold' : 'text-gray-400',
                    )}
                  >
                    {slot.slice(0, 2)}
                  </span>
                  <span
                    className={cn(
                      'text-[9px] font-mono tabular-nums leading-none mt-0.5',
                      isCurrentSlot ? 'text-teal-600' : 'text-gray-500',
                    )}
                  >
                    {slot.slice(3)}
                  </span>
                  {isCurrentSlot && (
                    <div className="h-1 w-1 rounded-full bg-teal-500 animate-pulse mt-1" />
                  )}
                  {/* AC-7: 예약있는 슬롯에만 방향 표시기 */}
                  {hasAny && (
                    isExpanded
                      ? <ChevronDown className="h-2 w-2 text-teal-600 mt-0.5 shrink-0" />
                      : <ChevronRight className="h-2 w-2 text-gray-300 mt-0.5 shrink-0" />
                  )}
                </button>

                {/* 초진 컬럼 — T-20260515-foot-DASH-SLOT-DRAG: SlotDropCell로 교체 (드래그 드롭 시간 변경) */}
                <SlotDropCell
                  slotId={`timeslot-new:${slot}`}
                  className={cn(
                    'px-1 pt-1 pb-0.5 border-r space-y-0.5 min-w-0',
                    // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-2: ±1시간 존 컬러 분화
                    isCurrentSlot
                      ? 'bg-teal-50/20'
                      : isInactiveZone
                        ? 'bg-neutral-100/50'
                        // T-20260615-foot-THEME-MONO-REFINE-3AREA AC1: 초진 노랑 배경 틴트 제거(채도0)
                        : newCnt > 0 ? 'bg-gray-50/60' : '',
                  )}
                  onClick={() => onSlotClick({ date: dateStr, time: slot })}
                  title="빈 영역 클릭 → 초진 예약 추가 / 카드 드롭 → 시간 변경"
                  data-testid="timeline-slot-new"
                >
                  {newBox1.map((r) => (
                    // T-20260529-foot-RRN-SETTING-CHECK: onCheckIn 복원 — 초진 접수 시 주민번호 입력 폼 오픈
                    // T-20260525-foot-RESV-CANCEL-CTX: onContextMenu 추가
                    <DraggableBox1Card
                      key={`b1-${r.id}`}
                      reservation={r}
                      onSelect={onReservationSelect ? () => onReservationSelect(r) : undefined}
                      onCheckIn={onReservationCheckIn ? () => onReservationCheckIn(r) : undefined}
                      onContextMenu={onReservationContext ? (e, resv) => onReservationContext(resv, { x: e.clientX, y: e.clientY }) : undefined}
                    />
                  ))}
                  {newBox2Ci.map((ci) => (
                    <TimelineCheckInCard
                      key={`b2n-${ci.id}`}
                      checkIn={ci}
                      isWalkIn={walkInCiIdSet.has(ci.id)}
                      isNoShow={noshowCiIdSet.has(ci.id)}
                      offHourTime={offHourActualTimeMap.get(ci.id)}
                      onClick={onCardClick ? () => onCardClick(ci) : undefined}
                      onContextMenu={onCardContext ? (e) => onCardContext(ci, e) : undefined}
                    />
                  ))}
                  {newCnt === 0 && (
                    <div className="text-[9px] text-gray-200 text-center leading-none py-1 select-none">+</div>
                  )}
                </SlotDropCell>

                {/* 재진 컬럼 — T-20260515-foot-DASH-SLOT-DRAG: SlotDropCell로 교체 */}
                <SlotDropCell
                  slotId={`timeslot-ret:${slot}`}
                  className={cn(
                    'px-1 pt-1 pb-0.5 space-y-0.5 min-w-0',
                    // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-2: ±1시간 존 컬러 분화
                    isCurrentSlot
                      ? 'bg-teal-50/20'
                      : isInactiveZone
                        ? 'bg-neutral-100/50'
                        // T-20260615-foot-THEME-MONO-REFINE-3AREA AC1: 재진 초록 배경 틴트 제거(채도0)
                        : retCnt > 0 ? 'bg-gray-50/40' : '',
                  )}
                  onClick={() => onSlotClick({ date: dateStr, time: slot, visit_type: 'returning' })}
                  title="빈 영역 클릭 → 재진 예약 추가 / 카드 드롭 → 시간 변경"
                  data-testid="timeline-slot-ret"
                >
                  {retBox2Resv.map((r) => (
                    // T-20260529-foot-RRN-SETTING-CHECK: onCheckIn 복원 — 재진 즉시 체크인 경로
                    // T-20260525-foot-RESV-CANCEL-CTX: onContextMenu 추가
                    <DraggableBox2ResvCard
                      key={`b2r-${r.id}`}
                      reservation={r}
                      onSelect={onReservationSelect ? () => onReservationSelect(r) : undefined}
                      onCheckIn={onReservationCheckIn ? () => onReservationCheckIn(r) : undefined}
                      onContextMenu={onReservationContext ? (e, resv) => onReservationContext(resv, { x: e.clientX, y: e.clientY }) : undefined}
                    />
                  ))}
                  {retBox2Ci.map((ci) => (
                    <TimelineCheckInCard
                      key={`b2c-${ci.id}`}
                      checkIn={ci}
                      isWalkIn={walkInCiIdSet.has(ci.id)}
                      isNoShow={noshowCiIdSet.has(ci.id)}
                      offHourTime={offHourActualTimeMap.get(ci.id)}
                      onClick={onCardClick ? () => onCardClick(ci) : undefined}
                      onContextMenu={onCardContext ? (e) => onCardContext(ci, e) : undefined}
                    />
                  ))}
                </SlotDropCell>
              </div>

              {/* ── AC-7: 아코디언 패널 — 해당 슬롯 예약 명단 ──
                   isExpanded = true일 때만 렌더.
                   props(reservations/selfCheckIns) 변경 시 accordionItems 자동 재계산 → 실시간 반영.
                   T-20260526-foot-TIMETABLE-BROKEN AC-2: 자동 펼침 제거로 마운트 시 렌더 안전화.
                   DB변경 없음 (UI 레이어만). */}
              {isExpanded && accordionItems !== undefined && (
                <div
                  className="border-t border-teal-100 bg-teal-50/30 px-2 py-1.5"
                  data-testid={`timeline-slot-accordion-${slot}`}
                >
                  {accordionItems.length === 0 ? (
                    <p className="text-[10px] text-gray-400 text-center py-0.5 select-none">예약 없음</p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {accordionItems.map((item, idx) => {
                        if (!item) return null;
                        const safeVisitType = (item.visitType === 'new' || item.visitType === 'returning') ? item.visitType : 'returning';
                        const chartNo = item.customerId ? (chartMap?.get(item.customerId) ?? null) : null;
                        // T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA (P0-C 하드닝, field-soak):
                        //   명단 항목 클릭 → 진료차트 열림. 이전엔 onClick 부재로 항상 무반응.
                        //   1차 핫픽스는 customer_id 연결 항목에만 활성이라, 고객 미등록 초진(customer_id=null)
                        //   명단은 여전히 무반응이었다. → 이름만 있어도 활성화하고, customer_id 없으면
                        //   onNameOpen 핸들러가 이름 fallback(동일 클리닉·동명 1건 자동 열기)으로 처리한다.
                        const canOpen = Boolean((item.customerId || item.name) && onNameOpen);
                        return (
                          <div
                            key={idx}
                            role={canOpen ? 'button' : undefined}
                            tabIndex={canOpen ? 0 : undefined}
                            onClick={canOpen ? () => onNameOpen!(item.customerId, item.name) : undefined}
                            onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNameOpen!(item.customerId, item.name); } } : undefined}
                            className={cn(
                              'flex items-center gap-1.5 py-0.5 rounded',
                              canOpen && 'cursor-pointer hover:bg-teal-100/60 active:bg-teal-200/60 transition-colors',
                            )}
                            data-testid="timeline-accordion-name"
                            data-can-open={canOpen ? 'true' : undefined}
                          >
                            <Badge
                              className={cn(
                                VISIT_TYPE_COLOR[safeVisitType],
                                'text-[9px] px-1 py-0 shrink-0 leading-tight',
                              )}
                            >
                              {VISIT_TYPE_KO[safeVisitType]}
                            </Badge>
                            <span className="text-[11px] font-medium text-gray-800 flex-1 truncate">
                              {item.name ?? '(이름 없음)'}
                            </span>
                            {/* T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: 지정치료사 환자 "지정" 배지
                                (가독성 — 지정치료사 이름 확보 시 "지정·{이름}" 표기) */}
                            {item.designatedTherapistId && (
                              <Badge
                                className="bg-indigo-100 text-indigo-700 border-transparent text-[9px] px-1 py-0 shrink-0 leading-tight"
                                title={staffMap?.get(item.designatedTherapistId)?.name
                                  ? `지정치료사: ${staffMap.get(item.designatedTherapistId)!.name}`
                                  : '지정치료사'}
                              >
                                {staffMap?.get(item.designatedTherapistId)?.name
                                  ? `지정·${staffMap.get(item.designatedTherapistId)!.name}`
                                  : '지정'}
                              </Badge>
                            )}
                            {chartNo && (
                              <span className="text-[9px] text-gray-400 tabular-nums shrink-0">
                                #{chartNo}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * T-20260610-foot-RESV-DUPGUARD-SAMEDAY: 대시보드 예약 신규 생성 당일 동일고객 중복 가드.
 * 선행 정본 = fn_selfcheckin_dup_guard (T-20260602-foot-SELFCHECKIN-DUP-GUARD) 와 일관 — 병렬 가드 정의 금지.
 * 분기 (a): reservations 당일 1건 강제. checked_in 예약 row 도 활성(NOT cancelled)이므로
 *   "체크인 완료 고객 재예약 생성"(증거 F0B9CLQ1KRT)을 동일 가드로 차단.
 * 조회: clinic_id + (customer_id|phone digits) + reservation_date + status NOT IN ('cancelled').
 *   - status NOT IN ('cancelled') → 취소 후 재예약 정상 동선 유지 (AC-3).
 * 서버 권위 RPC fn_reservation_dup_guard 우선, 미배포 환경에서는 fallback SELECT 로 graceful degrade.
 * @returns true = 중복(차단), false = 생성 허용.
 */
async function checkReservationDupSameDay(
  clinicId: string,
  customerId: string | null,
  phone: string | null,
  date: string,
): Promise<boolean> {
  const phoneDigits = (phone ?? '').replace(/[^0-9]/g, '');
  if (!customerId && phoneDigits.length < 10) return false; // 식별자 없음 → 가드 불가, 허용

  // 1차: 서버 권위 RPC (SELFCHECKIN-DUP-GUARD 와 동일 형태)
  try {
    const { data, error } = await supabase.rpc('fn_reservation_dup_guard', {
      p_clinic_id: clinicId,
      p_customer_id: customerId,
      p_phone: phone,
      p_date: date,
    });
    if (!error && data && typeof data === 'object') {
      return (data as { duplicate?: boolean }).duplicate === true;
    }
  } catch {
    /* RPC 미배포/오류 → fallback */
  }

  // fallback: 당일·해당 클리닉 활성 예약을 한 번에 받아 클라에서 OR 매칭 (1일치 = 소량, bounded)
  const { data: rows, error } = await supabase
    .from('reservations')
    .select('id, customer_id, customer_phone')
    .eq('clinic_id', clinicId)
    .eq('reservation_date', date)
    .neq('status', 'cancelled');
  if (error || !rows) return false;
  return (rows as Array<{ customer_id: string | null; customer_phone: string | null }>).some((r) => {
    if (customerId && r.customer_id === customerId) return true;
    if (phoneDigits.length >= 10 && (r.customer_phone ?? '').replace(/[^0-9]/g, '') === phoneDigits) return true;
    return false;
  });
}

// ── QuickReservationDialog ─────────────────────────────────────────────────────
// T-20260517-foot-TREATROOM-RESV-UNIFY: 치료실현황 예약창 → 당일현황 빠른예약 기준 통일
//   AC-1: 이름/연락처 InlinePatientSearch — 기존 환자 검색·자동 로드
//   AC-2: 신규 환자 즉석 등록 (이름+전화번호 필수, E.164 정규화)
//   AC-3: 방문유형 한글 버튼 [초진][재진][체험] — DB 영문 유지
//   AC-4: 예약메모 입력 (booking_memo)
//   AC-5: customer_id + phone 반드시 포함 → 셀프체크인 매칭 보장
function QuickReservationDialog({
  draft,
  clinicId,
  createdBy,
  onClose,
  onCreated,
}: {
  draft: QuickResvDraft | null;
  clinicId: string | undefined;
  createdBy: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<QuickResvDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [selectedBirthDate, setSelectedBirthDate] = useState<string | null>(null);
  // AC-2: 신규 환자 즉석 등록 패널
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [npName, setNpName] = useState('');
  const [npPhone, setNpPhone] = useState('');
  const [npBirth, setNpBirth] = useState('');
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (draft) {
      setForm({ ...draft });
      setCustomerId(null);
      setSelectedBirthDate(null);
      setShowNewPatient(false);
      setNpName('');
      setNpPhone('');
      setNpBirth('');
    }
  }, [draft]);

  /** AC-1: 이름/연락처 InlinePatientSearch에서 기존 환자 선택 */
  const handlePatientSelect = (p: PatientMatch) => {
    setForm((f) => f ? { ...f, name: p.name, phone: p.phone } : f);
    setCustomerId(p.id);
    setSelectedBirthDate(p.birth_date);
    setShowNewPatient(false);
  };

  /** 고객 선택 해제 */
  const handleClearSelection = () => {
    setCustomerId(null);
    setSelectedBirthDate(null);
  };

  /** AC-2: 신규 환자 즉석 등록 → customers INSERT → customer_id 연결 */
  const handleRegisterNew = async () => {
    if (!clinicId) return;
    if (!npName.trim()) { toast.error('이름을 입력해주세요'); return; }
    if (!npPhone.trim()) { toast.error('전화번호를 입력해주세요'); return; }
    setRegistering(true);
    const e164 = normalizeToE164(npPhone) ?? npPhone.trim();
    const { data, error } = await supabase
      .from('customers')
      .insert({
        clinic_id: clinicId,
        name: npName.trim(),
        phone: e164,
        birth_date: npBirth.trim() || null,
      })
      .select('id, name, phone, birth_date')
      .single();
    setRegistering(false);
    if (error) { toast.error('등록 실패: ' + error.message); return; }
    const c = data as PatientMatch;
    setForm((f) => f ? { ...f, name: c.name, phone: c.phone } : f);
    setCustomerId(c.id);
    setSelectedBirthDate(c.birth_date);
    setShowNewPatient(false);
    toast.success(`${c.name} 신규 환자 등록 완료`);
  };

  const handleSave = async () => {
    if (!form || !clinicId) return;
    if (!form.name.trim()) { toast.error('이름을 입력해주세요'); return; }
    setSaving(true);

    // T-20260525-foot-TIMETABLE-POST16-SLOT AC-1: 16시 이후 슬롯 최대 10건 상한 체크
    const slotHour = parseInt(form.time.split(':')[0], 10);
    if (slotHour >= 16) {
      const { count: slotCount } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('reservation_date', form.date)
        .eq('reservation_time', form.time + ':00')
        .neq('status', 'cancelled');
      if ((slotCount ?? 0) >= 10) {
        toast.error(`이 시간대는 마감입니다 (${slotCount}/10)`);
        setSaving(false);
        return;
      }
    }

    // T-20260610-foot-RESV-DUPGUARD-SAMEDAY: 동일고객 당일 예약 중복 생성 방지 (insert 직전 게이트)
    const dupPhone = (normalizeToE164(form.phone) ?? form.phone.trim()) || null;
    const isDup = await checkReservationDupSameDay(clinicId, customerId, dupPhone, form.date);
    if (isDup) {
      toast.error('이미 같은 날짜에 예약(또는 접수)이 있는 고객입니다. 기존 예약을 확인하거나 취소 후 다시 생성해 주세요.');
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: customerId ?? null,
      customer_name: form.name.trim(),
      customer_phone: (normalizeToE164(form.phone) ?? form.phone.trim()) || null,
      reservation_date: form.date,
      reservation_time: form.time + ':00',
      visit_type: form.visit_type,
      booking_memo: form.booking_memo.trim() || null, // T-20260504-foot-MEMO-RESTRUCTURE
      status: 'confirmed',
      created_by: createdBy,
    });
    setSaving(false);
    if (error) { toast.error('예약 생성 실패: ' + error.message); return; }
    toast.success(`${form.name} ${form.time} 예약이 생성되었어요`);
    onCreated();
    onClose();
  };

  /** 생년월일 포맷 (YYMMDD → YY/MM/DD) */
  const formatBirthDisplay = (b: string | null): string => {
    if (!b) return '';
    if (/^\d{6}$/.test(b)) return `${b.slice(0, 2)}/${b.slice(2, 4)}/${b.slice(4, 6)}`;
    return b;
  };

  const timeSlots = generateSlots('10:00', '20:00', 30);

  return (
    <Dialog open={!!draft} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">빠른 예약 추가</DialogTitle>
        </DialogHeader>
        {form && (
          <div className="space-y-3 pt-1">
            {/* 날짜 + 시간 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">날짜</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => f ? { ...f, date: e.target.value } : f)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">시간</Label>
                <select
                  value={form.time}
                  onChange={(e) => setForm((f) => f ? { ...f, time: e.target.value } : f)}
                  className="w-full h-8 border rounded-md text-sm px-2 bg-white"
                >
                  {timeSlots.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* AC-3: 방문유형 한글 버튼 [초진][재진][체험] */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">방문유형</Label>
              <div className="flex gap-1.5">
                {(['new', 'returning', 'experience'] as VisitType[]).map((vt) => (
                  <button
                    key={vt}
                    type="button"
                    onClick={() => setForm((f) => f ? { ...f, visit_type: vt } : f)}
                    className={cn(
                      'flex-1 rounded-md border py-1.5 text-xs font-medium transition',
                      form.visit_type === vt
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'border-gray-200 hover:border-teal-400 text-gray-700 bg-white',
                    )}
                  >
                    {VISIT_TYPE_KO[vt]}
                  </button>
                ))}
              </div>
            </div>

            {/* AC-1: 이름 — InlinePatientSearch (이름 검색, debounce 300ms, 2자↑) */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">이름으로 검색</Label>
              <InlinePatientSearch
                value={form.name}
                onChange={(v) => {
                  setForm((f) => f ? { ...f, name: v } : f);
                  if (customerId) handleClearSelection();
                }}
                onSelect={handlePatientSelect}
                onClearSelection={handleClearSelection}
                searchField="name"
                clinicId={clinicId}
                selectedCustomerId={customerId}
                placeholder="홍길동"
                autoFocus
              />
            </div>

            {/* AC-1: 연락처 — InlinePatientSearch (연락처 검색, debounce 300ms, 4자리↑) */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">연락처로 검색</Label>
              <InlinePatientSearch
                value={form.phone}
                onChange={(v) => {
                  setForm((f) => f ? { ...f, phone: v } : f);
                  if (customerId) handleClearSelection();
                }}
                onSelect={handlePatientSelect}
                onClearSelection={handleClearSelection}
                searchField="phone"
                clinicId={clinicId}
                selectedCustomerId={customerId}
                placeholder="010-1234-5678"
                inputMode="tel"
              />
            </div>

            {/* 선택된 기존 환자 생년월일 표시 */}
            {customerId && selectedBirthDate && (
              <div className="flex items-center gap-1.5 rounded-md bg-teal-50 border border-teal-200 px-2.5 py-1.5">
                <span className="text-[10px] text-teal-600 font-medium">생년월일</span>
                <span className="text-[11px] text-teal-700 font-semibold">{formatBirthDisplay(selectedBirthDate)}</span>
              </div>
            )}

            {/* AC-2: 신규 환자 즉석 등록 */}
            {!customerId && !showNewPatient && (
              <button
                type="button"
                onClick={() => { setShowNewPatient(true); setNpName(form.name); setNpPhone(form.phone); }}
                className="text-xs text-teal-600 hover:text-teal-700 hover:underline underline-offset-2 transition"
              >
                + 신규 환자 등록
              </button>
            )}
            {showNewPatient && (
              <div className="rounded-md border border-teal-200 bg-teal-50/40 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold text-teal-700">신규 환자 즉석 등록</div>
                <Input
                  value={npName}
                  onChange={(e) => setNpName(e.target.value)}
                  placeholder="이름 *"
                  className="h-8 text-sm"
                />
                <Input
                  value={npPhone}
                  onChange={(e) => setNpPhone(e.target.value)}
                  placeholder="010-1234-5678 *"
                  inputMode="tel"
                  className="h-8 text-sm"
                />
                <Input
                  value={npBirth}
                  onChange={(e) => setNpBirth(e.target.value)}
                  placeholder="생년월일 (선택, 예: 901231)"
                  className="h-8 text-sm"
                />
                <div className="flex gap-2 pt-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setShowNewPatient(false)}
                  >
                    취소
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="text-xs h-7 bg-neutral-800 hover:bg-neutral-900 text-white"
                    onClick={handleRegisterNew}
                    disabled={registering}
                  >
                    {registering ? '등록 중…' : '등록 후 예약 연결'}
                  </Button>
                </div>
              </div>
            )}

            {/* AC-4: 예약메모 — T-20260504-foot-MEMO-RESTRUCTURE */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">예약메모 (예약경로 등)</Label>
              <Textarea
                value={form.booking_memo}
                onChange={(e) => setForm((f) => f ? { ...f, booking_memo: e.target.value } : f)}
                placeholder="예: 인스타그램 광고, 지인 소개, 인바운드 전화 등"
                className="min-h-[56px] text-sm resize-none"
              />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="bg-neutral-800 hover:bg-neutral-900 text-white"
          >
            {saving ? '저장 중…' : '예약 생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const clinic = useClinic();
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [6]: 사이드바 달력에서 날짜 클릭(대시보드 한정) 시
  //   CalendarNoticePanel이 /admin?date=YYYY-MM-DD 로 네비게이트 → 이 param 존재 시 하단 인라인
  //   현황 패널을 띄운다. 페이지 이동·대시보드 본문 date state 변경 없음(현황 미리보기 전용).
  const dateDetailParam = new URLSearchParams(location.search).get('date');
  const [date, setDate] = useState<Date>(() => new Date());
  // T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA (P0-A 근본 하드닝):
  //   24/7 접수 태블릿이 자정을 넘기면 마운트 시점 new Date()로 잡힌 date가 '어제'로 stale 고정된다.
  //   → isPast=true → 타임라인 카드 onClick이 undefined로 묶여 초진 차트 클릭이 무반응
  //     (에러·빈화면 없는 silent fail). 매일 아침 재현되는 recurring 근본 원인.
  //   사용자가 날짜를 수동 변경(이전/다음/캘린더)하지 않은 '오늘 추적' 모드에서만
  //   자정 경계에서 date를 오늘로 자동 롤오버한다(의도적으로 고른 과거/미래 날짜는 존중).
  const dateUserPinnedRef = useRef(false);
  useEffect(() => {
    const rollover = setInterval(() => {
      if (dateUserPinnedRef.current) return;
      const today = new Date();
      setDate((d) => (isSameDay(d, today) ? d : today));
    }, 60_000);
    return () => clearInterval(rollover);
  }, []);
  const [tab, setTab] = useState<TabKey>('all');
  const [rows, setRows] = useState<CheckIn[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  // T-20260613-foot-FIELDBATCH item6: assignCarryOver 인디케이터 state 제거(시각 라벨 삭제에 동반).
  //   공간배정 carry-over 데이터 적용 로직(eff.hasToday 게이트)은 fetchAssignments 내부에서 독립적으로 유지.
  // T-20260523-foot-SPACE-DASH-AUTOSYNC AC-B1: 당일 비활성 방 이름 집합
  const [inactiveRooms, setInactiveRooms] = useState<Set<string>>(new Set());
  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-8: 내일치 비활성 방 이름 집합
  const [tomorrowInactiveRooms, setTomorrowInactiveRooms] = useState<Set<string>>(new Set());
  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-6: staff 담당 방 이름 집합
  const [myAssignedRoomNames, setMyAssignedRoomNames] = useState<Set<string>>(new Set());
  // T-20260524-foot-ROOM-NEXTDAY-STAFF AC-4: 현재 사용자의 staff.id (staff 권한 방 필터링용)
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  // T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (A안): "내 담당" 배지용 본인 staff.id.
  //   myStaffId(위)는 role==='staff' 한정(방 토글 권한용)이라 상담사/치료사(별도 role) 미커버 →
  //   배지엔 role 무관 매칭(staff.user_id=profile.id)의 별도 state 사용.
  const [myAssignStaffId, setMyAssignStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<CheckIn | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [selectedCheckIn, setSelectedCheckIn] = useState<CheckIn | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CheckIn | null>(null);
  const [paymentInitialMode, setPaymentInitialMode] = useState<'single' | 'package'>('single');
  // T-20260514-foot-PAYMENT-CONSECUTIVE-STUCK BUG4 fix:
  // 같은 check-in 연속 결제 시에도 강제 리마운트 — key에 counter 포함
  const [paymentAttemptCounter, setPaymentAttemptCounter] = useState(0);
  const [miniPayAttemptCounter, setMiniPayAttemptCounter] = useState(0);
  // T-20260515-foot-PAYMENT-MINI-WINDOW: 결제 미니창 (수납대기 [결제하기])
  const [miniPayTarget, setMiniPayTarget] = useState<CheckIn | null>(null);
  // AC-7: 수납대기 check_in_services 합산 (check_in_id → pending amount)
  const [pendingServiceMap, setPendingServiceMap] = useState<Map<string, number>>(new Map());
  const [dayPayments, setDayPayments] = useState<Map<string, number>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ checkIn: CheckIn; pos: { x: number; y: number } } | null>(null);
  const [customerMenu, setCustomerMenu] = useState<{ checkIn: CheckIn; pos: { x: number; y: number } } | null>(null);
  // T-20260606-foot-CTXMENU-SMS-SEND: 우클릭 [문자] 수동 발송 대상
  const [smsTarget, setSmsTarget] = useState<CheckIn | null>(null);
  // T-20260525-foot-RESV-CANCEL-CTX: 타임라인 예약 박스 컨텍스트메뉴 상태
  const [resvContextMenu, setResvContextMenu] = useState<{ reservation: Reservation; pos: { x: number; y: number } } | null>(null);
  // T-20260524-foot-TIMETABLE-TIME-CONFIRM: 시간 변경 확인 대기 상태
  const [pendingTimeChange, setPendingTimeChange] = useState<{
    reservationId: string;
    newTimeStr: string;        // HH:MM:SS
    reservation: Reservation;
    oldTime: string;           // HH:MM (표시용)
    newTime: string;           // HH:MM (표시용)
    visitType: VisitType;      // 'new' | 'returning'
  } | null>(null);
  // T-20260525-foot-RESV-CHANGE-REASON: 시간 변경 모달 사유 입력값 (optional)
  const [pendingChangeReason, setPendingChangeReason] = useState<string>('');
  // T-20260516-foot-CHART2-STATE-UNIFY: dashChartSheetId 제거 → AdminLayout ChartContext 사용
  // LOGIC-LOCK: L-004 [CHART-LOCK-009] — openChart 호출은 useChart() 경유만. 직접 ChartContext 접근 금지.
  const { openChart: ctxOpenChart, closeChart: ctxCloseChart } = useChart();
  // T-20260515-foot-CONTEXT-MENU-4ITEM: 진료차트 패널 상태
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  const [medicalChartCustomerId, setMedicalChartCustomerId] = useState<string | null>(null);
  const [stageStartMap, setStageStartMap] = useState<Map<string, string>>(new Map());
  // T-20260616-foot-CALLLIST-ENTRYORDER-FALLBACK-RECEIPTLEAK (옵션 A, read-side no-DDL):
  //   진료콜 명단 진입순 폴백 2순위 전용 맵 — check_in_id → 명단 active 전환(to_status∈healer_waiting/purple/yellow)
  //   최신 transitioned_at. stageStartMap(임의 to_status 최신, 위치라벨용)과 의도적으로 분리 — 의미·소비처가 다름
  //   (stageStartMap 회귀 금지). fetchStageStarts의 *동일 fetch*에서 additive로 파생(라운드트립 추가 없음).
  const [callEntryMap, setCallEntryMap] = useState<Map<string, string>>(new Map());
  const [pkgMap, setPkgMap] = useState<Map<string, PackageLabel>>(new Map());
  // T-20260522-foot-PKG-BOX-INDICATOR: 잔여>0인 활성 패키지 보유 고객 ID 집합
  const [pkgHolderSet, setPkgHolderSet] = useState<Set<string>>(new Set());
  // T-20260623-foot-PKGBOX-PODOLOGE-BADGE: 활성 패키지 중 포돌로게(podologe_sessions>0) 보유 고객 ID 집합
  const [podologeHolderSet, setPodologeHolderSet] = useState<Set<string>>(new Set());
  // T-20260522-foot-ALT-BADGE: ALT 활성 고객 ID 집합
  const [altHolderSet, setAltHolderSet] = useState<Set<string>>(new Set());
  // T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 고객 customer_id → 미수금 Map (소스=footBilling SSOT)
  const [outstandingMap, setOutstandingMap] = useState<Map<string, CustomerOutstanding>>(new Map());
  // T-20260522-foot-LASER-TIMER AC-3/5: 활성 타이머 맵 checkInId → endsAt
  const [activeTimersMap, setActiveTimersMap] = useState<Map<string, Date>>(new Map());
  const [consentMap, setConsentMap] = useState<Map<string, ConsentEntry>>(new Map());
  const [checklistDone, setChecklistDone] = useState<Set<string>>(new Set());
  const [therapists, setTherapists] = useState<Staff[]>([]);
  // T-20260522-foot-TIMETABLE-FOLD: 치료사별 뷰 — therapist ID → {name} 맵
  const therapistNameMap = useMemo(() => {
    const m = new Map<string, { name: string }>();
    for (const s of therapists) m.set(s.id, { name: s.name });
    return m;
  }, [therapists]);
  // ── 달력 + 타임라인 상태 ──────────────────────────────────────────────────────
  // T-20260522-foot-TIMETABLE-FOLD: localStorage 기반 접기/펼치기 상태
  const [timelineFolded, setTimelineFolded] = useState<boolean>(() => {
    try { return localStorage.getItem('foot-crm-timeline-folded') === 'true'; } catch { return false; }
  });
  const handleToggleTimeline = useCallback(() => {
    setTimelineFolded((prev) => {
      const next = !prev;
      try { localStorage.setItem('foot-crm-timeline-folded', String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // T-20260522-foot-TABLET-DUAL-LAYOUT: AC-2 portrait 자동 fold / AC-1 landscape 복원
  // AC-3: fold state만 조정 — 작성 중 폼 데이터(rows/payments/quickResvDraft 등)는 건드리지 않음
  const orientation = useOrientation();
  useEffect(() => {
    if (orientation === 'portrait') {
      // portrait 진입: 타임라인 자동 접기 (차트 영역 최대화)
      setTimelineFolded(true);
    } else {
      // landscape 복원: localStorage 저장값 우선 (사용자 수동 설정 보존)
      try {
        const saved = localStorage.getItem('foot-crm-timeline-folded');
        setTimelineFolded(saved === 'true');
      } catch {
        setTimelineFolded(false);
      }
    }
  }, [orientation]);

  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [quickResvDraft, setQuickResvDraft] = useState<QuickResvDraft | null>(null);
  const [timelineReservations, setTimelineReservations] = useState<Reservation[]>([]);
  /** 셀프접수 walk-in 체크인 (reservation_id 없는 당일 체크인) — 통합 시간표용 */
  const [selfCheckIns, setSelfCheckIns] = useState<CheckIn[]>([]);
  /** reservation_id → reservation_time (HH:MM:SS) — CustomerHoverCard 예약시간 표시용 */
  const resvTimeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of timelineReservations) {
      if (r.id && r.reservation_time) m.set(r.id, r.reservation_time);
    }
    return m;
  }, [timelineReservations]);
  // T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT AC-2: 완료 슬롯 정시그룹 펼침 상태(기본 전부 접힘).
  //   Set<"HH"> — 펼친 시간대만 보관. 기본 빈 Set = 모두 collapsed.
  const [expandedDoneHours, setExpandedDoneHours] = useState<Set<string>>(() => new Set());
  const toggleDoneHour = useCallback((hourKey: string) => {
    setExpandedDoneHours((prev) => {
      const next = new Set(prev);
      if (next.has(hourKey)) next.delete(hourKey);
      else next.add(hourKey);
      return next;
    });
  }, []);
  const calendarRef = useRef<HTMLDivElement>(null);
  const recentlyUpdated = useRef<Set<string>>(new Set());
  const navStateConsumed = useRef(false);
  // T-20260510-foot-DASH-SLOT-REWORK-P0 AC4: 셀프접수 시 차트 자동 열림
  // 키오스크에서 새 고객이 접수 완료하면 Realtime INSERT 감지 → CRM 대시보드에서 자동으로 차트 열기
  const pendingAutoOpenId = useRef<string | null>(null);

  // ── 당일 예약 전용 검색 상태 (T-20260504-foot-SEARCH-SPLIT) ──────────────────
  const [todaySearchQ, setTodaySearchQ] = useState('');
  const [todaySearchOpen, setTodaySearchOpen] = useState(false);
  const [todaySearchResults, setTodaySearchResults] = useState<Reservation[]>([]);
  const [todayCustomerChartMap, setTodayCustomerChartMap] = useState<Map<string, string>>(new Map());
  const todaySearchRef = useRef<HTMLInputElement>(null);
  const todaySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todaySearchWrapRef = useRef<HTMLDivElement>(null);

  // ── 줌 + 레이아웃 편집 상태 ──────────────────────────────────────────────────
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = localStorage.getItem('foot-dash-zoom');
    const n = saved ? Number(saved) : 100;
    return Number.isFinite(n) && n >= 50 && n <= 150 ? n : 100;
  });
  const [groupOrder, setGroupOrder] = useState<KanbanGroupId[]>(() => {
    try {
      const saved = localStorage.getItem('foot-dash-group-order');
      if (saved) {
        let parsed = JSON.parse(saved) as string[];
        // T-20260511-foot-DASH-BATCH-INDIVIDUAL: waiting_columns → 3개 분리 마이그레이션
        // 기존 저장값에 waiting_columns가 있으면 그 자리에 3개를 in-place 삽입
        if (parsed.includes('waiting_columns') && !parsed.includes('treatment_waiting_col')) {
          const idx = parsed.indexOf('waiting_columns');
          parsed = [
            ...parsed.slice(0, idx),
            'treatment_waiting_col',
            'laser_waiting_col',
            'healer_waiting_col',
            ...parsed.slice(idx + 1),
          ];
        }
        // 저장된 순서가 유효한지 검증 (알 수 없는 ID 제거, 누락된 ID 뒤에 추가)
        const valid = parsed.filter((id): id is KanbanGroupId =>
          (DEFAULT_GROUP_ORDER as readonly string[]).includes(id),
        );
        const missing = DEFAULT_GROUP_ORDER.filter((id) => !valid.includes(id));
        let merged = [...valid, ...missing] as KanbanGroupId[];
        // T-20260430-foot-LASER-ROOM-REORDER: 치료실은 항상 레이저실보다 앞에 위치
        const treatIdx = merged.indexOf('treatment_rooms');
        const laserIdx = merged.indexOf('laser_rooms');
        if (treatIdx !== -1 && laserIdx !== -1 && laserIdx < treatIdx) {
          merged.splice(laserIdx, 1);
          merged.splice(treatIdx, 0, 'laser_rooms');
        }
        // T-20260511-foot-DASH-BATCH-INDIVIDUAL v2: laser_rooms 는 항상 마지막
        merged = ensureLaserRoomsLast(merged);
        merged = ensureReceivingFirst(merged); // AC-5: 접수중 항상 맨 앞
        return merged;
      }
    } catch {}
    return [...DEFAULT_GROUP_ORDER];
  });
  const [isLayoutEdit, setIsLayoutEdit] = useState(false);

  // T-20260519-foot-SLOT-BATCH-EDIT: 상담 슬롯 배치편집 상태
  // T-20260614-foot-SLOT-CRUD-ALLTYPES: 전 슬롯타입(진료/상담/치료/레이저)으로 일반화.
  //   addSlotType 으로 추가 대상 room_type 을 추적, defaultRoomIds 는 최초 로드된 전 타입 방 캡처.
  const [slotBatchEditMode, setSlotBatchEditMode] = useState(false);
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [addSlotName, setAddSlotName] = useState('');
  const [addSlotLoading, setAddSlotLoading] = useState(false);
  const [addSlotType, setAddSlotType] = useState<string>('consultation');
  const [defaultRoomIds, setDefaultRoomIds] = useState<Set<string>>(new Set());
  const defaultRoomsInitialized = useRef(false);

  const handleZoom = useCallback((delta: number) => {
    setZoomLevel((prev) => {
      const next = Math.min(150, Math.max(50, prev + delta));
      localStorage.setItem('foot-dash-zoom', String(next));
      return next;
    });
  }, []);

  const handleGroupSortEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setGroupOrder((prev) => {
      const oldIdx = prev.indexOf(active.id as KanbanGroupId);
      const newIdx = prev.indexOf(over.id as KanbanGroupId);
      if (oldIdx === -1 || newIdx === -1) return prev;
      let next = arrayMove(prev, oldIdx, newIdx);
      // T-20260430-foot-LASER-ROOM-REORDER: 레이저실은 치료실 뒤에만 배치 가능
      const treatIdx = next.indexOf('treatment_rooms');
      const laserIdx = next.indexOf('laser_rooms');
      if (treatIdx !== -1 && laserIdx !== -1 && laserIdx < treatIdx) {
        toast.warning('레이저실은 치료실 뒤에만 배치할 수 있어요');
        return prev;
      }
      // T-20260511-foot-DASH-BATCH-INDIVIDUAL v2: laser_rooms 는 항상 마지막
      // 드래그 결과로 laser_rooms 뒤에 항목이 생기면 laser_rooms 앞으로 자동 교정
      next = ensureLaserRoomsLast(next);
      next = ensureReceivingFirst(next); // AC-5: 접수중 항상 맨 앞
      localStorage.setItem('foot-dash-group-order', JSON.stringify(next));
      return next;
    });
  }, []);

  // T-20260515-foot-DASH-SLOT-DRAG: 예약 시간 변경 실행 (낙관적 업데이트 + 감사 로그)
  // T-20260525-foot-RESV-CHANGE-REASON: changeReason optional 파라미터 추가
  const executeSlotDrag = useCallback(async (
    reservationId: string,
    newTimeStr: string,   // HH:MM:SS
    currentReservation: Reservation,
    changeReason?: string,  // optional — NULL 허용
  ) => {
    const oldTime = currentReservation.reservation_time.slice(0, 5);
    const newTime = newTimeStr.slice(0, 5);
    if (oldTime === newTime) return;

    // 낙관적 업데이트
    setTimelineReservations((prev) =>
      prev.map((r) => r.id === reservationId ? { ...r, reservation_time: newTimeStr } : r),
    );

    const { error } = await supabase
      .from('reservations')
      .update({ reservation_time: newTimeStr })
      .eq('id', reservationId);

    if (error) {
      // 실패 시 롤백
      setTimelineReservations((prev) =>
        prev.map((r) => r.id === reservationId ? currentReservation : r),
      );
      toast.error(`시간 변경 실패: ${error.message}`);
      return;
    }

    // 감사 로그 (reservation_logs.action = 'reschedule')
    // T-20260525-foot-RESV-CHANGE-REASON: change_reason 저장 (미입력=NULL, 500자 제한)
    await supabase.from('reservation_logs').insert({
      reservation_id: reservationId,
      clinic_id: currentReservation.clinic_id,
      action: 'reschedule',
      old_data: { date: currentReservation.reservation_date, time: oldTime },
      new_data: { date: currentReservation.reservation_date, time: newTime },
      changed_by: profile?.id ?? null,
      change_reason: changeReason?.trim() || null,
    });

    // T-20260522-foot-SLOT-TIMETABLE-POPUP AC-2: 성공 토스트 제거 (시각적 반영으로 충분)
  }, [profile, setTimelineReservations]);

  // ── T-20260526-foot-LAYOUT-USER-CUSTOM: 레이아웃 저장값 적용 헬퍼 ────────────
  // DB/personal 어디서 로드하든 동일한 검증·정규화 로직 재사용
  const applyStoredLayout = useCallback(
    (stored: { groupOrder?: string[]; zoomLevel?: number }) => {
      if (Array.isArray(stored.groupOrder)) {
        let rawOrder = stored.groupOrder;
        // waiting_columns → 3개 분리 마이그레이션 (T-20260511)
        if (rawOrder.includes('waiting_columns') && !rawOrder.includes('treatment_waiting_col')) {
          const idx = rawOrder.indexOf('waiting_columns');
          rawOrder = [
            ...rawOrder.slice(0, idx),
            'treatment_waiting_col',
            'laser_waiting_col',
            'healer_waiting_col',
            ...rawOrder.slice(idx + 1),
          ];
        }
        const valid = rawOrder.filter((id): id is KanbanGroupId =>
          (DEFAULT_GROUP_ORDER as readonly string[]).includes(id),
        );
        const missing = DEFAULT_GROUP_ORDER.filter((id) => !valid.includes(id));
        let merged = [...valid, ...missing] as KanbanGroupId[];
        // T-20260430: 치료실 항상 레이저실보다 앞
        const treatIdx = merged.indexOf('treatment_rooms');
        const laserIdx = merged.indexOf('laser_rooms');
        if (treatIdx !== -1 && laserIdx !== -1 && laserIdx < treatIdx) {
          merged.splice(laserIdx, 1);
          merged.splice(treatIdx, 0, 'laser_rooms');
        }
        // T-20260511 v2: laser_rooms 항상 마지막
        merged = ensureLaserRoomsLast(merged);
        merged = ensureReceivingFirst(merged); // AC-5: 접수중 항상 맨 앞
        setGroupOrder(merged);
        localStorage.setItem('foot-dash-group-order', JSON.stringify(merged));
      }
      if (
        typeof stored.zoomLevel === 'number' &&
        Number.isFinite(stored.zoomLevel) &&
        stored.zoomLevel >= 50 &&
        stored.zoomLevel <= 150
      ) {
        setZoomLevel(stored.zoomLevel);
        localStorage.setItem('foot-dash-zoom', String(stored.zoomLevel));
      }
    },
    [],
  );

  // T-20260526-foot-LAYOUT-USER-CUSTOM: 개인 레이아웃만 초기화 (지점 기본은 유지)
  const resetGroupOrder = useCallback(async () => {
    // 1) 개인 오버라이드 행 삭제 (RLS: 자기 행만)
    if (clinic && profile) {
      await supabase
        .from('user_dashboard_layout_overrides')
        .delete()
        .eq('clinic_id', clinic.id)
        .eq('user_id', profile.id);
    }
    // 2) 지점 기본 레이아웃을 다시 로드해 표시 (없으면 코드 기본값)
    let loaded = false;
    if (clinic) {
      try {
        const { data } = await supabase
          .from('clinic_dashboard_layouts')
          .select('layout_data')
          .eq('clinic_id', clinic.id)
          .maybeSingle();
        if (data?.layout_data) {
          applyStoredLayout(data.layout_data as { groupOrder?: string[]; zoomLevel?: number });
          loaded = true;
        }
      } catch { /* 무시 */ }
    }
    if (!loaded) {
      setGroupOrder([...DEFAULT_GROUP_ORDER]);
      localStorage.removeItem('foot-dash-group-order');
      setZoomLevel(100);
      localStorage.removeItem('foot-dash-zoom');
    }
    toast.message('내 배치가 초기화됐어요');
  }, [clinic, profile, applyStoredLayout]);

  // T-20260526-foot-LAYOUT-USER-CUSTOM: 개인→지점 기본→코드 기본 3단계 폴백으로 레이아웃 로드
  // clinic + profile 로딩 후 1회 실행 — 실패 시 localStorage 폴백 유지
  useEffect(() => {
    if (!clinic || !profile) return;
    (async () => {
      try {
        // Step 1: 개인 오버라이드 조회
        const { data: personal } = await supabase
          .from('user_dashboard_layout_overrides')
          .select('layout_data')
          .eq('clinic_id', clinic.id)
          .eq('user_id', profile.id)
          .maybeSingle();

        if (personal?.layout_data) {
          applyStoredLayout(personal.layout_data as { groupOrder?: string[]; zoomLevel?: number });
          return; // 개인 레이아웃 적용 완료
        }

        // Step 2: 지점 기본 레이아웃 조회
        const { data: clinicDefault } = await supabase
          .from('clinic_dashboard_layouts')
          .select('layout_data')
          .eq('clinic_id', clinic.id)
          .maybeSingle();

        if (clinicDefault?.layout_data) {
          applyStoredLayout(clinicDefault.layout_data as { groupOrder?: string[]; zoomLevel?: number });
          return; // 지점 기본 레이아웃 적용 완료
        }

        // Step 3: DB에 없으면 코드 기본값(localStorage lazy init에서 이미 로드됨) 유지
      } catch {
        // DB 조회 실패 — localStorage 폴백 유지 (useState lazy init에서 이미 로드됨)
      }
    })();
  }, [clinic, profile, applyStoredLayout]);

  // T-20260526-foot-LAYOUT-USER-CUSTOM: 개인 레이아웃 저장 (모든 계정, 자기 user_id)
  const savePersonalLayoutToDb = useCallback(
    async (order: KanbanGroupId[], zoom: number) => {
      if (!clinic || !profile) return;
      const { error } = await supabase
        .from('user_dashboard_layout_overrides')
        .upsert(
          {
            clinic_id: clinic.id,
            user_id: profile.id,
            layout_data: { groupOrder: order, zoomLevel: zoom },
            saved_at: new Date().toISOString(),
          },
          { onConflict: 'clinic_id,user_id' },
        );
      if (error) {
        toast.error('내 배치 저장 실패 (로컬엔 저장됨)');
      } else {
        toast.message('내 배치가 저장됐어요.');
      }
    },
    [clinic, profile],
  );

  // T-20260526-foot-LAYOUT-USER-CUSTOM: 지점 기본 레이아웃 저장 (admin 전용)
  const saveClinicDefaultLayoutToDb = useCallback(
    async (order: KanbanGroupId[], zoom: number) => {
      if (!clinic || !profile) return;
      const { error } = await supabase
        .from('clinic_dashboard_layouts')
        .upsert(
          {
            clinic_id: clinic.id,
            layout_data: { groupOrder: order, zoomLevel: zoom },
            saved_by: profile.id,
            saved_at: new Date().toISOString(),
          },
          { onConflict: 'clinic_id' },
        );
      if (error) {
        toast.error('지점 기본 배치 저장 실패');
      } else {
        toast.success('지점 기본 배치가 저장됐어요. 전 직원에게 적용돼요.');
      }
    },
    [clinic, profile],
  );

  // T-20260526-foot-LAYOUT-USER-CUSTOM: 편집 완료 → 개인 레이아웃 저장 (모든 로그인 계정)
  const handleLayoutEditToggle = useCallback(async () => {
    if (isLayoutEdit && profile) {
      // 편집 완료 → 개인 레이아웃으로 저장 (staff 포함 전 계정)
      await savePersonalLayoutToDb(groupOrder, zoomLevel);
    }
    setIsLayoutEdit((v) => !v);
  }, [isLayoutEdit, profile, savePersonalLayoutToDb, groupOrder, zoomLevel]);

  // T-20260510-foot-DASH-SLOT-REWORK-P0 AC4: rows 업데이트 후 pending auto-open 처리
  // 키오스크에서 셀프접수 완료 → Realtime INSERT → 리페치 후 이 useEffect가 차트 자동 열기
  // 단, 다른 차트가 이미 열려있으면 방해 금지 (직원 업무 흐름 보호)
  useEffect(() => {
    if (!pendingAutoOpenId.current) return;
    if (selectedCheckIn) return; // 이미 차트 열림 → 방해 금지
    const ci = rows.find((r) => r.id === pendingAutoOpenId.current);
    if (ci) {
      pendingAutoOpenId.current = null;
      setSelectedCheckIn(ci);
    }
  }, [rows, selectedCheckIn]);

  // F-5: Closing 미수 클릭 → Dashboard 이동 시 결제 다이얼로그 또는 상세 시트 자동 오픈
  useEffect(() => {
    if (navStateConsumed.current) return;
    if (loading) return;
    const state = location.state as
      | { openPaymentForCheckInId?: string; openCheckInId?: string }
      | null;
    if (!state) return;
    if (state.openPaymentForCheckInId) {
      const ci = rows.find((r) => r.id === state.openPaymentForCheckInId);
      if (ci) {
        setPaymentTarget(ci);
        navStateConsumed.current = true;
        window.history.replaceState({}, '');
      }
    } else if (state.openCheckInId) {
      const ci = rows.find((r) => r.id === state.openCheckInId);
      if (ci) {
        setSelectedCheckIn(ci);
        navStateConsumed.current = true;
        window.history.replaceState({}, '');
      }
    }
  }, [loading, location.state, rows]);

  // T-20260506-foot-CHART-UNIFIED-ACCESS: TouchSensor distance-only 방식으로 변경
  // 이유: delay:200ms 방식은 200ms 후 dnd-kit이 터치를 선점해 브라우저 contextmenu(롱프레스) 이벤트 억제
  // distance:8 방식은 8px 이상 이동해야 드래그 시작 → 롱프레스 시 contextmenu 자연 발생 보장
  // T-20260522-foot-CHART-TAP-DELAY: PointerSensor → MouseSensor 교체
  // 이유: PointerSensor는 마우스+터치 모두 가로챔 → 태블릿에서 distance:3px 조건에 탭이 drag로 인식됨
  //       MouseSensor(마우스 전용) + TouchSensor(터치 전용 distance:5) 분리로 충돌 제거
  //       터치 탭(<5px) → TouchSensor 미활성화 → click 정상 발화 보장
  // T-20260522-foot-DRAG-RESP-OPT AC-1: TouchSensor distance 8 → 5
  // 이유: 8px 이동 후 드래그 활성화 → 반응이 "살짝 느리다" 반복 피드백 (김주연 총괄)
  //       5px로 단축해 활성화 거리를 37.5% 줄임 → 터치→드래그 전환 체감 속도 개선
  //       5px는 여전히 accidental tap(≤3px 손가락 흔들림)과 충분히 구분됨 (MouseSensor 3px 기준 상회)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
  );

  const dateStr = useMemo(() => format(date, 'yyyy-MM-dd'), [date]);

  const fetchRooms = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('rooms')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    setRooms((data ?? []) as Room[]);
    // T-20260519-foot-SLOT-BATCH-EDIT / T-20260614-foot-SLOT-CRUD-ALLTYPES:
    //   최초 로드 시 전(全) 타입 기본 방 ID 캡처 (기본=잠금 vs 세션 내 추가=삭제 구분).
    if (!defaultRoomsInitialized.current) {
      setDefaultRoomIds(new Set(((data ?? []) as Room[]).map((r) => r.id)));
      defaultRoomsInitialized.current = true;
    }
  }, [clinic]);

  const fetchAssignments = useCallback(async () => {
    if (!clinic) return;
    // T-20260522-foot-PERF-TUNING OPT-5: select('*') → 필요 컬럼만 (페이로드 축소)
    // T-20260523-foot-SPACE-DASH-SYNC AC-1,2,3 (정정 2026-05-24): 당일 배정 없으면 마지막 저장 carry-over
    // T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (회귀 복구):
    //   기존 로직은 "당일(today) 행이 1건이라도 있으면 today 행만 사용"이라, 슬롯에서 한 방만
    //   바꿔도(부분 today INSERT) 나머지 방의 풀 carry-over가 통째로 사라져 "리셋"처럼 보였다.
    //   → baseline(today 이전 최신 날짜 스냅샷) + today 를 room_name 기준 머지(today 우선)한다.
    // T-20260611-foot-SPACE-RESET-RECUR5 (Phase B): baseline 단일 priorMax 날짜 → room_name 별
    //   prior-latest carry-over 로 교체. Staff 와 동일한 공용 lib 사용(drift 차단). 부분저장 today
    //   여도 미터치 방은 prior-latest 유지(RECUR6 차단). 페이로드 컬럼은 기존과 동일하게 한정.
    const eff = await fetchEffectiveRoomAssignments<RoomAssignment>(
      clinic.id,
      dateStr,
      'id, clinic_id, date, room_name, room_type, staff_id, staff_name',
    );

    if (eff.rows.length === 0) {
      setAssignments([]);
      return;
    }

    setAssignments(eff.rows);
    // T-20260613-foot-FIELDBATCH item6: carry-over 인디케이터 setter 제거(시각 라벨 삭제).
    //   eff.hasToday / eff.lastPriorDate 기반 데이터 적용은 위 getEffectiveAssignments에서 이미 반영됨(로직 불변).
  }, [clinic, dateStr]);

  // T-20260523-foot-SPACE-DASH-AUTOSYNC AC-B1 + T-20260523-foot-ROOM-DISABLE-TOGGLE AC-3:
  // 당일 비활성 방 로드 + carry-over 방 통합
  //   - 당일 레코드: is_active=false → 비활성 (consultation/treatment + laser)
  //   - carry-over 레코드: carry_over=true, is_active=false, 당일 레코드 없음 → 비활성 유지 (laser/heated_laser)
  const fetchInactiveRooms = useCallback(async () => {
    if (!clinic) return;

    // 1. 당일 모든 레코드 (활성/비활성 포함) — 당일 명시 상태 최우선
    const { data: todayData } = await supabase
      .from('daily_room_status')
      .select('room_name, is_active')
      .eq('clinic_id', clinic.id)
      .eq('date', dateStr);

    // 당일 레코드를 Map으로 변환
    const todayMap = new Map<string, boolean>();
    for (const r of (todayData ?? []) as { room_name: string; is_active: boolean }[]) {
      todayMap.set(r.room_name, r.is_active);
    }

    // 2. carry-over 비활성 레코드 — 날짜 무관, 가장 최근 레코드 (carry_over=true)
    //    당일 레코드가 없는 방에 한해 적용
    const { data: carryData } = await supabase
      .from('daily_room_status')
      .select('room_name, is_active, date')
      .eq('clinic_id', clinic.id)
      .eq('carry_over', true)
      .lt('date', dateStr) // 오늘 이전 레코드만 (오늘 것은 todayMap에서 처리)
      .order('date', { ascending: false });

    // carry-over: room_name별 최신 레코드 한 개만 취함
    const seen = new Set<string>();
    const carryInactive = new Set<string>();
    for (const r of (carryData ?? []) as { room_name: string; is_active: boolean; date: string }[]) {
      if (seen.has(r.room_name)) continue;
      seen.add(r.room_name);
      // 당일 레코드가 있으면 당일 상태 우선 → carry-over 무시
      if (todayMap.has(r.room_name)) continue;
      if (!r.is_active) carryInactive.add(r.room_name);
    }

    // 3. 합산: 당일 비활성 + carry-over 비활성
    const names = new Set<string>();
    for (const [roomName, isActive] of todayMap.entries()) {
      if (!isActive) names.add(roomName);
    }
    for (const roomName of carryInactive) {
      names.add(roomName);
    }

    setInactiveRooms(names);

    // AC-8: 내일치 비활성 방 조회 (오늘 + 내일 2일치만)
    const tomorrowStr = format(addDays(new Date(dateStr + 'T12:00:00'), 1), 'yyyy-MM-dd');
    const { data: tomorrowData } = await supabase
      .from('daily_room_status')
      .select('room_name, is_active')
      .eq('clinic_id', clinic.id)
      .eq('date', tomorrowStr);
    const tomorrowNames = new Set<string>();
    for (const r of (tomorrowData ?? []) as { room_name: string; is_active: boolean }[]) {
      if (!r.is_active) tomorrowNames.add(r.room_name);
    }
    setTomorrowInactiveRooms(tomorrowNames);
  }, [clinic, dateStr]);

  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-1/2/3/6/7
  // AC-6: admin/manager=전체 방, staff=본인 담당 방 토글 가능.
  // AC-8: target='today'(당일) / 'tomorrow'(내일치 사전 설정) 분기.
  // AC-3 분기: laser/heated_laser → carry_over=true (활성화 전까지 유지)
  //           그 외 → carry_over=false (당일 한정)
  // 낙관적 UI → DB upsert → 실패 시 롤백 + refetch
  const handleToggleRoom = useCallback(async (roomName: string, roomType = '', target: 'today' | 'tomorrow' = 'today') => {
    if (!clinic) return;
    // AC-8: 대상 날짜 결정
    const effectiveDate = target === 'tomorrow'
      ? format(addDays(new Date(dateStr + 'T12:00:00'), 1), 'yyyy-MM-dd')
      : dateStr;
    const isTomorrow = target === 'tomorrow';
    const currentlyInactive = isTomorrow
      ? tomorrowInactiveRooms.has(roomName)
      : inactiveRooms.has(roomName);
    const nowActive = !currentlyInactive; // 현재 active → disable, inactive → activate
    // AC-3: laser/heated_laser = carry-over, 나머지 = daily reset
    const isCarryOver = roomType === 'laser' || roomType === 'heated_laser';
    // 낙관적 업데이트
    if (isTomorrow) {
      setTomorrowInactiveRooms((prev) => {
        const next = new Set(prev);
        if (nowActive) next.add(roomName); else next.delete(roomName);
        return next;
      });
    } else {
      setInactiveRooms((prev) => {
        const next = new Set(prev);
        if (nowActive) {
          next.add(roomName); // active → inactive
        } else {
          next.delete(roomName); // inactive → active
        }
        return next;
      });
    }
    const { error } = await supabase
      .from('daily_room_status')
      .upsert(
        {
          clinic_id: clinic.id,
          date: effectiveDate,
          room_name: roomName,
          is_active: !nowActive, // nowActive=true이면 비활성화(false), 반대는 활성화(true)
          carry_over: isCarryOver && nowActive, // 비활성화 시 carry-over 여부 설정
          // T-20260524-foot-ROOM-NEXTDAY-STAFF AC-6: 비활성화 시 설정자 기록
          disabled_by: nowActive ? (myStaffId ?? null) : null,
        },
        { onConflict: 'clinic_id,date,room_name' },
      );
    if (error) {
      toast.error(`방 상태 변경 실패: ${error.message}`);
      // 롤백
      await fetchInactiveRooms();
      return;
    }
    // AC-7/AC-8: room_type별 + 날짜별 토스트 메시지
    if (nowActive) {
      const dateLabel = isTomorrow ? '내일' : '오늘';
      const msg = isCarryOver
        ? `${roomName} ${dateLabel} 비활성화 (활성화 전까지 유지)`
        : `${roomName} ${dateLabel} 비활성화`;
      toast.success(msg);
    } else {
      const dateLabel = isTomorrow ? '내일 ' : '';
      toast.success(`${roomName} ${dateLabel}활성화`);
    }
  }, [clinic, dateStr, inactiveRooms, tomorrowInactiveRooms, fetchInactiveRooms, myStaffId]);

  const fetchCheckIns = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const start = `${dateStr}T00:00:00+09:00`;
    const end = `${dateStr}T23:59:59+09:00`;
    const { data, error } = await supabase
      .from('check_ins')
      // T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: customers(name) embed → 카드 표기명 현재화
      .select('*, customers(name, chart_number)')
      .eq('clinic_id', clinic.id)
      .gte('checked_in_at', start)
      .lte('checked_in_at', end)
      .order('queue_number', { ascending: true });
    if (error) {
      toast.error('체크인 목록을 불러오지 못했습니다');
      setLoading(false);
      return;
    }
    // 24시간 이상 경과한 registered 건 필터링 (테스트 데이터 정리)
    const now = Date.now();
    const STALE_MS = 24 * 60 * 60 * 1000;
    const staleFiltered = ((data ?? []) as CheckIn[]).filter((ci) => {
      if (ci.status !== 'registered') return true;
      const age = now - new Date(ci.checked_in_at).getTime();
      return age < STALE_MS;
    });
    // T-20260610-foot-ADMIN-SIM-FILTER: 시뮬레이션 고객 체크인 칸반 숨김 (셀프접수 명단 정합).
    const filtered = await stripSimulationRows(staleFiltered);
    // T-20260519-foot-STATUS-REVERT fix: recentlyUpdated 보호 — 병렬 fetch가
    // DB 쓰기 완료 전 스냅샷을 읽어 optimistic update를 덮어쓰는 경합 방지.
    // markRecentlyUpdated 보호 중인 row는 로컬 상태 우선 유지 (2초 후 만료 → 다음 fetch에서 DB값 적용).
    setRows(prev => {
      const recentIds = recentlyUpdated.current;
      if (recentIds.size === 0) return filtered;
      return filtered.map(row =>
        recentIds.has(row.id)
          ? (prev.find(r => r.id === row.id) ?? row)
          : row,
      );
    });
    setLoading(false);

    // ── 동의서 + 체크리스트 일괄 조회 (카드 배지용) ──
    // T-20260522-foot-PERF-TUNING OPT-2: 두 쿼리 Promise.all 병렬화 (순차 대기 제거)
    const ids = filtered.map((ci) => ci.id);
    if (ids.length > 0) {
      const [consentRes, checklistRes] = await Promise.all([
        supabase
          .from('consent_forms')
          .select('check_in_id, form_type, signed_at')
          .in('check_in_id', ids)
          .in('form_type', ['refund', 'non_covered']),
        supabase
          .from('checklists')
          .select('check_in_id')
          .in('check_in_id', ids)
          .not('completed_at', 'is', null),
      ]);

      const cMap = new Map<string, ConsentEntry>();
      for (const c of (consentRes.data ?? []) as { check_in_id: string; form_type: string; signed_at: string }[]) {
        const entry = cMap.get(c.check_in_id) ?? {};
        if (c.form_type === 'refund') entry.refundAt = c.signed_at;
        if (c.form_type === 'non_covered') entry.nonCoveredAt = c.signed_at;
        cMap.set(c.check_in_id, entry);
      }
      setConsentMap(cMap);

      const clSet = new Set<string>(
        (checklistRes.data ?? []).map((c: { check_in_id: string }) => c.check_in_id),
      );
      setChecklistDone(clSet);
    } else {
      setConsentMap(new Map());
      setChecklistDone(new Set());
    }

    // ── T-20260516-foot-HEALER-RESV-BTN: healer_flag 자동 HL(노랑) 적용 ──
    // 당일 예약 중 healer_flag=true인 고객 → status_flag null/'white'인 체크인에 HL 적용 후 플래그 리셋 (1회성)
    const eligibleCis = filtered.filter(
      ci => ci.customer_id && (ci.status_flag === null || ci.status_flag === 'white'),
    );
    const eligibleCustomerIds = [...new Set(eligibleCis.map(ci => ci.customer_id!))];
    if (eligibleCustomerIds.length > 0) {
      const { data: healerResvs } = await supabase
        .from('reservations')
        .select('id, customer_id')
        .in('customer_id', eligibleCustomerIds)
        .eq('reservation_date', dateStr)
        .eq('healer_flag', true)
        .eq('clinic_id', clinic.id);
      if (healerResvs && healerResvs.length > 0) {
        const healerCidSet = new Set(healerResvs.map((r: { customer_id: string }) => r.customer_id));
        const resvIds = healerResvs.map((r: { id: string }) => r.id);
        // 매칭 체크인에 HL(노랑) 적용
        const hlCiIds = eligibleCis
          .filter(ci => ci.customer_id && healerCidSet.has(ci.customer_id))
          .map(ci => ci.id);
        if (hlCiIds.length > 0) {
          // T-20260516-foot-HEALER-RESV-BTN AC-3 FIX(2026-05-24): recentlyUpdated 보호 추가
          // 원인: status_flag=yellow DB 쓰기 후 Realtime이 fetchCheckIns를 재트리거.
          // 재트리거된 fetchCheckIns가 replica lag으로 stale(null) 데이터를 읽으면
          // optimistic yellow가 null로 덮어써지고, healer_flag는 이미 false라 재적용 불가 → HL 소실.
          // 수정: markRecentlyUpdated로 2초간 해당 check-in을 보호 → stale 덮어쓰기 방지.
          hlCiIds.forEach(id => markRecentlyUpdated(id));
          // 1회성: healer_flag 소모 (HL 적용 직전 reset — 재진입 방지)
          await supabase.from('reservations').update({ healer_flag: false }).in('id', resvIds);
          await supabase.from('check_ins').update({ status_flag: 'yellow' }).in('id', hlCiIds);
          setRows(curr => curr.map(r =>
            hlCiIds.includes(r.id) ? { ...r, status_flag: 'yellow' as StatusFlag } : r,
          ));
        } else {
          // 체크인 없는 healer_flag는 유지 (체크인 시 소모 예정)
        }
      }
    }
  }, [clinic, dateStr]);

  const fetchPayments = useCallback(async () => {
    if (!clinic) return;
    const start = `${dateStr}T00:00:00+09:00`;
    const end = `${dateStr}T23:59:59+09:00`;
    const { data } = await supabase
      .from('payments')
      .select('check_in_id, amount, payment_type')
      .eq('clinic_id', clinic.id)
      .gte('created_at', start)
      .lte('created_at', end);
    const map = new Map<string, number>();
    for (const p of (data ?? []) as { check_in_id: string | null; amount: number; payment_type: string }[]) {
      if (!p.check_in_id) continue;
      const prev = map.get(p.check_in_id) ?? 0;
      map.set(p.check_in_id, prev + (p.payment_type === 'refund' ? -p.amount : p.amount));
    }
    setDayPayments(map);
  }, [clinic, dateStr]);

  // T-20260515-foot-PAYMENT-MINI-WINDOW AC-7: 수납대기 check_in_services 합산
  const fetchPendingServices = useCallback(async () => {
    if (!clinic) return;
    // 수납대기 check_in ID 수집 (rows 기반)
    const paymentWaitingIds = rows
      .filter((ci) => ci.status === 'payment_waiting')
      .map((ci) => ci.id);
    if (paymentWaitingIds.length === 0) {
      setPendingServiceMap(new Map());
      return;
    }
    const { data } = await supabase
      .from('check_in_services')
      .select('check_in_id, price')
      .in('check_in_id', paymentWaitingIds);
    const m = new Map<string, number>();
    for (const row of (data ?? []) as { check_in_id: string; price: number }[]) {
      m.set(row.check_in_id, (m.get(row.check_in_id) ?? 0) + row.price);
    }
    setPendingServiceMap(m);
  }, [clinic, rows]);

  // 타임라인용 — 취소 제외 전체 예약 (confirmed + checked_in + noshow)
  const fetchTimelineReservations = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('reservations')
      // T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: customers(name) embed → 카드 표기명 현재화
      // T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: designated_therapist_id 추가(read-only) → 명단 "지정" 배지
      .select('*, customers(name, chart_number, designated_therapist_id)')
      .eq('clinic_id', clinic.id)
      .eq('reservation_date', dateStr)
      .neq('status', 'cancelled')
      .order('reservation_time', { ascending: true });
    // T-20260610-foot-ADMIN-SIM-FILTER: 시뮬레이션 고객 예약 타임라인 숨김.
    // (pendingReservations도 timelineReservations 파생이므로 함께 정합)
    setTimelineReservations(await stripSimulationRows((data ?? []) as Reservation[]));
  }, [clinic, dateStr]);

  // T-20260508-foot-DASH-SLOT-REMOVE: 통합시간표용 체크인 — 모든 registered 상태 포함
  // (기존: reservation_id IS NULL 워크인만 → 변경: 초진/재진 전체 registered 고객)
  const fetchSelfCheckIns = useCallback(async () => {
    if (!clinic) return;
    const start = `${dateStr}T00:00:00+09:00`;
    const end = `${dateStr}T23:59:59+09:00`;
    // T-20260511-foot-SELFCHECKIN-CRM-SYNC: consult_waiting/treatment_waiting 포함
    // DASH-SLOT-REWORK-P0 이후 셀프접수는 registered가 아닌 consult_waiting/treatment_waiting으로 직행.
    // 취소/완료 제외한 모든 활성 상태를 포함해야 타임라인 슬롯 매칭이 정상 동작.
    const { data } = await supabase
      .from('check_ins')
      // T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: customers(name) embed → 카드 표기명 현재화
      // T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: designated_therapist_id 추가(read-only) →
      //   [치료사별] 탭 그룹핑 키 + "지정" 배지 판정
      .select('*, customers(name, chart_number, designated_therapist_id)')
      .eq('clinic_id', clinic.id)
      .not('status', 'in', '("cancelled","done")')
      .in('visit_type', ['new', 'returning', 'experience'])
      .gte('checked_in_at', start)
      .lte('checked_in_at', end)
      .order('checked_in_at', { ascending: true });
    // T-20260610-foot-ADMIN-SIM-FILTER: 시뮬레이션 고객 체크인 숨김.
    setSelfCheckIns(await stripSimulationRows((data ?? []) as CheckIn[]));
  }, [clinic, dateStr]);

  // T-20260522-foot-PERF-TUNING OPT-3: pendingReservations → timelineReservations 파생 (DB round trip 1회 절감)
  // fetchReservations 제거 — timelineReservations(비취소 전체) 중 confirmed만 필터
  const pendingReservations = useMemo(
    () => timelineReservations.filter((r) => r.status === 'confirmed'),
    [timelineReservations],
  );

  const fetchStageStarts = useCallback(async () => {
    if (!clinic) return;
    const start = `${dateStr}T00:00:00+09:00`;
    const end = `${dateStr}T23:59:59+09:00`;
    const { data } = await supabase
      .from('status_transitions')
      .select('check_in_id, to_status, transitioned_at')
      .eq('clinic_id', clinic.id)
      .gte('transitioned_at', start)
      .lte('transitioned_at', end)
      .order('transitioned_at', { ascending: false });
    // check_in_id별 가장 최근 전이 = 현재 섹션 진입 시각
    const map = new Map<string, string>();
    // T-20260616-foot-CALLLIST-ENTRYORDER-FALLBACK-RECEIPTLEAK: 동일 fetch에서 진료콜 진입순 폴백 2순위 맵도 파생.
    //   명단 active 전환(to_status∈healer_waiting/purple/yellow)의 *최초* transitioned_at을 담는다.
    //   ⚠ REOPEN 회귀정정: 기존엔 '최신' transitioned_at(desc 첫 매치)을 썼으나, 재진입 시 진입시각이 밀려
    //     먼저 진입한 환자가 아래로 가라앉는 결함과 동일 — DoctorCallListBar tier① '에피소드 시작' 의미와 정합되도록
    //     '먼저 진입한 사람이 1순위' = 최초 active 전환시각으로 통일. data가 desc 정렬이므로 무조건 덮어쓰면 최종=최이른값.
    //   healer_waiting처럼 status 전환만 되고 status_flag_history가 비는 케이스의 진입(activation)시각 복구용.
    //   (purple/yellow는 flag라 transition row가 통상 없으나, 향후 호환 위해 set에 포함 — 없으면 자연 미반영.)
    //   ※ stageStartMap(map, 임의 to_status 최신·위치라벨용)은 회귀 금지라 '최신' 유지 — callEntry만 '최초'로 분리.
    const callEntry = new Map<string, string>();
    for (const t of (data ?? []) as { check_in_id: string; to_status: string; transitioned_at: string }[]) {
      if (!map.has(t.check_in_id)) map.set(t.check_in_id, t.transitioned_at);
      if (t.to_status === 'healer_waiting' || t.to_status === 'purple' || t.to_status === 'yellow') {
        callEntry.set(t.check_in_id, t.transitioned_at); // desc 순회 + 무조건 덮어쓰기 → 최종값=최초(가장 이른) 진입.
      }
    }
    setStageStartMap(map);
    setCallEntryMap(callEntry);
  }, [clinic, dateStr]);

  const fetchPackageLabels = useCallback(async () => {
    if (!clinic) return;
    const { data: pkgs } = await supabase
      .from('packages')
      .select('id, customer_id, package_name, total_sessions, podologe_sessions')
      .eq('clinic_id', clinic.id)
      .eq('status', 'active');
    if (!pkgs || pkgs.length === 0) { setPkgMap(new Map()); setPkgHolderSet(new Set()); setPodologeHolderSet(new Set()); return; }

    const pkgIds = pkgs.map((p: { id: string }) => p.id);
    // T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN: 활성 패키지가 누적(클리닉당 수백건)되면
    //   .in('package_id', pkgIds) 단일 쿼리의 GET URL 길이가 서버 한계를 초과해 400 발생 →
    //   대시보드 패키지 잔여 배지가 전 환자에서 조용히 사라짐. id 목록을 배치(150)로 쪼개 합산한다.
    const IN_CHUNK = 150;
    const usedMap = new Map<string, number>();
    for (let i = 0; i < pkgIds.length; i += IN_CHUNK) {
      const slice = pkgIds.slice(i, i + IN_CHUNK);
      const { data: sessions } = await supabase
        .from('package_sessions')
        .select('package_id')
        .in('package_id', slice)
        .eq('status', 'used');
      for (const s of (sessions ?? []) as { package_id: string }[]) {
        usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
      }
    }

    const map = new Map<string, PackageLabel>();
    // T-20260522-foot-PKG-BOX-INDICATOR: 잔여>0 고객 ID 집합 (배치 조인, 추가 DB 쿼리 없음)
    const holderSet = new Set<string>();
    // T-20260623-foot-PKGBOX-PODOLOGE-BADGE: 활성 패키지 중 포돌로게(podologe_sessions>0) 고객 ID 집합 (추가 DB 쿼리 없음)
    const podologeSet = new Set<string>();
    for (const p of pkgs as { id: string; customer_id: string; package_name: string; total_sessions: number; podologe_sessions: number | null }[]) {
      const used = usedMap.get(p.id) ?? 0;
      const remaining = Math.max(0, p.total_sessions - used);
      // T-20260617-foot-PKGBOX-USED-FORMAT: used 보존 → 회차 번호 표기(N=used+1)
      map.set(p.customer_id, { name: p.package_name, remaining, total: p.total_sessions, used });
      if (remaining > 0) holderSet.add(p.customer_id);
      if ((p.podologe_sessions ?? 0) > 0) podologeSet.add(p.customer_id);
    }
    setPkgMap(map);
    setPkgHolderSet(holderSet);
    setPodologeHolderSet(podologeSet);
  }, [clinic]);

  // T-20260522-foot-ALT-BADGE: ALT 활성 고객 ID 집합 조회
  const fetchAltHolders = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('clinic_id', clinic.id)
      .eq('alt_status', true);
    const s = new Set<string>((data ?? []).map((r: { id: string }) => r.id));
    setAltHolderSet(s);
  }, [clinic]);

  // T-20260522-foot-PERF-TUNING OPT-1: 3개 개별 staff 쿼리 → 1개 통합 쿼리 (2 round trip 절감)
  const [consultants, setConsultants] = useState<Staff[]>([]);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const fetchAllStaff = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .in('role', ['therapist', 'technician', 'consultant', 'director'])
      .order('name');
    const all = (data ?? []) as Staff[];
    setTherapists(all.filter((s) => s.role === 'therapist' || s.role === 'technician'));
    setConsultants(all.filter((s) => s.role === 'consultant'));
    setDoctors(all.filter((s) => s.role === 'director'));
  }, [clinic]);

  // T-20260524-foot-ROOM-NEXTDAY-STAFF AC-4: 현재 사용자의 staff.id 조회
  // staff 권한 계정이 본인 담당 방만 토글할 수 있도록 staff.id를 캐시
  const fetchMyStaffId = useCallback(async () => {
    if (!profile || profile.role !== 'staff') { setMyStaffId(null); return; }
    const { data } = await supabase
      .from('staff')
      .select('id')
      .eq('user_id', profile.id)
      .eq('active', true)
      .maybeSingle();
    setMyStaffId((data as { id: string } | null)?.id ?? null);
  }, [profile]);

  // T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY (A안): role 무관 본인 staff.id 조회 ("내 담당" 배지)
  useEffect(() => {
    if (!profile || !clinic) { setMyAssignStaffId(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('staff')
        .select('id')
        .eq('clinic_id', clinic.id)
        .eq('user_id', profile.id)
        .eq('active', true)
        .maybeSingle();
      if (!cancelled) setMyAssignStaffId((data as { id: string } | null)?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [profile, clinic]);

  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-6/AC-9: staff 담당 방 이름 집합 조회
  // room_assignments에서 본인(myStaffId) 담당 방을 가져와 canToggleRoom + isMyRoom 하이라이트에 사용
  const fetchMyAssignedRooms = useCallback(async () => {
    if (!clinic || !myStaffId) { setMyAssignedRoomNames(new Set()); return; }
    const { data } = await supabase
      .from('room_assignments')
      .select('room_name')
      .eq('clinic_id', clinic.id)
      .eq('staff_id', myStaffId);
    setMyAssignedRoomNames(new Set((data ?? []).map((r: { room_name: string }) => r.room_name)));
  }, [clinic, myStaffId]);

  const handleStaffAssign = useCallback(async (roomName: string, roomType: string, staffId: string | null, staffName: string | null) => {
    if (!clinic) return;
    // T-20260523-foot-SPACE-DASH-SYNC: fallback 데이터(이전 날짜)는 UPDATE 대신 INSERT로 처리.
    // assignments에 당일(dateStr) 레코드가 없을 경우 전날 carry-over 데이터가 담길 수 있으므로
    // date === dateStr 조건을 추가해 오늘 레코드만 existing으로 인식.
    const existing = assignments.find((a) => a.room_name === roomName && a.room_type === roomType && a.date === dateStr);
    // T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX (근본 수정):
    //   기존: 미배정(!staffId) 시 today row 를 delete() → today 스냅샷에 구멍 →
    //         다음 fetchAssignments 의 baseline(전날) carry-over 머지가 그 방을 되살림 = "리셋".
    //         (Staff.tsx handleSave 는 이미 save_room_assignments RPC + 미배정 명시 row 로 차단했으나
    //          Dashboard 의 비원자 DELETE 경로가 잔존했다.)
    //   수정: 절대 DELETE 하지 않는다. 미배정도 "명시적 미배정"(staff_id=null) row 로 남긴다.
    //         - existing(today row) 있으면 → UPDATE (staffId null 이면 명시적 미배정으로 보존)
    //         - 없으면 → INSERT (staffId null 이면 명시적 미배정 row 생성 → carry-over 차단)
    //         today row 가 항상 존재 → 읽기 머지(baseline+today, today 우선)가 carry-over 를 차단.
    //   권한 주의: save_room_assignments RPC(옵션A)는 is_admin_or_manager() 전용이라
    //         room_assignments_staff_update(staff/part_lead UPDATE) 경로를 깨뜨린다. 따라서
    //         per-row UPDATE/INSERT(옵션B 확장)로 전 역할 호환 + 데이터 보존을 유지한다.
    //   AC-5: silent 금지 — 성공/실패 토스트 노출(특히 staff 의 RLS silent 0-row 를 error 로 포착).
    let error: { message: string } | null = null;
    if (existing) {
      ({ error } = await supabase
        .from('room_assignments')
        .update({ staff_id: staffId, staff_name: staffName })
        .eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('room_assignments').insert({
        clinic_id: clinic.id,
        date: dateStr,
        room_name: roomName,
        room_type: roomType,
        staff_id: staffId,
        staff_name: staffName,
      }));
    }
    if (error) {
      toast.error(`공간 배정 저장 실패: ${error.message}`);
      return;
    }
    // AC-5 silent 금지: toast.success 는 묵음(noop)이므로 묵음 제외 채널 toast.confirm 사용.
    toast.confirm(staffId ? `${staffName ?? ''} 배정 저장됨` : '미배정 저장됨');
    fetchAssignments();
  }, [clinic, assignments, dateStr, fetchAssignments]);

  const handleTherapistChange = useCallback((roomName: string, staffId: string | null, staffName: string | null) => {
    handleStaffAssign(roomName, 'treatment', staffId, staffName);
  }, [handleStaffAssign]);

  const handleDoctorChange = useCallback((roomName: string, staffId: string | null, staffName: string | null) => {
    handleStaffAssign(roomName, 'examination', staffId, staffName);
  }, [handleStaffAssign]);

  const handleConsultantChange = useCallback((roomName: string, staffId: string | null, staffName: string | null) => {
    handleStaffAssign(roomName, 'consultation', staffId, staffName);
  }, [handleStaffAssign]);

  // T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 원장 배정 핸들러(구 handleHeatedLaserDoctorChange) 제거.

  // T-20260520-foot-LASER-DROPDOWN: 레이저실 장비명 배정 핸들러 (room_type='laser')
  const handleLaserTechChange = useCallback((roomName: string, staffId: string | null, staffName: string | null) => {
    handleStaffAssign(roomName, 'laser', staffId, staffName);
  }, [handleStaffAssign]);

  useEffect(() => {
    fetchCheckIns();
    fetchRooms();
    fetchAssignments();
    fetchInactiveRooms(); // T-20260523-foot-SPACE-DASH-AUTOSYNC AC-B1
    fetchPayments();
    fetchTimelineReservations();
    fetchSelfCheckIns();
    fetchStageStarts();
    fetchPackageLabels();
    fetchAllStaff();
    fetchAltHolders();
    fetchMyStaffId(); // T-20260524-foot-ROOM-NEXTDAY-STAFF AC-4
  }, [fetchCheckIns, fetchRooms, fetchAssignments, fetchInactiveRooms, fetchPayments, fetchTimelineReservations, fetchSelfCheckIns, fetchStageStarts, fetchPackageLabels, fetchAllStaff, fetchAltHolders, fetchMyStaffId]);

  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-6/9: myStaffId 확정 후 담당 방 이름 조회
  useEffect(() => {
    fetchMyAssignedRooms();
  }, [fetchMyAssignedRooms]);

  // T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 화면에 표시되는 고객(칸반 체크인 + 통합시간표
  //   예약/셀프접수)의 customer_id 를 모아 미수금 Map 일괄 조회(카드별 N+1 방지).
  //   산출은 footBilling.loadCustomerOutstanding(SSOT) 재사용 — 신규 산출 로직/쿼리 없음.
  //   rows/예약/체크인 변경 시 재조회 → 결제완료로 outstanding 0 전환 시 배지 자동 소거.
  useEffect(() => {
    if (!clinic) { setOutstandingMap(new Map()); return; }
    const ids = new Set<string>();
    for (const r of rows) if (r.customer_id) ids.add(r.customer_id);
    for (const ci of selfCheckIns) if (ci.customer_id) ids.add(ci.customer_id);
    for (const rv of timelineReservations) if (rv.customer_id) ids.add(rv.customer_id);
    if (ids.size === 0) { setOutstandingMap(new Map()); return; }
    let cancelled = false;
    loadCustomerOutstanding([...ids], clinic.id)
      .then((m) => { if (!cancelled) setOutstandingMap(m); })
      .catch(() => { if (!cancelled) setOutstandingMap(new Map()); });
    return () => { cancelled = true; };
  }, [clinic, rows, selfCheckIns, timelineReservations]);

  // T-20260515-foot-PAYMENT-MINI-WINDOW AC-7: rows 변경 시 수납대기 pending 금액 갱신
  useEffect(() => {
    fetchPendingServices();
  }, [fetchPendingServices]);

  useEffect(() => {
    if (!clinic) return;
    let checkInTimer: ReturnType<typeof setTimeout> | null = null;
    let assignTimer: ReturnType<typeof setTimeout> | null = null;
    let resvTimer: ReturnType<typeof setTimeout> | null = null;
    let roomsTimer: ReturnType<typeof setTimeout> | null = null; // T-20260614-foot-SLOT-CRUD-ALLTYPES

    const debouncedCheckInRefetch = () => {
      if (checkInTimer) clearTimeout(checkInTimer);
      // T-20260504-foot-SCHEDULE-UNIFIED-VIEW: 셀프접수 walk-in도 타임라인 자동 반영
      checkInTimer = setTimeout(() => { fetchCheckIns(); fetchStageStarts(); fetchSelfCheckIns(); }, 800);
    };
    const debouncedAssignRefetch = () => {
      if (assignTimer) clearTimeout(assignTimer);
      assignTimer = setTimeout(() => fetchAssignments(), 800);
    };
    const debouncedResvRefetch = () => {
      if (resvTimer) clearTimeout(resvTimer);
      resvTimer = setTimeout(() => { fetchTimelineReservations(); }, 800);
    };
    // T-20260614-foot-SLOT-CRUD-ALLTYPES: AC-5 슬롯 추가/삭제 타 단말 실시간 반영
    //   (defaultRoomsInitialized ref 가드 덕에 refetch 가 기본/커스텀 구분을 재설정하지 않음)
    const debouncedRoomsRefetch = () => {
      if (roomsTimer) clearTimeout(roomsTimer);
      roomsTimer = setTimeout(() => { fetchRooms(); }, 800);
    };

    // T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG: 계정 간 이동(레이저실 등)이 타 단말에
    //   즉시 반영 안 되거나 끝내 누락되는 문제 견고화. 근본원인 3종(코드 확정):
    //   (1) .subscribe() 재연결 핸들러 부재 → WebSocket 끊김/재연결 동안 유실된 postgres_changes 미보충,
    //   (2) 탭 백그라운드→복귀 시 강제 refetch 부재(+ background setInterval throttle),
    //   (3) 폴링 fallback이 assignments/rooms 미커버.
    //   ⚠ 쓰기(이동) 로직 무변경 — 읽기/전파(refetch) 경로만 보강.
    const fullResync = () => {
      fetchCheckIns();
      fetchSelfCheckIns();
      fetchStageStarts();
      fetchAssignments();
      fetchTimelineReservations();
      fetchRooms();
    };
    let subscribedOnce = false;

    const channel = supabase
      .channel(`dashboard_rt_${clinic.id}_${dateStr}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'check_ins', filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          const newRow = payload.new as CheckInRealtimeRow;
          const oldRow = payload.old as CheckInRealtimeRow;
          const id = newRow?.id ?? oldRow?.id;
          if (id && recentlyUpdated.current.has(id)) return;
          // T-20260531-foot-CHECKIN-DASHBOARD-SYNC: checked_in_at은 UTC(timestamptz)로 저장됨.
          // KST 오전(00:00~09:00) 셀프접수는 checked_in_at의 UTC 날짜가 전날이 되어
          // 기존 `checked_in_at.startsWith(dateStr)` 가드가 당일 realtime 이벤트(상담대기/치료대기 INSERT)를
          // 오탐 제외 → 대시보드 미반영·토스트 누락(현장 보고 07:47 KST = 22:47Z 전날 케이스).
          // created_date(트리거가 KST로 산출하는 date 컬럼)를 우선 비교하고,
          // 누락 시 checked_in_at을 KST로 환산해 당일 여부를 판정한다.
          const checkedAt = newRow?.checked_in_at ?? oldRow?.checked_in_at;
          const rowSeoulDate =
            (newRow?.created_date as string | undefined) ??
            (oldRow?.created_date as string | undefined) ??
            (checkedAt ? seoulISODate(checkedAt) : undefined);
          if (rowSeoulDate && rowSeoulDate !== dateStr) return;
          // T-20260510-foot-DASH-SLOT-REWORK-P0 AC4: 초진 셀프접수 감지 → 차트 자동 열림
          // 키오스크(anon)가 consult_waiting으로 직행 INSERT 시 CRM 대시보드 자동 오픈
          if (
            payload.eventType === 'INSERT' &&
            newRow?.status === 'consult_waiting' &&
            newRow?.visit_type === 'new' &&
            newRow?.id
          ) {
            pendingAutoOpenId.current = newRow.id;
            // T-20260617-foot-AUTOASSIGN: 셀프접수 직행 상담대기 INSERT → 상담사 자동배정(best-effort, 멱등)
            void maybeAutoAssign(newRow.id, 'consult_waiting', profile?.id ?? null);
          }
          // T-20260511-foot-SELFCHECKIN-CRM-SYNC: 재진 셀프접수 감지 → 치료대기 칸반 활성화
          // 키오스크(anon)가 treatment_waiting으로 직행 INSERT → auto-open + toast (초진과 동일 패턴)
          if (
            payload.eventType === 'INSERT' &&
            (newRow?.status as string) === 'treatment_waiting' &&
            (newRow?.visit_type as string) === 'returning' &&
            newRow?.id
          ) {
            pendingAutoOpenId.current = newRow.id;
            const name = (newRow as Record<string, unknown>)?.customer_name as string | undefined;
            toast.info(`재진 접수: ${name ?? '고객'}님 치료대기`, { duration: 6000 });
            // T-20260617-foot-AUTOASSIGN: 재진 셀프접수 직행 치료대기 INSERT → 치료사 자동배정(best-effort, 멱등)
            void maybeAutoAssign(newRow.id, 'treatment_waiting', profile?.id ?? null);
          }
          debouncedCheckInRefetch();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments', filter: `clinic_id=eq.${clinic.id}` },
        () => debouncedAssignRefetch(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinic.id}` },
        () => debouncedResvRefetch(),
      )
      // T-20260614-foot-SLOT-CRUD-ALLTYPES: AC-5 rooms INSERT/DELETE 실시간 반영
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `clinic_id=eq.${clinic.id}` },
        () => debouncedRoomsRefetch(),
      )
      // T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG AC-3: 재연결 견고화.
      //   Supabase 소켓은 자동 재연결하지만 끊김 동안의 postgres_changes는 재생되지 않음 →
      //   (재)구독 성공(SUBSCRIBED)마다 catch-up refetch로 유실분 보충.
      //   에러/타임아웃/종료 시에도 안전망 동기화(이후 소켓 재연결→SUBSCRIBED가 재보충).
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) fullResync(); // 최초 구독은 타 effect가 이미 로드 → 재구독부터 보충
          subscribedOnce = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          fullResync();
        }
      });

    // T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG AC-3: 탭 백그라운드→포그라운드 복귀 /
    //   창 포커스 시 즉시 전체 동기화 — background throttle로 stale가 잔존하던 케이스 제거.
    const onForeground = () => {
      if (document.visibilityState === 'visible') fullResync();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);

    // T-20260514-foot-DASH-REALTIME-FAIL AC-4: Realtime 단절 대비 폴링 fallback
    // T-20260529-foot-DASHBOARD-TIMETABLE-SYNC AC-1: 60초 → 30초 단축 (최대 30초 이내 반영 보장)
    // Supabase WebSocket이 간헐적으로 끊길 경우 최대 30초 이내 자동 복구
    // T-20260522-foot-TIMETABLE-FOLD V2 AC-6: 예약 변경도 폴링 커버 추가
    const pollTimer = setInterval(() => {
      fetchCheckIns();
      fetchSelfCheckIns();
      fetchStageStarts();
      fetchAssignments();          // T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG AC-2: 방배정 누락 보충
      fetchTimelineReservations(); // AC-6 + DASHBOARD-TIMETABLE-SYNC AC-1
      fetchRooms();                // T-20260615-foot-DASH-CROSSACCT-REALTIME-LAG AC-2: 슬롯 변경 누락 보충(ref 가드로 커스텀 유지)
    }, 30000);

    return () => {
      if (checkInTimer) clearTimeout(checkInTimer);
      if (assignTimer) clearTimeout(assignTimer);
      if (resvTimer) clearTimeout(resvTimer);
      if (roomsTimer) clearTimeout(roomsTimer);
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      supabase.removeChannel(channel);
    };
  }, [clinic, dateStr, fetchCheckIns, fetchAssignments, fetchTimelineReservations, fetchSelfCheckIns, fetchStageStarts, fetchRooms]);

  // T-20260623-foot-CHART2-POPUP-WINDOW-AUTOREFRESH Part B: 상단 종 옆 카운트다운(또는 수동 클릭)이
  //   요청하는 데이터 새로고침을 구독. ★전체 페이지 reload가 아니라 데이터 fetch 재실행만(폼 state 보존=무손실 AC5).
  //   미저장 입력 중에는 카운트다운이 일시정지하므로 여기까지 호출이 오지 않음(수동 클릭만 예외 — 사용자 명시 동작).
  useEffect(() => {
    if (!clinic) return;
    const unsub = subscribeRefresh(() => {
      fetchCheckIns();
      fetchSelfCheckIns();
      fetchStageStarts();
      fetchAssignments();
      fetchTimelineReservations();
      fetchRooms();
    });
    return unsub;
  }, [clinic, fetchCheckIns, fetchSelfCheckIns, fetchStageStarts, fetchAssignments, fetchTimelineReservations, fetchRooms]);

  // T-20260522-foot-LASER-TIMER AC-5: timer_records Realtime 구독 + 초기 로드
  useEffect(() => {
    if (!clinic) return;

    // 초기 로드: 오늘 check_in의 활성 타이머 가져오기
    const loadTimers = async () => {
      if (!rows.length) return;
      const checkInIds = rows.map((r) => r.id);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('timer_records')
          .select('check_in_id, ends_at')
          .in('check_in_id', checkInIds)
          .is('stopped_at', null);
        const map = new Map<string, Date>();
        for (const row of (data ?? []) as { check_in_id: string; ends_at: string }[]) {
          map.set(row.check_in_id, new Date(row.ends_at));
        }
        setActiveTimersMap(map);
      } catch {
        // 타이머 로드 실패 무시
      }
    };
    loadTimers();

    // Realtime: INSERT (타이머 시작) / UPDATE (타이머 종료)
    const timerChannel = supabase
      .channel(`timer_records_rt_${clinic.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'timer_records', filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          const row = payload.new as { check_in_id: string; ends_at: string; stopped_at: string | null };
          if (!row.stopped_at) {
            setActiveTimersMap((prev) => {
              const next = new Map(prev);
              next.set(row.check_in_id, new Date(row.ends_at));
              return next;
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'timer_records', filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          const row = payload.new as { check_in_id: string; stopped_at: string | null };
          if (row.stopped_at) {
            // 타이머 종료 → 맵에서 제거
            setActiveTimersMap((prev) => {
              const next = new Map(prev);
              next.delete(row.check_in_id);
              return next;
            });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(timerChannel); };
  }, [clinic, rows]);

  const STAGE_ALERT_MINS: Partial<Record<CheckInStatus, number>> = {
    consult_waiting: 20,
    consultation: 25,
    exam_waiting: 20,
    examination: 15,
    treatment_waiting: 20,
    preconditioning: 30,
    laser_waiting: 15,
    healer_waiting: 15,
    laser: 20,
    payment_waiting: 15,
  };

  // T-20260522-foot-DRAG-RESP-OPT: tick을 TickCtx.Provider value에 주입 (이전: 버려지던 값)
  // setTick → TickCtx 값 변경 → 모든 DraggableCard(TickCtx 구독) re-render → elapsedMMSS 갱신
  const [tick, setTick] = useState(0);
  const alertedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const t = setInterval(() => {
      setTick((v) => v + 1);
      const active = rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled');
      for (const ci of active) {
        const stageRef = stageStartMap.get(ci.id) ?? ci.checked_in_at;
        const mins = elapsedMinutes(stageRef);
        const threshold = STAGE_ALERT_MINS[ci.status] ?? 30;
        const alertKey = `${ci.id}_${ci.status}`;
        if (mins >= threshold && !alertedIds.current.has(alertKey)) {
          alertedIds.current.add(alertKey);
          playOvertimeAlert();
          break;
        }
      }
    }, 10000);
    return () => clearInterval(t);
  }, [rows, stageStartMap]);

  // T-20260522-foot-LASER-TIMER AC-3 / T-20260523 보강: amber(warn) + red(expire) 분리
  const { timerAlertSet, timerExpiredSet } = useMemo(() => {
    const warn = new Set<string>();
    const expire = new Set<string>();
    const now = Date.now();
    for (const [checkInId, endsAt] of activeTimersMap) {
      const remaining = endsAt.getTime() - now;
      if (remaining <= 0) {
        expire.add(checkInId); // 만료 → red
      } else if (remaining <= 60000) {
        warn.add(checkInId);   // 1분 이하 → amber
      }
    }
    return { timerAlertSet: warn, timerExpiredSet: expire };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, activeTimersMap]);

  const filtered = useMemo(() => {
    if (tab === 'all') return rows.filter((r) => r.status !== 'cancelled');
    if (tab === 'new') return rows.filter((r) => r.visit_type === 'new' && r.status !== 'cancelled');
    return rows.filter((r) => r.visit_type !== 'new' && r.status !== 'cancelled');
  }, [rows, tab]);

  const byStatus = useMemo(() => {
    const map: Record<string, CheckIn[]> = {};
    for (const r of filtered) {
      (map[r.status] ??= []).push(r);
    }
    for (const key of Object.keys(map)) {
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 슬롯 내부 정렬 = 이동 순서(FIFO)
      // sort_order(이동 시 목적 슬롯 max+1) → checked_in_at → id (compareSlotFifo)
      map[key].sort(compareSlotFifo);
    }
    return map;
  }, [filtered]);

  const roomsByType = useMemo(() => {
    const map: Record<string, Room[]> = {};
    for (const r of rooms) {
      (map[r.room_type] ??= []).push(r);
    }
    return map;
  }, [rooms]);

  const markRecentlyUpdated = (id: string) => {
    recentlyUpdated.current.add(id);
    setTimeout(() => recentlyUpdated.current.delete(id), 2000);
  };

  // T-20260522-foot-SLOT-TIMETABLE-POPUP AC-2: undoDrag/toastWithUndo 제거 — 슬롯 이동 성공 토스트 미표시

  // T-20260511-foot-DASH-DRAG-PERF: useCallback으로 안정화 — DndContext props 불필요한 재생성 방지
  const handleDragStart = useCallback((e: DragStartEvent) => {
    const card = e.active.data.current?.checkIn as CheckIn | undefined;
    if (card) setDragging(card);
  }, []);

  // T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET AC-4:
  // PostgREST .update()는 RLS USING/WITH CHECK로 막혀도 error 없이 0행 성공(204 No Content)을 반환한다.
  // → 직원(비-admin) 계정에서 이동이 "저장된 듯" 보이다가 새로고침/Realtime 시 원위치로 silent 리셋되던 근본 증상.
  // .select('id')로 실제 영향 행을 확인해, 0행이면 권한 거부로 간주하고 loud 토스트 + 로컬 롤백한다 (silent 금지).
  const saveCheckInMove = async (
    id: string,
    patch: Record<string, unknown>,
  ): Promise<{ ok: boolean; message?: string }> => {
    const { data, error } = await supabase
      .from('check_ins')
      .update(patch)
      .eq('id', id)
      .select('id');
    if (error) return { ok: false, message: `이동 실패: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, message: '권한이 없어 이동이 저장되지 않았습니다' };
    }
    return { ok: true };
  };

  // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 슬롯→슬롯 이동 시 이동 순서(FIFO) 보장
  // 슬롯 내부 정렬키(byStatus → sort_order)는 그대로 두되, 다른 슬롯으로 넘어온 카드의 sort_order를
  // 목적 슬롯 내 현재 최대값 + 1 로 설정해 "맨 뒤(가장 늦게 도착)"로 배치한다.
  // → 먼저 넘어온 사람은 항상 위, 늦게 넘어온 사람이 먼저 치료 들어가는 순번 역전이 발생하지 않는다.
  // sort_order 는 check_ins.sort_order(int4) 컬럼을 그대로 사용(FE-only, DB 변경 없음).
  // 수동 ↑↓ 재정렬(swapSortOrder)도 동일 정렬키를 쓰므로 그대로 동작한다.
  const nextSlotSortOrder = (destStatus: string, excludeId?: string): number =>
    computeNextSlotSortOrder(rows, destStatus, excludeId);

  // T-20260611-foot-INACTIVE-ROOM-ENTRY-BLOCK: 비활성(유지) 방으로의 신규 진입(드롭/배정/이동)을 전수 차단.
  // 부모 T-20260523-foot-ROOM-DISABLE-TOGGLE(daily_room_status.is_active) 재사용 — inactiveRooms(방이름 Set)로 판정.
  // 부모 AC-4 보존: 비활성 이전 기존 배정은 건드리지 않고(차단 대상 아님), "비활성 이후 신규 진입"만 차단.
  // 상담실/치료실/레이저실(가열성레이저 포함) 3타입 공통. true 반환 시 호출부에서 return.
  const blockIfInactiveRoom = (roomName: string): boolean => {
    if (inactiveRooms.has(roomName)) {
      toast.info('비활성 상태인 방에는 배정할 수 없습니다. 먼저 방을 활성화해주세요.');
      return true;
    }
    return false;
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const target = e.over?.id as string | undefined;
    if (!target) return;

    // T-20260515-foot-DASH-SLOT-DRAG: 타임라인 슬롯 드롭 처리 — checkIn 없이도 작동
    if (target.startsWith('timeslot-new:') || target.startsWith('timeslot-ret:')) {
      if (isPast) { toast.info('과거 날짜는 수정할 수 없습니다'); return; }

      const newSlot = target.replace(/^timeslot-(?:new|ret):/, ''); // e.g. "11:00"
      const dragData = e.active.data.current;

      // reservationId 추출: DraggableBox1Card/DraggableBox2ResvCard or TimelineCheckInCard
      let reservationId: string | null = null;
      if (dragData?.reservationType === 'timeline-resv') {
        reservationId = dragData.reservationId as string;
      } else if (dragData?.reservationId) {
        // TimelineCheckInCard — data: { checkIn, reservationId }
        reservationId = dragData.reservationId as string;
      }

      if (!reservationId) {
        toast.info('예약 정보가 없어 시간을 변경할 수 없습니다');
        return;
      }

      const reservation = timelineReservations.find((r) => r.id === reservationId);
      if (!reservation) return;

      const currentSlotOfResv = resvToSlot(reservation.reservation_time);
      if (currentSlotOfResv === newSlot) return; // 같은 슬롯, no-op

      const newTimeStr = `${newSlot}:00`; // HH:MM:SS

      // T-20260524-foot-TIMETABLE-TIME-CONFIRM: 즉시 실행 대신 확인 다이얼로그 표시
      // (AC-1/AC-2: 초진/재진 시간 변경 시 confirm, AC-3: 확인→적용 / 취소→복원, AC-4: 변경 전/후 시간 표시)
      const oldTimeHM = reservation.reservation_time.slice(0, 5); // HH:MM
      const newTimeHM = newSlot;                                   // HH:MM
      const visitType: VisitType = target.startsWith('timeslot-new:') ? 'new' : 'returning';
      setPendingTimeChange({ reservationId, newTimeStr, reservation, oldTime: oldTimeHM, newTime: newTimeHM, visitType });
      return;
    }

    const row = e.active.data.current?.checkIn as CheckIn | undefined;
    if (!row) return;

    if (row.id.startsWith('temp-')) {
      toast.info('체크인 처리 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    if (isPast) {
      toast.info('과거 날짜는 수정할 수 없습니다');
      return;
    }

    const isRoomDrop = target.startsWith('room:');

    if (isRoomDrop) {
      const roomName = target.replace('room:', '');
      const roomData = e.over?.data?.current as { roomType: string; isFull?: boolean } | undefined;
      const roomType = roomData?.roomType ?? rooms.find((r) => r.name === roomName)?.room_type;
      if (!roomType) return;

      // T-20260611-foot-INACTIVE-ROOM-ENTRY-BLOCK AC-1/2(a)/3: 비활성 방 드롭 차단 (배정 미반영)
      if (blockIfInactiveRoom(roomName)) return;

      if (roomData?.isFull) {
        const room = rooms.find((r) => r.name === roomName);
        toast.info(`${roomName} 정원 초과 (${room?.max_occupancy ?? '?'}명)`);
        return;
      }

      const newStatus = DROP_STATUS_FOR_ROOM[roomType];
      const roomField = ROOM_FIELD_MAP[roomType];
      if (!newStatus || !roomField) return;

      if (row.status === newStatus && row[roomField] === roomName) return;

      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 다른 슬롯(status)로 넘어올 때만 FIFO 정렬키 산출(맨 뒤)
      const moveOrder = row.status !== newStatus ? nextSlotSortOrder(newStatus, row.id) : null;

      markRecentlyUpdated(row.id);
      // #25 경합 방지: 함수형 업데이트 + 직전 row 스냅샷
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) => {
          if (r.id !== row.id) return r;
          // T-20260506-foot-SLOT-VERTICAL-MOVE: cross-area 이동 시 로컬 상태도 이전 방 초기화
          const updated: CheckIn = { ...r, status: newStatus, [roomField]: roomName };
          if (roomType !== 'treatment') updated.treatment_room = null;
          if (roomType !== 'laser' && roomType !== 'heated_laser') updated.laser_room = null;
          if (roomType !== 'consultation') updated.consultation_room = null;
          if (roomType !== 'examination') updated.examination_room = null;
          if (moveOrder !== null) updated.sort_order = moveOrder;
          return updated;
        });
      });

      const patch: Record<string, unknown> = {
        status: newStatus,
        [roomField]: roomName,
      };
      // T-20260506-foot-SLOT-VERTICAL-MOVE: cross-area 이동 시 이전 방 필드 초기화
      // 치료실→레이저실, 레이저실→치료실 등 영역 간 이동 시 데이터 일관성 보장
      if (roomType !== 'treatment') patch.treatment_room = null;
      if (roomType !== 'laser' && roomType !== 'heated_laser') patch.laser_room = null;
      if (roomType !== 'consultation') patch.consultation_room = null;
      if (roomType !== 'examination') patch.examination_room = null;
      if (!row.called_at && row.status === 'registered') {
        patch.called_at = new Date().toISOString();
      }
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 산출한 FIFO 정렬키를 DB에도 반영
      if (moveOrder !== null) patch.sort_order = moveOrder;

      const roomAssignment = assignments.find((a) => a.room_name === roomName);
      // T-20260622-foot-AUTOASSIGN-IMBYEOL-SKEW-FIX: 방 배정으로 담당이 바뀌는지 사전 캡처(부하기록용)
      let dragAssignRole: 'consult' | 'therapy' | null = null;
      let dragAssignTo: string | null = null;
      let dragAssignFrom: string | null = null;
      if (roomAssignment?.staff_id) {
        if (roomType === 'consultation') {
          patch.consultant_id = roomAssignment.staff_id;
          dragAssignRole = 'consult';
          dragAssignTo = roomAssignment.staff_id;
          dragAssignFrom = row.consultant_id ?? null;
        } else if (roomType === 'treatment') {
          patch.therapist_id = roomAssignment.staff_id;
          dragAssignRole = 'therapy';
          dragAssignTo = roomAssignment.staff_id;
          dragAssignFrom = row.therapist_id ?? null;
        }
      }

      const res = await saveCheckInMove(row.id, patch);
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      // T-20260622-foot-AUTOASSIGN-IMBYEOL-SKEW-FIX: 드래그-방 배정도 부하 SSOT(assignment_actions)에
      //   기록 → computeLoad 가 실부하 인식(전원0 오판 제거) → 신규·비지정 영역 균등 복원.
      //   best-effort·멱등(담당 변화 시에만), 배정 동선 비차단.
      if (dragAssignRole && dragAssignTo && dragAssignTo !== dragAssignFrom) {
        void logRealAssignment({
          checkIn: {
            id: row.id,
            clinic_id: row.clinic_id,
            customer_id: row.customer_id,
            treatment_kind: row.treatment_kind,
            treatment_category: row.treatment_category,
            status_flag: row.status_flag,
          },
          role: dragAssignRole,
          toStaffId: dragAssignTo,
          fromStaffId: dragAssignFrom,
          createdBy: profile?.id ?? null,
        });
      }
      if (row.status !== newStatus) {
        const now = new Date().toISOString();
        await supabase.from('status_transitions').insert({
          check_in_id: row.id,
          clinic_id: row.clinic_id,
          from_status: row.status,
          to_status: newStatus,
        });
        setStageStartMap((prev) => new Map(prev).set(row.id, now));
      }
      // T-20260522-foot-SPACE-AUTOROUTE AC-4/AC-5: DnD room drop → check_in_room_logs INSERT (graceful)
      // 드래그 이동도 금일 동선에 자동 반영 (상담실·치료실·레이저실·가열성레이저 포함)
      void (async () => {
        try {
          await supabase.from('check_in_room_logs').insert({
            check_in_id: row.id,
            clinic_id: row.clinic_id,
            assigned_room: roomName,
            room_type: roomType,
          });
        } catch { /* graceful skip — 테이블 미존재 시 무시 */ }
      })();
    } else if (target === 'returning_zone') {
      // 재진 대기열로 이동 → status = registered + visit_type 변경 (양방향 자유 이동)
      const targetVisitType: VisitType = 'returning';
      if (row.status === 'registered' && row.visit_type === targetVisitType) return;
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 재진 대기열 맨 뒤(FIFO)
      const moveOrder = nextSlotSortOrder('registered', row.id);
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'registered' as CheckInStatus, visit_type: targetVisitType, sort_order: moveOrder } : r,
        );
      });
      const res = await saveCheckInMove(row.id, { status: 'registered', visit_type: targetVisitType, sort_order: moveOrder });
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      if (row.status !== 'registered') {
        const now = new Date().toISOString();
        await supabase.from('status_transitions').insert({
          check_in_id: row.id,
          clinic_id: row.clinic_id,
          from_status: row.status,
          to_status: 'registered',
        });
        setStageStartMap((prev) => new Map(prev).set(row.id, now));
      }
    } else if (target === 'laser_waiting') {
      if (row.status === 'laser_waiting') return;
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 레이저 대기열 맨 뒤(FIFO)
      const moveOrder = nextSlotSortOrder('laser_waiting', row.id);
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'laser_waiting' as CheckInStatus, laser_room: null, sort_order: moveOrder } : r,
        );
      });
      const res = await saveCheckInMove(row.id, { status: 'laser_waiting', laser_room: null, sort_order: moveOrder });
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      const now = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: row.id,
        clinic_id: row.clinic_id,
        from_status: row.status,
        to_status: 'laser_waiting',
      });
      setStageStartMap((prev) => new Map(prev).set(row.id, now));
    } else if (target === 'healer_waiting') {
      // T-20260502-foot-HEALER-WAIT-SLOT
      if (row.status === 'healer_waiting') return;
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 힐러 대기열 맨 뒤(FIFO)
      const moveOrder = nextSlotSortOrder('healer_waiting', row.id);
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'healer_waiting' as CheckInStatus, sort_order: moveOrder } : r,
        );
      });
      const res = await saveCheckInMove(row.id, { status: 'healer_waiting', sort_order: moveOrder });
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      const now = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: row.id,
        clinic_id: row.clinic_id,
        from_status: row.status,
        to_status: 'healer_waiting',
      });
      setStageStartMap((prev) => new Map(prev).set(row.id, now));
    } else if (target === 'returning_exam' || target === 'returning_treatment') {
      const needsExam = target === 'returning_exam';
      markRecentlyUpdated(row.id);
      const updatedNotes = { ...(row.notes ?? {}), needs_exam: needsExam };
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) => (r.id === row.id ? { ...r, notes: updatedNotes } : r));
      });
      const res = await saveCheckInMove(row.id, { notes: updatedNotes });
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
    } else if (target === 'consultation') {
      // T-20260516-foot-CONSULT-KANBAN-MISS: 상담 칸 드롭 시 consultation_room 초기화
      if (row.status === 'consultation' && !row.consultation_room) return;
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 다른 슬롯에서 넘어올 때만 상담 대기열 맨 뒤(FIFO)
      const moveOrder = row.status !== 'consultation' ? nextSlotSortOrder('consultation', row.id) : null;
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'consultation' as CheckInStatus, consultation_room: null, ...(moveOrder !== null ? { sort_order: moveOrder } : {}) } : r,
        );
      });
      const res = await saveCheckInMove(row.id, { status: 'consultation', consultation_room: null, ...(moveOrder !== null ? { sort_order: moveOrder } : {}) });
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      if (row.status !== 'consultation') {
        const now = new Date().toISOString();
        await supabase.from('status_transitions').insert({
          check_in_id: row.id,
          clinic_id: row.clinic_id,
          from_status: row.status,
          to_status: 'consultation',
        });
        setStageStartMap((prev) => new Map(prev).set(row.id, now));
      }
    } else if (target === 'registered') {
      // 초진 대기열로 이동 → status = registered + visit_type = new (양방향 자유 이동)
      if (row.status === 'registered' && row.visit_type === 'new') return;
      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 초진 대기열 맨 뒤(FIFO)
      const moveOrder = nextSlotSortOrder('registered', row.id);
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'registered' as CheckInStatus, visit_type: 'new' as VisitType, sort_order: moveOrder } : r,
        );
      });
      const patch: Record<string, unknown> = { status: 'registered', visit_type: 'new', sort_order: moveOrder };
      if (!row.called_at && row.status !== 'registered') {
        patch.called_at = new Date().toISOString();
      }
      const res = await saveCheckInMove(row.id, patch);
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      if (row.status !== 'registered') {
        const now = new Date().toISOString();
        await supabase.from('status_transitions').insert({
          check_in_id: row.id,
          clinic_id: row.clinic_id,
          from_status: row.status,
          to_status: 'registered',
        });
        setStageStartMap((prev) => new Map(prev).set(row.id, now));
      }
    } else {
      const newStatus = target as CheckInStatus;
      if (row.status === newStatus) return;

      // ── T-20260612-foot-MEDLAW22-B-GATE: 완료 슬롯 이동 시 급여 진료기록 게이트(하드차단) ──
      //   카드 직접 드래그로 수납창을 건너뛰는 완료 우회 경로도 동일하게 막는다(의료법 제22조).
      //   급여 방문 + 서명 진료기록 미존재 → 차단(낙관적 업데이트 전 abort). 비급여는 즉시 통과.
      if (newStatus === 'done') {
        try {
          const gate = await evaluateMedicalRecordGate(row);
          if (gate.blocked) {
            toast.error(gate.reason ?? '건강보험(급여) 진료는 진료기록 작성 후 완료할 수 있습니다');
            return;
          }
        } catch {
          // 게이트 평가 오류는 과차단 방지 위해 통과(비차단) — 운영 연속성 우선.
        }
      }

      // T-20260608-foot-SLOT-MOVE-FIFO-ORDER: 목적 슬롯 맨 뒤(FIFO)
      const moveOrder = nextSlotSortOrder(newStatus, row.id);
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        // T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC: '완료' 이동 시 수납완료(dark_gray) 플래그를
        //   낙관적으로 함께 set → 카드 즉시 회색 리렌더. 비-완료 컬럼 이동에는 미발화(가드).
        return curr.map((r) => (r.id === row.id
          ? { ...r, status: newStatus, sort_order: moveOrder, ...(newStatus === 'done' ? { status_flag: 'dark_gray' as StatusFlag } : {}) }
          : r));
      });

      const patch: Record<string, unknown> = { status: newStatus, sort_order: moveOrder };
      if (newStatus === 'done') patch.completed_at = new Date().toISOString();
      if (!row.called_at && row.status === 'registered') {
        patch.called_at = new Date().toISOString();
      }

      const res = await saveCheckInMove(row.id, patch);
      if (!res.ok) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(res.message ?? '이동 실패');
        return;
      }
      {
        const now = new Date().toISOString();
        await supabase.from('status_transitions').insert({
          check_in_id: row.id,
          clinic_id: row.clinic_id,
          from_status: row.status,
          to_status: newStatus,
        });
        setStageStartMap((prev) => new Map(prev).set(row.id, now));
      }

      // T-20260617-foot-AUTOASSIGN: 상담대기/치료대기 슬롯 진입 시 상담사/치료사 자동배정(best-effort, 멱등)
      if (newStatus === 'consult_waiting' || newStatus === 'treatment_waiting') {
        void maybeAutoAssign(row.id, newStatus, profile?.id ?? null);
      }

      // AC-4: 수납대기 이동 시 PaymentDialog 대신 PaymentMiniWindow 직접 오픈
      if (newStatus === 'payment_waiting') {
        setMiniPayTarget({ ...row, status: newStatus });
      }
      if (newStatus === 'done' && row.package_id) {
        const err = await autoDeductSession(row.id, row.package_id);
        if (err) toast.error(`세션 소진 실패: ${err}`);
        // T-20260522-foot-SLOT-TOAST-REMOVE AC-1: 슬롯 이동 성공 토스트 제거
      }
      // T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC: '완료' 이동 시 수납완료(dark_gray) 플래그 영속화.
      //   status_flag 전이는 SSOT applyStatusFlagTransition 경유(병렬 2nd write 금지) — DB write +
      //   감사 이력 append. 표시 플래그 한정(결제/수납 데이터 무변경). 실패해도 상태 이동은 유지.
      if (newStatus === 'done') {
        try {
          await applyStatusFlagTransition(row, 'dark_gray', {
            id: profile?.id ?? null,
            name: profile?.name ?? null,
            role: profile?.role ?? null,
          });
        } catch (e) {
          toast.error(`수납완료 플래그 동기화 실패: ${(e as Error).message}`);
        }
      }
      // T-20260602-foot-VISITTYPE-RETURNING-AUTOSET: 완료 시 visit_type 자동 승격 (best-effort)
      if (newStatus === 'done') await promoteVisitTypeToReturning(row.customer_id);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setOpenNew(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // T-20260603-foot-RES-NAME-MISMATCH-WARN → T-20260617-foot-CHECKIN-CHART-LINK-3KEY 로 차단형 격상.
  //   직전 비차단 경고(warnIfNameMismatch)는 오배정을 막지 못했다(6/17 재발) → verifyChartLinkOrConfirm
  //   (성함 불일치 시 window.confirm 차단형)으로 대체. 비차단 토스트는 연락처-only 상이에만 잔존.

  // T-20260617-foot-CHECKIN-CHART-LINK-3KEY: 연락처 동일성 비교(포맷 무관) — true/false/null(비교불가)
  const phoneSame = useCallback((a?: string | null, b?: string | null): boolean | null => {
    const a164 = normalizeToE164(a ?? null);
    const b164 = normalizeToE164(b ?? null);
    if (a164 && b164) return a164 === b164;
    const ad = (a ?? '').replace(/\D/g, '');
    const bd = (b ?? '').replace(/\D/g, '');
    if (ad.length >= 8 && bd.length >= 8) return ad.slice(-8) === bd.slice(-8);
    return null; // 한쪽이라도 유효 번호 아님 → 비교 불가(차단 근거로 쓰지 않음)
  }, []);

  // T-20260617-foot-CHECKIN-CHART-LINK-3KEY (AC-3 + AC-7): 차트 오픈 직전 교차검증 — 차단형 격상.
  //   customer_id 가 SET 이어도 연결된 고객의 성함/연락처가 카드 denormalized 값과 다르면
  //   타 환자 차트일 수 있다(6/17 김사비→문자테스트). 직전 RES-NAME-MISMATCH-WARN 은 비차단
  //   토스트뿐이라 오배정을 못 막았다 → 본 헬퍼는 성함 불일치 시 window.confirm 으로 차단(staff
  //   확인 시에만 오픈). 연락처만 다르면(번호 변경 가능) 비차단 경고로 남긴다(false-block 회피).
  //   조회 실패 시 차단하지 않음(가용성 우선 — read-only 차트 오픈 불변식과 정합).
  //   반환: true = 오픈 진행, false = 오픈 차단.
  //
  //   AC-7 (차트번호 1급 권위 키, 총괄 reframe MSG-utzu): 연결된 customer_id 는 예약 최초 등록 시
  //   자동 발번된 UNIQUE·NOT NULL 차트번호(F-XXXX)를 가진다 = 세 키 중 가장 강한 disambiguator.
  //   이 차트번호가 가리키는 환자의 성함/연락처가 카드 denormalized 값과 상충하면 오연결(데이터
  //   오염 신호)이다. 차단형 확인 프롬프트에 차트번호를 1급 권위 키로 명시 표기해 staff 가 정확히
  //   어느 차트가 열리는지 식별·재확인하게 한다(고객박스=고객차트, 차트번호 중복 불가).
  const verifyChartLinkOrConfirm = useCallback(async (
    customerId: string,
    expectedName?: string | null,
    expectedPhone?: string | null,
  ): Promise<boolean> => {
    const { data, error } = await supabase
      .from('customers')
      .select('name, phone, chart_number')
      .eq('id', customerId)
      .maybeSingle();
    if (error || !data) return true; // 조회 실패 → 비차단(오픈 허용)
    const chartName = (data.name ?? '').trim();
    const shownName = (expectedName ?? '').trim();
    const chartNo = (data.chart_number ?? '').trim(); // AC-7: 1급 권위 키(UNIQUE)
    const chartLabel = chartNo ? `[${chartNo}] ` : '';
    const nameMismatch = !!chartName && !!shownName && chartName !== shownName;
    const phoneCmp = phoneSame(expectedPhone, data.phone);
    if (nameMismatch) {
      // 성함 불일치 = 타 환자 차트 추정 → 차단형 확인 프롬프트 (차트번호 1급 권위 키 명시)
      return window.confirm(
        `⚠️ 고객 연결 불일치 — 다른 환자의 차트일 수 있습니다.\n\n`
        + `· 카드 표기: ${shownName}${expectedPhone ? ` / ${expectedPhone}` : ''}\n`
        + `· 연결된 차트: ${chartLabel}${chartName}${data.phone ? ` / ${data.phone}` : ''}\n\n`
        + `그래도 이 차트를 여시겠습니까?\n(취소 시 열지 않습니다 — 고객관리에서 차트번호로 연결을 재확인하세요)`,
      );
    }
    if (phoneCmp === false) {
      // 성함 일치 + 연락처 상이(번호 변경 가능) → 비차단 경고 (연결된 차트번호 명시)
      toast.warning(`연락처가 차트와 다릅니다 (카드 ${expectedPhone ?? '-'} / 차트 ${chartLabel}${data.phone ?? '-'}). 동일 고객인지 확인하세요.`);
    }
    return true;
  }, [phoneSame]);

  // ════════════════════════════════════════════════════════════════════════════
  // CRITICAL: 차트오픈 단일 진입점 — openChartFor (DO NOT bypass)
  // T-20260606-foot-CHART-OPEN-ENTRYPOINT-UNIFY (부모 RCA: DASH-FIRSTVISIT-CHART-RECUR-RCA §개선안3)
  //
  // 왜 단일 엔트리인가:
  //   차트오픈은 칸반 / 통합시간표(타임라인) / 아코디언 명단 여러 뷰에서 트리거된다. 과거엔 각 뷰가
  //   ctxOpenChart primitive 만 공유한 채 "customer_id-or-이름 fallback" 코어를 각자 복제·각자 onClick
  //   배선했다. 한 뷰만 게이팅(!isPast 등)/조건 추가로 죽어도 다른 뷰가 멀쩡하면 안전망이 안 터져
  //   "한 뷰는 배선·다른 뷰는 dead"가 6번 재발했다(부모 RCA). → 모든 뷰 핸들러가 이 단일 엔트리 하나만
  //   호출하게 통합해 결함 클래스 자체를 제거한다.
  //
  // 불변식(INVARIANT — 변경 시 회귀 6차 재발):
  //   1. 차트오픈은 read-only → isPast(자정 stale 등)로 절대 막지 않는다. mutation(context/드래그)만 가드.
  //   2. 뷰 핸들러(handleCardClick/handleReservationSelect/handleNameChartOpen)는 직접 ctxOpenChart 를
  //      호출하지 않는다 — 반드시 openChartFor 를 통해 연다 (caller 드리프트 방지).
  //   3. 입력 다형성: 칸반 카드(CheckIn) / 타임라인 예약(Reservation) / 명단 이름(customer_id|null + name).
  // 회귀 게이트: tests/e2e/chart-open-gate/CHART-OPEN-GATE.spec.ts (G1~G6, 머지차단)
  //             tests/e2e/T-20260606-foot-CHART-OPEN-ENTRYPOINT-UNIFY.spec.ts (드리프트 스캐너)
  // ════════════════════════════════════════════════════════════════════════════
  type ChartOpenTarget =
    | { kind: 'checkin'; checkIn: CheckIn }
    | { kind: 'reservation'; reservation: Reservation }
    | { kind: 'name'; customerId: string | null; name?: string | null };

  const openChartFor = useCallback(async (target: ChartOpenTarget) => {
    // 0) 입력 정규화 — 어떤 뷰에서 왔든 (customerId, name, phone, 링크백 후처리)로 환원
    let customerId: string | null;
    let name: string | null;
    let phone: string | null;  // T-20260617: 복합키(성함+연락처) 검증·fallback 용 denormalized 연락처
    if (target.kind === 'checkin') {
      const ci = target.checkIn;
      // 칸반 카드: 2번차트 직접 오픈 + CheckInDetailSheet useEffect 간접 경로 보완 (항상 선행)
      setSelectedCheckIn(ci);
      customerId = ci.customer_id;
      name = ci.customer_name ?? null;
      phone = ci.customer_phone ?? null;
    } else if (target.kind === 'reservation') {
      customerId = target.reservation.customer_id;
      name = target.reservation.customer_name ?? null;
      phone = target.reservation.customer_phone ?? null;
    } else {
      customerId = target.customerId;
      name = target.name ?? null;
      phone = null; // 명단 이름 진입은 연락처 컨텍스트 없음 → 성함 단독 fallback 유지(G5 무회귀)
    }

    // 1) customer_id 직결 — 1·2번 차트 열림의 실제 트리거 (read-only, isPast 무관)
    //   T-20260617 (AC-3): 오픈 직전 성함/연락처 교차검증. 성함 불일치 시 차단형 확인.
    if (customerId) {
      const ok = await verifyChartLinkOrConfirm(customerId, name, phone);
      if (!ok) return; // 오연결 추정 → staff 가 취소 → 타 차트 오픈 차단
      ctxOpenChart(customerId);
      return;
    }

    // 2) customer_id 미연결 → 동일 클리닉 복합키(성함 AND 연락처) 1건 자동 조회 fallback
    //   T-20260529-foot-CHART-OPEN-{SINGLE,FAIL} + DASH-FIRSTVISIT-CHART-RECUR-RCA(P0-C) 통합
    //   T-20260617 (AC-2): 성함 단독 fallback → 연락처가 있으면 성함 AND 연락처 복합으로 좁힘
    //   (동명이인/오연결 차트 오픈 방지). 연락처 컨텍스트 없으면(명단 이름 진입) 성함 단독 유지.
    if (name && clinic) {
      const { data: matches } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('clinic_id', clinic.id)
        .eq('name', name)
        .limit(5);
      let candidates = (matches ?? []) as Array<{ id: string; name: string | null; phone: string | null }>;
      if (phone && candidates.length > 0) {
        const phoneFiltered = candidates.filter((c) => phoneSame(phone, c.phone) === true);
        // 연락처 일치가 있으면 복합키로 좁힘. 일치 0건이면 candidates 유지하지 않고 미확정 처리.
        candidates = phoneFiltered;
      }
      if (candidates.length === 1) {
        const foundId = candidates[0].id;
        ctxOpenChart(foundId);
        // 백그라운드 링크백: 다음 클릭부터 정상(customer_id 직결) 경로
        if (target.kind === 'checkin') {
          supabase.from('check_ins').update({ customer_id: foundId }).eq('id', target.checkIn.id)
            .then(({ error }) => { if (!error) fetchCheckIns(); });
        } else if (target.kind === 'reservation') {
          supabase.from('reservations').update({ customer_id: foundId }).eq('id', target.reservation.id)
            .then(({ error }) => { if (!error) fetchTimelineReservations(); });
        }
        return;
      }
      if (candidates.length > 1) {
        toast.info(`동명이인 ${candidates.length}명 — 고객관리에서 직접 확인하세요`);
        return;
      }
      // candidates.length === 0:
      //   · phone 있었는데 성함+연락처 동시 일치 0건 → 복합키 미충족(오연결 방지) → 미확정 안내
      //   · phone 없고 동명 0건 → 미등록
      if (phone && (matches?.length ?? 0) > 0) {
        toast.info('성함은 일치하나 연락처가 다릅니다 — 고객관리에서 직접 확인하세요');
        return;
      }
    }

    // 3) 미등록/이름없음 — 뷰별 안내 토스트 (기존 메시지 보존)
    if (target.kind === 'reservation') {
      const r = target.reservation;
      const timeStr = r.reservation_time ? r.reservation_time.slice(0, 5) : '';
      toast.info(`${r.customer_name ?? ''} — ${timeStr} 예약 (고객 미연결)`);
    } else if (target.kind === 'name') {
      toast.info(`${name ?? ''} — 고객 미연결 (고객관리에서 등록 후 차트 열람)`);
    } else {
      toast.info('고객 정보가 연결되어 있지 않습니다');
    }
  }, [ctxOpenChart, clinic, fetchCheckIns, fetchTimelineReservations, verifyChartLinkOrConfirm, phoneSame]);

  // 칸반 카드 클릭 진입점 — 단일 엔트리 openChartFor 위임 (직접 ctxOpenChart 호출 금지: INVARIANT #2)
  const handleCardClick = useCallback(
    (ci: CheckIn) => openChartFor({ kind: 'checkin', checkIn: ci }),
    [openChartFor],
  );

  // T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB: 진료알림판(진료콜 명단 팝업) 이름 클릭 시
  //   기본 진입을 '기본차트'(2번차트 서랍=펜차트) → '진료차트'(MedicalChartPanel)로 정정.
  //   기존 구현은 ctxOpenChart(기본차트 서랍)로 열려 #2 주석의 의도("이름 클릭 → 진료차트 즉시 열기")와
  //   실제 동작이 어긋났음. 원장이 진료알림판에서 기대하는 첫 화면은 진단/경과/처방을 보는 '진료차트'이므로,
  //   DoctorCallDashboard FOLLOWUP3 C-1과 동일하게 MedicalChartPanel을 직접 연다.
  //   ※ 본 경로(진료알림판)에 한정. 고객관리·체크인 상세·카드 클릭 등 다른 진입점의 기본차트 서랍
  //     기본탭(펜차트)은 ctxOpenChart 그대로 유지되어 회귀 없음.
  //   customer_id 미연결 시 동일 클리닉·동일 이름 1건 자동 조회 fallback + check_in 연결은 그대로 보존.
  const openMedicalChartById = useCallback((customerId: string) => {
    // 경쟁 시트 닫고 진료차트 단독 표시 (handleOpenMedicalChart와 동일 패턴 — CHART-ROUTE-FIX AC-1)
    setSelectedCheckIn(null);
    ctxCloseChart();
    setMedicalChartCustomerId(customerId);
    setMedicalChartOpen(true);
  }, [ctxCloseChart]);

  const handleOpenChartFromList = useCallback(async (ci: CheckIn) => {
    // T-20260617 (AC-3): customer_id SET 이어도 성함/연락처 교차검증 — 성함 불일치 시 차단형 확인.
    if (ci.customer_id) {
      const ok = await verifyChartLinkOrConfirm(ci.customer_id, ci.customer_name, ci.customer_phone);
      if (!ok) return; // 오연결 추정 → staff 취소 → 타 차트 오픈 차단
      openMedicalChartById(ci.customer_id);
      return;
    }
    // T-20260617 (AC-2): 성함 단독 fallback 제거 → 연락처 있으면 성함 AND 연락처 복합으로 좁힘.
    if (ci.customer_name && clinic) {
      const { data: matches } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('clinic_id', clinic.id)
        .eq('name', ci.customer_name)
        .limit(5);
      let candidates = (matches ?? []) as Array<{ id: string; name: string | null; phone: string | null }>;
      if (ci.customer_phone && candidates.length > 0) {
        candidates = candidates.filter((c) => phoneSame(ci.customer_phone, c.phone) === true);
      }
      if (candidates.length === 1) {
        const foundId = candidates[0].id;
        openMedicalChartById(foundId);
        supabase.from('check_ins').update({ customer_id: foundId }).eq('id', ci.id)
          .then(({ error }) => { if (!error) fetchCheckIns(); });
      } else if (candidates.length > 1) {
        toast.info(`동명이인 ${candidates.length}명 — 고객관리에서 직접 확인하세요`);
      } else if (ci.customer_phone && (matches?.length ?? 0) > 0) {
        toast.info('성함은 일치하나 연락처가 다릅니다 — 고객관리에서 직접 확인하세요');
      } else {
        toast.info('고객 정보가 연결되어 있지 않습니다');
      }
    } else {
      toast.info('고객 정보가 연결되어 있지 않습니다');
    }
  }, [openMedicalChartById, clinic, fetchCheckIns, verifyChartLinkOrConfirm, phoneSame]);

  // T-20260522-foot-DRAG-RESP-OPT: useCallback 안정화 — 호출 측 클로저 의존성 최소화
  const handleCardContext = useCallback((ci: CheckIn, e: React.MouseEvent) => {
    setContextMenu({ checkIn: ci, pos: { x: e.clientX, y: e.clientY } });
  }, []);

  // T-20260514-foot-CHART2-OPEN-BUG (재오픈): window.open → 슬라이드 패널
  // f545660에서 CheckInDetailSheet만 수정하고 Dashboard 진입경로 누락 — AC-4 미충족
  const handleOpenChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) {
      toast.info('고객 정보가 연결되어 있지 않습니다');
      return;
    }
    ctxOpenChart(ci.customer_id);
  }, [ctxOpenChart]);


  const handleNewReservation = useCallback((ci: CheckIn) => {
    // LOGIC-LOCK: L-002 — 변경 시 현장 승인 필수
    navigate('/admin/reservations', {
      state: {
        openReservationFor: {
          customer_id: ci.customer_id,
          name: ci.customer_name,
          phone: ci.customer_phone ?? '',
          visit_type: ci.visit_type,
        },
      },
    });
  }, [navigate]);

  // T-20260516-foot-CHART-ROUTE-FIX: 진료차트 열기 — 경쟁 시트 닫기 후 MedicalChartPanel 열기
  // 버그: CheckInDetailSheet(z-50) 또는 CustomerChartSheet(z-70)가 열린 상태에서
  //       MedicalChartPanel(z-50)을 열면 뒤에 가려져 "Chart1(고객차트) 형식"으로 보임
  // 수정: 경쟁 시트 먼저 닫고 MedicalChartPanel 단독 표시
  const handleOpenMedicalChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) {
      toast.info('고객 정보가 연결되어 있지 않습니다');
      return;
    }
    // 경쟁 시트 닫기 (T-20260516-foot-CHART-ROUTE-FIX AC-1)
    setSelectedCheckIn(null);  // CheckInDetailSheet 닫기
    ctxCloseChart();           // CustomerChartSheet 닫기 (T-20260516-foot-CHART2-STATE-UNIFY)
    setMedicalChartCustomerId(ci.customer_id);
    setMedicalChartOpen(true);
  }, [ctxCloseChart]);

  // T-20260515-foot-CONTEXT-MENU-4ITEM AC-3: 수납 — PaymentMiniWindow 재사용
  const handleOpenPaymentFromMenu = useCallback((ci: CheckIn) => {
    setMiniPayTarget(ci);
  }, []);

  const cardHandlersValue = useMemo<CardHandlers>(() => ({
    onNameContext: (ci, e) => setCustomerMenu({ checkIn: ci, pos: { x: e.clientX, y: e.clientY } }),
  }), []);

  const handleContextStatusChange = async (ci: CheckIn, newStatus: CheckInStatus) => {
    if (ci.id.startsWith('temp-')) {
      toast.info('체크인 처리 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    markRecentlyUpdated(ci.id);
    // #25 경합 방지: 함수형 업데이트 + 직전 row 캡처
    let prevRow: CheckIn | undefined;
    setRows((curr) => {
      prevRow = curr.find((r) => r.id === ci.id);
      // T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC: '완료'로 변경 시 수납완료(dark_gray) 낙관적 동기화
      //   → 즉시 회색 리렌더. 비-완료 상태 변경에는 미발화(가드).
      return curr.map((r) => (r.id === ci.id
        ? { ...r, status: newStatus, ...(newStatus === 'done' ? { status_flag: 'dark_gray' as StatusFlag } : {}) }
        : r));
    });
    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'done') patch.completed_at = new Date().toISOString();
    if (!ci.called_at && ci.status === 'registered') {
      patch.called_at = new Date().toISOString();
    }
    const { error } = await supabase.from('check_ins').update(patch).eq('id', ci.id);
    if (error) {
      // #25 경합 방지: 해당 row만 롤백 (전체 rows 롤백 시 다른 동시 업데이트 손실)
      setRows((curr) => curr.map((r) => (r.id === ci.id && prevRow ? prevRow : r)));
      toast.error(`상태 변경 실패: ${error.message}`);
      return;
    }
    {
      const now = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: ci.id,
        clinic_id: ci.clinic_id,
        from_status: ci.status,
        to_status: newStatus,
      });
      setStageStartMap((prev) => new Map(prev).set(ci.id, now));
    }
    // T-20260617-foot-AUTOASSIGN: 상담대기/치료대기 진입 시 자동배정(best-effort, 멱등)
    if (newStatus === 'consult_waiting' || newStatus === 'treatment_waiting') {
      void maybeAutoAssign(ci.id, newStatus, profile?.id ?? null);
    }
    // T-20260611-foot-CHECKIN-CANCEL-RENAME-RESTORE: '체크인 취소' = 체크인 역전이(soft).
    //   check_in row는 status='cancelled'로 보존(위 update). 추가로, 체크인 시 'checked_in'으로
    //   전이됐던 원본 예약을 'confirmed'(예약)로 되돌려 통합시간표 원래 슬롯에 복구한다.
    //   (CHECKIN-DASHBOARD-SYNC: 체크인 시 reservations→'checked_in' 전이의 역방향.
    //    CANCEL-CUST-RETAIN-AUDIT canon: 삭제 아님 = row 보존 + 역연산.)
    if (newStatus === 'cancelled' && ci.reservation_id) {
      const { error: resvErr } = await supabase
        .from('reservations')
        .update({ status: 'confirmed' })
        .eq('id', ci.reservation_id);
      if (resvErr) {
        toast.error(`예약 복구 실패: ${resvErr.message}`);
      } else {
        fetchTimelineReservations(); // 통합시간표 즉시 복구 반영
      }
    }
    // AC-4: 수납대기 이동 시 PaymentMiniWindow 직접 오픈
    if (newStatus === 'payment_waiting') setMiniPayTarget({ ...ci, status: newStatus });
    if (newStatus === 'done' && ci.package_id) {
      const err = await autoDeductSession(ci.id, ci.package_id);
      if (err) toast.error(`세션 소진 실패: ${err}`);
      // T-20260522-foot-SLOT-TOAST-REMOVE AC-1: 슬롯 이동 성공 토스트 제거
    }
    // T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC: '완료'로 변경 시 수납완료(dark_gray) 플래그 영속화
    //   (SSOT applyStatusFlagTransition 경유 — DB write + 감사 이력). 표시 한정, 결제 데이터 무변경.
    if (newStatus === 'done') {
      try {
        await applyStatusFlagTransition(ci, 'dark_gray', {
          id: profile?.id ?? null,
          name: profile?.name ?? null,
          role: profile?.role ?? null,
        });
      } catch (e) {
        toast.error(`수납완료 플래그 동기화 실패: ${(e as Error).message}`);
      }
    }
    // T-20260602-foot-VISITTYPE-RETURNING-AUTOSET: 완료 시 visit_type 자동 승격 (best-effort)
    if (newStatus === 'done') await promoteVisitTypeToReturning(ci.customer_id);
    // T-20260522-foot-SLOT-TIMETABLE-POPUP AC-2 / T-20260522-foot-SLOT-TOAST-REMOVE AC-1: 성공 토스트 제거
  };

  /** 상담실 번호 선택 후 status='consultation' + consultation_room 동시 업데이트
   *  — T-20260516-foot-CONSULT-KANBAN-MISS AC-6
   */
  const handleContextConsultStatusChange = async (ci: CheckIn, consultRoom: string) => {
    if (ci.id.startsWith('temp-')) {
      toast.info('체크인 처리 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    // T-20260611-foot-INACTIVE-ROOM-ENTRY-BLOCK AC-1/2(b)/3: 비활성 상담실 선택/배정 차단
    if (blockIfInactiveRoom(consultRoom)) return;
    markRecentlyUpdated(ci.id);
    let prevRow: CheckIn | undefined;
    setRows((curr) => {
      prevRow = curr.find((r) => r.id === ci.id);
      return curr.map((r) =>
        r.id === ci.id ? { ...r, status: 'consultation' as CheckInStatus, consultation_room: consultRoom } : r,
      );
    });
    const patch: Record<string, unknown> = { status: 'consultation', consultation_room: consultRoom };
    const { error } = await supabase.from('check_ins').update(patch).eq('id', ci.id);
    if (error) {
      setRows((curr) => curr.map((r) => (r.id === ci.id && prevRow ? prevRow : r)));
      toast.error(`상태 변경 실패: ${error.message}`);
      return;
    }
    {
      const now = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: ci.id,
        clinic_id: ci.clinic_id,
        from_status: ci.status,
        to_status: 'consultation',
      });
      setStageStartMap((prev) => new Map(prev).set(ci.id, now));
    }
    // T-20260522-foot-SPACE-AUTOROUTE: 금일동선 자동기입 — check_in_room_logs INSERT (graceful)
    void (async () => {
      try {
        await supabase.from('check_in_room_logs').insert({
          check_in_id: ci.id,
          clinic_id: ci.clinic_id,
          assigned_room: consultRoom,
          room_type: 'consultation',
        });
      } catch { /* graceful skip */ }
    })();
    // T-20260522-foot-SLOT-TIMETABLE-POPUP AC-2: 성공 토스트 제거
  };

  // T-20260519-foot-SLOT-BATCH-EDIT / T-20260614-foot-SLOT-CRUD-ALLTYPES:
  //   커스텀 슬롯 추가 (rooms 테이블 INSERT) — 전(全) 타입 공통.
  //   정원은 동형 슬롯에서 복사(없으면 타입별 기본). 신규 슬롯도 동형 기본 슬롯과
  //   동일한 row 형태라 FIFO(T-20260608)·역행가드(T-20260613) 등 모든 동선 로직이
  //   분기 없이 동일 적용된다.
  const handleAddSlot = async (roomType: string, name: string) => {
    if (!clinic || !name.trim()) return;
    setAddSlotLoading(true);
    try {
      const sibling = rooms.find((r) => r.room_type === roomType);
      const maxOcc = sibling?.max_occupancy ?? (roomType === 'consultation' ? 3 : 1);
      const { error } = await supabase.from('rooms').insert({
        clinic_id: clinic.id,
        name: name.trim(),
        room_type: roomType,
        active: true,
        sort_order: 999,
        max_occupancy: maxOcc,
      });
      if (error) {
        toast.error(`슬롯 추가 실패: ${error.message}`);
        return;
      }
      await fetchRooms();
      setAddSlotName('');
      setAddSlotOpen(false);
      toast.success(`"${name.trim()}" 슬롯 추가 완료`);
    } finally {
      setAddSlotLoading(false);
    }
  };

  // T-20260614-foot-SLOT-CRUD-ALLTYPES: 추가 다이얼로그 오픈 (대상 room_type 지정)
  const handleOpenAddSlot = (roomType: string) => {
    setAddSlotType(roomType);
    setAddSlotName('');
    setAddSlotOpen(true);
  };

  // T-20260519-foot-SLOT-BATCH-EDIT / T-20260614-foot-SLOT-CRUD-ALLTYPES:
  //   커스텀 슬롯 삭제 (rooms 테이블 DELETE) — 전(全) 타입 공통.
  //   AC-4: 환자 보유 슬롯은 confirm 후에만 삭제(점유 판정은 RoomSection.getRoomOccupants와 동일 규칙).
  const handleDeleteSlot = async (roomType: string, roomId: string, roomName: string) => {
    const field = ROOM_FIELD_MAP[roomType];
    const expectedStatus = DROP_STATUS_FOR_ROOM[roomType];
    const occupants =
      field && expectedStatus
        ? rows.filter((ci) => ci[field] === roomName && ci.status === expectedStatus)
        : [];
    if (occupants.length > 0) {
      if (
        !window.confirm(
          `"${roomName}" 슬롯에 환자(${occupants.length}명)가 있습니다.\n삭제 시 해당 환자는 다른 슬롯으로 이동해주세요.\n삭제하시겠습니까?`,
        )
      )
        return;
    }
    const { error } = await supabase.from('rooms').delete().eq('id', roomId);
    if (error) {
      toast.error(`슬롯 삭제 실패: ${error.message}`);
      return;
    }
    await fetchRooms();
    toast.success(`"${roomName}" 슬롯 삭제 완료`);
  };

  /** 치료실 번호 선택 후 status='preconditioning' + treatment_room 동시 업데이트
   *  — T-20260511-foot-DASH-STAGE-ALL-SLOTS
   */
  const handleContextTreatmentStatusChange = async (ci: CheckIn, treatmentRoom: string) => {
    if (ci.id.startsWith('temp-')) {
      toast.info('체크인 처리 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    // T-20260611-foot-INACTIVE-ROOM-ENTRY-BLOCK AC-1/2(b)/3: 비활성 치료실 선택/배정 차단
    if (blockIfInactiveRoom(treatmentRoom)) return;
    markRecentlyUpdated(ci.id);
    let prevRow: CheckIn | undefined;
    setRows((curr) => {
      prevRow = curr.find((r) => r.id === ci.id);
      return curr.map((r) =>
        r.id === ci.id ? { ...r, status: 'preconditioning' as CheckInStatus, treatment_room: treatmentRoom } : r,
      );
    });
    const patch: Record<string, unknown> = { status: 'preconditioning', treatment_room: treatmentRoom };
    if (!ci.called_at && ci.status === 'registered') {
      patch.called_at = new Date().toISOString();
    }
    const { error } = await supabase.from('check_ins').update(patch).eq('id', ci.id);
    if (error) {
      setRows((curr) => curr.map((r) => (r.id === ci.id && prevRow ? prevRow : r)));
      toast.error(`상태 변경 실패: ${error.message}`);
      return;
    }
    {
      const now = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: ci.id,
        clinic_id: ci.clinic_id,
        from_status: ci.status,
        to_status: 'preconditioning',
      });
      setStageStartMap((prev) => new Map(prev).set(ci.id, now));
    }
    // T-20260522-foot-SPACE-AUTOROUTE: 금일동선 자동기입 — check_in_room_logs INSERT (graceful)
    void (async () => {
      try {
        await supabase.from('check_in_room_logs').insert({
          check_in_id: ci.id,
          clinic_id: ci.clinic_id,
          assigned_room: treatmentRoom,
          room_type: 'treatment',
        });
      } catch { /* graceful skip */ }
    })();
    // T-20260522-foot-SLOT-TIMETABLE-POPUP AC-2: 성공 토스트 제거
  };

  /** 레이저실 번호 선택 후 status='laser' + laser_room 동시 업데이트
   *  — T-20260504-foot-TABLET-LASER-ROOM-SELECT
   */
  const handleContextLaserStatusChange = async (ci: CheckIn, laserRoom: string) => {
    if (ci.id.startsWith('temp-')) {
      toast.info('체크인 처리 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    // T-20260611-foot-INACTIVE-ROOM-ENTRY-BLOCK AC-1/2(b)/3: 비활성 레이저실 선택/배정 차단
    if (blockIfInactiveRoom(laserRoom)) return;
    markRecentlyUpdated(ci.id);
    let prevRow: CheckIn | undefined;
    setRows((curr) => {
      prevRow = curr.find((r) => r.id === ci.id);
      return curr.map((r) =>
        r.id === ci.id ? { ...r, status: 'laser' as CheckInStatus, laser_room: laserRoom } : r,
      );
    });
    const patch: Record<string, unknown> = { status: 'laser', laser_room: laserRoom };
    if (!ci.called_at && ci.status === 'registered') {
      patch.called_at = new Date().toISOString();
    }
    const { error } = await supabase.from('check_ins').update(patch).eq('id', ci.id);
    if (error) {
      setRows((curr) => curr.map((r) => (r.id === ci.id && prevRow ? prevRow : r)));
      toast.error(`상태 변경 실패: ${error.message}`);
      return;
    }
    {
      const now = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: ci.id,
        clinic_id: ci.clinic_id,
        from_status: ci.status,
        to_status: 'laser',
      });
      setStageStartMap((prev) => new Map(prev).set(ci.id, now));
    }
    // T-20260522-foot-SPACE-AUTOROUTE: 금일동선 자동기입 — check_in_room_logs INSERT (graceful)
    void (async () => {
      try {
        await supabase.from('check_in_room_logs').insert({
          check_in_id: ci.id,
          clinic_id: ci.clinic_id,
          assigned_room: laserRoom,
          // T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 제거 → 레이저실 드롭은 항상 'laser'
          room_type: 'laser',
        });
      } catch { /* graceful skip */ }
    })();
    // T-20260522-foot-SLOT-TIMETABLE-POPUP AC-2: 성공 토스트 제거
  };

  /** 상태 플래그 변경 — T-20260502-foot-STATUS-COLOR-FLAG */
  const handleFlagChange = async (ci: CheckIn, flag: StatusFlag | null) => {
    if (ci.id.startsWith('temp-')) return;
    // T-20260519-foot-STATUS-REVERT fix: markRecentlyUpdated 호출 누락으로 Realtime이
    // DB 쓰기 중 fetchCheckIns()를 트리거 → MVCC 스냅샷 경합 → optimistic update 덮어쓰기 버그
    // 다른 모든 상태 변경 핸들러와 동일하게 markRecentlyUpdated 선행 호출
    markRecentlyUpdated(ci.id);
    // 낙관적 업데이트
    setRows((curr) => curr.map((r) => r.id === ci.id ? { ...r, status_flag: flag } : r));
    // T-20260610-foot-TREATMENT-COMPLETE-BTN: status_flag 전이 정본 write를 applyStatusFlagTransition 으로
    //   추출(SSOT). 진료완료 버튼 등 다른 진입점이 같은 경로를 재사용 — 병렬 2nd write 신설 금지.
    //   처리자(이름/역할)는 history 엔트리에 함께 적재(의료 추적).
    try {
      await applyStatusFlagTransition(ci, flag, {
        id: profile?.id ?? null,
        name: profile?.name ?? null,
        role: profile?.role ?? null,
      });
    } catch (e) {
      // 롤백
      setRows((curr) => curr.map((r) => r.id === ci.id ? { ...r, status_flag: ci.status_flag } : r));
      toast.error(`플래그 변경 실패: ${(e as Error).message}`);
      return;
    }
    const label = flag ? STATUS_FLAG_LABEL[flag] : '정상';
    toast.success(`플래그: ${label}`);
  };

  // T-20260515-foot-REVISIT-CLICK-AUTOCHECK AC-1: 슬롯 카드 클릭 = 차트 조회만 (체크인 X)
  // 수기 체크인은 우측 상단 체크인 버튼으로 처리 예정 (T-20260529-foot-RECEPTION-BTN-REMOVE)
  // ─────────────────────────────────────────────────────────────────────────────
  // CRITICAL: DO NOT bypass — Chart Open Guard
  // T-20260519-foot-CHART-OPEN-GUARD + T-20260606-foot-CHART-OPEN-ENTRYPOINT-UNIFY:
  //   handleReservationSelect 는 DraggableBox1Card/DraggableBox2ResvCard onSelect 의 구현체이며
  //   타임라인 차트 열림의 실제 트리거다. customer_id 직결 + 이름 fallback 코어는 단일 진입점
  //   openChartFor 로 흡수됐다. 이 래퍼는 단지 위임만 한다 — 직접 ctxOpenChart 호출/조건 추가 금지
  //   (caller 드리프트 = 6차 재발 근원). 코어를 고치려면 openChartFor 한 곳에서.
  // 회귀 방지 spec: T-20260519-foot-CHART-OPEN-GUARD.spec.ts /
  //                chart-open-gate/CHART-OPEN-GATE.spec.ts (G2~G4)
  // ─────────────────────────────────────────────────────────────────────────────
  const handleReservationSelect = useCallback(
    (res: Reservation) => openChartFor({ kind: 'reservation', reservation: res }),
    [openChartFor],
  );

  // T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA (P0-C 하드닝, field-soak) →
  //   T-20260606-foot-CHART-OPEN-ENTRYPOINT-UNIFY 로 단일 진입점 흡수:
  //   통합시간표 슬롯 아코디언 '예약 명단' 이름 클릭 → 차트 열기 핸들러.
  //   customer_id 직결 + 동명 1건 이름 fallback 코어는 openChartFor 가 일괄 처리 (체크인 전
  //   초진처럼 customer_id=null 명단도 이름 fallback 으로 열림). 이 래퍼는 위임만 — 직접 ctxOpenChart 금지.
  const handleNameChartOpen = useCallback(
    (customerId: string | null, name?: string | null) =>
      openChartFor({ kind: 'name', customerId, name }),
    [openChartFor],
  );

  // T-20260522-foot-CHECKIN-FIRST-INFO: 실제 DB INSERT 함수 (초진 폼 완료 후 또는 재진 직접 호출)
  // 초진(new) → consult_waiting, 재진(returning) → treatment_waiting
  const doCheckInForReservation = async (res: Reservation) => {
    if (!clinic) return;
    const { data: queueData, error: qErr } = await supabase.rpc('next_queue_number', {
      p_clinic_id: clinic.id,
      p_date: format(new Date(), 'yyyy-MM-dd'),
    });
    if (qErr || queueData == null) {
      toast.error(`대기번호 생성 실패: ${qErr?.message ?? '알 수 없는 오류'}`);
      return;
    }
    const qn = queueData as number;
    const needsExam = res.visit_type === 'returning';

    // T-20260522-foot-REVISIT-TREAT-WAIT FIX: INSERT 시 status 직접 세팅 (2단계 INSERT→UPDATE 패턴 폐기)
    // 재진(returning) → treatment_waiting, 예약없이방문 → consult_waiting
    // T-20260613-foot-FIELDBATCH item2: 초진(new) → [접수중](receiving). 셀프접수 초진(receiving)·예약상세 체크인과 통일.
    const nextStatus: CheckInStatus = res.visit_type === 'returning'
      ? 'treatment_waiting'
      : res.visit_type === 'new'
        ? 'receiving'
        : 'consult_waiting';

    // INSERT 먼저 완료 후 rows에 추가 (tempId 사용 금지 — UUID 불일치 방지)
    const { data: inserted, error } = await supabase
      .from('check_ins')
      .insert({
        clinic_id: clinic.id,
        queue_number: qn,
        customer_name: res.customer_name,
        customer_phone: res.customer_phone,
        customer_id: res.customer_id,
        reservation_id: res.id,
        visit_type: res.visit_type,
        status: nextStatus,
        notes: res.visit_type === 'returning' ? { needs_exam: needsExam } : {},
      })
      .select()
      .single();

    if (error || !inserted) {
      toast.error(`체크인 실패: ${error?.message ?? '알 수 없는 오류'}`);
      return;
    }

    const realId = inserted.id;
    await supabase.from('reservations').update({ status: 'checked_in' }).eq('id', res.id);
    // T-20260522-foot-PERF-TUNING OPT-3: pendingReservations는 timelineReservations 파생값 → 갱신으로 대체
    fetchTimelineReservations();

    const transNow = new Date().toISOString();
    await supabase.from('status_transitions').insert({
      check_in_id: realId,
      clinic_id: clinic.id,
      from_status: 'registered',
      to_status: nextStatus,
    });
    setStageStartMap((prev) => new Map(prev).set(realId, transNow));

    // T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL(REOPEN): 예약→체크인 직행이 대기슬롯으로 진입하면
    //   슬롯 이동/상태변경 핸들러(maybeAutoAssign 호출)와 동일하게 acting 클라이언트에서 직접 자동배정.
    //   기존엔 이 생성 경로가 maybeAutoAssign 미호출 → Realtime self-echo(visit_type 매칭) 의존이라
    //   walk-in 상담대기 등에서 자동배정 누락. best-effort·멱등(이미 배정 시 no-op).
    if (nextStatus === 'consult_waiting' || nextStatus === 'treatment_waiting') {
      void maybeAutoAssign(realId, nextStatus, profile?.id ?? null);
    }

    // DB 완료 후 rows에 추가 (실제 UUID)
    const newCheckIn: CheckIn = {
      ...(inserted as CheckIn),
      status: nextStatus,
    };
    setRows((prev) => [...prev, newCheckIn]);
    toast.success(`${res.customer_name} 체크인 완료 (#${qn})`);
    // 접수 버튼 클릭 직후 1번차트 즉시 열기
    setSelectedCheckIn(newCheckIn);
  };

  // T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거로 현재 미사용 — 복구용 보존
  // 접수는 셀프접수 매칭 또는 우측 상단 체크인 버튼으로만 처리
  // T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE: 초진 구 정보입력 폼(주민번호+동의서) 제거 → 모든 visit_type 바로 체크인
  const _handleReservationCheckIn = async (res: Reservation) => {
    if (!clinic) return;
    // 프론트 중복 방지 — 이미 체크인된 예약이면 차단
    const already = rows.find((r) => r.reservation_id === res.id && r.status !== 'cancelled');
    if (already) {
      toast.info(`${res.customer_name}님은 이미 체크인되어 있습니다`);
      setSelectedCheckIn(already);
      return;
    }

    // 초진/재진/체험 모두 폼 없이 바로 체크인 (slot 분기는 doCheckInForReservation 내부 유지)
    await doCheckInForReservation(res);
  };
  void _handleReservationCheckIn; // T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거로 미사용 — 복구용 보존

  // T-20260525-foot-RESV-CANCEL-CTX: 타임라인 예약 박스 우클릭/롱프레스 → 컨텍스트메뉴
  // AC-1: DashboardTimeline onReservationContext 콜백 — resvContextMenu 상태 세팅
  const handleReservationContext = useCallback((res: Reservation, pos: { x: number; y: number }) => {
    setResvContextMenu({ reservation: res, pos });
  }, []);

  // T-20260611-foot-CTXMENU-UNIFY-CANONICAL: Reservation → minimal CheckIn 어댑터.
  //   CustomerQuickMenu(5항목 canonical)가 사용하는 필드(customer_id/reservation_id/이름/전화/visit_type)만 매핑.
  //   예약관리(Reservations.tsx)의 resvAsCheckIn 과 동일 패턴 — 두 surface 메뉴 동작 동일성 보장.
  const resvAsCheckIn = useCallback((r: Reservation): CheckIn => ({
    id: `resv-${r.id}`,
    clinic_id: clinic?.id ?? '',
    customer_id: r.customer_id,
    reservation_id: r.id,
    queue_number: null,
    customer_name: r.customer_name ?? '',
    customer_phone: r.customer_phone,
    visit_type: r.visit_type,
    status: 'waiting' as CheckIn['status'],
    consultant_id: null,
    therapist_id: null,
    technician_id: null,
    consultation_room: null,
    treatment_room: null,
    laser_room: null,
    package_id: null,
    notes: null,
    treatment_memo: null,
    treatment_photos: null,
    doctor_note: null,
    examination_room: null,
    checked_in_at: `${r.reservation_date}T${r.reservation_time}`,
    called_at: null,
    completed_at: null,
    priority_flag: null,
    sort_order: 0,
    skip_reason: null,
    created_at: r.created_at,
    consultation_done: false,
    treatment_kind: null,
    preconditioning_done: false,
    pododulle_done: false,
    laser_minutes: null,
    prescription_items: null,
    document_content: null,
    doctor_confirm_charting: false,
    doctor_confirm_prescription: false,
    doctor_confirm_document: false,
    doctor_confirmed_at: null,
    healer_laser_confirm: false,
    prescription_status: 'none',
    status_flag: null,
    status_flag_history: null,
    assigned_counselor_id: null,
    treatment_category: null,
    treatment_contents: null,
    doctor_call_memo: null,
    doctor_ack_at: null,
    doctor_status: null,
    doctor_started_at: null,
    doctor_ended_at: null,
    call_list_manual_order: null,
  }), [clinic?.id]);

  // T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC2: 타임라인 우클릭 [예약상세] → 예약상세 팝업(ReservationDetailPopup) 오픈.
  //   ci.reservation_id 로 원본 Reservation 을 timelineReservations 에서 복원해 팝업 대상 세팅.
  // T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV: 대시보드 타임라인 슬롯 카드 우클릭 [예약상세] →
  //   대시보드 로컬 팝업을 띄우지 않고 예약관리(/admin/reservations)로 라우팅하며 정본 팝업을 연다.
  //   ⚠ 정합: 대시보드/예약관리 두 곳에 팝업 인스턴스가 공존(중복 마운트)하면 POPUP-SYNC(field-soak)와
  //   동기화가 깨질 수 있어, 클릭 원 예약 객체를 state로 넘겨 예약관리 정본 팝업(detail) 한 곳만 사용한다.
  const handleResvOpenDetailFromCtx = useCallback((ci: CheckIn) => {
    const resvId = ci.reservation_id;
    if (!resvId) { toast.error('예약 정보를 찾을 수 없습니다'); return; }
    const resv = timelineReservations.find((r) => r.id === resvId);
    if (!resv) { toast.error('예약 정보를 찾을 수 없습니다'); return; }
    navigate('/admin/reservations', { state: { openReservationDetail: resv } });
  }, [timelineReservations, navigate]);

  // T-20260611-foot-CTXMENU-UNIFY-CANONICAL: 타임라인 우클릭 [수납] → 연결된 check_in 의 결제 미니창.
  //   예약관리(handleResvOpenPayment)와 동일 — 체크인 전 예약은 "체크인 후 수납" 안내(가짜 check_in 결제 방지).
  const handleResvOpenPaymentFromCtx = useCallback(async (ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    if (ci.reservation_id) {
      const { data } = await supabase
        .from('check_ins')
        .select('*')
        .eq('reservation_id', ci.reservation_id)
        .maybeSingle();
      if (data) {
        setMiniPayTarget(data as CheckIn);
        setMiniPayAttemptCounter((c) => c + 1);
        return;
      }
    }
    toast.info('체크인 후 수납이 가능합니다');
  }, []);

  // T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC4: 대시보드 고객카드(체크인 큐) 우클릭 position-3 [예약상세] 핸들러.
  //   §8 가드 / escape-hatch 결과: 고객카드 check_in.reservation_id 는 *항상* null 이 아님(예약-origin 체크인은 세팅됨,
  //   워크인만 null — NewCheckInDialog.tsx:218 / SelfCheckIn.tsx:1049,1465). → "항상 예약 미연결" 조건 미충족 →
  //   FOLLOWUP 불요, directive(B) 적용: 라벨=예약상세 통일 + 연결예약 존재 시 ReservationDetailPopup 오픈.
  //   ⚠ L-002 LOGIC-LOCK 보존: reservation_id 없는(워크인) 카드는 신규예약 생성(handleNewReservation)으로 fallback —
  //   생성 capability 삭제 0, 기능 손실 0. handleNewReservation 함수 자체는 미변경(라벨/배선만 통일).
  const handleCardResvDetailOrCreate = useCallback(async (ci: CheckIn) => {
    const resvId = ci.reservation_id;
    if (!resvId) {
      // 워크인 등 연결 예약 없음 → 신규 예약 생성 진입점 보존(L-002)
      handleNewReservation(ci);
      return;
    }
    // T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV: 연결 예약 존재 → 예약관리로 라우팅하며 정본 팝업 오픈.
    //   대시보드 로컬 팝업 미사용(중복 마운트 제거). 타임라인 캐시 우선, 없으면 DB refetch(미래/타일자 예약 대응).
    const cached = timelineReservations.find((r) => r.id === resvId);
    if (cached) { navigate('/admin/reservations', { state: { openReservationDetail: cached } }); return; }
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', resvId)
      .maybeSingle();
    if (error || !data) {
      // 예약 row 소실(취소-삭제 등) → 생성 진입점으로 안전 fallback (dead 메뉴 방지)
      handleNewReservation(ci);
      return;
    }
    navigate('/admin/reservations', { state: { openReservationDetail: data as Reservation } });
  }, [timelineReservations, handleNewReservation, navigate]);

  // 미니 캘린더 클릭-외부 닫기
  useEffect(() => {
    if (!showCalendar) return;
    const handler = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCalendar]);

  const handleToggleCalendar = () => {
    setCalendarMonth(date); // 현재 선택 날짜 기준으로 월 동기화
    setShowCalendar((v) => !v);
  };

  // ── 당일 예약 전용 검색 (T-20260504-foot-SEARCH-SPLIT) ─────────────────────
  // T-20260514-foot-CHART-NO-VISIBLE: 예약 + 체크인 고객 모두 차트번호 로드 (AC-1 칸반 상시 표시용)
  useEffect(() => {
    const reservationIds = timelineReservations
      .map((r) => r.customer_id)
      .filter((id): id is string => !!id);
    const checkInIds = rows
      .map((ci) => ci.customer_id)
      .filter((id): id is string => !!id);
    const ids = [...new Set([...reservationIds, ...checkInIds])];
    if (ids.length === 0) { setTodayCustomerChartMap(new Map()); return; }
    supabase
      .from('customers')
      .select('id, chart_number')
      .in('id', ids)
      .then(({ data }) => {
        const m = new Map<string, string>();
        for (const c of (data ?? []) as { id: string; chart_number: string | null }[]) {
          if (c.chart_number) m.set(c.id, c.chart_number);
        }
        setTodayCustomerChartMap(m);
      });
  }, [timelineReservations, rows]);

  // 당일 예약 검색 함수 (이름 · 전화 뒷번호 4자리↑ · 차트번호)
  // T-20260525-foot-SEARCH-PHONE-DOB: E.164 phone 정규화 — leading 0 제거 → +8210… substring 매칭
  const doTodaySearch = useCallback((q: string) => {
    if (!q.trim()) { setTodaySearchResults([]); return; }
    const qLow = q.toLowerCase().trim();
    const digits = q.replace(/\D/g, '');
    // E.164: '01012345678' → '821012345678' 에 '01012345678' 포함 안됨
    // → leading 0 제거한 '1012345678'로도 매칭 시도
    const digitsNoLeadingZero = digits.startsWith('0') && digits.length >= 5 ? digits.slice(1) : null;
    const results = timelineReservations.filter((r) => {
      // T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: 표기명(현재 이름)도 검색 대상에 포함 →
      // 개명 후 "보이는 새 이름으로 검색 불가" 혼란 방지. denorm 이름 매칭은 그대로 유지(호환).
      const name = `${r.customers?.name ?? ''} ${r.customer_name ?? ''}`.toLowerCase();
      const phone = r.customer_phone?.replace(/\D/g, '') ?? '';
      const chart = r.customer_id ? (todayCustomerChartMap.get(r.customer_id) ?? '') : '';
      if (name.includes(qLow)) return true;
      if (digits.length >= 4 && phone.includes(digits)) return true;
      if (digitsNoLeadingZero && digitsNoLeadingZero.length >= 4 && phone.includes(digitsNoLeadingZero)) return true;
      if (chart.toLowerCase().includes(qLow)) return true;
      return false;
    });
    setTodaySearchResults(results.slice(0, 8));
  }, [timelineReservations, todayCustomerChartMap]);

  // 당일 검색 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (todaySearchWrapRef.current && !todaySearchWrapRef.current.contains(e.target as Node)) {
        setTodaySearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 당일 검색 결과 클릭 핸들러
  const handleTodaySearchSelect = useCallback((r: Reservation) => {
    setTodaySearchOpen(false);
    setTodaySearchQ('');
    setTodaySearchResults([]);
    // 체크인된 경우 → 상세 시트 오픈
    const checkIn = rows.find((ci) => ci.reservation_id === r.id);
    if (checkIn) {
      setSelectedCheckIn(checkIn);
    } else {
      // 아직 체크인 전 → 예약 시간 안내
      const timeStr = r.reservation_time ? r.reservation_time.slice(0, 5) : '';
      toast.info(`${r.customer_name ?? ''} — ${timeStr} 예약, 아직 체크인 전입니다`);
    }
  }, [rows]);

  // T-20260511-foot-DASH-REVISIT-RESERVE-BUG: visit_type 파라미터 추가 — 재진 슬롯에서 호출 시 'returning' pre-select
  const handleQuickSlotClick = (slot: { date: string; time: string; visit_type?: VisitType }) => {
    setQuickResvDraft({
      date: slot.date,
      time: slot.time,
      name: '',
      phone: '',
      visit_type: slot.visit_type ?? 'new',
      booking_memo: '', // T-20260504-foot-MEMO-RESTRUCTURE
    });
  };

  const getStageStart = useCallback((ci: CheckIn): string => {
    return stageStartMap.get(ci.id) ?? ci.checked_in_at;
  }, [stageStartMap]);

  // T-20260616-foot-CALLLIST-ENTRYORDER-FALLBACK-RECEIPTLEAK (옵션 A, read-side no-DDL):
  //   진료콜 명단 위젯 전용 rows — status_transitions 파생(callEntryMap)을 derivedCallEntryAt에 read-path 주입.
  //   ⚠ 원본 rows는 *불변*(별도 배열 — 칸반/INTREATMENT-BADGE/ROOMSUMMARY 등 다른 소비처 row shape 보존, GO_WARN iii).
  //   callEntryMap 미보유 행은 주입 없음 → callEntryTime이 ③ checked_in_at으로 정상 폴백.
  const doctorCallRows = useMemo(
    () => rows.map((r) => (callEntryMap.has(r.id) ? { ...r, derivedCallEntryAt: callEntryMap.get(r.id) } : r)),
    [rows, callEntryMap],
  );

  const getPkgLabel = useCallback((ci: CheckIn): PackageLabel | null => {
    if (ci.visit_type === 'new' || !ci.customer_id) return null;
    return pkgMap.get(ci.customer_id) ?? null;
  }, [pkgMap]);


  const swapSortOrder = useCallback(async (items: CheckIn[], idx: number, direction: 'up' | 'down') => {
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const a = items[idx];
    const b = items[swapIdx];
    const aOrder = a.sort_order;
    const bOrder = b.sort_order;

    setRows((curr) =>
      curr.map((r) => {
        if (r.id === a.id) return { ...r, sort_order: bOrder };
        if (r.id === b.id) return { ...r, sort_order: aOrder };
        return r;
      }),
    );

    await Promise.all([
      supabase.from('check_ins').update({ sort_order: bOrder }).eq('id', a.id),
      supabase.from('check_ins').update({ sort_order: aOrder }).eq('id', b.id),
    ]);
  }, []);

  const isToday = isSameDay(date, new Date());
  const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
  // T-20260523-foot-ROOM-DISABLE-TOGGLE AC-6 (3차): per-room 권한 함수
  //   admin/manager: 전체 방 토글 가능 (과거 날짜 제외)
  //   staff: room_assignments 기준 본인 담당 방만 토글 가능
  const canToggleRoom = useCallback((roomName: string): boolean => {
    if (isPast) return false;
    if (profile?.role === 'admin' || profile?.role === 'manager') return true;
    if (profile?.role === 'staff') return myAssignedRoomNames.has(roomName);
    return false;
  }, [isPast, profile, myAssignedRoomNames]);

  const doneCount = (byStatus['done'] ?? []).length;
  const totalActive = filtered.filter((r) => r.status !== 'done').length;

  // T-20260506-foot-SELFCHECKIN-MERGE: 1박스 원칙
  // 이미 체크인 레코드가 연결된 예약(reservation_id 매칭)은 칸반 슬롯·타임라인에서 숨김
  const checkedInResvIds = useMemo(() => {
    const s = new Set<string>();
    for (const ci of rows) {
      // T-20260611-foot-CHECKIN-CANCEL-RENAME-RESTORE: 체크인 취소(cancelled)된 row는 예약 슬롯 점유 해제.
      //   → 복구된 예약이 통합시간표에서 'confirmed'(예약가능) 슬롯으로 정상 표시되고 재체크인 가능해진다.
      if (ci.status === 'cancelled') continue;
      if (ci.reservation_id) s.add(ci.reservation_id);
    }
    return s;
  }, [rows]);

  // 체크인 완료된 예약 제외한 대기 예약 목록
  const activePendingReservations = useMemo(
    () => pendingReservations.filter((r) => !checkedInResvIds.has(r.id)),
    [pendingReservations, checkedInResvIds],
  );

  // 타임라인용: 체크인 레코드가 연결된 예약은 status를 'checked_in'으로 로컬 오버라이드 (dimmed 표시)
  const enrichedTimelineReservations = useMemo(
    () =>
      timelineReservations.map((r) =>
        checkedInResvIds.has(r.id) && r.status === 'confirmed'
          ? { ...r, status: 'checked_in' as const }
          : r,
      ),
    [timelineReservations, checkedInResvIds],
  );

  const newPendingReservations = activePendingReservations.filter((r) => r.visit_type === 'new');
  const returningPendingReservations = activePendingReservations.filter((r) => r.visit_type === 'returning');

  // checklist는 DB 마이그 후 consult_waiting으로 이관됨 — 호환성 유지 포함
  const allRegistered = [...(byStatus['registered'] ?? []), ...(byStatus['checklist'] ?? [])];
  // 슬롯별 분류
  const newRegistered = allRegistered.filter((ci) => ci.visit_type === 'new');
  const returningWaiting = (byStatus['registered'] ?? []).filter((ci) => ci.visit_type === 'returning');
  // 레이저대기: laser_waiting 상태 (4/30 표준 v2 — 이전 'laser' + no room 방식에서 전환)
  const laserWaiting = filtered.filter((ci) => ci.status === 'laser_waiting');
  // 힐러대기: healer_waiting 상태 (T-20260502-foot-HEALER-WAIT-SLOT)
  const healerWaiting = filtered.filter((ci) => ci.status === 'healer_waiting');

  // T-20260514-foot-DASH-REALTIME-FAIL AC-3 fix:
  // paymentTotal → pendingTotal (수납대기 컬럼 헤더 = 미수납 예정금액, not 전체 결제합계)
  // 기존 paymentTotal = dayPayments 전체합(done 포함) → 수납대기 컬럼에 오해 소지
  const pendingTotal = Array.from(pendingServiceMap.values()).reduce((s, v) => s + v, 0);
  const doneTotal = (byStatus['done'] ?? []).reduce((s, ci) => s + (dayPayments.get(ci.id) ?? 0), 0);

  // T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT AC-2: 완료 슬롯을 예약시간 '정시(hour) 버킷'으로 그룹.
  //   key = "HH"(예약시간 hour). 10:30 예약 → "10" 그룹(정시 묶기). 예약 없는 walk-in 은 checked_in_at 시(hour) 폴백,
  //   둘 다 없으면 '--'(시간미상). 완료 처리시각이 아닌 예약시간 기준(티켓 AC-2 명시).
  const doneHourGroups = useMemo<Array<[string, CheckIn[]]>>(() => {
    const list = byStatus['done'] ?? [];
    const map = new Map<string, CheckIn[]>();
    for (const ci of list) {
      const rt = ci.reservation_id ? resvTimeMap.get(ci.reservation_id) : null;
      let hourKey: string;
      if (rt && rt.length >= 2) {
        hourKey = rt.slice(0, 2); // "10:30:00" → "10"
      } else if (ci.checked_in_at) {
        hourKey = format(new Date(ci.checked_in_at), 'HH');
      } else {
        hourKey = '--';
      }
      if (!map.has(hourKey)) map.set(hourKey, []);
      map.get(hourKey)!.push(ci);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [byStatus, resvTimeMap]);

  const examRooms = roomsByType['examination'] ?? [];
  const consultRooms = roomsByType['consultation'] ?? [];
  const treatmentRooms = roomsByType['treatment'] ?? [];
  const laserRooms = roomsByType['laser'] ?? [];

  // ── 칸반 그룹별 JSX 렌더러 ──────────────────────────────────────────────────
  // T-20260508-foot-DASH-SLOT-REMOVE: new_queue, returning_queue case 완전 삭제
  // → 초진/재진 고객은 통합시간표(DashboardTimeline)에서 관리
  const renderKanbanGroup = useCallback((gid: KanbanGroupId): React.ReactNode => {
    switch (gid) {
      // T-20260602-foot-CHECKIN-RECEIVING-SLOT:
      //   셀프접수 후 발건강질문지 작성 중(미저장) 고객이 머무는 [접수중] 슬롯.
      //   설문 저장(fn_health_q_submit) 시 자동으로 receiving→consult_waiting 전이되어
      //   [상담대기]로 이동(AC-2). 직원 수동 드래그 이동도 가능(AC-6, else 분기 처리).
      case 'receiving_col':
        return (
          <div key="receiving_col" className="w-44 shrink-0">
            <DroppableColumn
              id="receiving"
              label="접수중"
              count={(byStatus['receiving'] ?? []).length}
              className="h-full"
              highlight="text-slate-700"
              // REVERSAL: items-start 전환 후 baseline floor 유지(붕괴 방지). 비대상 → 내부 스크롤 유지(동작 불변).
              style={{ minHeight: SLOT_COLUMN_HEIGHT }}
            >
              {(byStatus['receiving'] ?? []).map((ci, idx, arr) => (
                <div key={ci.id} className="relative group">
                  <DraggableCard
                    checkIn={ci}
                    compact
                    stageStart={getStageStart(ci)}
                    packageLabel={getPkgLabel(ci)}
                    onClick={() => handleCardClick(ci)}
                    onContextMenu={(e) => handleCardContext(ci, e)}
                  />
                  <div className="absolute right-0 top-0 flex flex-col opacity-0 group-hover:opacity-100 transition">
                    {idx > 0 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'up'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowUp className="h-3 w-3" /></button>}
                    {idx < arr.length - 1 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'down'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowDown className="h-3 w-3" /></button>}
                  </div>
                  {idx === 0 && arr.length > 1 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-teal-500 rounded-full" />}
                </div>
              ))}
            </DroppableColumn>
          </div>
        );
      case 'exam_section':
        return (
          <div key="exam_section" className="w-52 shrink-0 flex flex-col gap-2" style={{ minHeight: SLOT_COLUMN_HEIGHT }}>
            {examRooms.length > 0 ? (
              <RoomSection
                title="진료"
                color="bg-violet-100 text-violet-800"
                rooms={examRooms}
                roomType="examination"
                checkIns={filtered}
                assignments={assignments}
                gridCols="grid-cols-1"
                onCardClick={handleCardClick}
                onCardContext={handleCardContext}
                getStageStart={getStageStart}
                getPkgLabel={getPkgLabel}
                therapists={doctors}
                onTherapistChange={handleDoctorChange}
                inactiveRooms={inactiveRooms}
                myAssignedRoomNames={myAssignedRoomNames}
                canToggle={canToggleRoom}
                onToggleRoom={handleToggleRoom}
                batchEditMode={slotBatchEditMode}
                isToday={isToday}
                defaultRoomIds={defaultRoomIds}
                onAddSlot={handleOpenAddSlot}
                onDeleteSlot={handleDeleteSlot}
              />
            ) : (
              <div className="flex items-center text-xs font-bold px-2 py-1 rounded-t-lg bg-violet-100 text-violet-800">
                진료
                {slotBatchEditMode && isToday && (
                  <button
                    data-testid="add-slot-btn-examination"
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-white hover:bg-neutral-900"
                    title="슬롯 추가"
                    onClick={() => handleOpenAddSlot('examination')}
                  >+ 추가</button>
                )}
              </div>
            )}
            <DroppableColumn
              id="exam_waiting"
              label="진료대기"
              count={(byStatus['exam_waiting'] ?? []).length}
              className="flex-1"
              highlight="text-violet-700"
            >
              {(byStatus['exam_waiting'] ?? []).map((ci, idx, arr) => (
                <div key={ci.id} className="relative group">
                  <DraggableCard
                    checkIn={ci}
                    compact
                    stageStart={getStageStart(ci)}
                    packageLabel={getPkgLabel(ci)}
                    onClick={() => handleCardClick(ci)}
                    onContextMenu={(e) => handleCardContext(ci, e)}
                  />
                  <div className="absolute right-0 top-0 flex flex-col opacity-0 group-hover:opacity-100 transition">
                    {idx > 0 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'up'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowUp className="h-3 w-3" /></button>}
                    {idx < arr.length - 1 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'down'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowDown className="h-3 w-3" /></button>}
                  </div>
                  {idx === 0 && arr.length > 1 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-teal-500 rounded-full" />}
                </div>
              ))}
            </DroppableColumn>
          </div>
        );
      // experience_queue: T-20260513-foot-VISITTYPE-SIMPLIFY — 체험 전면 삭제로 제거됨
      case 'consult_waiting_col':
        return (
          <div key="consult_waiting_col" className="w-44 shrink-0">
            <DroppableColumn
              id="consult_waiting"
              label="상담대기"
              count={(byStatus['consult_waiting'] ?? []).length}
              className="h-full"
              highlight="text-blue-700"
              // [상담대기] = baseline 기준 슬롯. items-start 전환 후 minHeight floor 로 baseline 확정.
              style={{ minHeight: SLOT_COLUMN_HEIGHT }}
            >
              {(byStatus['consult_waiting'] ?? []).map((ci, idx, arr) => (
                <div key={ci.id} className="relative group">
                  <DraggableCard
                    checkIn={ci}
                    compact
                    stageStart={getStageStart(ci)}
                    packageLabel={getPkgLabel(ci)}
                    onClick={() => handleCardClick(ci)}
                    onContextMenu={(e) => handleCardContext(ci, e)}
                  />
                  <div className="absolute right-0 top-0 flex flex-col opacity-0 group-hover:opacity-100 transition">
                    {idx > 0 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'up'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowUp className="h-3 w-3" /></button>}
                    {idx < arr.length - 1 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'down'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowDown className="h-3 w-3" /></button>}
                  </div>
                  {idx === 0 && arr.length > 1 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-teal-500 rounded-full" />}
                </div>
              ))}
            </DroppableColumn>
          </div>
        );
      case 'consult_rooms': {
        // T-20260519-foot-SLOT-BATCH-EDIT: AC-1 [상담] 슬롯 행 제거 → 미배정 graceful 배너
        // T-20260516-foot-CONSULT-KANBAN-MISS: consultation_room 미배정 고객 graceful 처리 유지
        const consultUnassigned = (byStatus['consultation'] ?? []).filter((ci) => !ci.consultation_room);
        return (
          <div key="consult_rooms" className="w-44 shrink-0 flex flex-col gap-2">
            {/* AC-1: [상담] DroppableColumn 제거 → 미배정 환자 배너 + 카드 표시 */}
            {consultUnassigned.length > 0 && (
              <div className="mb-0">
                <div className="px-1.5 py-1 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700 mb-1">
                  ⚠️ 상담실 미배정 {consultUnassigned.length}명 — 슬롯으로 이동해주세요
                </div>
                {consultUnassigned.map((ci) => (
                  <div key={ci.id} className="mb-1">
                    <DraggableCard
                      checkIn={ci}
                      compact
                      stageStart={getStageStart(ci)}
                      packageLabel={getPkgLabel(ci)}
                      onClick={() => handleCardClick(ci)}
                      onContextMenu={(e) => handleCardContext(ci, e)}
                    />
                  </div>
                ))}
              </div>
            )}
            {/* AC-3/AC-4: 배치편집 모드 패널 (오늘만) */}
            {slotBatchEditMode && isToday && (
              <div className="flex items-center gap-1 flex-wrap" data-testid="slot-batch-edit-panel">
                <span className="text-[10px] font-medium text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">편집 모드</span>
                <button
                  data-testid="add-consult-slot-btn"
                  className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-white hover:bg-neutral-900"
                  onClick={() => handleOpenAddSlot('consultation')}
                >+ 슬롯추가</button>
                <button
                  className="text-[10px] px-2 py-0.5 rounded border border-input text-muted-foreground hover:bg-muted"
                  onClick={() => setSlotBatchEditMode(false)}
                >완료</button>
              </div>
            )}
            {/* AC-2: 상담실1~N 슬롯 정상 유지 + 배치편집 잠금/삭제 오버레이 */}
            {consultRooms.length > 0 && (
              <div className="flex flex-col">
                <div className="text-xs font-bold px-2 py-1 rounded-t-lg bg-blue-100 text-blue-800">
                  상담실
                  <span className="ml-1.5 font-normal opacity-70">({consultRooms.length}실)</span>
                </div>
                <div className="grid gap-x-1.5 gap-y-1.5 p-1.5 bg-muted/10 rounded-b-lg border border-t-0 grid-cols-1">
                  {consultRooms.map((room) => {
                    const isDefault = defaultRoomIds.has(room.id);
                    const roomStaff = assignments.find((a) => a.room_name === room.name);
                    const roomOccupants = filtered.filter(
                      (ci) => ci.consultation_room === room.name && ci.status === 'consultation',
                    );
                    return (
                      <div key={room.id} className="relative">
                        <RoomSlot
                          roomName={room.name}
                          roomType="consultation"
                          staffName={roomStaff?.staff_name ?? null}
                          occupants={roomOccupants}
                          maxOccupancy={room.max_occupancy}
                          onCardClick={handleCardClick}
                          onCardContext={handleCardContext}
                          getStageStart={getStageStart}
                          getPkgLabel={getPkgLabel}
                          therapists={consultants}
                          currentStaffId={roomStaff?.staff_id ?? null}
                          onTherapistChange={handleConsultantChange}
                          isInactive={inactiveRooms.has(room.name)}
                          isMyRoom={myAssignedRoomNames.has(room.name)}
                          canToggle={canToggleRoom(room.name)}
                          onToggle={(target) => handleToggleRoom(room.name, 'consultation', target)}
                        />
                        {/* 배치편집 모드: 기본 슬롯=잠금, 커스텀 슬롯=삭제 버튼 */}
                        {slotBatchEditMode && isToday && (
                          <div className="absolute top-1 right-1 z-10">
                            {isDefault ? (
                              <span className="text-[10px] text-gray-400" title="기본 슬롯은 삭제 불가">🔒</span>
                            ) : (
                              <button
                                data-testid={`delete-consult-slot-${room.id}`}
                                className="text-[10px] text-red-500 hover:text-red-700 px-1 rounded bg-white/90 border border-red-200 hover:bg-red-50"
                                title="슬롯 삭제"
                                onClick={(e) => { e.stopPropagation(); handleDeleteSlot('consultation', room.id, room.name); }}
                              >✕</button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      }
      // T-20260511-foot-DASH-BATCH-INDIVIDUAL: waiting_columns → 3개 독립 케이스
      // 배치편집 모드에서 각 슬롯을 개별 드래그/이동할 수 있도록 분리
      case 'treatment_waiting_col':
        return (
          <div key="treatment_waiting_col" data-testid="slot-col-treatment-waiting" className="w-40 shrink-0 flex flex-col">
            <DroppableColumn
              id="treatment_waiting"
              label="치료대기"
              count={(byStatus['treatment_waiting'] ?? []).length}
              className="flex-1"
              highlight="text-amber-700"
              // 치료대기(비대상): 고정 height → minHeight floor. items-start 하에서 baseline 유지 + 내부 스크롤(동작 불변).
              style={{ minHeight: SLOT_COLUMN_HEIGHT }}
            >
              {(byStatus['treatment_waiting'] ?? []).map((ci, idx, arr) => (
                <div key={ci.id} className="relative group">
                  <DraggableCard
                    checkIn={ci}
                    compact
                    stageStart={getStageStart(ci)}
                    packageLabel={getPkgLabel(ci)}
                    pkgLabelCompact
                    onClick={() => handleCardClick(ci)}
                    onContextMenu={(e) => handleCardContext(ci, e)}
                  />
                  <div className="absolute right-0 top-0 flex flex-col opacity-0 group-hover:opacity-100 transition">
                    {idx > 0 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'up'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowUp className="h-3 w-3" /></button>}
                    {idx < arr.length - 1 && <button onClick={(e) => { e.stopPropagation(); swapSortOrder(arr, idx, 'down'); }} className="p-0.5 rounded hover:bg-gray-200"><ArrowDown className="h-3 w-3" /></button>}
                  </div>
                  {idx === 0 && arr.length > 1 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-teal-500 rounded-full" />}
                </div>
              ))}
            </DroppableColumn>
          </div>
        );
      case 'laser_waiting_col':
        return (
          <div key="laser_waiting_col" className="w-40 shrink-0">
            <DroppableColumn
              id="laser_waiting"
              label="레이저대기"
              count={laserWaiting.length}
              className="h-full"
              highlight="text-rose-700"
              style={{ minHeight: SLOT_COLUMN_HEIGHT }}
            >
              {laserWaiting.map((ci) => (
                <DraggableCard
                  key={ci.id}
                  checkIn={ci}
                  compact
                  stageStart={getStageStart(ci)}
                  packageLabel={getPkgLabel(ci)}
                  onClick={() => handleCardClick(ci)}
                  onContextMenu={(e) => handleCardContext(ci, e)}
                />
              ))}
            </DroppableColumn>
          </div>
        );
      // T-20260502-foot-HEALER-WAIT-SLOT: 힐러대기 슬롯 (독립 그룹으로 분리)
      case 'healer_waiting_col':
        return (
          <div key="healer_waiting_col" className="w-40 shrink-0">
            <DroppableColumn
              id="healer_waiting"
              label="힐러대기"
              count={healerWaiting.length}
              className="h-full"
              highlight="text-violet-700"
              style={{ minHeight: SLOT_COLUMN_HEIGHT }}
            >
              {healerWaiting.map((ci) => (
                <DraggableCard
                  key={ci.id}
                  checkIn={ci}
                  compact
                  stageStart={getStageStart(ci)}
                  packageLabel={getPkgLabel(ci)}
                  onClick={() => handleCardClick(ci)}
                  onContextMenu={(e) => handleCardContext(ci, e)}
                />
              ))}
            </DroppableColumn>
          </div>
        );
      case 'treatment_rooms': {
        // T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 제거 → 치료실만 렌더.
        if (treatmentRooms.length === 0) return null;
        return (
          <div key="treatment_rooms" data-testid="slot-col-treatment-rooms" className="w-[480px] shrink-0 flex flex-col gap-1.5" style={{ minHeight: SLOT_COLUMN_HEIGHT }}>
            <RoomSection
              fillHeight
              title="치료실"
              color="bg-amber-100 text-amber-800"
              rooms={treatmentRooms}
              roomType="treatment"
              checkIns={filtered}
              assignments={assignments}
              gridCols="grid-cols-3"
              onCardClick={handleCardClick}
              onCardContext={handleCardContext}
              getStageStart={getStageStart}
              getPkgLabel={getPkgLabel}
              therapists={therapists}
              onTherapistChange={handleTherapistChange}
              inactiveRooms={inactiveRooms}
              myAssignedRoomNames={myAssignedRoomNames}
              canToggle={canToggleRoom}
              onToggleRoom={handleToggleRoom}
              batchEditMode={slotBatchEditMode}
              isToday={isToday}
              defaultRoomIds={defaultRoomIds}
              onAddSlot={handleOpenAddSlot}
              onDeleteSlot={handleDeleteSlot}
            />
          </div>
        );
      }
      case 'desk_section':
        return (
          // T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT AC-4/AC-5: 완료 슬롯은 desk_section 에서 분리(우측 단독, renderDoneColumn).
          //   desk_section 은 이제 수납대기 단독.
          // T-20260622-foot-DASH-PAYMENT-WAITING-EMPTY-HEIGHT: T-20260620 의 scoped override(PAYMENT_WAITING_COLUMN_HEIGHT,
          //   max(560px,…))는 빈 상태에서 done/laser(420px floor)보다 과성장하는 회귀를 유발 → SLOT_COLUMN_HEIGHT 로 통일 복귀.
          //   빈 상태 baseline = 완료·레이저실 동일(AC-1). naturalGrow(아래 DroppableColumn)는 유지 → 카드 추가 시 자연 성장(AC-2).
          <div key="desk_section" data-testid="slot-col-desk" className="w-52 shrink-0 flex flex-col gap-2" style={{ minHeight: SLOT_COLUMN_HEIGHT }}>
            <DroppableColumn
              id="payment_waiting"
              label="수납대기"
              count={(byStatus['payment_waiting'] ?? []).length}
              // REVERSAL: grow(basis auto)+naturalGrow → 카드 누적 시 칸 자연 성장(내부 스크롤 X). 빈 상태는 wrapper minHeight 로 baseline.
              className="grow shrink-0"
              naturalGrow
              highlight="text-purple-700"
              subtitle={
                pendingTotal > 0 ? (
                  <div className="text-xs font-semibold text-purple-700 tabular-nums">
                    대기 {formatAmount(pendingTotal)}
                  </div>
                ) : undefined
              }
            >
              {(byStatus['payment_waiting'] ?? []).map((ci) => (
                <div key={ci.id}>
                  <DraggableCard checkIn={ci} compact stageStart={getStageStart(ci)} packageLabel={getPkgLabel(ci)} onClick={() => handleCardClick(ci)} onContextMenu={(e) => handleCardContext(ci, e)} />
                  {/* AC-7: 수납대기 pending 금액 표시 (check_in_services 기반) */}
                  {(pendingServiceMap.get(ci.id) ?? 0) > 0 && (
                    <div className="mt-0.5 px-1 text-xs text-purple-700 font-semibold tabular-nums text-right">
                      대기 {formatAmount(pendingServiceMap.get(ci.id)!)}
                    </div>
                  )}
                  {/* T-20260515-foot-PAYMENT-MINI-WINDOW AC-1: [결제하기] → 미니창 */}
                  {/* T-20260525-foot-PMW-SCROLL-FIX: E2E 진입점 testid (수납대기 결제하기) */}
                  <button
                    data-testid="btn-pay"
                    onClick={(e) => { e.stopPropagation(); setMiniPayTarget(ci); }}
                    className="mt-0.5 w-full rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition flex items-center justify-center gap-0.5"
                  >
                    <CreditCard className="h-2.5 w-2.5" /> 결제하기
                  </button>
                </div>
              ))}
            </DroppableColumn>
          </div>
        );
      case 'laser_rooms':
        return laserRooms.length > 0 ? (
          <div key="laser_rooms" data-testid="slot-col-laser-rooms" className="w-[480px] shrink-0 flex flex-col" style={{ minHeight: SLOT_COLUMN_HEIGHT }}>
            {/* T-20260520-foot-LASER-DROPDOWN: therapists(technician only) + onTherapistChange 전달 — 장비명 드롭다운 복구 */}
            <RoomSection
              fillHeight
              title="레이저실"
              color="bg-rose-100 text-rose-800"
              rooms={laserRooms}
              roomType="laser"
              checkIns={filtered}
              assignments={assignments}
              gridCols="grid-cols-3"
              onCardClick={handleCardClick}
              onCardContext={handleCardContext}
              getStageStart={getStageStart}
              getPkgLabel={getPkgLabel}
              therapists={therapists.filter(s => s.role === 'technician')}
              onTherapistChange={handleLaserTechChange}
              inactiveRooms={inactiveRooms}
              myAssignedRoomNames={myAssignedRoomNames}
              canToggle={canToggleRoom}
              onToggleRoom={handleToggleRoom}
              batchEditMode={slotBatchEditMode}
              isToday={isToday}
              defaultRoomIds={defaultRoomIds}
              onAddSlot={handleOpenAddSlot}
              onDeleteSlot={handleDeleteSlot}
            />
          </div>
        ) : null;
      default:
        return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    newRegistered, newPendingReservations, returningWaiting, returningPendingReservations,
    examRooms, consultRooms, treatmentRooms, laserRooms,
    byStatus, filtered, assignments, doctors, therapists, consultants,
    laserWaiting, pendingTotal, doneTotal, dayPayments, doneCount,
    getStageStart, getPkgLabel, swapSortOrder,
    handleCardClick, handleCardContext,
    handleDoctorChange, handleConsultantChange, handleTherapistChange, handleLaserTechChange,
    slotBatchEditMode, isToday, defaultRoomIds, handleOpenAddSlot, handleDeleteSlot,
    setAddSlotName, setAddSlotOpen, setSlotBatchEditMode,
    // T-20260523-foot-ROOM-DISABLE-TOGGLE (AC-6/8/9 3차)
    inactiveRooms, tomorrowInactiveRooms, myAssignedRoomNames, canToggleRoom, handleToggleRoom,
  ]);

  // T-20260614-foot-HEALER-LASER-WAIT-PAIR-LAYOUT: 레이저대기/힐러대기 상하 한 쌍.
  // exam_section(진료 위 / 진료대기 아래) 패턴 재사용 — 한 컬럼(w-40) 안에 위아래로 스택.
  // 일반(운영) 모드에서만 사용. 편집 모드 renderKanbanGroup 케이스는 불변 → 개별이동 보존
  // (laser_rooms 가 일반모드 클러스터·편집모드 개별드래그로 분리된 기존 선례와 동일 패턴).
  const renderWaitingPair = useCallback(() => (
    <div className="w-40 shrink-0 flex flex-col gap-2" style={{ minHeight: SLOT_COLUMN_HEIGHT }} data-testid="laser-healer-wait-pair">
      {/* AC-1: 현장 요청·티켓 명시 순서 "[힐러대기 / 레이저대기]" — 힐러대기 위 / 레이저대기 아래.
          도메인 흐름(재진: 힐러/프리컨디셔닝 → 레이저)과도 일치. */}
      <DroppableColumn
        id="healer_waiting"
        label="힐러대기"
        count={healerWaiting.length}
        className="flex-1 min-h-0"
        highlight="text-violet-700"
      >
        {healerWaiting.map((ci) => (
          <DraggableCard
            key={ci.id}
            checkIn={ci}
            compact
            stageStart={getStageStart(ci)}
            packageLabel={getPkgLabel(ci)}
            onClick={() => handleCardClick(ci)}
            onContextMenu={(e) => handleCardContext(ci, e)}
          />
        ))}
      </DroppableColumn>
      <DroppableColumn
        id="laser_waiting"
        label="레이저대기"
        count={laserWaiting.length}
        className="flex-1 min-h-0"
        highlight="text-rose-700"
      >
        {laserWaiting.map((ci) => (
          <DraggableCard
            key={ci.id}
            checkIn={ci}
            compact
            stageStart={getStageStart(ci)}
            packageLabel={getPkgLabel(ci)}
            onClick={() => handleCardClick(ci)}
            onContextMenu={(e) => handleCardContext(ci, e)}
          />
        ))}
      </DroppableColumn>
    </div>
  ), [laserWaiting, healerWaiting, getStageStart, getPkgLabel, handleCardClick, handleCardContext]);

  // T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT: 완료 슬롯 = 대시보드 우측 단독 컬럼.
  //   AC-1: 성함만 보이는 회색 초소형 칩(풀카드 대신). 칩 클릭 → handleCardClick(기존 상세/팝업) → 정보 접근 유지.
  //   AC-2: 정시(hour) 그룹 헤더 + 기본 접힘(collapsed) + 헤더 클릭 시 칩 가로 wrap 펼침. 헤더에 인원수.
  //   AC-5: 칸반 흐름 마지막이 아닌 우측 단독 컬럼으로 분리(렌더 위치는 호출부). 드롭 타깃 id="done" 유지 → 드래그 이동 정상.
  //   ⚠ MEDLAW22-B-GATE(완료 이동 하드차단) 불간섭 — 이동 후 '표시'만 변경.
  const renderDoneColumn = useCallback(() => (
    <div
      key="done_col"
      data-testid="slot-col-done"
      className="w-44 shrink-0 flex flex-col"
      style={{ minHeight: SLOT_COLUMN_HEIGHT }}
    >
      <DroppableColumn
        id="done"
        label="완료"
        count={doneCount}
        className="grow shrink-0"
        naturalGrow
        highlight="text-emerald-700"
        subtitle={
          doneTotal > 0 ? (
            <div className="text-xs font-semibold text-emerald-700 tabular-nums">
              {formatAmount(doneTotal)}
            </div>
          ) : undefined
        }
      >
        {doneHourGroups.length > 0 && (
          <div className="space-y-1" data-testid="done-hour-groups">
            {doneHourGroups.map(([hourKey, cis]) => {
              const expanded = expandedDoneHours.has(hourKey);
              const hourLabel = hourKey === '--' ? '시간미상' : `${Number(hourKey)}시`;
              return (
                <div key={hourKey} data-testid={`done-hour-group-${hourKey}`}>
                  <button
                    type="button"
                    data-testid={`done-hour-header-${hourKey}`}
                    onClick={() => toggleDoneHour(hourKey)}
                    aria-expanded={expanded}
                    className="w-full flex items-center justify-between gap-1 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition"
                  >
                    <span className="flex items-center gap-1 min-w-0">
                      <ChevronDown className={cn('h-3 w-3 shrink-0 text-gray-400 transition-transform', !expanded && '-rotate-90')} />
                      <span className="truncate">{hourLabel}</span>
                    </span>
                    <span className="shrink-0 text-gray-500 tabular-nums">{cis.length}</span>
                  </button>
                  {expanded && (
                    <div className="mt-1 flex flex-wrap gap-1 px-0.5" data-testid={`done-hour-chips-${hourKey}`}>
                      {/* T-20260623-foot-DASH-DONESLOT-BATCHEDIT-MOVE-REGRESSION: 칩을 draggable 로 복구
                          (성함칩 비주얼 유지 + useDraggable 재부착) → 완료 환자 다른 슬롯 이동 회귀 해소. */}
                      {cis.map((ci) => (
                        <DraggableDoneChip
                          key={ci.id}
                          checkIn={ci}
                          onClick={() => handleCardClick(ci)}
                          onContextMenu={(e) => handleCardContext(ci, e)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DroppableColumn>
    </div>
  ), [doneCount, doneTotal, doneHourGroups, expandedDoneHours, toggleDoneHour, handleCardClick, handleCardContext]);

  // T-20260510-foot-DASH-DUAL-HSCROLL v2: overflow-hidden — Dashboard 자체 가로 팽창 격리
  return (
    // T-20260522-foot-TABLET-DUAL-LAYOUT: data-orientation + data-testid="dashboard-root" (E2E 테스트용)
    // T-20260522-foot-TIMETABLE-SCROLL: data-timeline-folded — CSS max-width:2rem fallback를 fold 상태에만 한정
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-orientation={orientation} data-timeline-folded={String(timelineFolded)} data-testid="dashboard-root">
      {/* Header */}
      {/* T-20260522-foot-TABLET-DUAL-LAYOUT: data-dashboard-header — CSS 터치 타겟 타겟팅용 */}
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 py-2 border-b bg-white/80" data-dashboard-header>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" data-testid="dash-date-prev" onClick={() => { dateUserPinnedRef.current = true; setDate((d) => subDays(d, 1)); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {/* 날짜 클릭 → 미니 캘린더 팝업 */}
          <div ref={calendarRef} className="relative">
            <button
              onClick={handleToggleCalendar}
              className="min-w-[160px] text-center text-sm font-medium flex items-center gap-1 justify-center px-2 py-1 rounded-md hover:bg-gray-100 transition select-none"
              title="클릭하여 날짜 선택"
            >
              <Calendar className="h-3.5 w-3.5 text-teal-600 shrink-0" />
              {format(date, 'M월 d일 (EEE)', { locale: ko })}
              {isToday && <span className="ml-0.5 text-xs text-teal-700">오늘</span>}
              <ChevronDown className={cn('h-3 w-3 text-gray-400 transition-transform', showCalendar && 'rotate-180')} />
            </button>
            {showCalendar && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50">
                <MiniCalendar
                  selected={date}
                  onSelect={(d) => { dateUserPinnedRef.current = true; setDate(d); setShowCalendar(false); }}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                />
              </div>
            )}
          </div>
          <Button variant="outline" size="icon-sm" data-testid="dash-date-next" onClick={() => { dateUserPinnedRef.current = true; setDate((d) => addDays(d, 1)); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" data-testid="dash-date-today" onClick={() => { dateUserPinnedRef.current = false; setDate(new Date()); }}>
              오늘로
            </Button>
          )}
          {/* T-20260613-foot-FIELDBATCH item6: 날짜 옆 "배정 carry-over (date)" 인디케이터 제거(현장 김주연 총괄 요청).
              공간배정 carry-over 데이터 적용 로직(fetchAssignments eff.hasToday 게이트)은 불변 — 시각 라벨만 삭제. */}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>진행 <strong className="text-foreground">{totalActive}</strong></span>
            <span>·</span>
            <span>완료 <strong className="text-emerald-700">{doneCount}</strong></span>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="h-11">
              <TabsTrigger value="all" className="text-xs px-2.5 min-h-[44px]">전체</TabsTrigger>
              <TabsTrigger value="new" className="text-xs px-2.5 min-h-[44px]">신규</TabsTrigger>
              <TabsTrigger value="returning" className="text-xs px-2.5 min-h-[44px]">재진</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* 줌 컨트롤 */}
          <div className="flex items-center gap-0.5 border rounded-md bg-white/80 px-1 py-0.5">
            <button
              onClick={() => handleZoom(-10)}
              disabled={zoomLevel <= 50}
              className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-40 transition"
              title="축소 (-10%)"
            >
              <Minus className="h-3.5 w-3.5 text-gray-600" />
            </button>
            <button
              onClick={() => setZoomLevel((_prev) => {
                localStorage.setItem('foot-dash-zoom', '100');
                return 100;
              })}
              className="px-1.5 text-xs tabular-nums font-mono text-gray-700 hover:bg-gray-100 rounded transition min-w-[36px] text-center"
              title="클릭하여 100%로 초기화"
            >
              {zoomLevel}%
            </button>
            <button
              onClick={() => handleZoom(+10)}
              disabled={zoomLevel >= 150}
              className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-40 transition"
              title="확대 (+10%)"
            >
              <ZoomIn className="h-3.5 w-3.5 text-gray-600" />
            </button>
          </div>

          {/* T-20260519-foot-SLOT-BATCH-EDIT: 상담 슬롯 배치편집 버튼 (오늘만, AC-3/4) */}
          {isToday && (
            <button
              data-testid="slot-batch-edit-btn"
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition',
                slotBatchEditMode
                  ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 border-gray-200',
              )}
              onClick={() => setSlotBatchEditMode((v) => !v)}
              title="슬롯 추가/삭제 — 진료·상담·치료·레이저 (오늘만)"
            >
              슬롯편집
            </button>
          )}

          {/* T-20260526-foot-LAYOUT-USER-CUSTOM: 레이아웃 편집 (모든 계정 — staff 포함) */}
          {profile && (
            <div className="flex items-center gap-1">
              {isLayoutEdit && (
                <>
                  <button
                    onClick={resetGroupOrder}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-600 hover:bg-gray-100 border transition"
                    title="내 배치를 초기화하고 지점 기본으로 복원"
                  >
                    <RotateCcw className="h-3 w-3" /> 초기화
                  </button>
                  {/* admin/manager 전용: 전 직원 기본으로 저장 */}
                  {['admin', 'manager'].includes(profile.role) && (
                    <button
                      onClick={() => saveClinicDefaultLayoutToDb(groupOrder, zoomLevel)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-amber-700 hover:bg-amber-50 border border-amber-300 transition"
                      title="현재 배치를 전 직원 기본으로 저장 (관리자 전용)"
                    >
                      <LayoutGrid className="h-3 w-3" /> 전 직원 기본
                    </button>
                  )}
                </>
              )}
              <button
                onClick={handleLayoutEditToggle}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition',
                  isLayoutEdit
                    ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                    : 'text-gray-600 hover:bg-gray-100 border-gray-200',
                )}
                title={isLayoutEdit ? '편집 완료 (내 배치 저장)' : '슬롯 배치 편집'}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {isLayoutEdit ? '편집 완료' : '배치 편집'}
              </button>
            </div>
          )}

          {/* 당일 예약 전용 검색 (T-20260504-foot-SEARCH-SPLIT) */}
          <div ref={todaySearchWrapRef} className="relative">
            <button
              onClick={() => { setTodaySearchOpen((v) => !v); setTimeout(() => todaySearchRef.current?.focus(), 50); }}
              className="flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs text-teal-700 hover:bg-teal-100 transition"
              title="당일 예약 환자 검색 (이름·전화·차트번호)"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">당일 검색</span>
            </button>
            {todaySearchOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border bg-background shadow-lg">
                {/* 입력창 */}
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Search className="h-4 w-4 text-teal-600 shrink-0" />
                  <input
                    ref={todaySearchRef}
                    value={todaySearchQ}
                    onChange={(e) => {
                      setTodaySearchQ(e.target.value);
                      if (todaySearchTimer.current) clearTimeout(todaySearchTimer.current);
                      todaySearchTimer.current = setTimeout(() => doTodaySearch(e.target.value), 200);
                    }}
                    placeholder="이름 · 전화 뒷번호 · 차트번호"
                    className="flex-1 bg-transparent text-sm outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setTodaySearchOpen(false);
                        setTodaySearchQ('');
                        setTodaySearchResults([]);
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => { setTodaySearchOpen(false); setTodaySearchQ(''); setTodaySearchResults([]); }}
                    className="text-muted-foreground hover:text-foreground transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* 범위 표시 */}
                <div className="px-3 py-1.5 bg-teal-50/60 border-b">
                  <span className="text-[10px] font-medium text-teal-700">
                    {format(date, 'M월 d일 (EEE)', { locale: ko })} 예약 한정
                  </span>
                </div>
                {/* 결과 목록 */}
                {todaySearchResults.length > 0 ? (
                  <div className="max-h-56 overflow-auto p-1">
                    {todaySearchResults.map((r) => {
                      const isCheckedIn = rows.some((ci) => ci.reservation_id === r.id);
                      const chart = r.customer_id ? (todayCustomerChartMap.get(r.customer_id) ?? null) : null;
                      return (
                        <button
                          key={r.id}
                          onClick={() => handleTodaySearchSelect(r)}
                          className="w-full flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-teal-50 transition text-left"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{cardDisplayName(r) || '—'}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {r.reservation_time?.slice(0, 5)}
                              {' · '}
                              {r.visit_type === 'new' ? '초진' : '재진'}
                              {chart && ` · #${chart}`}
                            </span>
                          </div>
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                            isCheckedIn
                              ? 'bg-teal-100 text-teal-700'
                              : 'bg-gray-100 text-gray-500',
                          )}>
                            {isCheckedIn ? '체크인' : '예약중'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : todaySearchQ.trim() ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    당일 예약 중 일치하는 환자 없음
                  </div>
                ) : (
                  <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                    이름 · 전화 뒷번호 · 차트번호로 검색
                  </div>
                )}
              </div>
            )}
          </div>

          <Button size="sm" onClick={() => setOpenNew(true)} className="gap-1 h-8">
            <Plus className="h-3.5 w-3.5" /> 체크인
          </Button>
        </div>
      </div>

      {isPast && (
        <div className="mx-4 mt-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          과거 날짜 조회 중 — 읽기 전용
        </div>
      )}

      {/* T-20260613-foot-FIELDBATCH item5: [진료대기] 보라색 진료콜 알람 배너 제거.
          별도 '원장님 진료콜 명단' 팝업(DoctorCallListBar, 하단)으로 운영 중 → 상단 배너는 중복 표시라 삭제(현장 김주연 총괄 요청).
          exam_waiting(진료대기) 단계/칸반 컬럼/진료콜 팝업 로직은 불변 — 상단 배너 UI만 제거. */}

      {/* Content: 타임라인 사이드바 + 칸반 */}
      {/* T-20260508-foot-DASH-SLOT-REMOVE: 카드 DnD 컨텍스트를 타임라인까지 확장
          → 타임라인 고객박스에서 칸반 열로 직접 드래그 이동 가능 */}
      {/* T-20260522-foot-DRAG-RESP-OPT: TickCtx — 타이머 틱을 DraggableCard에 context로 전달
          DraggableCard는 TickCtx 구독으로 10s마다 elapsed time 갱신.
          setDragging 변경 시에는 tick 값이 변하지 않으므로 카드 body 재실행 없음. */}
      <TickCtx.Provider value={tick}>
      <MyStaffIdCtx.Provider value={myAssignStaffId}>
      <ChartNumberMapCtx.Provider value={todayCustomerChartMap}>
      <CardHandlersCtx.Provider value={cardHandlersValue}>
      <ChecklistDoneCtx.Provider value={checklistDone}>
      <PkgHolderCtx.Provider value={pkgHolderSet}>
      <PodologeHolderCtx.Provider value={podologeHolderSet}>
      <AltHolderCtx.Provider value={altHolderSet}>
      <OutstandingMapCtx.Provider value={outstandingMap}>
      {/* T-20260523-foot-LASER-TIMER AC-3 보강: amber(warn) + red(expire) 2단계 */}
      <TimerAlertCtx.Provider value={timerAlertSet}>
      <TimerExpiredCtx.Provider value={timerExpiredSet}>
      <ConsentMapCtx.Provider value={consentMap}>
      <ResvTimeMapCtx.Provider value={resvTimeMap}>
      <DndContext
        sensors={sensors}
        collisionDetection={customCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        autoScroll={{
          threshold: { x: 0.15, y: 0.05 },
          acceleration: 6,
          // T-20260511-foot-DASH-DRAG-PERF: interval 5→16 (5ms=200fps → 16ms=60fps, CPU 과부하 해소)
          interval: 16,
        }}
        measuring={{
          // T-20260511-foot-DASH-DRAG-PERF: Always → BeforeDragging
          // Always: 드래그 이동마다 모든 드롭존 DOM reflow → 버벅거림 주범
          // BeforeDragging: 드래그 시작 시 1회만 측정 → 레이아웃 고정 중 재측정 불필요
          droppable: { strategy: MeasuringStrategy.BeforeDragging },
        }}
      >
      {/* T-20260509-foot-DASH-SCROLL-FIX: min-h-0 추가 — flex 자식이 할당 영역 밖으로 팽창하지 않도록 */}
      {/* T-20260514-foot-TIMETABLE-MOBILE-HSCROLL:
          mobile → overflow-x-auto (가로 스와이프 활성), overflow-y-hidden (수직 고정)
          desktop → md:overflow-hidden (원래 동작 복원) */}
      <div className="flex flex-1 min-h-0 overflow-y-hidden overflow-x-auto md:overflow-hidden" data-testid="dashboard-content-scroll">
        {/* 좌측: 통합 시간표 + 원내 메모 — T-20260504-foot-SCHEDULE-UNIFIED-VIEW */}
        {/* T-20260509-foot-DASH-SLOT-STICKY: min-h-0으로 세로 팽창 억제 → 타임라인 자체 스크롤 유지 */}
        {/* T-20260514-foot-TIMETABLE-MOBILE-HSCROLL: [overflow-x:clip] → scroll context 미생성 (sticky 전파), md:overflow-hidden 복원 */}
        {/* T-20260522-foot-TIMETABLE-FOLD: 접힌 상태 w-8, 펼친 상태 w-80 (transition 포함) */}
        <div
          className={cn(
            'shrink-0 flex flex-col min-h-0 border-r [overflow-x:clip] overflow-y-hidden md:overflow-hidden transition-all duration-200',
            timelineFolded ? 'w-8' : 'w-80',
          )}
        >
          <DashboardTimeline
            date={date}
            clinic={clinic}
            reservations={enrichedTimelineReservations}
            selfCheckIns={selfCheckIns}
            onSlotClick={handleQuickSlotClick}
            // T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA (P0-A):
            //   차트 열기(handleCardClick/handleReservationSelect)는 read-only이므로 isPast로 막지 않는다.
            //   기존 `!isPast ? ... : undefined` 게이트는 stale date(자정 넘긴 태블릿)에서 onClick을
            //   undefined로 만들어 초진 차트 클릭이 무반응(silent fail)이 되던 근본 라인.
            //   칸반은 이미 무조건 전달(read-only 일관). mutation(드래그 등)은 핸들러 자체 isPast 가드로 보호됨.
            onCardClick={handleCardClick}
            onCardContext={!isPast ? handleCardContext : undefined}
            onReservationSelect={handleReservationSelect}
            onNameOpen={handleNameChartOpen}
            // T-20260529-foot-RECEPTION-BTN-REMOVE: 접수 버튼 제거 (AC-1/AC-2)
            // 접수는 셀프접수 매칭 또는 우측 상단 체크인 버튼으로만 처리
            // onReservationCheckIn 미전달 → DraggableBox1Card/Box2ResvCard {onCheckIn && ...} 가드로 버튼 미렌더링
            // onReservationCheckIn={!isPast ? handleReservationCheckIn : undefined}
            // T-20260525-foot-RESV-CANCEL-ALLDATE: isPast 날짜 가드 제거 — 전체 날짜 취소 허용
            onReservationContext={handleReservationContext}
            folded={timelineFolded}
            onToggleFold={handleToggleTimeline}
            staffMap={therapistNameMap}
          />
        </div>

        {/* 우측: 칸반 (줌 + 레이아웃 편집 지원) */}
      {/* T-20260510-foot-DASH-DUAL-HSCROLL: min-w-0 추가 — flex 자식이 가로 팽창하지 않도록 */}
      {/* T-20260514-foot-TIMETABLE-MOBILE-HSCROLL:
          mobile → min-w-[15rem] shrink-0: 240px 최소폭 보장 → 외부 컨테이너 overflow 강제 (가로 스크롤 트리거)
          desktop → md:flex-1 md:min-w-0 md:shrink: 원래 flex-1 min-w-0 동작 복원 */}
      {/* T-20260601-foot-DOCTOR-CALL-POPUP-RELOC / DASH-HSCROLL-CHART-LOC #1:
          relative + overflow-auto — 진료콜 명단 팝업의 positioning 기준 & 가로스크롤 컨테이너.
          팝업은 이 칸반 스크롤 컨테이너 내부 absolute(우측 하단)로 배치되어 슬롯 칸에 종속 → 가로스크롤 시 함께 이동. */}
      <div data-testid="kanban-scroll" className="relative min-w-[15rem] shrink-0 md:flex-1 md:min-w-0 md:shrink overflow-auto p-3">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : isLayoutEdit ? (
          /* ── 레이아웃 편집 모드: 그룹 드래그 정렬 ─────────────────────── */
          <div className="mb-2 text-xs text-teal-700 font-medium px-1 py-0.5 bg-teal-50 rounded border border-teal-200 inline-flex items-center gap-1">
            <LayoutGrid className="h-3.5 w-3.5" />
            슬롯 그룹을 드래그하여 순서를 바꾸세요. 변경 사항은 자동 저장됩니다.
          </div>
        ) : null}
        {!loading || rows.length > 0 ? (
          <div
            style={{
              transform: `scale(${zoomLevel / 100})`,
              transformOrigin: 'top left',
              display: 'inline-block',
              // 줌 아웃 시 물리 공간 보정 (스크롤바가 올바르게 표시되도록)
              minWidth: zoomLevel < 100 ? `${(100 / zoomLevel) * 100}%` : undefined,
            }}
          >
            {isLayoutEdit ? (
              /* ── 편집 모드: SortableContext로 그룹 드래그 순서 변경 ── */
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleGroupSortEnd}
              >
                <SortableContext items={groupOrder} strategy={horizontalListSortingStrategy}>
                  <div className="flex gap-2 min-w-max" style={{ minHeight: 'calc(100vh - 200px)' }}>
                    {groupOrder.map((gid) => (
                      <SortableGroupItem key={gid} id={gid} label={KANBAN_GROUP_LABELS[gid]}>
                        {renderKanbanGroup(gid)}
                      </SortableGroupItem>
                    ))}
                    {/* T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT AC-5: 완료 슬롯은 정렬 대상이 아닌 우측 고정 단독 컬럼(SortableContext 비참여). */}
                    {renderDoneColumn()}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              /* ── 일반 모드: 카드 드래그 (DnD 컨텍스트는 상위로 이동됨) ── */
              /* T-20260615-foot-DASH-SLOT-HEIGHT-UNIFY (REVERSAL 2026-06-17, scope② 4슬롯 통일):
                 김주연 총괄 원의도 = "빈 상태 동일 + 카드 추가 시 칸 자연 성장"(고정 height·내부 스크롤은 정반대였음).
                 핵심 = 형제 비연동 자연 성장. 부모 행을 stretch(기본) → items-start 로 전환한다.
                   · stretch: 한 슬롯이 콘텐츠로 커지면 flex line cross-size 가 커져 형제 슬롯까지 끌어올림
                     (= 비대상 슬롯이 함께 길어지는 오염, 과거 reporter "쓸데없이 길어짐" 불만).
                   · items-start: 각 슬롯이 자기 높이를 유지하며 독립 성장. 비대상 슬롯이 안 끌려감(AC-R1).
                 단 items-start 면 명시 높이 없는 비대상 슬롯의 stretch 가 끊겨 붕괴하므로(과거 ys5t 회귀),
                 각 슬롯(타깃+비타깃)에 per-element minHeight: SLOT_COLUMN_HEIGHT floor 를 부여해 빈 상태
                 baseline(=[상담대기]) 을 보존한다(AC-NEW-1). 타깃 4슬롯(치료실·레이저실·수납대기·완료)은
                 minHeight floor + 콘텐츠 자연 성장(내부 스크롤 제거), 비타깃은 floor + 기존 내부 스크롤 유지. */
              <div data-testid="kanban-slot-row" className="flex items-start gap-2 min-w-max" style={{ minHeight: SLOT_COLUMN_HEIGHT }}>
                {/* 치료실+레이저실 클러스터: 치료실 | 레이저실 나란히 배치.
                    (T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 제거됨) */}
                {groupOrder.map((gid) => {
                  // 레이저실은 치료실 클러스터 내부에서 렌더링 — 별도 표시 생략
                  if (gid === 'laser_rooms') return null;

                  // T-20260614-foot-HEALER-LASER-WAIT-PAIR-LAYOUT:
                  // 힐러대기는 항상 레이저대기와 한 쌍(상하)으로 병합 → 단독 위치 생략.
                  if (gid === 'healer_waiting_col') return null;
                  // 레이저대기: 레이저실이 있으면 클러스터 내부(레이저실 좌측)에서 쌍으로 렌더 → skip.
                  //             레이저실이 없으면 이 위치에 쌍을 fallback 렌더(빈 칸 방지).
                  if (gid === 'laser_waiting_col') {
                    const hasLaserCluster = laserRooms.length > 0 && groupOrder.includes('laser_rooms');
                    return hasLaserCluster ? null : renderWaitingPair();
                  }

                  if (gid === 'treatment_rooms') {
                    const hasTreatment = treatmentRooms.length > 0;
                    const hasLaser = laserRooms.length > 0 && groupOrder.includes('laser_rooms');
                    if (!hasTreatment && !hasLaser) return null;

                    return (
                      <div key="treatment_laser_cluster" className="flex gap-2 shrink-0 items-start">
                        {/* 치료실 (480px) */}
                        {hasTreatment && renderKanbanGroup('treatment_rooms')}
                        {/* AC-1/AC-2: 레이저대기·힐러대기 상하 쌍 — 레이저실 좌측 인접 */}
                        {hasLaser && renderWaitingPair()}
                        {/* 레이저실 (480px) */}
                        {hasLaser && renderKanbanGroup('laser_rooms')}
                      </div>
                    );
                  }

                  return renderKanbanGroup(gid);
                })}
                {/* T-20260620-foot-DASH-DONESLOT-NAMECHIP-COMPACT AC-5: 완료 슬롯 = 우측 단독 컬럼(칸반 흐름 마지막 고정). */}
                {renderDoneColumn()}
              </div>
            )}
          </div>
        ) : null}
        {/* T-20260601-foot-DOCTOR-CALL-POPUP-RELOC: '원장님 진료콜 명단' 팝업.
            T-20260601-foot-DASH-HSCROLL-CHART-LOC #1 (REOPEN 정정): 팝업 root가 이 칸반 컬럼
            (position:relative + overflow-auto) 내부 absolute 우측 하단으로 배치됨 → 슬롯 칸에
            종속되어 가로스크롤 시 콘텐츠와 함께 이동(뷰포트 fixed 폐기).
            #2: onOpenChart=고객 이름 클릭 시 진료차트(MedicalChartPanel) 직접 오픈.
            T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB: 기본차트 서랍이 아닌 진료차트가 기본 진입.
            데이터·집계·메모·초재진 회차 로직은 DOCTOR-CALL-LIST 그대로 보존. */}
        <DoctorCallListBar checkIns={doctorCallRows} onRefresh={fetchCheckIns} onOpenChart={handleOpenChartFromList} />
      </div>
      {/* flex flex-1 overflow-hidden wrapper 닫기 */}
      </div>
      {/* T-20260522-foot-SLOT-SNAP-FIX: snapToCursorModifier — S Pen 터치 포인트에 ghost 정렬 */}
      <DragOverlay modifiers={[snapToCursorModifier]}>
        {dragging && <DraggableCard checkIn={dragging} compact />}
      </DragOverlay>
      </DndContext>
      </ResvTimeMapCtx.Provider>
      </ConsentMapCtx.Provider>
      </TimerExpiredCtx.Provider>
      </TimerAlertCtx.Provider>
      </OutstandingMapCtx.Provider>
      </AltHolderCtx.Provider>
      </PodologeHolderCtx.Provider>
      </PkgHolderCtx.Provider>
      </ChecklistDoneCtx.Provider>
      </CardHandlersCtx.Provider>
      </ChartNumberMapCtx.Provider>
      </MyStaffIdCtx.Provider>
      </TickCtx.Provider>

      {/* T-20260524-foot-TIMETABLE-TIME-CONFIRM: 시간 변경 확인 다이얼로그
          AC-1: 초진 시간 변경 시 confirm
          AC-2: 재진 시간 변경 시 confirm
          AC-3: 확인→executeSlotDrag 적용 / 취소→setPendingTimeChange(null) 복원
          AC-4: 변경 전/후 시간 표시
          T-20260525-foot-RESV-CHANGE-REASON AC-1: 변경 사유 textarea (optional) */}
      {pendingTimeChange && (
        <Dialog open onOpenChange={(o) => { if (!o) { setPendingTimeChange(null); setPendingChangeReason(''); } }}>
          <DialogContent className="max-w-xs" hideClose>
            <DialogHeader>
              <DialogTitle className="text-base text-center">예약시간을 변경하시겠습니까?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              {/* AC-4: 변경 전/후 시간 */}
              <div className="flex items-center justify-center gap-4">
                <div className="text-center min-w-[64px]">
                  <p className="text-[11px] text-muted-foreground mb-1">변경 전</p>
                  <p className="font-mono font-semibold text-gray-600 text-2xl leading-none">{pendingTimeChange.oldTime}</p>
                </div>
                <span className="text-gray-300 text-2xl select-none">→</span>
                <div className="text-center min-w-[64px]">
                  <p className="text-[11px] text-muted-foreground mb-1">변경 후</p>
                  <p className="font-mono font-bold text-teal-600 text-2xl leading-none">{pendingTimeChange.newTime}</p>
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
                {pendingTimeChange.visitType === 'new' ? '초진' : '재진'} &middot; {pendingTimeChange.reservation.customer_name ?? '고객'}{' '}
                <span className="font-mono text-teal-600">{chartNoBadge(pendingTimeChange.reservation.customer_id ? (todayCustomerChartMap.get(pendingTimeChange.reservation.customer_id) ?? null) : null)}</span>
              </p>
              {/* T-20260525-foot-RESV-CHANGE-REASON AC-1: 변경 사유 (시간 정보 아래, 확인 버튼 위) */}
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                rows={2}
                maxLength={500}
                placeholder="변경 사유 (선택)"
                value={pendingChangeReason}
                onChange={(e) => setPendingChangeReason(e.target.value)}
                data-testid="time-change-reason-textarea"
              />
            </div>
            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="time-change-cancel-btn"
                onClick={() => { setPendingTimeChange(null); setPendingChangeReason(''); }}
              >
                취소
              </Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                data-testid="time-change-confirm-btn"
                onClick={async () => {
                  const { reservationId, newTimeStr, reservation } = pendingTimeChange;
                  const reason = pendingChangeReason;
                  setPendingTimeChange(null);
                  setPendingChangeReason('');
                  await executeSlotDrag(reservationId, newTimeStr, reservation, reason);
                }}
              >
                확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 빠른 예약 다이얼로그 */}
      <QuickReservationDialog
        draft={quickResvDraft}
        clinicId={clinic?.id}
        createdBy={profile?.id ?? null}
        onClose={() => setQuickResvDraft(null)}
        onCreated={() => { fetchTimelineReservations(); }}
      />

      <NewCheckInDialog
        open={openNew}
        onOpenChange={setOpenNew}
        clinicId={clinic?.id}
        onCreated={() => { fetchCheckIns(); fetchTimelineReservations(); }}
      />

      <CheckInDetailSheet
        checkIn={selectedCheckIn}
        onClose={() => setSelectedCheckIn(null)}
        onUpdated={() => {
          fetchCheckIns();
          if (selectedCheckIn) {
            const fresh = rows.find((r) => r.id === selectedCheckIn.id);
            if (fresh) setSelectedCheckIn(fresh);
          }
        }}
        onPayment={(ci, initialMode) => {
          setSelectedCheckIn(null);
          setPaymentInitialMode(initialMode ?? 'single');
          setPaymentTarget(ci);
        }}
        onOpenMedicalChart={(customerId) => {
          setSelectedCheckIn(null);
          setMedicalChartCustomerId(customerId);
          setMedicalChartOpen(true);
        }}
      />

      <PaymentDialog
        key={`${paymentTarget?.id ?? 'none'}-${paymentInitialMode}-${paymentAttemptCounter}`}
        checkIn={paymentTarget}
        initialMode={paymentInitialMode}
        onClose={() => {
          setPaymentTarget(null);
          setPaymentInitialMode('single');
        }}
        onPaid={() => {
          setPaymentTarget(null);
          setPaymentInitialMode('single');
          // T-20260514-foot-PAYMENT-CONSECUTIVE-STUCK BUG4: 결제 완료 시 counter++ → 같은 checkIn 재결제 시 강제 리마운트
          setPaymentAttemptCounter((c) => c + 1);
          fetchCheckIns();
          fetchPayments();
        }}
      />

      {/* T-20260515-foot-PAYMENT-MINI-WINDOW: 수납대기 [결제하기] 미니창 */}
      <PaymentMiniWindow
        key={`mini-${miniPayTarget?.id ?? 'none'}-${miniPayAttemptCounter}`}
        checkIn={miniPayTarget}
        onClose={() => setMiniPayTarget(null)}
        onComplete={() => {
          setMiniPayTarget(null);
          // T-20260514-foot-PAYMENT-CONSECUTIVE-STUCK BUG4: 결제 완료 시 counter++ → 같은 checkIn 재결제 시 강제 리마운트
          setMiniPayAttemptCounter((c) => c + 1);
          fetchCheckIns();
          fetchPayments();
        }}
        onSaved={() => {
          // AC-7: 시술 저장 후 pending 금액 즉시 갱신
          fetchPendingServices();
        }}
      />

      {/* T-20260504-foot-TABLET-LASER-ROOM-SELECT: laserRooms + 레이저실 번호 선택 */}
      {/* T-20260511-foot-DASH-STAGE-ALL-SLOTS: 전체 슬롯 표기 + 치료실 세부 선택 */}
      {/* T-20260516-foot-CONSULT-KANBAN-MISS AC-6: 상담실 실번호 선택 */}
      <StatusContextMenu
        checkIn={contextMenu?.checkIn!}
        position={contextMenu?.pos ?? null}
        onClose={() => setContextMenu(null)}
        onStatusChange={handleContextStatusChange}
        onFlagChange={handleFlagChange}
        laserRooms={laserRooms.map((r) => r.name)}
        onLaserStatusChange={handleContextLaserStatusChange}
        treatmentRooms={treatmentRooms.map((r) => r.name)}
        onTreatmentStatusChange={handleContextTreatmentStatusChange}
        consultationRooms={consultRooms.map((r) => r.name)}
        onConsultStatusChange={handleContextConsultStatusChange}
      />

      {/* T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC4: 대시보드 고객카드 우클릭도 canonical 5항목 통일.
          position-3 = [예약상세] 단일 라벨([예약하기] 표현 제거). 연결예약 있으면 ReservationDetailPopup,
          워크인(연결예약 없음)은 신규예약 생성(handleNewReservation, L-002)으로 fallback — 기능 손실 0. */}
      <CustomerQuickMenu
        checkIn={customerMenu?.checkIn ?? null}
        position={customerMenu?.pos ?? null}
        onClose={() => setCustomerMenu(null)}
        onOpenChart={handleOpenChart}
        onOpenMedicalChart={handleOpenMedicalChart}
        onNewReservation={handleCardResvDetailOrCreate}
        reservationActionLabel="예약상세"
        onOpenPayment={handleOpenPaymentFromMenu}
        /* T-20260606-foot-CTXMENU-SMS-SEND: admin/manager 한정 노출(미허용 시 onSendSms 미전달 → 항목 숨김) */
        onSendSms={
          canAccess(profile, 'manual_sms_send')  /* T-20260620-foot-SUPERADMIN-EXEMPT: subject 전달(exempt honor) */
            ? (ci) => setSmsTarget(ci)
            : undefined
        }
      />

      {/* T-20260606-foot-CTXMENU-SMS-SEND: 수동 1:1 문자 발송 모달 */}
      <SendSmsDialog
        open={smsTarget !== null}
        onOpenChange={(v) => { if (!v) setSmsTarget(null); }}
        checkIn={smsTarget}
        clinicId={clinic?.id ?? ''}
      />

      {/* T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC1/AC2/AC3: 타임라인 예약 박스 우클릭 메뉴를
          예약관리와 동일한 CustomerQuickMenu 5항목 [고객차트 → 진료차트 → 예약상세 → 수납 → 문자]로 통일.
          - 고객차트/진료차트: 기존 핸들러 재사용(handleOpenChart/handleOpenMedicalChart) — 고객카드 메뉴와 동작 동일.
          - 예약상세: handleResvOpenDetailFromCtx → ReservationDetailPopup 오픈([예약하기] 라벨 미사용).
          - 수납: handleResvOpenPaymentFromCtx(연결 check_in 결제 미니창).
          - 문자: admin/manager 한정 SendSmsDialog 경로 재사용.
          - [예약 취소]·[완전 삭제] 메뉴 항목 제거 → 둘 다 ReservationDetailPopup 내부 버튼에서만(메뉴 진입점 제거). */}
      <CustomerQuickMenu
        checkIn={resvContextMenu ? resvAsCheckIn(resvContextMenu.reservation) : null}
        position={resvContextMenu?.pos ?? null}
        onClose={() => setResvContextMenu(null)}
        onOpenChart={handleOpenChart}
        onOpenMedicalChart={handleOpenMedicalChart}
        onNewReservation={handleResvOpenDetailFromCtx}
        onOpenPayment={handleResvOpenPaymentFromCtx}
        /* CANONICAL: 기존 예약 우클릭 → '예약상세' 라벨 고정. [예약하기] 표현 미사용. */
        reservationActionLabel="예약상세"
        /* 문자 — admin/manager(onSendSms 제공 시)만 노출. ci는 resvAsCheckIn 어댑터(customer_id로 phone SSOT refetch). */
        onSendSms={
          canAccess(profile, 'manual_sms_send')  /* T-20260620-foot-SUPERADMIN-EXEMPT: subject 전달(exempt honor) */
            ? (ci) => { setResvContextMenu(null); setSmsTarget(ci); }
            : undefined
        }
      />

      {/* T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV: 대시보드 로컬 예약상세 팝업 제거.
          우클릭 [예약상세] 는 예약관리(/admin/reservations) 정본 팝업으로 라우팅 위임 →
          팝업 인스턴스 단일화(중복 마운트 제거)로 POPUP-SYNC 동기화 깨짐 방지. */}

      {/* T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout 단일화로 이동 */}

      {/* T-20260515-foot-CONTEXT-MENU-4ITEM AC-2: 진료차트 패널 */}
      {/* T-20260522-foot-LASER-TIMER: checkInId 추가 → 타이머 패널 활성화 */}
      <MedicalChartPanel
        open={medicalChartOpen}
        onOpenChange={(v) => { if (!v) { setMedicalChartOpen(false); setMedicalChartCustomerId(null); } }}
        customerId={medicalChartCustomerId}
        clinicId={clinic?.id ?? ''}
        currentUserRole={profile?.role ?? ''}
        currentUserEmail={profile?.email ?? null}
      />

      {/* T-20260519-foot-SLOT-BATCH-EDIT / T-20260614-foot-SLOT-CRUD-ALLTYPES: 슬롯 추가 다이얼로그 (전 타입) */}
      <Dialog
        open={addSlotOpen}
        onOpenChange={(v) => { if (!v) { setAddSlotOpen(false); setAddSlotName(''); } }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{SLOT_TYPE_KO[addSlotType] ?? '슬롯'} 슬롯 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-medium mb-1">슬롯 이름</label>
              <Input
                data-testid="consult-slot-name-input"
                placeholder={`예: 임시 ${SLOT_TYPE_KO[addSlotType] ?? ''}실 …`}
                value={addSlotName}
                onChange={(e) => setAddSlotName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && addSlotName.trim())
                    handleAddSlot(addSlotType, addSlotName);
                }}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="confirm-add-consult-slot-btn"
                className="flex-1 text-xs"
                disabled={!addSlotName.trim() || addSlotLoading}
                onClick={() => handleAddSlot(addSlotType, addSlotName)}
              >
                {addSlotLoading ? '추가 중…' : '생성'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => { setAddSlotOpen(false); setAddSlotName(''); }}
              >
                취소
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [6]: 사이드바 달력 날짜 클릭 시 하단 인라인 현황.
          flex-col 루트의 마지막 자식 → shrink-0 + max-h-[38vh]로 본문 아래에 부착(본문 스크롤 영향 0).
          닫기(onClose) 시 ?date= 제거(=대시보드 기본 화면 복귀). */}
      {dateDetailParam && (
        <DashboardDateDetail
          dateStr={dateDetailParam}
          clinicId={clinic?.id}
          onClose={() => navigate('/admin', { replace: true })}
        />
      )}
    </div>
  );
}
