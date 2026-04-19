import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from 'react-router-dom';
import { supabase, storageClient } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { formatQueueNumber, maskPhone } from '@/lib/i18n';
import {
  DndContext, DragOverlay, closestCorners, MouseSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import PaymentModal from '@/components/PaymentModal';
import { format, addDays, subDays, isToday as isTodayFn } from 'date-fns';
import { ko } from 'date-fns/locale';
import { getSelectedClinic } from '@/lib/clinic';

// --- Types ---
interface CheckIn {
  id: string;
  queue_number: number;
  customer_name: string;
  customer_phone: string;
  status: string;
  checked_in_at: string;
  language: string;
  customer_id?: string;
  room_number?: number | null;
  notes?: string | null;
  anesthesia_at?: string | null;
  lidocaine_at?: string | null;
  ultracaine_at?: string | null;
  sort_order?: number;
  reservation_id?: string | null;
  created_by?: string | null;
  consultant_id?: string | null;
  technician_id?: string | null;
  priority_flag?: 'CP' | '#' | null;
}

interface Reservation {
  id: string;
  customer_id: string;
  reservation_time: string;
  status: string;
  memo: string | null;
  referral_source?: string | null;
  reservation_type?: string | null;      // T-20260416-crm-KTY-RESV-TYPE-DASHBOARD
  reservation_type_etc?: string | null;  // 기타 상세
  customers?: { name: string; phone: string } | null;
}

interface Service {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  category: string | null;
  duration_min: number | null;
}

interface CheckInService {
  id: string;
  service_name: string;
  price: number;
  original_price: number | null;
}

interface Staff {
  id: string;
  name: string;
  role: string;
  active?: boolean;
}

interface RoomAssignment {
  room_type: string;
  room_number: number;
  staff_id: string;
  staff?: Staff;
}

// --- Constants ---
const COUNTRY_CODES = [
  { code: '+82', label: '🇰🇷 +82' }, { code: '+1', label: '🇺🇸 +1' },
  { code: '+81', label: '🇯🇵 +81' }, { code: '+86', label: '🇨🇳 +86' },
];

const RES_STATUS_COLORS: Record<string, string> = {
  reserved: 'bg-blue-100 text-blue-700', checked_in: 'bg-green-100 text-green-700', no_show: 'bg-red-100 text-red-700',
};
const RES_STATUS_LABELS: Record<string, string> = {
  reserved: '예약', checked_in: '체크인', no_show: '노쇼',
};

// --- Helper: elapsed time ---
function elapsedStr(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분`;
  return `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
}

function elapsedMins(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

// SortableCard 제거 — DraggableCard + 순서 버튼으로 대체

// --- Draggable Card ---
const DraggableCard = React.memo(function DraggableCard({ checkIn, onClick, onContextMenu, compact, services, paid, onMoveUp, onMoveDown, stageTime, totalTime, isReturning }: {
  checkIn: CheckIn; onClick: () => void; onContextMenu: (e: React.MouseEvent, id: string) => void; compact?: boolean; services?: string[]; paid?: boolean;
  onMoveUp?: () => void; onMoveDown?: () => void; stageTime?: string; totalTime?: string; isReturning?: boolean;
}) {
  // 최적화 #4: 카드 자체 interval로 경과시간 갱신 (부모 전체 리렌더 방지)
  const [, setLocalTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLocalTick(v => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: checkIn.id, data: { checkIn } });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const isForeign = !!checkIn.customer_phone && !checkIn.customer_phone.startsWith('0') && !checkIn.customer_phone.startsWith('+82');
  const waitTime = checkIn.checked_in_at ? elapsedStr(checkIn.checked_in_at) : '';
  const anesthesiaElapsedRaw = checkIn.anesthesia_at ? Math.floor((Date.now() - new Date(checkIn.anesthesia_at).getTime()) / 60000) : null;
  const anesthesiaElapsed = anesthesiaElapsedRaw !== null && anesthesiaElapsedRaw >= 0 ? anesthesiaElapsedRaw : null;
  const waitMins = checkIn.checked_in_at && (checkIn.status === 'waiting' || checkIn.status === 'treatment_waiting')
    ? elapsedMins(checkIn.checked_in_at) : -1;
  const urgencyRing = waitMins >= 40 ? 'ring-2 ring-red-500 animate-pulse' : waitMins >= 20 ? 'ring-2 ring-orange-400' : '';
  const didDrag = useRef(false);

  // Merge dnd-kit listeners with click detection
  const mergedListeners = {
    ...listeners,
    onPointerDown: (e: React.PointerEvent) => {
      didDrag.current = false;
      listeners?.onPointerDown?.(e as any);
    },
    onPointerMove: (e: React.PointerEvent) => {
      didDrag.current = true;
      listeners?.onPointerMove?.(e as any);
    },
  };

  const handleClick = () => {
    if (!didDrag.current) onClick();
  };

  if (compact) {
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...mergedListeners} onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, checkIn.id); }}
        className={`relative rounded-lg border p-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow touch-none ${urgencyRing} ${isReturning ? 'bg-cyan-50 border-cyan-300' : 'bg-violet-50 border-violet-200'}`}>
        {isReturning !== undefined && (
          <span className={`absolute -top-1.5 -left-1 text-[8px] px-1 rounded leading-tight ${isReturning ? 'bg-cyan-500 text-white' : 'bg-violet-500 text-white'}`}>{isReturning ? '리터치' : '신규'}</span>
        )}
        {checkIn.priority_flag && (
          <span className={`absolute -top-1.5 -right-1 text-[9px] font-bold px-1 rounded leading-tight ${checkIn.priority_flag === 'CP' ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}`}>{checkIn.priority_flag === 'CP' ? 'CP' : '#'}</span>
        )}
        <div className="flex items-center gap-1">
          {(onMoveUp || onMoveDown) && (
            <div className="flex flex-col shrink-0">
              <button onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }} className="text-muted-foreground/40 hover:text-foreground text-[10px] leading-none" disabled={!onMoveUp}>▲</button>
              <button onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }} className="text-muted-foreground/40 hover:text-foreground text-[10px] leading-none" disabled={!onMoveDown}>▼</button>
            </div>
          )}
          <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs">{formatQueueNumber(checkIn.queue_number)}</span>
          <div className="flex items-center gap-1">
            {paid && <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded">결제</span>}
            <span className="text-[10px] text-orange-500">{stageTime || waitTime}</span>
          </div>
        </div>
        <p className="text-xs font-medium mt-0.5 flex items-center gap-1">
          {checkIn.customer_name}{isForeign && <span>🌏</span>}
        </p>
        {totalTime && stageTime !== totalTime && <p className="text-[9px] text-muted-foreground">총 {totalTime}</p>}
        {services && services.length > 0 && (
          <p className="text-[10px] text-accent mt-0.5 whitespace-normal break-words leading-tight">{services.join(', ')}</p>
        )}
        {anesthesiaElapsed !== null && (
          <p className={`text-[10px] mt-0.5 ${anesthesiaElapsed >= 20 ? 'text-green-600 font-bold bg-green-50 rounded px-1' : 'text-purple-600'}`}>
            💉 {anesthesiaElapsed >= 20 ? '시술가능' : `마취 ${anesthesiaElapsed}분`}
          </p>
        )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...mergedListeners} onClick={handleClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, checkIn.id); }}
      className={`rounded-xl border p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow touch-none ${urgencyRing} bg-white border-border`}>
      <div className="flex items-center gap-1.5">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/30" />
        <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold">{formatQueueNumber(checkIn.queue_number)}</span>
        <div className="flex items-center gap-1">
          {paid && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">결제완료</span>}
          <span className="text-xs text-orange-500">{waitTime}</span>
        </div>
      </div>
      <p className="text-sm font-medium flex items-center gap-1">
        {checkIn.customer_name}{isForeign && <span>🌏</span>}
      </p>
      <p className="text-xs text-muted-foreground">{maskPhone(checkIn.customer_phone)}</p>
      {services && services.length > 0 && (
        <p className="text-xs text-accent mt-1 truncate" title={services.join(', ')}>{services.join(', ')}</p>
      )}
      {anesthesiaElapsed !== null && (
        <p className={`text-xs mt-1 ${anesthesiaElapsed >= 20 ? 'text-green-600 font-semibold' : 'text-purple-600'}`}>
          💉 {anesthesiaElapsed >= 20 ? '시술가능' : `마취 ${anesthesiaElapsed}분`}
        </p>
      )}
        </div>
      </div>
    </div>
  );
});

// --- Droppable Zone ---
const DroppableZone = React.memo(function DroppableZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`transition-all ${isOver ? 'ring-2 ring-accent bg-accent/15 scale-[1.02] shadow-md' : ''} ${className || ''}`}>{children}</div>;
});

const CardPreview = React.memo(function CardPreview({ checkIn }: { checkIn: CheckIn }) {
  return (
    <div className="bg-card rounded-xl border-2 border-accent p-3 shadow-xl w-56 rotate-2 opacity-90">
      <span className="font-bold">{formatQueueNumber(checkIn.queue_number)}</span>
      <p className="text-sm font-medium mt-1">{checkIn.customer_name}</p>
    </div>
  );
});

// ====== MAIN COMPONENT ======
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Date navigation
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Core state
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [activeCheckIn, setActiveCheckIn] = useState<CheckIn | null>(null);
  const [todayReservations, setTodayReservations] = useState<Reservation[]>([]);
  const [consultationRooms, setConsultationRooms] = useState(15);
  const [treatmentRooms, setTreatmentRooms] = useState(3);
  const [showDoneColumn, setShowDoneColumn] = useState(false);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});

  // Modals
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualCountryCode, setManualCountryCode] = useState('+82');
  const [manualReferral, setManualReferral] = useState('');
  const [manualResidentId, setManualResidentId] = useState('');
  // 김태영 #9: 수동등록 시 예약 동시 생성 옵션
  const [manualCreateReservation, setManualCreateReservation] = useState(false);
  const [manualResDate, setManualResDate] = useState('');
  const [manualResTime, setManualResTime] = useState('');
  // 긴급: 중복 생성 race 방지 (느릴 때 2번 클릭 → 2건 insert 보고)
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CheckIn | null>(null);

  // Customer detail sheet
  const [detailCheckIn, setDetailCheckIn] = useState<CheckIn | null>(null);
  const [detailServices, setDetailServices] = useState<CheckInService[]>([]);
  const [detailNotes, setDetailNotes] = useState('');
  const [detailTmMemo, setDetailTmMemo] = useState('');
  const [consultNoteToday, setConsultNoteToday] = useState('');
  const [consultNoteHistory, setConsultNoteHistory] = useState<{ note_date: string; content: string }[]>([]);
  const [consultNoteId, setConsultNoteId] = useState<string | null>(null);
  // 김태영 요청 2026-04-13 22:26: 시술 메모 구조화
  const [tmPerformer, setTmPerformer] = useState('');
  const [tmDetails, setTmDetails] = useState('');
  const [tmUpselling, setTmUpselling] = useState(false);
  const [tmPigments, setTmPigments] = useState<string[]>([]);
  const [tmPigmentRatio, setTmPigmentRatio] = useState('');
  const [tmPhotos, setTmPhotos] = useState<string[]>([]);
  const [tmUploading, setTmUploading] = useState(false);
  // KTY-TREATMENT-EDIT-BTN: 시술 메모 수정 오버라이드 토글
  const [tmEditOverride, setTmEditOverride] = useState(false);
  // KTY-CUST-EDIT-EVERYWHERE: 대시보드 고객상세에서 고객 정보 수정
  const [custEditMode, setCustEditMode] = useState(false);
  const [custEditName, setCustEditName] = useState('');
  const [custEditPhone, setCustEditPhone] = useState('');
  const [custEditMemo, setCustEditMemo] = useState('');
  const tmSaving = useRef(false);
  const [detailPayment, setDetailPayment] = useState<{ amount: number; method: string; installment?: number; memo?: string } | null>(null);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [detailPaymentOpen, setDetailPaymentOpen] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState('');
  const [detailHistory, setDetailHistory] = useState<{ date: string; services: string; amount: number }[]>([]);

  // Staff & room assignments
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [assignRoomModal, setAssignRoomModal] = useState<{ type: string; number: number } | null>(null);
  // T-W2-05 김태영: 시술방 헤더 클릭 → 해당방 일간 통계 + 고객 정보
  const [roomStatsModal, setRoomStatsModal] = useState<{ type: 'treatment' | 'consultation'; number: number } | null>(null);
  const [roomAssignments, setRoomAssignments] = useState<RoomAssignment[]>([]);

  // No-show counts
  const [noShowCounts, setNoShowCounts] = useState<Record<string, number>>({});
  // 김태영 요청: 리터치(이전 done 이력 있음) vs 신규 카드 색 분리
  const [returningCustomerIds, setReturningCustomerIds] = useState<Set<string>>(new Set());

  // Reservation detail
  const [resDetailOpen, setResDetailOpen] = useState(false);
  const [resDetailCustomer, setResDetailCustomer] = useState<{ name: string; phone: string; memo?: string; id?: string } | null>(null);
  const [resDetailMemo, setResDetailMemo] = useState('');
  const [resDetailHistory, setResDetailHistory] = useState<{ date: string; services: string; amount: number }[]>([]);
  const [dayPayments, setDayPayments] = useState<Record<string, { amount: number; method: string }>>({});
  const [cardServices, setCardServices] = useState<Record<string, string[]>>({});

  // KTY-MOBILE-PULL-REFRESH: 모바일 pull-to-refresh
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const dashboardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dashboardRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => { if (el.scrollTop <= 0) pullStartY.current = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      if (pullStartY.current === null) return;
      const dy = e.touches[0].clientY - pullStartY.current;
      if (dy > 0 && el.scrollTop <= 0) { setPullDistance(Math.min(dy * 0.4, 80)); e.preventDefault(); }
      else { pullStartY.current = null; setPullDistance(0); }
    };
    const onTouchEnd = async () => {
      if (pullDistance >= 60 && clinicId && !pullRefreshing) {
        setPullRefreshing(true);
        await Promise.all([fetchCheckIns(clinicId), fetchTodayReservations(clinicId), fetchStaffAndRooms(clinicId)]);
        setPullRefreshing(false);
      }
      pullStartY.current = null; setPullDistance(0);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => { el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onTouchEnd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, pullDistance, pullRefreshing]);

  // KTY-DASHBOARD-DROP-TABS: 노쇼/이탈 건 토글
  const [droppedCIs, setDroppedCIs] = useState<CheckIn[]>([]);
  const [showDropped, setShowDropped] = useState(false);
  // Sidebar accordion — auto-advance to current hour
  // 김태영 #3: 30분 단위 표시 — 키를 HH:MM 형식으로 통일
  const [expandedHour, setExpandedHour] = useState<string | null>(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${n.getMinutes() < 30 ? '00' : '30'}`;
  });
  const [todaySearch, setTodaySearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // KTY-SEARCH-EXPAND: Ctrl+F → 검색바 포커스
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    const currentHH = String(new Date().getHours()).padStart(2, '0');
    setExpandedHour(prev => {
      if (!prev || prev < currentHH) return currentHH;
      return prev;
    });
  }, [selectedDate]);

  // Current user email
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Refs for flicker prevention — only setState when data actually changed
  const prevCheckInsRef = useRef<string>('');
  // 김태영 #20 핫픽스: 방금 optimistic update한 check_in id는 2초간 realtime payload 무시
  // (시술방→시술대기 회귀 근본 원인: 지연 도착한 old payload가 신규 state 덮어씀)
  const recentlyUpdatedIdsRef = useRef<Map<string, number>>(new Map());
  const markRecentlyUpdated = (id: string) => {
    recentlyUpdatedIdsRef.current.set(id, Date.now());
    setTimeout(() => {
      const t = recentlyUpdatedIdsRef.current.get(id);
      if (t && Date.now() - t >= 1900) recentlyUpdatedIdsRef.current.delete(id);
    }, 2000);
  };
  const isRecentlyUpdated = (id: string) => {
    const t = recentlyUpdatedIdsRef.current.get(id);
    return !!(t && Date.now() - t < 2000);
  };
  const prevDayPayRef = useRef<string>('');
  const prevCardSvcRef = useRef<string>('');
  const prevResRef = useRef<string>('');

  // Mobile sidebar
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Treatment room filter
  const [selectedRoom, setSelectedRoom] = useState<number | null>(() => {
    const saved = localStorage.getItem('obliv_selected_room');
    return saved ? parseInt(saved, 10) : null;
  });

  // Timer for auto-advance accordion only (경과시간 갱신은 DraggableCard 내부 interval에서 처리)
  useEffect(() => {
    const timer = setInterval(() => {
      // Auto-advance accordion to current hour if past
      const currentHH = String(new Date().getHours()).padStart(2, '0');
      setExpandedHour(prev => (!prev || prev < currentHH) ? currentHH : prev);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll to current time on load
  useEffect(() => {
    const el = document.getElementById('reservation-timeline');
    if (el) {
      const nowH = new Date().getHours();
      const nowM = new Date().getMinutes();
      const slotIdx = (nowH - 10) * 2 + (nowM >= 30 ? 1 : 0);
      const scrollTo = Math.max(0, slotIdx * 36 - 80);
      el.scrollTop = scrollTo;
    }
  }, [clinicId]);

  const isToday = isTodayFn(selectedDate);
  // PC는 즉시 드래그(distance 5px), 모바일은 짧은 long-press (체감 즉시성 + 스크롤 구분)
  const activeSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );
  const emptySensors = useSensors();
  const sensors = isToday ? activeSensors : emptySensors;

  // --- Data Fetching ---
  const fetchCheckIns = useCallback(async (cId: string) => {
    const today = format(selectedDate, 'yyyy-MM-dd');
    const checkInFields = 'id, queue_number, customer_name, customer_phone, status, checked_in_at, language, customer_id, room_number, notes, anesthesia_at, lidocaine_at, ultracaine_at, reservation_id, sort_order, created_by, consultant_id, technician_id, treatment_memo, treatment_photos, priority_flag';

    // 최적화: active check_ins와 dropped check_ins를 병렬로 fetch
    const [activeResult, droppedResult] = await Promise.all([
      (supabase.from('check_ins')
        .select(checkInFields)
        .eq('clinic_id', cId).eq('created_date', today)
        .not('status', 'in', '(no_show,abandoned,consult_left)')
        .order('queue_number', { ascending: true }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      // KTY-DASHBOARD-DROP-TABS: 이탈/노쇼 건 별도 fetch
      (supabase.from('check_ins')
        .select(checkInFields)
        .eq('clinic_id', cId).eq('created_date', today)
        .in('status', ['no_show', 'abandoned', 'consult_left'])
        .order('checked_in_at', { ascending: false }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
    ]);

    const data = activeResult.data;
    setDroppedCIs((droppedResult.data || []) as unknown as CheckIn[]);

    if (data) {
      // 김태영 #20: 방금 optimistic update한 행은 fetch 결과가 옛 상태일 수 있어서 현재 state 유지
      setCheckIns((prev) => {
        const incoming = data as unknown as CheckIn[];
        const merged = incoming.map(row => isRecentlyUpdated(row.id) ? (prev.find(p => p.id === row.id) || row) : row);
        return merged;
      });
      // 최적화 #5: JSON.stringify → quickHash (flickering 방지 목적)
      const key = `${data.length}:${(data[0] as any)?.id || ''}:${(data[data.length-1] as any)?.id || ''}`;
      if (key !== prevCheckInsRef.current) prevCheckInsRef.current = key;

      // 최적화: payments, returning, services 3개 쿼리를 Promise.all로 병렬 실행
      const doneIds = data.filter((c: any) => c.status === 'done').map((c: any) => c.id);
      const allIds = data.map((c: any) => c.id);
      const customerIds = [...new Set(data.map((c: any) => c.customer_id).filter(Boolean))] as string[];

      const [payResult, returningResult, svcResult] = await Promise.all([
        // Fetch payments for done check-ins
        (doneIds.length > 0
          ? supabase.from('payments').select('check_in_id, amount, method').in('check_in_id', doneIds)
          : Promise.resolve({ data: null }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        // 리터치 판별: 오늘 체크인 고객 중 이전에 done 이력 있는 customer_id Set
        (customerIds.length > 0
          ? supabase.from('check_ins').select('customer_id').eq('status', 'done').in('customer_id', customerIds).lt('created_date', today)
          : Promise.resolve({ data: null }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        // Fetch services for all check-ins
        (allIds.length > 0
          ? supabase.from('check_in_services').select('check_in_id, service_name').in('check_in_id', allIds)
          : Promise.resolve({ data: null }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      ]);

      // Process payments
      if (payResult.data) {
        const map: Record<string, { amount: number; method: string }> = {};
        (payResult.data as any[]).forEach((p: any) => { map[p.check_in_id] = { amount: p.amount, method: p.method }; });
        const payIds = Object.keys(map);
        const payKey = `${payIds.length}:${payIds[0] || ''}:${payIds[payIds.length-1] || ''}`;
        if (payKey !== prevDayPayRef.current) { prevDayPayRef.current = payKey; setDayPayments(map); }
      }

      // Process returning customers
      if (returningResult.data) {
        const setIds = new Set<string>((returningResult.data as any[]).map((r: any) => r.customer_id));
        setReturningCustomerIds(setIds);
      } else {
        setReturningCustomerIds(new Set());
      }

      // Process services
      if (svcResult.data) {
        const svcMap: Record<string, string[]> = {};
        (svcResult.data as any[]).forEach((s: any) => {
          if (!svcMap[s.check_in_id]) svcMap[s.check_in_id] = [];
          svcMap[s.check_in_id].push(s.service_name);
        });
        const svcIds = Object.keys(svcMap);
        const svcKey = `${svcIds.length}:${svcIds[0] || ''}:${svcIds[svcIds.length-1] || ''}`;
        if (svcKey !== prevCardSvcRef.current) { prevCardSvcRef.current = svcKey; setCardServices(svcMap); }
      }
    }
  }, [selectedDate]);

  const fetchTodayReservations = useCallback(async (cId: string) => {
    const today = format(selectedDate, 'yyyy-MM-dd');
    const { data } = await supabase.from('reservations')
      .select('id, customer_id, reservation_time, status, memo, referral_source, reservation_type, reservation_type_etc, customers(name, phone)')
      .eq('clinic_id', cId).eq('reservation_date', today).neq('status', 'cancelled')
      .order('reservation_time', { ascending: true });
    if (data) {
      const key = JSON.stringify(data);
      if (key !== prevResRef.current) { prevResRef.current = key; setTodayReservations(data as unknown as Reservation[]); }
      // Fetch no-show counts
      const customerIds = [...new Set((data as any[]).map(r => r.customer_id).filter(Boolean))];
      if (customerIds.length > 0) {
        const { data: nsData } = await supabase.from('reservations')
          .select('customer_id').eq('status', 'no_show').in('customer_id', customerIds);
        const counts: Record<string, number> = {};
        (nsData || []).forEach((r: any) => { counts[r.customer_id] = (counts[r.customer_id] || 0) + 1; });
        setNoShowCounts(counts);
      }
    }
  }, [selectedDate]);

  const fetchStaffAndRooms = useCallback(async (cId: string) => {
    const { data: sData } = await (supabase.from('staff') as any).select('*').eq('clinic_id', cId).eq('active', true);
    if (sData) setStaffList(sData as unknown as Staff[]);
    // 버그 수정 (2026-04-15, 김태영 대표 10:59): 주간 근무 배정과 동기화되도록
    // 선택 날짜 기준 work_date 필터 적용. 필터 없이 전체를 가져오면 과거 배정이 선점되어
    // AdminStaff 주간표와 AdminDashboard 시술/상담 영역이 불일치함.
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const { data: raData } = await supabase.from('room_assignments')
      .select('room_type, room_number, staff_id, work_date, staff(*)')
      .eq('clinic_id', cId)
      .eq('work_date', dateStr);
    if (raData) setRoomAssignments(raData as unknown as RoomAssignment[]);
  }, [selectedDate]);

  const fetchServices = useCallback(async (cId: string) => {
    const { data } = await supabase.from('services').select('*').eq('clinic_id', cId).eq('active', true).order('sort_order');
    if (data) setAllServices(data as unknown as Service[]);
  }, []);

  // 최적화 #2: realtime UPDATE 시 fetchCheckIns cascade 제거 → debounce로 payments/services 변경만 처리
  const fetchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedFetchCheckIns = useCallback((cId: string) => {
    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => fetchCheckIns(cId), 500);
  }, [fetchCheckIns]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      setCurrentUserEmail(session.user?.email || null);
      const clinic = await getSelectedClinic();
      if (clinic) {
        setClinicId(clinic.id);
        setClinicName(clinic.name);
        setConsultationRooms(clinic.consultation_rooms || 3);
        setTreatmentRooms(clinic.treatment_rooms || 15);
        setRoomNames((clinic as any).room_names || {});
        // check_ins/reservations는 아래 selectedDate effect가 clinicId 변경 감지 후 1회 호출.
        // 여기서 중복 호출하지 않음 (이전: 초기 로드마다 check_ins 2회 fetch)
        fetchStaffAndRooms(clinic.id);
        fetchServices(clinic.id);
      }
    };
    init();
  }, [navigate, fetchStaffAndRooms, fetchServices]);

  // Re-fetch when date changes
  useEffect(() => {
    if (clinicId) {
      fetchStaffAndRooms(clinicId);
      fetchCheckIns(clinicId);
      fetchTodayReservations(clinicId);
    }
  }, [selectedDate, clinicId, fetchCheckIns, fetchTodayReservations, fetchStaffAndRooms]);

  // Realtime
  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase.channel('dashboard_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins', filter: `clinic_id=eq.${clinicId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const n = payload.new as CheckIn;
          if (n.status !== 'no_show') {
            setCheckIns((prev) => [...prev, n]);
            toast({ title: '새 체크인', description: `${n.customer_name} - ${formatQueueNumber(n.queue_number)}` });
            try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2LkZeYl5KMhXx0bGVfXGBka3J5gIaLjo+PjYqGgXx2cW1qamtuc3mAhouQlJaXl5aSjYiCfHZxbWpqbG9zenp+').play().catch(() => {}); } catch {}
          }
          fetchTodayReservations(clinicId);
        } else if (payload.eventType === 'UPDATE') {
          const incoming = payload.new as CheckIn;
          // 김태영 #20: 방금 내가 optimistic으로 바꾼 건이면 realtime payload 무시 (지연 old payload 덮어쓰기 방지)
          if (!isRecentlyUpdated(incoming.id)) {
            setCheckIns((prev) => prev.map((c) => (c.id === incoming.id ? incoming : c)));
          }
          // 최적화 #2: UPDATE마다 fetchCheckIns 호출 제거. 개별 row는 위에서 setCheckIns로 갱신됨.
        } else if (payload.eventType === 'DELETE') {
          setCheckIns((prev) => prev.filter((c) => c.id !== (payload.old as { id: string }).id));
        }
      }).subscribe();

    // 김태영 #5: reservations / payments / consultation_notes 에도 realtime 구독
    const extraChannel = supabase.channel('dashboard_rt_extra')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinicId}` }, () => {
        fetchTodayReservations(clinicId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        // 최적화 #2: payments 변경 시 debounce로 갱신 (cascade 방지)
        debouncedFetchCheckIns(clinicId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_notes', filter: `clinic_id=eq.${clinicId}` }, () => {
        // 상담 메모 변경은 별도 refetch 없이 로컬 state에서 처리됨 (저장 후 즉시 갱신)
      })
      // 김태영 #17: 시술방/상담실 개수 설정 변경 즉시 반영 (AdminStaff 저장 → Dashboard)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clinics', filter: `id=eq.${clinicId}` }, (payload) => {
        const c = payload.new as { consultation_rooms?: number; treatment_rooms?: number; room_names?: Record<string, string> };
        if (typeof c.consultation_rooms === 'number') setConsultationRooms(c.consultation_rooms);
        if (typeof c.treatment_rooms === 'number') setTreatmentRooms(c.treatment_rooms);
        if (c.room_names) setRoomNames(c.room_names);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); supabase.removeChannel(extraChannel); };
  }, [clinicId, toast, fetchTodayReservations, fetchCheckIns, debouncedFetchCheckIns]);

  // T-20260415-crm-ROOM-STAFF-SYNC: room_assignments realtime 구독
  // AdminStaff 주간 배정 변경(INSERT/UPDATE/DELETE) → 대시보드 시술/상담 영역 즉시 반영.
  // 별도 채널로 격리 — selectedDate 변경 시 이 채널만 재연결되고 check_ins 채널은 영향 없음.
  useEffect(() => {
    if (!clinicId) return;
    const raChannel = supabase.channel('dashboard_rt_room_assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `clinic_id=eq.${clinicId}` }, () => {
        fetchStaffAndRooms(clinicId);
      })
      .subscribe();
    return () => { supabase.removeChannel(raChannel); };
  }, [clinicId, fetchStaffAndRooms]);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // --- Actions ---
  const appendNote = (currentNotes: string | null | undefined, msg: string): string => {
    const time = format(new Date(), 'HH:mm');
    const line = `[${time}] ${msg}`;
    return currentNotes ? `${currentNotes}\n${line}` : line;
  };

  const STATUS_KO: Record<string, string> = {
    waiting: '대기', consultation: '상담', treatment_waiting: '시술대기', treatment: '시술', payment_waiting: '결제대기', done: '완료',
  };

  const updateStatus = (checkInId: string, newStatus: string, roomNumber?: number | null) => {
    const current = checkIns.find((c) => c.id === checkInId);
    if (!current) return;

    // 김태영 #B 2026-04-15: 상담실 1칸 최대 3명 제한을 버튼 경로에도 적용
    // (드래그는 기존에 handleDragEnd에서 차단, 버튼/상세 모달에서는 무방비였음)
    if (newStatus === 'consultation' && roomNumber && current.status !== 'consultation') {
      const occupants = checkIns.filter(c => c.id !== checkInId && c.status === 'consultation' && c.room_number === roomNumber);
      if (occupants.length >= 3) {
        toast({ title: '상담실이 가득 찼습니다 (최대 3명)', variant: 'destructive' });
        return;
      }
    }

    const fromLabel = STATUS_KO[current.status] || current.status;
    const toLabel = STATUS_KO[newStatus] || newStatus;
    const roomStr = roomNumber ? ` ${roomNumber}번` : '';
    const newNotes = appendNote(current.notes, `${fromLabel} → ${toLabel}${roomStr}`);
    const finalRoom = (newStatus === 'waiting' || newStatus === 'treatment_waiting' || newStatus === 'payment_waiting') ? null : (roomNumber ?? null);

    // Optimistic update — UI 먼저 반영
    markRecentlyUpdated(checkInId); // 김태영 #20: 지연 payload가 덮지 못하게 보호
    setCheckIns((prev) => prev.map((c) => c.id === checkInId ? {
      ...c, status: newStatus, room_number: finalRoom, notes: newNotes,
      ...(current.status === 'waiting' && newStatus !== 'waiting' ? { called_at: new Date().toISOString() } : {}),
      ...(newStatus === 'done' ? { completed_at: new Date().toISOString() } : {}),
      ...(newStatus === 'payment_waiting' || newStatus === 'done' ? { anesthesia_at: null } : {}),
      ...(newStatus === 'treatment_waiting' && !current.anesthesia_at ? { anesthesia_at: new Date().toISOString() } : {}),
    } : c));

    // DB 백그라운드 처리 — 실패 시 rollback
    const updates: any = { status: newStatus, room_number: finalRoom, notes: newNotes };
    if (current.status === 'waiting' && newStatus !== 'waiting') updates.called_at = new Date().toISOString();
    if (newStatus === 'done') updates.completed_at = new Date().toISOString();
    if (newStatus === 'payment_waiting' || newStatus === 'done') updates.anesthesia_at = null;
    // Auto-set anesthesia when moving to treatment_waiting
    if (newStatus === 'treatment_waiting' && !current.anesthesia_at) updates.anesthesia_at = new Date().toISOString();
    // Set consultant_id when entering consultation room
    if (newStatus === 'consultation' && finalRoom) {
      const ra = roomAssignments.find(r => r.room_type === 'consultation' && r.room_number === finalRoom);
      if (ra) updates.consultant_id = ra.staff_id;
    }
    // Set technician_id when entering treatment room
    if (newStatus === 'treatment' && finalRoom) {
      const ra = roomAssignments.find(r => r.room_type === 'treatment' && r.room_number === finalRoom);
      if (ra) updates.technician_id = ra.staff_id;
    }

    supabase.from('check_ins').update(updates as any).eq('id', checkInId).then(({ error }) => {
      if (error) {
        // Rollback to previous state
        setCheckIns((prev) => prev.map((c) => c.id === checkInId ? current : c));
        toast({ title: '상태 변경 실패', description: error.message, variant: 'destructive' });
        return;
      }
      supabase.from('notifications').insert({ check_in_id: checkInId, type: 'status_change', message: `${fromLabel} → ${toLabel}${roomStr}` }).then(({ error }) => { if (error) console.error('notification insert failed:', error.message); });
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCheckIn(checkIns.find((c) => c.id === event.active.id) || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveCheckIn(null);
    const { active, over } = event;
    if (!over) return;
    const checkInId = active.id as string;
    const dropId = over.id as string;
    const current = checkIns.find((c) => c.id === checkInId);
    if (!current) return;

    // 같은 컬럼 내 순서 변경 (SortableContext)
    if (active.id !== over.id) {
      const overItem = checkIns.find(c => c.id === dropId);
      if (overItem && overItem.status === current.status && (current.status === 'waiting' || current.status === 'treatment_waiting')) {
        const columnItems = getColumnCheckIns(current.status);
        const oldIndex = columnItems.findIndex(c => c.id === active.id);
        const newIndex = columnItems.findIndex(c => c.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = arrayMove(columnItems, oldIndex, newIndex);
          const updates = reordered.map((c, i) => ({ ...c, sort_order: i }));
          updates.forEach(u => markRecentlyUpdated(u.id));
          setCheckIns(prev => {
            const others = prev.filter(c => c.status !== current.status);
            return [...others, ...updates];
          });
          updates.forEach(c => supabase.from('check_ins').update({ sort_order: c.sort_order } as any).eq('id', c.id).then(({ error }) => { if (error) console.error('sort_order update failed:', error.message); }));
          toast({ title: '순서 변경' });
          return;
        }
      }
    }

    let targetStatus: string;
    let targetRoom: number | null = null;

    if (dropId === 'waiting' || dropId === 'done' || dropId === 'treatment_waiting' || dropId === 'payment_waiting') {
      targetStatus = dropId;
    } else if (dropId.startsWith('consultation-')) {
      targetStatus = 'consultation';
      targetRoom = parseInt(dropId.split('-')[1], 10);
    } else if (dropId.startsWith('treatment-')) {
      targetStatus = 'treatment';
      targetRoom = parseInt(dropId.split('-')[1], 10);
    } else return;

    // Room occupancy check
    if (targetRoom) {
      const occupants = checkIns.filter((c) => c.status === targetStatus && c.room_number === targetRoom && c.id !== checkInId);
      // 김태영 신규: 상담실 최대 3명, 시술실 최대 2명
      const maxPerRoom = targetStatus === 'consultation' ? 3 : 2;
      if (occupants.length >= maxPerRoom) {
        toast({ title: targetStatus === 'consultation' ? '상담실이 가득 찼습니다 (최대 3명)' : targetStatus === 'treatment' ? '시술실이 가득 찼습니다 (최대 2명)' : '이미 사용 중인 방입니다', variant: 'destructive' });
        return;
      }
    }

    // 같은 컬럼 내 드롭 = 순서 변경
    if (current.status === targetStatus && current.room_number === targetRoom) {
      // dropId가 다른 카드 위인지 확인 (컬럼 드롭존이면 무시)
      const overCard = checkIns.find(c => c.id === dropId);
      if (overCard && overCard.status === current.status) {
        const columnItems = getColumnCheckIns(current.status);
        const fromIdx = columnItems.findIndex(c => c.id === current.id);
        const toIdx = columnItems.findIndex(c => c.id === overCard.id);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          // Reorder
          const reordered = [...columnItems];
          const [moved] = reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, moved);
          // Update sort_order
          const updates = reordered.map((c, i) => ({ ...c, sort_order: i }));
          setCheckIns(prev => {
            const others = prev.filter(c => c.status !== current.status);
            return [...others, ...updates];
          });
          // DB 백그라운드 저장
          updates.forEach(c => {
            supabase.from('check_ins').update({ sort_order: c.sort_order } as any).eq('id', c.id).then(({ error }) => { if (error) console.error('sort_order update failed:', error.message); });
          });
          toast({ title: '순서 변경', description: `${current.customer_name}` });
        }
      }
      return;
    }

    if (targetStatus === 'done') {
      // 시술 미입력 경고
      const { count } = await supabase.from('check_in_services').select('id', { count: 'exact', head: true }).eq('check_in_id', checkInId);
      if (!count || count === 0) {
        if (!window.confirm('시술 내역이 입력되지 않았습니다.\n시술 기록 없이 완료 처리하시겠습니까?')) return;
      }
      // Check if already paid
      const existingPay = dayPayments[checkInId];
      if (existingPay) {
        // Already paid, just complete
        updateStatus(checkInId, 'done');
      } else {
        setPaymentTarget(current);
      }
    } else if (targetStatus === 'payment_waiting') {
      updateStatus(checkInId, 'payment_waiting');
    } else {
      updateStatus(checkInId, targetStatus, targetRoom);
    }
  };

  const handlePaymentComplete = async (data: { amount: number; method: string; installment: number; memo: string }) => {
    const target = paymentTarget || (detailPaymentOpen ? detailCheckIn : null);
    if (!target) return;
    await supabase.from('payments').insert({ check_in_id: target.id, customer_id: target.customer_id || null, amount: data.amount, method: data.method, installment: data.installment, memo: data.memo || null });
    // Update dayPayments
    setDayPayments(prev => ({ ...prev, [target.id]: { amount: data.amount, method: data.method } }));
    if (paymentTarget) {
      await updateStatus(paymentTarget.id, 'done');
      setPaymentTarget(null);
    }
    if (detailPaymentOpen) {
      setDetailPaymentOpen(false);
      setDetailPayment({ amount: data.amount, method: data.method });
      // Auto-move from payment_waiting to done
      if (target.status === 'payment_waiting') {
        updateStatus(target.id, 'done');
        setDetailCheckIn(prev => prev ? { ...prev, status: 'done' } : null);
      }
      toast({ title: '결제 완료' });
    }
  };

  const handlePaymentSkipForDetail = () => {
    setDetailPaymentOpen(false);
  };

  const handlePaymentSkip = async () => {
    if (!paymentTarget) return;
    const { count } = await supabase.from('check_in_services').select('id', { count: 'exact', head: true }).eq('check_in_id', paymentTarget.id);
    if (!count || count === 0) {
      if (!window.confirm('시술 내역이 입력되지 않았습니다.\n결제 없이 완료 처리하시겠습니까?')) return;
    }
    await updateStatus(paymentTarget.id, 'done');
    setPaymentTarget(null);
  };

  const handleNoShow = async (id: string) => {
    await supabase.from('check_ins').update({ status: 'no_show' }).eq('id', id);
    setCheckIns((prev) => prev.filter((c) => c.id !== id));
    setContextMenu(null);
  };

  // 대기후이탈 처리 (박민지 #9-①) — 체크인만 하고 상담 전에 나간 경우
  const handleAbandoned = async (id: string) => {
    if (!window.confirm('대기후이탈 처리하시겠습니까?\n(체크인은 했으나 상담 전에 돌아간 고객)')) return;
    await supabase.from('check_ins').update({ status: 'abandoned' } as any).eq('id', id);
    setCheckIns((prev) => prev.filter((c) => c.id !== id));
    setContextMenu(null);
    toast({ title: '대기후이탈 처리 완료' });
  };

  // 상담후이탈 처리 (박민지 #9-②) — 상담은 받았으나 시술 거부하고 나간 경우
  const handleConsultLeft = async (id: string) => {
    if (!window.confirm('상담후이탈 처리하시겠습니까?\n(상담은 받았으나 시술을 거부하고 돌아간 고객)')) return;
    await supabase.from('check_ins').update({ status: 'consult_left' } as any).eq('id', id);
    setCheckIns((prev) => prev.filter((c) => c.id !== id));
    setContextMenu(null);
    toast({ title: '상담후이탈 처리 완료' });
  };

  const handleManualRegister = async () => {
    if (!manualName.trim() || !manualPhone.trim() || !clinicId) return;
    if (manualSubmitting) return;
    setManualSubmitting(true);
    try {
    const { data: queueData } = await supabase.rpc('next_queue_number', { p_clinic_id: clinicId });
    // 박민지 #6: 한국 번호는 010 형식 그대로 저장
    const fullPhone = manualCountryCode === '+82'
      ? manualPhone.trim()
      : `${manualCountryCode}${manualPhone.replace(/^0/, '')}`;

    // Find or create customer — W2-03: 010-0000-0000 더미폰은 항상 신규 생성
    let customerId: string | null = null;
    const isDummyPhone = fullPhone.replace(/[^0-9]/g, '') === '01000000000';
    if (!isDummyPhone) {
      const { data: existing } = await supabase.from('customers').select('id').eq('clinic_id', clinicId).eq('phone', fullPhone).maybeSingle();
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const { data: newC } = await supabase.from('customers').insert({ clinic_id: clinicId, name: manualName.trim(), phone: fullPhone, created_by: currentUserEmail, ...(manualResidentId.trim() ? { resident_id: manualResidentId.trim() } : {}) } as any).select('id').single();
      if (newC) customerId = newC.id;
    }

    // 김태영 #9: 수동등록 시 예약 동시 생성
    // 고객 find/create 완료 후, reservationIdToLink 쿼리 전에 삽입해야
    // 오늘 날짜 예약이면 아래 todayRes 쿼리에서 자동으로 감지·연결됨.
    if (manualCreateReservation && customerId && manualResDate && manualResTime) {
      await supabase.from('reservations').insert({
        clinic_id: clinicId, customer_id: customerId,
        reservation_date: manualResDate,
        reservation_time: manualResTime + ':00',
        status: 'reserved', created_by: currentUserEmail,
      } as any);
    }

    // 박민지 추가요청 3: 오늘 예약자가 아닌데 체크인하는 경우 워닝
    let reservationIdToLink: string | null = null;
    if (customerId) {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const { data: custRes } = await supabase.from('reservations')
        .select('id, reservation_date, reservation_time, status')
        .eq('customer_id', customerId)
        .neq('status', 'cancelled')
        .order('reservation_date', { ascending: true });

      const todayRes = (custRes || []).find((r: any) => r.reservation_date === todayStr);
      const otherRes = (custRes || []).filter((r: any) => r.reservation_date !== todayStr);

      if (todayRes) {
        reservationIdToLink = (todayRes as any).id;
      } else if (otherRes.length > 0) {
        const nearest = otherRes[0] as any;
        const msg = `${manualName.trim()}님은 ${nearest.reservation_date} ${String(nearest.reservation_time).slice(0, 5)}에 예약이 있습니다.\n\n확인: 예약을 오늘로 변경하고 체크인\n취소: 그냥 워크인으로 접수`;
        if (window.confirm(msg)) {
          const nowTime = format(new Date(), 'HH:mm:ss');
          await supabase.from('reservations').update({
            reservation_date: todayStr,
            reservation_time: nowTime,
          }).eq('id', nearest.id);
          reservationIdToLink = nearest.id;
          toast({ title: '예약 오늘로 이동 완료' });
        }
      }
    }

    await supabase.from('check_ins').insert({
      clinic_id: clinicId, queue_number: (queueData as number) || 1,
      customer_name: manualName.trim(), customer_phone: fullPhone,
      customer_id: customerId, referral_source: manualReferral || null,
      reservation_id: reservationIdToLink,
      created_by: currentUserEmail,
    } as any);
    if (customerId && manualResidentId.trim()) {
      await supabase.from('customers').update({ resident_id: manualResidentId.trim() } as any).eq('id', customerId);
    }
    setManualName(''); setManualPhone(''); setManualReferral(''); setManualResidentId('');
    setManualCreateReservation(false); setManualResDate(''); setManualResTime('');
    setManualOpen(false);
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleReservationCheckIn = async (res: Reservation) => {
    if (!res.customers) return;
    // Optimistic: 사이드바 즉시 갱신
    setTodayReservations(prev => prev.map(r => r.id === res.id ? { ...r, status: 'checked_in' } : r));
    const { data: queueData } = await supabase.rpc('next_queue_number', { p_clinic_id: clinicId });
    const qn = (queueData as number) || 1;
    // Optimistic: 대기 컬럼에 즉시 추가
    const tempId = `temp-${Date.now()}`;
    setCheckIns(prev => [...prev, {
      id: tempId, queue_number: qn, customer_name: res.customers!.name,
      customer_phone: res.customers!.phone, status: 'waiting', checked_in_at: new Date().toISOString(),
      language: 'ko', customer_id: res.customer_id, room_number: null, notes: null, anesthesia_at: null,
    }]);
    // DB 저장
    const { data: inserted } = await supabase.from('check_ins').insert({
      clinic_id: clinicId, queue_number: qn, customer_name: res.customers.name,
      customer_phone: res.customers.phone, customer_id: res.customer_id,
      reservation_id: res.id, status: 'waiting', created_by: currentUserEmail,
    } as any).select('id').single();
    await supabase.from('reservations').update({ status: 'checked_in' }).eq('id', res.id);
    if (inserted) setCheckIns(prev => prev.map(c => c.id === tempId ? { ...c, id: (inserted as any).id } : c));
    toast({ title: '체크인 완료 → 대기', description: `${res.customers.name} - ${formatQueueNumber(qn)}` });
  };

  const handleUndoCheckIn = async (res: Reservation) => {
    if (!res.customers) return;
    // Optimistic UI update
    setTodayReservations(prev => prev.map(r => r.id === res.id ? { ...r, status: 'reserved' } : r));
    setCheckIns(prev => prev.filter(c => !(c.customer_phone === res.customers!.phone && c.status === 'waiting')));
    const { error: delErr } = await (supabase.from('check_ins').delete() as any).match({ reservation_id: res.id, status: 'waiting' });
    if (delErr) { toast({ title: '체크인 삭제 실패', description: delErr.message, variant: 'destructive' }); return; }
    const { error: resErr } = await supabase.from('reservations').update({ status: 'reserved' }).eq('id', res.id);
    if (resErr) { toast({ title: '예약 복원 실패', description: resErr.message, variant: 'destructive' }); return; }
    toast({ title: '체크인 취소', description: `${res.customers.name} — 예약으로 복원` });
  };

  // --- Reservation Detail ---
  const openReservationDetail = async (res: Reservation) => {
    if (!res.customers) return;
    setResDetailCustomer({ name: res.customers.name, phone: res.customers.phone, id: res.customer_id });
    setResDetailMemo(res.memo ? `${res.memo}${res.referral_source ? ` (유입: ${res.referral_source})` : ''}` : (res.referral_source || ''));
    setResDetailOpen(true);

    // Fetch past visits for this customer
    if (res.customer_id) {
      const { data: pastCI } = await supabase.from('check_ins')
        .select('id, checked_in_at').eq('customer_id', res.customer_id)
        .order('checked_in_at', { ascending: false }).limit(10);
      if (pastCI && pastCI.length > 0) {
        const ciIds = pastCI.map((c: any) => c.id);
        const { data: svcData } = await supabase.from('check_in_services').select('check_in_id, service_name').in('check_in_id', ciIds);
        const { data: payData } = await supabase.from('payments').select('check_in_id, amount').in('check_in_id', ciIds);

        const history = pastCI.map((ci: any) => {
          const svcs = (svcData || []).filter((s: any) => s.check_in_id === ci.id).map((s: any) => s.service_name);
          const pay = (payData || []).find((p: any) => p.check_in_id === ci.id);
          return {
            date: ci.checked_in_at ? format(new Date(ci.checked_in_at), 'yyyy-MM-dd') : '-',
            services: svcs.join(', ') || '-',
            amount: pay ? (pay as any).amount : 0,
          };
        });
        setResDetailHistory(history);
      } else {
        setResDetailHistory([]);
      }
    }
  };

  // --- Detail Sheet ---
  const openDetail = async (ci: CheckIn) => {
    setDetailCheckIn(ci);
    setDetailNotes(ci.notes || '');
    // 시술 메모 구조화 + 사진 — 김태영 요청
    const tm = (ci as any).treatment_memo || {};
    setTmPerformer(tm.performer || '');
    setTmDetails(tm.details || '');
    setTmUpselling(!!tm.upselling);
    setTmPigments(Array.isArray(tm.pigments) ? tm.pigments : []);
    setTmPigmentRatio(tm.pigmentRatio || '');
    setTmPhotos(Array.isArray((ci as any).treatment_photos) ? (ci as any).treatment_photos : []);
    setTmEditOverride(false);
    // Fetch TM memo from customer
    if (ci.customer_id) {
      const { data: custData } = await supabase.from('customers').select('tm_memo').eq('id', ci.customer_id).maybeSingle();
      setDetailTmMemo((custData as any)?.tm_memo || '');
      // 상담 메모 (날짜별)
      const todayStr = format(selectedDate, 'yyyy-MM-dd');
      const { data: allNotes } = await supabase.from('consultation_notes').select('id, note_date, content').eq('customer_id', ci.customer_id).order('note_date', { ascending: false });
      const todayNote = (allNotes || []).find((n: any) => n.note_date === todayStr);
      setConsultNoteToday(todayNote ? (todayNote as any).content : '');
      setConsultNoteId(todayNote ? (todayNote as any).id : null);
      setConsultNoteHistory((allNotes || []).filter((n: any) => n.note_date !== todayStr).map((n: any) => ({ note_date: n.note_date, content: n.content })));
    } else {
      setDetailTmMemo('');
      setConsultNoteToday(''); setConsultNoteHistory([]); setConsultNoteId(null);
    }
    const { data } = await supabase.from('check_in_services').select('id, service_name, price, original_price').eq('check_in_id', ci.id);
    setDetailServices((data || []) as CheckInService[]);
    // Check existing payment
    const { data: payData } = await supabase.from('payments').select('amount, method, installment, memo').eq('check_in_id', ci.id).maybeSingle();
    setDetailPayment(payData as { amount: number; method: string; installment?: number; memo?: string } | null);

    // Fetch past visit history
    if (ci.customer_id) {
      const { data: pastCI } = await supabase.from('check_ins')
        .select('id, checked_in_at').eq('customer_id', ci.customer_id)
        .neq('id', ci.id).order('checked_in_at', { ascending: false }).limit(10);
      if (pastCI && pastCI.length > 0) {
        const ciIds = pastCI.map((c: any) => c.id);
        const { data: svcData } = await supabase.from('check_in_services').select('check_in_id, service_name').in('check_in_id', ciIds);
        const { data: payHist } = await supabase.from('payments').select('check_in_id, amount').in('check_in_id', ciIds);
        setDetailHistory(pastCI.map((c: any) => ({
          date: c.checked_in_at ? format(new Date(c.checked_in_at), 'yyyy-MM-dd') : '-',
          services: (svcData || []).filter((s: any) => s.check_in_id === c.id).map((s: any) => s.service_name).join(', ') || '-',
          amount: ((payHist || []).find((p: any) => p.check_in_id === c.id) as any)?.amount || 0,
        })));
      } else setDetailHistory([]);
    } else setDetailHistory([]);
  };

  const saveNotes = async () => {
    if (!detailCheckIn) return;
    await supabase.from('check_ins').update({ notes: detailNotes }).eq('id', detailCheckIn.id);
    setCheckIns((prev) => prev.map((c) => c.id === detailCheckIn.id ? { ...c, notes: detailNotes } : c));
    toast({ title: '메모 저장 완료' });
  };

  const addService = async (svc: Service) => {
    if (!detailCheckIn) return;
    const appliedPrice = svc.discount_price ?? svc.price;
    await supabase.from('check_in_services').insert({
      check_in_id: detailCheckIn.id, service_id: svc.id, service_name: svc.name,
      price: appliedPrice, original_price: svc.price,
    });
    const { data } = await supabase.from('check_in_services').select('id, service_name, price, original_price').eq('check_in_id', detailCheckIn.id);
    setDetailServices((data || []) as CheckInService[]);
    setAddServiceOpen(false);
  };

  const removeService = async (cisId: string) => {
    await supabase.from('check_in_services').delete().eq('id', cisId);
    setDetailServices((prev) => prev.filter((s) => s.id !== cisId));
  };

  const startEditPrice = (svc: CheckInService) => {
    setEditingServiceId(svc.id);
    setEditingPrice(svc.price.toLocaleString());
  };

  const saveEditPrice = async () => {
    if (!editingServiceId) return;
    const numPrice = parseInt(editingPrice.replace(/\D/g, ''), 10);
    if (isNaN(numPrice) || numPrice < 0) return;
    await supabase.from('check_in_services').update({ price: numPrice }).eq('id', editingServiceId);
    setDetailServices((prev) => prev.map((s) => s.id === editingServiceId ? { ...s, price: numPrice } : s));
    setEditingServiceId(null);
  };

  // --- Helpers ---
  // 최적화 #1: useMemo로 status별 미리 계산. checkIns 변경 시만 재계산.
  const columnMap = useMemo(() => {
    const map: Record<string, CheckIn[]> = {};
    const statuses = ['waiting', 'consultation', 'treatment_waiting', 'treatment', 'payment_waiting', 'done'];
    statuses.forEach(s => {
      map[s] = checkIns.filter(c => c.status === s)
        .sort((a, b) => (a.sort_order || a.queue_number) - (b.sort_order || b.queue_number));
    });
    return map;
  }, [checkIns]);
  const getColumnCheckIns = (status: string) => columnMap[status] || [];

  const reorderInColumn = (status: string, fromIdx: number, toIdx: number) => {
    const items = getColumnCheckIns(status);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const updates = reordered.map((c, i) => ({ ...c, sort_order: i }));
    setCheckIns(prev => {
      const others = prev.filter(c => c.status !== status);
      return [...others, ...updates];
    });
    updates.forEach(c => supabase.from('check_ins').update({ sort_order: c.sort_order } as any).eq('id', c.id).then(({ error }) => { if (error) console.error('sort_order update failed:', error.message); }));
  };
  const getRoomOccupant = (status: string, room: number) => checkIns.find((c) => c.status === status && c.room_number === room);
  const getRoomOccupants = (status: string, room: number) => checkIns.filter((c) => c.status === status && c.room_number === room).sort((a, b) => (a.checked_in_at || '').localeCompare(b.checked_in_at || ''));
  const getRoomStaff = (type: string, num: number) => {
    const ra = roomAssignments.find((r) => r.room_type === type && r.room_number === num);
    return ra?.staff as Staff | undefined;
  };

  // Estimate treatment end time from notes + service durations
  const getEstimatedEnd = (ci: CheckIn): string | null => {
    if (ci.status !== 'treatment') return null;
    const svcs = cardServices[ci.id] || [];
    if (svcs.length === 0) return null;
    // Total duration from matched services
    let totalMin = 0;
    svcs.forEach(sn => {
      const matched = allServices.find(s => s.name === sn);
      totalMin += matched?.duration_min || 30;
    });
    // Find treatment start from notes: last "[HH:mm] ... → 시술" entry
    const notes = ci.notes || '';
    const match = notes.match(/\[(\d{2}:\d{2})\].*→ 시술/g);
    if (!match) return null;
    const lastMatch = match[match.length - 1];
    const timeMatch = lastMatch.match(/\[(\d{2}):(\d{2})\]/);
    if (!timeMatch) return null;
    const startH = parseInt(timeMatch[1], 10);
    const startM = parseInt(timeMatch[2], 10);
    const endTotal = startH * 60 + startM + totalMin;
    const endH = Math.floor(endTotal / 60);
    const endM = endTotal % 60;
    return `~${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  };

  // Get services for card — 시술대기/시술에서만 표시, 결제대기/완료에서는 숨김
  const getCardServices = (ci: CheckIn): string[] => {
    if (ci.status === 'payment_waiting' || ci.status === 'done') return [];
    const svcs = cardServices[ci.id];
    if (svcs && svcs.length > 0) return svcs;
    if (ci.reservation_id) {
      const res = todayReservations.find(r => r.id === ci.reservation_id);
      if (res?.memo) return [res.memo];
    }
    return [];
  };

  // 최적화 #7: columnMap에서 직접 .length — getColumnCheckIns 추가 호출 제거
  const totalWaiting = (columnMap['waiting'] || []).length;
  const totalDone = (columnMap['done'] || []).length;
  const totalTreatmentWaiting = (columnMap['treatment_waiting'] || []).length;
  const totalPaymentWaiting = (columnMap['payment_waiting'] || []).length;
  const now = new Date();
  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const detailTotal = detailServices.reduce((s, sv) => s + sv.price, 0);

  return (
    <AdminLayout clinicName={clinicName} activeTab="queue">
      <div className="flex h-[calc(100vh-57px)]">
        {/* Mobile sidebar toggle */}
        <button
          className="md:hidden fixed bottom-4 left-4 z-40 bg-accent text-accent-foreground rounded-full w-12 h-12 shadow-lg flex items-center justify-center text-lg"
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        >{mobileSidebarOpen ? '\u2715' : '\u2630'}</button>

        {/* Left: Today's Reservations */}
        <div className={`w-56 shrink-0 border-r border-border bg-card overflow-hidden flex flex-col ${mobileSidebarOpen ? 'fixed inset-y-0 left-0 z-30 shadow-xl' : 'hidden'} md:relative md:flex`}>
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">오늘 예약</h3>
              <p className="text-xs text-muted-foreground">{todayReservations.filter(r => r.status !== 'cancelled').length}건</p>
            </div>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => navigate('/admin/reservations')}>관리</Button>
          </div>
          {/* 김태영 #4: 오늘예약 고객 검색 박스 */}
          <div className="px-2 py-1.5 border-b border-border">
            <Input ref={searchInputRef} placeholder="고객명/전화 검색 (Ctrl+F)" value={todaySearch} onChange={(e) => setTodaySearch(e.target.value)} className="h-7 text-xs" autoFocus />
          </div>
          <div className="flex-1 overflow-y-auto" id="reservation-timeline">
            {(() => {
              const q = todaySearch.trim().toLowerCase();
              const activeRes = todayReservations.filter(r => r.status !== 'cancelled').filter(r => !q || (r.customers?.name || '').toLowerCase().includes(q) || (r.customers?.phone || '').includes(q));
              // 김태영 #3: 30분 단위 표시 (기존 1시간 단위 → HH:MM 슬롯)
              const slotMap: Record<string, (typeof activeRes[0])[]> = {};
              activeRes.forEach(r => {
                const slot = r.reservation_time.slice(0, 5); // HH:MM
                if (!slotMap[slot]) slotMap[slot] = [];
                slotMap[slot].push(r);
              });
              const slots: string[] = [];
              for (let h = 10; h <= 21; h++) {
                slots.push(`${String(h).padStart(2, '0')}:00`);
                if (h < 21) slots.push(`${String(h).padStart(2, '0')}:30`);
              }
              const currentSlotKey = `${String(now.getHours()).padStart(2, '0')}:${now.getMinutes() < 30 ? '00' : '30'}`;

              return slots.filter(slot => {
                const slotRes = slotMap[slot] || [];
                return slotRes.length > 0 || (slot >= '10:00' && slot <= '20:30');
              }).map((slot) => {
                const slotRes = (slotMap[slot] || []).sort((a, b) => a.reservation_time.localeCompare(b.reservation_time));
                const isExpanded = expandedHour === slot;
                const isCurrent = slot === currentSlotKey;
                const resCount = slotRes.length;

                return (
                  <div key={slot}>
                    <button
                      onClick={() => setExpandedHour(isExpanded ? null : slot)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 border-b border-border/40 text-xs ${isCurrent ? 'bg-accent/10 font-bold' : 'hover:bg-muted/30'}`}
                    >
                      <span className={isCurrent ? 'text-accent' : ''}>{slot}</span>
                      <div className="flex items-center gap-1">
                        {resCount > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 rounded-full text-[10px]">{resCount}</span>}
                        <span className="text-[10px] text-muted-foreground">{isExpanded ? '▼' : '▶'}</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-2 py-1 space-y-1">
                        {slotRes.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground text-center py-2">예약 없음</p>
                        ) : slotRes.map((res) => {
                          const isPast = res.reservation_time.slice(0, 5) < currentTimeStr;
                          const isDelayed = res.status === 'reserved' && (() => {
                            const [rh, rm] = res.reservation_time.split(':').map(Number);
                            return Date.now() > new Date().setHours(rh, rm + 30, 0, 0);
                          })();
                          return (
                            <div key={res.id} className={`rounded px-1.5 py-1 flex flex-col ${
                              res.status === 'no_show' ? 'bg-red-50/50 border border-red-200 opacity-60' :
                              res.status === 'checked_in' ? 'bg-green-50 border border-green-200' :
                              isPast && res.status === 'reserved' ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'
                            }`}>
                              <div className="flex items-center justify-between cursor-pointer" onClick={() => openReservationDetail(res)}>
                                <span className={`text-[10px] font-medium truncate ${res.status === 'no_show' ? 'line-through text-red-400' : ''}`}>
                                  <span className="text-[9px] text-muted-foreground mr-1">{res.reservation_time.slice(0, 5)}</span>
                                  {res.customers?.name || '-'}
                                  {noShowCounts[res.customer_id] > 0 && <span className="text-red-500 ml-0.5 text-[9px]" title={`노쇼 ${noShowCounts[res.customer_id]}회`}>{'\u{1F534}'}{noShowCounts[res.customer_id]}</span>}
                                  {res.customers?.phone && <span className="text-[8px] text-muted-foreground ml-1">{maskPhone(res.customers.phone)}</span>}
                                </span>
                                <div className="flex items-center gap-0.5">
                                  {isDelayed && <span className="text-[9px] text-red-600 font-bold">지연</span>}
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${RES_STATUS_COLORS[res.status]}`}>{RES_STATUS_LABELS[res.status]}</span>
                                </div>
                              </div>
                              <p className="text-[9px] text-muted-foreground truncate cursor-pointer" onClick={() => openReservationDetail(res)}>
                                {res.referral_source && <span className="text-[8px] bg-muted px-1 rounded mr-1">{res.referral_source}</span>}
                                {res.memo || ''}
                              </p>
                              {res.status === 'reserved' && (
                                <div className="flex gap-1 mt-0.5">
                                  <Button size="sm" variant="outline" className="h-8 text-xs flex-1" onClick={() => handleReservationCheckIn(res)}>체크인</Button>
                                  <Button size="sm" variant="outline" className="h-8 text-xs text-red-500 border-red-200 hover:bg-red-50" onClick={async () => {
                                    setTodayReservations(prev => prev.map(r => r.id === res.id ? { ...r, status: 'no_show' } : r));
                                    await supabase.from('reservations').update({ status: 'no_show' }).eq('id', res.id);
                                    toast({ title: '노쇼 처리', description: res.customers?.name });
                                  }}>노쇼</Button>
                                </div>
                              )}
                              {res.status === 'checked_in' && (
                                <div className="mt-0.5">
                                  <Button size="sm" variant="outline" className="h-7 text-[10px] w-full text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => handleUndoCheckIn(res)}>체크인 취소</Button>
                                </div>
                              )}
                              {res.status === 'no_show' && (
                                <div className="mt-0.5">
                                  <Button size="sm" variant="outline" className="h-8 text-xs w-full text-blue-600 border-blue-200 hover:bg-blue-50" onClick={async () => {
                                    setTodayReservations(prev => prev.map(r => r.id === res.id ? { ...r, status: 'reserved' } : r));
                                    await supabase.from('reservations').update({ status: 'reserved' }).eq('id', res.id);
                                    toast({ title: '예약 복원', description: res.customers?.name });
                                  }}>복원</Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Right: Board */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Stats */}
          <div className="px-4 py-2 flex items-center gap-4 shrink-0 border-b border-border bg-card text-sm">
            <div className="flex items-center gap-1">
              <button onClick={() => setSelectedDate(subDays(selectedDate, 1))} className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground">&lt;</button>
              <span className={`text-xs font-medium ${isTodayFn(selectedDate) ? 'text-accent' : ''}`}>
                {isTodayFn(selectedDate) ? '오늘' : format(selectedDate, 'M/d (EEE)', { locale: ko })}
              </span>
              <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground">&gt;</button>
              {!isTodayFn(selectedDate) && <button onClick={() => setSelectedDate(new Date())} className="text-[10px] text-accent ml-1">오늘</button>}
            </div>
            <span>체크인 <b>{checkIns.length}</b></span>
            <span>대기 <b className="text-accent">{totalWaiting}</b></span>
            <span>시술대기 <b className="text-yellow-600">{totalTreatmentWaiting}</b></span>
            <span>결제대기 <b className="text-purple-600">{totalPaymentWaiting}</b></span>
            <span>완료 <b>{totalDone}</b></span>
          </div>
          {/* Read-only banner for past dates */}
          {!isToday && (
            <div className="px-4 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium shrink-0">
              과거 날짜 조회 중 — 읽기 전용
            </div>
          )}
          {/* Payment waiting banner */}
          {totalPaymentWaiting > 0 && (
            <div className="px-4 py-1.5 bg-purple-100 text-purple-800 text-xs font-medium cursor-pointer shrink-0 flex items-center gap-2"
              onClick={() => document.getElementById('payment-waiting-col')?.scrollIntoView({ behavior: 'smooth', inline: 'center' })}>
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
              결제대기 {totalPaymentWaiting}명
            </div>
          )}

          {/* KTY-MOBILE-PULL-REFRESH indicator */}
          {(pullDistance > 10 || pullRefreshing) && (
            <div className="flex items-center justify-center py-2 text-xs text-muted-foreground shrink-0 md:hidden" style={{ opacity: pullRefreshing ? 1 : Math.min(pullDistance / 60, 1) }}>
              {pullRefreshing ? '새로고침 중...' : pullDistance >= 60 ? '놓으면 새로고침' : '↓ 아래로 당기기'}
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div ref={dashboardRef} className="flex-1 overflow-auto p-3">
              <div className="flex flex-col md:flex-row gap-2 min-h-full items-start">

                {/* 대기 Column */}
                <div className="w-full md:w-40 shrink-0">
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      <span className="font-semibold text-xs">대기</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded-full">{totalWaiting}</span>
                    </div>
                    <DroppableZone id="waiting" className="p-1.5 min-h-[80px] max-h-[calc(100vh-220px)] overflow-y-auto">
                      <SortableContext items={getColumnCheckIns('waiting').map(c => c.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5">
                          {getColumnCheckIns('waiting').map((ci, idx, arr) => {
                            const st = ci.checked_in_at ? elapsedStr(ci.checked_in_at) : '';
                            return (
                              <div key={ci.id} className={idx === 0 && totalWaiting > 0 ? 'ring-2 ring-accent/40 rounded-lg' : ''}>
                                <DraggableCard isReturning={ci.customer_id ? returningCustomerIds.has(ci.customer_id) : undefined} checkIn={ci} compact onClick={() => openDetail(ci)} onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, id })} services={getCardServices(ci)} paid={!!dayPayments[ci.id]} stageTime={st}
                                  onMoveUp={idx > 0 ? () => reorderInColumn('waiting', idx, idx - 1) : undefined}
                                  onMoveDown={idx < arr.length - 1 ? () => reorderInColumn('waiting', idx, idx + 1) : undefined}
                                />
                              </div>
                            );
                          })}
                          {totalWaiting === 0 && <div className="text-center text-[10px] text-muted-foreground py-4">비어 있음</div>}
                        </div>
                      </SortableContext>
                    </DroppableZone>
                    {isToday && (
                      <div className="p-1.5 pt-0">
                        <Button variant="outline" size="sm" className="w-full border-dashed text-[10px] h-7" onClick={() => setManualOpen(true)}>+수동등록</Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 상담 Rooms (3실 세로) */}
                <div className="shrink-0">
                  <div className="mb-1 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="font-semibold text-xs">상담</span>
                    <span className="text-[10px] text-muted-foreground">{getColumnCheckIns('consultation').length}/{consultationRooms}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {Array.from({ length: consultationRooms }, (_, i) => i + 1).map((room) => {
                      const occupants = getRoomOccupants('consultation', room);
                      const hasOccupant = occupants.length > 0;
                      const staff = getRoomStaff('consultation', room);
                      const cInactive = !staff && !hasOccupant;
                      return (
                        <DroppableZone key={room} id={cInactive ? `inactive-c-${room}` : `consultation-${room}`}
                          className={`w-40 rounded-lg border transition-all ${cInactive ? 'bg-gray-100 border-gray-200 opacity-50 p-1' : hasOccupant ? 'border-blue-200 bg-blue-50/50 p-1.5' : 'border-dashed border-border/60 bg-muted/20 p-1'}`}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-[10px] font-medium cursor-pointer hover:underline ${cInactive ? 'text-gray-400' : hasOccupant ? 'text-blue-700' : 'text-muted-foreground/40'}`} onClick={(e) => { e.stopPropagation(); setAssignRoomModal({ type: 'consultation', number: room }); }}>{roomNames[`c${room}`] || `상담 ${room}`}</span>
                            <div className="flex items-center gap-1">
                              {staff ? <span className="text-[9px] text-blue-600 bg-blue-50 px-1 rounded cursor-pointer" onClick={(e) => { e.stopPropagation(); setAssignRoomModal({ type: 'consultation', number: room }); }}>{staff.name}</span> : <span className="text-[8px] text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setAssignRoomModal({ type: 'consultation', number: room }); }}>+배정</span>}
                              {hasOccupant && <span className="text-[9px] text-blue-500">{occupants.length}/2</span>}
                            </div>
                          </div>
                          {hasOccupant && (
                            <div className="space-y-1">
                              {occupants.map((occ, idx) => (
                                <div key={occ.id} className={idx === 0 ? '' : 'opacity-60'}>
                                  <DraggableCard isReturning={occ.customer_id ? returningCustomerIds.has(occ.customer_id) : undefined} checkIn={occ} compact onClick={() => openDetail(occ)} onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, id })} services={getCardServices(occ)} paid={!!dayPayments[occ.id]} />
                                </div>
                              ))}
                            </div>
                          )}
                        </DroppableZone>
                      );
                    })}
                  </div>
                </div>

                {/* 시술대기 Column */}
                <div className="w-full md:w-40 shrink-0">
                  <div className="bg-card rounded-xl border border-yellow-200 overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-yellow-400" />
                      <span className="font-semibold text-xs">시술대기</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded-full">{totalTreatmentWaiting}</span>
                    </div>
                    <DroppableZone id="treatment_waiting" className="p-1.5 min-h-[80px] max-h-[calc(100vh-220px)] overflow-y-auto">
                      <SortableContext items={getColumnCheckIns('treatment_waiting').map(c => c.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5">
                          {getColumnCheckIns('treatment_waiting').map((ci, idx, arr) => {
                            const st = ci.checked_in_at ? elapsedStr(ci.checked_in_at) : '';
                            return (
                              <div key={ci.id} className={idx === 0 && totalTreatmentWaiting > 0 ? 'ring-2 ring-green-400/40 rounded-lg' : ''}>
                                <DraggableCard isReturning={ci.customer_id ? returningCustomerIds.has(ci.customer_id) : undefined} checkIn={ci} compact onClick={() => openDetail(ci)} onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, id })} services={getCardServices(ci)} paid={!!dayPayments[ci.id]} stageTime={st}
                                  onMoveUp={idx > 0 ? () => reorderInColumn('treatment_waiting', idx, idx - 1) : undefined}
                                  onMoveDown={idx < arr.length - 1 ? () => reorderInColumn('treatment_waiting', idx, idx + 1) : undefined}
                                />
                              </div>
                            );
                          })}
                          {totalTreatmentWaiting === 0 && <div className="text-center text-[10px] text-muted-foreground py-4">비어 있음</div>}
                        </div>
                      </SortableContext>
                    </DroppableZone>
                  </div>
                </div>

                {/* 시술 Rooms (15실, 5x3 compact) */}
                <div className="shrink-0">
                  <div className="mb-1 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="font-semibold text-xs">시술</span>
                    <span className="text-[10px] text-muted-foreground">{getColumnCheckIns('treatment').length}/{treatmentRooms}</span>
                    <button
                      className={`text-[10px] ml-auto px-1.5 py-0.5 rounded ${selectedRoom ? 'bg-green-100 text-green-700' : 'text-muted-foreground hover:bg-muted'}`}
                      onClick={() => {
                        const next = selectedRoom ? null : 1;
                        setSelectedRoom(next);
                        if (next) localStorage.setItem('obliv_selected_room', String(next));
                        else localStorage.removeItem('obliv_selected_room');
                      }}
                    >{selectedRoom ? `${selectedRoom}번만` : '내 방'}</button>
                  </div>
                  {selectedRoom && (
                    <div className="mb-1 flex gap-0.5 flex-wrap">
                      {Array.from({ length: treatmentRooms }, (_, i) => i + 1).map(r => (
                        <button key={r} onClick={() => { setSelectedRoom(r); localStorage.setItem('obliv_selected_room', String(r)); }}
                          className={`text-[9px] w-5 h-5 rounded ${r === selectedRoom ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground hover:bg-green-100'}`}>{r}</button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1">
                    {(() => {
                      // Find recommended empty room (first with staff assigned, else first empty)
                      const emptyRooms = Array.from({ length: treatmentRooms }, (_, i) => i + 1)
                        .filter(r => getRoomOccupants('treatment', r).length === 0);
                      const staffedEmpty = emptyRooms.find(r => getRoomStaff('treatment', r));
                      const recommendedRoom = staffedEmpty || emptyRooms[0] || null;
                      return Array.from({ length: treatmentRooms }, (_, i) => i + 1).map((room) => {
                      const occupants = getRoomOccupants('treatment', room);
                      const hasOccupant = occupants.length > 0;
                      const tStaff = getRoomStaff('treatment', room);
                      const isRecommended = room === recommendedRoom;
                      const isDimmed = selectedRoom !== null && room !== selectedRoom;
                      const isInactive = !tStaff && !hasOccupant; // 선생님 미배정 + 환자 없음 = 운영불가
                      return (
                        <DroppableZone key={room} id={isInactive ? `inactive-t-${room}` : `treatment-${room}`}
                          className={`rounded-lg border transition-all w-32 ${isDimmed ? 'opacity-30' : ''} ${isInactive ? 'bg-gray-100 border-gray-200 opacity-50 p-0.5' : hasOccupant ? 'border-green-200 bg-green-50/50 p-1.5' : isRecommended ? 'border-green-300 bg-green-50 p-0.5 ring-1 ring-green-300' : 'border-dashed border-green-200/60 bg-green-50/20 p-0.5'}`}>
                          <div className={`text-[10px] font-medium ${isInactive ? 'text-gray-400 text-center' : hasOccupant ? 'text-green-700 mb-0.5' : isRecommended ? 'text-green-600 text-center' : 'text-green-400/60 text-center'}`}>
                            {/* T-W2-05: 방 이름 클릭 → 통계 + 고객 정보 모달 */}
                            <span className="cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); setRoomStatsModal({ type: 'treatment', number: room }); }}>
                              {roomNames[`t${room}`] || `시술${room}`}
                            </span>
                            {tStaff
                              ? <span className="text-[9px] text-green-600 bg-green-50 px-1 rounded ml-1 cursor-pointer" onClick={(e) => { e.stopPropagation(); setAssignRoomModal({ type: 'treatment', number: room }); }}>{tStaff.name}</span>
                              : <span className="text-[8px] text-muted-foreground ml-1 cursor-pointer" onClick={(e) => { e.stopPropagation(); setAssignRoomModal({ type: 'treatment', number: room }); }}>+</span>}
                            {isInactive && !tStaff && <span className="text-[8px] text-gray-400 ml-1">미배정</span>}
                            {hasOccupant && <span className="text-[9px] text-green-500 ml-1">{occupants.length}/2</span>}
                            {isRecommended && !hasOccupant && !isInactive && <span className="text-[8px] text-green-600 ml-1">추천</span>}
                          </div>
                          {hasOccupant ? (
                            <div className="space-y-1">
                              {occupants.map((occ, idx) => {
                                const estEnd = getEstimatedEnd(occ);
                                return (
                                  <div key={occ.id} className={idx === 0 ? '' : 'opacity-60'}>
                                    <DraggableCard isReturning={occ.customer_id ? returningCustomerIds.has(occ.customer_id) : undefined} checkIn={occ} compact onClick={() => openDetail(occ)} onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, id })} services={getCardServices(occ)} paid={!!dayPayments[occ.id]} />
                                    {estEnd && <p className="text-[9px] text-green-600 text-center -mt-0.5">{estEnd} 종료 예정</p>}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </DroppableZone>
                      );
                    });
                    })()}
                  </div>
                </div>

                {/* 결제대기 Column */}
                <div className="w-full md:w-40 shrink-0" id="payment-waiting-col">
                  <div className="bg-card rounded-xl border border-purple-200 overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-purple-500" />
                      <span className="font-semibold text-xs">결제대기</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded-full">{totalPaymentWaiting}</span>
                    </div>
                    <DroppableZone id="payment_waiting" className="p-1.5 min-h-[80px] max-h-[calc(100vh-220px)] overflow-y-auto">
                      <div className="space-y-1.5">
                        {getColumnCheckIns('payment_waiting').map((ci) => {
                          const prePaid = dayPayments[ci.id]?.amount || 0;
                          return (
                            <div key={ci.id}>
                              <DraggableCard isReturning={ci.customer_id ? returningCustomerIds.has(ci.customer_id) : undefined} checkIn={ci} compact onClick={() => openDetail(ci)} onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, id })} services={getCardServices(ci)} paid={prePaid > 0} />
                              {prePaid > 0 && <div className="text-[9px] text-center text-orange-600 -mt-0.5">선결제 {(prePaid / 10000).toFixed(0)}만</div>}
                            </div>
                          );
                        })}
                        {totalPaymentWaiting === 0 && <div className="text-center text-[10px] text-muted-foreground py-4">비어 있음</div>}
                      </div>
                    </DroppableZone>
                  </div>
                </div>

                {/* 완료 Column */}
                <div className="w-full md:w-40 shrink-0">
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="px-2 py-1.5 border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-gray-300" />
                        <span className="font-semibold text-xs">완료</span>
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded-full">{totalDone}</span>
                      </div>
                      <button onClick={() => setShowDoneColumn(!showDoneColumn)} className="text-[10px] text-accent">{showDoneColumn ? '접기' : '펼치기'}</button>
                    </div>
                    <DroppableZone id="done" className="p-1.5 min-h-[40px]">
                      {showDoneColumn ? (
                        <div className="space-y-1 max-h-[calc(100vh-240px)] overflow-y-auto">
                          {getColumnCheckIns('done').map((ci) => {
                            const pay = dayPayments[ci.id];
                            return (
                              <div key={ci.id} className="bg-muted/50 rounded px-2 py-1.5 text-[10px] cursor-pointer hover:bg-muted" onClick={() => openDetail(ci)}>
                                <div className="flex justify-between items-center">
                                  <span>
                                    <span className="font-medium">{formatQueueNumber(ci.queue_number)}</span>
                                    <span className="ml-1 text-muted-foreground">{ci.customer_name}</span>
                                  </span>
                                  {pay ? (
                                    <span className={`font-medium ${pay.method === 'card' ? 'text-blue-600' : pay.method === 'transfer' ? 'text-purple-600' : 'text-green-600'}`}>
                                      {pay.method === 'card' ? '💳' : pay.method === 'transfer' ? '🏦' : '💵'} {(pay.amount / 10000).toFixed(0)}만
                                    </span>
                                  ) : (
                                    <span className="text-orange-500">미결제</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {/* Daily total */}
                          {Object.keys(dayPayments).length > 0 && (
                            <div className="border-t border-border mt-1 pt-1 px-1 flex justify-between text-[10px] font-semibold">
                              <span>당일 합계</span>
                              <span>{Object.values(dayPayments).reduce((s, p) => s + p.amount, 0).toLocaleString()}원</span>
                            </div>
                          )}
                        </div>
                      ) : totalDone > 0 ? (
                        <div className="text-center text-[10px] text-muted-foreground py-2">
                          {totalDone}명 · {Object.values(dayPayments).reduce((s, p) => s + p.amount, 0).toLocaleString()}원
                        </div>
                      ) : null}
                    </DroppableZone>
                  </div>
                </div>
              </div>
            </div>
            <DragOverlay>{activeCheckIn ? <CardPreview checkIn={activeCheckIn} /> : null}</DragOverlay>
          </DndContext>

          {/* KTY-DASHBOARD-DROP-TABS: 노쇼/이탈 건 */}
          {droppedCIs.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowDropped(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1">
                <span>{showDropped ? '▼' : '▶'}</span>
                <span>노쇼/이탈 ({droppedCIs.length}건)</span>
              </button>
              {showDropped && (
                <div className="grid grid-cols-3 gap-2 mt-1 px-1">
                  {(['no_show', 'abandoned', 'consult_left'] as const).map(st => {
                    const items = droppedCIs.filter(c => c.status === st);
                    const label = st === 'no_show' ? '노쇼' : st === 'abandoned' ? '대기이탈' : '상담이탈';
                    const color = st === 'no_show' ? 'bg-red-50 border-red-200' : st === 'abandoned' ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-200';
                    return (
                      <div key={st} className={`rounded-lg border p-2 ${color}`}>
                        <h4 className="text-[10px] font-semibold text-muted-foreground mb-1">{label} ({items.length})</h4>
                        <div className="space-y-1">
                          {items.map(ci => (
                            <div key={ci.id} className="text-xs cursor-pointer hover:underline" onClick={() => openDetail(ci)}>
                              {formatQueueNumber(ci.queue_number)} {ci.customer_name}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
        const ctxCI = checkIns.find(c => c.id === contextMenu.id);
        return (
          <div className="fixed bg-card border border-border rounded-lg shadow-lg py-1 z-50" style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 180) }}>
            <button onClick={() => { if (ctxCI) openDetail(ctxCI); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-muted">고객 상세</button>
            {ctxCI && ctxCI.status !== 'waiting' && (() => {
              const prevMap: Record<string, CheckIn['status']> = {
                consultation: 'waiting',
                treatment_waiting: 'consultation',
                treatment: 'treatment_waiting',
                payment_waiting: 'treatment',
                done: 'payment_waiting',
                no_show: 'waiting',
                abandoned: 'waiting',
                consult_left: 'consultation',
              };
              const prev = prevMap[ctxCI.status];
              if (!prev) return null;
              const prevLabel = STATUS_KO[prev] || prev;
              return (
                <>
                  <button onClick={() => { updateStatus(contextMenu.id, prev); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-muted">← 이전 단계로 ({prevLabel})</button>
                  <button onClick={() => { updateStatus(contextMenu.id, 'waiting'); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-muted text-muted-foreground">처음 대기로 리셋</button>
                </>
              );
            })()}
            {ctxCI && ctxCI.status !== 'done' && (
              <button onClick={() => { updateStatus(contextMenu.id, 'done'); setContextMenu(null); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-muted">완료 처리</button>
            )}
            {ctxCI && ctxCI.status !== 'no_show' && (
              <button onClick={() => handleNoShow(contextMenu.id)} className="block w-full text-left px-4 py-2 text-sm text-destructive hover:bg-muted">노쇼 처리</button>
            )}
            {ctxCI && ctxCI.status === 'waiting' && (
              <button onClick={() => handleAbandoned(contextMenu.id)} className="block w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-muted">대기후이탈 (상담 전 이탈)</button>
            )}
            {ctxCI && (ctxCI.status === 'consultation' || ctxCI.status === 'treatment_waiting' || ctxCI.status === 'treatment') && (
              <button onClick={() => handleConsultLeft(contextMenu.id)} className="block w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-muted">상담후이탈 (시술 거부)</button>
            )}
            {/* 김태영 #8: 완료 상태에서도 체크인 삭제 가능 (테스트 데이터 정리용) */}
            {ctxCI && (
              <button onClick={async () => {
                if (!confirm(`'${ctxCI.customer_name || '고객'}' 체크인 기록을 삭제하시겠습니까?\n(결제 기록·시술 사진도 함께 삭제됩니다)`)) { setContextMenu(null); return; }
                const { data: files } = await storageClient.storage.from('treatment-photos').list(contextMenu.id);
                if (files && files.length > 0) {
                  await storageClient.storage.from('treatment-photos').remove(files.map(f => `${contextMenu.id}/${f.name}`));
                }
                const { error } = await supabase.from('check_ins').delete().eq('id', contextMenu.id);
                if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); }
                else { setCheckIns(prev => prev.filter(c => c.id !== contextMenu.id)); toast({ title: '삭제 완료' }); }
                setContextMenu(null);
              }} className="block w-full text-left px-4 py-2 text-sm text-destructive hover:bg-muted border-t border-border">체크인 삭제</button>
            )}
          </div>
        );
      })()}

      {/* Manual Register */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>수동 등록</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">이름</label><Input value={manualName} onChange={(e) => setManualName(e.target.value)} /></div>
            <div>
              <label className="block text-sm font-medium mb-1">전화번호</label>
              <div className="flex gap-2">
                <select value={manualCountryCode} onChange={(e) => setManualCountryCode(e.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                  {COUNTRY_CODES.map((cc) => (<option key={cc.code} value={cc.code}>{cc.label}</option>))}
                </select>
                <Input value={manualPhone} onChange={(e) => {
                  let v = e.target.value.replace(/[^0-9]/g, '');
                  if (manualCountryCode === '+82' && v.length > 0) {
                    if (!v.startsWith('0')) v = '0' + v;
                    if (v.length >= 4) v = v.slice(0, 3) + '-' + v.slice(3);
                    if (v.length >= 9) v = v.slice(0, 8) + '-' + v.slice(8);
                    if (v.length > 13) v = v.slice(0, 13);
                  }
                  setManualPhone(v);
                }} className="flex-1" type="tel" placeholder={manualCountryCode === '+82' ? '010-0000-0000' : ''} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">주민등록번호</label>
              <Input value={manualResidentId} onChange={(e) => {
                let v = e.target.value.replace(/[^0-9]/g, '');
                if (v.length > 6) v = v.slice(0, 6) + '-' + v.slice(6);
                if (v.length > 14) v = v.slice(0, 14);
                setManualResidentId(v);
              }} placeholder="000000-0000000" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">유입경로</label>
              <div className="flex flex-wrap gap-1.5">
                {['네이버 검색', '인스타그램', '지인 소개', '네이버 블로그', '유튜브', '네이버 지도', '기타'].map((src) => (
                  <button key={src} type="button" onClick={() => setManualReferral(src)}
                    className={`h-7 px-2 rounded-lg border text-xs font-medium transition-colors ${manualReferral === src ? 'border-accent bg-accent/10 text-accent' : 'border-input bg-background hover:bg-muted'}`}>
                    {src}
                  </button>
                ))}
              </div>
            </div>
            {/* 김태영 #9: 예약 동시 생성 */}
            <div className="border-t pt-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="h-4 w-4 rounded accent-current" checked={manualCreateReservation}
                  onChange={e => {
                    setManualCreateReservation(e.target.checked);
                    if (e.target.checked) {
                      setManualResDate(format(new Date(), 'yyyy-MM-dd'));
                      const now = new Date();
                      const nextMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
                      const h = Math.floor(nextMin / 60) % 24;
                      const m = nextMin % 60;
                      setManualResTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                    }
                  }} />
                <span className="text-sm font-medium">예약도 같이 등록</span>
              </label>
              {manualCreateReservation && (
                <div className="flex gap-2">
                  <Input type="date" value={manualResDate} min={format(new Date(), 'yyyy-MM-dd')}
                    onChange={e => setManualResDate(e.target.value)} className="flex-1 text-sm" />
                  <select value={manualResTime} onChange={e => setManualResTime(e.target.value)}
                    className="h-10 rounded-lg border border-input bg-background px-2 text-sm w-24">
                    {Array.from({ length: 25 }, (_, i) => {
                      const totalMin = 540 + i * 30; // 09:00 ~ 21:00
                      const h = Math.floor(totalMin / 60);
                      const m = totalMin % 60;
                      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    }).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
            <Button className="w-full bg-accent text-accent-foreground" onClick={handleManualRegister} disabled={!manualName.trim() || !manualPhone.trim() || manualSubmitting}>{manualSubmitting ? '등록 중...' : '등록'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Modal */}
      <PaymentModal open={!!paymentTarget} customerName={paymentTarget?.customer_name || ''} suggestedAmount={paymentTarget ? (Object.values(cardServices[paymentTarget.id] || []).length > 0 ? detailTotal : undefined) : undefined} services={paymentTarget ? detailServices.map(s => ({ name: s.service_name, price: s.price })) : undefined} onSkip={handlePaymentSkip} onComplete={handlePaymentComplete} />
      <PaymentModal open={detailPaymentOpen} customerName={detailCheckIn?.customer_name || ''} suggestedAmount={detailTotal > 0 ? detailTotal : undefined} services={detailServices.map(s => ({ name: s.service_name, price: s.price }))} onSkip={handlePaymentSkipForDetail} onComplete={handlePaymentComplete} />

      {/* Customer Detail Sheet */}
      <Sheet open={!!detailCheckIn} onOpenChange={(v) => { if (!v) setDetailCheckIn(null); }}>
        <SheetContent className="w-[420px] sm:w-[420px] overflow-y-auto">
          <SheetHeader><SheetTitle>고객 상세</SheetTitle></SheetHeader>
          {detailCheckIn && (
            <div className="mt-4 space-y-5">
              {/* Basic Info + KTY-CUST-EDIT-EVERYWHERE */}
              <div>
                {custEditMode ? (
                  <div className="space-y-2">
                    <Input value={custEditName} onChange={e => setCustEditName(e.target.value)} placeholder="이름" className="text-sm h-8" />
                    <Input value={custEditPhone} onChange={e => setCustEditPhone(e.target.value)} placeholder="전화번호" className="text-sm h-8" />
                    <Textarea value={custEditMemo} onChange={e => setCustEditMemo(e.target.value)} rows={2} placeholder="메모" className="text-sm" />
                    <div className="flex gap-1">
                      <Button size="sm" className="flex-1" onClick={async () => {
                        if (!detailCheckIn.customer_id) return;
                        const { error } = await supabase.from('customers').update({ name: custEditName.trim(), phone: custEditPhone.trim(), memo: custEditMemo || null } as any).eq('id', detailCheckIn.customer_id);
                        if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
                        setCheckIns(prev => prev.map(c => c.id === detailCheckIn.id ? { ...c, customer_name: custEditName.trim(), customer_phone: custEditPhone.trim() } : c));
                        setDetailCheckIn({ ...detailCheckIn, customer_name: custEditName.trim(), customer_phone: custEditPhone.trim() });
                        setCustEditMode(false);
                        toast({ title: '고객 정보 수정 완료' });
                      }}>저장</Button>
                      <Button size="sm" variant="outline" onClick={() => setCustEditMode(false)}>취소</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{detailCheckIn.customer_name}</h3>
                      {detailCheckIn.customer_id && (
                        <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground" onClick={() => {
                          setCustEditName(detailCheckIn.customer_name || '');
                          setCustEditPhone(detailCheckIn.customer_phone || '');
                          setCustEditMemo('');
                          setCustEditMode(true);
                        }}>수정</Button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{detailCheckIn.customer_phone}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {formatQueueNumber(detailCheckIn.queue_number)} · 체크인 {detailCheckIn.checked_in_at ? format(new Date(detailCheckIn.checked_in_at), 'HH:mm') : '-'}
                      {detailCheckIn.checked_in_at && <span className="text-orange-500 ml-2">({elapsedStr(detailCheckIn.checked_in_at)} 경과)</span>}
                    </p>
                    {/* T-20260416-crm-RESV-TYPE-DISPLAY: 예약 유형 라디오 인디케이터 */}
                    {(() => {
                      if (!detailCheckIn.reservation_id) return null;
                      const linkedRes = todayReservations.find(r => r.id === detailCheckIn.reservation_id);
                      if (!linkedRes?.reservation_type) return null;
                      const types = ['신규', '리터치', '시술예약', '기타'] as const;
                      const colorMap: Record<string, string> = {
                        '신규': 'bg-violet-500 border-violet-500 text-white',
                        '리터치': 'bg-cyan-500 border-cyan-500 text-white',
                        '시술예약': 'bg-green-500 border-green-500 text-white',
                        '기타': 'bg-muted-foreground border-muted-foreground text-white',
                      };
                      return (
                        <div className="flex gap-1 mt-1.5">
                          {types.map(t => {
                            const active = linkedRes.reservation_type === t;
                            return (
                              <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${active ? colorMap[t] : 'border-border text-muted-foreground/40'}`}>
                                {t === '기타' && active && linkedRes.reservation_type_etc ? `기타(${linkedRes.reservation_type_etc})` : t}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* 담당자 */}
              {(detailCheckIn.created_by || detailCheckIn.consultant_id || detailCheckIn.technician_id) && (
                <div className="bg-muted/30 rounded-lg px-3 py-2 text-sm space-y-0.5">
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1">담당</h4>
                  {detailCheckIn.created_by && <p className="text-xs">TM: <span className="font-medium">{detailCheckIn.created_by}</span></p>}
                  {detailCheckIn.consultant_id && (() => {
                    const s = staffList.find(st => st.id === detailCheckIn.consultant_id);
                    return s ? <p className="text-xs">상담: <span className="font-medium">{s.name}</span></p> : null;
                  })()}
                  {detailCheckIn.technician_id && (() => {
                    const s = staffList.find(st => st.id === detailCheckIn.technician_id);
                    return s ? <p className="text-xs">시술: <span className="font-medium">{s.name}</span></p> : null;
                  })()}
                </div>
              )}

              {/* Priority Flag (CP / #) */}
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground shrink-0">우선표시</span>
                {(['CP', '#'] as const).map(flag => {
                  const active = detailCheckIn.priority_flag === flag;
                  const label = flag === 'CP' ? 'CP' : '#';
                  const activeCls = flag === 'CP' ? 'bg-red-600 text-white border-red-600' : 'bg-orange-500 text-white border-orange-500';
                  return (
                    <button key={flag} type="button"
                      className={`text-xs px-2 py-1 rounded border ${active ? activeCls : 'bg-background text-foreground border-input hover:bg-muted'}`}
                      onClick={async () => {
                        const next = active ? null : flag;
                        const { error } = await supabase.from('check_ins').update({ priority_flag: next } as any).eq('id', detailCheckIn.id);
                        if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
                        setCheckIns(prev => prev.map(c => c.id === detailCheckIn.id ? { ...c, priority_flag: next } : c));
                        setDetailCheckIn({ ...detailCheckIn, priority_flag: next });
                      }}>{label}</button>
                  );
                })}
              </div>

              {/* Status Change */}
              {isToday && detailCheckIn.status !== 'done' && (
                <div className="flex gap-2">
                  {detailCheckIn.status === 'waiting' && <Button size="sm" className="flex-1 text-xs bg-blue-500 text-white hover:bg-blue-600" onClick={() => { updateStatus(detailCheckIn.id, 'consultation', 1); setDetailCheckIn({...detailCheckIn, status: 'consultation'}); }}>→ 상담</Button>}
                  {detailCheckIn.status === 'consultation' && <Button size="sm" className="flex-1 text-xs bg-yellow-500 text-white hover:bg-yellow-600" onClick={() => { updateStatus(detailCheckIn.id, 'treatment_waiting'); setDetailCheckIn({...detailCheckIn, status: 'treatment_waiting'}); }}>→ 시술대기</Button>}
                  {detailCheckIn.status === 'treatment_waiting' && <Button size="sm" className="flex-1 text-xs bg-green-500 text-white hover:bg-green-600" onClick={() => { updateStatus(detailCheckIn.id, 'treatment', 1); setDetailCheckIn({...detailCheckIn, status: 'treatment'}); }}>→ 시술</Button>}
                  {detailCheckIn.status === 'treatment' && <Button size="sm" className="flex-1 text-xs bg-purple-500 text-white hover:bg-purple-600" onClick={() => { updateStatus(detailCheckIn.id, 'payment_waiting'); setDetailCheckIn({...detailCheckIn, status: 'payment_waiting'}); }}>시술완료(→결제대기)</Button>}
                  {detailCheckIn.status === 'treatment' && dayPayments[detailCheckIn.id] && <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => { updateStatus(detailCheckIn.id, 'done'); setDetailCheckIn({...detailCheckIn, status: 'done'}); }}>→ 완료(선결제)</Button>}
                  {detailCheckIn.status === 'payment_waiting' && <Button size="sm" className="flex-1 text-xs bg-accent text-accent-foreground" onClick={() => { setDetailPaymentOpen(true); }}>결제 처리</Button>}
                  {detailCheckIn.status !== 'waiting' && (() => {
                    const prevMap: Record<string, CheckIn['status']> = {
                      consultation: 'waiting',
                      treatment_waiting: 'consultation',
                      treatment: 'treatment_waiting',
                      payment_waiting: 'treatment',
                      done: 'payment_waiting',
                      no_show: 'waiting',
                      abandoned: 'waiting',
                      consult_left: 'consultation',
                    };
                    const prev = prevMap[detailCheckIn.status];
                    if (!prev) return null;
                    const prevLabel = STATUS_KO[prev] || prev;
                    return (
                      <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => { updateStatus(detailCheckIn.id, prev); setDetailCheckIn({...detailCheckIn, status: prev}); }}>← {prevLabel}</Button>
                    );
                  })()}
                </div>
              )}

              {/* 김태영 #13: 마취 리도/울 분리 */}
              <div className="space-y-2">
                <p className="text-sm font-medium">마취크림 도포</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['lidocaine_at', 'ultracaine_at'] as const).map((field) => {
                    const label = field === 'lidocaine_at' ? '리도' : '울';
                    const val = detailCheckIn[field] as string | null | undefined;
                    return (
                      <button
                        key={field}
                        type="button"
                        className={`rounded-lg px-3 py-2.5 text-left border transition-colors ${val ? 'bg-purple-50 border-purple-200' : 'bg-muted/30 border-transparent hover:bg-muted/50'}`}
                        onClick={async () => {
                          const newVal = val ? null : new Date().toISOString();
                          const patch: any = { [field]: newVal };
                          // anesthesia_at은 리도·울 중 먼저 찍힌 시각으로 동기화 (하위 호환)
                          const otherField = field === 'lidocaine_at' ? 'ultracaine_at' : 'lidocaine_at';
                          const otherVal = detailCheckIn[otherField] as string | null | undefined;
                          const earliest = [newVal, otherVal].filter(Boolean).sort()[0] || null;
                          patch.anesthesia_at = earliest;
                          await supabase.from('check_ins').update(patch).eq('id', detailCheckIn.id);
                          const updated = { ...detailCheckIn, ...patch } as CheckIn;
                          setDetailCheckIn(updated);
                          setCheckIns((prev) => prev.map((c) => c.id === detailCheckIn.id ? updated : c));
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-4 w-4 rounded border flex items-center justify-center ${val ? 'bg-purple-500 border-purple-500 text-white' : 'border-muted-foreground/40'}`}>
                            {val && <Check className="h-3 w-3" />}
                          </span>
                          <span className="text-sm font-medium">{label}</span>
                        </div>
                        {val ? (
                          <p className="text-[11px] text-purple-600 mt-1">
                            {format(new Date(val), 'HH:mm')} · +{Math.floor((Date.now() - new Date(val).getTime()) / 60000)}분
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground mt-1">클릭 시 기록</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Services */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">시술 항목</h4>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddServiceOpen(true)}>+ 추가</Button>
                </div>
                {detailServices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">선택된 시술 없음</p>
                ) : (
                  <div className="space-y-1">
                    {detailServices.map((s) => {
                      const hasDiscount = s.original_price && s.original_price > s.price;
                      return (
                        <div key={s.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                          <span className="text-sm">{s.service_name}</span>
                          <div className="flex items-center gap-2">
                            {editingServiceId === s.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  value={editingPrice}
                                  onChange={(e) => setEditingPrice(e.target.value.replace(/\D/g, '') ? parseInt(e.target.value.replace(/\D/g, ''), 10).toLocaleString() : '')}
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveEditPrice(); if (e.key === 'Escape') setEditingServiceId(null); }}
                                  autoFocus
                                  className="w-24 h-7 text-sm text-right border border-input rounded px-2"
                                />
                                <span className="text-xs text-muted-foreground">원</span>
                                <button onClick={saveEditPrice} className="text-xs text-accent">확인</button>
                              </div>
                            ) : (
                              <button onClick={() => startEditPrice(s)} className="hover:text-accent cursor-pointer" title="클릭하여 가격 수정">
                                {hasDiscount && <span className="text-xs text-muted-foreground line-through mr-1">{s.original_price!.toLocaleString()}</span>}
                                <span className={`text-sm font-medium ${hasDiscount ? 'text-red-500' : ''}`}>{s.price.toLocaleString()}원</span>
                              </button>
                            )}
                            <button onClick={() => removeService(s.id)} className="text-xs text-destructive hover:underline">삭제</button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-between px-3 py-2 font-semibold text-sm border-t border-border mt-2">
                      <span>합계</span>
                      <span>{detailTotal.toLocaleString()}원</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 김태영 요청 2026-04-13: 단계별 메모 배치 — 시술선택 바로 아래 */}
              {/* 상담 단계 / 시술대기(김태영 #C, 2026-04-15): 상담메모를 시술메모 위로 */}
              {(detailCheckIn.status === 'waiting' || detailCheckIn.status === 'consultation' || detailCheckIn.status === 'treatment_waiting') && detailCheckIn.customer_id && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-blue-600">상담 메모 (날짜별)</h4>
                  <Textarea value={consultNoteToday} onChange={(e) => setConsultNoteToday(e.target.value)} rows={4} className="text-sm border-blue-200 focus:border-blue-400" placeholder="오늘 상담 내용 기록..." />
                  <Button size="sm" variant="outline" className="mt-1 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={async () => {
                    if (!detailCheckIn?.customer_id) return;
                    const todayStr = format(selectedDate, 'yyyy-MM-dd');
                    const { data: upserted, error } = await (supabase.from('consultation_notes') as any).upsert({
                      id: consultNoteId ?? undefined,
                      customer_id: detailCheckIn.customer_id,
                      clinic_id: clinicId,
                      note_date: todayStr,
                      content: consultNoteToday,
                      created_by: currentUserEmail,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'customer_id,clinic_id,note_date' }).select('id').single();
                    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
                    if (upserted?.id) setConsultNoteId(upserted.id);
                    const { data: history } = await supabase.from('consultation_notes').select('note_date, content').eq('customer_id', detailCheckIn.customer_id).order('note_date', { ascending: false }).limit(30);
                    if (history) setConsultNoteHistory(history as any);
                    toast({ title: '상담 메모 저장' });
                  }}>상담 메모 저장</Button>
                </div>
              )}
              {/* 시술 단계: 시술메모 구조화 + 사진 첨부 (김태영 요청 2026-04-13 22:26) */}
              {/* 2026-04-15: 결제대기·완료 상태에서도 시술 메모 영역 노출 유지 (김사장님 19:20 "화면에 사라져") */}
              {(detailCheckIn.status === 'treatment_waiting' || detailCheckIn.status === 'treatment' || detailCheckIn.status === 'payment_waiting' || detailCheckIn.status === 'done') && (() => {
                const tmStatusLocked = detailCheckIn.status === 'done' || detailCheckIn.status === 'payment_waiting';
                const tmReadOnly = tmStatusLocked && !tmEditOverride;
                return (
                <div className="space-y-2 border border-green-200 rounded-lg p-3 bg-green-50/30">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-green-700">시술 메모{tmReadOnly ? ' (저장됨)' : tmEditOverride ? ' (수정 중)' : ''}</h4>
                    {tmStatusLocked && (
                      <button type="button" onClick={() => setTmEditOverride(v => !v)}
                        className={`text-[10px] px-2 py-0.5 rounded border ${tmEditOverride ? 'bg-orange-500 text-white border-orange-500' : 'bg-white border-border text-muted-foreground hover:bg-muted'}`}>
                        {tmEditOverride ? '수정 취소' : '수정'}
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">시술자</label>
                    <Input value={tmPerformer} onChange={(e) => setTmPerformer(e.target.value)} placeholder="이름 직접 입력" className="text-sm h-8" disabled={tmReadOnly} />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">시술 내역</label>
                    <Textarea value={tmDetails} onChange={(e) => setTmDetails(e.target.value)} rows={2} placeholder="기법·기록 (직접 입력)" className="text-sm" disabled={tmReadOnly} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="tm-up" checked={tmUpselling} onChange={(e) => setTmUpselling(e.target.checked)} className="h-4 w-4" disabled={tmReadOnly} />
                    <label htmlFor="tm-up" className="text-sm">업셀링 있음</label>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">색소 (중복 선택)</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['딥', '초코', '카키', '라이트'].map(p => (
                        <button key={p} type="button" disabled={tmReadOnly} onClick={() => setTmPigments(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                          className={`px-2.5 py-1 text-xs rounded border ${tmPigments.includes(p) ? 'bg-green-600 text-white border-green-600' : 'bg-white border-border'} ${tmReadOnly ? 'opacity-70 cursor-default' : ''}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <Input value={tmPigmentRatio} onChange={(e) => setTmPigmentRatio(e.target.value)} placeholder="비율·메모 (예: 딥 6 / 초코 4)" className="text-sm h-8 mt-1.5" disabled={tmReadOnly} />
                  </div>
                  {/* 사진 첨부 */}
                  <div>
                    <label className="text-[11px] text-muted-foreground">사진 (Before/After)</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {tmPhotos.map((url, i) => (
                        <div key={i} className="relative">
                          <a href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" className="w-16 h-16 object-cover rounded border" />
                          </a>
                          {!tmReadOnly && (
                            <button type="button" onClick={() => setTmPhotos(prev => prev.filter((_, j) => j !== i))}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-[10px] leading-none">×</button>
                          )}
                        </div>
                      ))}
                      {!tmReadOnly && (
                        <label className={`w-16 h-16 border border-dashed rounded flex items-center justify-center cursor-pointer text-[10px] text-muted-foreground hover:bg-muted ${tmUploading ? 'opacity-50' : ''}`}>
                          {tmUploading ? '업로드…' : '+ 추가'}
                          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={tmUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0]; if (!file || !detailCheckIn) return;
                              setTmUploading(true);
                              const path = `${detailCheckIn.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                              const { error: upErr } = await storageClient.storage.from('treatment-photos').upload(path, file, { contentType: file.type, upsert: false });
                              if (upErr) {
                                toast({ title: '사진 업로드 실패', description: upErr.message, variant: 'destructive' });
                                setTmUploading(false);
                                return;
                              }
                              const { data: pub } = storageClient.storage.from('treatment-photos').getPublicUrl(path);
                              setTmPhotos(prev => [...prev, pub.publicUrl]);
                              setTmUploading(false);
                              (e.target as HTMLInputElement).value = '';
                            }} />
                        </label>
                      )}
                    </div>
                  </div>
                  {!tmReadOnly && (
                    <Button size="sm" className="w-full bg-accent text-accent-foreground mt-1" disabled={tmSaving.current} onClick={async () => {
                      if (!detailCheckIn || tmSaving.current) return;
                      tmSaving.current = true;
                      const memo = { performer: tmPerformer.trim(), details: tmDetails.trim(), upselling: tmUpselling, pigments: tmPigments, pigmentRatio: tmPigmentRatio.trim() };
                      const { error } = await supabase.from('check_ins').update({ treatment_memo: memo, treatment_photos: tmPhotos } as any).eq('id', detailCheckIn.id);
                      tmSaving.current = false;
                      if (error) { toast({ title: '시술 메모 저장 실패', description: error.message, variant: 'destructive' }); return; }
                      setCheckIns(prev => prev.map(c => c.id === detailCheckIn.id ? ({ ...c, treatment_memo: memo, treatment_photos: tmPhotos } as any) : c));
                      toast({ title: '시술 메모 저장' });
                    }}>시술 메모 저장</Button>
                  )}
                </div>
                );
              })()}

              {/* 박민지 요청 2026-04-14: 시술/결제대기 단계에서 상담 메모를 시술 메모 바로 아래로 이동 */}
              {/* 김태영 #C 2026-04-15: 시술대기는 상담메모 → 시술메모 순 → 상단 블록에서 처리 (여기서는 제외) */}
              {detailCheckIn.customer_id && (detailCheckIn.status === 'treatment' || detailCheckIn.status === 'payment_waiting') && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-blue-600">상담 메모 (날짜별)</h4>
                  <Textarea value={consultNoteToday} onChange={(e) => setConsultNoteToday(e.target.value)} rows={4} className="text-sm border-blue-200 focus:border-blue-400" placeholder="오늘 상담 내용 기록..." />
                  <Button size="sm" variant="outline" className="mt-1 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={async () => {
                    if (!detailCheckIn?.customer_id) return;
                    const todayStr = format(selectedDate, 'yyyy-MM-dd');
                    const { data: upserted, error } = await (supabase.from('consultation_notes') as any).upsert({
                      id: consultNoteId ?? undefined,
                      customer_id: detailCheckIn.customer_id,
                      clinic_id: clinicId,
                      note_date: todayStr,
                      content: consultNoteToday,
                      created_by: currentUserEmail,
                    } as any, { onConflict: 'id' }).select().single();
                    if (error) { toast({ title: '상담 메모 저장 실패', description: error.message, variant: 'destructive' }); return; }
                    if (upserted) setConsultNoteId((upserted as any).id);
                    const { data: history } = await supabase.from('consultation_notes').select('note_date, content').eq('customer_id', detailCheckIn.customer_id).order('note_date', { ascending: false }).limit(30);
                    setConsultNoteHistory(((history || []) as any[]).map(h => ({ note_date: h.note_date, content: h.content })));
                    toast({ title: '상담 메모 저장' });
                  }}>상담 메모 저장</Button>
                </div>
              )}

              {/* Payment Status */}
              <div>
                <h4 className="text-sm font-semibold mb-2">결제</h4>
                {detailPayment ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-green-700 font-medium">결제 완료</span>
                      <span className="text-sm font-bold text-green-700">
                        {detailPayment.method === 'card' ? '💳' : detailPayment.method === 'transfer' ? '🏦' : '💵'} {detailPayment.amount.toLocaleString()}원
                      </span>
                    </div>
                    {(detailPayment.installment || detailPayment.memo) && (
                      <div className="text-xs text-green-600 mt-1">
                        {detailPayment.method === 'card' && detailPayment.installment ? `${detailPayment.installment}개월 할부` : detailPayment.method === 'card' ? '일시불' : detailPayment.method === 'transfer' ? '계좌이체' : ''}
                        {detailPayment.memo && <span className="ml-2">{detailPayment.memo}</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <Button className="w-full bg-accent text-accent-foreground" onClick={() => setDetailPaymentOpen(true)}>
                    결제 처리 ({detailTotal.toLocaleString()}원)
                  </Button>
                )}
              </div>

              {/* Past Visit History */}
              {detailHistory.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">과거 방문 이력</h4>
                  <div className="space-y-1">
                    {detailHistory.map((h, i) => (
                      <div key={i} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{h.date}</span>
                          {h.amount > 0 && <span className="font-medium">{h.amount.toLocaleString()}원</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">{h.services}</p>
                        {h.services !== '-' && detailCheckIn?.status !== 'done' && (
                          <button className="text-[10px] text-accent mt-0.5" onClick={() => {
                            const svcNames = h.services.split(', ');
                            svcNames.forEach(sn => {
                              const matched = allServices.find(s => s.name === sn.trim());
                              if (matched) addService(matched);
                            });
                          }}>+ 같은 시술 추가</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TM 메모 */}
              {detailCheckIn.customer_id && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-orange-600">TM 메모</h4>
                  <Textarea value={detailTmMemo} onChange={(e) => setDetailTmMemo(e.target.value)} rows={3} className="text-sm border-orange-200 focus:border-orange-400" placeholder="TM팀 전용 메모 (통화 내용, 특이사항...)" />
                  <Button size="sm" variant="outline" className="mt-1 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={async () => {
                    await supabase.from('customers').update({ tm_memo: detailTmMemo } as any).eq('id', detailCheckIn.customer_id!);
                    toast({ title: 'TM 메모 저장' });
                  }}>TM 메모 저장</Button>
                </div>
              )}

              {/* 금일 메모 (이동 이력 포함) — 시술 단계에선 위에서 이미 표시됨 */}
              {!(detailCheckIn.status === 'treatment_waiting' || detailCheckIn.status === 'treatment') && (
              <div>
                <h4 className="text-sm font-semibold mb-2">금일 메모</h4>
                <Textarea value={detailNotes} onChange={(e) => setDetailNotes(e.target.value)} rows={3} className="text-sm font-mono" placeholder="메모 입력... (이동 이력 자동 기록)" />
                <Button size="sm" className="mt-2 bg-accent text-accent-foreground" onClick={saveNotes}>메모 저장</Button>
              </div>
              )}

              {/* 상담 메모 (날짜별 저장) — 완료 단계 전용 (시술대기·시술·결제대기 단계는 시술메모 바로 아래에서 표시됨) */}
              {detailCheckIn.customer_id && detailCheckIn.status === 'done' && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-blue-600">상담 메모 (날짜별)</h4>
                  <Textarea value={consultNoteToday} onChange={(e) => setConsultNoteToday(e.target.value)} rows={4} className="text-sm border-blue-200 focus:border-blue-400" placeholder="오늘 상담 내용 기록..." />
                  <Button size="sm" variant="outline" className="mt-1 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={async () => {
                    if (!detailCheckIn?.customer_id) return;
                    const todayStr = format(selectedDate, 'yyyy-MM-dd');
                    // 김태영 #6: upsert로 날짜별 1행 보장 (덮어쓰기 대신 같은 날짜면 업데이트)
                    const { data: upserted, error } = await (supabase.from('consultation_notes') as any).upsert({
                      id: consultNoteId ?? undefined,
                      customer_id: detailCheckIn.customer_id,
                      clinic_id: clinicId,
                      note_date: todayStr,
                      content: consultNoteToday,
                      created_by: currentUserEmail,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'customer_id,clinic_id,note_date' }).select('id').single();
                    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
                    if (upserted?.id) setConsultNoteId(upserted.id);
                    // 이전 상담 기록 refresh
                    const { data: history } = await supabase.from('consultation_notes').select('note_date, content').eq('customer_id', detailCheckIn.customer_id).order('note_date', { ascending: false }).limit(30);
                    if (history) setConsultNoteHistory(history as any);
                    toast({ title: '상담 메모 저장' });
                  }}>상담 메모 저장</Button>
                  {consultNoteHistory.length > 0 && (
                    <div className="mt-3 space-y-2 max-h-[200px] overflow-y-auto">
                      <p className="text-xs font-medium text-muted-foreground">이전 상담 기록</p>
                      {consultNoteHistory.map((h, i) => (
                        <div key={i} className="p-2 bg-muted/50 rounded text-xs">
                          <span className="font-medium text-blue-600">{h.note_date}</span>
                          <p className="mt-1 whitespace-pre-wrap">{h.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Service Dialog — z-index 높게 (Sheet 위에 표시) */}
      <Dialog open={addServiceOpen} onOpenChange={setAddServiceOpen}>
        <DialogContent className="max-w-sm z-[100]">
          <DialogHeader><DialogTitle>시술 추가</DialogTitle></DialogHeader>
          <Input value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="시술 검색..." className="mb-2" />
          <div className="max-h-[400px] overflow-y-auto">
            {allServices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">등록된 시술이 없습니다.</p>
            ) : (
              (() => {
                const filtered = serviceSearch ? allServices.filter(s => s.name.toLowerCase().includes(serviceSearch.toLowerCase())) : allServices;
                const categories = [...new Set(filtered.map(s => s.category || '기타'))];
                return categories.map(cat => (
                  <div key={cat} className="mb-2">
                    <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground bg-muted/50 sticky top-0">{cat}</div>
                    {filtered.filter(s => (s.category || '기타') === cat).map(svc => {
                      const hasDiscount = svc.discount_price && svc.discount_price < svc.price;
                      return (
                        <button key={svc.id} className="w-full text-left px-3 py-2 hover:bg-muted rounded flex justify-between items-center" onClick={() => addService(svc)}>
                          <span className="text-sm">{svc.name}</span>
                          <span className="text-sm">
                            {hasDiscount ? (
                              <><span className="text-xs text-muted-foreground line-through mr-1">{svc.price.toLocaleString()}</span><span className="text-red-500 font-medium">{svc.discount_price!.toLocaleString()}원</span></>
                            ) : (
                              <span className="font-medium">{svc.price.toLocaleString()}원</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ));
              })()
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Reservation Detail Sheet */}
      <Sheet open={resDetailOpen} onOpenChange={setResDetailOpen}>
        <SheetContent className="w-[400px] sm:w-[400px] overflow-y-auto">
          <SheetHeader><SheetTitle>예약 고객 정보</SheetTitle></SheetHeader>
          {resDetailCustomer && (
            <div className="mt-4 space-y-5">
              <div>
                <h3 className="text-lg font-semibold">{resDetailCustomer.name}</h3>
                <p className="text-sm text-muted-foreground">{resDetailCustomer.phone}</p>
              </div>

              {resDetailMemo && (
                <div className="bg-blue-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-muted-foreground">예약 메모</p>
                  <p className="text-sm font-medium">{resDetailMemo}</p>
                </div>
              )}

              {/* Past visit history */}
              <div>
                <h4 className="text-sm font-semibold mb-2">과거 방문 이력</h4>
                {resDetailHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">첫 방문 고객입니다</p>
                ) : (
                  <div className="space-y-1.5">
                    {resDetailHistory.map((h, i) => (
                      <div key={i} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{h.date}</span>
                          {h.amount > 0 && <span className="font-medium">{h.amount.toLocaleString()}원</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">{h.services}</p>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground text-right">
                      총 {resDetailHistory.length}회 방문 · {resDetailHistory.reduce((s, h) => s + h.amount, 0).toLocaleString()}원
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {/* Room Staff Assignment Modal */}
      <Dialog open={!!assignRoomModal} onOpenChange={(v) => { if (!v) setAssignRoomModal(null); }}>
        <DialogContent className="max-w-xs z-[100]">
          <DialogHeader><DialogTitle>{assignRoomModal?.type === 'consultation' ? '상담' : '시술'} {assignRoomModal?.number}번 — 선생님 배정</DialogTitle></DialogHeader>
          <div className="space-y-1">
            {staffList.filter(s => s.active !== false).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">직원관리에서 먼저 등록해주세요</p>
            ) : (
              <>
                {staffList.filter(s => s.active !== false).map(s => (
                  <button key={s.id} className="w-full text-left px-3 py-2.5 hover:bg-muted rounded-lg text-sm font-medium" onClick={async () => {
                    if (!assignRoomModal || !clinicId) return;
                    const today = format(selectedDate, 'yyyy-MM-dd');
                    // Upsert room assignment
                    const existing = roomAssignments.find(a => a.room_type === assignRoomModal.type && a.room_number === assignRoomModal.number);
                    if (existing) {
                      await supabase.from('room_assignments').update({ staff_id: s.id } as any).eq('id', (existing as any).id);
                    } else {
                      await supabase.from('room_assignments').insert({ clinic_id: clinicId, room_type: assignRoomModal.type, room_number: assignRoomModal.number, staff_id: s.id, work_date: today } as any);
                    }
                    fetchStaffAndRooms(clinicId);
                    setAssignRoomModal(null);
                    toast({ title: `${s.name} → ${assignRoomModal.type === 'consultation' ? '상담' : '시술'} ${assignRoomModal.number}번 배정` });
                  }}>{s.name}</button>
                ))}
                <button className="w-full text-left px-3 py-2 hover:bg-red-50 rounded-lg text-sm text-red-500" onClick={async () => {
                  if (!assignRoomModal) return;
                  const existing = roomAssignments.find(a => a.room_type === assignRoomModal.type && a.room_number === assignRoomModal.number);
                  if (existing) {
                    await supabase.from('room_assignments').delete().eq('id', (existing as any).id);
                    fetchStaffAndRooms(clinicId);
                  }
                  setAssignRoomModal(null);
                  toast({ title: '배정 해제' });
                }}>배정 해제</button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* T-W2-05 김태영: 시술방 헤더 클릭 → 해당방 일간 통계 + 고객 정보 */}
      <Dialog open={!!roomStatsModal} onOpenChange={(v) => { if (!v) setRoomStatsModal(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {roomStatsModal && (roomNames[`${roomStatsModal.type === 'treatment' ? 't' : 'c'}${roomStatsModal.number}`] || `${roomStatsModal.type === 'treatment' ? '시술' : '상담'}${roomStatsModal.number}`)} — 오늘 통계
            </DialogTitle>
          </DialogHeader>
          {roomStatsModal && (() => {
            const roomCIs = checkIns.filter(c => c.room_number === roomStatsModal.number &&
              (roomStatsModal.type === 'treatment'
                ? (c.status === 'treatment' || c.status === 'payment_waiting' || c.status === 'done')
                : c.status === 'consultation'));
            const techCounts = new Map<string, number>();
            roomCIs.forEach(c => {
              const tid = (c as any).technician_id || (c as any).consultant_id;
              if (tid) techCounts.set(tid, (techCounts.get(tid) || 0) + 1);
            });
            const staffName = (sid: string) => roomAssignments.find(r => r.staff_id === sid)?.staff?.name || sid.slice(0, 8);
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 bg-muted/30 rounded-lg p-3">
                  <span className="text-sm font-semibold">시술자 집계:</span>
                  {techCounts.size === 0 ? <span className="text-sm text-muted-foreground">기록 없음</span> :
                    Array.from(techCounts.entries()).map(([sid, n]) => (
                      <span key={sid} className="px-2 py-0.5 rounded bg-white text-sm">{staffName(sid)} {n}건</span>
                    ))}
                  <span className="ml-auto text-sm text-muted-foreground">총 {roomCIs.length}건</span>
                </div>
                <div className="max-h-[50vh] overflow-auto border rounded">
                  {roomCIs.length === 0 ? (
                    <p className="text-center py-8 text-sm text-muted-foreground">오늘 이 방을 거친 고객 없음</p>
                  ) : roomCIs.map(ci => {
                    const svcs = getCardServices(ci);
                    const pay = dayPayments[ci.id];
                    const tm = (ci as any).treatment_memo || {};
                    return (
                      <div key={ci.id} className="border-t px-3 py-2 text-sm hover:bg-muted/10 cursor-pointer" onClick={() => { setRoomStatsModal(null); openDetail(ci); }}>
                        <div className="flex justify-between">
                          <span className="font-medium">{ci.customer_name}</span>
                          <span className="text-xs text-muted-foreground">{ci.checked_in_at ? format(new Date(ci.checked_in_at), 'HH:mm') : ''} · {ci.status}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{maskPhone(ci.customer_phone || '')}</div>
                        {svcs.length > 0 && <div className="text-xs mt-0.5">시술: {svcs.join(', ')}</div>}
                        {pay && <div className="text-xs text-green-600 mt-0.5">결제 {pay.amount.toLocaleString()}원 · {pay.method === 'card' ? '카드' : pay.method === 'transfer' ? '이체' : '현금'}</div>}
                        {tm.details && <div className="text-xs text-amber-700 mt-0.5 bg-amber-50 px-2 py-1 rounded whitespace-pre-wrap">시술메모: {tm.details}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
