import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { addDays, format, parseISO, startOfWeek, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  closeTimeFor,
  generateSlots,
  isOpenDay,
  openTimeFor,
  WEEK_DAYS_KO,
} from '@/lib/schedule';
import { VISIT_TYPE_KO } from '@/lib/status';
import { formatPhone, maskPhoneTail } from '@/lib/format';
import { cn } from '@/lib/utils';
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import { CustomerQuickMenu } from '@/components/CustomerQuickMenu';
import { CustomerHoverCard } from '@/components/CustomerHoverCard';
import { CustomerChartSheet } from '@/components/CustomerChartSheet';
import MedicalChartPanel from '@/components/MedicalChartPanel';
import { PaymentMiniWindow } from '@/components/PaymentMiniWindow';
import type { CheckIn, Reservation, Staff, VisitType } from '@/lib/types';

// AC-5 재오픈 fix: 모듈 레벨 클립보드 백업 — 컴포넌트 remount 시에도 상태 복원
// (navigate('/admin/reservations', { state }) + lazy/Suspense remount 케이스 대응)
let _clipboardBackup: { resv: Reservation; mode: 'copy' | 'cut' } | null = null;
let _clipboardTargetBackup: { date: string; time: string } | null = null;

const STATUS_STYLE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
  checked_in: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  noshow: 'bg-red-100 text-red-700 border-red-200',
};

// 초진(파란) / 재진(초록) / 선체험(amber)
const VISIT_TYPE_STYLE: Record<VisitType, string> = {
  new: 'border-l-[3px] border-l-blue-500 bg-blue-50/60',
  returning: 'border-l-[3px] border-l-emerald-500 bg-emerald-50/60',
  experience: 'border-l-[3px] border-l-amber-500 bg-amber-50/60',
};

const STATUS_LABEL: Record<Reservation['status'], string> = {
  confirmed: '예약',
  checked_in: '체크인',
  cancelled: '취소',
  noshow: '노쇼',
};

interface ReservationDraft {
  date: string;
  time: string;
  name: string;
  phone: string;
  visit_type: VisitType;
  memo: string;
  booking_memo: string;  // T-20260504-foot-MEMO-RESTRUCTURE: 예약 경로 확인용
  visit_route?: string;  // AC-5: 초진/예약없이방문 방문경로 (customers.visit_route에 저장)
  existingId?: string;
  service_id?: string | null;
  customer_id?: string | null;
}

type ViewMode = 'week' | 'day';

export default function Reservations() {
  const location = useLocation();
  const { profile } = useAuth();
  const changedBy = profile?.id ?? null;
  const clinic = useClinic();
  const navStateConsumed = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  // T-20260514-foot-CHART-NO-VISIBLE: AC-2 예약관리 차트번호 컬럼 (customer_id → chart_number)
  const [resvChartMap, setResvChartMap] = useState<Map<string, string>>(new Map());

  const [editor, setEditor] = useState<ReservationDraft | null>(null);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [noshowByCustomer, setNoshowByCustomer] = useState<Record<string, number>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // T-20260515-foot-RESV-DND-SHORTCUT: 키보드 클립보드 (Ctrl+C/X/V)
  // AC-5 재오픈 fix: 모듈 레벨 백업에서 초기화 → remount 후에도 클립보드 유지
  const [selectedResvId, setSelectedResvId] = useState<string | null>(null);
  const [clipboard, setClipboardState] = useState<{ resv: Reservation; mode: 'copy' | 'cut' } | null>(() => _clipboardBackup);
  const [clipboardTarget, setClipboardTargetState] = useState<{ date: string; time: string } | null>(() => _clipboardTargetBackup);
  const setClipboard = useCallback((val: { resv: Reservation; mode: 'copy' | 'cut' } | null) => {
    _clipboardBackup = val;
    setClipboardState(val);
  }, []);
  const setClipboardTarget = useCallback((val: { date: string; time: string } | null) => {
    _clipboardTargetBackup = val;
    setClipboardTargetState(val);
  }, []);

  // T-20260515-foot-RESPONSIVE-UI-SHELL: Shell-2 태블릿 풀스크린 모달
  const [tabletModalOpen, setTabletModalOpen] = useState(false);
  const [tabletModalInfo, setTabletModalInfo] = useState<{ date: string; time: string } | null>(null);
  const isTabletViewport = () => typeof window !== 'undefined' && window.innerWidth >= 769;

  // T-20260515-foot-RESV-CTX-HOVER: 예약관리 우클릭 메뉴 + hover 팝업
  const [resvContextMenu, setResvContextMenu] = useState<{ resv: Reservation; pos: { x: number; y: number } } | null>(null);
  const [resvChartSheetId, setResvChartSheetId] = useState<string | null>(null);
  const [resvMedicalChartOpen, setResvMedicalChartOpen] = useState(false);
  const [resvMedicalChartCustomerId, setResvMedicalChartCustomerId] = useState<string | null>(null);
  const [resvMiniPayTarget, setResvMiniPayTarget] = useState<CheckIn | null>(null);
  const [resvMiniPayCounter, setResvMiniPayCounter] = useState(0);

  const weekDays = useMemo(
    () => Array.from({ length: 6 }).map((_, i) => addDays(weekStart, i)), // 월~토만
    [weekStart],
  );

  // 대시보드 예약하기 바로가기 → location.state.openReservationFor 처리
  useEffect(() => {
    if (navStateConsumed.current) return;
    if (!clinic) return;
    const state = location.state as {
      openReservationFor?: {
        customer_id: string | null;
        name: string;
        phone: string;
        visit_type: VisitType;
      };
    } | null;
    if (!state?.openReservationFor) return;
    navStateConsumed.current = true;
    window.history.replaceState({}, '');
    const { name, phone, visit_type, customer_id } = state.openReservationFor;
    const today = format(new Date(), 'yyyy-MM-dd');
    setEditor({
      date: today,
      time: '10:00',
      name: name ?? '',
      phone: phone ?? '',
      visit_type,
      memo: '',
      booking_memo: '',
      visit_route: '',
      customer_id: customer_id ?? null,
    });
  }, [clinic, location.state]);

  // AC-7: 좌측 캘린더 날짜 클릭 → 해당 날짜 포함 주로 이동
  useEffect(() => {
    const state = location.state as { goToWeekOf?: string } | null;
    if (!state?.goToWeekOf) return;
    window.history.replaceState({}, '');
    const targetDate = parseISO(state.goToWeekOf);
    setWeekStart(startOfWeek(targetDate, { weekStartsOn: 1 }));
    setViewMode('week');
  }, [location.state]);

  const fetchWeek = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const startStr = viewMode === 'week'
      ? format(weekDays[0], 'yyyy-MM-dd')
      : format(selectedDay, 'yyyy-MM-dd');
    const endStr = viewMode === 'week'
      ? format(weekDays[weekDays.length - 1], 'yyyy-MM-dd')
      : startStr;
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('clinic_id', clinic.id)
      .gte('reservation_date', startStr)
      .lte('reservation_date', endStr)
      .order('reservation_time', { ascending: true });
    if (error) {
      toast.error('예약 목록 로딩 실패');
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Reservation[];

    // Auto noshow: past confirmed reservations
    const today = format(new Date(), 'yyyy-MM-dd');
    const pastConfirmed = list.filter(
      (r) => r.status === 'confirmed' && r.reservation_date < today,
    );
    if (pastConfirmed.length > 0) {
      await supabase
        .from('reservations')
        .update({ status: 'noshow' })
        .in('id', pastConfirmed.map((r) => r.id));
      for (const r of pastConfirmed) r.status = 'noshow';
    }

    setRows(list);
    setLoading(false);

    // 노쇼 이력 집계
    const customerIds = Array.from(
      new Set(list.map((r) => r.customer_id).filter((x): x is string => !!x)),
    );
    if (customerIds.length > 0) {
      const { data: nsData } = await supabase
        .from('reservations')
        .select('customer_id')
        .in('customer_id', customerIds)
        .eq('status', 'noshow');
      const counts: Record<string, number> = {};
      for (const row of nsData ?? []) {
        const id = (row as { customer_id: string | null }).customer_id;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
      setNoshowByCustomer(counts);

      // T-20260514-foot-CHART-NO-VISIBLE: AC-2 차트번호 컬럼용 사전 로드
      const { data: chartData } = await supabase
        .from('customers')
        .select('id, chart_number')
        .in('id', customerIds);
      const chartM = new Map<string, string>();
      for (const c of (chartData ?? []) as { id: string; chart_number: string | null }[]) {
        if (c.chart_number) chartM.set(c.id, c.chart_number);
      }
      setResvChartMap(chartM);
    } else {
      setNoshowByCustomer({});
      setResvChartMap(new Map());
    }
  }, [clinic, weekDays, viewMode, selectedDay]);

  useEffect(() => {
    fetchWeek();
  }, [fetchWeek]);

  // Realtime
  useEffect(() => {
    if (!clinic) return;
    const ch = supabase
      .channel(`reservations_${clinic.id}_${format(weekStart, 'yyyyMMdd')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinic.id}` },
        () => fetchWeek(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [clinic, weekStart, fetchWeek]);

  // T-20260515-foot-RESV-DND-SHORTCUT: 키보드 단축키 핸들러 (Ctrl+C/X/V, Escape)
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // 텍스트 입력 중이거나 다이얼로그 열려있으면 무시
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (detail !== null || editor !== null) return;

      if (e.key === 'Escape') {
        setSelectedResvId(null);
        setClipboard(null);
        setClipboardTarget(null);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;

      const r = selectedResvId ? rows.find((x) => x.id === selectedResvId) : null;

      if (e.key === 'c' && r && r.status === 'confirmed') {
        e.preventDefault();
        setClipboard({ resv: r, mode: 'copy' });
        setClipboardTarget(null);
        toast.info(`${r.customer_name} 복사됨 — 붙여넣기할 슬롯 클릭 후 Ctrl+V`, { duration: 4000 });
        return;
      }

      if (e.key === 'x' && r && r.status === 'confirmed') {
        e.preventDefault();
        setClipboard({ resv: r, mode: 'cut' });
        setClipboardTarget(null);
        toast.info(`${r.customer_name} 잘라내기됨 — 이동할 슬롯 클릭 후 Ctrl+V`, { duration: 4000 });
        return;
      }

      if (e.key === 'v' && clipboard && clipboardTarget && clinic) {
        e.preventDefault();
        const cb = clipboard;
        const target = clipboardTarget;
        // AC-5: resv 객체를 직접 사용 → 날짜 이동 후에도 rows 재조회 불필요
        const srcRow = cb.resv;

        // 슬롯 충돌 확인
        const activeInSlot = rows.filter(
          (x) =>
            x.reservation_date === target.date &&
            x.reservation_time.slice(0, 5) === target.time &&
            x.status !== 'cancelled',
        ).length;
        if (activeInSlot >= 12) {
          toast.error('해당 시간에 이미 예약이 있습니다');
          return;
        }

        if (cb.mode === 'copy') {
          const { data, error } = await supabase
            .from('reservations')
            .insert({
              clinic_id: clinic.id,
              customer_id: srcRow.customer_id,
              customer_name: srcRow.customer_name,
              customer_phone: srcRow.customer_phone,
              reservation_date: target.date,
              reservation_time: target.time,
              visit_type: srcRow.visit_type,
              memo: srcRow.memo,
              booking_memo: srcRow.booking_memo,
              status: 'confirmed',
            })
            .select('id')
            .single();
          if (error) {
            toast.error(`복사 실패: ${error.message}`);
            return;
          }
          await supabase.from('reservation_logs').insert({
            reservation_id: (data as { id: string }).id,
            clinic_id: clinic.id,
            action: 'create',
            old_data: null,
            new_data: {
              date: target.date,
              time: target.time,
              visit_type: srcRow.visit_type,
              customer_name: srcRow.customer_name,
              customer_phone: srcRow.customer_phone,
              via: 'keyboard_copy',
              source_id: cb.resv.id,
            },
            changed_by: changedBy,
          });
          toast.success(`${srcRow.customer_name} 복사 완료 → ${target.date} ${target.time}`);
        } else {
          // cut → 이동 (낙관적 업데이트)
          if (srcRow.status !== 'confirmed') return;
          if (
            srcRow.reservation_date === target.date &&
            srcRow.reservation_time.slice(0, 5) === target.time
          ) return;

          setRows((prev) =>
            prev.map((x) =>
              x.id === cb.resv.id
                ? { ...x, reservation_date: target.date, reservation_time: target.time }
                : x,
            ),
          );
          const { error: moveErr } = await supabase
            .from('reservations')
            .update({ reservation_date: target.date, reservation_time: target.time })
            .eq('id', cb.resv.id);
          if (moveErr) {
            setRows((prev) =>
              prev.map((x) =>
                x.id === cb.resv.id
                  ? { ...x, reservation_date: srcRow.reservation_date, reservation_time: srcRow.reservation_time }
                  : x,
              ),
            );
            toast.error(`이동 실패: ${moveErr.message}`);
            return;
          }
          await supabase.from('reservation_logs').insert({
            reservation_id: cb.resv.id,
            clinic_id: clinic.id,
            action: 'reschedule',
            old_data: { date: srcRow.reservation_date, time: srcRow.reservation_time.slice(0, 5) },
            new_data: { date: target.date, time: target.time },
            changed_by: changedBy,
          });
          const sameDay = srcRow.reservation_date === target.date;
          toast.success(
            sameDay
              ? `${srcRow.customer_name} ${srcRow.reservation_time.slice(0, 5)} → ${target.time} 이동 완료`
              : `${srcRow.customer_name} 이동 완료: ${srcRow.reservation_date} → ${target.date} ${target.time}`,
          );
        }

        setClipboard(null);
        setClipboardTarget(null);
        setSelectedResvId(null);
        fetchWeek();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedResvId, rows, clipboard, clipboardTarget, detail, editor, clinic, changedBy, fetchWeek]);

  const slotsFor = useCallback(
    (d: Date): string[] => {
      if (!clinic) return [];
      return generateSlots(openTimeFor(clinic), closeTimeFor(d, clinic), clinic.slot_interval);
    },
    [clinic],
  );

  const resvByKey = useMemo(() => {
    const map: Record<string, Reservation[]> = {};
    for (const r of rows) {
      const key = `${r.reservation_date}_${r.reservation_time.slice(0, 5)}`;
      (map[key] ??= []).push(r);
    }
    return map;
  }, [rows]);

  const slotActiveCount = useCallback(
    (dateStr: string, time: string) => {
      const list = resvByKey[`${dateStr}_${time}`] ?? [];
      return list.filter((r) => r.status !== 'cancelled').length;
    },
    [resvByKey],
  );

  // AC-1: 시간당 초진 6건 + 재진 6건 = 합 12건 상한 (하드코딩, clinic.max_per_slot 불사용)
  const SLOT_MAX_TOTAL = 12;
  const isSlotFull = useCallback(
    (dateStr: string, time: string) => {
      return slotActiveCount(dateStr, time) >= SLOT_MAX_TOTAL;
    },
    [slotActiveCount],
  );

  const openNewSlot = (d: Date, time: string) => {
    // T-20260515-foot-RESPONSIVE-UI-SHELL Shell-2: 태블릿(>=769px)에서 풀스크린 모달
    if (isTabletViewport()) {
      setTabletModalInfo({ date: format(d, 'yyyy-MM-dd'), time });
      setTabletModalOpen(true);
      return;
    }
    setEditor({
      date: format(d, 'yyyy-MM-dd'),
      time,
      name: '',
      phone: '',
      visit_type: 'returning',
      memo: '',
      booking_memo: '',
      visit_route: '',
    });
  };

  const openEdit = (r: Reservation) => {
    setEditor({
      existingId: r.id,
      date: r.reservation_date,
      time: r.reservation_time.slice(0, 5),
      name: r.customer_name ?? '',
      phone: r.customer_phone ?? '',
      visit_type: r.visit_type,
      memo: r.memo ?? '',
      booking_memo: r.booking_memo ?? '',
      visit_route: '',  // AC-5: 편집 시 기존 방문경로 미리 불러오지 않음 (변경 시에만 덮어씀)
    });
    setDetail(null);
  };

  const batchCheckIn = async (confirmed: Reservation[]) => {
    if (!clinic || confirmed.length === 0) return;
    if (!window.confirm(`${confirmed.length}건의 예약을 일괄 체크인하시겠습니까?`)) return;
    const payload = confirmed.map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      customer_name: r.customer_name ?? '',
      customer_phone: r.customer_phone,
      visit_type: r.visit_type,
      reservation_date: r.reservation_date,
    }));
    const { data, error } = await supabase.rpc('batch_checkin', {
      p_clinic_id: clinic.id,
      p_reservations: payload,
    });
    if (error) {
      toast.error(`일괄 체크인 실패: ${error.message}`);
      return;
    }
    const result = data as { success: number; skipped: number };
    const msg = result.skipped > 0
      ? `${result.success}건 체크인, ${result.skipped}건 중복 스킵`
      : `${result.success}건 일괄 체크인 완료`;
    toast.success(msg);
    fetchWeek();
  };

  const reschedule = async (reservationId: string, newDate: string, newTime: string) => {
    if (!clinic) return;
    const r = rows.find((x) => x.id === reservationId);
    if (!r || r.status !== 'confirmed') return;
    if (r.reservation_date === newDate && r.reservation_time.slice(0, 5) === newTime) return;

    const activeCount = slotActiveCount(newDate, newTime);
    if (activeCount >= 12) {
      toast.error(`해당 시간에 이미 예약이 있습니다 (${activeCount}/12)`);
      return;
    }

    const oldData = { date: r.reservation_date, time: r.reservation_time.slice(0, 5) };
    const newData = { date: newDate, time: newTime };

    // 낙관적 업데이트: UI 먼저 반영
    setRows((prev) =>
      prev.map((x) =>
        x.id === reservationId
          ? { ...x, reservation_date: newDate, reservation_time: newTime }
          : x,
      ),
    );

    const { error } = await supabase
      .from('reservations')
      .update({ reservation_date: newDate, reservation_time: newTime })
      .eq('id', reservationId);
    if (error) {
      // 실패 시 롤백
      setRows((prev) =>
        prev.map((x) =>
          x.id === reservationId
            ? { ...x, reservation_date: r.reservation_date, reservation_time: r.reservation_time }
            : x,
        ),
      );
      toast.error(`이동 실패: ${error.message}`);
      return;
    }

    await supabase.from('reservation_logs').insert({
      reservation_id: reservationId,
      clinic_id: clinic.id,
      action: 'reschedule',
      old_data: oldData,
      new_data: newData,
      changed_by: changedBy,
    });

    const sameDay = oldData.date === newData.date;
    toast.success(
      sameDay
        ? `${r.customer_name} ${oldData.time} → ${newData.time} 이동 완료`
        : `${r.customer_name} 이동 완료: ${oldData.date} ${oldData.time} → ${newData.date} ${newData.time}`,
    );
    fetchWeek();
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDrop = (e: React.DragEvent, dateStr: string, time: string) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    if (id) reschedule(id, dateStr, time);
    setDraggedId(null);
  };

  // T-20260515-foot-RESV-CTX-HOVER: Reservation → minimal CheckIn 어댑터
  // CustomerQuickMenu / CustomerHoverCard가 사용하는 필드만 매핑; 나머지는 타입 캐스트
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
  }), [clinic?.id]);

  // T-20260515-foot-RESV-CTX-HOVER: 핸들러
  const handleResvOpenChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    setResvChartSheetId(ci.customer_id);
  }, []);

  const handleResvOpenMedicalChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    setResvMedicalChartCustomerId(ci.customer_id);
    setResvMedicalChartOpen(true);
  }, []);

  const handleResvNewReservation = useCallback((ci: CheckIn) => {
    setEditor({
      date: format(selectedDay, 'yyyy-MM-dd'),
      time: '',
      name: ci.customer_name ?? '',
      phone: ci.customer_phone ?? '',
      visit_type: ci.visit_type,
      memo: '',
      booking_memo: '',
      customer_id: ci.customer_id,
    });
  }, [selectedDay]);

  const handleResvOpenPayment = useCallback(async (ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    // 체크인 기록 조회 (reservation_id 기준)
    if (ci.reservation_id) {
      const { data } = await supabase
        .from('check_ins')
        .select('*')
        .eq('reservation_id', ci.reservation_id)
        .maybeSingle();
      if (data) {
        setResvMiniPayTarget(data as CheckIn);
        setResvMiniPayCounter((c) => c + 1);
        return;
      }
    }
    toast.info('체크인 후 수납이 가능합니다');
  }, []);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => {
              if (viewMode === 'week') setWeekStart((w) => addDays(w, -7));
              else setSelectedDay((d) => addDays(d, -1));
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[200px] text-center text-sm font-medium">
            {viewMode === 'week'
              ? `${format(weekDays[0], 'yyyy년 M월 d일', { locale: ko })} ~ ${format(weekDays[5], 'M월 d일')}`
              : format(selectedDay, 'yyyy년 M월 d일 (EEE)', { locale: ko })
            }
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => {
              if (viewMode === 'week') setWeekStart((w) => addDays(w, 7));
              else setSelectedDay((d) => addDays(d, 1));
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (viewMode === 'week') setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
              else setSelectedDay(new Date());
            }}
          >
            {viewMode === 'week' ? '이번 주' : '오늘'}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* T-20260513-foot-RESV-PLUS-PHONE-SEARCH: 페이지 상단 새 예약 버튼 — InlinePatientSearch(phone) 연결 */}
          <Button
            size="sm"
            onClick={() => {
              const today = format(new Date(), 'yyyy-MM-dd');
              setEditor({
                date: today,
                time: '10:00',
                name: '',
                phone: '',
                visit_type: 'returning',
                memo: '',
                booking_memo: '',
                visit_route: '',
                customer_id: null,
              });
            }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            새 예약
          </Button>
          <div className="flex rounded-md border">
            <button
              onClick={() => setViewMode('day')}
              className={cn('px-3 py-1 text-xs font-medium transition', viewMode === 'day' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted')}
            >
              일간
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={cn('px-3 py-1 text-xs font-medium transition', viewMode === 'week' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted')}
            >
              주간
            </button>
          </div>
        </div>
      </div>

      {/* T-20260515-foot-RESV-DND-SHORTCUT: 클립보드 상태 힌트 바 */}
      {clipboard && (
        <div
          data-testid="clipboard-hint"
          className="mb-2 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs"
        >
          <span className="text-amber-700">
            {clipboard.mode === 'copy' ? '📋 복사 대기' : '✂️ 이동 대기'}:{' '}
            <span className="font-semibold">
              {clipboard.resv.customer_name}
            </span>
            {clipboardTarget
              ? ` → ${clipboardTarget.date} ${clipboardTarget.time} (Ctrl+V로 붙여넣기)`
              : ' — 슬롯 클릭 후 Ctrl+V / Esc로 취소'}
          </span>
          <button
            onClick={() => { setClipboard(null); setClipboardTarget(null); }}
            className="ml-2 text-amber-400 hover:text-amber-700 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : (
          <table className="w-full min-w-[700px] border-collapse text-sm">{/* T-20260515-foot-RESPONSIVE-SHELL: min-w 추가 → 모바일 수평 스크롤 활성화 */}
            <thead className="sticky top-0 z-10 bg-muted/60">
              <tr>
                {/* T-20260515-foot-RESPONSIVE-UI-SHELL Shell-1: 시간축 sticky left-0 (모바일 수평 스크롤 시 고정) */}
              <th
                data-testid="resv-time-col-header"
                className="w-20 border-b border-r py-2 text-xs font-medium text-muted-foreground sticky left-0 z-20 bg-muted/60"
              >
                시간
              </th>
                {(viewMode === 'week' ? weekDays : [selectedDay]).map((d, i) => (
                  <th
                    key={d.toISOString()}
                    className={cn(
                      'border-b border-r p-2 text-left text-xs font-medium',
                      !isOpenDay(d) && 'bg-gray-50 text-muted-foreground',
                      isSameDay(d, new Date()) && 'bg-teal-50 text-teal-700',
                    )}
                  >
                    {WEEK_DAYS_KO[i]} {format(d, 'M/d')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clinic &&
                generateSlots(
                  clinic.open_time,
                  // day view: 선택된 날짜의 close_time 사용 (토요일=18:30, 평일=20:30)
                  // week view: clinic.close_time(평일 최대) 기준으로 그리드 행 생성, 토요일 열은 allowed=false로 그레이아웃
                  viewMode === 'day' ? closeTimeFor(selectedDay, clinic) : clinic.close_time,
                  clinic.slot_interval,
                ).map(
                  (time) => (
                    <tr key={time}>
                      {/* T-20260515-foot-RESPONSIVE-UI-SHELL Shell-1: 시간축 sticky left-0 */}
                      <td
                        data-testid="resv-time-col-cell"
                        className="w-20 border-b border-r py-1.5 text-center text-xs font-medium text-muted-foreground sticky left-0 bg-background z-10"
                      >
                        {time}
                      </td>
                      {(viewMode === 'week' ? weekDays : [selectedDay]).map((d) => {
                        const allowed = slotsFor(d).includes(time);
                        const dateStr = format(d, 'yyyy-MM-dd');
                        const key = `${dateStr}_${time}`;
                        const list = resvByKey[key] ?? [];
                        const full = isSlotFull(dateStr, time);
                        const activeCount = slotActiveCount(dateStr, time);
                        const cellKey = `${dateStr}_${time}`;
                        const isDragOver = dropTarget === cellKey;
                        // T-20260515-foot-RESV-DND-SHORTCUT: 클립보드 타겟 슬롯 하이라이트
                        const isClipboardTarget =
                          !!clipboard &&
                          clipboardTarget?.date === dateStr &&
                          clipboardTarget?.time === time;
                        return (
                          <td
                            key={d.toISOString() + time}
                            className={cn(
                              'h-12 border-b border-r p-1 align-top transition-colors',
                              !allowed && 'bg-gray-50',
                              full && !isDragOver && 'bg-red-50',
                              isDragOver && allowed && !full && 'bg-teal-50 ring-2 ring-inset ring-teal-400',
                              isDragOver && full && 'bg-red-100 ring-2 ring-inset ring-red-400',
                              isClipboardTarget && 'bg-green-50 ring-2 ring-inset ring-green-400',
                            )}
                            onDragOver={(e) => { if (allowed) { e.preventDefault(); setDropTarget(cellKey); } }}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(e) => { if (allowed) handleDrop(e, dateStr, time); }}
                            onClick={() => {
                              if (clipboard && allowed) setClipboardTarget({ date: dateStr, time });
                            }}
                          >
                            {allowed && (
                              <div className="flex h-full w-full flex-col gap-0.5 rounded text-left">

                                {list.map((r) => (
                                  <div
                                    key={r.id}
                                    data-testid={`resv-card-${r.id}`}
                                    draggable={r.status === 'confirmed'}
                                    onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, r.id); }}
                                    onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedResvId(r.id);
                                      // T-20260515-foot-RESPONSIVE-UI-SHELL Shell-2: 태블릿 풀스크린 모달
                                      if (isTabletViewport()) {
                                        setTabletModalInfo({ date: r.reservation_date, time: r.reservation_time.slice(0, 5) });
                                        setTabletModalOpen(true);
                                      } else {
                                        setDetail(r);
                                      }
                                    }}
                                    className={cn(
                                      'rounded border px-1.5 py-0.5 text-xs leading-tight transition-opacity',
                                      r.status === 'confirmed' && 'cursor-grab active:cursor-grabbing',
                                      draggedId === r.id && 'opacity-40',
                                      STATUS_STYLE[r.status],
                                      VISIT_TYPE_STYLE[r.visit_type],
                                      // AC-3: 내원완료(checked_in) → 희미하게, 미내원(confirmed) → 진하게 (T-20260514-foot-CHECKIN-AUTO-STAGE)
                                      r.status === 'checked_in' && draggedId !== r.id && 'opacity-50',
                                      // T-20260515-foot-RESV-DND-SHORTCUT: 클립보드 시각적 피드백
                                      selectedResvId === r.id && !clipboard && 'ring-2 ring-teal-500',
                                      clipboard?.resv.id === r.id && clipboard.mode === 'copy' && 'ring-2 ring-blue-400',
                                      clipboard?.resv.id === r.id && clipboard.mode === 'cut' && 'opacity-60 ring-2 ring-amber-400',
                                    )}
                                  >
                                    <div className="flex items-center gap-1">
                                      {/* T-20260515-foot-RESV-CTX-HOVER: hover 팝업 + 우클릭 컨텍스트 메뉴
                                          취소된 예약 / 미연결 고객은 기존 plain span 유지 */}
                                      {r.customer_id && r.status !== 'cancelled' ? (
                                        <CustomerHoverCard
                                          checkIn={resvAsCheckIn(r)}
                                          reservationTime={r.reservation_time}
                                          compact
                                          onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } });
                                          }}
                                        />
                                      ) : (
                                        <span
                                          className={cn(
                                            'font-semibold',
                                            r.customer_id && 'cursor-pointer hover:underline hover:text-teal-700 transition-colors',
                                            r.status === 'cancelled' && 'line-through',
                                          )}
                                          onClick={(e) => {
                                            if (!r.customer_id) return;
                                            e.stopPropagation();
                                            window.open(
                                              `/chart/${r.customer_id}`,
                                              `chart-${r.customer_id}`,
                                              'width=820,height=960,scrollbars=yes,resizable=yes',
                                            );
                                          }}
                                        >
                                          {r.customer_name}
                                        </span>
                                      )}
                                      {/* T-20260515-foot-RESV-CANCEL: 취소됨 배지 */}
                                      {r.status === 'cancelled' && (
                                        <span className="text-[9px] bg-gray-200 text-gray-500 rounded px-0.5 leading-none">취소됨</span>
                                      )}
                                      {/* T-20260514-foot-CHART-NO-VISIBLE: AC-2 차트번호 상시 표시 */}
                                      {r.customer_id && resvChartMap.get(r.customer_id) && (
                                        <span className="text-[10px] font-mono text-teal-600">
                                          #{resvChartMap.get(r.customer_id)}
                                        </span>
                                      )}
                                      {r.customer_id && noshowByCustomer[r.customer_id] ? (
                                        <Badge variant="destructive" className="h-4 px-1 text-xs">
                                          노쇼 {noshowByCustomer[r.customer_id]}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {/* RESV-SLOT-INFO: 방문유형·상태 + 전화번호 뒷4자리 */}
                                    <div className="text-xs opacity-80 flex items-center gap-1">
                                      <span className={cn(
                                        'inline-block h-1.5 w-1.5 rounded-full',
                                        r.visit_type === 'new' ? 'bg-blue-500' : 'bg-emerald-500',
                                      )} />
                                      {VISIT_TYPE_KO[r.visit_type]} · {STATUS_LABEL[r.status]}
                                      {r.customer_phone && (
                                        <span className="text-muted-foreground">
                                          · ···{maskPhoneTail(r.customer_phone)}
                                        </span>
                                      )}
                                    </div>
                                    {/* T-20260515-foot-INLINE-RESV AC-4: 예약메모 한눈에 표시 */}
                                    {r.booking_memo && (
                                      <div
                                        className="truncate text-[10px] text-amber-600"
                                        title={r.booking_memo}
                                      >
                                        📝 {r.booking_memo}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {(() => {
                                  const confirmed = list.filter((r) => r.status === 'confirmed');
                                  return confirmed.length > 0 ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        batchCheckIn(confirmed);
                                      }}
                                      className="w-full mt-0.5 rounded bg-teal-50 border border-teal-200 px-1 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-100 transition"
                                    >
                                      일괄 배치 ({confirmed.length})
                                    </button>
                                  ) : null;
                                })()}
                                {!full ? (
                                  <button
                                    data-testid={`slot-plus-${dateStr}-${time}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (clipboard) {
                                        setClipboardTarget({ date: dateStr, time });
                                      } else {
                                        openNewSlot(d, time);
                                      }
                                    }}
                                    className={cn(
                                      'flex items-center justify-center rounded border border-dashed border-muted-foreground/30 text-muted-foreground/50 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600 transition',
                                      list.length === 0 ? 'flex-1 min-h-[24px]' : 'h-5 w-full mt-0.5',
                                    )}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                ) : list.length === 0 ? (
                                  <span className="m-auto text-xs font-medium text-red-500">마감</span>
                                ) : null}
                                {clinic && activeCount > 0 && (
                                  <span className={cn(
                                    'mt-auto self-end text-[10px] tabular-nums',
                                    full ? 'text-red-500 font-medium' : 'text-muted-foreground',
                                  )}>
                                    {activeCount}/{clinic.max_per_slot}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ),
                )}
            </tbody>
          </table>
        )}
      </div>

      {/* T-20260515-foot-RESPONSIVE-UI-SHELL Shell-2: 태블릿 풀스크린 모달 */}
      <TabletFullscreenModal
        open={tabletModalOpen}
        info={tabletModalInfo}
        onClose={() => { setTabletModalOpen(false); setTabletModalInfo(null); }}
      />

      <ReservationEditor
        draft={editor}
        clinicId={clinic?.id}
        maxPerSlot={12}
        changedBy={changedBy}
        onClose={() => setEditor(null)}
        onSaved={() => {
          setEditor(null);
          fetchWeek();
        }}
      />

      <ReservationDetail
        reservation={detail}
        noshowCount={
          detail?.customer_id ? noshowByCustomer[detail.customer_id] ?? 0 : 0
        }
        changedBy={changedBy}
        isAdmin={profile?.role === 'admin'}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
        onChanged={() => {
          setDetail(null);
          fetchWeek();
        }}
      />

      {/* T-20260515-foot-RESV-CTX-HOVER: 예약관리 우클릭 메뉴 + hover 팝업 오버레이 */}
      <CustomerQuickMenu
        checkIn={resvContextMenu ? resvAsCheckIn(resvContextMenu.resv) : null}
        position={resvContextMenu?.pos ?? null}
        onClose={() => setResvContextMenu(null)}
        onOpenChart={handleResvOpenChart}
        onOpenMedicalChart={handleResvOpenMedicalChart}
        onNewReservation={handleResvNewReservation}
        onOpenPayment={handleResvOpenPayment}
      />

      <CustomerChartSheet
        customerId={resvChartSheetId}
        onClose={() => setResvChartSheetId(null)}
      />

      <MedicalChartPanel
        open={resvMedicalChartOpen}
        onOpenChange={(v) => { if (!v) { setResvMedicalChartOpen(false); setResvMedicalChartCustomerId(null); } }}
        customerId={resvMedicalChartCustomerId}
        clinicId={clinic?.id ?? ''}
        currentUserRole={profile?.role ?? ''}
        currentUserEmail={profile?.email ?? null}
      />

      <PaymentMiniWindow
        key={`resv-mini-${resvMiniPayTarget?.id ?? 'none'}-${resvMiniPayCounter}`}
        checkIn={resvMiniPayTarget}
        onClose={() => setResvMiniPayTarget(null)}
        onComplete={() => setResvMiniPayTarget(null)}
        onSaved={() => { toast.success('수납 완료'); setResvMiniPayTarget(null); }}
      />
    </div>
  );
}

// T-20260515-foot-RESV-THERAPIST-HIST: 치료사 이력 타입
interface TherapistHistoryInfo {
  /** 최빈 담당 치료사 (null = 미배정) */
  primaryTherapistId: string | null;
  primaryTherapistName: string | null;
  /** 최근 체크인 날짜 */
  lastVisitDate: string | null;
  /** 직전 치료 요약 (treatment_kind + treatment_contents 조합) */
  lastTreatmentSummary: string | null;
  /** 직전 치료의 담당 치료사 */
  lastTherapistName: string | null;
}

function ReservationEditor({
  draft,
  clinicId,
  maxPerSlot,
  changedBy,
  onClose,
  onSaved,
}: {
  draft: ReservationDraft | null;
  clinicId: string | undefined;
  maxPerSlot: number;
  changedBy: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<ReservationDraft | null>(draft);
  const [submitting, setSubmitting] = useState(false);

  // T-20260515-foot-RESV-THERAPIST-HIST: AC-1/2/3 상태
  const [therapistHistory, setTherapistHistory] = useState<TherapistHistoryInfo | null>(null);
  const [therapistHistoryLoading, setTherapistHistoryLoading] = useState(false);
  const [therapistList, setTherapistList] = useState<Staff[]>([]);
  const [overrideTherapistId, setOverrideTherapistId] = useState<string | ''>('');

  useEffect(() => {
    setState(draft);
    // draft 리셋 시 이력 초기화
    setTherapistHistory(null);
    setOverrideTherapistId('');
  }, [draft]);

  // T-20260515-foot-RESV-THERAPIST-HIST: 재진 + customer_id 변경 시 치료사 이력 조회
  useEffect(() => {
    const customerId = state?.customer_id;
    const visitType = state?.visit_type;

    if (!customerId || visitType !== 'returning' || !clinicId) {
      setTherapistHistory(null);
      setOverrideTherapistId('');
      return;
    }

    let cancelled = false;
    setTherapistHistoryLoading(true);

    const fetchHistory = async () => {
      // 1) 최근 체크인 최대 20건 조회 (therapist_id 빈도 분석 + 최근 이력)
      const { data: ciData } = await supabase
        .from('check_ins')
        .select('id, therapist_id, checked_in_at, treatment_kind, treatment_contents')
        .eq('customer_id', customerId)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: false })
        .limit(20);

      if (cancelled) return;
      const visits = (ciData ?? []) as Array<{
        id: string;
        therapist_id: string | null;
        checked_in_at: string;
        treatment_kind: string | null;
        treatment_contents: string[] | null;
      }>;

      // 2) 치료사 목록 조회 (아직 없으면 한 번만)
      if (therapistList.length === 0) {
        const { data: staffData } = await supabase
          .from('staff')
          .select('id, name, role, clinic_id, active, created_at')
          .eq('clinic_id', clinicId)
          .eq('active', true)
          .eq('role', 'therapist')
          .order('name');
        if (!cancelled) setTherapistList((staffData ?? []) as Staff[]);
      }

      if (cancelled) return;

      // 3) 최빈 치료사 판단
      const freqMap: Record<string, number> = {};
      for (const v of visits) {
        if (v.therapist_id) freqMap[v.therapist_id] = (freqMap[v.therapist_id] ?? 0) + 1;
      }
      const primaryTherapistId = Object.entries(freqMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      // 4) 직전 치료이력 (visits[0])
      const last = visits[0] ?? null;
      const lastVisitDate = last ? last.checked_in_at.slice(0, 10) : null;
      const lastTreatmentSummary = last
        ? [last.treatment_kind, ...(last.treatment_contents ?? [])].filter(Boolean).join(' · ') || null
        : null;
      const lastTherapistId = last?.therapist_id ?? null;

      // 5) 치료사 이름 조회 (staffData 재활용)
      const { data: allStaff } = await supabase
        .from('staff')
        .select('id, name')
        .in('id', [primaryTherapistId, lastTherapistId].filter((x): x is string => !!x));

      if (cancelled) return;
      const staffMap = new Map((allStaff ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));

      const info: TherapistHistoryInfo = {
        primaryTherapistId,
        primaryTherapistName: primaryTherapistId ? (staffMap.get(primaryTherapistId) ?? null) : null,
        lastVisitDate,
        lastTreatmentSummary,
        lastTherapistName: lastTherapistId ? (staffMap.get(lastTherapistId) ?? null) : null,
      };
      setTherapistHistory(info);
      // override 초기값 = 최빈 치료사
      setOverrideTherapistId(primaryTherapistId ?? '');
      setTherapistHistoryLoading(false);
    };

    fetchHistory().catch(() => {
      if (!cancelled) setTherapistHistoryLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.customer_id, state?.visit_type, clinicId]);

  if (!state) return null;

  const update = <K extends keyof ReservationDraft>(k: K, v: ReservationDraft[K]) =>
    setState((s) => (s ? { ...s, [k]: v } : s));

  /** 인라인 검색 드롭다운에서 기존 환자 선택 */
  const handlePatientSelect = (p: PatientMatch) => {
    setState((s) =>
      s ? { ...s, name: p.name, phone: p.phone, customer_id: p.id, visit_type: 'returning' } : s,
    );
    toast.info(`${p.name}님 선택`);
  };

  const save = async () => {
    if (!clinicId || !state) return;
    setSubmitting(true);

    if (!state.existingId) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('reservation_date', state.date)
        .eq('reservation_time', state.time)
        .neq('status', 'cancelled');
      if ((count ?? 0) >= maxPerSlot) {
        toast.error(`이 시간대는 마감입니다 (${count}/${maxPerSlot})`);
        setSubmitting(false);
        return;
      }
    }

    let customerId: string | null = state.customer_id ?? null;

    if (!state.existingId && customerId) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('reservation_date', state.date)
        .neq('status', 'cancelled');
      if ((count ?? 0) > 0) {
        if (!window.confirm(`${state.name}님은 이미 ${state.date}에 예약이 있습니다. 계속하시겠습니까?`)) {
          setSubmitting(false);
          return;
        }
      }
    }

    if (!customerId && state.phone.trim()) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('phone', state.phone.trim())
        .maybeSingle();
      if (existing) customerId = existing.id as string;
      else {
        const { data: created, error } = await supabase
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: state.name.trim(),
            phone: state.phone.trim(),
            visit_type: state.visit_type === 'new' ? 'new' : 'returning',
          })
          .select('id')
          .single();
        if (error) {
          toast.error(error.code === '23505' ? '이미 등록된 전화번호입니다' : `고객 생성 실패: ${error.message}`);
          setSubmitting(false);
          return;
        }
        customerId = (created as { id: string }).id;
      }
    }

    // AC-5: 초진이고 방문경로 선택 시 customers.visit_route 업데이트
    if (customerId && state.visit_type === 'new' && state.visit_route) {
      await supabase
        .from('customers')
        .update({ visit_route: state.visit_route })
        .eq('id', customerId);
    }

    const payload = {
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: state.name.trim(),
      customer_phone: state.phone.trim() || null,
      reservation_date: state.date,
      reservation_time: state.time,
      visit_type: state.visit_type,
      service_id: state.service_id || null,
      memo: state.memo.trim() || null,
      // T-20260504-foot-MEMO-RESTRUCTURE: 예약 경로 확인용 메모
      booking_memo: state.booking_memo?.trim() || null,
    };

    // 수정 전 원본 캡처 (감사 로그용)
    let prevRow: Record<string, unknown> | null = null;
    if (state.existingId) {
      const { data: prev } = await supabase
        .from('reservations')
        .select('reservation_date, reservation_time, visit_type, customer_name, customer_phone, service_id, memo')
        .eq('id', state.existingId)
        .maybeSingle();
      prevRow = (prev as Record<string, unknown>) ?? null;
    }

    const result = state.existingId
      ? await supabase.from('reservations').update(payload).eq('id', state.existingId).select('id').maybeSingle()
      : await supabase.from('reservations').insert({ ...payload, status: 'confirmed' }).select('id').maybeSingle();

    if (result.error) {
      toast.error(`저장 실패: ${result.error.message}`);
      setSubmitting(false);
      return;
    }

    // 감사 로그 — create / update / reschedule
    const savedId = (result.data as { id: string } | null)?.id ?? state.existingId;
    if (savedId) {
      if (state.existingId && prevRow) {
        const oldTime = String(prevRow.reservation_time ?? '').slice(0, 5);
        const newTime = state.time.slice(0, 5);
        const isReschedule =
          prevRow.reservation_date !== state.date || oldTime !== newTime;
        await supabase.from('reservation_logs').insert({
          reservation_id: savedId,
          clinic_id: clinicId,
          action: isReschedule ? 'reschedule' : 'update',
          old_data: {
            date: prevRow.reservation_date,
            time: oldTime,
            visit_type: prevRow.visit_type,
            customer_name: prevRow.customer_name,
            customer_phone: prevRow.customer_phone,
            service_id: prevRow.service_id,
            memo: prevRow.memo,
          },
          new_data: {
            date: state.date,
            time: newTime,
            visit_type: state.visit_type,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            service_id: payload.service_id,
            memo: payload.memo,
          },
          changed_by: changedBy,
        });
      } else if (!state.existingId) {
        await supabase.from('reservation_logs').insert({
          reservation_id: savedId,
          clinic_id: clinicId,
          action: 'create',
          old_data: null,
          new_data: {
            date: state.date,
            time: state.time.slice(0, 5),
            visit_type: state.visit_type,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            service_id: payload.service_id,
            memo: payload.memo,
          },
          changed_by: changedBy,
        });
      }
    }

    toast.success(state.existingId ? '수정됨' : '예약 등록');
    setSubmitting(false);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.existingId ? '예약 수정' : '예약 등록'} · {state.date} {state.time}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* 이름 — 인라인 자동검색 (신규·수정 모두 표시) */}
          <div className="space-y-1.5">
            <Label>이름</Label>
            <InlinePatientSearch
              value={state.name}
              onChange={(v) => {
                update('name', v);
                if (state.customer_id) update('customer_id', null);
              }}
              onSelect={handlePatientSelect}
              onClearSelection={() => update('customer_id', null)}
              searchField="name"
              clinicId={clinicId}
              selectedCustomerId={state.customer_id}
              placeholder="홍길동"
              required
            />
          </div>
          {/* 전화번호 — 인라인 자동검색 */}
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <InlinePatientSearch
              value={state.phone}
              onChange={(v) => {
                update('phone', v);
                if (state.customer_id) update('customer_id', null);
              }}
              onSelect={handlePatientSelect}
              onClearSelection={() => update('customer_id', null)}
              searchField="phone"
              clinicId={clinicId}
              selectedCustomerId={state.customer_id}
              placeholder="010-1234-5678"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['new', 'returning'] as VisitType[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update('visit_type', v)}
                  className={cn(
                    'h-9 rounded-md border text-sm font-medium',
                    state.visit_type === v
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {VISIT_TYPE_KO[v]}
                </button>
              ))}
            </div>
          </div>
          {/* T-20260515-foot-RESV-THERAPIST-HIST: AC-1/2/3 — 재진 + 기존고객 시 치료사/이력 패널 */}
          {state.visit_type === 'returning' && state.customer_id && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs space-y-2">
              {therapistHistoryLoading ? (
                <div className="text-muted-foreground">치료이력 조회 중…</div>
              ) : (
                <>
                  {/* AC-1: 담당 치료사 */}
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span className="font-medium text-emerald-800">담당 치료사</span>
                    {therapistHistory?.primaryTherapistName ? (
                      <span className="text-emerald-700">
                        {therapistHistory.primaryTherapistName}
                        {therapistHistory.lastVisitDate && (
                          <span className="text-muted-foreground ml-1">(최근: {therapistHistory.lastVisitDate})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-amber-600">담당 치료사 미배정</span>
                    )}
                  </div>
                  {/* AC-2: 직전 치료이력 */}
                  {therapistHistory?.lastVisitDate && (
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <span className="shrink-0 font-medium text-emerald-700 mt-0.5">직전이력</span>
                      <span>
                        {therapistHistory.lastVisitDate}
                        {therapistHistory.lastTreatmentSummary && (
                          <> · {therapistHistory.lastTreatmentSummary}</>
                        )}
                        {therapistHistory.lastTherapistName && (
                          <> · {therapistHistory.lastTherapistName}</>
                        )}
                      </span>
                    </div>
                  )}
                  {/* AC-3: 치료사 수동 변경 */}
                  {therapistList.length > 0 && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-muted-foreground shrink-0">치료사 변경</span>
                      <select
                        value={overrideTherapistId}
                        onChange={(e) => setOverrideTherapistId(e.target.value)}
                        className="flex-1 h-7 rounded border border-emerald-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      >
                        <option value="">— 미배정 —</option>
                        {therapistList.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* AC-4: [서비스] 필드 제거 (DB 컬럼은 유지, UI 비노출) */}
          {/* AC-5: 방문경로 드롭다운 — 초진만 표시, 재진 미표시 */}
          {state.visit_type === 'new' && (
            <div className="space-y-1.5">
              <Label>방문경로 <span className="text-muted-foreground font-normal text-xs">(선택)</span></Label>
              <select
                value={state.visit_route ?? ''}
                onChange={(e) => update('visit_route', e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— 선택 안 함 —</option>
                <option value="TM">TM</option>
                <option value="인바운드">인바운드</option>
                <option value="워크인">워크인</option>
                <option value="지인소개">지인소개</option>
              </select>
            </div>
          )}
          {/* T-20260504-foot-MEMO-RESTRUCTURE: 예약메모 / 고객메모 분리 */}
          {/* AC-6: 예약메모 = 2번차트 1구역 예약메모와 동일 데이터(reservations.booking_memo) */}
          <div className="space-y-1.5">
            <Label>예약메모 <span className="text-muted-foreground font-normal text-xs">(예약 경로 확인용)</span></Label>
            <Textarea value={state.booking_memo ?? ''} onChange={(e) => update('booking_memo', e.target.value)} rows={2} placeholder="예: 인스타그램 광고, 지인 소개, 인바운드 전화 등" className="text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button disabled={submitting || !state.name.trim()} onClick={save}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReservationLog {
  id: string;
  action: string;
  old_data: Record<string, string> | null;
  new_data: Record<string, string> | null;
  created_at: string;
}

function ReservationDetail({
  reservation,
  noshowCount,
  changedBy,
  isAdmin,
  onClose,
  onEdit,
  onChanged,
}: {
  reservation: Reservation | null;
  noshowCount: number;
  changedBy: string | null;
  isAdmin?: boolean;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<ReservationLog[]>([]);
  // T-20260515-foot-RESV-CANCEL: 취소 사유 다이얼로그 상태
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  useEffect(() => {
    if (!reservation) {
      setLogs([]);
      setCancelDialog(false);
      setCancelReason('');
      return;
    }
    supabase
      .from('reservation_logs')
      .select('id, action, old_data, new_data, created_at')
      .eq('reservation_id', reservation.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setLogs((data ?? []) as ReservationLog[]));
  }, [reservation]);

  if (!reservation) return null;

  // T-20260515-foot-RESV-CANCEL: 취소 사유 포함 취소 (기록 보존)
  const cancelWithReason = async () => {
    if (!cancelReason.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_reason: cancelReason.trim(),
      })
      .eq('id', reservation.id);
    if (error) {
      toast.error(`취소 실패: ${error.message}`);
      setBusy(false);
      return;
    }
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'cancel',
      old_data: { status: reservation.status },
      new_data: { status: 'cancelled', cancel_reason: cancelReason.trim() },
      changed_by: changedBy,
    });
    setBusy(false);
    setCancelDialog(false);
    setCancelReason('');
    toast.success('예약 취소됨');
    onChanged();
  };

  const deleteReservation = async () => {
    if (!reservation) return;
    if (!window.confirm(`${reservation.customer_name}님 예약을 완전 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    const { count } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_id', reservation.id);
    if ((count ?? 0) > 0) {
      toast.error('체크인이 연결된 예약은 삭제할 수 없습니다');
      setBusy(false);
      return;
    }
    const { error } = await supabase.from('reservations').delete().eq('id', reservation.id);
    setBusy(false);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('예약 삭제됨');
    onChanged();
  };

  const setStatus = async (status: Reservation['status'], action?: string) => {
    setBusy(true);
    // 복원 시 슬롯 마감 여부 재확인
    if (action === 'restore' || (status === 'confirmed' && reservation.status === 'cancelled')) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', reservation.clinic_id)
        .eq('reservation_date', reservation.reservation_date)
        .eq('reservation_time', reservation.reservation_time)
        .neq('status', 'cancelled');
      if ((count ?? 0) >= 12) {
        toast.error(`이 시간대는 마감입니다 (${count}/12). 다른 시간으로 옮긴 뒤 복원하세요.`);
        setBusy(false);
        return;
      }
    }
    const { error } = await supabase
      .from('reservations')
      .update({ status })
      .eq('id', reservation.id);
    if (error) {
      toast.error(`업데이트 실패: ${error.message}`);
      setBusy(false);
      return;
    }
    const resolvedAction = action
      ?? (status === 'cancelled' ? 'cancel'
        : status === 'confirmed' && reservation.status === 'cancelled' ? 'restore'
        : 'status_change');
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: resolvedAction,
      old_data: { status: reservation.status },
      new_data: { status },
      changed_by: changedBy,
    });
    setBusy(false);
    toast.success(
      resolvedAction === 'restore'
        ? '예약 복원됨'
        : `상태 변경: ${STATUS_LABEL[status]}`,
    );
    onChanged();
  };

  const convertToCheckIn = async () => {
    setBusy(true);
    const { data: existing } = await supabase
      .from('check_ins')
      .select('id')
      .eq('reservation_id', reservation.id)
      .maybeSingle();
    if (existing) {
      toast.info('이미 이 예약으로 체크인이 생성되어 있습니다');
      setBusy(false);
      return;
    }
    const { data: queueData, error: qErr } = await supabase.rpc('next_queue_number', {
      p_clinic_id: reservation.clinic_id,
      p_date: reservation.reservation_date,
    });
    if (qErr) {
      toast.error(`대기번호 생성 실패: ${qErr.message}`);
      setBusy(false);
      return;
    }
    const { error } = await supabase.from('check_ins').insert({
      clinic_id: reservation.clinic_id,
      customer_id: reservation.customer_id,
      reservation_id: reservation.id,
      customer_name: reservation.customer_name ?? '',
      customer_phone: reservation.customer_phone,
      visit_type: reservation.visit_type,
      // AC-1/AC-2: 초진·체험 → 상담대기, 재진 → 치료대기 자동 세팅 (T-20260514-foot-CHECKIN-AUTO-STAGE)
      status: reservation.visit_type === 'returning' ? 'treatment_waiting' : 'consult_waiting',
      queue_number: queueData as number,
    });
    if (error) {
      toast.error(`체크인 실패: ${error.message}`);
      setBusy(false);
      return;
    }
    await supabase
      .from('reservations')
      .update({ status: 'checked_in' })
      .eq('id', reservation.id);
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'checkin_convert',
      old_data: { status: reservation.status },
      new_data: { status: 'checked_in', queue_number: queueData },
      changed_by: changedBy,
    });
    toast.success('체크인 완료');
    setBusy(false);
    onChanged();
  };

  return (
    <>
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reservation.customer_name} · {reservation.reservation_date}{' '}
            {reservation.reservation_time.slice(0, 5)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="teal">{VISIT_TYPE_KO[reservation.visit_type]}</Badge>
            <Badge>{STATUS_LABEL[reservation.status]}</Badge>
            {noshowCount > 0 && <Badge variant="destructive">노쇼 {noshowCount}회</Badge>}
          </div>
          {reservation.customer_phone && (
            <div className="text-muted-foreground">
              {formatPhone(reservation.customer_phone)} (뒤 4자리 ···{maskPhoneTail(reservation.customer_phone)})
            </div>
          )}
          {/* T-20260515-foot-RESV-CANCEL: 취소 정보 표시 */}
          {reservation.status === 'cancelled' && (reservation.cancelled_at || reservation.cancel_reason) && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs space-y-0.5">
              <div className="text-red-600 font-medium">취소됨</div>
              {reservation.cancelled_at && (
                <div className="text-muted-foreground">
                  {format(new Date(reservation.cancelled_at), 'yyyy/MM/dd HH:mm', { locale: ko })}
                </div>
              )}
              {reservation.cancel_reason && (
                <div className="text-red-700 whitespace-pre-wrap">사유: {reservation.cancel_reason}</div>
              )}
            </div>
          )}
          {/* T-20260504-foot-MEMO-RESTRUCTURE: booking_memo 우선, 없으면 memo */}
          {(reservation.booking_memo || reservation.memo) && (
            <div className="space-y-1">
              {reservation.booking_memo && (
                <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs">
                  <span className="text-amber-700 font-medium">예약경로: </span>
                  <span className="whitespace-pre-wrap">{reservation.booking_memo}</span>
                </div>
              )}
              {reservation.memo && !reservation.booking_memo && (
                <div className="rounded border bg-muted/30 p-2 whitespace-pre-wrap text-xs">
                  {reservation.memo}
                </div>
              )}
            </div>
          )}
          {logs.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              <div className="text-xs font-medium text-muted-foreground">변경 이력</div>
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 tabular-nums">{format(new Date(l.created_at), 'MM/dd HH:mm')}</span>
                  <span>
                    {l.action === 'create'
                      ? `예약 생성: ${l.new_data?.date} ${l.new_data?.time}`
                      : l.action === 'reschedule'
                        ? `일정 변경: ${l.old_data?.date} ${l.old_data?.time} → ${l.new_data?.date} ${l.new_data?.time}`
                        : l.action === 'cancel'
                          ? '예약 취소'
                          : l.action === 'restore'
                            ? '예약 복원'
                            : l.action === 'checkin_convert'
                              ? '체크인 전환'
                              : l.action === 'update'
                                ? '예약 수정'
                                : l.action === 'status_change'
                                  ? `상태: ${STATUS_LABEL[(l.old_data?.status as Reservation['status']) ?? 'confirmed']} → ${STATUS_LABEL[(l.new_data?.status as Reservation['status']) ?? 'confirmed']}`
                                  : l.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(reservation)}>
            수정
          </Button>
          {isAdmin && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={deleteReservation}>
              완전 삭제
            </Button>
          )}
          {reservation.status === 'confirmed' && (
            <>
              <Button size="sm" disabled={busy} onClick={convertToCheckIn}>
                체크인 전환
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                if (window.confirm(`${reservation.customer_name}님을 노쇼 처리하시겠습니까?`)) setStatus('noshow');
              }}>
                노쇼
              </Button>
              {/* T-20260515-foot-RESV-CANCEL: 취소 사유 다이얼로그로 변경 */}
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                data-testid="btn-reservation-cancel"
                onClick={() => { setCancelReason(''); setCancelDialog(true); }}
              >
                취소
              </Button>
            </>
          )}
          {(reservation.status === 'cancelled' || reservation.status === 'noshow') && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`${reservation.customer_name}님 예약을 복원하시겠습니까?`)) setStatus('confirmed');
              }}
            >
              복원
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* T-20260515-foot-RESV-CANCEL: 취소 사유 입력 다이얼로그 */}
    {cancelDialog && (
      <Dialog open onOpenChange={(o) => { if (!o && !busy) { setCancelDialog(false); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>예약 취소 — {reservation.customer_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {reservation.reservation_date} {reservation.reservation_time.slice(0, 5)} 예약을 취소합니다.
              취소된 예약은 목록에 기록으로 남습니다.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">
                취소 사유 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="cancel-reason"
                data-testid="cancel-reason-input"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="예: 환자 요청으로 취소, 일정 변경, 연락 두절 등"
                rows={3}
                className="text-sm"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { setCancelDialog(false); setCancelReason(''); }}
            >
              돌아가기
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !cancelReason.trim()}
              data-testid="btn-cancel-confirm"
              onClick={cancelWithReason}
            >
              {busy ? '처리 중…' : '취소 확인'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   T-20260515-foot-RESPONSIVE-UI-SHELL: Shell-2
   TabletFullscreenModal — 태블릿(Galaxy Tab S10 Lite 등) 풀스크린 빈 모달
   Phase 0: 빈 캔버스 (S-Pen/Inking 없음). Phase 1에서 E-Form 연동 예정.
   AC-5: 슬롯/카드 탭 시 열림 (Split 뷰 대체)
   AC-6: 10.9인치 화면 꽉 채움
   AC-7: 닫기 → 시간표 복귀
   AC-8: slide-up/slide-down 부드러운 애니메이션
───────────────────────────────────────────────────────────────────────────── */
function TabletFullscreenModal({
  open,
  info,
  onClose,
}: {
  open: boolean;
  info: { date: string; time: string } | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // requestAnimationFrame으로 enter 애니메이션 트리거
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      data-testid="tablet-fullscreen-modal"
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 z-[100] flex flex-col bg-white transition-transform duration-300 ease-in-out',
        visible ? 'translate-y-0' : 'translate-y-full',
      )}
    >
      {/* 헤더 */}
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4 bg-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-teal-700">
            {info?.date ?? '—'} · {info?.time ?? '—'}
          </span>
          <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-700">
            Phase 0 Shell
          </span>
        </div>
        <button
          data-testid="tablet-modal-close"
          onClick={onClose}
          aria-label="모달 닫기"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted transition-colors"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* 빈 캔버스 (AC-6: 빈 캔버스, Phase 1에서 S-Pen/Inking 연동) */}
      <div
        data-testid="tablet-modal-canvas"
        className="flex flex-1 flex-col items-center justify-center gap-4 bg-gray-50/60 p-8"
      >
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-teal-100">
          <svg viewBox="0 0 48 48" fill="none" className="h-12 w-12 text-teal-500" stroke="currentColor" strokeWidth={1.5}>
            <rect x="8" y="8" width="32" height="32" rx="4" />
            <path d="M16 24h16M24 16v16" />
          </svg>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-gray-700">빈 캔버스</p>
          <p className="text-xs text-muted-foreground">Phase 1에서 E-Form / S-Pen Inking 연동 예정</p>
          {info && (
            <p className="mt-2 text-xs font-mono text-teal-600">
              {info.date} {info.time}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

