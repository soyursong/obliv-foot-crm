import { useState, useEffect, useCallback, useRef, useMemo, useTransition } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { maskPhone } from '@/lib/i18n';
import { format, addDays, subDays, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isBefore, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import AdminLayout from '@/components/AdminLayout';
import { getSelectedClinic, getClinicSchedules, getClinicHolidays, getHoursForDate, type DaySchedule, type Holiday } from '@/lib/clinic';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface Customer { id: string; name: string; phone: string; memo: string | null; }
interface Reservation {
  id: string; clinic_id: string; customer_id: string;
  reservation_date: string; reservation_time: string;
  memo: string | null; status: string; service_id?: string | null; created_by?: string | null; customers?: Customer;
}
interface CheckInRecord {
  id: string; customer_name: string; customer_phone: string;
  status: string; checked_in_at: string | null; reservation_id: string | null;
  created_by?: string | null;
}
interface PaymentRecord { check_in_id: string; amount: number; }
interface ServiceOption { id: string; name: string; price: number; duration_min?: number | null; }

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

// 드래그 가능한 예약 카드 wrapper (박민지 L-1, Q-1 transform 수정)
function DraggableRes({ resId, children }: { resId: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `res-${resId}`, data: { resId } });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? 'relative' : undefined,
    touchAction: 'none',
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={isDragging ? 'opacity-60 shadow-lg cursor-grabbing' : 'cursor-grab'}>
      {children}
    </div>
  );
}

// 드롭 가능한 시간 슬롯 wrapper
function DroppableSlot({ dateStr, slot, children, isOver }: { dateStr: string; slot: string; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: hovered } = useDroppable({ id: `slot-${dateStr}-${slot}`, data: { dateStr, slot } });
  return (
    <div ref={setNodeRef} className={`h-full ${hovered ? 'ring-2 ring-accent ring-inset' : ''}`}>
      {children}
    </div>
  );
}

const STATUS_BG: Record<string, string> = {
  reserved: 'bg-blue-100 text-blue-700 border-blue-200',
  checked_in: 'bg-green-100 text-green-700 border-green-200',
  done: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  no_show: 'bg-red-100 text-red-700 border-red-200',
  unpaid: 'bg-orange-100 text-orange-700 border-orange-200',
  abandoned: 'bg-amber-100 text-amber-700 border-amber-200',
  consult_left: 'bg-orange-200 text-orange-800 border-orange-300',
  cancelled: 'bg-gray-50 text-gray-400 border-gray-200',
  walkin: 'bg-cyan-100 text-cyan-700 border-cyan-200',
};

const STATUS_LABEL: Record<string, string> = {
  reserved: '예약', checked_in: '체크인', done: '결제', no_show: '노쇼', unpaid: '이탈',
  abandoned: '대기후이탈', consult_left: '상담후이탈',
  cancelled: '취소', walkin: '워크인',
};

export default function AdminReservations() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [openTime, setOpenTime] = useState('10:00');
  const [closeTime, setCloseTime] = useState('21:00');
  const [schedules, setSchedules] = useState<DaySchedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [maxPerSlot, setMaxPerSlot] = useState(0);
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());
  const [schedulesLoaded, setSchedulesLoaded] = useState(false);

  // PARKJG-0416 잔여 #3: 예약관리 내 고객 상세 슬라이드 패널
  const [custPanelId, setCustPanelId] = useState<string | null>(null);
  const [custPanelData, setCustPanelData] = useState<{ name: string; phone: string; memo: string | null; created_at: string; resident_id?: string | null } | null>(null);
  const [custVisits, setCustVisits] = useState<{ id: string; checked_in_at: string; status: string; queue_number: number; treatment_memo?: string | null }[]>([]);
  const [custPayments, setCustPayments] = useState<{ check_in_id: string; amount: number }[]>([]);
  const [custReservations, setCustReservations] = useState<{ id: string; reservation_date: string; reservation_time: string; status: string; memo: string | null }[]>([]);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);

  const openCustPanel = useCallback(async (customerId: string) => {
    setCustPanelId(customerId);
    const { data: cust } = await supabase.from('customers').select('name, phone, memo, created_at, resident_id').eq('id', customerId).single();
    if (cust) setCustPanelData(cust as any);
    const { data: vis } = await (supabase.from('check_ins') as any).select('id, checked_in_at, status, queue_number, treatment_memo').eq('customer_id', customerId).order('checked_in_at', { ascending: false }).limit(30);
    setCustVisits((vis || []) as any);
    const { data: pay } = await supabase.from('payments').select('check_in_id, amount').in('check_in_id', (vis || []).map((v: any) => v.id));
    setCustPayments((pay || []) as any);
    const { data: resv } = await supabase.from('reservations').select('id, reservation_date, reservation_time, status, memo').eq('customer_id', customerId).order('reservation_date', { ascending: false }).limit(20);
    setCustReservations((resv || []) as any);
  }, []);

  // 박민지 #7: ?date=YYYY-MM-DD 쿼리 파라미터 수신 시 해당 주로 이동
  useEffect(() => {
    const d = searchParams.get('date');
    if (d) {
      const target = new Date(d);
      if (!isNaN(target.getTime())) {
        setWeekStart(startOfWeek(target, { weekStartsOn: 1 }));
      }
    }
  }, [searchParams]);

  // 박민지 Wave3 #1 + ADD-03: ?highlight=<id>로 진입 시 해당 예약 카드 반짝임 + 뷰포트 자동 스크롤. 클릭 시 해제.
  // PARKJG-#4: 데이터 fetch 완료 전 스크롤 시도 실패 방지 — 재시도 포함
  // RESV-EDIT-FROM-HIST: ?edit=1 추가 시 해당 예약 상세 모달 자동 오픈
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const autoEditDone = useRef(false);
  useEffect(() => {
    const h = searchParams.get('highlight');
    if (h) {
      setHighlightedId(h);
      autoEditDone.current = false;
      let attempts = 0;
      const tryScroll = () => {
        const el = document.querySelector(`[data-highlight-id="${h}"]`);
        if (el) { (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        if (++attempts < 8) setTimeout(tryScroll, 400);
      };
      setTimeout(tryScroll, 300);
    }
  }, [searchParams]);

  // RESV-EDIT-FROM-HIST: edit=1 + highlight → reservations 로드 후 자동 모달 오픈
  useEffect(() => {
    if (autoEditDone.current) return;
    const h = searchParams.get('highlight');
    const e = searchParams.get('edit');
    if (!h || e !== '1' || reservations.length === 0) return;
    const target = reservations.find(r => r.id === h);
    if (!target) return;
    autoEditDone.current = true;
    setDetailRes(target);
    setEditDate(new Date(target.reservation_date + 'T00:00:00'));
    setEditTime(target.reservation_time.slice(0, 5));
    setEditMemo(target.memo || '');
    setEditCreatedBy(target.created_by || '');
    setEditReservationType((target as any).reservation_type || '');
    setEditReservationTypeEtc((target as any).reservation_type_etc || '');
    setCustEditMode(false);
    setEditCustName(target.customers?.name || '');
    setEditCustPhone(target.customers?.phone || '');
  }, [reservations, searchParams]);

  // RESV-HIST-PANEL: 우측패널 예약이력 클릭 → 예약 상세 다이얼로그 자동 오픈
  useEffect(() => {
    if (!pendingDetailId || reservations.length === 0) return;
    const target = reservations.find(r => r.id === pendingDetailId);
    if (!target) return;
    setPendingDetailId(null);
    setDetailRes(target);
    setEditDate(new Date(target.reservation_date + 'T00:00:00'));
    setEditTime(target.reservation_time.slice(0, 5));
    setEditMemo(target.memo || '');
    setEditCreatedBy(target.created_by || '');
    setEditReservationType((target as any).reservation_type || '');
    setEditReservationTypeEtc((target as any).reservation_type_etc || '');
    setCustEditMode(false);
    setEditCustName(target.customers?.name || '');
    setEditCustPhone(target.customers?.phone || '');
  }, [reservations, pendingDetailId]);

  // 박민지 #8: 현재 시각에 해당하는 30분 슬롯 자동 펼침 (1분마다 갱신)
  useEffect(() => {
    if (!clinicId) return;
    const expandCurrent = () => {
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = now.getMinutes() < 30 ? '00' : '30';
      const slot = `${hh}:${mm}`;
      setExpandedSlots((prev) => {
        if (prev.has(`${todayStr}-${slot}`)) return prev;
        const next = new Set(prev);
        next.add(`${todayStr}-${slot}`);
        return next;
      });
    };
    expandCurrent();
    const id = setInterval(expandCurrent, 60_000);
    return () => clearInterval(id);
  }, [clinicId]);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [customerOnlyMode, setCustomerOnlyMode] = useState(false); // 박민지 Wave3 #4: 헤더 "+신규고객"으로 들어온 경우, 고객만 등록 후 닫기
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCountryCode, setNewCountryCode] = useState('+82');
  const [newMemo, setNewMemo] = useState('');
  const [resDate, setResDate] = useState<Date>(new Date());
  const [resTime, setResTime] = useState('');
  const [resMemo, setResMemo] = useState('');
  const [resReferral, setResReferral] = useState('');
  const [resServiceId, setResServiceId] = useState('');
  // 김태영 #D 2026-04-15: 예약 등록 모달에도 예약 구분 라디오
  const [newResType, setNewResType] = useState('');
  const [newResTypeEtc, setNewResTypeEtc] = useState('');
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  // 박민지 정정: 취소와 삭제는 다른 개념
  // - 취소: 모든 직원 가능, 이력 남음 (고객이 못 온다고 연락)
  // - 삭제: admin/manager만, DB row 제거, 이력도 없어짐 (실수로 잘못 예약)
  const canDelete = currentUserRole === 'admin' || currentUserRole === 'manager';

  // No-show counts by customer
  const [noShowCounts, setNoShowCounts] = useState<Record<string, number>>({});

  // "내 예약만" 필터 (박민지 #8)
  const [onlyMine, setOnlyMine] = useState(false);
  // 취소·노쇼 이력 표시 (박민지 #1)
  const [showHistory, setShowHistory] = useState(true);
  // RESV-CAPACITY-SLOT: 리터치만 보기 토글
  const [onlyRetouch, setOnlyRetouch] = useState(false);
  // 이메일 → 이름 매핑 (박민지 #7)
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});

  // "내 예약만" 필터: created_by가 이메일 or 이름 형태 둘 다 있으므로 양쪽 매칭
  const isMyRecord = useCallback((createdBy: string | null | undefined) => {
    if (!currentUserEmail || !createdBy) return false;
    if (createdBy === currentUserEmail) return true;
    // staffMap[email] = 이름. created_by가 이름인 경우 역매칭
    const myName = staffMap[currentUserEmail];
    return !!myName && createdBy === myName;
  }, [currentUserEmail, staffMap]);

  // Detail
  const [detailRes, setDetailRes] = useState<Reservation | null>(null);
  const [editDate, setEditDate] = useState<Date>(new Date());
  const [editTime, setEditTime] = useState('');
  const [editMemo, setEditMemo] = useState('');
  // W3-07 정정: 예약별 TM(최초 등록자) 수정 — admin/manager 전용
  const [editCreatedBy, setEditCreatedBy] = useState<string>('');
  // 김태영 신규 2026-04-14: 예약 구분(신규/리터치/시술예약/기타)
  const [editReservationType, setEditReservationType] = useState<string>('');
  const [editReservationTypeEtc, setEditReservationTypeEtc] = useState<string>('');
  // KTY-RESV-CUST-EDIT: 예약 상세 내 고객 정보 인라인 편집
  const [custEditMode, setCustEditMode] = useState(false);
  const [editCustName, setEditCustName] = useState('');
  const [editCustPhone, setEditCustPhone] = useState('');
  const [staffList, setStaffList] = useState<{ email: string; name: string }[]>([]);
  const canEditTm = currentUserRole === 'admin' || currentUserRole === 'manager';

  // 변경이력 (박민지 #5)
  type ResLog = { id: string; action: string; created_at: string | null; created_by: string | null; old_values: any; new_values: any };
  const [detailLogs, setDetailLogs] = useState<ResLog[]>([]);

  // weekStart 변경에만 의존하도록 useMemo — 매 렌더 재계산 방지 (깜빡임 근본 원인)
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  // 박민지 Wave3 #2: 주/일 뷰 토글. day 모드에서는 dayFocus 하루만 표시
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [dayFocus, setDayFocus] = useState<Date>(() => new Date());
  const weekDays = useMemo(
    () => viewMode === 'day' ? [dayFocus] : eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [viewMode, dayFocus, weekStart, weekEnd]
  );

  // weekStart를 Realtime 콜백에서 읽기 위한 ref (stale closure 방지)
  const weekStartRef = useRef(weekStart);
  useEffect(() => { weekStartRef.current = weekStart; }, [weekStart]);

  // Refs for flicker prevention — only setState when data actually changed
  const prevResRef = useRef<string>('');
  const prevCIRef = useRef<string>('');
  const prevPayRef = useRef<string>('');
  const prevNSRef = useRef<string>('');

  // 깜빡임 방지용 transition (React 18)
  const [isPendingWeek, startWeekTransition] = useTransition();

  const generateTimeSlots = useCallback(() => {
    const slots: string[] = [];
    const [oH, oM] = openTime.split(':').map(Number);
    const [cH, cM] = closeTime.split(':').map(Number);
    let h = oH, m = oM;
    while (h < cH || (h === cH && m < cM)) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      m += 30; if (m >= 60) { h++; m = 0; }
    }
    // 박민지 4/14 추가요청 #5: 20:00 슬롯 보강 (영업 종료 후 예약 가능)
    if (!slots.includes('20:00')) slots.push('20:00');
    return slots;
  }, [openTime, closeTime]);

  const fetchWeekData = useCallback(async (cId: string, start: Date, end: Date) => {
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');
    // ※ setWeekLoading 제거: transition 밖에서 호출되면 깜빡임 유발. isPendingWeek로 대체

    // 1단계: 병렬 fetch (holidays까지 포함 — 깜빡임 원인 제거)
    const [resResp, ciResp, holidaysData] = await Promise.all([
      (supabase.from('reservations')
        .select('*, customers(*)').eq('clinic_id', cId)
        .gte('reservation_date', startStr).lte('reservation_date', endStr)
        .order('reservation_time') as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      (supabase.from('check_ins')
        .select('id, customer_name, customer_phone, status, checked_in_at, reservation_id, created_by')
        .eq('clinic_id', cId).gte('created_date', startStr).lte('created_date', endStr) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      getClinicHolidays(cId, startStr, endStr).catch(() => []),
    ]);

    const resData = resResp.data;
    const ciData = ciResp.data;

    // 2단계 병렬: payments (ci 결과 필요), nsCounts (res 결과 필요)
    const customerIds = resData && resData.length > 0
      ? [...new Set((resData as any[]).map(r => r.customer_id).filter(Boolean))]
      : [];

    const [payResp, nsResp] = await Promise.all([
      ((ciData && ciData.length > 0)
        ? supabase.from('payments').select('check_in_id, amount').in('check_in_id', ciData.map((c: any) => c.id))
        : Promise.resolve({ data: [] }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      (customerIds.length > 0
        ? supabase.from('reservations').select('customer_id').eq('status', 'no_show').in('customer_id', customerIds)
        : Promise.resolve({ data: [] }) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
    ]);

    const payData = payResp.data;
    const nsData = nsResp.data;
    const nsCountsNew: Record<string, number> = {};
    (nsData || []).forEach((r: any) => { nsCountsNew[r.customer_id] = (nsCountsNew[r.customer_id] || 0) + 1; });

    // 모든 setState를 transition으로 묶어서 한 번에 전환 → 깜빡임 제거 (J-1)
    startWeekTransition(() => {
      if (resData) {
        const key = JSON.stringify(resData);
        if (key !== prevResRef.current) { prevResRef.current = key; setReservations(resData as unknown as Reservation[]); }
      }
      if (ciData) {
        const key = JSON.stringify(ciData);
        if (key !== prevCIRef.current) { prevCIRef.current = key; setCheckIns(ciData as CheckInRecord[]); }
      }
      if (payData) {
        const key = JSON.stringify(payData);
        if (key !== prevPayRef.current) { prevPayRef.current = key; setPayments(payData as PaymentRecord[]); }
      }
      if (customerIds.length > 0) {
        const key = JSON.stringify(nsCountsNew);
        if (key !== prevNSRef.current) { prevNSRef.current = key; setNoShowCounts(nsCountsNew); }
      }
      setHolidays(holidaysData || []);
    });
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      setCurrentUserEmail(session.user?.email || null);
      // 사용자 역할 조회 (박민지 #2 - 취소 권한)
      if (session.user?.id) {
        const { data: profile } = await (supabase.from('user_profiles') as any)
          .select('role').eq('id', session.user.id).single();
        if (profile?.role) setCurrentUserRole(profile.role);
      }
      // 직원 이메일 → 이름 매핑 (박민지 #7 - 카드에 풀네임 표시)
      const { data: staffData } = await (supabase.from('user_profiles') as any)
        .select('email, name').eq('active', true);
      if (staffData) {
        const map: Record<string, string> = {};
        (staffData as any[]).forEach((u) => { if (u.email && u.name) map[u.email] = u.name; });
        setStaffMap(map);
        setStaffList((staffData as any[]).filter(u => u.email && u.name));
      }
      const clinic = await getSelectedClinic();
      if (clinic) {
        setClinicId(clinic.id); setClinicName(clinic.name);
        if (clinic.open_time) setOpenTime(clinic.open_time);
        if (clinic.close_time) setCloseTime(clinic.close_time);
        if ((clinic as any).max_per_slot) setMaxPerSlot((clinic as any).max_per_slot);
        // Load services for dropdown
        // Q-7: sort_order 우선 (박민지 "눈썹롱래스팅9.9 상단에" 요청), 이후 name 순
        const { data: svcData } = await (supabase.from('services') as any).select('id, name, price, duration_min, sort_order').eq('clinic_id', clinic.id).eq('active', true).order('sort_order', { ascending: true, nullsFirst: false }).order('name');
        if (svcData) setServiceOptions(svcData as unknown as ServiceOption[]);
      }
    };
    init();
  }, [navigate]);

  // Auto-open create modal if customer_id is in URL
  useEffect(() => {
    if (!clinicId) return;
    const customerId = searchParams.get('customer_id');
    if (!customerId) return;
    (async () => {
      const { data } = await supabase.from('customers').select('id, name, phone, memo').eq('id', customerId).single();
      if (data) { setSelectedCustomer(data as Customer); setCreateOpen(true); }
    })();
  }, [clinicId, searchParams]);

  // 주간 데이터 + 공휴일 한 번에 fetch (깜빡임 방지)
  // 의존성: clinicId, weekStart만 (weekEnd·fetchWeekData 제거 — 매 렌더 재실행 원인)
  useEffect(() => {
    if (clinicId) {
      fetchWeekData(clinicId, weekStart, weekEnd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, weekStart]);

  // 요일별 스케줄은 clinicId 변경 시만 1회 fetch (번쩍거림 방지)
  useEffect(() => {
    if (clinicId) {
      getClinicSchedules(clinicId).then(s => { setSchedules(s); setSchedulesLoaded(true); });
    }
  }, [clinicId]);

  // 예약 상세 열릴 때 변경이력 fetch (박민지 #5)
  useEffect(() => {
    if (!detailRes) { setDetailLogs([]); return; }
    (async () => {
      const { data } = await supabase.from('reservation_logs' as any)
        .select('id, action, created_at, created_by, old_values, new_values')
        .eq('reservation_id', detailRes.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (data) setDetailLogs(data as unknown as ResLog[]);
    })();
  }, [detailRes]);

  // Realtime: clinicId 변경 시만 구독 재생성 (주 변경 시 재구독하면 깜빡임)
  // weekStart는 ref로 읽어서 stale closure 방지
  useEffect(() => {
    if (!clinicId) return;
    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedFetch = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const currentStart = weekStartRef.current;
        const currentEnd = endOfWeek(currentStart, { weekStartsOn: 1 });
        fetchWeekData(clinicId, currentStart, currentEnd);
      }, 1000);
    };
    const ch = supabase.channel(`res_week_rt_${clinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinicId}` }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins', filter: `clinic_id=eq.${clinicId}` }, debouncedFetch)
      .subscribe();
    return () => { clearTimeout(debounceTimer); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const timeSlots = useMemo(() => generateTimeSlots(), [generateTimeSlots]);

  type CellItem = { type: 'reservation'; res: Reservation; status: string; linkedCI?: CheckInRecord; payAmount: number | null }
    | { type: 'walkin'; walkIn: CheckInRecord; status: string; payAmount: number | null };

  // Pre-compute cell items map to avoid O(N) filter per cell on every render
  const cellItemsMap = useMemo(() => {
    const map = new Map<string, CellItem[]>();
    const todayStart = startOfDay(new Date());
    // Index check-ins by reservation_id for O(1) lookup
    const ciByResId = new Map<string, CheckInRecord[]>();
    checkIns.forEach(ci => {
      if (ci.reservation_id) {
        const list = ciByResId.get(ci.reservation_id) || [];
        list.push(ci);
        ciByResId.set(ci.reservation_id, list);
      }
    });
    // Index payments by check_in_id for O(1) lookup
    const payByCI = new Map<string, PaymentRecord>();
    payments.forEach(p => { payByCI.set(p.check_in_id, p); });

    // Group reservations by date+slot
    reservations.forEach(res => {
      if (!showHistory && res.status === 'cancelled') return;
      if (onlyMine && !isMyRecord(res.created_by)) return;
      if (onlyRetouch && (res as any).reservation_type !== '리터치') return;
      const slot = res.reservation_time.slice(0, 5);
      const key = `${res.reservation_date}-${slot}`;
      const isPast = isBefore(startOfDay(new Date(res.reservation_date + 'T00:00:00')), todayStart);
      const linkedCI = (ciByResId.get(res.id) || []).find(ci => ci.status !== 'no_show' && ci.status !== 'cancelled');
      let status = res.status;
      let payAmount: number | null = null;
      if (isPast && status === 'reserved') status = 'no_show';
      // NOSHOW-FILTER-BUG: 노쇼도 취소와 동일하게 showHistory=false 시 숨김
      if (!showHistory && status === 'no_show') return;
      if (linkedCI) {
        if (linkedCI.status === 'done') {
          const pay = payByCI.get(linkedCI.id);
          if (pay) { status = 'done'; payAmount = pay.amount; } else status = 'unpaid';
        } else if (linkedCI.status === 'abandoned') {
          status = 'abandoned';
        } else if (linkedCI.status === 'consult_left') {
          status = 'consult_left';
        } else status = 'checked_in';
      }
      const items = map.get(key) || [];
      items.push({ type: 'reservation', res, status, linkedCI, payAmount });
      map.set(key, items);
    });

    // Group walk-ins by date+slot
    checkIns.forEach(ci => {
      if (ci.reservation_id || !ci.checked_in_at) return;
      if (onlyMine && !isMyRecord(ci.created_by)) return;
      const ciDate = format(new Date(ci.checked_in_at), 'yyyy-MM-dd');
      const ciTime = format(new Date(ci.checked_in_at), 'HH:mm');
      // Find which slot this walk-in belongs to
      let matchedSlot = '';
      for (let i = 0; i < timeSlots.length; i++) {
        const nextSlot = timeSlots[i + 1] || '99:99';
        if (ciTime >= timeSlots[i] && ciTime < nextSlot) { matchedSlot = timeSlots[i]; break; }
      }
      if (!matchedSlot) return;
      const key = `${ciDate}-${matchedSlot}`;
      let status = 'walkin';
      let payAmount: number | null = null;
      if (ci.status === 'done') {
        const pay = payByCI.get(ci.id);
        if (pay) { status = 'done'; payAmount = pay.amount; } else status = 'unpaid';
      } else if (ci.status === 'abandoned') {
        status = 'abandoned';
      } else if (ci.status === 'consult_left') {
        status = 'consult_left';
      }
      const items = map.get(key) || [];
      items.push({ type: 'walkin', walkIn: ci, status, payAmount });
      map.set(key, items);
    });

    return map;
  }, [reservations, checkIns, payments, showHistory, onlyMine, onlyRetouch, currentUserEmail, isMyRecord, timeSlots]);

  const getCellItems = (day: Date, slot: string): CellItem[] => {
    const key = `${format(day, 'yyyy-MM-dd')}-${slot}`;
    return cellItemsMap.get(key) || [];
  };

  const searchCustomers = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const { data } = await supabase.from('customers').select('*').eq('clinic_id', clinicId).or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(10);
    if (data) setSearchResults(data as Customer[]);
  };

  // All time slots available (multiple bookings per slot allowed)
  const availableSlots = timeSlots;

  // Pre-indexed slot counts for O(1) lookup
  const slotCountMap = useMemo(() => {
    const map = new Map<string, number>();
    reservations.forEach(r => {
      if (r.status === 'cancelled') return;
      const key = `${r.reservation_date}-${r.reservation_time.slice(0, 5)}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [reservations]);

  const getSlotCount = (dateStr: string, slot: string) => {
    return slotCountMap.get(`${dateStr}-${slot}`) || 0;
  };

  const isSlotFull = (dateStr: string, slot: string) => {
    if (maxPerSlot <= 0) return false;
    return getSlotCount(dateStr, slot) >= maxPerSlot;
  };

  const handleCreate = async () => {
    if (!selectedCustomer || !resTime || !clinicId) return;
    const dateStr = format(resDate, 'yyyy-MM-dd');
    if (isSlotFull(dateStr, resTime)) {
      toast({ title: '해당 시간대가 꽉 찼습니다', variant: 'destructive' }); return;
    }
    // Duplicate check — same customer, same date
    const existing = reservations.find(r => r.customer_id === selectedCustomer.id && r.reservation_date === dateStr && r.status !== 'cancelled');
    if (existing) {
      if (!window.confirm(`${selectedCustomer.name}님은 ${dateStr}에 이미 ${existing.reservation_time.slice(0,5)} 예약이 있습니다. 추가 예약하시겠습니까?`)) return;
    }
    const { data, error } = await supabase.from('reservations').insert({
      clinic_id: clinicId, customer_id: selectedCustomer.id,
      reservation_date: dateStr, reservation_time: resTime,
      memo: resMemo || null, referral_source: resReferral || null,
      service_id: resServiceId || null, created_by: currentUserEmail,
      reservation_type: newResType || null,
      reservation_type_etc: newResType === '기타' ? (newResTypeEtc || null) : null,
    } as any).select().single();
    if (error) { toast({ title: '예약 등록 실패', description: error.message, variant: 'destructive' }); return; }
    // Log creation
    if (data) {
      await supabase.from('reservation_logs' as any).insert({ reservation_id: (data as any).id, action: 'created', new_values: data, created_by: currentUserEmail } as any);
    }
    resetModal(); toast({ title: '예약 등록 완료' });
  };

  const handleNewCustomer = async () => {
    if (!newName.trim() || !newPhone.trim()) return;
    const digits = newPhone.replace(/\D/g, '');
    if (digits.length < 10) { toast({ title: '전화번호는 10자리 이상 입력해주세요', variant: 'destructive' }); return; }
    // 박민지 4/14: +82 저장 금지, 010-xxxx-xxxx 포맷 고정. 외국번호만 countryCode 유지.
    let phoneValue: string;
    if (newCountryCode === '+82') {
      const n = digits.startsWith('0') ? digits : '0' + digits;
      phoneValue = n.length >= 11 ? `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7, 11)}` : n;
    } else {
      phoneValue = `${newCountryCode}${digits.replace(/^0/, '')}`;
    }
    const { data, error } = await supabase.from('customers').insert({
      clinic_id: clinicId, name: newName.trim(), phone: phoneValue, memo: newMemo || null,
      created_by: currentUserEmail,
    } as any).select().single();
    if (error) { toast({ title: '이미 등록된 번호', variant: 'destructive' }); return; }
    if (data) {
      if (customerOnlyMode) { toast({ title: '고객 등록 완료' }); resetModal(); return; }
      setSelectedCustomer(data as Customer); setNewCustomerMode(false);
    }
  };

  const handleUpdate = async () => {
    if (!detailRes) return;
    const oldValues: any = { reservation_date: detailRes.reservation_date, reservation_time: detailRes.reservation_time, memo: detailRes.memo };
    const newValues: any = { reservation_date: format(editDate, 'yyyy-MM-dd'), reservation_time: editTime, memo: editMemo || null };
    // W3-07 정정: admin/manager가 TM(예약 등록자) 변경 가능
    if (canEditTm && editCreatedBy !== (detailRes.created_by || '')) {
      oldValues.created_by = detailRes.created_by;
      newValues.created_by = editCreatedBy || null;
    }
    // 김태영 신규: 예약 구분
    const prevType = (detailRes as any).reservation_type || '';
    const prevTypeEtc = (detailRes as any).reservation_type_etc || '';
    if (prevType !== editReservationType || prevTypeEtc !== editReservationTypeEtc) {
      oldValues.reservation_type = prevType || null;
      oldValues.reservation_type_etc = prevTypeEtc || null;
      newValues.reservation_type = editReservationType || null;
      newValues.reservation_type_etc = editReservationType === '기타' ? (editReservationTypeEtc || null) : null;
    }
    const { error } = await supabase.from('reservations').update(newValues).eq('id', detailRes.id);
    if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('reservation_logs' as any).insert({ reservation_id: detailRes.id, action: 'modified', old_values: oldValues, new_values: newValues, created_by: currentUserEmail } as any);
    setDetailRes(null); toast({ title: '수정 완료' });
  };

  // 예약 취소: 모든 직원 가능. status='cancelled', 이력 유지
  const handleCancel = async () => {
    if (!detailRes) return;
    if (!window.confirm('예약을 취소하시겠습니까?\n(예약 이력은 남습니다 — 고객이 못 온다고 연락한 경우)')) return;
    const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', detailRes.id);
    if (error) { toast({ title: '취소 실패', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('reservation_logs' as any).insert({ reservation_id: detailRes.id, action: 'cancelled', old_values: { status: detailRes.status }, new_values: { status: 'cancelled' }, created_by: currentUserEmail } as any);
    setDetailRes(null); toast({ title: '예약 취소 완료' });
  };

  // 예약 삭제: admin/manager만 가능. DB row 제거, 이력 없어짐 (박민지 정정)
  // Q-3: 상태 변경(체크인/대기후이탈/상담후이탈) 이후에도 삭제 가능하도록
  // linkedCI가 있으면 check_ins + payments 까지 CASCADE 삭제
  const handleDelete = async () => {
    if (!detailRes) return;
    if (!canDelete) { toast({ title: '삭제 권한이 없습니다', description: '관리자(상담실장)에게 요청해주세요', variant: 'destructive' }); return; }
    if (!window.confirm('예약을 완전 삭제하시겠습니까?\n\n⚠️ 이력 자체가 사라집니다. 실수로 잘못 예약한 경우에만 사용하세요.\n(고객이 못 온다고 연락한 경우는 "취소" 버튼을 사용하세요)')) return;
    // 1) 관련 check_ins → payments 먼저 정리 (FK)
    const { data: ciRows } = await (supabase.from('check_ins') as any)
      .select('id').eq('reservation_id', detailRes.id);
    if (ciRows && (ciRows as any[]).length > 0) {
      const ciIds = (ciRows as any[]).map(c => c.id);
      await (supabase.from('payments') as any).delete().in('check_in_id', ciIds);
      await (supabase.from('check_ins') as any).delete().in('id', ciIds);
    }
    // 2) 삭제 이전에 감사 기록 남김 (FK는 SET NULL이라 reservation 삭제 후에도 로그 보존)
    await supabase.from('reservation_logs' as any).insert({
      reservation_id: detailRes.id,
      action: 'deleted',
      old_values: {
        status: detailRes.status,
        reservation_date: detailRes.reservation_date,
        reservation_time: detailRes.reservation_time,
        customer_id: detailRes.customer_id,
        memo: detailRes.memo,
      },
      new_values: null,
      created_by: currentUserEmail,
    } as any);
    // 3) reservations 삭제 (FK SET NULL로 기존 로그의 reservation_id만 NULL 처리됨)
    const { error } = await (supabase.from('reservations').delete() as any).eq('id', detailRes.id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    setDetailRes(null); toast({ title: '예약 삭제 완료', description: '이력도 함께 제거되었습니다' });
  };

  // 취소된 예약을 다시 reserved로 복원 (박민지 추가요청 1)
  const handleRestore = async () => {
    if (!detailRes) return;
    if (!window.confirm('취소한 예약을 다시 되돌리시겠습니까?')) return;
    const { error } = await supabase.from('reservations').update({ status: 'reserved' }).eq('id', detailRes.id);
    if (error) { toast({ title: '복원 실패', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('reservation_logs' as any).insert({ reservation_id: detailRes.id, action: 'restored', old_values: { status: 'cancelled' }, new_values: { status: 'reserved' }, created_by: currentUserEmail } as any);
    setDetailRes(null); toast({ title: '예약 복원 완료' });
  };

  // 대기후이탈/상담후이탈 상태를 다시 waiting으로 복원 (박민지 추가요청 5)
  const handleRestoreCheckIn = async () => {
    if (!detailRes) return;
    const linkedCI = checkIns.find(ci => ci.reservation_id === detailRes.id);
    if (!linkedCI) { toast({ title: '체크인 정보가 없습니다', variant: 'destructive' }); return; }
    if (!window.confirm('이탈 처리된 고객을 다시 체크인(대기)으로 복원할까요?')) return;
    const { error } = await (supabase.from('check_ins') as any).update({ status: 'waiting' }).eq('id', linkedCI.id);
    if (error) { toast({ title: '복원 실패', description: error.message, variant: 'destructive' }); return; }
    setDetailRes(null); toast({ title: '체크인 복원 완료' });
  };

  const handleCheckIn = async (res: Reservation) => {
    if (!res.customers) return;
    const { error } = await supabase.rpc('reservation_to_checkin' as any, {
      p_reservation_id: res.id, p_clinic_id: clinicId,
      p_customer_name: res.customers.name, p_customer_phone: res.customers.phone,
      p_customer_id: res.customer_id, p_created_by: currentUserEmail,
    });
    if (error) { toast({ title: '체크인 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '체크인 완료' });
  };

  const resetModal = () => {
    setCreateOpen(false); setSearchQuery(''); setSearchResults([]); setSelectedCustomer(null);
    setNewCustomerMode(false); setCustomerOnlyMode(false); setNewName(''); setNewPhone(''); setNewMemo(''); setResTime(''); setResMemo(''); setResReferral(''); setResServiceId('');
    setNewResType(''); setNewResTypeEtc('');
  };

  const openSlot = (day: Date, slot: string) => {
    setResDate(day); setResTime(slot); setCreateOpen(true);
  };

  // dnd-kit sensors (짧은 이동으로 드래그 시작되지 않도록 activationConstraint)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // 드래그 종료 시 — 예약 날짜/시간 변경 (박민지 L-1)
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const resId = (active.data.current as any)?.resId as string | undefined;
    const dropData = over.data.current as { dateStr: string; slot: string } | undefined;
    if (!resId || !dropData) return;

    const res = reservations.find(r => r.id === resId);
    if (!res) return;
    const newDateStr = dropData.dateStr;
    const newTime = dropData.slot + ':00';
    // 동일 위치면 무시
    if (res.reservation_date === newDateStr && res.reservation_time.slice(0, 5) === dropData.slot) return;
    // 슬롯 꽉찬 경우 경고
    if (isSlotFull(newDateStr, dropData.slot)) {
      toast({ title: '해당 시간대가 꽉 찼습니다', variant: 'destructive' });
      return;
    }
    // Optimistic update
    setReservations(prev => prev.map(r => r.id === resId ? { ...r, reservation_date: newDateStr, reservation_time: newTime } : r));
    const oldValues = { reservation_date: res.reservation_date, reservation_time: res.reservation_time };
    const newValues = { reservation_date: newDateStr, reservation_time: newTime };
    const { error } = await supabase.from('reservations').update(newValues).eq('id', resId);
    if (error) {
      toast({ title: '변경 실패', description: error.message, variant: 'destructive' });
      // Rollback
      setReservations(prev => prev.map(r => r.id === resId ? { ...r, ...oldValues } : r));
      return;
    }
    await supabase.from('reservation_logs' as any).insert({
      reservation_id: resId, action: 'modified',
      old_values: oldValues, new_values: newValues,
      created_by: currentUserEmail,
    } as any);
    toast({ title: '예약 이동 완료', description: `${newDateStr} ${dropData.slot}` });
  };

  const weekLabel = viewMode === 'day'
    ? format(dayFocus, 'M/d (EEE)')
    : `${format(weekStart, 'M/d')} ~ ${format(weekEnd, 'M/d')}`;
  // 네비 버튼 핸들러 (주/일 모드 공통)
  const navPrev = () => startWeekTransition(() => {
    if (viewMode === 'day') { const d = subDays(dayFocus, 1); setDayFocus(d); setWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else setWeekStart(subDays(weekStart, 7));
  });
  const navNext = () => startWeekTransition(() => {
    if (viewMode === 'day') { const d = addDays(dayFocus, 1); setDayFocus(d); setWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else setWeekStart(addDays(weekStart, 7));
  });
  const navToday = () => startWeekTransition(() => {
    const today = new Date();
    if (viewMode === 'day') { setDayFocus(today); setWeekStart(startOfWeek(today, { weekStartsOn: 1 })); }
    else setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
  });

  // Weekly summary — useMemo to avoid recomputing on unrelated renders
  // DAILY-COUNT-BUG: 일별 뷰에서는 해당 일자 데이터만 집계
  const dayFocusStr = useMemo(() => format(dayFocus, 'yyyy-MM-dd'), [dayFocus]);
  const weekReserved = useMemo(
    () => reservations.filter(r => r.status !== 'cancelled' && (!onlyMine || isMyRecord(r.created_by)) && (viewMode !== 'day' || r.reservation_date === dayFocusStr)).length,
    [reservations, onlyMine, isMyRecord, viewMode, dayFocusStr]
  );
  const weekWalkins = useMemo(
    () => checkIns.filter(ci => !ci.reservation_id && (!onlyMine || isMyRecord(ci.created_by)) && (viewMode !== 'day' || (ci.checked_in_at && ci.checked_in_at.startsWith(dayFocusStr)))).length,
    [checkIns, onlyMine, isMyRecord, viewMode, dayFocusStr]
  );
  const weekRevenue = useMemo(() => {
    if (viewMode !== 'day') return payments.reduce((s, p) => s + p.amount, 0);
    const dayCheckInIds = new Set(checkIns.filter(ci => ci.checked_in_at && ci.checked_in_at.startsWith(dayFocusStr)).map(ci => ci.id));
    return payments.filter(p => dayCheckInIds.has(p.check_in_id)).reduce((s, p) => s + p.amount, 0);
  }, [payments, checkIns, viewMode, dayFocusStr]);

  return (
    <AdminLayout clinicName={clinicName} activeTab="reservations">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-[calc(100vh-57px)]">
        {/* Header */}
        <div className="px-4 py-2 flex items-center justify-between border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={navPrev}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            {/* 월 달력 팝오버 (박민지 #6) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-sm font-semibold gap-1 px-2" title="달력에서 날짜 선택">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {weekLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={weekStart}
                  onSelect={(d) => { if (d) startWeekTransition(() => { if (viewMode === 'day') { setDayFocus(d); setWeekStart(startOfWeek(d, { weekStartsOn: 1 })); } else { setWeekStart(startOfWeek(d, { weekStartsOn: 1 })); } }); }}
                  modifiers={{
                    hasRes: (date) => {
                      const ds = format(date, 'yyyy-MM-dd');
                      return reservations.some(r => r.reservation_date === ds && r.status !== 'cancelled');
                    },
                  }}
                  modifiersClassNames={{
                    hasRes: 'font-bold text-accent underline decoration-accent decoration-2 underline-offset-2',
                  }}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={navNext}>
              <ChevronRight className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={navToday}>{viewMode === 'day' ? '오늘' : '이번주'}</Button>
            {/* 박민지 Wave3 #2: 주/일 뷰 토글 */}
            <div className="flex border border-border rounded overflow-hidden">
              <button className={`px-2 py-0.5 text-xs ${viewMode === 'week' ? 'bg-accent text-accent-foreground' : 'bg-background hover:bg-muted'}`} onClick={() => startWeekTransition(() => setViewMode('week'))}>주</button>
              <button className={`px-2 py-0.5 text-xs ${viewMode === 'day' ? 'bg-accent text-accent-foreground' : 'bg-background hover:bg-muted'}`} onClick={() => startWeekTransition(() => { setViewMode('day'); setDayFocus(prev => { const d = prev ?? new Date(); setWeekStart(startOfWeek(d, { weekStartsOn: 1 })); return d; }); })}>일</button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {isPendingWeek && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" title="불러오는 중" />
            )}
            <span>예약 <b className="text-foreground">{weekReserved}</b></span>
            <span>워크인 <b className="text-foreground">{weekWalkins}</b></span>
            <span>매출 <b className="text-foreground">{(weekRevenue / 10000).toFixed(0)}만</b></span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={showHistory ? 'default' : 'outline'}
              className={`h-7 text-xs ${showHistory ? 'bg-gray-400 text-white' : ''}`}
              onClick={() => setShowHistory(v => !v)}
              title="취소·노쇼 이력 표시"
            >
              {showHistory ? '✓ 취소·노쇼' : '취소·노쇼'}
            </Button>
            <Button
              size="sm"
              variant={onlyMine ? 'default' : 'outline'}
              className={`h-7 text-xs ${onlyMine ? 'bg-accent text-accent-foreground' : ''}`}
              onClick={() => setOnlyMine(v => !v)}
              title="내가 등록한 예약만 보기"
            >
              {onlyMine ? '✓ 내 예약만' : '내 예약만'}
            </Button>
            <Button
              size="sm"
              variant={onlyRetouch ? 'default' : 'outline'}
              className={`h-7 text-xs ${onlyRetouch ? 'bg-purple-500 text-white' : ''}`}
              onClick={() => setOnlyRetouch(v => !v)}
              title="리터치 예약만 보기"
            >
              {onlyRetouch ? '✓ 리터치만' : '리터치만'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setResDate(new Date()); setSelectedCustomer(null); setNewCustomerMode(true); setCustomerOnlyMode(true); setCreateOpen(true); }}>+ 신규고객</Button>
            <Button size="sm" className="bg-accent text-accent-foreground h-7 text-xs" onClick={() => { setResDate(new Date()); setCreateOpen(true); }}>+ 예약</Button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[800px]">
            {/* Day headers */}
            <div className="flex sticky top-0 z-10 bg-card border-b border-border">
              <div className="w-14 shrink-0 border-r border-border" />
              {weekDays.map((day, i) => {
                const isT = isToday(day);
                const dateStr = format(day, 'M/d');
                const fullDateStr = format(day, 'yyyy-MM-dd');
                const dayHours = schedulesLoaded ? getHoursForDate(day, schedules, holidays, openTime, closeTime) : { open: openTime, close: closeTime, isClosed: false };
                const dayRes = reservations.filter(r => r.reservation_date === fullDateStr && r.status !== 'cancelled');
                const dayResCount = dayRes.length;
                const dayNew = dayRes.filter(r => (r as any).reservation_type === '신규').length;
                const dayRetouch = dayRes.filter(r => (r as any).reservation_type === '리터치').length;
                return (
                  <div key={i} className={`flex-1 text-center py-1.5 border-r border-border text-xs ${isT ? 'bg-accent/10 font-bold' : ''} ${dayHours.isClosed ? 'bg-gray-100' : ''}`}>
                    <div className={isT ? 'text-accent' : dayHours.isClosed ? 'text-gray-400' : 'text-muted-foreground'}>{DAY_LABELS[i]}</div>
                    <div className={isT ? 'text-accent' : dayHours.isClosed ? 'text-gray-400' : ''}>{dateStr}</div>
                    {dayResCount > 0 && !dayHours.isClosed && (
                      <div className="text-[10px] font-semibold">
                        <span className="text-accent">{dayResCount}건</span>
                        {(dayNew > 0 || dayRetouch > 0) && (
                          <span className="text-muted-foreground ml-0.5">
                            {dayNew > 0 && <span className="text-blue-500">N{dayNew}</span>}
                            {dayNew > 0 && dayRetouch > 0 && '/'}
                            {dayRetouch > 0 && <span className="text-purple-500">R{dayRetouch}</span>}
                          </span>
                        )}
                      </div>
                    )}
                    {schedulesLoaded && dayHours.isClosed && <div className="text-[10px] text-red-400">휴무</div>}
                    {schedulesLoaded && !dayHours.isClosed && dayHours.close !== closeTime && <div className="text-[10px] text-muted-foreground">~{dayHours.close.slice(0,5)}</div>}
                  </div>
                );
              })}
            </div>

            {/* Time rows */}
            {timeSlots.map((slot) => (
              <div key={slot} className="flex border-b border-border/50 hover:bg-muted/20">
                <div className="w-14 shrink-0 px-1.5 py-1 text-[11px] font-medium text-muted-foreground border-r border-border text-right">{slot}</div>
                {weekDays.map((day, i) => {
                  const items = getCellItems(day, slot);
                  const isT = isToday(day);
                  const isPast = isBefore(startOfDay(day), startOfDay(new Date()));
                  const dayHours = schedulesLoaded ? getHoursForDate(day, schedules, holidays, openTime, closeTime) : { open: openTime, close: closeTime, isClosed: false };
                  const isOutOfHours = schedulesLoaded && (dayHours.isClosed || slot >= dayHours.close || slot < dayHours.open);

                  if (isOutOfHours && items.length === 0) {
                    return <div key={i} className="flex-1 border-r border-border/50 bg-gray-50/80" />;
                  }

                  if (items.length > 0) {
                    const cellKey = `${format(day, 'yyyy-MM-dd')}-${slot}`;
                    // 주별 뷰: 2건까지만 표시 + 더보기/접기, 일별 뷰는 전체 펼침
                    const isExpanded = viewMode === 'day' || expandedSlots.has(cellKey);
                    const showMax = isExpanded ? items.length : 2;
                    const visible = items.slice(0, showMax);
                    const overflow = items.length - showMax;
                    const slotFull = isSlotFull(format(day, 'yyyy-MM-dd'), slot);
                    const dayStr = format(day, 'yyyy-MM-dd');

                    return (
                      <div key={i} className={`flex-1 border-r border-border/50 p-0.5 ${isT ? 'bg-accent/5' : ''} ${slotFull ? 'bg-red-50/50' : ''}`}>
                        <DroppableSlot dateStr={dayStr} slot={slot}>
                        {/* W3-ADD-01: 일별 뷰 5행 초과 시 2열 분기, 주별은 1열 */}
                        <div className={viewMode === 'day' ? (visible.length > 5 ? 'grid grid-cols-2 gap-0.5' : 'grid grid-cols-5 gap-0.5') : 'space-y-0.5'}>
                          {visible.map((item, idx) => {
                            // 리터치 예약(미방문)은 연보라, 신규 예약은 기존 연블루
                            const resType = item.type === 'reservation' ? (item.res as any).reservation_type : null;
                            const bgClass = (item.status === 'reserved' && resType === '리터치')
                              ? 'bg-purple-100 text-purple-700 border-purple-200'
                              : STATUS_BG[item.status] || 'bg-gray-50';
                            const label = STATUS_LABEL[item.status] || '';
                            const name = item.type === 'reservation' ? item.res.customers?.name : item.walkIn?.customer_name;
                            const phone = item.type === 'reservation' ? item.res.customers?.phone : item.walkIn?.customer_phone;
                            const isWalkin = item.type === 'walkin';

                            const custId = item.type === 'reservation' ? item.res.customer_id : null;
                            const nsCount = custId ? (noShowCounts[custId] || 0) : 0;

                            const resMemo = item.type === 'reservation' ? (item.res.memo || '') : '';
                            const creatorEmail = item.type === 'reservation'
                              ? (item.res.created_by || '')
                              : (item.walkIn.created_by || '');
                            // 풀 이름 우선, 없으면 이메일 앞부분 전체 (박민지 #7)
                            const creatorTag = creatorEmail
                              ? (staffMap[creatorEmail] || creatorEmail.split('@')[0])
                              : '';

                            const isHighlighted = item.type === 'reservation' && highlightedId === item.res.id;
                            const cardInner = (
                              <div
                                data-highlight-id={item.type === 'reservation' ? item.res.id : undefined}
                                className={`rounded px-1 py-0.5 text-[10px] border cursor-pointer ${bgClass} leading-tight ${isHighlighted ? 'ring-2 ring-accent animate-pulse shadow-lg' : ''}`}
                                onClick={() => {
                                  if (item.type === 'reservation') {
                                    if (isHighlighted) setHighlightedId(null);
                                    setDetailRes(item.res);
                                    setEditDate(new Date(item.res.reservation_date + 'T00:00:00'));
                                    setEditTime(item.res.reservation_time.slice(0, 5));
                                    setEditMemo(item.res.memo || '');
                                    setEditCreatedBy(item.res.created_by || '');
                                    setEditReservationType((item.res as any).reservation_type || '');
                                    setEditReservationTypeEtc((item.res as any).reservation_type_etc || '');
                                    setCustEditMode(false);
                                    setEditCustName(item.res.customers?.name || '');
                                    setEditCustPhone(item.res.customers?.phone || '');
                                  }
                                }}
                                title={`${name} ${phone ? maskPhone(phone) : ''}${resMemo ? ` · ${resMemo}` : ''}${creatorEmail ? ` · ${creatorEmail}` : ''}`}
                              >
                                <div className="font-medium truncate">
                                  {/* 박민지 Wave2 #1+#2: 고객명 클릭해도 페이지 이동 X, 우측 패널(예약 상세 Sheet)만 */}
                                  <span>{name}</span>
                                  {nsCount > 0 && <span className="text-red-500 ml-0.5" title={`노쇼 ${nsCount}회`}>{'\u{1F534}'}{nsCount}</span>}
                                </div>
                                {phone && <div className="text-[9px] text-muted-foreground truncate">{maskPhone(phone)}</div>}
                                {(resMemo || creatorTag) && (
                                  <div className="text-[9px] text-muted-foreground truncate">
                                    {resMemo ? resMemo.slice(0, 15) : ''}
                                    {resMemo && creatorTag ? ' · ' : ''}
                                    {creatorTag && <span className="opacity-70">@{creatorTag}</span>}
                                  </div>
                                )}
                                <div className="truncate opacity-70">
                                  {isWalkin && <span>W </span>}
                                  {item.payAmount ? <span>{(item.payAmount / 10000).toFixed(0)}만 </span> : null}
                                  {item.type === 'reservation' && item.res.status === 'cancelled' && <span className="line-through">취소 </span>}
                                  {item.status === 'no_show' && <span>노쇼 </span>}
                                  {item.status === 'unpaid' && <span>이탈 </span>}
                                  {item.status === 'abandoned' && <span>대기후이탈 </span>}
                                  {item.status === 'consult_left' && <span>상담후이탈 </span>}
                                </div>
                              </div>
                            );
                            // reservation 타입 + 활성 상태만 드래그 가능 (취소/노쇼/이탈은 X)
                            const isDraggable = item.type === 'reservation'
                              && item.res.status !== 'cancelled'
                              && item.status !== 'no_show'
                              && item.status !== 'abandoned'
                              && item.status !== 'consult_left'
                              && !item.linkedCI; // 이미 체크인된 건 드래그 X
                            return isDraggable
                              ? <DraggableRes key={idx} resId={item.res.id}>{cardInner}</DraggableRes>
                              : <div key={idx}>{cardInner}</div>;
                          })}
                          {/* W3-ADD-01 복원: 주별 뷰 더보기/접기 */}
                          {viewMode === 'week' && overflow > 0 && (() => {
                            const totalCount = items.length;
                            const nCount = items.filter(it => it.type === 'reservation' && (it.res as any).reservation_type === '신규').length;
                            const rCount = items.filter(it => it.type === 'reservation' && (it.res as any).reservation_type === '리터치').length;
                            const tags = [nCount > 0 && `N${nCount}`, rCount > 0 && `R${rCount}`].filter(Boolean).join(', ');
                            return (
                              <div className="text-[10px] text-accent text-center cursor-pointer hover:underline" onClick={() => setExpandedSlots(prev => new Set([...prev, cellKey]))}>
                                펼침 ({totalCount}명{tags ? `, ${tags}` : ''})
                              </div>
                            );
                          })()}
                          {viewMode === 'week' && isExpanded && items.length > 2 && expandedSlots.has(cellKey) && (
                            <div className="text-[10px] text-muted-foreground text-center cursor-pointer hover:text-accent" onClick={() => setExpandedSlots(prev => { const s = new Set(prev); s.delete(cellKey); return s; })}>
                              접기
                            </div>
                          )}
                          {!isPast && !isOutOfHours && !slotFull && (
                            <div
                              className="text-[10px] text-accent/70 text-center cursor-pointer hover:text-accent hover:bg-accent/10 rounded border border-dashed border-accent/30 py-0.5 mt-0.5"
                              title="이 시간대에 예약 추가"
                              onClick={(e) => { e.stopPropagation(); openSlot(day, slot); }}
                            >
                              + 추가
                            </div>
                          )}
                        </div>
                        </DroppableSlot>
                      </div>
                    );
                  }

                  // Empty cell
                  const emptyDayStr = format(day, 'yyyy-MM-dd');
                  return (
                    <div
                      key={i}
                      className={`flex-1 border-r border-border/50 p-0.5 ${!isPast && !isOutOfHours ? 'cursor-pointer hover:bg-accent/10' : ''} ${isT ? 'bg-accent/5' : ''} ${isPast ? 'opacity-50' : ''}`}
                      onClick={() => { if (!isPast && !isOutOfHours) openSlot(day, slot); }}
                    >
                      {!isPast && !isOutOfHours && (
                        <DroppableSlot dateStr={emptyDayStr} slot={slot}>
                          <div className="w-full h-full min-h-[20px]" />
                        </DroppableSlot>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!v) resetModal(); else setCreateOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{customerOnlyMode ? '신규 고객 등록' : '예약 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!selectedCustomer && (
              <div>
                {!customerOnlyMode && (<>
                <label className="block text-sm font-medium mb-1">고객 검색 (이름/전화번호)</label>
                <Input value={searchQuery} onChange={(e) => searchCustomers(e.target.value)} placeholder="이름 또는 전화번호 입력" />
                </>)}
                {searchQuery.length >= 2 && (
                  <div className="mt-2 border rounded-lg overflow-hidden">
                    {searchResults.map((c) => (
                      <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between" onClick={() => { setSelectedCustomer(c); setNewCustomerMode(false); }}>
                        <span className="font-medium">{c.name}</span><span className="text-muted-foreground">{maskPhone(c.phone)}</span>
                      </button>
                    ))}
                    {searchResults.length === 0 && !newCustomerMode && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        검색 결과 없음
                        <button className="ml-2 text-accent font-medium" onClick={() => {
                          // 박민지 4/14 오류 수정: 혼합 입력 시 숫자는 전화, 한글/영문은 이름으로 분리
                          setNewCustomerMode(true);
                          const digits = searchQuery.replace(/\D/g, '');
                          const text = searchQuery.replace(/\d/g, '').replace(/[-\s]/g, '').trim();
                          setNewPhone(digits);
                          setNewName(text);
                        }}>신규 등록</button>
                      </div>
                    )}
                  </div>
                )}
                {newCustomerMode && (
                  <div className="space-y-3 p-3 bg-muted/30 rounded-lg mt-2">
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름" />
                    <div className="flex gap-2">
                      <select value={newCountryCode} onChange={(e) => setNewCountryCode(e.target.value)} className="h-10 rounded-md border px-2 text-sm">
                        <option value="+82">🇰🇷 +82</option><option value="+1">🇺🇸 +1</option>
                      </select>
                      <Input value={newPhone} onChange={(e) => {
                        // 박민지 4/14: 010-xxxx-xxxx 포맷 자동 (한국번호만)
                        let v = e.target.value.replace(/[^0-9]/g, '');
                        if (newCountryCode === '+82' && v.length > 0) {
                          if (!v.startsWith('0')) v = '0' + v;
                          if (v.length >= 4) v = v.slice(0, 3) + '-' + v.slice(3);
                          if (v.length >= 9) v = v.slice(0, 8) + '-' + v.slice(8);
                          if (v.length > 13) v = v.slice(0, 13);
                        }
                        setNewPhone(v);
                      }} placeholder="010-1234-5678" type="tel" className="flex-1" />
                    </div>
                    <Input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder="메모" />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setNewCustomerMode(false)} className="flex-1">취소</Button>
                      <Button onClick={handleNewCustomer} disabled={!newName.trim() || !newPhone.trim()} className="flex-1 bg-accent text-accent-foreground">등록</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {selectedCustomer && (
              <div className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
                <div><p className="font-medium text-sm">{selectedCustomer.name}</p><p className="text-xs text-muted-foreground">{maskPhone(selectedCustomer.phone)}</p></div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)}>변경</Button>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">날짜</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start gap-2"><CalendarIcon className="h-4 w-4" />{format(resDate, 'yyyy-MM-dd (EEE)', { locale: ko })}</Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  {/* 신규 예약 등록 과거 불가 + 6개월 이내 (대표 결정 2026-04-13: 박민지 3 vs 김태영 5 → 6으로 확정) */}
                  <Calendar mode="single" selected={resDate} onSelect={(d) => d && setResDate(d)} disabled={(date) => {
                    const today = startOfDay(new Date());
                    const maxDate = new Date(today); maxDate.setMonth(maxDate.getMonth() + 6);
                    return date < today || date > maxDate;
                  }} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">시간</label>
              <select value={resTime} onChange={(e) => setResTime(e.target.value)} className="w-full h-10 rounded-md border px-3 text-sm">
                <option value="">선택</option>
                {availableSlots.map((s) => {
                  const full = isSlotFull(format(resDate, 'yyyy-MM-dd'), s);
                  const isResDateToday = isToday(resDate);
                  const nowTime = `${String(new Date().getHours()).padStart(2,'0')}:${String(new Date().getMinutes()).padStart(2,'0')}`;
                  const isPastSlot = isResDateToday && s < nowTime;
                  // 김태영 #11: 지난 시간대도 선택 가능하게 (워크인 과거 시간 등록 허용) - 라벨로만 "지남" 표시
                  return <option key={s} value={s} disabled={full}>{s}{full ? ' (마감)' : isPastSlot ? ' (지남)' : ''}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">유입경로</label>
              <div className="flex flex-wrap gap-1.5">
                {['TM', '네이버 검색', '인스타그램', '지인 소개', '네이버 블로그', '유튜브', '네이버 지도', '기타'].map((src) => (
                  <button key={src} type="button" onClick={() => setResReferral(src)}
                    className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors ${resReferral === src ? 'border-accent bg-accent/10 text-accent' : 'border-input bg-background hover:bg-muted'}`}>
                    {src}
                  </button>
                ))}
              </div>
            </div>
            {/* 김태영 #D 2026-04-15: 예약 구분 (신규/리터치/시술예약/기타) */}
            <div>
              <label className="block text-sm font-medium mb-1">예약 구분</label>
              <div className="flex gap-2 flex-wrap">
                {['신규', '리터치', '시술예약', '기타'].map(t => (
                  <label key={t} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${newResType === t ? 'bg-accent text-accent-foreground border-accent' : 'bg-background hover:bg-muted'}`}>
                    <input type="radio" name="newResType" className="hidden" checked={newResType === t} onChange={() => setNewResType(t)} />
                    {t}
                  </label>
                ))}
              </div>
              {newResType === '기타' && (
                <Input className="mt-2" value={newResTypeEtc} onChange={(e) => setNewResTypeEtc(e.target.value)} placeholder="기타 내용 입력" />
              )}
            </div>
            {serviceOptions.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">시술 종류</label>
                <select value={resServiceId} onChange={(e) => setResServiceId(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">선택 (선택사항)</option>
                  {serviceOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.duration_min || 30}분/{(s.price / 10000).toFixed(0)}만)</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">메모</label>
              <Textarea value={resMemo} onChange={(e) => setResMemo(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={resetModal} className="flex-1">취소</Button>
              <Button onClick={handleCreate} disabled={!selectedCustomer || !resTime} className="flex-1 bg-accent text-accent-foreground">예약등록</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <Dialog open={!!detailRes} onOpenChange={(v) => { if (!v) setDetailRes(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>예약 상세</DialogTitle></DialogHeader>
          {detailRes && (
            <div className="space-y-4">
              <div>
                {/* KTY-RESV-CUST-EDIT: 고객 정보 인라인 편집 */}
                {custEditMode ? (
                  <div className="space-y-2 bg-muted/20 rounded-lg p-2 border">
                    <Input value={editCustName} onChange={(e) => setEditCustName(e.target.value)} placeholder="고객명" className="h-8 text-sm" />
                    <Input value={editCustPhone} onChange={(e) => setEditCustPhone(e.target.value)} placeholder="전화번호" className="h-8 text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs bg-accent text-accent-foreground" onClick={async () => {
                        if (!detailRes.customer_id || !editCustName.trim()) return;
                        const { error } = await supabase.from('customers').update({ name: editCustName.trim(), phone: editCustPhone.trim() } as any).eq('id', detailRes.customer_id);
                        if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
                        setDetailRes({ ...detailRes, customers: { ...detailRes.customers!, name: editCustName.trim(), phone: editCustPhone.trim() } });
                        setCustEditMode(false);
                        toast({ title: '고객 정보 수정 완료' });
                        fetchWeekData(clinicId, weekStart, weekEnd);
                      }}>저장</Button>
                      <Button variant="ghost" size="sm" className="flex-1 h-7 text-xs" onClick={() => setCustEditMode(false)}>취소</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      {/* PARKJG-#3 수정: 고객명 클릭 → 페이지 이탈 없이 슬라이드 패널 */}
                      <p className="font-medium text-accent cursor-pointer hover:underline" onClick={() => {
                        if (detailRes.customer_id) { setDetailRes(null); openCustPanel(detailRes.customer_id); }
                      }}>{detailRes.customers?.name}</p>
                      <p className="text-sm text-muted-foreground">{maskPhone(detailRes.customers?.phone || '')}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-muted-foreground" onClick={() => {
                      setEditCustName(detailRes.customers?.name || '');
                      setEditCustPhone(detailRes.customers?.phone || '');
                      setCustEditMode(true);
                    }}>수정</Button>
                  </div>
                )}
                {detailRes.created_by && <p className="text-[11px] text-muted-foreground mt-1">작성자: {staffMap[detailRes.created_by] || detailRes.created_by}</p>}
                {detailRes.status === 'cancelled' && (
                  <p className="text-[12px] text-gray-500 mt-1 px-2 py-1 bg-gray-50 rounded">이 예약은 취소된 상태입니다</p>
                )}
              </div>
              {/* 김태영 신규 2026-04-14: 예약 구분 라디오 (신규/리터치/시술예약/기타) */}
              <div>
                <label className="block text-sm font-medium mb-1">예약 구분</label>
                <div className="flex gap-2 flex-wrap">
                  {['신규', '리터치', '시술예약', '기타'].map(t => (
                    <label key={t} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${editReservationType === t ? 'bg-accent text-accent-foreground border-accent' : 'bg-background hover:bg-muted'}`}>
                      <input type="radio" name="resType" className="hidden" checked={editReservationType === t} onChange={() => setEditReservationType(t)} />
                      {t}
                    </label>
                  ))}
                </div>
                {editReservationType === '기타' && (
                  <Input className="mt-2" value={editReservationTypeEtc} onChange={(e) => setEditReservationTypeEtc(e.target.value)} placeholder="기타 내용 입력" />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">날짜</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start gap-2"><CalendarIcon className="h-4 w-4" />{format(editDate, 'yyyy-MM-dd (EEE)', { locale: ko })}</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    {/* 예약일 변경: 과거 불가 + 6개월 이내 (대표 결정 2026-04-13) */}
                    <Calendar mode="single" selected={editDate} onSelect={(d) => d && setEditDate(d)} disabled={(date) => {
                      const today = startOfDay(new Date());
                      const maxDate = new Date(today); maxDate.setMonth(maxDate.getMonth() + 6);
                      return date < today || date > maxDate;
                    }} className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">시간</label>
                <select value={editTime} onChange={(e) => setEditTime(e.target.value)} className="w-full h-10 rounded-md border px-3 text-sm">
                  {timeSlots.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">메모</label>
                <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} rows={2} />
              </div>
              {/* W3-07 정정: TM(예약 등록자) 표시 + admin/manager 수정 가능 */}
              <div>
                <label className="block text-sm font-medium mb-1">TM 상담사 (예약 등록자)</label>
                {canEditTm ? (
                  <select value={editCreatedBy} onChange={(e) => setEditCreatedBy(e.target.value)} className="w-full h-10 rounded-md border px-3 text-sm bg-background">
                    <option value="">(미지정)</option>
                    {staffList.map(s => (<option key={s.email} value={s.email}>{s.name} ({s.email})</option>))}
                  </select>
                ) : (
                  <div className="text-sm px-3 py-2 bg-muted/30 rounded">
                    {detailRes.created_by ? (staffMap[detailRes.created_by] || detailRes.created_by) : '미지정'}
                  </div>
                )}
              </div>

              {/* 변경이력 타임라인 (박민지 #5) */}
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">변경 이력</label>
                {detailLogs.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">아직 이력이 없습니다.</p>
                ) : (
                  <div className="space-y-1 max-h-32 overflow-y-auto border rounded p-2 bg-muted/20">
                    {detailLogs.map((log) => {
                      const actionLabel = ({
                        created: '🟢 생성',
                        modified: '✏️ 수정',
                        cancelled: '❌ 취소',
                        checked_in: '✅ 체크인',
                      } as Record<string, string>)[log.action] || log.action;
                      const who = log.created_by ? log.created_by.split('@')[0] : '시스템';
                      const when = log.created_at ? format(new Date(log.created_at), 'M/d HH:mm') : '';
                      let diffText = '';
                      if (log.action === 'modified' && log.old_values && log.new_values) {
                        const o = log.old_values, n = log.new_values;
                        const parts: string[] = [];
                        if (o.reservation_date !== n.reservation_date) parts.push(`날짜 ${o.reservation_date}→${n.reservation_date}`);
                        if (o.reservation_time !== n.reservation_time) parts.push(`시간 ${String(o.reservation_time).slice(0,5)}→${String(n.reservation_time).slice(0,5)}`);
                        if ((o.memo || '') !== (n.memo || '')) parts.push('메모변경');
                        diffText = parts.join(', ');
                      }
                      return (
                        <div key={log.id} className="text-[11px] flex items-start gap-1">
                          <span className="shrink-0">{actionLabel}</span>
                          <span className="text-muted-foreground shrink-0">{when}</span>
                          <span className="text-muted-foreground truncate">@{who}</span>
                          {diffText && <span className="text-muted-foreground truncate">— {diffText}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {(() => {
                const linkedCI = checkIns.find(ci => ci.reservation_id === detailRes.id);
                const ciStatus = linkedCI?.status || '';
                const isAbandoned = ciStatus === 'abandoned' || ciStatus === 'consult_left';
                return (
                  <div className="space-y-2">
                    {/* 1행: 상태 변경 버튼 */}
                    <div className="flex gap-2">
                      {detailRes.status === 'reserved' && !linkedCI && (
                        <Button variant="outline" className="flex-1" onClick={() => { handleCheckIn(detailRes); setDetailRes(null); }}>체크인</Button>
                      )}
                      {isAbandoned && (
                        <Button variant="outline" onClick={handleRestoreCheckIn} className="flex-1 border-green-300 text-green-600 hover:bg-green-50" title={ciStatus === 'abandoned' ? '대기후이탈 → 다시 대기로' : '상담후이탈 → 다시 대기로'}>
                          체크인 복원
                        </Button>
                      )}
                      {detailRes.status === 'cancelled' && (
                        <Button variant="outline" onClick={handleRestore} className="flex-1 border-blue-300 text-blue-600 hover:bg-blue-50" title="취소된 예약을 다시 활성화">예약 복원</Button>
                      )}
                      <Button onClick={handleUpdate} className="flex-1 bg-accent text-accent-foreground">저장</Button>
                    </div>
                    {/* 2행: 취소·삭제 */}
                    {/* 취소 버튼: 아직 취소 안 된 건에만 표시 */}
                    {/* 삭제 버튼: cancelled 아니면 항상 표시 (Q-3: 상태 변경 이후에도 삭제 허용) */}
                    {detailRes.status !== 'cancelled' && (
                      <div className="flex gap-2">
                        {!isAbandoned && (
                          <Button
                            variant="outline"
                            onClick={handleCancel}
                            className="flex-1 border-orange-300 text-orange-600 hover:bg-orange-50"
                            title="예약 취소 — 이력 남음 (고객이 못 온다고 연락한 경우)"
                          >
                            예약 취소
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="destructive"
                            onClick={handleDelete}
                            className="flex-1"
                            title="예약 삭제 — 이력 자체 제거 (실수로 잘못 예약한 경우, 관리자만)"
                          >
                            예약 삭제
                          </Button>
                        )}
                      </div>
                    )}
                    {detailRes.status !== 'cancelled' && !canDelete && (
                      <p className="text-[11px] text-muted-foreground text-center">예약 삭제(이력 제거)는 관리자(상담실장)만 가능해요</p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </DndContext>

      {/* PARKJG-0416 잔여 #3: 예약관리 내 고객 상세 슬라이드 패널 */}
      <Sheet open={!!custPanelId} onOpenChange={(v) => { if (!v) { setCustPanelId(null); setCustPanelData(null); } }}>
        <SheetContent className="w-[420px] sm:w-[420px] overflow-y-auto">
          <SheetHeader><SheetTitle>고객 이력</SheetTitle></SheetHeader>
          {custPanelData && (
            <div className="mt-4 space-y-5">
              {/* 기본 정보 */}
              <div>
                <h3 className="text-lg font-semibold">{custPanelData.name}</h3>
                <p className="text-sm text-muted-foreground">{maskPhone(custPanelData.phone)}</p>
                {custPanelData.resident_id && <p className="text-sm text-muted-foreground mt-0.5">주민번호: {custPanelData.resident_id}</p>}
                {custPanelData.memo && <p className="text-sm text-muted-foreground mt-1">{custPanelData.memo}</p>}
                <p className="text-[11px] text-muted-foreground/70 mt-1">최초등록 {format(new Date(custPanelData.created_at), 'yyyy-MM-dd')}</p>
              </div>

              {/* 방문·결제 요약 */}
              <div className="flex gap-4">
                <div className="bg-muted/50 rounded-lg px-4 py-2 flex-1 text-center">
                  <p className="text-xs text-muted-foreground">방문</p>
                  <p className="text-lg font-bold">{custVisits.length}회</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-4 py-2 flex-1 text-center">
                  <p className="text-xs text-muted-foreground">총결제</p>
                  <p className="text-lg font-bold">{custPayments.reduce((s, p) => s + p.amount, 0).toLocaleString()}원</p>
                </div>
              </div>

              {/* 예약 이력 */}
              {custReservations.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">예약 이력</h4>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {custReservations.map(r => (
                      <div key={r.id} className="text-xs border rounded px-2 py-1.5 flex justify-between items-center hover:bg-muted/30 cursor-pointer" onClick={() => {
                        setCustPanelId(null); setCustPanelData(null);
                        const target = new Date(r.reservation_date);
                        setWeekStart(startOfWeek(target, { weekStartsOn: 1 }));
                        setHighlightedId(r.id);
                        setPendingDetailId(r.id);
                        setTimeout(() => {
                          let att = 0;
                          const tryS = () => { const el = document.querySelector(`[data-highlight-id="${r.id}"]`); if (el) { (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; } if (++att < 8) setTimeout(tryS, 400); };
                          tryS();
                        }, 300);
                      }}>
                        <span>{r.reservation_date} {r.reservation_time?.slice(0, 5)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-600'}`}>
                          {r.status === 'cancelled' ? '취소' : r.status === 'reserved' ? '예약' : r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 내원 이력 */}
              {custVisits.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">내원 이력</h4>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {custVisits.map(v => {
                      const pay = custPayments.filter(p => p.check_in_id === v.id);
                      const total = pay.reduce((s, p) => s + p.amount, 0);
                      return (
                        <div key={v.id} className="text-xs border rounded px-2 py-1.5">
                          <div className="flex justify-between">
                            <span>{v.checked_in_at ? format(new Date(v.checked_in_at), 'yyyy-MM-dd HH:mm') : '-'}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${v.status === 'done' ? 'bg-emerald-50 text-emerald-600' : v.status === 'no_show' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-600'}`}>
                              {v.status === 'done' ? '완료' : v.status === 'no_show' ? '노쇼' : v.status === 'waiting' ? '대기' : v.status}
                            </span>
                          </div>
                          {v.treatment_memo && <p className="text-muted-foreground mt-0.5 truncate">{v.treatment_memo}</p>}
                          {total > 0 && <p className="text-muted-foreground mt-0.5">{total.toLocaleString()}원</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 고객이력 전체 보기 링크 */}
              <Button variant="outline" size="sm" className="w-full" onClick={() => {
                setCustPanelId(null); setCustPanelData(null);
                navigate(`/admin/customers?customer_id=${custPanelId}`);
              }}>고객이력 전체 보기 →</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AdminLayout>
  );
}
