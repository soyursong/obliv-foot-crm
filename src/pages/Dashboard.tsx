import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
import { addDays, format, isSameDay, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  GripVertical,
  MoreVertical,
  Plus,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { STATUS_KO, VISIT_TYPE_KO, stagesFor } from '@/lib/status';
import { formatAmount, maskPhoneTail } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NewCheckInDialog } from '@/components/NewCheckInDialog';
import { CheckInDetailSheet } from '@/components/CheckInDetailSheet';
import { PaymentDialog } from '@/components/PaymentDialog';
import { StatusContextMenu } from '@/components/StatusContextMenu';
import { playOvertimeAlert } from '@/lib/audio';
import { autoDeductSession } from '@/lib/session';
import { elapsedMinutes, elapsedMMSS } from '@/lib/elapsed';
import type { CheckIn, CheckInRealtimeRow, CheckInStatus, Reservation, Room, RoomFieldKey, Staff } from '@/lib/types';

type TabKey = 'all' | 'new' | 'returning';

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
          onContextMenu?.(e);
        }}
        title="드래그=이동 · 우클릭/⋮=상태변경 · 클릭=상세"
        className={cn(
          'cursor-grab touch-none rounded border bg-white px-2 py-1.5 text-xs shadow-sm transition hover:shadow active:cursor-grabbing',
          urgency,
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 truncate">
            <GripVertical className="h-4 w-4 text-gray-400 shrink-0" />
            {checkIn.queue_number != null && (
              <span className="font-bold text-teal-700">#{checkIn.queue_number}</span>
            )}
            <span className="font-semibold truncate">{checkIn.customer_name}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Badge
              variant={checkIn.visit_type === 'new' ? 'teal' : 'secondary'}
              className="h-4 px-1 text-xs"
            >
              {VISIT_TYPE_KO[checkIn.visit_type]}
            </Badge>
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
        <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
          <span className={cn('tabular-nums font-mono', (mins >= 30 || isLaserOvertime) && 'font-semibold text-red-600')}>
            <Clock className="inline h-2.5 w-2.5 mr-0.5" />
            {mmss}
          </span>
          {checkIn.priority_flag && (
            <Badge variant="destructive" className="h-4 px-1 text-xs">
              {checkIn.priority_flag}
            </Badge>
          )}
        </div>
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
        onContextMenu?.(e);
      }}
      title="드래그=이동 · 우클릭/⋮=상태변경 · 클릭=상세"
      className={cn(
        'cursor-grab touch-none rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing',
        urgency,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          {checkIn.queue_number != null && (
            <span className="text-xs font-bold text-teal-700">#{checkIn.queue_number}</span>
          )}
          <span className="text-sm font-semibold">{checkIn.customer_name}</span>
          {checkIn.customer_phone && (
            <span className="text-xs text-muted-foreground">
              ···{maskPhoneTail(checkIn.customer_phone)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant={checkIn.visit_type === 'new' ? 'teal' : 'secondary'}>
            {VISIT_TYPE_KO[checkIn.visit_type]}
          </Badge>
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
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className={cn('text-muted-foreground tabular-nums font-mono', (mins >= 30 || isLaserOvertime) && 'font-semibold text-red-600')}>
          {mmss} {stageStart ? STATUS_KO[checkIn.status] ?? '경과' : '대기'}
        </span>
        {checkIn.priority_flag && <Badge variant="destructive">우선</Badge>}
      </div>
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

function ReturningSubZone({
  id,
  label,
  color,
  items,
  onCardClick,
  onCardContext,
  getStageStart,
  getPkgLabel,
}: {
  id: string;
  label: string;
  color: string;
  items: CheckIn[];
  onCardClick: (ci: CheckIn) => void;
  onCardContext: (ci: CheckIn, e: React.MouseEvent) => void;
  getStageStart?: (ci: CheckIn) => string;
  getPkgLabel?: (ci: CheckIn) => PackageLabel | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn('flex-1 p-1.5 transition-colors', isOver && 'bg-teal-50/40')}
    >
      <div className="flex items-center justify-between mb-1 px-1">
        <span className={cn('text-xs font-semibold', color)}>{label}</span>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <div className="space-y-1.5 min-h-[40px]">
        {items.map((ci) => (
          <DraggableCard
            key={ci.id}
            checkIn={ci}
            compact
            stageStart={getStageStart?.(ci)}
            packageLabel={getPkgLabel?.(ci)}
            onClick={() => onCardClick(ci)}
            onContextMenu={(e) => onCardContext(ci, e)}
          />
        ))}
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
  const showStaffDropdown = (roomType === 'treatment' || roomType === 'examination') && therapists && onTherapistChange;
  const showStaffLabel = roomType !== 'laser' && roomType !== 'treatment' && roomType !== 'examination' && staffName;

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

export default function Dashboard() {
  const location = useLocation();
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
  const [dayPayments, setDayPayments] = useState<Map<string, number>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ checkIn: CheckIn; pos: { x: number; y: number } } | null>(null);
  const [stageStartMap, setStageStartMap] = useState<Map<string, string>>(new Map());
  const [pkgMap, setPkgMap] = useState<Map<string, PackageLabel>>(new Map());
  const [therapists, setTherapists] = useState<Staff[]>([]);
  const recentlyUpdated = useRef<Set<string>>(new Set());
  const navStateConsumed = useRef(false);

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

  useEffect(() => {
    fetchCheckIns();
    fetchRooms();
    fetchAssignments();
    fetchPayments();
    fetchReservations();
    fetchStageStarts();
    fetchPackageLabels();
    fetchTherapists();
    fetchDoctors();
  }, [fetchCheckIns, fetchRooms, fetchAssignments, fetchPayments, fetchReservations, fetchStageStarts, fetchPackageLabels, fetchTherapists, fetchDoctors]);

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
      resvTimer = setTimeout(() => fetchReservations(), 800);
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
  }, [clinic, dateStr, fetchCheckIns, fetchAssignments, fetchReservations, fetchStageStarts]);

  const STAGE_ALERT_MINS: Partial<Record<CheckInStatus, number>> = {
    laser: 20,
    examination: 15,
    consultation: 25,
    preconditioning: 30,
    consult_waiting: 20,
    treatment_waiting: 20,
    exam_waiting: 20,
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

    if (row.visit_type === 'new' && row.status === 'registered' && target !== 'checklist') {
      toast.info('신규 환자는 체크리스트를 먼저 완료해야 합니다');
      return;
    }

    const isRoomDrop = target.startsWith('room:');
    const isSpecialZone = target === 'returning_exam' || target === 'returning_treatment' || target === 'laser_waiting';

    if (!isRoomDrop && !isSpecialZone) {
      const targetStatus = target as CheckInStatus;
      const stages = stagesFor(row.visit_type);
      const curIdx = stages.indexOf(row.status);
      const tgtIdx = stages.indexOf(targetStatus);
      // #19 강화: 재진/체험 환자는 신규 전용 단계(체크리스트/진료/상담)로 이동 불가
      if (targetStatus !== 'cancelled' && tgtIdx < 0) {
        toast.info(`${VISIT_TYPE_KO[row.visit_type]} 환자는 ${STATUS_KO[targetStatus] ?? targetStatus} 단계로 이동할 수 없습니다`);
        return;
      }
      if (curIdx >= 0 && tgtIdx >= 0 && tgtIdx < curIdx && targetStatus !== 'cancelled') {
        toast.info('이전 단계로는 이동할 수 없습니다');
        return;
      }
    }

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
    } else if (target === 'laser_waiting') {
      if (row.status === 'laser' && !row.laser_room) return;
      markRecentlyUpdated(row.id);
      let prevRow: CheckIn | undefined;
      setRows((curr) => {
        prevRow = curr.find((r) => r.id === row.id);
        return curr.map((r) => (r.id === row.id ? { ...r, status: 'laser' as CheckInStatus, laser_room: null } : r));
      });
      const { error } = await supabase
        .from('check_ins')
        .update({ status: 'laser', laser_room: null })
        .eq('id', row.id);
      if (error) {
        setRows((curr) => curr.map((r) => (r.id === row.id && prevRow ? prevRow : r)));
        toast.error(`이동 실패: ${error.message}`);
        return;
      }
      if (row.status !== 'laser') {
        const now = new Date().toISOString();
        await supabase.from('status_transitions').insert({
          check_in_id: row.id,
          clinic_id: row.clinic_id,
          from_status: row.status,
          to_status: 'laser',
        });
        setStageStartMap((prev) => new Map(prev).set(row.id, now));
      }
      toastWithUndo('레이저대기로 이동', row);
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

  const handleContextStatusChange = async (ci: CheckIn, newStatus: CheckInStatus) => {
    if (ci.id.startsWith('temp-')) {
      toast.info('체크인 처리 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    // #19 가드: 유효한 단계 전이만 허용 (cancelled는 항상 OK)
    if (newStatus !== 'cancelled') {
      const stages = stagesFor(ci.visit_type);
      const curIdx = stages.indexOf(ci.status);
      const tgtIdx = stages.indexOf(newStatus);
      if (tgtIdx < 0) {
        toast.info(`${VISIT_TYPE_KO[ci.visit_type]} 환자는 ${STATUS_KO[newStatus] ?? newStatus} 단계로 이동할 수 없습니다`);
        return;
      }
      if (curIdx >= 0 && tgtIdx < curIdx) {
        toast.info('이전 단계로는 이동할 수 없습니다');
        return;
      }
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

  const getStageStart = useCallback((ci: CheckIn): string => {
    return stageStartMap.get(ci.id) ?? ci.checked_in_at;
  }, [stageStartMap]);

  const getPkgLabel = useCallback((ci: CheckIn): PackageLabel | null => {
    if (ci.visit_type === 'new' || !ci.customer_id) return null;
    return pkgMap.get(ci.customer_id) ?? null;
  }, [pkgMap]);

  const isInvalidDrop = useCallback((columnStatus: CheckInStatus): boolean => {
    if (!dragging) return false;
    const stages = stagesFor(dragging.visit_type);
    const curIdx = stages.indexOf(dragging.status);
    const tgtIdx = stages.indexOf(columnStatus);
    // C-4: 재진/체험 환자가 신규 전용 단계(체크리스트/진료/상담)로 이동 시 invalid
    if (tgtIdx < 0) return true;
    if (curIdx < 0) return false;
    if (tgtIdx < curIdx) return true;
    if (dragging.visit_type === 'new' && dragging.status === 'registered' && columnStatus !== 'checklist') return true;
    return false;
  }, [dragging]);

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
  const returningPendingReservations = pendingReservations.filter((r) => r.visit_type !== 'new');

  const registered = [...(byStatus['registered'] ?? []), ...(byStatus['checklist'] ?? [])];
  const newRegistered = registered.filter((ci) => ci.visit_type === 'new');
  const returningRegistered = registered.filter((ci) => ci.visit_type !== 'new');
  const returningForExam = returningRegistered.filter((ci) => ci.notes?.needs_exam);
  const returningForTreatment = returningRegistered.filter((ci) => !ci.notes?.needs_exam);
  const laserWaiting = filtered.filter((ci) => ci.status === 'laser' && !ci.laser_room);

  const paymentTotal = Array.from(dayPayments.values()).reduce((s, v) => s + v, 0);
  const doneTotal = (byStatus['done'] ?? []).reduce((s, ci) => s + (dayPayments.get(ci.id) ?? 0), 0);

  const examRooms = roomsByType['examination'] ?? [];
  const consultRooms = roomsByType['consultation'] ?? [];
  const treatmentRooms = roomsByType['treatment'] ?? [];
  const laserRooms = roomsByType['laser'] ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b bg-white/80">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => setDate((d) => subDays(d, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[140px] text-center text-sm font-medium">
            {format(date, 'M월 d일 (EEE)', { locale: ko })}
            {isToday && <span className="ml-1 text-xs text-teal-700">오늘</span>}
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

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-3">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : (
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
              {/* 1. 초진예약 */}
              <div className="w-52 shrink-0">
                <DroppableColumn
                  id="registered"
                  label="초진예약"
                  count={newRegistered.length + newPendingReservations.length}
                  className="h-full"
                  highlight="text-blue-700"
                  invalidDrop={isInvalidDrop('registered')}
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

              {/* 2. 상담대기 */}
              <div className="w-44 shrink-0">
                <DroppableColumn
                  id="consult_waiting"
                  label="상담대기"
                  count={(byStatus['consult_waiting'] ?? []).length}
                  className="h-full"
                  highlight="text-blue-700"
                  invalidDrop={isInvalidDrop('consult_waiting')}
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

              {/* 3. 상담실 + 결제 */}
              {consultRooms.length > 0 && (
                <div className="w-[360px] shrink-0 flex flex-col gap-2">
                  <RoomSection
                    title="상담실"
                    color="bg-blue-100 text-blue-800"
                    rooms={consultRooms}
                    roomType="consultation"
                    checkIns={filtered}
                    assignments={assignments}
                    gridCols="grid-cols-3"
                    onCardClick={handleCardClick}
                    onCardContext={handleCardContext}
                    getStageStart={getStageStart}
                    getPkgLabel={getPkgLabel}
                  />
                  <DroppableColumn
                    id="payment_waiting"
                    label="결제"
                    count={(byStatus['payment_waiting'] ?? []).length}
                    invalidDrop={isInvalidDrop('payment_waiting')}
                    highlight="text-purple-700"
                    subtitle={
                      paymentTotal > 0 ? (
                        <div className="text-xs font-semibold text-purple-700 tabular-nums">
                          결제 대기 매출 {formatAmount(paymentTotal)}
                        </div>
                      ) : undefined
                    }
                  >
                    {(byStatus['payment_waiting'] ?? []).map((ci) => (
                      <div key={ci.id}>
                        <DraggableCard checkIn={ci} compact stageStart={getStageStart(ci)} packageLabel={getPkgLabel(ci)} onClick={() => handleCardClick(ci)} onContextMenu={(e) => handleCardContext(ci, e)} />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPaymentTarget(ci);
                          }}
                          className="mt-0.5 w-full rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition flex items-center justify-center gap-0.5"
                        >
                          <CreditCard className="h-2.5 w-2.5" /> 결제하기
                        </button>
                      </div>
                    ))}
                  </DroppableColumn>
                </div>
              )}

              {/* 4+5. 원장실/치료실 + 진료대기/치료대기 + 재진 (하단 통합) */}
              <div className="shrink-0 flex flex-col gap-2">
                <div className="flex gap-2">
                  {/* 4. 원장실 + 진료대기 */}
                  {examRooms.length > 0 && (
                    <div className="w-52 flex flex-col gap-2">
                      <RoomSection
                        title="원장실"
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
                      <DroppableColumn
                        id="exam_waiting"
                        label="진료대기"
                        invalidDrop={isInvalidDrop('exam_waiting')}
                        count={(byStatus['exam_waiting'] ?? []).length}
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
                  )}
                  {/* 5. 치료실 + 치료대기 */}
                  {treatmentRooms.length > 0 && (
                    <div className="w-[420px] flex flex-col gap-2">
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
                      <DroppableColumn
                        id="treatment_waiting"
                        label="치료대기"
                        count={(byStatus['treatment_waiting'] ?? []).length}
                        highlight="text-amber-700"
                        invalidDrop={isInvalidDrop('treatment_waiting')}
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
                  )}
                </div>
                {/* 재진 — 진료대기/치료대기 아래 통합 */}
                <div className="flex flex-col rounded-lg border border-orange-200 bg-orange-50/30 overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-orange-200 bg-orange-100/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-orange-800">재진</span>
                      <span className="text-xs text-orange-600">
                        {returningPendingReservations.length + returningForExam.length + returningForTreatment.length}
                      </span>
                    </div>
                  </div>
                  {returningPendingReservations.length > 0 && (
                    <div className="p-1.5 border-b border-orange-200">
                      <div className="text-xs font-semibold text-orange-600 mb-1 px-1">예약</div>
                      <TimeSlotAccordion reservations={returningPendingReservations} onCheckIn={handleReservationCheckIn} />
                    </div>
                  )}
                  <div className="flex">
                    <ReturningSubZone
                      id="returning_exam"
                      label="원장 진료"
                      color="text-violet-600"
                      items={returningForExam}
                      onCardClick={handleCardClick}
                      onCardContext={handleCardContext}
                      getStageStart={getStageStart}
                      getPkgLabel={getPkgLabel}
                    />
                    <div className="border-l border-dashed border-gray-300 my-2" />
                    <ReturningSubZone
                      id="returning_treatment"
                      label="치료 직행"
                      color="text-green-600"
                      items={returningForTreatment}
                      onCardClick={handleCardClick}
                      onCardContext={handleCardContext}
                      getStageStart={getStageStart}
                      getPkgLabel={getPkgLabel}
                    />
                  </div>
                </div>
              </div>

              {/* 6. 레이저실 + 레이저대기 */}
              {laserRooms.length > 0 && (
                <div className="w-[560px] shrink-0 flex flex-col gap-2">
                  <RoomSection
                    title="레이저실"
                    color="bg-rose-100 text-rose-800"
                    rooms={laserRooms}
                    roomType="laser"
                    checkIns={filtered}
                    assignments={assignments}
                    gridCols="grid-cols-4"
                    onCardClick={handleCardClick}
                    onCardContext={handleCardContext}
                    getStageStart={getStageStart}
                    getPkgLabel={getPkgLabel}
                  />
                  <DroppableColumn
                    id="laser_waiting"
                    label="레이저대기"
                    count={laserWaiting.length}
                    highlight="text-rose-700"
                    invalidDrop={isInvalidDrop('laser')}
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
              )}

              {/* 7. 완료 */}
              <div className="w-48 shrink-0">
                <DroppableColumn
                  id="done"
                  label="완료"
                  count={doneCount}
                  className="h-full"
                  highlight="text-emerald-700"
                  invalidDrop={isInvalidDrop('done')}
                  subtitle={
                    doneTotal > 0 ? (
                      <div className="text-xs font-semibold text-emerald-700 tabular-nums">
                        시술 완료 매출 {formatAmount(doneTotal)}
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
            </div>

            <DragOverlay>
              {dragging && <DraggableCard checkIn={dragging} compact />}
            </DragOverlay>
          </DndContext>
        )}
      </div>

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
        onPayment={(ci) => {
          setSelectedCheckIn(null);
          setPaymentTarget(ci);
        }}
      />

      <PaymentDialog
        checkIn={paymentTarget}
        onClose={() => setPaymentTarget(null)}
        onPaid={() => {
          setPaymentTarget(null);
          fetchCheckIns();
          fetchPayments();
        }}
      />

      <StatusContextMenu
        checkIn={contextMenu?.checkIn!}
        position={contextMenu?.pos ?? null}
        onClose={() => setContextMenu(null)}
        onStatusChange={handleContextStatusChange}
      />
    </div>
  );
}
