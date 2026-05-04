import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
import { CSS } from '@dnd-kit/utilities';
import { addDays, format, isSameDay, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  GripVertical,
  LayoutGrid,
  Minus,
  MoreVertical,
  Plus,
  RotateCcw,
  User,
  ZoomIn,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { generateSlots } from '@/lib/schedule';
import { STATUS_KO, VISIT_TYPE_KO, STATUS_FLAG_CARD_BG, STATUS_FLAG_LABEL } from '@/lib/status';
import { formatAmount, maskPhoneTail } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NewCheckInDialog } from '@/components/NewCheckInDialog';
import { CheckInDetailSheet } from '@/components/CheckInDetailSheet';
import { PaymentDialog } from '@/components/PaymentDialog';
import { StatusContextMenu } from '@/components/StatusContextMenu';
import { CustomerQuickMenu } from '@/components/CustomerQuickMenu';
import { CustomerHoverCard } from '@/components/CustomerHoverCard';
import { playOvertimeAlert } from '@/lib/audio';
import { autoDeductSession } from '@/lib/session';
import { elapsedMinutes, elapsedMMSS } from '@/lib/elapsed';
import type { CheckIn, CheckInRealtimeRow, CheckInStatus, Customer, Reservation, Room, RoomFieldKey, Staff, StatusFlag, VisitType } from '@/lib/types';
import { ClinicMemoPanel } from '@/components/ClinicMemoPanel';

type TabKey = 'all' | 'new' | 'returning';

// ── 동의서 상태 컨텍스트 (카드 배지용) ────────────────────────────────────────
interface ConsentEntry {
  refundAt?: string;
  nonCoveredAt?: string;
}
/** 체크인 ID → 동의서 날짜 맵. DraggableCard에서 useContext로 읽어 배지 표시 */
const ConsentMapCtx = createContext<Map<string, ConsentEntry>>(new Map());

// ── 카드 고객 이름 우클릭/롱프레스 핸들러 컨텍스트 ────────────────────────────
interface CardHandlers {
  onNameContext: (ci: CheckIn, e: React.MouseEvent) => void;
}
const CardHandlersCtx = createContext<CardHandlers | null>(null);

// ── 예약시간 맵 컨텍스트 (reservation_id → reservation_time) ──────────────────
/** DraggableCard에서 useContext로 읽어 CustomerHoverCard에 예약시간 전달 */
const ResvTimeMapCtx = createContext<Map<string, string>>(new Map());

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
const DEFAULT_GROUP_ORDER = [
  'new_queue',
  'returning_queue',
  'exam_section',
  'experience_queue',
  'consult_waiting_col',
  'consult_rooms',
  'waiting_columns',
  'treatment_rooms',
  'desk_section',
  'laser_rooms',
] as const;

type KanbanGroupId = (typeof DEFAULT_GROUP_ORDER)[number];

const KANBAN_GROUP_LABELS: Record<KanbanGroupId, string> = {
  new_queue: '초진',
  returning_queue: '재진',
  exam_section: '진료',
  experience_queue: '선체험',
  consult_waiting_col: '상담대기',
  consult_rooms: '상담실',
  waiting_columns: '치료/레이저/힐러대기',
  treatment_rooms: '치료실',
  desk_section: '데스크',
  laser_rooms: '레이저실',
};

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
};

const ROOM_FIELD_MAP: Record<string, RoomFieldKey> = {
  examination: 'examination_room',
  consultation: 'consultation_room',
  treatment: 'treatment_room',
  laser: 'laser_room',
};

function DraggableCard({
  checkIn,
  compact,
  stageStart,
  packageLabel,
  onClick,
  onContextMenu,
}: {
  checkIn: CheckIn;
  compact?: boolean;
  stageStart?: string;
  packageLabel?: PackageLabel | null;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const consentMap = useContext(ConsentMapCtx);
  const consentEntry = consentMap.get(checkIn.id);
  const cardHandlers = useContext(CardHandlersCtx);
  const resvTimeMap = useContext(ResvTimeMapCtx);
  const reservationTime = checkIn.reservation_id ? (resvTimeMap.get(checkIn.reservation_id) ?? null) : null;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: checkIn.id,
    data: { checkIn },
  });
  const timeRef = stageStart ?? checkIn.checked_in_at;
  const mins = elapsedMinutes(timeRef);
  const mmss = elapsedMMSS(timeRef);
  const isLaserOvertime = checkIn.status === 'laser' && mins >= 20;

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  const urgency = isLaserOvertime
    ? 'border-red-500 ring-2 ring-red-300 bg-red-50 animate-pulse'
    : mins >= 40
      ? 'border-red-400 ring-2 ring-red-200 bg-red-50/60'
      : mins >= 20
        ? 'border-orange-300 ring-1 ring-orange-100 bg-orange-50/60'
        : '';

  // 상태 플래그 카드 배경색 — urgency가 없을 때만 적용
  const flagBg = !urgency && checkIn.status_flag && checkIn.status_flag !== 'white'
    ? STATUS_FLAG_CARD_BG[checkIn.status_flag]
    : '';

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
          'cursor-grab touch-none rounded border px-2 py-1.5 text-xs shadow-sm transition hover:shadow active:cursor-grabbing',
          flagBg || 'bg-white',
          urgency,
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
            {checkIn.queue_number != null && (
              <span className="text-[10px] text-teal-600 shrink-0">#{checkIn.queue_number}</span>
            )}
          </div>
          <div className="flex items-center shrink-0">
            <button
              className="p-1 rounded hover:bg-gray-100 transition"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const syntheticEvent = { preventDefault: () => {}, stopPropagation: () => {}, clientX: rect.right, clientY: rect.bottom } as React.MouseEvent;
                onContextMenu?.(syntheticEvent);
              }}
              title="상태 변경"
            >
              <MoreVertical className="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>
        {packageLabel && (
          <div className="mt-0.5 text-xs text-violet-600 font-medium truncate">
            {packageLabel.name} {packageLabel.remaining}/{packageLabel.total}
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
        <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
          <span className={cn('tabular-nums font-mono', (mins >= 30 || isLaserOvertime) && 'font-semibold text-red-600')}>
            <Clock className="inline h-2.5 w-2.5 mr-0.5" />
            {mmss}
          </span>
          <div className="flex items-center gap-0.5">
            {/* T-20260502-foot-LASER-TIME-UNIT: 레이저실 카드에 시간 단위 배지 */}
            {checkIn.status === 'laser' && checkIn.laser_minutes != null && (
              <Badge className="h-4 px-1 text-[10px] bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
                {checkIn.laser_minutes}분
              </Badge>
            )}
            {checkIn.notes?.id_check_required && (
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">신분증</Badge>
            )}
            {checkIn.priority_flag && (
              <Badge variant="destructive" className="h-4 px-1 text-xs">
                {checkIn.priority_flag}
              </Badge>
            )}
          </div>
        </div>
        {/* AC1·AC2: 초진/체험 → "초진" 딱지, 재진 → 없음 (접수시간 아래) */}
        {(checkIn.visit_type === 'new' || checkIn.visit_type === 'experience') && (
          <div className="mt-0.5">
            <span className="bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 rounded">초진</span>
          </div>
        )}
      </div>
    );
  }

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
        'cursor-grab touch-none rounded-lg border p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing',
        flagBg || 'bg-white',
        urgency,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <CustomerHoverCard
            checkIn={checkIn}
            reservationTime={reservationTime}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cardHandlers?.onNameContext(checkIn, e);
            }}
          />
          {checkIn.queue_number != null && (
            <span className="text-xs text-teal-600">#{checkIn.queue_number}</span>
          )}
          {checkIn.customer_phone && (
            <span className="text-xs text-muted-foreground">
              ···{maskPhoneTail(checkIn.customer_phone)}
            </span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <button
            className="p-0.5 rounded hover:bg-gray-100 transition"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const syntheticEvent = { preventDefault: () => {}, stopPropagation: () => {}, clientX: rect.right, clientY: rect.bottom } as React.MouseEvent;
              onContextMenu?.(syntheticEvent);
            }}
          >
            <MoreVertical className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </div>
      {packageLabel && (
        <div className="mt-1 text-xs text-violet-600 font-medium">
          {packageLabel.name} {packageLabel.remaining}/{packageLabel.total}
        </div>
      )}
      {/* 동의서 서명 배지 (non-compact) */}
      {consentEntry?.refundAt && (
        <div
          data-testid="consent-badge-refund"
          className="mt-1 text-xs text-emerald-600"
        >
          ✓ 환불동의서 ({format(new Date(consentEntry.refundAt), 'M/d')})
          {consentEntry.nonCoveredAt && (
            <span className="ml-1">· 비급여확인 ({format(new Date(consentEntry.nonCoveredAt), 'M/d')})</span>
          )}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className={cn('text-muted-foreground tabular-nums font-mono', (mins >= 30 || isLaserOvertime) && 'font-semibold text-red-600')}>
          {mmss} {stageStart ? STATUS_KO[checkIn.status] ?? '경과' : '대기'}
        </span>
        <div className="flex items-center gap-1">
          {checkIn.notes?.id_check_required && (
            <Badge variant="destructive" className="text-xs">신분증 확인</Badge>
          )}
          {checkIn.priority_flag && <Badge variant="destructive">우선</Badge>}
        </div>
      </div>
      {/* AC1·AC2: 초진/체험 → "초진" 딱지, 재진 → 없음 (접수시간 아래) */}
      {(checkIn.visit_type === 'new' || checkIn.visit_type === 'experience') && (
        <div className="mt-1">
          <span className="bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 rounded">초진</span>
        </div>
      )}
    </div>
  );
}

function DroppableColumn({
  id,
  label,
  count,
  children,
  className,
  highlight,
  subtitle,
  invalidDrop,
}: {
  id: string;
  label: string;
  count: number;
  children: React.ReactNode;
  className?: string;
  highlight?: string;
  subtitle?: React.ReactNode;
  invalidDrop?: boolean;
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
      <div className="flex-1 p-1.5 space-y-1.5 min-h-[80px] overflow-y-auto max-h-[calc(100vh-220px)]">
        {children}
      </div>
    </div>
  );
}


function TimeSlotAccordion({
  reservations,
  onCheckIn,
}: {
  reservations: Reservation[];
  onCheckIn: (res: Reservation) => void;
}) {
  const now = new Date();
  const currentSlot = `${String(now.getHours()).padStart(2, '0')}:${now.getMinutes() < 30 ? '00' : '30'}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([currentSlot]));

  const slotMap: Record<string, Reservation[]> = {};
  for (const r of reservations) {
    const t = r.reservation_time?.slice(0, 5) ?? '00:00';
    const [h, m] = t.split(':').map(Number);
    const slot = `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`;
    (slotMap[slot] ??= []).push(r);
  }
  const slots = Object.keys(slotMap).sort();
  if (slots.length === 0) return null;

  const toggle = (s: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div className="space-y-0.5">
      {slots.map((slot) => {
        const items = slotMap[slot];
        const isOpen = expanded.has(slot);
        const isPast = slot < currentSlot;
        return (
          <div key={slot}>
            <button
              onClick={() => toggle(slot)}
              className={cn(
                'w-full flex items-center justify-between px-2 py-1 text-xs rounded hover:bg-muted/50 transition',
                slot === currentSlot && 'bg-blue-50 font-bold',
                isPast && !isOpen && 'opacity-50',
              )}
            >
              <span>{slot}</span>
              <div className="flex items-center gap-1">
                <span className="bg-blue-100 text-blue-700 px-1.5 rounded-full text-xs">{items.length}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !isOpen && '-rotate-90')} />
              </div>
            </button>
            {isOpen && (
              <div className="px-0.5 pb-1 space-y-1">
                {items.map((res) => (
                  <ReservationCard key={res.id} reservation={res} onCheckIn={onCheckIn} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReservationCard({
  reservation,
  onCheckIn,
}: {
  reservation: Reservation;
  onCheckIn: (res: Reservation) => void;
}) {
  const time = reservation.reservation_time?.slice(0, 5) ?? '';
  return (
    <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/40 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-blue-700">{time}</span>
          <span className="text-sm font-semibold">{reservation.customer_name}</span>
        </div>
        <Badge variant={reservation.visit_type === 'new' ? 'teal' : 'secondary'} className="h-4 px-1 text-xs">
          {VISIT_TYPE_KO[reservation.visit_type]}
        </Badge>
      </div>
      {reservation.memo && (
        <p className="text-xs text-muted-foreground truncate">{reservation.memo}</p>
      )}
      <button
        onClick={() => onCheckIn(reservation)}
        className="w-full rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200 transition"
      >
        체크인
      </button>
    </div>
  );
}

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
}) {
  const dropId = `room:${roomName}`;
  const isFull = occupants.length >= maxOccupancy;
  const { isOver, setNodeRef } = useDroppable({ id: dropId, data: { roomName, roomType, isFull } });
  const isEmpty = occupants.length === 0;
  const showStaffDropdown = (roomType === 'treatment' || roomType === 'examination' || roomType === 'consultation') && therapists && onTherapistChange;
  const showStaffLabel = roomType !== 'laser' && roomType !== 'treatment' && roomType !== 'examination' && roomType !== 'consultation' && staffName;

  return (
    <div
      ref={setNodeRef}
      data-droppable-id={dropId}
      data-room-name={roomName}
      data-room-type={roomType}
      className={cn(
        'rounded-lg border bg-white/60 p-1.5 min-h-[70px] transition-colors',
        isOver && !isFull && 'border-teal-400 bg-teal-50/50',
        isOver && isFull && 'border-red-400 bg-red-50/30 opacity-60',
        isEmpty && !isOver && 'border-dashed border-gray-200',
        !isEmpty && !isOver && !isFull && 'border-gray-300',
        isFull && !isOver && 'border-red-200',
      )}
    >
      <div className="flex items-center justify-between px-1 mb-1 gap-1">
        <span className="text-xs font-semibold text-gray-600 shrink-0">{roomName}</span>
        {showStaffDropdown && (
          <select
            value={currentStaffId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const name = id ? therapists.find((s) => s.id === id)?.name ?? null : null;
              onTherapistChange(roomName, id, name);
            }}
            className="text-xs h-5 border border-gray-200 rounded bg-white/80 px-0.5 max-w-[80px] truncate text-muted-foreground"
          >
            <option value="">미배정</option>
            {therapists.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        {showStaffLabel && (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <User className="h-2.5 w-2.5" />
            {staffName}
          </span>
        )}
        {occupants.length > 0 && (
          <span className={cn(
            'text-[10px] tabular-nums',
            isFull ? 'text-red-600 font-medium' : 'text-muted-foreground',
          )}>
            {occupants.length}/{maxOccupancy}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {occupants.map((ci, i) => (
          <div key={ci.id} style={{ opacity: i === 0 ? 1 : 0.7 }}>
            <DraggableCard checkIn={ci} compact stageStart={getStageStart?.(ci)} packageLabel={getPkgLabel?.(ci)} onClick={() => onCardClick(ci)} onContextMenu={onCardContext ? (e) => onCardContext(ci, e) : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}

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

  return (
    <div className="flex flex-col">
      <div className={cn('text-xs font-bold px-2 py-1 rounded-t-lg', color)}>
        {title}
        <span className="ml-1.5 font-normal opacity-70">
          ({rooms.length}실)
        </span>
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
      <div className={cn('grid gap-x-1.5 gap-y-1.5 p-1.5 bg-muted/10 rounded-b-lg border border-t-0', gridCols)}>
        {rooms.map((room) => (
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
          />
        ))}
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
  memo: string;
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

// ── DashboardTimeline ──────────────────────────────────────────────────────────
const SLOT_MAX = 4; // 초진/재진 슬롯 상한 (표시 전용, 차단 없음)

function DashboardTimeline({
  date,
  reservations,
  onSlotClick,
}: {
  date: Date;
  reservations: Reservation[];
  onSlotClick: (slot: { date: string; time: string }) => void;
}) {
  const now = new Date();
  const isToday = isSameDay(date, now);
  const dateStr = format(date, 'yyyy-MM-dd');
  const currentH = now.getHours();
  const currentM = now.getMinutes();
  const currentSlot = `${String(currentH).padStart(2, '0')}:${currentM < 30 ? '00' : '30'}`;

  const slots = generateSlots('10:00', '20:00', 30);

  // 예약을 30분 슬롯으로 분류 + 초진/재진 카운트 집계
  const slotMap: Record<string, Reservation[]> = {};
  const slotNewCount: Record<string, number> = {};
  const slotRetCount: Record<string, number> = {};

  for (const r of reservations) {
    const t = r.reservation_time?.slice(0, 5) ?? '00:00';
    const [h, mm] = t.split(':').map(Number);
    const slot = `${String(h).padStart(2, '0')}:${mm < 30 ? '00' : '30'}`;
    (slotMap[slot] ??= []).push(r);

    // 초진 vs 재진(체험 포함) 카운트
    if (r.visit_type === 'new') {
      slotNewCount[slot] = (slotNewCount[slot] ?? 0) + 1;
    } else {
      slotRetCount[slot] = (slotRetCount[slot] ?? 0) + 1;
    }
  }

  return (
    <div className="flex flex-col bg-white overflow-hidden flex-1 min-h-0">
      {/* 헤더 */}
      <div className="text-xs font-semibold px-2 py-1.5 border-b bg-muted/20 text-gray-600 sticky top-0 flex items-center gap-1">
        <Clock className="h-3 w-3" /> 시간표
      </div>
      {/* 범례 */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-gray-50/70 text-[9px] text-gray-500">
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">초진</span>
        <span className="text-gray-300">/</span>
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 font-medium">재진</span>
        <span className="ml-auto text-gray-400">상한 {SLOT_MAX}명</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {slots.map((slot) => {
          const items = slotMap[slot] ?? [];
          const newCnt = slotNewCount[slot] ?? 0;
          const retCnt = slotRetCount[slot] ?? 0;
          const newFull = newCnt >= SLOT_MAX;
          const retFull = retCnt >= SLOT_MAX;
          const isCurrentSlot = isToday && slot === currentSlot;
          const isPastSlot = isToday &&
            (parseInt(slot.split(':')[0]) * 60 + parseInt(slot.split(':')[1])) <
            (currentH * 60 + currentM - 30);

          return (
            <div
              key={slot}
              className={cn(
                'border-b border-gray-100 min-h-[52px]',
                isCurrentSlot && 'bg-teal-50/60',
                isPastSlot && 'opacity-55',
              )}
            >
              {/* 시간 레이블 + 슬롯 카운터 */}
              <div className="flex items-center gap-1 px-1.5 pt-1">
                <span className={cn(
                  'text-[10px] font-mono tabular-nums shrink-0 w-9',
                  isCurrentSlot ? 'text-teal-700 font-bold' : 'text-gray-400',
                )}>
                  {slot}
                </span>
                {isCurrentSlot && (
                  <div className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-pulse shrink-0" />
                )}
                {/* 초진/재진 슬롯 상한 표시 */}
                <div className="ml-auto flex items-center gap-0.5">
                  <span
                    className={cn(
                      'text-[9px] font-mono px-1 py-0.5 rounded font-medium leading-none',
                      newFull
                        ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                        : 'bg-blue-50 text-blue-600',
                    )}
                    title={`초진 ${newCnt}/${SLOT_MAX}${newFull ? ' — 상한 도달' : ''}`}
                  >
                    초{newCnt}/{SLOT_MAX}
                  </span>
                  <span
                    className={cn(
                      'text-[9px] font-mono px-1 py-0.5 rounded font-medium leading-none',
                      retFull
                        ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                        : 'bg-emerald-50 text-emerald-600',
                    )}
                    title={`재진 ${retCnt}/${SLOT_MAX}${retFull ? ' — 상한 도달' : ''}`}
                  >
                    재{retCnt}/{SLOT_MAX}
                  </span>
                </div>
              </div>

              {/* 예약 목록 */}
              <div className="px-1 pb-1 space-y-0.5">
                {items.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      'rounded text-[10px] px-1.5 py-0.5 truncate font-medium',
                      r.visit_type === 'new'
                        ? 'bg-blue-100 text-blue-800'
                        : r.visit_type === 'returning'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800',
                      r.status === 'checked_in' && 'opacity-50',
                      r.status === 'cancelled' && 'opacity-30 line-through',
                    )}
                    title={`${r.customer_name} · ${VISIT_TYPE_KO[r.visit_type]}`}
                  >
                    {r.customer_name}
                  </div>
                ))}

                {/* 빈 슬롯 클릭 → 예약 생성 */}
                <button
                  onClick={() => onSlotClick({ date: dateStr, time: slot })}
                  className="w-full rounded text-[10px] text-gray-300 hover:bg-teal-50 hover:text-teal-600 transition py-0.5 text-left px-1"
                  title="클릭하여 예약 추가"
                >
                  + 예약
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── QuickReservationDialog ─────────────────────────────────────────────────────
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
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (draft) {
      setForm({ ...draft });
      setCustomerId(null);
      setCustomerSuggestions([]);
    }
  }, [draft]);

  const handlePhoneChange = async (phone: string) => {
    if (!form) return;
    setForm((f) => f ? { ...f, phone } : f);
    setCustomerId(null);
    if (phone.replace(/\D/g, '').length >= 4 && clinicId) {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('clinic_id', clinicId)
        .ilike('phone', `%${phone.replace(/\D/g, '')}%`)
        .limit(5);
      setCustomerSuggestions((data ?? []) as Customer[]);
    } else {
      setCustomerSuggestions([]);
    }
  };

  const handleSelectCustomer = (c: Customer) => {
    setForm((f) => f ? { ...f, name: c.name, phone: c.phone } : f);
    setCustomerId(c.id);
    setCustomerSuggestions([]);
  };

  const handleSave = async () => {
    if (!form || !clinicId) return;
    if (!form.name.trim()) { toast.error('이름을 입력해주세요'); return; }
    setSaving(true);
    const { error } = await supabase.from('reservations').insert({
      clinic_id: clinicId,
      customer_id: customerId ?? null,
      customer_name: form.name.trim(),
      customer_phone: form.phone.trim() || null,
      reservation_date: form.date,
      reservation_time: form.time + ':00',
      visit_type: form.visit_type,
      memo: form.memo.trim() || null,
      status: 'confirmed',
      created_by: createdBy,
    });
    setSaving(false);
    if (error) { toast.error('예약 생성 실패: ' + error.message); return; }
    toast.success(`${form.name} ${form.time} 예약이 생성되었어요`);
    onCreated();
    onClose();
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

            {/* 방문유형 */}
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

            {/* 이름 */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">이름</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => f ? { ...f, name: e.target.value } : f)}
                placeholder="홍길동"
                className="h-8 text-sm"
              />
            </div>

            {/* 전화번호 + 자동완성 */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">전화번호</Label>
              <Input
                value={form.phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="010-1234-5678"
                className="h-8 text-sm"
              />
              {customerSuggestions.length > 0 && (
                <div className="border rounded-md bg-white shadow-sm overflow-hidden">
                  {customerSuggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-teal-50 border-b last:border-b-0 transition"
                      onClick={() => handleSelectCustomer(c)}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1.5 text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 메모 */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">메모 (선택)</Label>
              <Textarea
                value={form.memo}
                onChange={(e) => setForm((f) => f ? { ...f, memo: e.target.value } : f)}
                placeholder="특이사항, 문의내용..."
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
            className="bg-teal-600 hover:bg-teal-700 text-white"
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
  const [date, setDate] = useState<Date>(() => new Date());
  const [tab, setTab] = useState<TabKey>('all');
  const [rows, setRows] = useState<CheckIn[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<CheckIn | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [selectedCheckIn, setSelectedCheckIn] = useState<CheckIn | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CheckIn | null>(null);
  const [paymentInitialMode, setPaymentInitialMode] = useState<'single' | 'package'>('single');
  const [dayPayments, setDayPayments] = useState<Map<string, number>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ checkIn: CheckIn; pos: { x: number; y: number } } | null>(null);
  const [customerMenu, setCustomerMenu] = useState<{ checkIn: CheckIn; pos: { x: number; y: number } } | null>(null);
  const [stageStartMap, setStageStartMap] = useState<Map<string, string>>(new Map());
  const [pkgMap, setPkgMap] = useState<Map<string, PackageLabel>>(new Map());
  const [consentMap, setConsentMap] = useState<Map<string, ConsentEntry>>(new Map());
  const [therapists, setTherapists] = useState<Staff[]>([]);
  // ── 달력 + 타임라인 상태 ──────────────────────────────────────────────────────
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [quickResvDraft, setQuickResvDraft] = useState<QuickResvDraft | null>(null);
  const [timelineReservations, setTimelineReservations] = useState<Reservation[]>([]);
  /** reservation_id → reservation_time (HH:MM:SS) — CustomerHoverCard 예약시간 표시용 */
  const resvTimeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of timelineReservations) {
      if (r.id && r.reservation_time) m.set(r.id, r.reservation_time);
    }
    return m;
  }, [timelineReservations]);
  const calendarRef = useRef<HTMLDivElement>(null);
  const recentlyUpdated = useRef<Set<string>>(new Set());
  const navStateConsumed = useRef(false);

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
        const parsed = JSON.parse(saved) as string[];
        // 저장된 순서가 유효한지 검증 (알 수 없는 ID 제거, 누락된 ID 뒤에 추가)
        const valid = parsed.filter((id): id is KanbanGroupId =>
          (DEFAULT_GROUP_ORDER as readonly string[]).includes(id),
        );
        const missing = DEFAULT_GROUP_ORDER.filter((id) => !valid.includes(id));
        const merged = [...valid, ...missing];
        // T-20260430-foot-LASER-ROOM-REORDER: 치료실은 항상 레이저실보다 앞에 위치
        const treatIdx = merged.indexOf('treatment_rooms');
        const laserIdx = merged.indexOf('laser_rooms');
        if (treatIdx !== -1 && laserIdx !== -1 && laserIdx < treatIdx) {
          merged.splice(laserIdx, 1);
          merged.splice(treatIdx, 0, 'laser_rooms');
        }
        return merged;
      }
    } catch {}
    return [...DEFAULT_GROUP_ORDER];
  });
  const [isLayoutEdit, setIsLayoutEdit] = useState(false);

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
      const next = arrayMove(prev, oldIdx, newIdx);
      // T-20260430-foot-LASER-ROOM-REORDER: 레이저실은 치료실 뒤에만 배치 가능
      const treatIdx = next.indexOf('treatment_rooms');
      const laserIdx = next.indexOf('laser_rooms');
      if (treatIdx !== -1 && laserIdx !== -1 && laserIdx < treatIdx) {
        toast.warning('레이저실은 치료실 뒤에만 배치할 수 있어요');
        return prev;
      }
      localStorage.setItem('foot-dash-group-order', JSON.stringify(next));
      return next;
    });
  }, []);

  const resetGroupOrder = useCallback(() => {
    const defaults = [...DEFAULT_GROUP_ORDER];
    setGroupOrder(defaults);
    localStorage.removeItem('foot-dash-group-order');
    toast.success('기본 배치로 초기화했어요');
  }, []);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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
  }, [clinic]);

  const fetchAssignments = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('room_assignments')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('date', dateStr);
    setAssignments((data ?? []) as RoomAssignment[]);
  }, [clinic, dateStr]);

  const fetchCheckIns = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const start = `${dateStr}T00:00:00+09:00`;
    const end = `${dateStr}T23:59:59+09:00`;
    const { data, error } = await supabase
      .from('check_ins')
      .select('*')
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
    const filtered = ((data ?? []) as CheckIn[]).filter((ci) => {
      if (ci.status !== 'registered') return true;
      const age = now - new Date(ci.checked_in_at).getTime();
      return age < STALE_MS;
    });
    setRows(filtered);
    setLoading(false);

    // ── 동의서 상태 일괄 조회 (카드 배지용) ──
    const ids = filtered.map((ci) => ci.id);
    if (ids.length > 0) {
      const { data: cData } = await supabase
        .from('consent_forms')
        .select('check_in_id, form_type, signed_at')
        .in('check_in_id', ids)
        .in('form_type', ['refund', 'non_covered']);
      const cMap = new Map<string, ConsentEntry>();
      for (const c of (cData ?? []) as { check_in_id: string; form_type: string; signed_at: string }[]) {
        const entry = cMap.get(c.check_in_id) ?? {};
        if (c.form_type === 'refund') entry.refundAt = c.signed_at;
        if (c.form_type === 'non_covered') entry.nonCoveredAt = c.signed_at;
        cMap.set(c.check_in_id, entry);
      }
      setConsentMap(cMap);
    } else {
      setConsentMap(new Map());
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

  // 타임라인용 — 취소 제외 전체 예약 (confirmed + checked_in + noshow)
  const fetchTimelineReservations = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('reservations')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('reservation_date', dateStr)
      .neq('status', 'cancelled')
      .order('reservation_time', { ascending: true });
    setTimelineReservations((data ?? []) as Reservation[]);
  }, [clinic, dateStr]);

  const [pendingReservations, setPendingReservations] = useState<Reservation[]>([]);
  const fetchReservations = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('reservations')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('reservation_date', dateStr)
      .eq('status', 'confirmed')
      .order('reservation_time', { ascending: true });
    setPendingReservations((data ?? []) as Reservation[]);
  }, [clinic, dateStr]);

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
    for (const t of (data ?? []) as { check_in_id: string; to_status: string; transitioned_at: string }[]) {
      if (!map.has(t.check_in_id)) map.set(t.check_in_id, t.transitioned_at);
    }
    setStageStartMap(map);
  }, [clinic, dateStr]);

  const fetchPackageLabels = useCallback(async () => {
    if (!clinic) return;
    const { data: pkgs } = await supabase
      .from('packages')
      .select('id, customer_id, package_name, total_sessions')
      .eq('clinic_id', clinic.id)
      .eq('status', 'active');
    if (!pkgs || pkgs.length === 0) { setPkgMap(new Map()); return; }

    const pkgIds = pkgs.map((p: { id: string }) => p.id);
    const { data: sessions } = await supabase
      .from('package_sessions')
      .select('package_id')
      .in('package_id', pkgIds)
      .eq('status', 'used');

    const usedMap = new Map<string, number>();
    for (const s of (sessions ?? []) as { package_id: string }[]) {
      usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
    }

    const map = new Map<string, PackageLabel>();
    for (const p of pkgs as { id: string; customer_id: string; package_name: string; total_sessions: number }[]) {
      const used = usedMap.get(p.id) ?? 0;
      const remaining = Math.max(0, p.total_sessions - used);
      map.set(p.customer_id, { name: p.package_name, remaining, total: p.total_sessions });
    }
    setPkgMap(map);
  }, [clinic]);

  const fetchTherapists = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .in('role', ['therapist', 'technician'])
      .order('name');
    setTherapists((data ?? []) as Staff[]);
  }, [clinic]);

  const [consultants, setConsultants] = useState<Staff[]>([]);
  const fetchConsultants = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .eq('role', 'consultant')
      .order('name');
    setConsultants((data ?? []) as Staff[]);
  }, [clinic]);

  const [doctors, setDoctors] = useState<Staff[]>([]);
  const fetchDoctors = useCallback(async () => {
    if (!clinic) return;
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .eq('role', 'director')
      .order('name');
    setDoctors((data ?? []) as Staff[]);
  }, [clinic]);

  const handleStaffAssign = useCallback(async (roomName: string, roomType: string, staffId: string | null, staffName: string | null) => {
    if (!clinic) return;
    const existing = assignments.find((a) => a.room_name === roomName && a.room_type === roomType);
    if (!staffId) {
      if (existing) {
        await supabase.from('room_assignments').delete().eq('id', existing.id);
      }
    } else if (existing) {
      await supabase.from('room_assignments').update({ staff_id: staffId, staff_name: staffName }).eq('id', existing.id);
    } else {
      await supabase.from('room_assignments').insert({
        clinic_id: clinic.id,
        date: dateStr,
        room_name: roomName,
        room_type: roomType,
        staff_id: staffId,
        staff_name: staffName,
      });
    }
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

  // T-20260502-foot-HEATED-LASER-SLOT: 가열성레이저 슬롯 원장님 배정 핸들러
  const handleHeatedLaserDoctorChange = useCallback((staffId: string | null, staffName: string | null) => {
    handleStaffAssign('가열성레이저', 'heated_laser', staffId, staffName);
  }, [handleStaffAssign]);

  useEffect(() => {
    fetchCheckIns();
    fetchRooms();
    fetchAssignments();
    fetchPayments();
    fetchReservations();
    fetchTimelineReservations();
    fetchStageStarts();
    fetchPackageLabels();
    fetchTherapists();
    fetchDoctors();
    fetchConsultants();
  }, [fetchCheckIns, fetchRooms, fetchAssignments, fetchPayments, fetchReservations, fetchTimelineReservations, fetchStageStarts, fetchPackageLabels, fetchTherapists, fetchDoctors, fetchConsultants]);

  useEffect(() => {
    if (!clinic) return;
    let checkInTimer: ReturnType<typeof setTimeout> | null = null;
    let assignTimer: ReturnType<typeof setTimeout> | null = null;
    let resvTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedCheckInRefetch = () => {
      if (checkInTimer) clearTimeout(checkInTimer);
      checkInTimer = setTimeout(() => { fetchCheckIns(); fetchStageStarts(); }, 800);
    };
    const debouncedAssignRefetch = () => {
      if (assignTimer) clearTimeout(assignTimer);
      assignTimer = setTimeout(() => fetchAssignments(), 800);
    };
    const debouncedResvRefetch = () => {
      if (resvTimer) clearTimeout(resvTimer);
      resvTimer = setTimeout(() => { fetchReservations(); fetchTimelineReservations(); }, 800);
    };

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
          const checkedAt = newRow?.checked_in_at;
          if (checkedAt && !checkedAt.startsWith(dateStr)) return;
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
      .subscribe();
    return () => {
      if (checkInTimer) clearTimeout(checkInTimer);
      if (assignTimer) clearTimeout(assignTimer);
      if (resvTimer) clearTimeout(resvTimer);
      supabase.removeChannel(channel);
    };
  }, [clinic, dateStr, fetchCheckIns, fetchAssignments, fetchReservations, fetchTimelineReservations, fetchStageStarts]);

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

  const [, setTick] = useState(0);
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
      map[key].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
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

  const undoDrag = useCallback(async (original: CheckIn) => {
    const revertPatch: Record<string, unknown> = {
      status: original.status,
      consultation_room: original.consultation_room,
      treatment_room: original.treatment_room,
      laser_room: original.laser_room,
      examination_room: original.examination_room,
      notes: original.notes,
    };
    if (original.status !== 'done') revertPatch.completed_at = null;
    const { error } = await supabase.from('check_ins').update(revertPatch).eq('id', original.id);
    if (error) {
      toast.error('되돌리기 실패');
      return;
    }
    setRows((curr) => curr.map((r) => (r.id === original.id ? { ...r, ...revertPatch } as CheckIn : r)));
    setStageStartMap((prev) => {
      const next = new Map(prev);
      next.delete(original.id);
      return next;
    });
    fetchStageStarts();
    toast.success('되돌리기 완료');
  }, [fetchStageStarts]);

  const toastWithUndo = useCallback((msg: string, original: CheckIn) => {
    toast(msg, {
      duration: 5000,
      action: {
        label: '되돌리기',
        onClick: () => undoDrag(original),
      },
    });
  }, [undoDrag]);

  const handleDragStart = (e: DragStartEvent) => {
    const card = e.active.data.current?.checkIn as CheckIn | undefined;
    if (card) setDragging(card);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const target = e.over?.id as string | undefined;
    const row = e.active.data.current?.checkIn as CheckIn | undefined;
    if (!target || !row) return;

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

      if (roomData?.isFull) {
        const room = rooms.find((r) => r.name === roomName);
        toast.info(`${roomName} 정원 초과 (${room?.max_occupancy ?? '?'}명)`);
        return;
      }

      const newStatus = DROP_STATUS_FOR_ROOM[roomType];
      const roomField = ROOM_FIELD_MAP[roomType];
      if (!newStatus || !roomField) return;

      if (row.status === newStatus && row[roomField] === roomName) return;

      markRecentlyUpdated(row.id);
      // #25 경합 방지: 함수형 업데이트 + 직전 row 스냅샷
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: newStatus, [roomField]: roomName } : r,
        );
      });

      const patch: Record<string, unknown> = {
        status: newStatus,
        [roomField]: roomName,
      };
      if (!row.called_at && row.status === 'registered') {
        patch.called_at = new Date().toISOString();
      }

      const roomAssignment = assignments.find((a) => a.room_name === roomName);
      if (roomAssignment?.staff_id) {
        if (roomType === 'consultation') patch.consultant_id = roomAssignment.staff_id;
        else if (roomType === 'treatment') patch.therapist_id = roomAssignment.staff_id;
      }

      const { error } = await supabase.from('check_ins').update(patch).eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
        return;
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
      toastWithUndo(`${roomName}(으)로 이동`, row);
    } else if (target === 'returning_zone' || target === 'experience_zone') {
      // 재진/선체험 대기열로 이동 → status = registered + visit_type 변경 (양방향 자유 이동)
      const targetVisitType: VisitType = target === 'returning_zone' ? 'returning' : 'experience';
      if (row.status === 'registered' && row.visit_type === targetVisitType) return;
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'registered' as CheckInStatus, visit_type: targetVisitType } : r,
        );
      });
      const { error } = await supabase
        .from('check_ins')
        .update({ status: 'registered', visit_type: targetVisitType })
        .eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
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
      const zoneLabel = targetVisitType === 'returning' ? '재진' : '선체험';
      toastWithUndo(`${zoneLabel} 대기로 이동`, row);
    } else if (target === 'laser_waiting') {
      if (row.status === 'laser_waiting') return;
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'laser_waiting' as CheckInStatus, laser_room: null } : r,
        );
      });
      const { error } = await supabase
        .from('check_ins')
        .update({ status: 'laser_waiting', laser_room: null })
        .eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
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
      toastWithUndo('레이저대기로 이동', row);
    } else if (target === 'healer_waiting') {
      // T-20260502-foot-HEALER-WAIT-SLOT
      if (row.status === 'healer_waiting') return;
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'healer_waiting' as CheckInStatus } : r,
        );
      });
      const { error } = await supabase
        .from('check_ins')
        .update({ status: 'healer_waiting' })
        .eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
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
      toastWithUndo('힐러대기로 이동', row);
    } else if (target === 'returning_exam' || target === 'returning_treatment') {
      const needsExam = target === 'returning_exam';
      markRecentlyUpdated(row.id);
      const updatedNotes = { ...(row.notes ?? {}), needs_exam: needsExam };
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) => (r.id === row.id ? { ...r, notes: updatedNotes } : r));
      });
      const { error } = await supabase
        .from('check_ins')
        .update({ notes: updatedNotes })
        .eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
        return;
      }
      toastWithUndo(needsExam ? '재진(진료)로 이동' : '재진(직행)으로 이동', row);
    } else if (target === 'registered') {
      // 초진 대기열로 이동 → status = registered + visit_type = new (양방향 자유 이동)
      if (row.status === 'registered' && row.visit_type === 'new') return;
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) =>
          r.id === row.id ? { ...r, status: 'registered' as CheckInStatus, visit_type: 'new' as VisitType } : r,
        );
      });
      const patch: Record<string, unknown> = { status: 'registered', visit_type: 'new' };
      if (!row.called_at && row.status !== 'registered') {
        patch.called_at = new Date().toISOString();
      }
      const { error } = await supabase.from('check_ins').update(patch).eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
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
      toastWithUndo('초진 대기로 이동', row);
    } else {
      const newStatus = target as CheckInStatus;
      if (row.status === newStatus) return;

      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r));
      });

      const patch: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'done') patch.completed_at = new Date().toISOString();
      if (!row.called_at && row.status === 'registered') {
        patch.called_at = new Date().toISOString();
      }

      const { error } = await supabase.from('check_ins').update(patch).eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
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

      if (newStatus === 'payment_waiting') {
        setPaymentTarget({ ...row, status: newStatus });
      }
      if (newStatus === 'done' && row.package_id) {
        const err = await autoDeductSession(row.id, row.package_id);
        if (err) toast.error(`세션 소진 실패: ${err}`);
        else toast.success('패키지 1회 자동 소진');
      }
      toastWithUndo(`${STATUS_KO[newStatus]}(으)로 이동`, row);
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

  const handleCardClick = (ci: CheckIn) => {
    setSelectedCheckIn(ci);
  };

  const handleCardContext = (ci: CheckIn, e: React.MouseEvent) => {
    setContextMenu({ checkIn: ci, pos: { x: e.clientX, y: e.clientY } });
  };

  const handleOpenChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) {
      toast.info('고객 정보가 연결되어 있지 않습니다');
      return;
    }
    navigate('/admin/customers', { state: { openCustomerId: ci.customer_id } });
  }, [navigate]);

  const handleOpenChartWindow = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) {
      toast.info('고객 정보가 연결되어 있지 않습니다');
      return;
    }
    window.open(
      `/chart/${ci.customer_id}`,
      `chart-${ci.customer_id}`,
      'width=820,height=960,scrollbars=yes,resizable=yes'
    );
  }, []);

  const handleNewReservation = useCallback((ci: CheckIn) => {
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
      return curr.map((r) => (r.id === ci.id ? { ...r, status: newStatus } : r));
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
    if (newStatus === 'payment_waiting') setPaymentTarget({ ...ci, status: newStatus });
    if (newStatus === 'done' && ci.package_id) {
      const err = await autoDeductSession(ci.id, ci.package_id);
      if (err) toast.error(`세션 소진 실패: ${err}`);
      else toast.success('패키지 1회 자동 소진');
    }
    toast.success(`${STATUS_KO[newStatus]}(으)로 변경`);
  };

  /** 상태 플래그 변경 — T-20260502-foot-STATUS-COLOR-FLAG */
  const handleFlagChange = async (ci: CheckIn, flag: StatusFlag | null) => {
    if (ci.id.startsWith('temp-')) return;
    // 낙관적 업데이트
    setRows((curr) => curr.map((r) => r.id === ci.id ? { ...r, status_flag: flag } : r));
    const now = new Date().toISOString();
    // audit entry (JSONB append)
    const historyEntry = { flag, changed_at: now, changed_by: profile?.id ?? null };
    // 1) status_flag 업데이트
    const { error } = await supabase
      .from('check_ins')
      .update({ status_flag: flag })
      .eq('id', ci.id);
    if (error) {
      // 롤백
      setRows((curr) => curr.map((r) => r.id === ci.id ? { ...r, status_flag: ci.status_flag } : r));
      toast.error(`플래그 변경 실패: ${error.message}`);
      return;
    }
    // 2) audit: status_flag_history JSONB array append (|| 연산자)
    await supabase
      .from('check_ins')
      .update({
        status_flag_history: (ci.status_flag_history ?? []).concat([historyEntry]),
      })
      .eq('id', ci.id)
      .then(() => {/* 이력 저장 실패해도 플래그 변경은 유지 */});
    const label = flag ? STATUS_FLAG_LABEL[flag] : '정상';
    toast.success(`플래그: ${label}`);
  };

  const handleReservationCheckIn = async (res: Reservation) => {
    if (!clinic) return;
    // B-3: 프론트 중복 방지 — 이미 체크인된 예약이면 차단 (DB UNIQUE 외 사용자 피드백)
    const already = rows.find((r) => r.reservation_id === res.id && r.status !== 'cancelled');
    if (already) {
      toast.info(`${res.customer_name}님은 이미 체크인되어 있습니다`);
      setSelectedCheckIn(already);
      return;
    }
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
        status: 'registered',
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
    setPendingReservations((prev) => prev.filter((r) => r.id !== res.id));

    const nextStatus: CheckInStatus = res.visit_type === 'new' ? 'consult_waiting' : 'registered';
    if (nextStatus !== 'registered') {
      await supabase.from('check_ins').update({ status: nextStatus }).eq('id', realId);
      const transNow = new Date().toISOString();
      await supabase.from('status_transitions').insert({
        check_in_id: realId,
        clinic_id: clinic.id,
        from_status: 'registered',
        to_status: nextStatus,
      });
      setStageStartMap((prev) => new Map(prev).set(realId, transNow));
    }

    // DB 완료 후 rows에 추가 (실제 UUID)
    const newCheckIn: CheckIn = {
      ...(inserted as CheckIn),
      status: nextStatus,
    };
    setRows((prev) => [...prev, newCheckIn]);
    toast.success(`${res.customer_name} 체크인 완료 (#${qn})`);
  };

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

  const handleQuickSlotClick = (slot: { date: string; time: string }) => {
    setQuickResvDraft({
      date: slot.date,
      time: slot.time,
      name: '',
      phone: '',
      visit_type: 'new',
      memo: '',
    });
  };

  const getStageStart = useCallback((ci: CheckIn): string => {
    return stageStartMap.get(ci.id) ?? ci.checked_in_at;
  }, [stageStartMap]);

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

  const doneCount = (byStatus['done'] ?? []).length;
  const totalActive = filtered.filter((r) => r.status !== 'done').length;

  const newPendingReservations = pendingReservations.filter((r) => r.visit_type === 'new');
  const returningPendingReservations = pendingReservations.filter((r) => r.visit_type === 'returning');

  // checklist는 DB 마이그 후 consult_waiting으로 이관됨 — 호환성 유지 포함
  const allRegistered = [...(byStatus['registered'] ?? []), ...(byStatus['checklist'] ?? [])];
  // 슬롯별 분류
  const newRegistered = allRegistered.filter((ci) => ci.visit_type === 'new');
  const returningWaiting = (byStatus['registered'] ?? []).filter((ci) => ci.visit_type === 'returning');
  const experienceWaiting = (byStatus['registered'] ?? []).filter((ci) => ci.visit_type === 'experience');
  // 레이저대기: laser_waiting 상태 (4/30 표준 v2 — 이전 'laser' + no room 방식에서 전환)
  const laserWaiting = filtered.filter((ci) => ci.status === 'laser_waiting');
  // 힐러대기: healer_waiting 상태 (T-20260502-foot-HEALER-WAIT-SLOT)
  const healerWaiting = filtered.filter((ci) => ci.status === 'healer_waiting');

  const paymentTotal = Array.from(dayPayments.values()).reduce((s, v) => s + v, 0);
  const doneTotal = (byStatus['done'] ?? []).reduce((s, ci) => s + (dayPayments.get(ci.id) ?? 0), 0);

  const examRooms = roomsByType['examination'] ?? [];
  const consultRooms = roomsByType['consultation'] ?? [];
  const treatmentRooms = roomsByType['treatment'] ?? [];
  const laserRooms = roomsByType['laser'] ?? [];

  // ── 칸반 그룹별 JSX 렌더러 ──────────────────────────────────────────────────
  const renderKanbanGroup = useCallback((gid: KanbanGroupId): React.ReactNode => {
    switch (gid) {
      case 'new_queue':
        return (
          <div key="new_queue" className="w-52 shrink-0">
            <DroppableColumn
              id="registered"
              label="초진"
              count={newRegistered.length + newPendingReservations.length}
              className="h-full"
              highlight="text-blue-700"
            >
              <TimeSlotAccordion reservations={newPendingReservations} onCheckIn={handleReservationCheckIn} />
              {newRegistered.map((ci) => (
                <DraggableCard
                  key={ci.id}
                  checkIn={ci}
                  stageStart={getStageStart(ci)}
                  packageLabel={getPkgLabel(ci)}
                  onClick={() => handleCardClick(ci)}
                  onContextMenu={(e) => handleCardContext(ci, e)}
                />
              ))}
            </DroppableColumn>
          </div>
        );
      case 'returning_queue':
        return (
          <div key="returning_queue" className="w-48 shrink-0">
            <DroppableColumn
              id="returning_zone"
              label="재진"
              count={returningWaiting.length + returningPendingReservations.length}
              className="h-full"
              highlight="text-orange-700"
            >
              <TimeSlotAccordion reservations={returningPendingReservations} onCheckIn={handleReservationCheckIn} />
              {returningWaiting.map((ci) => (
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
      case 'exam_section':
        return (
          <div key="exam_section" className="w-52 shrink-0 flex flex-col gap-2">
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
              />
            ) : (
              <div className="text-xs font-bold px-2 py-1 rounded-t-lg bg-violet-100 text-violet-800">진료</div>
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
      case 'experience_queue':
        return (
          <div key="experience_queue" className="w-44 shrink-0">
            <DroppableColumn
              id="experience_zone"
              label="선체험"
              count={experienceWaiting.length}
              className="h-full"
              highlight="text-amber-700"
            >
              {experienceWaiting.map((ci) => (
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
      case 'consult_waiting_col':
        return (
          <div key="consult_waiting_col" className="w-44 shrink-0">
            <DroppableColumn
              id="consult_waiting"
              label="상담대기"
              count={(byStatus['consult_waiting'] ?? []).length}
              className="h-full"
              highlight="text-blue-700"
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
      case 'consult_rooms':
        return consultRooms.length > 0 ? (
          <div key="consult_rooms" className="w-44 shrink-0">
            <RoomSection
              title="상담"
              color="bg-blue-100 text-blue-800"
              rooms={consultRooms}
              roomType="consultation"
              checkIns={filtered}
              assignments={assignments}
              gridCols="grid-cols-1"
              onCardClick={handleCardClick}
              onCardContext={handleCardContext}
              getStageStart={getStageStart}
              getPkgLabel={getPkgLabel}
              therapists={consultants}
              onTherapistChange={handleConsultantChange}
            />
          </div>
        ) : null;
      case 'waiting_columns':
        return (
          <div key="waiting_columns" className="flex gap-2 shrink-0">
            <div className="w-40">
              <DroppableColumn
                id="treatment_waiting"
                label="치료대기"
                count={(byStatus['treatment_waiting'] ?? []).length}
                className="h-full"
                highlight="text-amber-700"
              >
                {(byStatus['treatment_waiting'] ?? []).map((ci, idx, arr) => (
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
            <div className="w-40">
              <DroppableColumn
                id="laser_waiting"
                label="레이저대기"
                count={laserWaiting.length}
                className="h-full"
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
            {/* T-20260502-foot-HEALER-WAIT-SLOT: 힐러대기 슬롯 — 레이저대기 옆 세로 배치 */}
            <div className="w-40">
              <DroppableColumn
                id="healer_waiting"
                label="힐러대기"
                count={healerWaiting.length}
                className="h-full"
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
            </div>
          </div>
        );
      case 'treatment_rooms':
        return treatmentRooms.length > 0 ? (
          <div key="treatment_rooms" className="w-[480px] shrink-0">
            <RoomSection
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
            />
          </div>
        ) : null;
      case 'desk_section':
        return (
          <div key="desk_section" className="w-52 shrink-0 flex flex-col gap-2 h-full">
            <DroppableColumn
              id="payment_waiting"
              label="수납대기"
              count={(byStatus['payment_waiting'] ?? []).length}
              highlight="text-purple-700"
              subtitle={
                paymentTotal > 0 ? (
                  <div className="text-xs font-semibold text-purple-700 tabular-nums">
                    대기 {formatAmount(paymentTotal)}
                  </div>
                ) : undefined
              }
            >
              {(byStatus['payment_waiting'] ?? []).map((ci) => (
                <div key={ci.id}>
                  <DraggableCard checkIn={ci} compact stageStart={getStageStart(ci)} packageLabel={getPkgLabel(ci)} onClick={() => handleCardClick(ci)} onContextMenu={(e) => handleCardContext(ci, e)} />
                  <button
                    onClick={(e) => { e.stopPropagation(); setPaymentTarget(ci); }}
                    className="mt-0.5 w-full rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition flex items-center justify-center gap-0.5"
                  >
                    <CreditCard className="h-2.5 w-2.5" /> 결제하기
                  </button>
                </div>
              ))}
            </DroppableColumn>
            <DroppableColumn
              id="done"
              label="완료"
              count={doneCount}
              className="flex-1"
              highlight="text-emerald-700"
              subtitle={
                doneTotal > 0 ? (
                  <div className="text-xs font-semibold text-emerald-700 tabular-nums">
                    {formatAmount(doneTotal)}
                  </div>
                ) : undefined
              }
            >
              {(byStatus['done'] ?? []).map((ci) => {
                const paid = dayPayments.get(ci.id);
                return (
                  <div key={ci.id}>
                    <DraggableCard
                      checkIn={ci}
                      compact
                      stageStart={getStageStart(ci)}
                      packageLabel={getPkgLabel(ci)}
                      onClick={() => handleCardClick(ci)}
                    />
                    {paid != null && paid > 0 && (
                      <div className="mt-0.5 px-1 text-xs text-emerald-700 font-medium text-right tabular-nums">
                        {Math.round(paid / 10000)}만
                      </div>
                    )}
                  </div>
                );
              })}
            </DroppableColumn>
          </div>
        );
      case 'laser_rooms':
        return laserRooms.length > 0 ? (
          <div key="laser_rooms" className="w-[480px] shrink-0">
            <RoomSection
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
    experienceWaiting, laserWaiting, paymentTotal, doneTotal, dayPayments, doneCount,
    getStageStart, getPkgLabel, swapSortOrder,
    handleReservationCheckIn, handleCardClick, handleCardContext,
    handleDoctorChange, handleConsultantChange, handleTherapistChange, handleHeatedLaserDoctorChange,
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b bg-white/80">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => setDate((d) => subDays(d, 1))}>
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
                  onSelect={(d) => { setDate(d); setShowCalendar(false); }}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                />
              </div>
            )}
          </div>
          <Button variant="outline" size="icon-sm" onClick={() => setDate((d) => addDays(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate(new Date())}>
              오늘로
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>진행 <strong className="text-foreground">{totalActive}</strong></span>
            <span>·</span>
            <span>완료 <strong className="text-emerald-700">{doneCount}</strong></span>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5">전체</TabsTrigger>
              <TabsTrigger value="new" className="text-xs px-2.5">신규</TabsTrigger>
              <TabsTrigger value="returning" className="text-xs px-2.5">재진</TabsTrigger>
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

          {/* 레이아웃 편집 (관리자 전용) */}
          {profile?.role === 'admin' && (
            <div className="flex items-center gap-1">
              {isLayoutEdit && (
                <button
                  onClick={resetGroupOrder}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-600 hover:bg-gray-100 border transition"
                  title="기본 배치로 초기화"
                >
                  <RotateCcw className="h-3 w-3" /> 초기화
                </button>
              )}
              <button
                onClick={() => setIsLayoutEdit((v) => !v)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition',
                  isLayoutEdit
                    ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                    : 'text-gray-600 hover:bg-gray-100 border-gray-200',
                )}
                title={isLayoutEdit ? '편집 완료' : '슬롯 배치 편집 (관리자)'}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {isLayoutEdit ? '편집 완료' : '배치 편집'}
              </button>
            </div>
          )}

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

      {/* ── T-20260502-foot-DOCTOR-TREATMENT-FLOW: 진료콜 알람 배너 ── */}
      {isToday && (byStatus['exam_waiting'] ?? []).length > 0 && (
        <div className="mx-4 mt-2 rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm text-violet-800 flex items-center gap-2 animate-pulse">
          <Bell className="h-4 w-4 shrink-0 text-violet-600" />
          <span className="font-semibold">진료 대기 {(byStatus['exam_waiting'] ?? []).length}명</span>
          <span className="text-violet-600">—</span>
          <span>{(byStatus['exam_waiting'] ?? []).map((ci) => ci.customer_name).join(', ')}</span>
        </div>
      )}

      {/* Content: 타임라인 사이드바 + 칸반 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측: 타임라인 + 원내 메모 */}
        <div className="w-48 shrink-0 flex flex-col border-r overflow-hidden">
          <DashboardTimeline
            date={date}
            reservations={timelineReservations}
            onSlotClick={handleQuickSlotClick}
          />
          <ClinicMemoPanel
            date={date}
            clinicId={clinic?.id}
            userRole={profile?.role}
          />
        </div>

        {/* 우측: 칸반 (줌 + 레이아웃 편집 지원) */}
      <div className="flex-1 overflow-auto p-3">
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
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              /* ── 일반 모드: 카드 드래그 DndContext ── */
              <CardHandlersCtx.Provider value={cardHandlersValue}>
              <ConsentMapCtx.Provider value={consentMap}>
              <ResvTimeMapCtx.Provider value={resvTimeMap}>
              <DndContext
                sensors={sensors}
                collisionDetection={customCollision}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                autoScroll={{
                  threshold: { x: 0.15, y: 0.15 },
                  acceleration: 12,
                  interval: 5,
                }}
              >
                <div className="flex gap-2 h-full min-w-max">
                  {/* T-20260502-foot-HEATED-LASER-SLOT: 치료실 상단에 가열성레이저 슬롯 클러스터 */}
                  {groupOrder.map((gid) => {
                    // 레이저실은 치료실 클러스터 내부에서 렌더링 — 별도 표시 생략
                    if (gid === 'laser_rooms') return null;

                    if (gid === 'treatment_rooms') {
                      const hasTreatment = treatmentRooms.length > 0;
                      const hasLaser = laserRooms.length > 0 && groupOrder.includes('laser_rooms');
                      if (!hasTreatment && !hasLaser) return null;

                      const heatedAssignment = assignments.find(
                        (a) => a.room_name === '가열성레이저' && a.room_type === 'heated_laser',
                      );
                      const currentDoctorId = heatedAssignment?.staff_id ?? null;
                      const currentDoctorName = heatedAssignment?.staff_name ?? null;

                      return (
                        <div key="treatment_laser_cluster" className="flex flex-col gap-1.5 shrink-0">
                          {/* 가열성레이저 슬롯 — 연파랑, 원장님 선택, 치료실+레이저실 폭에 맞춤 */}
                          <div className="rounded-lg border border-blue-200 overflow-hidden shadow-sm">
                            <div className="flex items-center justify-between px-3 py-2 bg-[#BFDBFE]">
                              <div className="flex items-center gap-2">
                                <div className="h-2.5 w-2.5 rounded-full bg-blue-400 shrink-0" />
                                <span className="text-xs font-bold text-blue-900 tracking-wide">가열성레이저</span>
                                {currentDoctorName && (
                                  <span className="text-xs text-blue-700 font-medium">
                                    — {currentDoctorName} 원장님
                                  </span>
                                )}
                              </div>
                              <select
                                value={currentDoctorId ?? ''}
                                onChange={(e) => {
                                  const id = e.target.value || null;
                                  const name = id
                                    ? doctors.find((d) => d.id === id)?.name ?? null
                                    : null;
                                  handleHeatedLaserDoctorChange(id, name);
                                }}
                                className="text-xs h-6 border border-blue-300 rounded bg-white/90 px-1 text-blue-900 min-w-[90px] cursor-pointer hover:border-blue-400 transition"
                              >
                                <option value="">원장님 선택</option>
                                {doctors.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {/* 치료실 + 레이저실 가로 배치 */}
                          <div className="flex gap-2">
                            {hasTreatment && renderKanbanGroup('treatment_rooms')}
                            {hasLaser && renderKanbanGroup('laser_rooms')}
                          </div>
                        </div>
                      );
                    }

                    return renderKanbanGroup(gid);
                  })}
                </div>
                <DragOverlay>
                  {dragging && <DraggableCard checkIn={dragging} compact />}
                </DragOverlay>
              </DndContext>
              </ResvTimeMapCtx.Provider>
              </ConsentMapCtx.Provider>
              </CardHandlersCtx.Provider>
            )}
          </div>
        ) : null}
      </div>
      {/* flex flex-1 overflow-hidden wrapper 닫기 */}
      </div>

      {/* 빠른 예약 다이얼로그 */}
      <QuickReservationDialog
        draft={quickResvDraft}
        clinicId={clinic?.id}
        createdBy={profile?.id ?? null}
        onClose={() => setQuickResvDraft(null)}
        onCreated={() => { fetchReservations(); fetchTimelineReservations(); }}
      />

      <NewCheckInDialog
        open={openNew}
        onOpenChange={setOpenNew}
        clinicId={clinic?.id}
        onCreated={() => { fetchCheckIns(); fetchReservations(); }}
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
      />

      <PaymentDialog
        key={`${paymentTarget?.id ?? 'none'}-${paymentInitialMode}`}
        checkIn={paymentTarget}
        initialMode={paymentInitialMode}
        onClose={() => {
          setPaymentTarget(null);
          setPaymentInitialMode('single');
        }}
        onPaid={() => {
          setPaymentTarget(null);
          setPaymentInitialMode('single');
          fetchCheckIns();
          fetchPayments();
        }}
      />

      <StatusContextMenu
        checkIn={contextMenu?.checkIn!}
        position={contextMenu?.pos ?? null}
        onClose={() => setContextMenu(null)}
        onStatusChange={handleContextStatusChange}
        onFlagChange={handleFlagChange}
      />

      <CustomerQuickMenu
        checkIn={customerMenu?.checkIn ?? null}
        position={customerMenu?.pos ?? null}
        onClose={() => setCustomerMenu(null)}
        onOpenChart={handleOpenChart}
        onNewReservation={handleNewReservation}
        onOpenChartWindow={handleOpenChartWindow}
      />
    </div>
  );
}
