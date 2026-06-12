// T-20260516-foot-RESV-DETAIL-POPUP: 예약 상세 팝업 4분할 레이아웃
// 환자 클릭 시 2열 × 2행 = 4분할 모달
// 좌상: 환자정보 8필드 | 우상: 선택 예약 상세
// 좌하: 전체 예약 히스토리 | 우하: 메모 2종
// T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE: 초진 [체크인 전환] 구 정보입력 폼(주민번호+건보동의서) 제거
//   → 초진도 재진처럼 폼 없이 바로 doCheckIn. 주민번호/동의서 수집은 펜차트로 일원화(정책: RRN-FIELD-REMOVE/CHECKIN-CONSENT-REMOVE).

import { useEffect, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast } from '@/lib/toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { VISIT_TYPE_KO } from '@/lib/status';
import { formatPhone, chartNoBadge } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ReservationMemoTimeline } from '@/components/ReservationMemoTimeline';
// T-20260522-foot-RESV-HISTORY-SYNC AC-2/3: 예약 변경 이력 공유 패널
import { ReservationAuditLogPanel } from '@/components/ReservationAuditLogPanel';
// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-1: 고객 검색창 (기존 인라인 검색 재사용, 신규 PII 경로 금지)
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-3: 2번구역 미니 캘린더 (기존 month-grid 패턴 재사용)
import { MiniMonthCalendar } from '@/components/MiniMonthCalendar';
import type { Customer, Package, Reservation, ReservationRegistrar, Staff } from '@/lib/types';
import { VISIT_ROUTE_OPTIONS } from '@/lib/types';

// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-2: 1번구역 치료내역(net-new) — check_ins treatment 필드 JOIN.
//   신규 테이블/컬럼 없음(기존 check_ins 컬럼 재사용). 일자별 시술내역 + 담당치료사.
type TreatmentRow = {
  id: string;
  checked_in_at: string;
  completed_at: string | null;
  visit_type: Reservation['visit_type'];
  treatment_category: string | null;
  treatment_contents: string[] | null;
  treatment_kind: string | null;
  therapist_id: string | null;
};

const STATUS_LABEL: Record<Reservation['status'], string> = {
  confirmed: '예약',
  checked_in: '체크인',
  cancelled: '취소',
  noshow: '노쇼',
};

const VISIT_TYPE_BADGE_CLASS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  returning: 'bg-emerald-100 text-emerald-700',
  experience: 'bg-amber-100 text-amber-700',
};

const GENDER_KO: Record<string, string> = { M: '남', F: '여' };

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────

export function ReservationDetailPopup({
  reservation,
  noshowCount,
  changedBy,
  authorName,
  isAdmin,
  onClose,
  onEdit,
  onChanged,
  onNewReservationForCustomer,
}: {
  reservation: Reservation | null;
  noshowCount: number;
  changedBy: string | null;
  authorName: string;
  isAdmin?: boolean;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
  onChanged: () => void;
  // T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-1 (현장 확정: "A고객 등록 후 B고객 불러와 신규 예약 생성"):
  //   1번구역 검색창에서 B고객 선택 → 팝업 닫고 기존 예약관리 신규예약 editor 를 B고객 기준으로 오픈(연속 등록).
  //   🔒 L-002 LOGIC-LOCK: 신규예약 생성 capability 는 이 동선으로 '확장'될 뿐, 기존 생성 로직 재사용
  //   (신규 INSERT 로직 팝업 내 작성 금지). 미전달 시 검색창 자체를 숨겨 graceful degrade.
  onNewReservationForCustomer?: (customer: PatientMatch) => void;
}) {
  // ── 액션 상태
  const [busy, setBusy] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // ── 2구역 데이터
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [allResvs, setAllResvs] = useState<Reservation[]>([]);
  // T-20260611-foot-RESVPOPUP-2ZONE: 클리닉 전체 활성 staff (담당상담사 드롭다운 + 치료사 이름 resolve).
  //   기존 consultant-만-로드 → 전체 로드로 확장: assigned_staff_id 가 role!=consultant 직원이어도
  //   이름 resolve 가능(처리로그 17:04 '담당상담사 raw UUID 표시' 부수 개선).
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  // T-20260611-foot-RESVPOPUP-2ZONE AC-2: 치료내역(일자별 시술 + 담당치료사) — check_ins JOIN
  const [treatments, setTreatments] = useState<TreatmentRow[]>([]);

  // 드롭다운 옵션 = 활성 consultant 만. (이름 resolve 는 비활성/타직군 포함 allStaff 전체로 — UUID 노출 방지)
  const consultants = allStaff.filter((s) => s.role === 'consultant' && s.active);
  // staff id → 표시명 resolve (display_name 우선, STAFF-NAME-UNIFY 관례)
  const staffName = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const s = allStaff.find((x) => x.id === id);
    return s ? (s.display_name ?? s.name) : null;
  };
  // 치료내역 한 줄 요약(시술내역): category · contents, 없으면 kind
  const treatmentSummary = (t: TreatmentRow): string => {
    const parts: string[] = [];
    if (t.treatment_category) parts.push(t.treatment_category);
    if (t.treatment_contents && t.treatment_contents.length) parts.push(t.treatment_contents.join(', '));
    if (!parts.length && t.treatment_kind) parts.push(t.treatment_kind);
    return parts.join(' · ') || '시술내역 없음';
  };

  // ── T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약경로 + 예약등록자 (현재 예약 대상 편집)
  const [registrars, setRegistrars] = useState<ReservationRegistrar[]>([]);
  const [visitRoute, setVisitRoute] = useState<string>('');      // '' = 미지정
  const [registrarId, setRegistrarId] = useState<string>('');    // '' = 미지정
  const [routeSaving, setRouteSaving] = useState(false);

  // ── 우상 선택 상태: 좌하에서 클릭 → selectedResvId 변경
  const [selectedResvId, setSelectedResvId] = useState<string | null>(null);

  // ── 우하 메모 상태
  const [customerMemo, setCustomerMemo] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);

  // ── 우상 상담사 상태
  const [selectedConsultantId, setSelectedConsultantId] = useState<string>('');
  const [consultantSaving, setConsultantSaving] = useState(false);

  // ── T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-1: 고객 검색창(1번구역 최상단)
  const [searchValue, setSearchValue] = useState('');

  // ── T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-3/4: 2번구역 미니 캘린더 선택 일자
  const [pickedDate, setPickedDate] = useState<Date | null>(null);

  // ── T-20260612-foot-RESVPOPUP-2ZONE-RESTRUCTURE AC-7: 예약등록자 기준 필터 (예약이력·캘린더 표시 한정).
  //    기존 registrars(active=true) 재사용 — group_name('TM'/'원내')은 reservation_registrars 마스터 소스(신규 스키마 0).
  //    편집용 registrarId 와 '별개' 상태: 필터는 표시 전용으로 저장(reservations.update)에 일절 관여 안 함 → 엉뚱 저장 0.
  const [registrarFilter, setRegistrarFilter] = useState<string>(''); // '' = 전체(미지정)

  // 현재 우상에 표시할 예약 (좌하 클릭 선택, 기본값 = 원본 예약)
  const selectedResv: Reservation | undefined =
    allResvs.find((r) => r.id === selectedResvId) ?? reservation ?? undefined;

  // AC-7: 등록자 필터 적용 예약 목록 — 예약이력 리스트 + 캘린더 점표기에만 사용.
  //   selectedResv 해소(선택/현재 예약 접근)는 unfiltered allResvs 유지 → 필터로 현재 예약 숨어도 상세 보기 안전.
  const visibleResvs = registrarFilter
    ? allResvs.filter((r) => r.registrar_id === registrarFilter)
    : allResvs;

  // ── 데이터 로드
  useEffect(() => {
    if (!reservation) {
      setCustomer(null);
      setAllResvs([]);
      setPackages([]);
      setAllStaff([]);
      setTreatments([]);
      setRegistrars([]);
      setSelectedResvId(null);
      setCustomerMemo('');
      setSelectedConsultantId('');
      setVisitRoute('');
      setRegistrarId('');
      setCancelDialog(false);
      setCancelReason('');
      setSearchValue('');
      setPickedDate(null);
      setRegistrarFilter('');
      return;
    }

    setSelectedResvId(reservation.id);
    setBusy(false);
    setSearchValue('');
    setPickedDate(null);
    setRegistrarFilter('');
    // T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 현재 예약의 예약경로/예약등록자 프리로드
    setVisitRoute(reservation.visit_route ?? '');
    setRegistrarId(reservation.registrar_id ?? '');

    const customerId = reservation.customer_id;
    const clinicId = reservation.clinic_id;

    if (customerId) {
      // 1) 고객 정보
      supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const c = data as Customer;
          setCustomer(c);
          setCustomerMemo(c.customer_memo ?? c.memo ?? '');
          setSelectedConsultantId(c.assigned_staff_id ?? '');
        });

      // 2) 전체 예약 히스토리 (최신순)
      supabase
        .from('reservations')
        .select('*')
        .eq('customer_id', customerId)
        .order('reservation_date', { ascending: false })
        .order('reservation_time', { ascending: false })
        .then(({ data }) => {
          if (data) setAllResvs(data as Reservation[]);
        });

      // 4) 보유 패키지 (활성)
      supabase
        .from('packages')
        .select('id, package_name, status, total_sessions, contract_date')
        .eq('customer_id', customerId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (data) setPackages(data as Package[]);
        });

      // 6) T-20260611-foot-RESVPOPUP-2ZONE AC-2: 치료내역 — 이 고객의 check_ins(시술내역) 최신순.
      //    신규 테이블/컬럼 0(기존 check_ins 재사용). 담당치료사는 staffName(therapist_id)로 resolve.
      supabase
        .from('check_ins')
        .select('id, checked_in_at, completed_at, visit_type, treatment_category, treatment_contents, treatment_kind, therapist_id')
        .eq('customer_id', customerId)
        .order('checked_in_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (data) setTreatments(data as TreatmentRow[]);
        });
    }

    // 3) 직원 목록 (해당 클리닉 전체) — 담당상담사 드롭다운(활성만) + 치료사/담당상담사 이름 resolve(비활성 포함).
    //    active 필터를 제거해 비활성·과거 담당자도 이름 resolve 가능(raw UUID 노출 방지). 드롭다운 옵션은 파생에서 active 필터.
    //    ⚠ staff.display_name 컬럼은 DB 미존재(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션) → select 금지(400).
    supabase
      .from('staff')
      .select('id, name, role, clinic_id, active, created_at')
      .eq('clinic_id', clinicId)
      .order('name')
      .then(({ data }) => {
        if (data) setAllStaff(data as Staff[]);
      });

    // 5) T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약등록자 마스터(활성, 그룹·정렬순)
    supabase
      .from('reservation_registrars')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .order('group_name', { ascending: true })
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data) setRegistrars(data as ReservationRegistrar[]);
      });
  // reservation.id 변경 시에만 재로드
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation?.id, reservation?.customer_id, reservation?.clinic_id]);

  if (!reservation) return null;

  // ── 소요 시간 계산
  const getDuration = (resv: Reservation) => {
    if (!resv.end_time) return '—';
    const [sh, sm] = resv.reservation_time.split(':').map(Number);
    const [eh, em] = resv.end_time.split(':').map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    return mins > 0 ? `${mins}분` : '—';
  };

  // ── 액션: 취소 (사유 포함)
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
    if (error) { toast.error(`취소 실패: ${error.message}`); setBusy(false); return; }
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

  // ── 액션: 완전 삭제
  const deleteReservation = async () => {
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

  // ── 액션: 상태 변경 (노쇼/복원)
  const setStatus = async (status: Reservation['status'], action?: string) => {
    setBusy(true);
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
    const resolvedAction = action
      ?? (status === 'cancelled' ? 'cancel'
        : status === 'confirmed' && reservation.status === 'cancelled' ? 'restore'
        : 'status_change');
    // T-20260610-foot-RESV-CTXMENU-POPUP-SYNC AC-7: 복원 시 취소 메타(cancelled_at/cancel_reason/cancelled_by) 초기화.
    //   기존 latent 버그 — status='confirmed'만 세팅하고 취소 메타가 stale로 남던 문제 수정.
    //   handleEditorRestore(Reservations.tsx)와 동일 비파괴 상태전이 정책 통일.
    const updatePayload =
      resolvedAction === 'restore'
        ? { status, cancelled_at: null, cancel_reason: null, cancelled_by: null }
        : { status };
    const { error } = await supabase.from('reservations').update(updatePayload).eq('id', reservation.id);
    if (error) { toast.error(`업데이트 실패: ${error.message}`); setBusy(false); return; }
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: resolvedAction,
      old_data: { status: reservation.status },
      new_data: { status },
      changed_by: changedBy,
    });
    setBusy(false);
    toast.success(resolvedAction === 'restore' ? '예약 복원됨' : `상태 변경: ${STATUS_LABEL[status]}`);
    onChanged();
  };

  // ── 액션: 체크인 전환 (실제 DB INSERT)
  // T-20260611-foot-CHECKIN-POPUP-REVISIT-CONSULTSLOT (regression fix):
  //   canonical 슬롯 분기 복원 — 재진(returning) → treatment_waiting(치료대기), 초진/예약없이방문 → consult_waiting(상담대기).
  //   배경: fbb843b(CTXMENU-UNIFY-CANONICAL)가 카드/타임라인 우클릭 [예약하기]→[예약상세] 재배선 후
  //   이 팝업 [체크인 전환] 경로가 재진 카드의 활성 경로가 되며, 잔존하던 CHECKIN-FIRST-INFO의
  //   'consult_waiting' 전(全) visit_type 하드코딩이 재진을 상담대기로 잘못 활성화(권준서 F-1548).
  //   canonical 출처: T-20260522-foot-REVISIT-TREAT-WAIT(ebe1dd7) / NewCheckInDialog:223 / Dashboard:5195 동일 규칙.
  //   재배포 트리거(2026-06-11): b584a06 소스 fix는 정확했으나 Vercel 라이브 번들이 pre-fix(consult_waiting 하드코딩)
  //   상태로 정체(배포 미전파). 라이브 청크 강제 갱신 위한 redeploy 마커. AC/로직 무변경.
  const doCheckIn = async () => {
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
    if (qErr) { toast.error(`대기번호 생성 실패: ${qErr.message}`); setBusy(false); return; }
    const { error } = await supabase.from('check_ins').insert({
      clinic_id: reservation.clinic_id,
      customer_id: reservation.customer_id,
      reservation_id: reservation.id,
      customer_name: reservation.customer_name ?? '',
      customer_phone: reservation.customer_phone,
      visit_type: reservation.visit_type,
      // AC-1/AC-2: 재진 → 치료대기(treatment_waiting), 초진·예약없이방문 → 상담대기(consult_waiting). canonical 분기 복원.
      status: reservation.visit_type === 'returning' ? 'treatment_waiting' : 'consult_waiting',
      queue_number: queueData as number,
    });
    if (error) { toast.error(`체크인 실패: ${error.message}`); setBusy(false); return; }
    await supabase.from('reservations').update({ status: 'checked_in' }).eq('id', reservation.id);
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

  // ── 액션: 체크인 전환 (진입점)
  // T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE
  // - 초진/재진/선체험 모두 폼 없이 바로 doCheckIn.
  //   (구 초진 정보입력 폼 = 주민번호 입력 + 건보 자격조회 동의서 = 제거. 수집은 펜차트로 일원화)
  //   slot 분기(초진→상담대기 / 재진→치료대기)는 doCheckIn 내부 그대로 유지(무회귀).
  const convertToCheckIn = async () => {
    await doCheckIn();
  };

  // ── 고객메모 저장
  const saveCustomerMemo = async () => {
    if (!reservation.customer_id) return;
    setMemoSaving(true);
    const { error } = await supabase
      .from('customers')
      .update({ customer_memo: customerMemo })
      .eq('id', reservation.customer_id);
    setMemoSaving(false);
    if (error) { toast.error(`고객메모 저장 실패: ${error.message}`); return; }
    toast.success('고객메모 저장됨');
  };

  // ── 상담사 저장 (customers.assigned_staff_id)
  const saveConsultant = async (val: string) => {
    if (!reservation.customer_id) return;
    const staffId = val === '__none__' ? null : val;
    setConsultantSaving(true);
    setSelectedConsultantId(val === '__none__' ? '' : val);
    const { error } = await supabase
      .from('customers')
      .update({ assigned_staff_id: staffId })
      .eq('id', reservation.customer_id);
    setConsultantSaving(false);
    if (error) { toast.error(`상담사 저장 실패: ${error.message}`); return; }
    toast.success('담당 상담사 저장됨');
  };

  // ── T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약경로 + 예약등록자 저장
  //    현재 예약(reservation) 대상에 visit_route + registrar_id/registrar_name(스냅샷) 영속.
  //    registrar_name 스냅샷 → 마스터가 리네임/삭제돼도 고객박스 @표시 안정.
  const saveRouteAndRegistrar = async () => {
    setRouteSaving(true);
    const reg = registrars.find((r) => r.id === registrarId) ?? null;
    const { error } = await supabase
      .from('reservations')
      .update({
        visit_route: visitRoute === '' ? null : visitRoute,
        registrar_id: registrarId === '' ? null : registrarId,
        registrar_name: reg ? reg.name : null,
      })
      .eq('id', reservation.id);
    setRouteSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('예약경로·예약등록자 저장됨');
    onChanged();
  };

  // ── T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-1: 검색창에서 B고객 선택
  //    → 팝업 닫고 기존 예약관리 신규예약 동선을 B고객 기준으로 오픈(연속 등록).
  //    🔒 L-002: 신규 생성 로직 작성 0 — parent 의 기존 ReservationEditor 재사용에 위임.
  const handleSelectOtherCustomer = (p: PatientMatch) => {
    if (!onNewReservationForCustomer) return;
    setSearchValue('');
    onNewReservationForCustomer(p);
  };

  // ─── 렌더 ─────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="max-w-[1100px] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

          {/* 헤더 */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>{reservation.customer_name}</span>
              {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
              <span className="text-xs font-mono font-normal text-teal-600">{chartNoBadge(customer?.chart_number ?? null)}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  VISIT_TYPE_BADGE_CLASS[reservation.visit_type],
                )}
              >
                {VISIT_TYPE_KO[reservation.visit_type]}
              </span>
              <Badge variant="outline" className="text-xs">{STATUS_LABEL[reservation.status]}</Badge>
              {noshowCount > 0 && (
                <Badge variant="destructive" className="text-xs">노쇼 {noshowCount}회</Badge>
              )}
              <span className="text-sm font-normal text-muted-foreground">
                {reservation.reservation_date} {reservation.reservation_time.slice(0, 5)}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR: 2구역 전면 재구성.
              1번구역(좌)=고객정보: 검색창 / 환자정보(+담당상담사 relocate) / 활성패키지(relocate) / 치료내역(net-new) / 고객메모(relocate)
              2번구역(우)=예약정보: 예약경로 / 예약등록자 / 미니캘린더 / 선택일자·시간 / 예약메모 / 예약이력(히스토리+변경이력)
              🔒 L-002: 신규예약 생성 capability 불변(팝업 내 reservations.insert 0). chart2 read-only. */}
          <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden min-h-0">

            {/* ── 1번구역 (좌) = 고객정보 ── */}
            <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1" data-testid="popup-zone1-customer">

              {/* AC-1(Stage1): 고객 검색창(1번구역 최상단).
                  현장 확정: A고객 등록 완료 후 B고객 검색·선택 → 팝업 닫지 않고 B고객 신규예약 생성 동선으로 연속 진입.
                  onNewReservationForCustomer 미전달 환경(graceful)에선 검색창 자체를 숨김. */}
              {onNewReservationForCustomer && (
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0 bg-teal-50/40">
                  <SectionHeader accent="teal" className="mb-1.5">다른 고객 신규예약</SectionHeader>
                  <InlinePatientSearch
                    value={searchValue}
                    onChange={setSearchValue}
                    onSelect={handleSelectOtherCustomer}
                    searchField="name"
                    clinicId={reservation.clinic_id}
                    placeholder="고객명 입력 → 선택 시 신규예약 등록"
                    id="resv-popup-customer-search"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1">
                    선택한 고객 기준으로 신규 예약 등록 화면이 열립니다.
                  </div>
                </div>
              )}

              {/* 환자 정보 (+ 담당 상담사 RELOCATE from 2번구역) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">환자 정보</SectionHeader>
                <div className="space-y-1 text-xs">
                  <FieldRow label="이름" value={customer?.name ?? reservation.customer_name ?? '—'} />
                  <FieldRow label="고객번호" value={customer?.chart_number ?? '—'} />
                  <FieldRow
                    label="주민번호"
                    value={
                      customer?.birth_date
                        ? `${customer.birth_date.slice(0, 6)}-*******`
                        : '—'
                    }
                  />
                  <FieldRow
                    label="성별"
                    value={customer?.gender ? (GENDER_KO[customer.gender] ?? '—') : '—'}
                  />
                  <FieldRow
                    label="휴대폰"
                    value={
                      customer?.phone
                        ? formatPhone(customer.phone)
                        : reservation.customer_phone
                          ? formatPhone(reservation.customer_phone)
                          : '—'
                    }
                  />
                  <FieldRow
                    label="주소"
                    value={
                      [customer?.address, customer?.address_detail].filter(Boolean).join(' ') || '—'
                    }
                  />
                  <FieldRow label="고객등급" value={customer?.customer_grade ?? '일반'} />
                </div>

                {/* 담당 상담사 (RELOCATE: 기존 2번구역 → 1번구역. 기존 state·saveConsultant 재사용.
                    raw UUID 표시 버그 부수 개선: assigned_staff_id 가 role!=consultant 직원이어도 allStaff 로 이름 resolve) */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1.5">담당 상담사</div>
                  {(() => {
                    const assignedExtra =
                      selectedConsultantId && !consultants.some((c) => c.id === selectedConsultantId)
                        ? allStaff.find((s) => s.id === selectedConsultantId)
                        : null;
                    return (
                      <Select
                        value={selectedConsultantId || '__none__'}
                        onValueChange={saveConsultant}
                        disabled={consultantSaving || !reservation.customer_id}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="popup-consultant">
                          <SelectValue placeholder="상담사 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">— 미배정 —</SelectItem>
                          {assignedExtra && (
                            <SelectItem value={assignedExtra.id} className="text-xs">
                              {(assignedExtra.display_name ?? assignedExtra.name)} (담당)
                            </SelectItem>
                          )}
                          {consultants.map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              {s.display_name ?? s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              </div>

              {/* 활성 패키지 (RELOCATE: 기존 2번구역 → 1번구역. 기존 packages 쿼리 재사용) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">활성 패키지</SectionHeader>
                {packages.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">보유 패키지 없음</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {packages.map((p) => (
                      <Badge key={p.id} variant="outline" className="text-[10px] px-1.5 py-0.5">
                        {p.package_name}
                        {p.total_sessions ? ` (${p.total_sessions}회)` : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* 치료내역 (net-new) — 지정치료사 + 일자별 시술내역(담당치료사). check_ins JOIN, chart2 read-only */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0" data-testid="popup-treatment-history">
                <SectionHeader accent="teal">치료내역</SectionHeader>
                <div className="flex items-center gap-2 text-[11px] mb-1.5">
                  <span className="text-muted-foreground shrink-0">지정치료사</span>
                  <span className="font-medium">
                    {staffName(customer?.designated_therapist_id) ?? '미지정'}
                  </span>
                </div>
                {treatments.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic py-1">치료내역 없음</div>
                ) : (
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
                    {treatments.map((t) => (
                      <div key={t.id} className="rounded border px-2 py-1.5 text-xs">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-medium tabular-nums">
                            {t.checked_in_at.slice(0, 10)}
                          </span>
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                              VISIT_TYPE_BADGE_CLASS[t.visit_type],
                            )}
                          >
                            {VISIT_TYPE_KO[t.visit_type]}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-0.5 break-words">
                          {treatmentSummary(t)}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          담당치료사: {staffName(t.therapist_id) ?? '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 고객메모 (RELOCATE: 기존 우하 메모 → 1번구역. 예약메모와 구분: 고객메모≠예약메모) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="blue">고객메모</SectionHeader>
                <div className="flex flex-col gap-1.5">
                  <Textarea
                    value={customerMemo}
                    onChange={(e) => setCustomerMemo(e.target.value)}
                    rows={3}
                    placeholder="고객 특이사항·성향·주차 등"
                    className="text-xs resize-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-end h-7 text-xs"
                    onClick={saveCustomerMemo}
                    disabled={memoSaving || !reservation.customer_id}
                  >
                    {memoSaving ? '저장 중…' : '고객메모 저장'}
                  </Button>
                </div>
              </div>
            </div>

            {/* ── 2번구역 (우) = 예약정보 ── */}
            <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1" data-testid="popup-zone2-reservation">

              {/* AC-4 #1·#2: 예약경로 + 예약등록자 (현재 예약 대상 편집 — REGISTRAR-ROUTE-FIELDS 자산 재사용) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">예약 정보</SectionHeader>
                <div className="space-y-1 text-xs">
                  <div className="flex gap-2 min-w-0 items-center">
                    <span className="text-muted-foreground shrink-0 w-[4.5rem]">예약경로</span>
                    <Select
                      value={visitRoute || '__none__'}
                      onValueChange={(v) => setVisitRoute(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1" data-testid="popup-visit-route">
                        <SelectValue placeholder="예약경로 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs">— 미지정 —</SelectItem>
                        {VISIT_ROUTE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 min-w-0 items-center">
                    <span className="text-muted-foreground shrink-0 w-[4.5rem]">예약등록자</span>
                    <Select
                      value={registrarId || '__none__'}
                      onValueChange={(v) => setRegistrarId(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1" data-testid="popup-registrar">
                        <SelectValue placeholder="예약등록자 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs">— 미지정 —</SelectItem>
                        {registrars.map((r) => (
                          <SelectItem key={r.id} value={r.id} className="text-xs">
                            {r.group_name} - {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* AC-3 / AC-4 #3: 미니 캘린더 (예약 가능 일자 확인 — 닫지 않고). 고객 기존 예약일은 점 표기.
                  T-20260612-foot-RESVPOPUP-2ZONE-RESTRUCTURE AC-7: 예약등록자 필터를 캘린더 '바로 위'에 배치.
                  선택 시 캘린더 점표기 + 예약이력 목록이 해당 등록자 예약만 표시(미지정=전체). 옵션=reservation_registrars(group_name-name). */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">예약 캘린더</SectionHeader>
                {/* AC-7: 예약등록자 필터 (표시 전용 — 저장 로직 무관) */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[11px] text-muted-foreground shrink-0">예약등록자 필터</span>
                  <Select
                    value={registrarFilter || '__all__'}
                    onValueChange={(v) => setRegistrarFilter(v === '__all__' ? '' : v)}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid="popup-registrar-filter">
                      <SelectValue placeholder="예약등록자 필터" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__" className="text-xs">— 미지정 — (전체)</SelectItem>
                      {registrars.map((r) => (
                        <SelectItem key={r.id} value={r.id} className="text-xs">
                          {r.group_name} - {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <MiniMonthCalendar
                  value={pickedDate}
                  onSelect={(d) => setPickedDate((prev) => (prev && d.getTime() === prev.getTime() ? null : d))}
                  markedDates={visibleResvs
                    .filter((r) => r.status !== 'cancelled')
                    .map((r) => r.reservation_date)}
                />
                {registrarFilter && (
                  <div className="text-[10px] text-teal-600 mt-1.5">
                    이 등록자 예약만 표시 중 — 캘린더·예약이력에 필터 적용
                  </div>
                )}
              </div>

              {/* AC-4 #4: 선택한 일자 및 시간 (미니캘린더 선택 일자 + 현재 보기 예약의 일자/시간 상세) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">
                  선택한 일자 및 시간
                  {selectedResv && selectedResv.id !== reservation.id && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      (다른 예약 보기 중)
                    </span>
                  )}
                </SectionHeader>
                <div className="space-y-1 text-xs">
                  <FieldRow
                    label="선택 일자"
                    value={pickedDate ? format(pickedDate, 'yyyy-MM-dd (E)', { locale: ko }) : '미선택'}
                  />
                  {selectedResv ? (
                    <>
                      <FieldRow label="예약 일자" value={selectedResv.reservation_date} />
                      <FieldRow label="시작 시간" value={selectedResv.reservation_time.slice(0, 5)} />
                      <FieldRow label="소요 시간" value={getDuration(selectedResv)} />
                      <FieldRow label="초·재진" value={VISIT_TYPE_KO[selectedResv.visit_type]} />
                      {selectedResv.id !== reservation.id && (
                        <>
                          <FieldRow label="예약경로" value={selectedResv.visit_route ?? '—'} />
                          <FieldRow label="예약등록자" value={selectedResv.registrar_name ?? '—'} />
                        </>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground italic">예약 선택 없음</div>
                  )}
                </div>
              </div>

              {/* AC-4 #5: 예약메모 (현재 보기 예약 기준) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="amber">예약메모</SectionHeader>
                {selectedResv ? (
                  <ReservationMemoTimeline
                    key={selectedResv.id}
                    reservationId={selectedResv.id}
                    clinicId={selectedResv.clinic_id}
                    authorName={authorName}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground italic">예약 선택 필요</div>
                )}
              </div>

              {/* AC-4 #6: 예약이력 (전체 예약 히스토리 + 변경이력). 히스토리 항목 클릭 → 상세 전환 */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-1 flex flex-col min-h-0" data-testid="popup-reservation-history">
                <SectionHeader accent="teal">
                  예약이력{visibleResvs.length > 0 && ` (${visibleResvs.length}건)`}
                  {registrarFilter && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">필터 적용</span>
                  )}
                </SectionHeader>
                <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 min-h-0">
                  {visibleResvs.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic py-2">
                      {registrarFilter ? '이 등록자 예약 없음' : '예약 없음'}
                    </div>
                  ) : (
                    visibleResvs.map((r) => {
                      const isFocused = r.id === selectedResvId;
                      const isOriginal = r.id === reservation.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedResvId(r.id)}
                          className={cn(
                            'w-full text-left px-2 py-1.5 rounded border text-xs transition-colors',
                            isFocused
                              ? 'bg-teal-50 border-teal-400'
                              : isOriginal
                                ? 'bg-blue-50 border-blue-200'
                                : 'border-transparent hover:bg-muted',
                            r.status === 'cancelled' && 'opacity-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium tabular-nums">
                              {r.reservation_date} {r.reservation_time.slice(0, 5)}
                            </span>
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                                VISIT_TYPE_BADGE_CLASS[r.visit_type],
                              )}
                            >
                              {VISIT_TYPE_KO[r.visit_type]}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            {STATUS_LABEL[r.status]}
                            {isOriginal && (
                              <span className="ml-1 text-blue-500 font-medium">← 현재</span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                {/* T-20260522-foot-RESV-HISTORY-SYNC: 예약 변경 이력 (단일 공유 패널 재사용) */}
                <div className="mt-2 pt-2 border-t shrink-0">
                  <div className="text-[11px] font-medium text-teal-700 mb-1">예약 변경 이력</div>
                  <ReservationAuditLogPanel
                    reservationId={selectedResv?.id ?? null}
                    compact
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 액션 푸터
              T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS(+POPUP-SYNC AC-6/7 단일구현):
                정상(confirmed) → [저장][예약취소][예약삭제]
                취소/노쇼      → [예약복원][저장][예약삭제]
              체크인 전환·노쇼·수정은 별도 보존 요소(b_an_decisions: 체크인전환 분리 보존). */}
          <DialogFooter className="px-6 py-3 border-t shrink-0 flex-wrap gap-2">
            {/* [저장] — 예약경로·예약등록자 영속 (AC-4a/4b) */}
            <Button
              size="sm"
              disabled={routeSaving || busy}
              data-testid="btn-reservation-save"
              onClick={saveRouteAndRegistrar}
            >
              {routeSaving ? '저장 중…' : '저장'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(reservation)}>
              수정
            </Button>
            {reservation.status === 'confirmed' && (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={convertToCheckIn}>
                  체크인 전환
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`${reservation.customer_name}님을 노쇼 처리하시겠습니까?`))
                      setStatus('noshow');
                  }}
                >
                  노쇼
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  data-testid="btn-reservation-cancel"
                  onClick={() => { setCancelReason(''); setCancelDialog(true); }}
                >
                  예약취소
                </Button>
              </>
            )}
            {(reservation.status === 'cancelled' || reservation.status === 'noshow') && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                data-testid="btn-reservation-restore"
                onClick={() => {
                  if (window.confirm(`${reservation.customer_name}님 예약을 복원하시겠습니까?`))
                    setStatus('confirmed');
                }}
              >
                예약복원
              </Button>
            )}
            {isAdmin && (
              <Button variant="destructive" size="sm" disabled={busy} data-testid="btn-reservation-delete" onClick={deleteReservation}>
                예약삭제
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 취소 사유 입력 다이얼로그 */}
      {cancelDialog && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o && !busy) { setCancelDialog(false); setCancelReason(''); }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>예약 취소 — {reservation.customer_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {reservation.reservation_date} {reservation.reservation_time.slice(0, 5)} 예약을
                취소합니다. 취소된 예약은 목록에 기록으로 남습니다.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="cancel-reason-popup">
                  취소 사유 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="cancel-reason-popup"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="취소 사유를 입력하세요"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setCancelDialog(false); setCancelReason(''); }}
                disabled={busy}
              >
                뒤로
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !cancelReason.trim()}
                onClick={cancelWithReason}
              >
                {busy ? '처리 중…' : '취소 확정'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── 보조: 섹션 헤더 (AC-6 미화 — 롱래CRM 스타일 일관 타이포 위계) ──────
// 컬러 액센트 바 + 동일 폰트 위계로 카드 제목을 통일. 기능 무관 순수 표현.

function SectionHeader({
  children,
  accent = 'teal',
  className,
}: {
  children: ReactNode;
  accent?: 'teal' | 'blue' | 'amber';
  className?: string;
}) {
  const bar =
    accent === 'blue' ? 'bg-blue-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-teal-500';
  const text =
    accent === 'blue' ? 'text-blue-700' : accent === 'amber' ? 'text-amber-700' : 'text-teal-700';
  return (
    <div className={cn('flex items-center gap-1.5 mb-2.5', className)}>
      <span className={cn('h-3.5 w-1 rounded-full', bar)} />
      <span className={cn('text-xs font-semibold tracking-tight', text)}>{children}</span>
    </div>
  );
}

// ─── 보조: 필드 한 줄 표시 (AC-6 — 라벨↔값 그리드 정렬) ─────────────────

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.75rem_1fr] gap-2 min-w-0 items-baseline">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium break-words min-w-0 text-foreground">{value}</span>
    </div>
  );
}
