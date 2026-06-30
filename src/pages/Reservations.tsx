// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. useChart() hook 경유만 허용. 변경 시 현장 승인 필수
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { addDays, format, parseISO, startOfWeek, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, TrendingUp, User, X } from 'lucide-react';
import { toast } from '@/lib/toast';
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
import { stripSimulationRows } from '@/lib/simulationFilter';
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
import { formatPhone, chartNoBadge } from '@/lib/format';
import { normalizeToE164 } from '@/lib/phone';
import { cn } from '@/lib/utils';
// T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER: resvKind 단일 소스화(중복 구현 금지).
//   기존 로컬 resvKind 정의 → 공유 lib(resvSlotAgg)로 이관. 예약상세팝업 시간대 패널과 동일 분류규칙 공유.
import { resvKind, summarizeKinds, type ResvKind } from '@/lib/resvSlotAgg';
// T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: HOURLY-GROUPING 정시 그룹핑 REVERT(예약관리 캘린더는 30분 슬롯 복원).
//   buildHourBuckets import 제거 — gridSlots(30분) 직접 사용으로 환원.
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import { CustomerQuickMenu } from '@/components/CustomerQuickMenu';
import { CustomerHoverCard } from '@/components/CustomerHoverCard';
// T-20260516-foot-CHART-OPEN-UNIFY AC-1: CustomerChartSheet 직접 렌더 제거 → AdminLayout ChartContext 통합
import MedicalChartPanel from '@/components/MedicalChartPanel';
import { useChart } from '@/lib/chartContext';
import { PaymentMiniWindow } from '@/components/PaymentMiniWindow';
import type { CheckIn, Reservation, Staff, VisitType } from '@/lib/types';
import { visitRouteOptionsFor } from '@/lib/types';
import { ReservationMemoTimeline, insertReservationMemo } from '@/components/ReservationMemoTimeline';
// T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE: 자동배정 알림을 날짜선택 옆에 배치(헤더에서 이전)
import AssignmentNotifyBell from '@/components/AssignmentNotifyBell';
// T-20260516-foot-RESV-DETAIL-POPUP: 4분할 예약 상세 팝업
import { ReservationDetailPopup } from '@/components/ReservationDetailPopup';
// T-20260525-foot-RESV-CANCEL-CTX: 예약 취소 모달
import { ReservationCancelModal } from '@/components/ReservationCancelModal';
// T-20260611-foot-RESV-CTXMENU-SMS-MISSING: 예약관리 우클릭 메뉴 '문자' 항목 복원(Dashboard.tsx 정본 미러)
import SendSmsDialog from '@/components/SendSmsDialog';
import { canAccess } from '@/lib/permissions';
import { RESERVATION_CREATED_VIA } from '@/lib/createdVia';

// AC-5 재오픈 fix: 모듈 레벨 클립보드 백업 — 컴포넌트 remount 시에도 상태 복원
// (navigate('/admin/reservations', { state }) + lazy/Suspense remount 케이스 대응)
let _clipboardBackup: { resv: Reservation; mode: 'copy' | 'cut' } | null = null;
let _clipboardTargetBackup: { date: string; time: string } | null = null;

const STATUS_STYLE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
  // T-20260622-foot-GREEN-COLOR-SAGE-RECOLOR: 체크인 상태 emerald → sage
  checked_in: 'bg-sage-100 text-sage-700 border-sage-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
  no_show: 'bg-red-100 text-red-700 border-red-200',
};

// T-20260611-foot-RESVCAL-DISPLAY-REWORK item3: 예약 카드 유형별 배경색
//   T-20260625-foot-COLOR-CONVENTION-UNIFY (총괄 A안): 초진=파랑 / 재진=초록 / 힐러(HL)=노랑.
//   (구 T-20260611 현장반전 초진초록/재진파랑 → A안으로 복귀, 전 surface 통일.)
//   힐러는 visit_type와 직교(healer_flag) → resvKind()로 우선 분류.
//   resvKind / ResvKind 는 @/lib/resvSlotAgg 단일 소스에서 import(중복 구현 금지, TIMESLOT-PICKER).
// item6: 동일 시간대 정렬 순서 초진 → 재진 → 힐러 → 기타
const KIND_ORDER: Record<ResvKind, number> = { new: 0, returning: 1, healer: 2, other: 3 };
// T-20260612-foot-WEEKCAL-HEADER-CARD-REDESIGN (3번): 예약카드 색상박스 전면 재작업.
//   롱래CRM 스타일 — 좌측 4px 컬러 액센트 + 풀 파스텔 배경 + 동일 톤 보더로 카드 경계 또렷.
//   색상 코딩(T-20260625 A안 최신): 초진=파랑(blue) / 재진=초록(firstvisit) / 힐러(HL)=노랑(healer).
const KIND_CARD_STYLE: Record<ResvKind, string> = {
  // T-20260625-foot-COLOR-CONVENTION-UNIFY (김주연 총괄 A안 확정, 6/25·6/27·6/29 재확인):
  //   초진=파랑(blue) / 재진=초록(firstvisit) — 예약관리만 잔존하던 T-20260611 현장반전(초진초록/재진파랑)을
  //   A안(초진파랑/재진초록)으로 복귀해 대시보드·팝업 등 타 surface와 통일. 신규색 0, 旣정의 토큰 재사용.
  new: 'border-l-4 border-l-blue-400 border-blue-200/80 bg-blue-50',
  returning: 'border-l-4 border-l-firstvisit-400 border-firstvisit-200/80 bg-firstvisit-50',
  // T-20260625-foot-COLOR-WARMPASTEL-DESATURATE A안: 힐러 노랑 = healer 전용 토큰(#FFFDE7 carve-out, AC6). 의미색 yellow와 분리.
  healer: 'border-l-4 border-l-healer-400 border-healer-200/80 bg-healer-50',
  other: 'border-l-4 border-l-amber-400 border-amber-200/80 bg-amber-50',
};
// item1/2: 헤더·슬롯 카운트 점 색상 (유형별)
const KIND_DOT: Record<ResvKind, string> = {
  new: 'bg-blue-500', // T-20260625-foot-COLOR-CONVENTION-UNIFY A안: 초진 dot 파랑(blue)
  returning: 'bg-firstvisit-500', // T-20260625 A안: 재진 dot 초록(firstvisit)
  healer: 'bg-healer-500', // T-20260625-WARMPASTEL A안: 힐러 dot 골드 액센트 #FBC02D(healer 토큰)
  other: 'bg-amber-500',
};

const STATUS_LABEL: Record<Reservation['status'], string> = {
  confirmed: '예약',
  checked_in: '체크인',
  cancelled: '취소',
  no_show: '노쇼',
};

// AC-1: 예약수정 모달 시간 선택 드롭다운 — 07:00~22:00, 30분 단위
const EDIT_TIME_SLOTS = generateSlots('07:00', '22:00', 30);

// T-20260525-foot-TIMETABLE-POST16-SLOT: 슬롯별 최대 예약 수
// 16:00 이전: 12건 상한 (초진 6 + 재진 6), 16:00 이후: 10건 상한
const SLOT_MAX_TOTAL = 12;
const POST16_SLOT_MAX = 10;
/** 시간대 기반 슬롯 최대 예약 수 반환 (T-20260525-foot-TIMETABLE-POST16-SLOT) */
function slotMaxFor(time: string): number {
  return parseInt(time.split(':')[0], 10) >= 16 ? POST16_SLOT_MAX : SLOT_MAX_TOTAL;
}

interface ReservationDraft {
  date: string;
  time: string;
  name: string;
  phone: string;
  visit_type: VisitType;
  memo: string;
  booking_memo: string;  // T-20260504-foot-MEMO-RESTRUCTURE: 예약 경로 확인용
  visit_route?: string;  // AC-5: 초진/예약없이방문 방문경로 (customers.visit_route에 저장)
  referral_name?: string; // T-20260515-foot-REFERRAL-NAME: 지인소개 시 소개자 성함
  registrar_type?: string; // T-20260612-foot-RESV-ROUTE-AUTOCLASS: 등록자 선택('desk'|'tm') → 방문경로 대분류 자동 고정 (form-only, DB 미저장)
  existingId?: string;
  // T-20260610-foot-RESV-OVERHAUL-7 AC-6/AC-7: 예약상세(수정) 모달 푸터 버튼 분기용 상태
  //   confirmed → [저장][예약취소][예약삭제] / cancelled → [예약복원][저장][예약삭제]
  status?: Reservation['status'];
  service_id?: string | null;
  customer_id?: string | null;
  /** T-PROGRESS-CHECKPOINT AC-2/3: 예약에 연결할 패키지 ID */
  linked_package_id?: string | null;
  /** T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 힐러 의도(영속) — 팝업 ON/OFF 토글. */
  is_healer_intent?: boolean;
}

// ─── T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (옵션A · L-002 개정) ───────────────
//   예약 '신규 생성' 단일소스 함수. 기존 ReservationEditor.save() 의 신규(INSERT) 경로를 그대로 추출.
//   ReservationEditor(우클릭/+버튼 동선)와 예약상세 팝업 new-mode 가 '동일' 이 함수를 호출 → 단일 생성경로 유지.
//   🔒 L-002(개정): 생성경로는 이 함수 1곳뿐. 팝업은 이 함수를 직접 import 하지 않고 parent 콜백으로만 위임(팝업 내 reservations.insert = 0 자구).
//   생성 무결성 5요소 전부 함수 내 보존: ① slot 상한 ② 패키지연결(progress) ③ 경과체크 ④ 치료사 역동기화 ⑤ 생성로그.
//   ⚠ 고객 INSERT(전화→신규고객 생성)는 호출측 책임 — 이 함수는 resolve 된 customerId 를 받음(팝업 new-mode 는 검색으로 선택된 고객만 대상).
type CanonicalCreateInput = {
  clinicId: string;
  customerId: string | null;
  name: string;
  phone: string | null;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  visit_type: VisitType;
  service_id?: string | null;
  memo?: string | null;
  booking_memo?: string | null;
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모(초진 주증상 — 발톱무좀/내성발톱 선택 또는 직접입력).
  //   reservations.brief_note (W2 신규 컬럼). booking_memo(예약메모)와 별개 칸. CRM-local 임상 메타.
  brief_note?: string | null;
  visit_route?: string | null;
  registrar_id?: string | null; // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: 예약등록자(예약행 컬럼 기존)
  registrar_name?: string | null; // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE: 예약등록자 표시 스냅샷(생성 시 영속)
  referral_name?: string | null;
  linked_package_id?: string | null;
  preferred_therapist_id?: string | null; // 재진 치료사(역동기화 대상)
  is_healer_intent?: boolean; // T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 힐러 의도(영속)
  progressCheck?: { required: boolean; label: string | null } | null;
  maxPerSlot: number;
  changedBy: string | null;
  authorName: string;
  onDuplicateConfirm?: (msg: string) => boolean; // 같은날 중복예약 confirm (취소 시 생성 중단)
};
type CanonicalCreateResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: 'slot_full' | 'duplicate_cancelled' | 'error'; message?: string };

// T-20260615-foot-RESVPOPUP-3BUG AC2 (BUG-2): is_healer_intent 컬럼 운영 DB 미반영(마이그 20260614130000 미적용) 내성화.
//   READ 경로(ReservationDayTimeslotPanel, DETAIL-8FIX AC4)는 이미 컬럼 제외 재조회로 graceful 처리됐으나,
//   신규예약 생성(INSERT)·수정(UPDATE) WRITE 경로는 payload 에 is_healer_intent 가 그대로 남아
//   PostgREST 가 "Could not find the 'is_healer_intent' column ... in the schema cache"(PGRST204)
//   또는 42703(undefined_column)을 던져 '신규예약 생성' 버튼 클릭 시 오류(현장 스샷 F0BBDM8314Y)로 표면화.
//   ⇒ 동일 패턴으로 WRITE 도 내성화: 컬럼 누락 에러 감지 시 is_healer_intent 제외 payload 로 1회 재시도.
//   ⚠ 영구 RC = 마이그 미적용 → supervisor/planner FOLLOWUP 으로 마이그 적용 권고(본 FE 내성화는 즉시 unblock 용).
function isHealerIntentColMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    /is_healer_intent/.test(err.message ?? '')
  );
}

async function createReservationCanonical(input: CanonicalCreateInput): Promise<CanonicalCreateResult> {
  const normalizedPhone = input.phone ? (normalizeToE164(input.phone) ?? input.phone.trim()) : null;

  // ① slot 상한 — 같은 시간대 활성 예약 수가 상한 도달 시 생성 차단
  {
    const { count } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', input.clinicId)
      .eq('reservation_date', input.date)
      .eq('reservation_time', input.time)
      .neq('status', 'cancelled');
    if ((count ?? 0) >= input.maxPerSlot) {
      return { ok: false, reason: 'slot_full', message: `이 시간대는 마감입니다 (${count}/${input.maxPerSlot})` };
    }
  }

  // 같은 고객 같은날 중복예약 확인 (callback 으로 사용자 confirm — 미전달 시 통과)
  if (input.customerId) {
    const { count } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', input.clinicId)
      .eq('customer_id', input.customerId)
      .eq('reservation_date', input.date)
      .neq('status', 'cancelled');
    if ((count ?? 0) > 0) {
      const proceed = input.onDuplicateConfirm
        ? input.onDuplicateConfirm(`${input.name}님은 이미 ${input.date}에 예약이 있습니다. 계속하시겠습니까?`)
        : true;
      if (!proceed) return { ok: false, reason: 'duplicate_cancelled' };
    }
  }

  // 초진 방문경로 → customers 동기 (visit_route / lead_source / referral_name)
  if (input.customerId && input.visit_type === 'new' && input.visit_route) {
    const customerUpdate: Record<string, string | null> = {
      visit_route: input.visit_route,
      lead_source: input.visit_route,
    };
    if (input.visit_route === '지인소개') {
      customerUpdate.referral_name = input.referral_name?.trim() || null;
    }
    await supabase.from('customers').update(customerUpdate).eq('id', input.customerId);
  }

  // ② 패키지연결 + 치료사 preferred 포함 페이로드
  const payload = {
    clinic_id: input.clinicId,
    customer_id: input.customerId,
    customer_name: input.name.trim(),
    customer_phone: normalizedPhone || null,
    reservation_date: input.date,
    reservation_time: input.time,
    visit_type: input.visit_type,
    service_id: input.service_id || null,
    memo: input.memo?.trim() || null,
    booking_memo: input.booking_memo?.trim() || null,
    // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모 영속(전용 컬럼, memo 오버로드 금지).
    brief_note: input.brief_note?.trim() || null,
    // T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 힐러 의도(영속) — 캘린더 직접예약 시점에 저장.
    is_healer_intent: input.is_healer_intent ?? false,
    referral_source: (input.visit_type === 'new' && input.visit_route) ? input.visit_route : null,
    // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: 예약경로/예약등록자를 예약행에 직접 영속(편집경로 popup L928 과 동일 컬럼).
    //   기존 컬럼(reservations.visit_route / registrar_id) — 신규 스키마 0. 미전달(다른 생성경로)이면 null 로 무해.
    visit_route: input.visit_route ?? null,
    registrar_id: input.registrar_id ?? null,
    // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE: 예약등록자 이름 스냅샷도 생성 시 영속.
    //   기존 컬럼(reservations.registrar_name) — 신규 스키마 0. 편집경로(popup saveRouteAndRegistrar)와 동일 컬럼.
    //   ⚠ 감사용 created_by/updated_by 와 별개의 표시·선택 값 — 감사추적 불변(AC3).
    registrar_name: input.registrar_name ?? null,
    // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC1): 담당자=생성 계정. 캘린더 생성경로에서 created_by(로그인 auth uid) 명시 보장.
    //   created_by 는 stats.ts TM 귀속 SSOT이기도 함 → 생성 시 1회만 기록(이후 불변, 수정자는 updated_by 별도).
    created_by: input.changedBy,
    // T-20260628-crm-RESV-CREATED-VIA-FILL §2: 어드민 캘린더 직접예약(신규/재진 공통) = 수기 생성경로 → manual.
    created_via: RESERVATION_CREATED_VIA.MANUAL,
    ...(input.visit_type === 'returning' ? { preferred_therapist_id: input.preferred_therapist_id || null } : {}),
    // ③ 경과체크 — 패키지 연결 시 체크포인트 도달 여부 저장 (원본 save() 동일 시맨틱)
    ...(input.linked_package_id ? {
      progress_check_required: input.progressCheck?.required ?? false,
      progress_check_label: input.progressCheck?.label ?? null,
    } : {}),
  };

  const insertBody = { ...payload, status: 'confirmed' };
  let result = await supabase
    .from('reservations')
    .insert(insertBody)
    .select('id')
    .maybeSingle();
  // T-20260615-foot-RESVPOPUP-3BUG AC2: is_healer_intent 컬럼 미반영(PGRST204/42703) 시 제외 후 1회 재시도.
  if (result.error && isHealerIntentColMissing(result.error)) {
    const { is_healer_intent: _omit, ...bodyNoHealer } = insertBody as typeof insertBody & { is_healer_intent?: boolean };
    void _omit;
    result = await supabase
      .from('reservations')
      .insert(bodyNoHealer)
      .select('id')
      .maybeSingle();
  }
  if (result.error) return { ok: false, reason: 'error', message: result.error.message };
  const savedId = (result.data as { id: string } | null)?.id;
  if (!savedId) return { ok: false, reason: 'error', message: '예약이 생성되지 않았습니다.' };

  // ⑤ 생성로그
  await supabase.from('reservation_logs').insert({
    reservation_id: savedId,
    clinic_id: input.clinicId,
    action: 'create',
    old_data: null,
    new_data: {
      date: input.date,
      time: input.time.slice(0, 5),
      visit_type: input.visit_type,
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone,
      service_id: payload.service_id,
      memo: payload.memo,
    },
    changed_by: input.changedBy,
  });

  // 예약메모 → 이력 테이블
  if (input.booking_memo?.trim()) {
    await insertReservationMemo(savedId, input.clinicId, input.booking_memo.trim(), input.authorName);
  }

  // ④ 치료사 역동기화 — 재진 + 치료사 선택 + 고객 → customers.designated_therapist_id
  if (input.visit_type === 'returning' && input.preferred_therapist_id && input.customerId) {
    await supabase
      .from('customers')
      .update({ designated_therapist_id: input.preferred_therapist_id })
      .eq('id', input.customerId);
  }

  return { ok: true, reservationId: savedId };
}

type ViewMode = 'week' | 'day';

export default function Reservations() {
  // T-20260516-foot-CHART-OPEN-UNIFY AC-1: AdminLayout ChartContext (단일 소스)
  // LOGIC-LOCK: L-004 [CHART-LOCK-010] — openChart 호출은 useChart() 경유만. 직접 접근 금지.
  const { openChart } = useChart();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const changedBy = profile?.id ?? null;
  // T-20260613-foot-RESVCAL-MYRESV-DEF: '내 예약' NAME-MATCH 키 = 로그인 사용자 표시명(profile.name).
  //   user_profiles.name ↔ reservations.registrar_name 문자열 매칭(공백 정규화). 빈 표시명이면 매칭 불가 → 빈 결과.
  const myDisplayName = (profile?.name ?? '').trim();
  const clinic = useClinic();
  const navStateConsumed = useRef(false);
  // T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV: 대시보드 슬롯 카드 우클릭 [예약상세] → 이 페이지로
  //   라우팅하며 넘어온 예약상세 팝업 오픈 요청(location.state.openReservationDetail)을 1회만 소비하는 가드.
  //   openReservationFor(navStateConsumed)와 별도 ref — 서로 다른 동선이 같은 mount에서 간섭하지 않도록 분리.
  const navDetailConsumed = useRef(false);
  // T-20260630-foot-RESV-CUSTCTX-PREFILL: 고객 컨텍스트(customer_id+고객명)를 navigation state로 받아
  //   슬롯 클릭 시 신규예약 폼에 해당 고객을 자동 prefill(재진)하기 위한 1회 소비 가드 — 동선1·동선2 공용 수신부.
  //   ⚠ defer-to-slot-click: 진입 즉시 폼을 열지 않고(openReservationFor 동선과 분리) pendingPrefillCustomer에
  //   적재만 → 사용자가 빈 슬롯을 클릭(openNewSlot)할 때 비로소 prefill 신규폼이 뜬다.
  const navPrefillConsumed = useRef(false);
  // T-20260527-foot-TREATMENT-CYCLE-ALERT AC-4: 마운트 자동로드 중복 방지.
  // StrictMode 이중 마운트(dev) / 동일 파라미터 재렌더 시 fetchWeek 중복 실행 → RPC N+1 차단.
  const lastAutoFetchKeyRef = useRef<string | null>(null);
  // 자기 noshow 자동 UPDATE가 realtime 자기-트리거로 fetchWeek 재호출하는 것을 막는 suppress 윈도우.
  const selfWriteUntilRef = useRef(0);
  // T-20260515-foot-RESV-BOX-INTERACT: AC-4 단일클릭/더블클릭 300ms 디바운스 타이머
  const clickTimerRef = useRef<{ resvId: string; timerId: ReturnType<typeof setTimeout> } | null>(null);
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [1-a]: 예약관리 진입 기본값 주간→일간.
  // ⚠ default view만 변경 — 격자 구조/시간 가로배열(1-b)은 WAVE3 별도, 무변경.
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  // T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 예약관리 경과분석 ON/OFF 필터 + 캘린더형 경과분석 뷰 완전 제거.
  //   이전 filterProgress state/토글/필터 분기 회수 → 예약관리는 항상 전체 예약 표시(기존 OFF 동작 = 기본).
  //   ⚠ progress_check_required 트리거/배지(읽기전용 표시)는 유지 — 치료테이블 [경과분석] 탭 데이터 소스.
  // T-20260613-foot-RESVCAL-MYRESV-DEF (기능2): '내 예약' 필터.
  //   정의(reporter 확정): (나)=담당(registrar) 이름 기준 — registrar_name === 로그인 사용자 표시명(profile.name).
  //   NAME-MATCH(문자열) 매칭이며 FK/auth.uid 신원 매핑 아님. ⚠ 동명이인 시 동명 registrar 예약이 함께
  //   보일 수 있으나 현장이 '이름 기준'을 명시 선택해 수용(AC3). created_by/auth 매핑 데이터 티켓 불요.
  const [filterMine, setFilterMine] = useState(false);
  // T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD: '내 예약' 모드에서 담당자(예약등록자) 선택 드롭다운.
  //   '' = 본인(myDisplayName) 기준(현행 NAME-MATCH 유지). 특정 담당자명 선택 → 그 registrar_name 기준 필터.
  //   옵션 소스 = reservation_registrars(예약등록자 마스터, active) — registrar_name 스냅샷과 동일 소스라 NAME-MATCH 정합.
  //   DB 변경 0(read-only). 1차 권한 정책: 전체 staff 선택 허용(시나리오2 reporter 확인 대상).
  const [filterAssignee, setFilterAssignee] = useState('');
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([]);
  // T-20260514-foot-CHART-NO-VISIBLE: AC-2 예약관리 차트번호 컬럼 (customer_id → chart_number)
  const [resvChartMap, setResvChartMap] = useState<Map<string, string>>(new Map());
  // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC1): 예약관리 '담당자' = 예약 잡은 계정.
  //   reservation_id → COALESCE(updated_by, created_by)(auth uid) → user_profiles.name.
  //   생성=created_by, 일자/시간 변경 등 UPDATE=updated_by overwrite → 마지막 수정 계정으로 표시 갱신(AC2).
  //   미상(둘 다 NULL=과거 예약) 시 미표시(AC5). ★SCOPE: 예약관리 표시 한정 — 2번차트/고객 목록·상세의
  //   customers.assigned_staff_id(차트 담당자) 의미는 불변(회귀0, CUSTOMER-STAFF-AUTOLINK 유지).
  const [resvBookerMap, setResvBookerMap] = useState<Map<string, string>>(new Map());
  // T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN: 예약메모 SoT 배선.
  //   예약상세 팝업의 '예약메모' 저장은 reservation_memo_history(append-only timeline)에 들어가고
  //   reservations.booking_memo 컬럼은 생성시 초기메모만 갖는 부분 미러 → 추후 추가분이 hover에 미표시되던 버그.
  //   reservation_id → '대표 메모 1줄'(pinned 우선, 없으면 최신 created_at) 맵. resvBookerMap 패턴 미러.
  const [resvMemoMap, setResvMemoMap] = useState<Map<string, string>>(new Map());

  const [editor, setEditor] = useState<ReservationDraft | null>(null);
  const [detail, setDetail] = useState<Reservation | null>(null);
  // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (AC2 시나리오1): (+) 새 예약 → 예약상세 팝업 new-mode 오픈
  //   (별도 폼/ReservationEditor 모달 스폰 폐기). reservation=null 이어도 팝업이 검색→생성 폼만 렌더.
  const [newReservationMode, setNewReservationMode] = useState(false);
  // T-20260615-foot-RESVMGMT-REFIX-8 AC3 (planner GO): 빈슬롯 (+) → new-mode 진입 시 클릭 슬롯 날짜/시간 prefill 운반.
  //   상단 '새 예약' 버튼은 null 로 리셋(빈 진입). 팝업 close/changed 시에도 클리어.
  const [newReservationInitial, setNewReservationInitial] = useState<{ date: string; time: string } | null>(null);
  // T-20260630-foot-RESV-CUSTCTX-PREFILL: navigation state로 받은 고객을 슬롯 클릭 시 신규예약 폼에 자동 prefill 하기 위한
  //   대기 컨텍스트(완전한 PatientMatch — 수신부에서 customers 조회로 연락처/차트번호 enrich). null = 일반 진입(빈 폼, AC4 회귀).
  //   sticky: 페이지에 머무는 동안 유지(연속 예약), 다른 화면으로 navigate 시 remount로 자연 소거.
  const [pendingPrefillCustomer, setPendingPrefillCustomer] = useState<PatientMatch | null>(null);
  const [noshowByCustomer, setNoshowByCustomer] = useState<Record<string, number>>({});
  // T-20260527-foot-TREATMENT-CYCLE-ALERT AC-1: 고객별 완료 치료 회차 수 (패키지 무관)
  const [treatmentCycleMap, setTreatmentCycleMap] = useState<Map<string, number>>(new Map());
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item2): 고객별 활성 패키지 진행률(사용/총) — 재진 카드 "패키지 N/N".
  //   used = package_sessions status='used' count, total = packages.total_sessions. 다중 활성 시 최신(created_at desc) 1건.
  //   read-only 집계(스키마 무변경 → data-architect CONSULT 면제).
  const [pkgProgressMap, setPkgProgressMap] = useState<Map<string, { used: number; total: number }>>(new Map());
  // T-20260611-foot-HEALER-DEDUCT-LINK: 고객별 '다음 예약이 힐러' read-only 표시.
  //   값 = 가장 이른 예정(미래) 힐러 예약 datetime 키(`${date} ${time}`). 차감 트랜잭션 무접촉.
  const [nextHealerByCustomer, setNextHealerByCustomer] = useState<Record<string, string>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // T-20260515-foot-RESV-DND-SHORTCUT: 키보드 클립보드 (Ctrl+C/X/V)
  // AC-5 재오픈 fix: 모듈 레벨 백업에서 초기화 → remount 후에도 클립보드 유지
  const [selectedResvId, setSelectedResvId] = useState<string | null>(null);
  // T-20260624-foot-RESVMGMT-DAILY-TIMEGRID-VERTICAL: C4(클릭→한 줄 나열) 폐기 → 시간 격자 상시 세로 진열.
  //   더 이상 선택 슬롯 상태 불필요(클릭-투-리빌 제거). 주간 보기는 현행 유지(이 경로 미사용).
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
  // T-20260516-foot-RESV-PLUS-CANVAS AC-2 🔒L-004: tabletModal 상태 유지하되 [+] 버튼에서 미사용
  const [tabletModalOpen, setTabletModalOpen] = useState(false);
  const [tabletModalInfo, setTabletModalInfo] = useState<{ date: string; time: string } | null>(null);

  // T-20260515-foot-RESV-CTX-HOVER: 예약관리 우클릭 메뉴 + hover 팝업
  const [resvContextMenu, setResvContextMenu] = useState<{ resv: Reservation; pos: { x: number; y: number } } | null>(null);
  // T-20260516-foot-CHART-OPEN-UNIFY AC-1: resvChartSheetId 제거 → useChart() 단일 소스로 통합
  const [resvMedicalChartOpen, setResvMedicalChartOpen] = useState(false);
  const [resvMedicalChartCustomerId, setResvMedicalChartCustomerId] = useState<string | null>(null);
  const [resvMiniPayTarget, setResvMiniPayTarget] = useState<CheckIn | null>(null);
  // T-20260611-foot-RESV-CTXMENU-SMS-MISSING: 우클릭 '문자' → SendSmsDialog 대상(Dashboard.tsx 정본 미러)
  const [smsTarget, setSmsTarget] = useState<CheckIn | null>(null);
  const [resvMiniPayCounter, setResvMiniPayCounter] = useState(0);
  // T-20260525-foot-RESV-CANCEL-CTX: 예약 취소 모달 상태
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const weekDays = useMemo(
    () => Array.from({ length: 6 }).map((_, i) => addDays(weekStart, i)), // 월~토만
    [weekStart],
  );

  // ── T-20260609-foot-RESV-LIVE-AUTOSCROLL ─────────────────────────────────────
  // 대시보드 통합시간표(T-20260603-foot-TIMETABLE-NOW-AUTOSCROLL)의 현재시각 auto-scroll
  // 로직을 예약관리 타임테이블에 그대로 이식. 신규 메커니즘 없이 동일 패턴 재사용:
  //   now 30초 틱 + isToday 가드 + 진입 시 1회 scrollIntoView('center') + 가장자리 클램핑 폴백.
  // 대시보드는 30분 고정 라운딩이나, 예약 그리드는 clinic.slot_interval 단위 행이므로
  // 동일 패턴을 slot_interval 내림으로 일반화(ref 타깃·scrollIntoView·클램핑 구조는 동일).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // tbody 시간 행 소스 — JSX와 단일화 (그리드 행 시각 목록)
  const gridSlots = useMemo(
    () =>
      clinic
        ? generateSlots(
            clinic.open_time,
            // day view: 선택일 close_time / week view: clinic.close_time(평일 최대)
            viewMode === 'day' ? closeTimeFor(selectedDay, clinic) : clinic.close_time,
            clinic.slot_interval,
          )
        : [],
    [clinic, viewMode, selectedDay],
  );

  // 현재 시각 슬롯 ('HH:mm', slot_interval 단위 내림) — 행 ref 타깃 키
  // T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: HOURLY-GROUPING 정시 버킷(hourBuckets/currentHourKey) 제거 →
  //   예약관리 캘린더는 30분 단위 슬롯(gridSlots) 행으로 복원. (총괄: 정시 묶기는 진료대시보드 한정.)
  const currentH = now.getHours();
  const currentM = now.getMinutes();
  const slotInterval = clinic?.slot_interval ?? 30;
  const flooredM = Math.floor(currentM / slotInterval) * slotInterval;
  const currentSlot = `${String(currentH).padStart(2, '0')}:${String(flooredM).padStart(2, '0')}`;

  // AC-5: 오늘이 현재 뷰에 보일 때만 자동 스크롤 (day=선택일이 오늘 / week=이번 주가 오늘 포함)
  const isTodayInView =
    viewMode === 'day'
      ? isSameDay(selectedDay, now)
      : weekDays.some((d) => isSameDay(d, now));

  // 세로 스크롤 컨테이너 ref + 현재 슬롯 행 ref + 진입 1회 플래그
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentSlotRef = useRef<HTMLTableRowElement>(null);
  const didInitialScrollRef = useRef(false);

  // 테이블(시간 행)이 실제 DOM에 렌더되는 조건 — 로딩 스켈레톤이 사라진 뒤에만 스크롤 가능
  const gridReady = !!clinic && !(loading && rows.length === 0);

  // AC-1/AC-2: 현재 시각 행을 뷰포트 중앙으로. 행이 없으면(영업시간 외) 첫/마지막 행 클램핑.
  const toMin = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
  const scrollToNow = useCallback(() => {
    if (!isTodayInView) return;
    // 1순위: 현재 슬롯 행 (정확한 시각 위치)
    if (currentSlotRef.current) {
      currentSlotRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // 폴백: 현재 슬롯 행 없음(영업시간 외) → 첫/마지막 행으로 클램핑
    const container = scrollContainerRef.current;
    if (!container || gridSlots.length === 0) return;
    const slotRows = container.querySelectorAll<HTMLElement>('[data-testid="resv-slot-row"]');
    if (slotRows.length === 0) return;
    const nowMin = currentH * 60 + currentM;
    if (nowMin <= toMin(gridSlots[0])) {
      slotRows[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      slotRows[slotRows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [isTodayInView, gridSlots, currentH, currentM]);

  // AC-1/AC-4: 진입(또는 오늘 포함 뷰로 복귀·로딩 완료) 시 1회만 자동 스크롤. 이후 사용자 스크롤 보존.
  //            오늘이 뷰에서 벗어나면 플래그 리셋 → 복귀 시 다시 1회 스크롤(대시보드와 동일 UX).
  useEffect(() => {
    if (!isTodayInView) { didInitialScrollRef.current = false; return; }
    if (!gridReady) return; // 시간 행 DOM 준비 전이면 대기 (로딩 완료 시 재실행)
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const raf = requestAnimationFrame(() => scrollToNow());
    return () => cancelAnimationFrame(raf);
  }, [isTodayInView, gridReady, scrollToNow]);

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

  // T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV: 대시보드 슬롯 카드/고객카드 우클릭 [예약상세] →
  //   navigate('/admin/reservations', { state: { openReservationDetail: <Reservation> } }) 로 넘어온 요청을
  //   소비해 예약관리 정본 팝업(setDetail)을 즉시 오픈.
  //   ⚠ 정합: 대시보드에 별도 팝업 인스턴스를 두지 않고(중복 마운트 제거) 이 단일 정본 팝업(detail)만 사용 →
  //   POPUP-SYNC(field-soak) 와 동기화 깨짐 방지. 전체 Reservation 객체를 state로 전달받아 추가 fetch 없이
  //   라우팅 직후 깜빡임 없이 팝업이 열린 채로 보이게 한다(라우팅 unmount→재오픈 흐름을 사용자 무지각화).
  useEffect(() => {
    if (navDetailConsumed.current) return;
    const state = location.state as { openReservationDetail?: Reservation } | null;
    const resv = state?.openReservationDetail;
    if (!resv) return;
    navDetailConsumed.current = true;
    window.history.replaceState({}, '');
    setDetail(resv);
  }, [location.state]);

  // T-20260630-foot-RESV-CUSTCTX-PREFILL: 고객 컨텍스트 → 슬롯클릭 pre-fill 수신부 코어(grid-robust).
  //   동선1(대시보드 고객박스 우클릭 [예약상세])·동선2(2번차트 [다음예약])가 공통으로
  //   navigate('/admin/reservations', { state: { prefillCustomerForSlot: { customer_id, name } } }) 로 넘겨준 고객을 소비.
  //   ⚠ 주입 지점 = 구 DOM 슬롯카드 핸들러가 아닌 '신규예약 폼 opener(openNewSlot→new-mode 팝업 initialCustomer)' 레이어 →
  //   슬롯 핸들러가 구 openNewSlot 이든 미래 격자 핸들러든 동일 폼 opener 경유로 prefill 생존(PLANNER DECISION-2 [2] (B)).
  //   전달 데이터 = customer_id + 고객명(둘 다 旣존재 식별자, 신규 PII·스키마 0). 연락처/차트번호는 여기서 customers 조회로 enrich.
  useEffect(() => {
    if (navPrefillConsumed.current) return;
    if (!clinic) return;
    const state = location.state as {
      prefillCustomerForSlot?: { customer_id: string; name: string };
    } | null;
    const ctx = state?.prefillCustomerForSlot;
    if (!ctx?.customer_id) return;
    navPrefillConsumed.current = true;
    window.history.replaceState({}, '');
    // customers 조회로 연락처/생년월일/차트번호 enrich → 완전한 PatientMatch 구성(폼 자동표시·재진 식별 보조).
    supabase
      .from('customers')
      .select('id, name, phone, chart_number')
      .eq('id', ctx.customer_id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { id: string; name: string | null; phone: string | null; chart_number: string | null } | null;
        setPendingPrefillCustomer({
          id: ctx.customer_id,
          name: row?.name ?? ctx.name ?? '',
          phone: row?.phone ?? '',
          birth_date: null,
          chart_number: row?.chart_number ?? null,
        });
      });
  }, [clinic, location.state]);

  // AC-7: 좌측 캘린더 날짜 클릭 → 해당 날짜 포함 주로 이동 (state 방식 — 레거시 호환)
  useEffect(() => {
    const state = location.state as { goToWeekOf?: string } | null;
    if (!state?.goToWeekOf) return;
    window.history.replaceState({}, '');
    const targetDate = parseISO(state.goToWeekOf);
    setWeekStart(startOfWeek(targetDate, { weekStartsOn: 1 }));
    setViewMode('week');
  }, [location.state]);

  // T-20260517-foot-MINICAL-REGRESS: URL ?date=YYYY-MM-DD 파라미터 감지 → 예약판 날짜 전환
  // CalendarNoticePanel이 navigate('/admin/reservations?date=...') 로 전환 시 이미 마운트된
  // Reservations 컴포넌트가 searchParams 변경을 즉시 감지해 selectedDay + weekStart 갱신.
  // (state 방식은 replaceState 후 재클릭 시 불안정 + 새로고침 소실 문제 있음)
  // goPrev/goNext 는 setWeekStart 직접 호출이므로 루프 없음.
  const dateParam = searchParams.get('date');
  useEffect(() => {
    if (!dateParam) return;
    const parsed = new Date(`${dateParam}T00:00:00`);
    if (isNaN(parsed.getTime())) return;
    setSelectedDay((prev) => {
      const prevStr = format(prev, 'yyyy-MM-dd');
      return prevStr === dateParam ? prev : parsed;
    });
    setWeekStart(startOfWeek(new Date(`${dateParam}T00:00:00`), { weekStartsOn: 1 }));
    // T-20260629-foot-RESVCAL-DAYCLICK-EXPAND-STAY (항목7) × DAILY-DEFAULT-HORIZ (항목1):
    //   달력 일자 클릭 시 '해당 일자 예약현황으로 이동' = 그 날짜의 *일간(day)* 현황으로 이동.
    //   (구: 'week' 강제 — 일간 기본값(항목1)을 매 달력클릭마다 주간으로 되돌려 6/25 개편2탄 daily-centric
    //    의도와 충돌. weekStart 는 위에서 갱신해두므로 사용자가 수동 주간 전환 시 해당 주가 그대로 노출.)
    setViewMode('day');
  }, [dateParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchWeek = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    // T-20260615-foot-RESV-DWELL-LOADING-STUCK: fetchWeek 전구간 try/catch/finally 가드.
    //   회귀 진단 결과 6cdce9d(REFIX-8 레이아웃)는 fetch/loading 경로 무접촉 → 회귀 원인 아님.
    //   실제 무한 로딩 고착 RC = 본 함수에 예외 경계가 없던 것: supabase await가 reject(네트워크 단절·
    //   PostgREST throw)하거나 stripSimulationRows가 throw하면 setLoading(false)에 도달 못 해
    //   '불러오는 중…' 스피너가 영구 고착(새로고침 전 자가복구 불가). field-soak 중 일시적 fetch 실패가
    //   이 잠복 결함을 영구화. finally에서 로딩을 무조건 해제해 어떤 예외 경로에서도 그리드가 복구되도록 보장.
    //   (REFIX-8 레이아웃 COMPLEMENT — 레이아웃/동선 코드 무변경)
    try {
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
    // T-20260610-foot-ADMIN-SIM-FILTER: 시뮬레이션 고객(customer_id→is_simulation=true)에
    // 연결된 예약은 캘린더/목록에서 숨김. 워크인(customer_id null)·실고객 예약은 보존.
    const list = await stripSimulationRows((data ?? []) as Reservation[]);

    // Auto noshow: past confirmed reservations
    const today = format(new Date(), 'yyyy-MM-dd');
    const pastConfirmed = list.filter(
      (r) => r.status === 'confirmed' && r.reservation_date < today,
    );
    if (pastConfirmed.length > 0) {
      // 자기 쓰기 → realtime 자기-트리거 억제 (AC-4: 단일 배치 로딩 보장)
      selfWriteUntilRef.current = Date.now() + 2500;
      await supabase
        .from('reservations')
        .update({ status: 'no_show' })
        .in('id', pastConfirmed.map((r) => r.id));
      for (const r of pastConfirmed) r.status = 'no_show';
    }

    setRows(list);
    setLoading(false);

    // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC1/AC2): 예약관리 담당자 = 예약 잡은 계정.
    //   각 예약의 COALESCE(updated_by, created_by)(auth uid) → user_profiles.name resolve.
    //   워크인(customer_id NULL) 예약도 포함 → list 전체 기준(customerIds 블록 밖). 결손(둘 다 NULL=과거) 시 미표시(AC5).
    {
      const bookerUidByResv = new Map<string, string>(); // reservation_id → auth uid
      for (const r of list) {
        const uid = (r.updated_by ?? r.created_by ?? '').trim();
        if (uid) bookerUidByResv.set(r.id, uid);
      }
      const bookerUids = Array.from(new Set(bookerUidByResv.values()));
      const bookerM = new Map<string, string>(); // reservation_id → name
      if (bookerUids.length > 0) {
        const { data: upRows } = await supabase
          .from('user_profiles')
          .select('id, name')
          .in('id', bookerUids);
        const nameByUid = new Map<string, string>();
        for (const u of (upRows ?? []) as { id: string; name: string | null }[]) {
          const nm = (u.name ?? '').trim();
          if (nm) nameByUid.set(u.id, nm);
        }
        for (const [resvId, uid] of bookerUidByResv) {
          const nm = nameByUid.get(uid);
          if (nm) bookerM.set(resvId, nm);
        }
      }
      setResvBookerMap(bookerM);
    }

    // T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN: 예약메모 hover 표시를 SoT(reservation_memo_history)로 배선.
    //   기존 hover는 reservations.booking_memo(생성시 초기메모만 담기는 부분 미러)만 읽어, 예약상세 팝업
    //   타임라인으로 추가/수정한 메모가 미표시되던 버그. list 전체 reservation_id 단일 배치 조회(.in) →
    //   reservation_id별 대표 1줄(고정 우선 pinned_at DESC, 없으면 최신 created_at DESC; ReservationMemoTimeline
    //   sortMemoItems와 동일 순서) 맵 구성. read-only, 스키마 무변경(N+1 없음 — 단일 쿼리).
    {
      const resvIds = list.map((r) => r.id);
      const memoM = new Map<string, string>();
      if (resvIds.length > 0) {
        const { data: memoRows } = await supabase
          .from('reservation_memo_history')
          .select('reservation_id, content, is_pinned, pinned_at, created_at')
          .in('reservation_id', resvIds);
        // reservation_id별 후보 누적 후 대표 1건 선택(고정 우선, 그다음 최신).
        const byResv = new Map<string, { content: string; is_pinned: boolean; pinned_at: string | null; created_at: string }[]>();
        for (const m of (memoRows ?? []) as {
          reservation_id: string | null;
          content: string | null;
          is_pinned: boolean | null;
          pinned_at: string | null;
          created_at: string;
        }[]) {
          const rid = m.reservation_id;
          const text = (m.content ?? '').trim();
          if (!rid || !text) continue;
          const arr = byResv.get(rid) ?? [];
          arr.push({ content: text, is_pinned: !!m.is_pinned, pinned_at: m.pinned_at, created_at: m.created_at });
          byResv.set(rid, arr);
        }
        for (const [rid, arr] of byResv) {
          const top = arr.sort((a, b) => {
            // 고정 우선(pinned_at DESC), 비고정은 created_at DESC — sortMemoItems와 동일 우선순위.
            if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
            if (a.is_pinned && b.is_pinned) return (b.pinned_at ?? '').localeCompare(a.pinned_at ?? '');
            return b.created_at.localeCompare(a.created_at);
          })[0];
          if (top) memoM.set(rid, top.content);
        }
      }
      setResvMemoMap(memoM);
    }

    // 노쇼 이력 집계
    const customerIds = Array.from(
      new Set(list.map((r) => r.customer_id).filter((x): x is string => !!x)),
    );
    if (customerIds.length > 0) {
      const { data: nsData } = await supabase
        .from('reservations')
        .select('customer_id')
        .in('customer_id', customerIds)
        .eq('status', 'no_show');
      const counts: Record<string, number> = {};
      for (const row of nsData ?? []) {
        const id = (row as { customer_id: string | null }).customer_id;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
      setNoshowByCustomer(counts);

      // T-20260514-foot-CHART-NO-VISIBLE: AC-2 차트번호 컬럼용 사전 로드
      // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI: 예약관리 담당자 표시가 차트 담당자(assigned_staff_id)에서
      //   '예약 잡은 계정'(booker)으로 교체됨(위 setResvBookerMap) → 여기선 chart_number만 로드(assigned_staff_id 미사용).
      //   ★SCOPE: customers.assigned_staff_id 자체는 미변경 — 2번차트/고객 목록·상세의 담당자 의미 불변(회귀0).
      const { data: chartData } = await supabase
        .from('customers')
        .select('id, chart_number')
        .in('id', customerIds);
      const chartM = new Map<string, string>();
      for (const c of (chartData ?? []) as { id: string; chart_number: string | null }[]) {
        if (c.chart_number) chartM.set(c.id, c.chart_number);
      }
      setResvChartMap(chartM);

      // T-20260527-foot-TREATMENT-CYCLE-ALERT AC-1/AC-4:
      // 고객별 완료 치료 회차 수를 단일 RPC로 배치 집계 (N+1 방지)
      const { data: cycleData } = await supabase.rpc('get_treatment_cycle_counts', {
        p_clinic_id:    clinic.id,
        p_customer_ids: customerIds,
      });
      const cycleM = new Map<string, number>();
      for (const row of (cycleData ?? []) as { customer_id: string; completed_count: number }[]) {
        cycleM.set(row.customer_id, row.completed_count);
      }
      setTreatmentCycleMap(cycleM);

      // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item2): 재진 카드 "패키지 N/N" — 고객별 활성 패키지 진행률 배치 집계.
      //   1) 활성 패키지(고객당 최신 1건) total_sessions, 2) 그 패키지의 used 회차 count → customer_id 맵.
      //   read-only(스키마 무변경). 다중 활성 패키지 시 최신(created_at desc) 1건만 카드에 표기(혼동 방지).
      const pkgM = new Map<string, { used: number; total: number }>();
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id, customer_id, total_sessions, created_at')
        .in('customer_id', customerIds)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      const activePkgByCustomer = new Map<string, { id: string; total: number }>();
      for (const p of (pkgData ?? []) as { id: string; customer_id: string; total_sessions: number | null }[]) {
        // order desc → 고객별 첫 등장(=최신)만 채택
        if (!activePkgByCustomer.has(p.customer_id)) {
          activePkgByCustomer.set(p.customer_id, { id: p.id, total: p.total_sessions ?? 0 });
        }
      }
      const activePkgIds = Array.from(activePkgByCustomer.values()).map((v) => v.id);
      const usedByPkg = new Map<string, number>();
      if (activePkgIds.length > 0) {
        const { data: usedData } = await supabase
          .from('package_sessions')
          .select('package_id')
          .in('package_id', activePkgIds)
          .eq('status', 'used');
        for (const s of (usedData ?? []) as { package_id: string }[]) {
          usedByPkg.set(s.package_id, (usedByPkg.get(s.package_id) ?? 0) + 1);
        }
      }
      for (const [custId, { id, total }] of activePkgByCustomer) {
        pkgM.set(custId, { used: usedByPkg.get(id) ?? 0, total });
      }
      setPkgProgressMap(pkgM);

      // T-20260611-foot-HEALER-DEDUCT-LINK: 고객별 '다음 예약이 힐러' read-only 집계.
      //   미래(>= today) 힐러(healer_flag) 예약 중 가장 이른 1건 datetime을 보관 → 카드에서
      //   현재 슬롯보다 미래일 때만 '다음 힐러' indicator 노출. DB read-only, 차감 무접촉.
      const { data: hlData } = await supabase
        .from('reservations')
        .select('customer_id, reservation_date, reservation_time')
        .in('customer_id', customerIds)
        .eq('healer_flag', true)
        .neq('status', 'cancelled')
        .gte('reservation_date', today)
        .order('reservation_date', { ascending: true })
        .order('reservation_time', { ascending: true });
      const hlM: Record<string, string> = {};
      for (const row of (hlData ?? []) as {
        customer_id: string | null;
        reservation_date: string;
        reservation_time: string;
      }[]) {
        if (row.customer_id && !hlM[row.customer_id]) {
          hlM[row.customer_id] = `${row.reservation_date} ${row.reservation_time.slice(0, 5)}`;
        }
      }
      setNextHealerByCustomer(hlM);
    } else {
      setNoshowByCustomer({});
      setResvChartMap(new Map());
      // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI: resvBookerMap 은 customerIds 블록 밖(list 전체)에서 항상 설정 → 여기서 리셋 불요.
      setTreatmentCycleMap(new Map());
      setPkgProgressMap(new Map());
      setNextHealerByCustomer({});
    }
    } catch (e) {
      // T-20260615-foot-RESV-DWELL-LOADING-STUCK: 예외로 인한 무한 로딩 고착 방지.
      //   실패를 사용자에게 알려 명시적 재시도를 유도(무성 고착 금지). 로딩 해제는 아래 안전 블록이 보장.
      console.error('[fetchWeek] 예약 로딩 예외', e);
      toast.error('예약 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      // 어떤 경로(정상 완료·error 반환·throw)에서도 로딩 스피너가 반드시 해제되도록 보장.
      setLoading(false);
    }
  }, [clinic, weekDays, viewMode, selectedDay]);

  // T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT: '전체예약' 옆 내려받기 — 당일(KST) 예약 현황 요약.
  //   집계 산식 = @/lib/resvSlotAgg.summarizeKinds 단일 소스 재사용(resvKind). TIMETABLE-VISITCOUNT 와 동일 SSOT(이중 산식 금지).
  //   표기: 초진 = n · 재진 = r+h(HL=힐러 h · PD=비힐러 재진 r). 전체 기준(담당자/필터 무관, '전체예약' 의미).
  //   당일 = 실제 오늘(KST). 현재 뷰(주간/일간/선택일)와 무관하게 오늘자만 별도 조회 → 뷰 상태 의존성 제거.
  const handleDownloadDaySummary = useCallback(async () => {
    if (!clinic) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('reservation_date', today);
    if (error) {
      toast.error('당일 예약 현황을 불러오지 못했습니다.');
      return;
    }
    const list = await stripSimulationRows((data ?? []) as Reservation[]);
    const s = summarizeKinds(list as unknown as Array<{ visit_type: string; is_healer_intent?: boolean | null; healer_flag?: boolean | null; status?: string | null }>);
    const cho = s.n;            // 초진
    const hl = s.h;             // 재진 세부 — HL(힐러)
    const pd = s.r;             // 재진 세부 — PD(비힐러 재진)
    const jae = hl + pd;        // 재진 = HL + PD
    const etc = s.o;            // 기타(예약없이 방문/체험 등)
    // T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW: 김주연 총괄 (A)안 확정 — '제외'는 풋센터 예약 시스템에 없는 분류 → 완전 제거.
    //   상태 별도 버킷: 취소=cancelled(합계 제외) · 노쇼=noshow(합계 *포함*, 별도 카운트만). 분모 불변.
    const cancelled = s.cancelled;
    const noshow = s.noshow;

    // CSV (UTF-8 BOM — 한글 Excel 인코딩 보존, opinionPhraseCsv 패턴 재사용).
    const lines: string[] = [
      `당일 예약 현황,${today}`,
      '구분,건수',
      `초진,${cho}`,
      `재진,${jae}`,
      `  HL(힐러),${hl}`,
      `  PD(재진),${pd}`,
    ];
    if (etc > 0) lines.push(`기타(체험 등),${etc}`);
    lines.push(`합계(초진+재진),${cho + jae}`);
    // 상태 별도 집계 블록(하단) — 유효합계와 분리. 취소는 합계 밖, 노쇼는 합계 포함분의 부가 카운트.
    lines.push('');
    lines.push('상태별 집계,건수');
    lines.push(`취소,${cancelled}`);
    lines.push(`노쇼,${noshow}`);
    const csv = lines.join('\r\n');
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `예약현황_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`당일 예약: 초진 ${cho} · 재진 ${jae}(HL ${hl}, PD ${pd}) / 취소 ${cancelled} · 노쇼 ${noshow} 내려받기 완료`);
  }, [clinic]);

  // 마운트/주간전환 자동로드. StrictMode 이중 마운트 + 동일 파라미터 재렌더 시
  // fetchWeek 중복 실행을 key 기준으로 차단 (AC-4: get_treatment_cycle_counts 단일 호출).
  // 명시적 fetchWeek() 호출(저장/드래그/realtime 후)은 이 dedup 영향을 받지 않는다.
  useEffect(() => {
    if (!clinic) return;
    const startStr = viewMode === 'week'
      ? format(weekDays[0], 'yyyy-MM-dd')
      : format(selectedDay, 'yyyy-MM-dd');
    const endStr = viewMode === 'week'
      ? format(weekDays[weekDays.length - 1], 'yyyy-MM-dd')
      : startStr;
    const key = `${clinic.id}|${viewMode}|${startStr}|${endStr}`;
    if (lastAutoFetchKeyRef.current === key) return;
    lastAutoFetchKeyRef.current = key;
    fetchWeek();
  }, [clinic, viewMode, weekDays, selectedDay, fetchWeek]);

  // Realtime
  useEffect(() => {
    if (!clinic) return;
    const ch = supabase
      .channel(`reservations_${clinic.id}_${format(weekStart, 'yyyyMMdd')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `clinic_id=eq.${clinic.id}` },
        () => {
          // 자기 noshow 자동 UPDATE로 인한 자기-트리거 refetch 억제 (AC-4)
          if (Date.now() < selfWriteUntilRef.current) return;
          fetchWeek();
        },
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
        // T-20260529-foot-RESV-TIME-EDIT-NOSYNC: slotMaxFor() 적용 (16:00+ 10건 상한)
        const activeInSlot = rows.filter(
          (x) =>
            x.reservation_date === target.date &&
            x.reservation_time.slice(0, 5) === target.time &&
            x.status !== 'cancelled',
        ).length;
        const maxForTarget = slotMaxFor(target.time);
        if (activeInSlot >= maxForTarget) {
          toast.error(`해당 시간에 이미 예약이 있습니다 (${activeInSlot}/${maxForTarget})`);
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
              // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC1): 복사 생성도 담당자=생성 계정.
              created_by: changedBy,
              // T-20260628-crm-RESV-CREATED-VIA-FILL §2: 어드민 복사 생성 = 수기 → manual.
              created_via: RESERVATION_CREATED_VIA.MANUAL,
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
            // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC2): 일자/시간 변경 → 담당자=마지막 수정 계정 overwrite.
            .update({ reservation_date: target.date, reservation_time: target.time, updated_by: changedBy })
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

  // T-20260611-foot-RESVCAL-DISPLAY-REWORK item1: 날짜별 유형 카운트 (취소 제외).
  //   총건수 = 초진(new) + 재진(returning)만. 힐러(HL)는 별도 표기, 총합 제외.
  const dayKindCounts = useMemo(() => {
    const m = new Map<string, { n: number; r: number; h: number }>();
    for (const row of rows) {
      if (row.status === 'cancelled') continue;
      const kind = resvKind(row);
      const cur = m.get(row.reservation_date) ?? { n: 0, r: 0, h: 0 };
      if (kind === 'new') cur.n += 1;
      else if (kind === 'returning') cur.r += 1;
      else if (kind === 'healer') cur.h += 1;
      m.set(row.reservation_date, cur);
    }
    return m;
  }, [rows]);

  const slotActiveCount = useCallback(
    (dateStr: string, time: string) => {
      const list = resvByKey[`${dateStr}_${time}`] ?? [];
      return list.filter((r) => r.status !== 'cancelled').length;
    },
    [resvByKey],
  );

  // T-20260525-foot-TIMETABLE-POST16-SLOT: slotMaxFor(time) 적용 — 16:00 이후 10건 상한
  const isSlotFull = useCallback(
    (dateStr: string, time: string) => {
      return slotActiveCount(dateStr, time) >= slotMaxFor(time);
    },
    [slotActiveCount],
  );

  const openNewSlot = (d: Date, time: string) => {
    // T-20260516-foot-RESV-PLUS-CANVAS AC-1 🔒L-004: 항상 예약 생성 폼 (캔버스/Phase0Shell 연결 금지)
    // T-20260615-foot-RESVMGMT-REFIX-8 AC3 (planner GO · 🔒L-002·L-004 준수): 빈슬롯 (+) →
    //   구 ReservationEditor 모달 스폰 폐기, 예약상세 팝업 new-mode 로 통일. 클릭 슬롯 날짜/시간 prefill.
    //   🔒 L-004 유지: new-mode 팝업이 곧 '예약 생성 폼' affordance(캔버스 연결 아님). 생성 capability 보존.
    //   🔒 L-002 유지: 생성 로직은 단일소스 createReservationCanonical(팝업은 콜백 위임, insert 0) — 진입 '배선'만 통일.
    setNewReservationInitial({ date: format(d, 'yyyy-MM-dd'), time });
    setNewReservationMode(true);
  };

  const openEdit = (r: Reservation) => {
    setEditor({
      existingId: r.id,
      // T-20260610-foot-RESV-OVERHAUL-7 AC-6/AC-7: 푸터 버튼 분기용 상태 전달
      status: r.status,
      date: r.reservation_date,
      time: r.reservation_time.slice(0, 5),
      name: r.customer_name ?? '',
      phone: r.customer_phone ?? '',
      visit_type: r.visit_type,
      memo: r.memo ?? '',
      booking_memo: '',  // 편집 시 항상 빈 값 (ReservationMemoTimeline이 직접 처리)
      // AC-3 FIX: referral_source(예약 컬럼)에서 즉시 프리로드 — 비동기 fetch 불필요
      // useEffect fallback은 referral_source가 null인 구형 예약 대응용으로 유지
      visit_route: r.referral_source ?? '',
      customer_id: r.customer_id ?? null,  // AC-3 fallback: customer.visit_route/lead_source 조회용
      // T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 영속 is_healer_intent 프리로드. 레거시 healer_flag(소모형)도 ON 으로 수용.
      is_healer_intent: !!(r.is_healer_intent ?? r.healer_flag),
    });
    setDetail(null);
  };

  // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (옵션A · L-002 개정):
  //   현장 확정 동선(A 등록 → B 검색 → 신규예약)을 '예약상세 팝업 안에서' 완결(모달 스폰 폐기).
  //   팝업 new-mode 가 수집한 날짜/시간/초·재/고객을 이 콜백으로 위임 → 단일소스 createReservationCanonical 호출.
  //   🔒 L-002(개정): 생성경로는 함수 1곳뿐. 팝업은 콜백만 호출(팝업 내 reservations.insert 0). 5요소는 함수 내부 보존.
  const handleCreateReservationFromPopup = useCallback(
    async (params: {
      customerId: string | null;
      name: string;
      phone: string | null;
      date: string;
      time: string;
      visit_type: VisitType;
      // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: 신규 예약 생성 시 예약경로/예약등록자 영속(컬럼·마스터 기존, 신규 스키마 0).
      visit_route?: string | null;
      registrar_id?: string | null;
      // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE: 예약등록자 이름 스냅샷(default/수기선택 반영).
      registrar_name?: string | null;
      // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모(brief_note) + 예약메모(booking_memo).
      brief_note?: string | null;
      booking_memo?: string | null;
      // T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX: 힐러 칩(is_healer_intent 영속) — 기존 write-path 위임. 신규 스키마 0.
      is_healer_intent?: boolean | null;
    }): Promise<{ ok: boolean; reason?: string; message?: string }> => {
      if (!clinic) return { ok: false, reason: 'error', message: '클리닉 정보를 불러오지 못했습니다.' };
      // T-20260615-foot-RESVMGMT-REFIX-8 AC3-b: 팝업이 customerId=null(시스템에 없는 신규 고객)을 넘기면
      //   여기서 고객 resolve(phone E.164) → 없으면 customers INSERT. 고객 INSERT 책임은 호출측(이 콜백) —
      //   기존 신규(CREATE) 경로(§2554~)와 동일 패턴 재사용. 생성 무결성 5요소는 단일소스 함수 내부 보존(🔒 L-002).
      let resolvedCustomerId = params.customerId;
      if (!resolvedCustomerId && params.phone && params.phone.trim()) {
        const normalized = normalizeToE164(params.phone) ?? params.phone.trim();
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('clinic_id', clinic.id)
          .eq('phone', normalized)
          .maybeSingle();
        if (existing) {
          resolvedCustomerId = existing.id as string;
        } else {
          const { data: created, error } = await supabase
            .from('customers')
            .insert({
              clinic_id: clinic.id,
              name: params.name.trim(),
              phone: normalized,
              visit_type: params.visit_type === 'new' ? 'new' : 'returning',
            })
            .select('id')
            .single();
          if (error) {
            // T-20260615-foot-RESVMGMT-REFIX-8 AC3-b GUARD (MSG-20260615-155718, zkp7 value-add):
            //   foot customers (clinic_id, phone) = FULL UNIQUE (cross_crm_data_contract §1-3-1).
            //   현장이 검색에서 못 찾았을 뿐 실제 존재(번호 표기·정규화 차이) → 23505 unique_violation.
            //   find-or-create 표준 = 충돌 시 에러로 막지 말고 기존 고객을 재-resolve 해 재사용.
            if (error.code === '23505') {
              const { data: conflictHit } = await supabase
                .from('customers')
                .select('id')
                .eq('clinic_id', clinic.id)
                .eq('phone', normalized)
                .maybeSingle();
              if (conflictHit) {
                resolvedCustomerId = conflictHit.id as string;
              } else {
                return { ok: false, reason: 'error', message: '이미 등록된 전화번호입니다' };
              }
            } else {
              return { ok: false, reason: 'error', message: `고객 생성 실패: ${error.message}` };
            }
          } else {
            resolvedCustomerId = (created as { id: string }).id;
          }
        }
      }
      if (!resolvedCustomerId) {
        return { ok: false, reason: 'error', message: '고객 정보(성함·연락처)가 필요합니다.' };
      }
      const res = await createReservationCanonical({
        clinicId: clinic.id,
        customerId: resolvedCustomerId,
        name: params.name,
        phone: params.phone,
        date: params.date,
        time: params.time,
        visit_type: params.visit_type,
        // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: 예약경로/예약등록자 → 예약행 영속(컬럼 기존, 신규 스키마 0).
        visit_route: params.visit_route ?? null,
        registrar_id: params.registrar_id ?? null,
        // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE: 예약등록자 이름 스냅샷 위임.
        registrar_name: params.registrar_name ?? null,
        // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모 + 예약메모 영속.
        brief_note: params.brief_note ?? null,
        booking_memo: params.booking_memo ?? null,
        // T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX: 힐러 칩(is_healer_intent) → 기존 write-path(payload L257) 위임.
        //   미선택 시 false(=기존 동작 불변). 컬럼 미반영 DB 는 createReservationCanonical 의 PGRST204 내성화로 graceful.
        is_healer_intent: params.is_healer_intent ?? false,
        maxPerSlot: slotMaxFor(params.time),
        changedBy,
        authorName: profile?.name ?? '',
        onDuplicateConfirm: (msg) => window.confirm(msg),
      });
      if (res.ok) {
        fetchWeek();
        return { ok: true };
      }
      return { ok: false, reason: res.reason, message: res.message };
    },
    // fetchWeek 는 useCallback 안정 참조. clinic/changedBy/profile 변경 시 재생성.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clinic, changedBy, profile?.name],
  );

  // T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD: 담당자 선택 드롭 옵션 로드(예약등록자 마스터).
  //   ReservationDetailPopup 의 registrars 로더와 동일 소스(reservation_registrars, active) — 신규 스키마/테이블 0.
  //   이름(string)만 추출·중복 제거·정렬. registrar_name(스냅샷)과 동일 master라 NAME-MATCH 필터 정합.
  useEffect(() => {
    if (!clinic) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('reservation_registrars')
        .select('name')
        .eq('clinic_id', clinic.id)
        .eq('active', true)
        .order('group_name', { ascending: true })
        .order('sort_order', { ascending: true });
      if (cancelled || error || !data) return;
      const names = Array.from(
        new Set((data as { name: string }[]).map((r) => (r.name ?? '').trim()).filter(Boolean)),
      );
      setAssigneeOptions(names);
    })();
    return () => { cancelled = true; };
  }, [clinic]);

  // T-20260615-foot-RESVMGMT-REFIX-8 AC5: '일괄 배치(일괄 체크인)' 기능 제거 — 현장 불필요 판정(김주연 총괄).
  //   batchCheckIn 핸들러 + 슬롯 하단 '일괄 배치' 버튼 동반 제거. batch_checkin RPC는 DB에 잔존(타 호출 없음, 무해).

  const reschedule = async (reservationId: string, newDate: string, newTime: string) => {
    if (!clinic) return;
    const r = rows.find((x) => x.id === reservationId);
    if (!r || r.status !== 'confirmed') return;
    if (r.reservation_date === newDate && r.reservation_time.slice(0, 5) === newTime) return;

    const activeCount = slotActiveCount(newDate, newTime);
    // T-20260529-foot-RESV-TIME-EDIT-NOSYNC: slotMaxFor() 적용 (16:00+ 슬롯 10건 상한 반영)
    const maxForSlot = slotMaxFor(newTime);
    if (activeCount >= maxForSlot) {
      toast.error(`해당 시간에 이미 예약이 있습니다 (${activeCount}/${maxForSlot})`);
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
      // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC2): 일자/시간 변경(드래그) → 담당자=마지막 수정 계정 overwrite.
      .update({ reservation_date: newDate, reservation_time: newTime, updated_by: changedBy })
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
    doctor_call_memo: null,
    doctor_ack_at: null,
    doctor_status: null,
    doctor_started_at: null,
    doctor_ended_at: null,
    call_list_manual_order: null,
    // T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER §D(AC-5): CustomerHoverCard 트리거 인라인
    //   차트번호 배지를 hover 전부터 SSOT(resvChartMap=customers.chart_number)로 채워 안정화.
    //   → hover 시 fetch로 '#미발번' → 차트번호 덮어쓰는 깜빡임 제거(미발번이면 null 유지 → '#미발번' 그대로).
    customers: r.customer_id
      ? { name: r.customer_name ?? null, chart_number: resvChartMap.get(r.customer_id) ?? null }
      : null,
  }), [clinic?.id, resvChartMap]);

  // T-20260515-foot-RESV-CTX-HOVER: 핸들러
  // T-20260516-foot-CHART-OPEN-UNIFY AC-1: setResvChartSheetId → openChart (ChartContext 단일 소스)
  const handleResvOpenChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    openChart(ci.customer_id);
  }, [openChart]);

  const handleResvOpenMedicalChart = useCallback((ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    setResvMedicalChartCustomerId(ci.customer_id);
    setResvMedicalChartOpen(true);
  }, []);

  // T-20260610-foot-RESV-MGMT-CTXMENU-DETAIL-5FIX item3 (Q2 김주연 총괄 확정 MSG-181801-wotc):
  // 예약관리 우클릭 [예약상세] → 신규예약 editor 가 아니라 4분할 예약상세 팝업(ReservationDetailPopup) 오픈.
  // 라벨만 X — 클릭 동작까지 변경. 기존 [예약하기](신규예약 생성) 동선은 대시보드 고객카드 경로
  // (handleNewReservation, Dashboard.tsx)에 그대로 유지 — 이 메뉴는 '기존 예약' 대상이므로 상세 진입이 맞음.
  const handleResvOpenDetailFromMenu = useCallback((ci: CheckIn) => {
    const resvId = ci.reservation_id;
    if (!resvId) { toast.error('예약 정보를 찾을 수 없습니다'); return; }
    const resv = rows.find((r) => r.id === resvId);
    if (!resv) { toast.error('예약 정보를 찾을 수 없습니다'); return; }
    setDetail(resv);
  }, [rows]);

  const handleResvOpenPayment = useCallback(async (ci: CheckIn) => {
    if (!ci.customer_id) { toast.info('고객 정보가 연결되어 있지 않습니다'); return; }
    // 체크인 기록 조회 (reservation_id 기준)
    if (ci.reservation_id) {
      const { data } = await supabase
        .from('check_ins')
        .select('*, customers(name, chart_number)')
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

  // T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC3/AC4: 우클릭 [완전 삭제]·[예약 취소] 메뉴 항목 제거에 따라
  //   기존 컨텍스트메뉴 전용 핸들러(handleResvHardDelete / handleResvCancelRequest) orphan 정리.
  //   취소/완전삭제 경로는 ReservationDetailPopup 내부 버튼([예약취소] cancelWithReason / [예약삭제] deleteReservation)
  //   + 편집 모달 경로(handleEditorCancel → setCancelTarget / handleEditorDelete)로 보존됨.

  // T-20260525-foot-RESV-CANCEL-CTX: DB 취소 실행
  const handleResvCancelConfirm = useCallback(async (reason: string) => {
    if (!cancelTarget || !clinic) return;
    setCancelBusy(true);
    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
        cancelled_by: changedBy,
      })
      .eq('id', cancelTarget.id);
    if (error) {
      toast.error(`취소 실패: ${error.message}`);
      setCancelBusy(false);
      return;
    }
    // 감사 로그
    await supabase.from('reservation_logs').insert({
      reservation_id: cancelTarget.id,
      clinic_id: cancelTarget.clinic_id,
      action: 'cancel',
      old_data: { status: cancelTarget.status },
      new_data: { status: 'cancelled', cancel_reason: reason },
      changed_by: changedBy,
    });
    // 낙관적 업데이트 — rows 즉시 반영
    const cancelledAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) =>
        r.id === cancelTarget.id
          ? { ...r, status: 'cancelled' as const, cancelled_at: cancelledAt, cancel_reason: reason, cancelled_by: changedBy }
          : r,
      ),
    );
    setCancelBusy(false);
    setCancelTarget(null);
    toast.success(`${cancelTarget.customer_name} 예약 취소됨`);

    // ── T-20260527-dopamine-RESV-CANCEL-SYNC: 도파민 취소 콜백 (fire-and-forget) ──
    // external_id 있는 예약(도파민 cue_card_id)만 전송. 콜백 실패는 non-fatal.
    if (cancelTarget.external_id) {
      (async () => {
        try {
          await supabase.functions.invoke('dopamine-callback', {
            body: {
              type: 'cancelled',
              reservation_id: cancelTarget.id,
            },
          });
        } catch (cbErr) {
          // non-fatal — dopamine_outbound_log에 failed 기록이 남아 추후 재처리 가능
          console.warn('[cancel-callback] 도파민 취소 콜백 발사 오류 (non-fatal):', cbErr);
        }
      })();
    }
  }, [cancelTarget, clinic, changedBy]);

  // ── T-20260610-foot-RESV-OVERHAUL-7 AC-6/AC-7: 예약상세(수정) 모달 푸터 액션 ──
  // 기존 취소(ReservationCancelModal)·hard delete·복원 경로 재사용. 신규 경로 신설 금지.

  // AC-6: 예약취소 — 편집 모달 닫고 기존 취소 사유 모달(ReservationCancelModal) 오픈
  const handleEditorCancel = useCallback((resvId: string) => {
    const resv = rows.find((r) => r.id === resvId);
    if (!resv) { toast.error('예약 정보를 찾을 수 없습니다'); return; }
    if (resv.status === 'cancelled') { toast.info('이미 취소된 예약입니다'); return; }
    setEditor(null);
    setCancelTarget(resv);
  }, [rows]);

  // AC-6: 예약삭제 — hard delete (handleResvHardDelete 패턴 재사용, 체크인 연결 차단)
  const handleEditorDelete = useCallback(async (resvId: string) => {
    const resv = rows.find((r) => r.id === resvId);
    const name = resv?.customer_name ?? '';
    if (!window.confirm(`${name}님 예약을 완전 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    const { count } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_id', resvId);
    if ((count ?? 0) > 0) {
      toast.error('체크인이 연결된 예약은 삭제할 수 없습니다');
      return;
    }
    const { error } = await supabase.from('reservations').delete().eq('id', resvId);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    setRows((prev) => prev.filter((r) => r.id !== resvId));
    setEditor(null);
    toast.success(`${name} 예약 완전 삭제됨`);
  }, [rows]);

  // AC-7: 예약복원 — cancelled_at/cancel_reason/cancelled_by 초기화 → confirmed 상태 복귀 (상태전이, 비파괴)
  const handleEditorRestore = useCallback(async (resvId: string) => {
    const resv = rows.find((r) => r.id === resvId);
    if (!resv) { toast.error('예약 정보를 찾을 수 없습니다'); return; }
    // 슬롯 마감 검사 — 같은 시간대 활성 예약이 상한 도달 시 복원 차단 (save/setStatus 패턴 재사용)
    const maxForSlot = slotMaxFor(resv.reservation_time.slice(0, 5));
    const { count } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', resv.clinic_id)
      .eq('reservation_date', resv.reservation_date)
      .eq('reservation_time', resv.reservation_time)
      .neq('status', 'cancelled');
    if ((count ?? 0) >= maxForSlot) {
      toast.error(`이 시간대는 마감입니다 (${count}/${maxForSlot}). 다른 시간으로 옮긴 뒤 복원하세요.`);
      return;
    }
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'confirmed', cancelled_at: null, cancel_reason: null, cancelled_by: null })
      .eq('id', resvId);
    if (error) { toast.error(`복원 실패: ${error.message}`); return; }
    await supabase.from('reservation_logs').insert({
      reservation_id: resvId,
      clinic_id: resv.clinic_id,
      action: 'restore',
      old_data: { status: resv.status },
      new_data: { status: 'confirmed' },
      changed_by: changedBy,
    });
    setRows((prev) =>
      prev.map((r) =>
        r.id === resvId
          ? { ...r, status: 'confirmed' as const, cancelled_at: null, cancel_reason: null, cancelled_by: null }
          : r,
      ),
    );
    // AC-7: 편집 모달의 status도 즉시 confirmed로 전환 → 푸터 버튼 자동 전환
    setEditor((e) => (e && e.existingId === resvId ? { ...e, status: 'confirmed' } : e));
    toast.success('예약 복원됨');
  }, [rows, changedBy]);

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
          {/* T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE [변경1]: 자동배정 알림을 날짜선택(좌측 < 날짜 > 오늘) 바로 오른쪽 옆에 배치.
              헤더(AdminLayout)에서 이전 — 중복 노출 없음. 미읽음 0건이면 컴포넌트 내부에서 마키 스트립 미노출(상시 X).
              애니메이션(마키 흐름 + amber 글로우/펄스, 1.5~1.6s 완만)은 컴포넌트 기존 정의 그대로 사용. */}
          <AssignmentNotifyBell clinicId={clinic?.id ?? null} />
          {/* T-20260615-foot-RESVMGMT-REFIX-8 AC1: '전체예약/내 예약' 토글을 '이번 주' 옆(기간 토글 영역)으로 이동.
              T-20260613-foot-RESVCAL-MYRESV-DEF (기능2): '내 예약' = registrar_name(담당 이름) === 로그인 표시명(NAME-MATCH). 동작 불변. */}
          <select
            data-testid="myresv-filter"
            aria-label="내 예약 필터"
            value={filterMine ? 'mine' : 'all'}
            onChange={(e) => {
              const mine = e.target.value === 'mine';
              setFilterMine(mine);
              // T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD: 전체예약 복귀 시 담당자 선택 초기화(본인).
              if (!mine) setFilterAssignee('');
            }}
            className="h-9 rounded-md border border-teal-200 bg-teal-50 px-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 focus:outline-none focus:border-teal-500 cursor-pointer"
          >
            <option value="all">전체 예약</option>
            <option value="mine">내 예약</option>
          </select>
          {/* T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD: '내 예약' 선택 시에만 담당자 선택 드롭 노출.
              기본값('')=로그인 본인(현행 NAME-MATCH 유지) + 다른 담당자 선택 시 그 담당자 기준 조회. */}
          {filterMine && (
            <select
              data-testid="myresv-assignee-filter"
              aria-label="담당자 선택"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="h-9 rounded-md border border-teal-200 bg-teal-50 px-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              <option value="">{myDisplayName ? `본인 (${myDisplayName})` : '본인'}</option>
              {assigneeOptions
                .filter((n) => n !== myDisplayName)
                .map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
            </select>
          )}
          {/* T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT: '전체예약' 옆 내려받기 — 당일(KST) 예약 현황 요약(초진 N / 재진 N(HL N, PD N)).
              산식 = summarizeKinds 단일 소스(TIMETABLE-VISITCOUNT 와 동일 SSOT). 전체 기준(필터 무관). */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="day-summary-download"
            onClick={handleDownloadDaySummary}
            title="당일 예약 현황 내려받기 (초진/재진·HL/PD)"
            className="h-9 gap-1.5 border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
          >
            <Download className="h-3.5 w-3.5" />
            내려받기
          </Button>
        </div>
        {/* T-20260615-foot-RESVMGMT-REFIX-8 AC1: 우측 컨트롤 순서를 '새 예약 → 일간/주간'으로 재배치.
            T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 경과분석 토글 제거 → 컨트롤은 '새 예약 → 일간/주간'. */}
        <div className="flex items-center gap-2">
          {/* T-20260513-foot-RESV-PLUS-PHONE-SEARCH: 페이지 상단 새 예약 버튼 — InlinePatientSearch(phone) 연결.
              T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 경과분석 뷰 제거 → '새 예약'은 항상 노출. */}
          <Button
            size="sm"
            /* T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (AC2): (+) → 예약상세 팝업 new-mode 오픈.
               별도 폼/ReservationEditor 모달 스폰 폐기. 생성은 팝업 → handleCreateReservationFromPopup
               → 단일소스 createReservationCanonical 위임(L-002 개정). */
            /* T-20260629-foot-NEWRESV-UNIFIED-MODAL AC9: 목록 [새 예약]도 캘린더 (+)와 동일 통합 모달.
               모달 내 날짜picker 제거(AC2) → 클릭 셀이 없는 목록 진입은 현재 보는 날짜(selectedDay) + 기본시간(10:00) 주입. */
            onClick={() => { setNewReservationInitial({ date: format(selectedDay, 'yyyy-MM-dd'), time: '10:00' }); setNewReservationMode(true); }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            새 예약
          </Button>
          <div className="flex rounded-md border">
            <button
              onClick={() => setViewMode('day')}
              className={cn('px-3 min-h-[44px] text-xs font-medium transition flex items-center', viewMode === 'day' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted')}
            >
              일간
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={cn('px-3 min-h-[44px] text-xs font-medium transition flex items-center', viewMode === 'week' ? 'bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-muted')}
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
            {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
            {clipboard.resv.customer_id && (
              <span className="ml-1 font-mono text-amber-700">{chartNoBadge(resvChartMap.get(clipboard.resv.customer_id))}</span>
            )}
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

      {/* T-20260609-foot-RESV-LIVE-AUTOSCROLL: 세로 스크롤 컨테이너 ref (현재시각 자동 스크롤 대상) */}
      <div ref={scrollContainerRef} data-testid="resv-timetable-scroll" className="flex-1 overflow-auto rounded-lg border bg-background">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : viewMode === 'day' ? (
          /* T-20260623-foot-RESVMGMT-OVERHAUL2-W3-HORIZONTAL [1-b]: 일간 보기 — 시간 가로(x축) 배열 전면 재설계.
             부모 OVERHAUL-2-PLAN C4/C5/Q1 확정 spec:
               · 가로축 = 시간(10:00 / 10:30 …). 특정 시간 셀 클릭 → 해당 시간 예약을 한 줄로 나열(C4).
               · 세로축 = 비워둠. 치료사/공간 그루핑 코드 작성 금지(C5).
               · 색상 유지(초진=그린 / 재진=하늘 / 힐러=노랑) — KIND_CARD_STYLE/KIND_DOT 재사용.
             reconcile(착수): 6/22 좌우2열 그리드(d14cf555)·30분 슬롯 행은 아래 '주간 보기 <table>' 한정으로 격리.
               일간은 시간축 가로 펼침(reporter 1급)을 1급으로 채택 — 자족 레이아웃. 주간 <table> 경로는 불변(회귀가드). */
          (() => {
            const dateStr = format(selectedDay, 'yyyy-MM-dd');
            const daySlots = slotsFor(selectedDay);
            const mineTarget = filterAssignee !== '' ? filterAssignee : myDisplayName;
            const slotList = (time: string) => {
              const key = `${dateStr}_${time}`;
              return [...(resvByKey[key] ?? [])]
                .filter((r) => !filterMine || (mineTarget !== '' && (r.registrar_name ?? '').trim() === mineTarget))
                .sort((a, b) => {
                  const ko = KIND_ORDER[resvKind(a)] - KIND_ORDER[resvKind(b)];
                  if (ko !== 0) return ko;
                  return a.reservation_time < b.reservation_time ? -1 : a.reservation_time > b.reservation_time ? 1 : 0;
                });
            };
            const kindCounts = (time: string) => {
              let n = 0, rr = 0, h = 0;
              for (const r of slotList(time)) {
                if (r.status === 'cancelled') continue;
                const k = resvKind(r);
                if (k === 'new') n += 1; else if (k === 'returning') rr += 1; else if (k === 'healer') h += 1;
              }
              return { n, rr, h };
            };
            // T-20260624-foot-RESVMGMT-DAILY-TIMEGRID-VERTICAL: C4(클릭→한 줄 나열) 폐기.
            //   시간은 가로 한 줄(컬럼 헤더)로 유지하되, 각 시간 컬럼 아래로 예약을 클릭 없이 상시 세로 진열.
            //   세로축 그루핑(치료사/공간)은 여전히 없음(C5) — 세로는 단순 "그 시간의 예약 누적".
            const renderDayCard = (r: Reservation) => (
              <div
                key={r.id}
                data-testid={`resv-card-${r.id}`}
                draggable={r.status === 'confirmed'}
                onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, r.id); }}
                onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                onContextMenu={(e) => {
                  if (r.customer_id) { e.preventDefault(); e.stopPropagation(); setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } }); }
                }}
                className={cn(
                  // TIMEGRID-VERTICAL: 컬럼 폭에 맞춘 세로 진열 카드(full-width). 색상은 KIND_CARD_STYLE(초진=그린/재진=하늘/힐러=노랑) 유지.
                  // COMPACT2(2단계, 김주연 총괄 확정 8px): 칸 90px화에 맞춰 카드 패딩·폰트 축소(px-2 py-1→px-1 py-0.5, text-[12px]→text-[8px]). 색상/구조 불변. 8px=가독성 하한 → leading-tight+truncate로 깨짐 방지.
                  'w-full min-w-0 overflow-hidden rounded border px-1 py-0.5 text-[8px] leading-tight shadow-sm transition-opacity',
                  r.status === 'confirmed' && 'cursor-grab active:cursor-grabbing',
                  draggedId === r.id && 'opacity-40',
                  STATUS_STYLE[r.status],
                  KIND_CARD_STYLE[resvKind(r)],
                  r.status === 'checked_in' && draggedId !== r.id && 'opacity-60',
                )}
              >
                <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                  {r.customer_id && r.status !== 'cancelled' ? (
                    <CustomerHoverCard
                      checkIn={resvAsCheckIn(r)}
                      reservationTime={r.reservation_time}
                      reservationInfo={{
                        // T-20260630-foot-RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH: 간략정보(hover) '등록자:' 줄 = 예약등록자(registrar_name 스냅샷) ONLY.
                        //   booker(resvBookerMap=created_by) fallback 제거 — 예약등록자 미지정/타경로 행은 booker(예: 예약 잡은 계정 '김주연')를
                        //   '등록자'로 오표기하던 게 현장 신고 미스매치 RC. 카드 우하단 @예약등록자 태그(L2470, registrar_name only, fallback 없음)와
                        //   동일 소스로 통일 → 선택한 예약등록자만 표기. null이면 CustomerHoverCard가 등록자 라벨 생략(일시만).
                        registrarLabel: r.registrar_name?.trim() || null,
                        reservationDate: r.reservation_date,
                        visitRoute: r.visit_route ?? r.referral_source ?? null,
                        // T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN: 예약메모 SoT(reservation_memo_history) 우선.
                        //   null(구버전 행·이력없음)이면 기존 booking_memo 컬럼 fallback → 회귀 0.
                        bookingMemo: resvMemoMap.get(r.id) ?? r.booking_memo ?? null,
                        briefNote: r.brief_note ?? null,
                      }}
                      compact
                      // T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY: 일간 TIMEGRID 고객박스 성함 폰트 축소 요청.
                      //   기존 compact-only → 성함 text-sm(14px)인데 COMPACT2 카드 본문은 8px → 성함만 과대.
                      //   compactDense 추가 → 성함 text-[11px](ping-pong 바닥 ≥11px 유지) + block/min-w-0 truncate(좁은 90px칸 ellipsis 실동작).
                      compactDense
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } }); }}
                      onClick={() => handleResvOpenChart(resvAsCheckIn(r))}
                    />
                  ) : (
                    <span
                      className={cn(
                        'block min-w-0 max-w-full truncate font-semibold text-gray-900',
                        r.customer_id && 'cursor-pointer hover:underline hover:text-teal-700 transition-colors',
                        // T-20260630-foot-RESVMGMT-CANCELNAME-REGISTRANT-2FIX (1): 취소 행 이름 '축소' 효과 제거.
                        //   취소 성함은 plain span 분기라 카드 본문(text-[8px]) 상속 → 활성 성함(CustomerHoverCard compactDense=text-[11px])보다 작아 보였음.
                        //   취소 성함만 활성과 동일 text-[11px]로 고정(취소선·'취소됨' 배지 등 다른 취소 표기는 유지). 미연결-활성 등 다른 분기 폰트는 불변(AC-4).
                        r.status === 'cancelled' && 'text-[11px] line-through',
                      )}
                      onClick={(e) => { if (!r.customer_id) return; e.stopPropagation(); handleResvOpenChart(resvAsCheckIn(r)); }}
                    >
                      {r.customer_name}
                    </span>
                  )}
                  {r.status === 'cancelled' && (
                    <span className="rounded bg-gray-200 px-0.5 text-[8px] leading-none text-gray-500">취소됨</span>
                  )}
                </div>
                {/* T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY: 고객박스 표시필드 슬림화([성함/간략메모/예약등록자]).
                    · 초진/재진 텍스트 제거 — 박스 배경 컬러(KIND_CARD_STYLE)로 이미 구분(컬러 점 KIND_DOT은 유지).
                    · 연락처(전화 뒷4자리) 제거 → 간략정보(hover)에 풀번호 노출(이관 완료).
                    예약 상태(STATUS_LABEL)는 운영 신호로 유지. */}
                {/* T-20260630-foot-RESVMGMT-CANCELNAME-REGISTRANT-2FIX (2): 예약등록자(@registrar) 위치 — 예약 상태 '하단' → 상태 '우측 사이드'.
                    기존: 상태줄 아래 별도 div로 등록자 표기(세로 적층). 변경: 같은 flex 행에서 좌=상태 / 우=등록자(ml-auto)로 나란히.
                    좁은 90px 칸 가드 = 상태 shrink-0 + 등록자 min-w-0 truncate.
                    T-20260630-foot-RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH: 데이터 소스 booker(resvBookerMap=created_by) → 예약등록자(registrar_name).
                      라벨/의도는 줄곧 '예약등록자'였는데 소스만 booker(예약 잡은 계정)였던 게 현장 신고 미스매치 RC(예: 등록자 '김민경' 선택했는데 '@김주연' 표기).
                      week 2열뷰 @예약등록자 태그(L2470, registrar_name only)·간략정보(hover)와 단일 소스로 통일. 미지정 행은 미렌더(fallback 없음). */}
                <div className="mt-0.5 flex min-w-0 items-center gap-0.5 overflow-hidden text-[7px] opacity-80">
                  <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', KIND_DOT[resvKind(r)])} />
                  <span className="shrink-0">{STATUS_LABEL[r.status]}</span>
                  {r.registrar_name && (
                    <span className="ml-auto min-w-0 truncate text-teal-700" title={`예약등록자 ${r.registrar_name}`}>
                      @{r.registrar_name}
                    </span>
                  )}
                </div>
              </div>
            );

            return (
              <div data-testid="resv-day-horizontal" className="flex h-full flex-col p-3">
                {/* 시간 격자: 각 시간 = 가로 한 줄에 배열된 컬럼. 컬럼 상단=시간 헤더(가로 일렬),
                    그 아래로 예약을 클릭 없이 상시 세로 진열(TIMEGRID-VERTICAL).
                    세로축 그루핑(치료사/공간) 없음(C5) — 세로는 그 시간의 예약 누적뿐. */}
                <div data-testid="resv-day-xaxis" className="flex h-full flex-1 gap-1 overflow-x-auto pb-2">
                  {daySlots.length === 0 ? (
                    <div className="text-sm text-muted-foreground">영업 시간 슬롯이 없습니다.</div>
                  ) : (
                    daySlots.map((time) => {
                      const list = slotList(time);
                      const { n, rr, h } = kindCounts(time);
                      const total = n + rr + h;
                      const full = isSlotFull(dateStr, time);
                      const isNow = isSameDay(selectedDay, now) && time === currentSlot;
                      const isDragOver = dropTarget === `${dateStr}_${time}`;
                      return (
                        <div
                          key={time}
                          data-testid={`resv-day-col-${time}`}
                          data-slot-time={time}
                          onDragOver={(e) => { e.preventDefault(); setDropTarget(`${dateStr}_${time}`); }}
                          onDragLeave={() => setDropTarget(null)}
                          onDrop={(e) => handleDrop(e, dateStr, time)}
                          className={cn(
                            // T-20260624-foot-TIMEGRID-COMPACT-DENSITY: field-soak 정제 — 시간 컬럼 너비 200px→132px(컴팩트·촘촘히).
                            // T-20260625-foot-...COMPACT2(2단계, 김주연 총괄 확정): 132px→90px 추가 압축(한 화면 더 많은 시간 칸). 카드 w-full(컬럼 추종)이라 폭만 변경.
                            'flex w-[90px] min-w-[90px] flex-col rounded-lg border bg-background',
                            // T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX:
                            //   건1(클립): 기존 isNow 'ring-1 ring-amber-400'(box-shadow)은 부모 overflow-x-auto(→overflow-y auto 계산)에
                            //     좌·하단이 짤림(10:00=첫 컬럼). ring → border(박스모델 내부)로 전환해 클립 근본 해소.
                            //   건2(UX): 노랑 제거 → 실버 #BBBBBB border + 테두리 깜빡임(animate-live-border-pulse, motion-safe).
                            //     reduced-motion 시 정적 실버 border 폴백. 힐러 #FFFDE7(healer 토큰)와 클래스 완전 분리 — 미접촉.
                            isNow
                              ? 'border-2 border-[#BBBBBB] motion-safe:animate-live-border-pulse'
                              : 'border-border',
                            full && !isNow && 'border-red-200',
                            isDragOver && 'bg-teal-50 ring-2 ring-inset ring-teal-400',
                          )}
                        >
                          {/* 시간 헤더(컬럼 상단, 가로 한 줄에 정렬). 클릭 없음 — 상시 표시. */}
                          <div
                            data-testid={`resv-day-hslot-${time}`}
                            data-slot-time={time}
                            className={cn(
                              'sticky top-0 z-10 flex min-h-[32px] items-center justify-between gap-0.5 rounded-t-lg border-b bg-muted/40 px-1 py-0.5',
                              // T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX 건2: 현재시각 헤더 노랑(bg-amber-50) → 실버(bg-slate-100).
                              isNow && 'bg-slate-100',
                              full && 'bg-red-50',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-0.5">
                              <span className="text-[10px] font-semibold tabular-nums text-foreground">{time}</span>
                              {total > 0 ? (
                                <span className="flex flex-wrap items-center gap-0.5 text-[8px] font-medium leading-none">
                                  {n > 0 && <span className="inline-flex items-center rounded-full bg-blue-100 px-0.5 py-0.5 text-blue-700">초 {n}</span>}
                                  {rr > 0 && <span className="inline-flex items-center rounded-full bg-firstvisit-100 px-0.5 py-0.5 text-firstvisit-700">재 {rr}</span>}
                                  {h > 0 && <span className="inline-flex items-center rounded-full bg-healer-100 px-0.5 py-0.5 text-healer-700">HL {h}</span>}
                                </span>
                              ) : null}
                            </div>
                            {!full && (
                              <button
                                type="button"
                                data-testid={`resv-day-slot-plus-${time}`}
                                onClick={() => openNewSlot(selectedDay, time)}
                                title="예약 추가"
                                className="inline-flex items-center gap-0.5 rounded border border-dashed border-muted-foreground/40 px-1 py-0.5 text-[10px] text-muted-foreground transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          {/* 세로 진열 영역 — 그 시간의 예약을 클릭 없이 세로로 누적. */}
                          <div data-testid={`resv-day-col-cards-${time}`} className="flex flex-1 flex-col gap-1 overflow-y-auto p-1">
                            {list.length === 0 ? (
                              <div className="py-2 text-center text-[10px] text-muted-foreground/40">·</div>
                            ) : (
                              list.map(renderDayCard)
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()
        ) : (
          <table className="w-full min-w-[800px] table-fixed border-collapse text-sm">{/* T-20260515-foot-RESPONSIVE-SHELL: min-w 추가 → 모바일 수평 스크롤 활성화 / T-20260522-foot-RESV-CAL-COLWIDTH: table-fixed → 6칸 균등 배분, min-w 700→800px (시간축80+6×120) */}
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
                    // T-20260617-foot-RESVMGMT-COMPACT AC-1: 요일·날짜 헤더는 압축 대상 제외(미변경) — 회귀가드 testid.
                    data-testid="resv-day-header"
                    className={cn(
                      // T-20260615-foot-RESVMGMT-REFIX-8 AC6: 요일·일자 헤더 중앙정렬 + 폰트 확대(text-xs→text-sm, font-semibold).
                      'border-b border-r p-2 text-center text-sm font-semibold overflow-hidden', // T-20260522-foot-RESV-CAL-COLWIDTH: overflow-hidden → table-fixed 시 텍스트 셀 밖 넘침 방지
                      !isOpenDay(d) && 'bg-gray-50 text-muted-foreground',
                      isSameDay(d, new Date()) && 'bg-teal-50 text-teal-700',
                    )}
                  >
                    {/* AC6: 요일·일자 한 줄 중앙 배치. 키운 글자(text-sm font-semibold)로 가독성 확보. */}
                    {WEEK_DAYS_KO[i]} {format(d, 'M/d')}
                    {/* T-20260611-foot-RESVCAL-DISPLAY-REWORK item1: 날짜 헤더 총건수 요약.
                        T-20260613-foot-RESVCAL-FOLLOWUP-5FIX AC1 (REDEFINITION (a)): HL을 총건수에 포함(초+재+힐러).
                        HL 칩(HL N)은 별도 유지 — 합산+별도표기 병존. nji4 'HL 제외' supersede. */}
                    {(() => {
                      const c = dayKindCounts.get(format(d, 'yyyy-MM-dd'));
                      if (!c || (c.n === 0 && c.r === 0 && c.h === 0)) return null;
                      return (
                        // T-20260612-foot-WEEKCAL-HEADER-CARD-REDESIGN (2번): 요일 헤더 건수 칩/뱃지형 재디자인.
                        //   초진=초록/재진=파랑/HL=노랑 칩으로 색상 코딩 일관. 총건수(초+재)는 앞에 굵게.
                        <div
                          data-testid={`day-summary-${format(d, 'yyyy-MM-dd')}`}
                          className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px] font-medium leading-none"
                        >
                          <span className="font-semibold text-foreground/80">총 {c.n + c.r + c.h}</span>
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700">초 {c.n}</span>
                          <span className="inline-flex items-center rounded-full bg-firstvisit-100 px-1.5 py-0.5 text-firstvisit-700">재 {c.r}</span>
                          {c.h > 0 && <span className="inline-flex items-center rounded-full bg-healer-100 px-1.5 py-0.5 text-healer-700">HL {c.h}</span>}
                        </div>
                      );
                    })()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clinic &&
                /* T-20260609-foot-RESV-LIVE-AUTOSCROLL: 인라인 generateSlots → gridSlots 단일 소스 사용
                   (day view: 선택일 close_time / week view: clinic.close_time = 평일 최대, 토요일 열은 allowed=false로 그레이아웃)
                   T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: HOURLY-GROUPING 정시 버킷 REVERT — tbody 행 = 30분 단위 슬롯(gridSlots).
                   10:30 등 반시 예약은 다시 독립 행에 표시(정시 흡수 철회). 컴팩트 압축(COMPACT-HALFSIZE/CONTENT-KEEP className)은 그대로 유지. */
                gridSlots.map(
                  (time) => (
                    <tr
                      key={time}
                      // T-20260609-foot-RESV-LIVE-AUTOSCROLL: 현재 슬롯 행 ref + 클램핑 폴백용 testid
                      ref={time === currentSlot ? currentSlotRef : undefined}
                      data-testid="resv-slot-row"
                      data-slot-time={time}
                    >
                      {/* T-20260515-foot-RESPONSIVE-UI-SHELL Shell-1: 시간축 sticky left-0 */}
                      <td
                        data-testid="resv-time-col-cell"
                        // T-20260617-foot-RESVMGMT-COMPACT AC-1: 시간 슬롯 row 압축 — 시간축 셀 패딩/폰트 축소(py-1.5→py-0.5, text-xs→text-[11px]). 헤더(thead)는 미변경.
                        // T-20260620-foot-RESVCAL-COMPACT-HALFSIZE AC-1: 2차 절반 압축 — 시간축 셀 폰트/패딩 추가 축소(py-0.5→py-0, text-[11px]→text-[10px]). thead 헤더(AC-2)는 미변경.
                        // T-20260622-foot-RESVCAL-COMPACT-CONTENT-KEEP AC-2: 가독성 복원 — 시간축 라벨 폰트 text-[10px]→text-[11px](밀도는 py-0 유지). 압축은 패딩/높이로, 폰트는 읽히는 최소(11~12px).
                className="w-20 border-b border-r py-0 text-center text-[11px] font-medium text-muted-foreground sticky left-0 bg-background z-10"
                      >
                        {/* T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: 시간축 라벨 = 30분 단위 슬롯(HH:00·HH:30). 정시 그룹 라벨(bucket.label) 철회. */}
                        <div>{time}</div>
                        {/* T-20260615-foot-RESVMGMT-REFIX-8 AC4 (현장 확정 MSG-...gkj2 옵션2 '일자×시간 매트릭스'):
                            좌측 시간축의 '보이는 날짜 전체 합산'(5FIX AC2/a921cef per-time sum) supersede 확정 →
                            건수 분포를 각 (날짜×시간) 셀에 per-cell 표기로 이동(아래 cell-kind-count-*). 시간축 라벨은 시간만. */}
                      </td>
                      {(viewMode === 'week' ? weekDays : [selectedDay]).map((d) => {
                        // T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: 30분 슬롯 단위 셀 — 정시 그룹(memberSlots/primarySlot/bucketMax) 철회.
                        //   각 셀 = 단일 30분 슬롯(time). 예약 입력/이동/클립보드/full/정원은 모두 이 슬롯(time) 기준.
                        const allowed = slotsFor(d).includes(time);
                        const dateStr = format(d, 'yyyy-MM-dd');
                        const key = `${dateStr}_${time}`;
                        // T-20260611-foot-RESVCAL-DISPLAY-REWORK item6: 동일 시간대 정렬 초진→재진→힐러.
                        //   Array.sort는 stable → 동일 유형 내 기존(시간) 순서 보존.
                        const list = [...(resvByKey[key] ?? [])].sort(
                          (a, b) => KIND_ORDER[resvKind(a)] - KIND_ORDER[resvKind(b)],
                        );
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
                              // T-20260617-foot-RESVMGMT-COMPACT AC-1: 시간 슬롯 row 높이/패딩 압축(h-12→h-8, p-1→p-0.5) — 절반 밀도, 한 화면 예약건 최대 노출.
                              // T-20260620-foot-RESVCAL-COMPACT-HALFSIZE AC-1: 2차 절반 압축 — 빈 슬롯 최소높이 추가 축소(h-8→h-4, p-0.5→px-0.5 py-0) → 빈 행 32px→16px(~50%). 카드 있는 셀은 카드 높이로 자연 확장(align-top).
                              'h-4 border-b border-r px-0.5 py-0 align-top transition-colors',
                              !allowed && 'bg-gray-50',
                              full && !isDragOver && 'bg-red-50',
                              isDragOver && allowed && !full && 'bg-teal-50 ring-2 ring-inset ring-teal-400',
                              isDragOver && full && 'bg-red-100 ring-2 ring-inset ring-red-400',
                              isClipboardTarget && 'bg-green-50 ring-2 ring-inset ring-green-400',
                            )}
                            onDragOver={(e) => { if (allowed) { e.preventDefault(); setDropTarget(cellKey); } }}
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(e) => { if (allowed) handleDrop(e, dateStr, time); }}
                            // T-20260615-foot-RESVPOPUP-3BUG AC3 (BUG-3): 빈 슬롯 우클릭 → (+) 버튼과 동일하게
                            //   예약상세 팝업 new-mode 오픈(openNewSlot). 기존엔 빈 슬롯에 우클릭 핸들러가 없어 (+) 경로와
                            //   동작 불일치(현장 질의 "두 진입경로가 왜 다름?"). 예약 카드 우클릭은 카드 자체 onContextMenu 가
                            //   stopPropagation 하므로 이 셀 핸들러로 버블되지 않음 → 카드=컨텍스트메뉴 / 빈슬롯=new-mode 유지.
                            //   🔒 L-002: 생성 capability·로직 불변(openNewSlot 재사용) — 진입 '배선'만 (+) 와 통일.
                            //   가드는 (+) 버튼(아래 slot-plus)과 동일: allowed && !full && 클립보드 없음.
                            onContextMenu={(e) => {
                              if (allowed && !full && !clipboard) {
                                e.preventDefault();
                                openNewSlot(d, time);
                              }
                            }}
                            onClick={() => {
                              // T-20260515-foot-RESV-BOX-INTERACT: AC-1 빈 영역 클릭 → 선택 해제
                              if (clipboard && allowed) {
                                setClipboardTarget({ date: dateStr, time });
                              } else if (!clipboard) {
                                // 카드 클릭 미완료 타이머도 취소
                                if (clickTimerRef.current) {
                                  clearTimeout(clickTimerRef.current.timerId);
                                  clickTimerRef.current = null;
                                }
                                setSelectedResvId(null);
                              }
                            }}
                          >
                            {allowed && (
                              <div className="flex h-full w-full min-w-0 flex-col gap-0.5 rounded text-left">{/* T-20260522-foot-RESV-CAL-COLWIDTH: min-w-0 → 자식 flex 아이템이 셀 너비 이하로 수축 허용 / T-20260617-foot-RESVMGMT-COMPACT AC-1: 카드 간 여백 압축 gap-1→gap-0.5(절반 밀도) */}

                                {/* T-20260615-foot-RESVMGMT-REFIX-8 AC4 (현장 확정 옵션2 '일자×시간 매트릭스'):
                                    좌측 시간축 '날짜 합산'(5FIX AC2/a921cef) supersede → 각 (날짜×시간) 셀에 per-cell 건수 분포 표기.
                                    이 셀(dateStr×time)의 활성(취소 제외) 예약을 초/재/HL 분류 집계 = "10시 2건" 식 시간대별 분포.
                                    집계 시맨틱(resvKind·cancelled 제외)은 제거된 시간축 합산과 동일 — 차원만 per-day로 분리. */}
                                {(() => {
                                  // T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: per-cell 카운트 = 단일 30분 슬롯(time) 예약(list = resvByKey[key]).
                                  let n = 0, rr = 0, h = 0;
                                  for (const r of list) {
                                    if (r.status === 'cancelled') continue;
                                    const kind = resvKind(r);
                                    if (kind === 'new') n += 1;
                                    else if (kind === 'returning') rr += 1;
                                    else if (kind === 'healer') h += 1;
                                  }
                                  if (n === 0 && rr === 0 && h === 0) return null;
                                  return (
                                    <div
                                      data-testid={`cell-kind-count-${dateStr}-${time}`}
                                      className="flex flex-wrap items-center gap-0.5 text-[9px] font-medium leading-none"
                                    >
                                      {n > 0 && <span className="inline-flex items-center rounded-full bg-blue-100 px-1 py-0.5 text-blue-700">초 {n}</span>}
                                      {rr > 0 && <span className="inline-flex items-center rounded-full bg-firstvisit-100 px-1 py-0.5 text-firstvisit-700">재 {rr}</span>}
                                      {h > 0 && <span className="inline-flex items-center rounded-full bg-healer-100 px-1 py-0.5 text-healer-700">HL {h}</span>}
                                    </div>
                                  );
                                })()}

                                {/* T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 경과분석 필터(filterProgress) 제거 → 전체 예약 표시.
                                    T-20260613-foot-RESVCAL-MYRESV-DEF (기능2): '내 예약' = registrar_name === 로그인 표시명 NAME-MATCH.
                                    read-only 표시 필터 — 슬롯 용량/카운트 산식(full 판정)은 불변. */}
                                {(() => {
                                  // T-20260622-foot-RESVCAL-TYPE-2COL-2TIER(A안 정본 — 김주연 총괄 MSG-...-9osx): 각 시간 슬롯 셀 *내부*를 좌우 2열 그리드.
                                  //   왼쪽 열(colNew)=초진(new) / 오른쪽 열(colRest)=재진(returning)+힐러(healer)+기타(other) 전수.
                                  //   각 열은 위→아래로 독립 세로 쌓기(flex-col). 카드 수 > 1쌍이면 그리드 행이 카드 수만큼 늘어남.
                                  //   (취소된 B안=2줄 Row 가로 전부 나열 ❌ / 페이지 상하·좌우 구역 분리 ❌ — 어디까지나 슬롯 셀 내부 2열.)
                                  //   열 내 정렬 = 예약 시각(reservation_time) 순. 단일 그룹이면 채워진 열만, 좌우 2열 트랙은 항상 유지(정렬 불깨짐).
                                  //   카드 누락 0(visible 전수 귀속). 불변: 카드 내용·필드, KIND_CARD_STYLE 컬러, 클릭/hover/우클릭, COMPACT-CONTENT-KEEP(828893f3) 압축 레이어.
                                  // T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD: '내 예약' 기준 담당자 = filterAssignee 선택값(없으면 본인 myDisplayName).
                                  const mineTarget = filterAssignee !== '' ? filterAssignee : myDisplayName;
                                  const visible = list
                                    .filter((r) => !filterMine || (mineTarget !== '' && (r.registrar_name ?? '').trim() === mineTarget));
                                  const byTime = (a: Reservation, b: Reservation) =>
                                    a.reservation_time < b.reservation_time ? -1 : a.reservation_time > b.reservation_time ? 1 : 0;
                                  const colNew = visible.filter((r) => resvKind(r) === 'new').sort(byTime);     // 왼쪽 열 = 초진
                                  const colRest = visible.filter((r) => resvKind(r) !== 'new').sort(byTime);    // 오른쪽 열 = 재진+힐러(+기타)
                                  const renderCard = (r: Reservation) => (
                                  <div
                                    key={r.id}
                                    data-testid={`resv-card-${r.id}`}
                                    draggable={r.status === 'confirmed'}
                                    onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, r.id); }}
                                    onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                                    // T-20260525-foot-RESV-CANCEL-ANYDATE: 카드 전체 영역 우클릭 → 컨텍스트메뉴
                                    // (이름 span 밖 클릭도 취소 메뉴 접근 가능 — 전일자 포함 날짜 무관 동작)
                                    // T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC5: soft-delete 메뉴 노출 정책.
                                    //   취소(cancelled_at NOT NULL) 예약도 우클릭 메뉴 노출 → [예약상세]에서 [예약복원] 가능.
                                    //   reservations 는 hard-delete(deleted_at 컬럼 없음)이므로 row 존재 = 메뉴 표시 대상.
                                    //   기존 `status !== 'cancelled'` 차단 제거(취소 예약 메뉴 진입 불가 버그 해소).
                                    onContextMenu={(e) => {
                                      if (r.customer_id) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } });
                                      }
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // T-20260515-foot-RESV-BOX-INTERACT: AC-4
                                      // 300ms 디바운스로 단일클릭(선택) / 더블클릭(예약수정) 구분
                                      if (clickTimerRef.current?.resvId === r.id) {
                                        // 300ms 이내 동일 카드 재클릭 → 더블클릭: 예약 수정 모달
                                        clearTimeout(clickTimerRef.current.timerId);
                                        clickTimerRef.current = null;
                                        openEdit(r);  // AC-3: 기존 예약 수정 모달 (첨부이미지는 resv 스키마 미지원)
                                      } else {
                                        // 다른 카드 타이머 취소
                                        if (clickTimerRef.current) {
                                          clearTimeout(clickTimerRef.current.timerId);
                                        }
                                        // 단일클릭: 300ms 후 선택 상태 전환 (AC-1)
                                        clickTimerRef.current = {
                                          resvId: r.id,
                                          timerId: setTimeout(() => {
                                            clickTimerRef.current = null;
                                            setSelectedResvId(r.id);  // AC-1: 선택 상태 (테두리 ring-teal-500)
                                          }, 300),
                                        };
                                      }
                                    }}
                                    className={cn(
                                      // T-20260622-foot-RESVCAL-TYPE-2COL-2TIER(A안): 카드는 열(flex-col) 안에서 w-full(열폭 채움)+min-w-0(좁은 열폭 truncate 흡수). 세로 쌓기이므로 flex-1 금지.
                                      'min-w-0 w-full overflow-hidden rounded border px-1 py-0 text-[11px] leading-tight shadow-sm transition-opacity', // T-20260522-foot-RESV-CAL-COLWIDTH: w-full + overflow-hidden → 카드가 셀 너비에 맞게 수축, 내용 클립 / T-20260617-foot-RESVMGMT-COMPACT AC-1: 예약 박스 압축(px-2 py-1→px-1.5 py-0.5, text-xs→text-[11px]) / T-20260620-foot-RESVCAL-COMPACT-HALFSIZE AC-3: 2차 절반 압축(text-[11px]→text-[10px]) / T-20260622-foot-RESVCAL-COMPACT-CONTENT-KEEP AC-1·AC-2: 가독성 복원 — 카드 본문 폰트 text-[10px]→text-[11px](읽히는 최소). 정보항목 전부 유지(삭제 0), 압축은 padding(px-1 py-0)·leading-tight·셀높이로만 달성, 넘치면 ellipsis

                                      r.status === 'confirmed' && 'cursor-grab active:cursor-grabbing',
                                      draggedId === r.id && 'opacity-40',
                                      STATUS_STYLE[r.status],
                                      // T-20260611-foot-RESVCAL-DISPLAY-REWORK item3: 초진=초록/재진=파랑/힐러=노랑
                                      KIND_CARD_STYLE[resvKind(r)],
                                      // AC-3: 내원완료(checked_in) → 희미하게, 미내원(confirmed) → 진하게 (T-20260514-foot-CHECKIN-AUTO-STAGE)
                                      r.status === 'checked_in' && draggedId !== r.id && 'opacity-50',
                                      // T-20260515-foot-RESV-DND-SHORTCUT: 클립보드 시각적 피드백
                                      selectedResvId === r.id && !clipboard && 'ring-2 ring-teal-500',
                                      clipboard?.resv.id === r.id && clipboard.mode === 'copy' && 'ring-2 ring-blue-400',
                                      clipboard?.resv.id === r.id && clipboard.mode === 'cut' && 'opacity-60 ring-2 ring-amber-400',
                                    )}
                                  >
                                    <div className="flex min-w-0 items-center gap-1 overflow-hidden">{/* T-20260522-foot-RESV-CAL-COLWIDTH: min-w-0 → 이름·배지 행 수축 허용 / T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN AC-2: overflow-hidden → 2단 좁은 폭에서 성함 ellipsis 클립 경계 */}
                                      {/* T-20260515-foot-RESV-CTX-HOVER: hover 팝업 + 우클릭 컨텍스트 메뉴
                                          취소된 예약 / 미연결 고객은 기존 plain span 유지 */}
                                      {r.customer_id && r.status !== 'cancelled' ? (
                                        // T-20260525-foot-RSVMGMT-CHART-OPEN AC-1: onClick → openChart (대시보드 동작과 동일)
                                        <CustomerHoverCard
                                          checkIn={resvAsCheckIn(r)}
                                          reservationTime={r.reservation_time}
                                          // T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [4]: 예약 hover 새 레이아웃.
                                          //   등록자=resvBookerMap(예약 잡은 계정명, 예 'admin') / 예약일시 / 방문경로 / 풀번호 / 간략메모(W2)/ 예약메모.
                                          // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item2): brief_note(간략메모) 컬럼 배선 — 값 있으면 hover에 표기, 없으면 줄 자동 생략.
                                          reservationInfo={{
                                            // T-20260630-foot-RESV-REGISTRAR-BRIEFINFO-STAFF-MISMATCH: 간략정보(hover) '등록자:' 줄 = 예약등록자(registrar_name 스냅샷) ONLY.
                                            //   booker(resvBookerMap=created_by) fallback 제거 — 카드 @예약등록자 태그(L2470)와 동일 소스로 통일.
                                            //   미지정/타경로 행은 booker를 '등록자'로 오표기하지 않고 라벨 생략(일시만). RC: 카드 vs hover fallback 분기 불일치.
                                            registrarLabel: r.registrar_name?.trim() || null,
                                            reservationDate: r.reservation_date,
                                            visitRoute: r.visit_route ?? r.referral_source ?? null,
                                            // T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN: 예약메모 SoT(reservation_memo_history) 우선.
                                            //   null(구버전 행·이력없음)이면 기존 booking_memo 컬럼 fallback → 회귀 0.
                                            bookingMemo: resvMemoMap.get(r.id) ?? r.booking_memo ?? null,
                                            briefNote: r.brief_note ?? null,
                                          }}
                                          compact
                                          // T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN: 2단(2열) 캘린더 카드 = 고밀도.
                                          //   성함 text-sm→text-xs 축소 + 좁은 폭에서 ellipsis 실동작(박스 깨짐·넘침 0).
                                          compactDense
                                          onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setResvContextMenu({ resv: r, pos: { x: e.clientX, y: e.clientY } });
                                          }}
                                          onClick={() => handleResvOpenChart(resvAsCheckIn(r))}
                                        />
                                      ) : (
                                        <span
                                          className={cn(
                                            // T-20260615-foot-RESVMGMT-REFIX-8 AC7: 성함 컬러 검정 통일(상태별 카드색 상속 차단).
                                            'font-semibold text-gray-900',
                                            // T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN AC-2: 취소/미연결 성함도 2단 좁은 폭에서
                                            //   박스 넘침 없이 ellipsis로 흡수(block+min-w-0+truncate). 폰트는 카드 본문(text-[11px]) 상속.
                                            'block min-w-0 max-w-full truncate',
                                            r.customer_id && 'cursor-pointer hover:underline hover:text-teal-700 transition-colors',
                                            r.status === 'cancelled' && 'line-through',
                                          )}
                                          onClick={(e) => {
                                            if (!r.customer_id) return;
                                            e.stopPropagation();
                                            // T-20260615-foot-RESVMGMT-REFIX-8 AC8: 취소(cancelled) 고객 클릭 시 별도 window.open 차트가 아니라
                                            //   정상 예약 클릭과 동일한 인앱 차트 패널(handleResvOpenChart)로 통일. 별도 창 분기 제거.
                                            handleResvOpenChart(resvAsCheckIn(r));
                                          }}
                                        >
                                          {r.customer_name}
                                        </span>
                                      )}
                                      {/* T-20260515-foot-RESV-CANCEL: 취소됨 배지 */}
                                      {r.status === 'cancelled' && (
                                        <span className="text-[9px] bg-gray-200 text-gray-500 rounded px-0.5 leading-none">취소됨</span>
                                      )}
                                      {/* T-20260514-foot-CHART-NO-VISIBLE / T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 등록환자(customer_id)면 차트번호 항상 표시(미발번도 명시)
                                          T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER §D(AC-5): 활성 카드는 CustomerHoverCard 트리거가
                                          이미 차트번호를 인접 표기 → 여기서 중복 배지 제거. 취소건(plain span 분기, hovercard 미사용)에만
                                          PAIRING-AUDIT(환자명 단독노출 0) 유지용으로 별도 배지 렌더. */}
                                      {r.customer_id && r.status === 'cancelled' && (
                                        <span className={`text-[10px] font-mono ${resvChartMap.get(r.customer_id) ? 'text-teal-600' : 'text-muted-foreground'}`}>
                                          {chartNoBadge(resvChartMap.get(r.customer_id))}
                                        </span>
                                      )}
                                      {/* T-20260620-foot-RESVMGMT-NOSHOW-BADGE-DEDUP: 차트번호 옆 "노쇼 N회" destructive 배지 제거
                                          (상태줄 STATUS_LABEL '노쇼'와 중복). noshowByCustomer state/fetch는 ReservationDetailPopup
                                          noshowCount prop(L~2065)에서 여전히 사용하므로 유지. */}
                                      {/* T-20260527-foot-TREATMENT-CYCLE-ALERT AC-2/AC-3:
                                          치료 회차 배지 + 6배수 진료필요 배지 */}
                                      {r.customer_id && r.status !== 'cancelled' && (() => {
                                        const completed = treatmentCycleMap.get(r.customer_id) ?? 0;
                                        const nextCycle = completed + 1;
                                        const needsExam = nextCycle > 0 && nextCycle % 6 === 0;
                                        return (
                                          <>
                                            <span
                                              className="text-[10px] font-mono tabular-nums text-gray-400 leading-none"
                                              data-testid={`cycle-count-${r.id}`}
                                              title={`누적 완료 ${completed}회 · 이번 예약 ${nextCycle}회차`}
                                            >
                                              {nextCycle}회
                                            </span>
                                            {needsExam && (
                                              <Badge
                                                className="h-4 px-1 text-[9px] bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-100"
                                                data-testid={`needs-exam-badge-${r.id}`}
                                                title={`${nextCycle}회차 — 진료 필요`}
                                              >
                                                진료필요
                                              </Badge>
                                            )}
                                          </>
                                        );
                                      })()}
                                      {/* T-20260611-foot-HEALER-DEDUCT-LINK: 고객 '다음 예약이 힐러' read-only indicator.
                                          현재 카드 자신이 힐러가 아니고(중복 회피), 미래 힐러 예약이 이 카드보다 늦을 때만 노출. */}
                                      {r.customer_id && resvKind(r) !== 'healer' && r.status !== 'cancelled' && (() => {
                                        const hl = nextHealerByCustomer[r.customer_id];
                                        if (!hl) return null;
                                        const cardKey = `${r.reservation_date} ${r.reservation_time.slice(0, 5)}`;
                                        if (hl <= cardKey) return null;
                                        return (
                                          <Badge
                                            className="h-4 px-1 text-[9px] bg-yellow-100 text-yellow-700 border border-yellow-300 hover:bg-yellow-100"
                                            data-testid={`next-healer-badge-${r.id}`}
                                            title={`다음 예약 힐러 — ${hl}`}
                                          >
                                            다음 힐러
                                          </Badge>
                                        );
                                      })()}
                                      {/* T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item2): 초진 카드 예약경로 배지(우상단).
                                          r.visit_route(없으면 referral_source) 있을 때만 표기. ml-auto로 행 우측 정렬. */}
                                      {resvKind(r) === 'new' && r.status !== 'cancelled' && (r.visit_route ?? r.referral_source) && (
                                        <span
                                          className="ml-auto shrink-0 rounded border border-gray-300 bg-gray-100 px-1 text-[9px] font-medium leading-tight text-gray-600"
                                          data-testid={`resv-route-badge-${r.id}`}
                                          title={`예약경로 ${r.visit_route ?? r.referral_source}`}
                                        >
                                          {r.visit_route ?? r.referral_source}
                                        </span>
                                      )}
                                    </div>
                                    {/* T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item2): 초진=간략메모 / 재진=패키지 N/N 인라인 라인(값 있을 때만, 없으면 줄 생략). */}
                                    {r.status !== 'cancelled' && resvKind(r) === 'new' && r.brief_note?.trim() && (
                                      <div
                                        className="truncate text-[10px] leading-tight text-gray-700"
                                        data-testid={`resv-brief-${r.id}`}
                                        title={r.brief_note.trim()}
                                      >
                                        {r.brief_note.trim()}
                                      </div>
                                    )}
                                    {r.status !== 'cancelled' && resvKind(r) !== 'new' && r.customer_id && (() => {
                                      const pg = pkgProgressMap.get(r.customer_id);
                                      if (!pg || !pg.total) return null;
                                      return (
                                        <div
                                          className="truncate text-[10px] font-medium leading-tight text-blue-700"
                                          data-testid={`resv-pkg-progress-${r.id}`}
                                          title={`패키지 ${pg.used}/${pg.total} 회차`}
                                        >
                                          패키지 {pg.used}/{pg.total}
                                        </div>
                                      );
                                    })()}
                                    {/* RESV-SLOT-INFO: 방문유형·상태 + 전화번호 뒷4자리 */}
                                    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden text-[10px] opacity-80">{/* T-20260522-foot-RESV-CAL-COLWIDTH: min-w-0 + overflow-hidden → 상태줄 셀 밖 넘침 방지 / T-20260617-foot-RESVMGMT-COMPACT AC-1: 상태줄 폰트 text-xs→text-[10px] / T-20260620-foot-RESVCAL-COMPACT-HALFSIZE AC-3: text-[10px]→text-[9px] / T-20260622-foot-RESVCAL-COMPACT-CONTENT-KEEP AC-2: 가독성 복원 text-[9px]→text-[10px] (방문유형·상태·전화뒷4자리 전부 유지) */}
                                      {/* T-20260611-foot-RESVCAL-DISPLAY-REWORK item3: 유형 점 색 일치(초진=초록/재진=파랑/힐러=노랑) */}
                                      {/* T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY: 고객박스 슬림화 —
                                          초진/재진 텍스트 제거(박스 컬러로 구분, 컬러 점 유지) + 연락처(전화 뒷4자리) 제거(간략정보 hover로 이관).
                                          예약 상태(STATUS_LABEL)·담당자(@booker)는 운영 신호로 유지. */}
                                      <span className={cn(
                                        'inline-block h-1.5 w-1.5 rounded-full',
                                        KIND_DOT[resvKind(r)],
                                      )} />
                                      {STATUS_LABEL[r.status]}
                                      {/* T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC1·AC3·AC4): 담당자=예약 잡은 계정.
                                          연락처(전화) 옆 같은 라인 + '@담당자명' 표기. 미상(과거예약 등) 시 미렌더(AC5).
                                          ★SCOPE: 예약관리 표시 한정 — 차트 담당자(customers.assigned_staff_id) 불변. */}
                                      {resvBookerMap.get(r.id) && (
                                        <span
                                          className="truncate text-teal-700"
                                          data-testid={`assigned-staff-tag-${r.id}`}
                                          title={`담당자 ${resvBookerMap.get(r.id)}`}
                                        >
                                          · @{resvBookerMap.get(r.id)}
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
                                    {/* T-PROGRESS-CHECKPOINT AC-3/4: 경과분석 배지
                                        T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK §1 회차 명확화:
                                        progress_check_label(=plan label, 예 "6회 경과분석")에 '체크포인트' 접미를 붙여
                                        해당 항목이 '몇 회차 경과분석 체크포인트'인지 한눈에. 회차 카운트는
                                        PROGRESS-CHECKPOINT plan.session_milestone(label에 반영) 재사용 — 신설 없음. */}
                                    {r.progress_check_required && (
                                      <div
                                        className={cn(
                                          'inline-flex items-center gap-0.5 rounded border border-teal-300 bg-teal-100 px-1 font-medium text-teal-800 leading-none py-0.5 mt-0.5',
                                          // T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 경과분석 뷰(filterProgress) 제거 → 기본(OFF) 표시로 고정. 배지(읽기전용 회차 표시)는 유지.
                                          'text-[10px]',
                                        )}
                                        data-testid={`progress-badge-${r.id}`}
                                        title={`${r.progress_check_label ?? '경과분석'} — 경과분석 체크포인트`}
                                      >
                                        <TrendingUp className="h-2.5 w-2.5" />
                                        {r.progress_check_label ?? '경과분석'}
                                        <span className="opacity-70">체크포인트</span>
                                      </div>
                                    )}
                                    {/* T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI: 담당자 표시는 위 상태줄(연락처 옆 @담당자명)로 이동.
                                        기존 차트 담당자(customers.assigned_staff_id) 기준 표시 제거 — 예약관리 한정 SCOPE. */}
                                    {/* T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS AC-5: 우측 하단 @예약등록자.
                                        정상·취소됨 박스 모두 적용. 미지정 시 빈칸(미렌더, 에러 없음). */}
                                    {r.registrar_name && (
                                      <div
                                        className="truncate text-right text-[10px] text-muted-foreground leading-none mt-0.5"
                                        data-testid={`registrar-tag-${r.id}`}
                                        title={`예약등록자 ${r.registrar_name}`}
                                      >
                                        @{r.registrar_name}
                                      </div>
                                    )}
                                  </div>
                                  );
                                  // T-20260622-foot-RESVCAL-TYPE-2COL-2TIER(A안): 좌우 2열 그리드. 카드가 하나도 없으면 그리드 자체 미렌더(빈 슬롯 유지).
                                  //   왼쪽 열=초진(colNew) / 오른쪽 열=재진+힐러(colRest), 각 열 flex-col 세로 쌓기(예약 시각 순). 2열 트랙은 항상 유지 → 단일 그룹이어도 좌/우 정렬 불깨짐.
                                  if (colNew.length === 0 && colRest.length === 0) return null;
                                  return (
                                    <div
                                      data-testid={`resv-typecols-${dateStr}-${time}`}
                                      className="grid grid-cols-2 gap-0.5 items-start"
                                    >
                                      <div
                                        data-testid={`resv-col-new-${dateStr}-${time}`}
                                        className="flex flex-col gap-0.5 min-w-0"
                                      >
                                        {colNew.map(renderCard)}
                                      </div>
                                      <div
                                        data-testid={`resv-col-rest-${dateStr}-${time}`}
                                        className="flex flex-col gap-0.5 min-w-0"
                                      >
                                        {colRest.map(renderCard)}
                                      </div>
                                    </div>
                                  );
                                })()}
                                {/* T-20260615-foot-RESVMGMT-REFIX-8 AC5: '일괄 배치' 버튼 제거(현장 불필요).
                                    이전 BATCH-CHECKIN-LEAK 가드 블록 + batchCheckIn 호출 동반 삭제. */}
                                {/* 빈 슬롯 (+) 예약생성 — full(마감) 아니면 노출.
                                    T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경1]: 경과분석 뷰(filterProgress) 제거 → (+)는 마감 여부로만 가드. */}
                                {!full ? (
                                  <button
                                    data-testid={`slot-plus-${dateStr}-${time}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: 30분 슬롯 (+) → 해당 슬롯(time) 실제 시각으로 생성.
                                      if (clipboard) {
                                        setClipboardTarget({ date: dateStr, time });
                                      } else {
                                        openNewSlot(d, time);
                                      }
                                    }}
                                    className={cn(
                                      // T-20260620-foot-RESVCAL-COMPACT-HALFSIZE AC-1: 빈 슬롯 (+)버튼 최소높이 압축(min-h-[24px]→min-h-[16px], h-5→h-4) → 빈 행 밀도 ~2배. 클릭/터치 영역 유지(Plus 아이콘 중앙).
                                      'flex items-center justify-center rounded border border-dashed border-muted-foreground/30 text-muted-foreground/50 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600 transition',
                                      list.length === 0 ? 'flex-1 min-h-[16px]' : 'h-4 w-full mt-0.5',
                                    )}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                ) : full && list.length === 0 ? (
                                  <span className="m-auto text-xs font-medium text-red-500">마감</span>
                                ) : null}
                                {clinic && activeCount > 0 && (
                                  <span className={cn(
                                    'mt-auto self-end text-[10px] tabular-nums',
                                    full ? 'text-red-500 font-medium' : 'text-muted-foreground',
                                  )}>
                                    {/* T-20260525-foot-TIMETABLE-POST16-SLOT: 16:00 이후 /10, 이전 /12
                                        T-20260622-foot-RESVCAL-30MIN-SLOT-REVERT: 30분 슬롯 정원 = slotMaxFor(time)(정시 그룹 합산 bucketMax 철회). */}
                                    {activeCount}/{slotMaxFor(time)}
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
        maxPerSlot={editor ? slotMaxFor(editor.time) : SLOT_MAX_TOTAL}
        changedBy={changedBy}
        authorName={profile?.name ?? ''}
        onClose={() => setEditor(null)}
        /* T-20260610-foot-RESV-OVERHAUL-7 AC-6/AC-7: 예약상세(수정) 모달 푸터 액션 */
        onCancelReservation={handleEditorCancel}
        onDeleteReservation={handleEditorDelete}
        onRestoreReservation={handleEditorRestore}
        onSaved={() => {
          // T-20260529-foot-RESV-TIME-EDIT-NOSYNC AC-2:
          // 낙관적 즉시 반영 — 편집 모달 닫기 전 timetable 카드 위치 즉시 업데이트
          // fetchWeek() 완료를 기다리지 않고 사용자가 즉시 변경 결과를 확인 가능
          if (editor?.existingId) {
            const { existingId, date, time } = editor;
            setRows((prev) =>
              prev.map((r) =>
                r.id === existingId
                  ? { ...r, reservation_date: date, reservation_time: time }
                  : r,
              ),
            );
          }
          setEditor(null);
          fetchWeek(); // DB 확인용 백그라운드 동기화
        }}
      />

      {/* T-20260516-foot-RESV-DETAIL-POPUP: 4분할 팝업으로 교체 */}
      <ReservationDetailPopup
        reservation={detail}
        noshowCount={
          detail?.customer_id ? noshowByCustomer[detail.customer_id] ?? 0 : 0
        }
        changedBy={changedBy}
        authorName={profile?.name ?? ''}
        isAdmin={profile?.role === 'admin'}
        onClose={() => {
          setDetail(null); setNewReservationMode(false); setNewReservationInitial(null);
          // T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN: 예약메모는 reservation_memo_history(타임라인)에 저장되며
          //   reservations 테이블 realtime 채널을 트리거하지 않음 → 팝업에서 메모 추가 후 닫으면 hover용 resvMemoMap이
          //   stale. 닫을 때 1회 동기화하여 새 예약메모가 달력뷰 hover에 즉시 반영되게 함(명시적 fetchWeek는 dedup 우회).
          fetchWeek();
        }}
        onEdit={openEdit}
        onChanged={() => {
          setDetail(null);
          setNewReservationMode(false);
          setNewReservationInitial(null);
          fetchWeek();
        }}
        /* T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: 팝업 new-mode → 단일소스 생성 함수 위임(모달 스폰 폐기). */
        onCreateReservation={handleCreateReservationFromPopup}
        /* AC2 시나리오1: (+) 새 예약 → anchor 예약 없이 new-mode 진입. clinic_id 직접 주입(useClinic). */
        newMode={newReservationMode}
        clinicId={clinic?.id ?? null}
        /* T-20260615-foot-RESVMGMT-REFIX-8 AC3: 빈슬롯 (+) 진입 시 클릭 슬롯 날짜/시간 prefill(상단 '새 예약'은 null). */
        initialDate={newReservationInitial?.date ?? null}
        initialTime={newReservationInitial?.time ?? null}
        /* T-20260630-foot-RESV-CUSTCTX-PREFILL: 고객 컨텍스트로 진입(동선1·2) 시 슬롯클릭 new-mode 팝업에 해당 고객 자동 prefill.
           null = 일반 진입(빈 신규폼, AC4 회귀). sticky pendingPrefillCustomer 라 연속 슬롯클릭에도 동일 고객 유지. */
        initialCustomer={pendingPrefillCustomer}
      />

      {/* T-20260515-foot-RESV-CTX-HOVER: 예약관리 우클릭 메뉴 + hover 팝업 오버레이 */}
      {/* T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC1/AC3: 우클릭 메뉴 정확히 5항목
          [고객차트 → 진료차트 → 예약상세 → 수납 → 문자]로 통일.
          [예약 취소]·[완전 삭제] 메뉴 항목 제거 — 둘 다 예약상세 팝업(ReservationDetailPopup)
          [예약취소]/[예약삭제] 버튼에서만 가능(기능 손실 0). onCancelReservation/onDeleteReservation 미전달. */}
      <CustomerQuickMenu
        checkIn={resvContextMenu ? resvAsCheckIn(resvContextMenu.resv) : null}
        position={resvContextMenu?.pos ?? null}
        onClose={() => setResvContextMenu(null)}
        onOpenChart={handleResvOpenChart}
        onOpenMedicalChart={handleResvOpenMedicalChart}
        /* T-20260610-foot-RESV-MGMT-CTXMENU-DETAIL-5FIX item3 (Q2 확정): [예약상세] 클릭 → 예약상세 팝업 오픈
           (POPUP-SYNC AC-3 에서 라벨만 분기했던 와이어링을 본 티켓에서 동작까지 연결). */
        onNewReservation={handleResvOpenDetailFromMenu}
        onOpenPayment={handleResvOpenPayment}
        /* CANONICAL: 기존 예약 우클릭 → '예약상세' 라벨 고정. [예약하기] 표현 미사용. */
        reservationActionLabel="예약상세"
        /* T-20260611-foot-RESV-CTXMENU-SMS-MISSING: CANONICAL 5항목 中 '문자' 복원.
           admin/manager(manual_sms_send 권한) 한정 노출 — 미허용 시 onSendSms 미전달 → 항목 숨김. */
        onSendSms={
          canAccess(profile, 'manual_sms_send')  /* T-20260620-foot-SUPERADMIN-EXEMPT: subject 전달(exempt honor) */
            ? (ci) => { setResvContextMenu(null); setSmsTarget(ci); }
            : undefined
        }
      />

      {/* T-20260525-foot-RESV-CANCEL-CTX: 예약 취소 모달 */}
      <ReservationCancelModal
        open={cancelTarget !== null}
        customerName={cancelTarget?.customer_name ?? ''}
        onClose={() => { if (!cancelBusy) setCancelTarget(null); }}
        onConfirm={handleResvCancelConfirm}
        busy={cancelBusy}
      />

      {/* T-20260611-foot-RESV-CTXMENU-SMS-MISSING: 수동 1:1 문자 발송 모달(Dashboard.tsx 정본 미러) */}
      <SendSmsDialog
        open={smsTarget !== null}
        onOpenChange={(v) => { if (!v) setSmsTarget(null); }}
        checkIn={smsTarget}
        clinicId={clinic?.id ?? ''}
      />

      {/* T-20260516-foot-CHART-OPEN-UNIFY AC-1: CustomerChartSheet 렌더 제거 → AdminLayout 단일 렌더로 통합 */}

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
  /** T-20260525-foot-RESV-DESIG-AUTOASSIGN AC-1: customers.designated_therapist_id */
  designatedTherapistId: string | null;
  designatedTherapistName: string | null;
  /** 최근 체크인 날짜 */
  lastVisitDate: string | null;
  /** 직전 치료 요약 (treatment_kind + treatment_contents 조합) */
  lastTreatmentSummary: string | null;
  /** 직전 치료의 담당 치료사 */
  lastTherapistName: string | null;
}

// T-20260522-foot-RESV-TREAT-UX AC-3: 치료명 한글 매핑 (CustomerChartPage TREAT_KO 재사용)
const TREAT_KO: Record<string, string> = {
  heated_laser: '가열',
  unheated_laser: '비가열',
  podologue: '포돌로게',
  iv: '수액',
  preconditioning: '프컨',
  trial: '체험권',
};

// T-20260522-foot-RESV-TREAT-HISTORY: 시술내역 행 타입
// T-20260524-foot-RESV-TREAT-REFORMAT AC-1: 5컬럼 — therapist_name 추가
interface TreatHistoryRow {
  session_id: string;
  package_name: string;
  session_number: number;
  total_sessions: number;
  session_type: string;
  therapist_name: string; // AC-1: 치료사 컬럼 추가
  session_date: string;
}

// T-PROGRESS-CHECKPOINT AC-2: 패키지 연결 드롭다운용 타입
interface LinkedPackageOption {
  id: string;
  package_name: string;
  package_type: string;
  total_sessions: number;
  used_sessions: number;  // package_sessions count(status='used')
}

// T-PROGRESS-CHECKPOINT: 경과분석 플랜 타입 (package_progress_plans 행)
// T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND: 매칭키를 package_type(string) → session_count_tier(int)로 교체.
// tier = packages.total_sessions(6의배수 6..48). 이름·FK 무관 전수 커버(Option C).
interface ProgressPlanEntry {
  session_count_tier: number;   // = packages.total_sessions (매칭키)
  session_milestone: number;
  label: string;
  is_active: boolean;
}

function ReservationEditor({
  draft,
  clinicId,
  maxPerSlot,
  changedBy,
  authorName,
  onClose,
  onSaved,
  onCancelReservation,
  onDeleteReservation,
  onRestoreReservation,
}: {
  draft: ReservationDraft | null;
  clinicId: string | undefined;
  maxPerSlot: number;
  changedBy: string | null;
  authorName: string;
  onClose: () => void;
  onSaved: () => void;
  // T-20260610-foot-RESV-OVERHAUL-7 AC-6/AC-7: 예약상세(수정) 모달 푸터 액션 (편집 모드 전용)
  onCancelReservation?: (resvId: string) => void;
  onDeleteReservation?: (resvId: string) => void;
  onRestoreReservation?: (resvId: string) => void;
}) {
  const [state, setState] = useState<ReservationDraft | null>(draft);
  const [submitting, setSubmitting] = useState(false);

  // T-20260515-foot-RESV-THERAPIST-HIST: AC-1/2/3 상태
  const [therapistHistory, setTherapistHistory] = useState<TherapistHistoryInfo | null>(null);
  const [therapistHistoryLoading, setTherapistHistoryLoading] = useState(false);
  const [therapistList, setTherapistList] = useState<Staff[]>([]);
  // OVERRIDE-RULE: O-003 — 예약 치료사 수동 배정 (overrideTherapistId)
  // OVERRIDE: Reservations — overrideTherapistId 치료사 수동 배정 추가 적용. 기본 로직 전체 연동.
  const [overrideTherapistId, setOverrideTherapistId] = useState<string | ''>('');

  // T-20260522-foot-RESV-TREAT-HISTORY: AC-1/2/4 상태
  const [treatHistory, setTreatHistory] = useState<TreatHistoryRow[]>([]);
  const [treatHistoryLoading, setTreatHistoryLoading] = useState(false);
  const [treatHistoryShowAll, setTreatHistoryShowAll] = useState(false);

  // T-PROGRESS-CHECKPOINT AC-2/3: 패키지 연결 + 경과분석 상태
  const [linkedPackages, setLinkedPackages] = useState<LinkedPackageOption[]>([]);
  const [linkedPackagesLoading, setLinkedPackagesLoading] = useState(false);
  const [progressPlans, setProgressPlans] = useState<ProgressPlanEntry[]>([]);

  useEffect(() => {
    setState(draft);
    // draft 리셋 시 이력 초기화
    setTherapistHistory(null);
    setOverrideTherapistId('');
    // T-20260522-foot-RESV-TREAT-HISTORY: 시술내역 초기화
    setTreatHistory([]);
    setTreatHistoryShowAll(false);
    // T-PROGRESS-CHECKPOINT: 패키지 초기화
    setLinkedPackages([]);
  }, [draft]);

  // AC-3 FIX: 초진 편집 모달 — referral_source가 없는 구형 예약 대응 fallback
  // openEdit()에서 r.referral_source로 즉시 프리로드하므로, 이 useEffect는
  // visit_route가 아직 빈 경우(구형 예약)에만 customers.visit_route / lead_source 참조
  useEffect(() => {
    if (!draft?.existingId || !draft?.customer_id || draft?.visit_type !== 'new') return;
    // referral_source로 이미 채워진 경우(openEdit FIX 적용 이후) 재fetch 불필요
    if (draft?.visit_route) return;
    supabase
      .from('customers')
      .select('visit_route, referral_name, lead_source')
      .eq('id', draft.customer_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const d = data as { visit_route: string | null; referral_name: string | null; lead_source: string | null };
        // visit_route 우선, 없으면 lead_source fallback (spec: customers.lead_source 참조)
        const routeValue = d.visit_route ?? d.lead_source ?? null;
        if (routeValue) {
          setState((s) => s ? {
            ...s,
            visit_route: routeValue,
            referral_name: d.referral_name ?? s.referral_name ?? '',
          } : s);
        }
      });
  // draft 객체 참조가 바뀔 때만 — existingId/customer_id/visit_type/visit_route 복합 의존
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.existingId, draft?.customer_id, draft?.visit_type, draft?.visit_route]);

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
      // T-20260525-foot-RESV-DESIG-AUTOASSIGN AC-1: designated_therapist_id 병렬 조회
      const [{ data: ciData }, { data: custData }] = await Promise.all([
        supabase
          .from('check_ins')
          .select('id, therapist_id, checked_in_at, treatment_kind, treatment_contents')
          .eq('customer_id', customerId)
          .neq('status', 'cancelled')
          .order('checked_in_at', { ascending: false })
          .limit(20),
        supabase
          .from('customers')
          .select('designated_therapist_id')
          .eq('id', customerId)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      const visits = (ciData ?? []) as Array<{
        id: string;
        therapist_id: string | null;
        checked_in_at: string;
        treatment_kind: string | null;
        treatment_contents: string[] | null;
      }>;
      // T-20260525-foot-RESV-DESIG-AUTOASSIGN AC-1: customers.designated_therapist_id
      const designatedTherapistId =
        (custData as { designated_therapist_id: string | null } | null)?.designated_therapist_id ?? null;

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

      // 5) 치료사 이름 조회 — designatedTherapistId 포함
      const { data: allStaff } = await supabase
        .from('staff')
        .select('id, name')
        .in('id', [primaryTherapistId, lastTherapistId, designatedTherapistId].filter((x): x is string => !!x));

      if (cancelled) return;
      const staffMap = new Map((allStaff ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));

      const info: TherapistHistoryInfo = {
        primaryTherapistId,
        primaryTherapistName: primaryTherapistId ? (staffMap.get(primaryTherapistId) ?? null) : null,
        // T-20260525-foot-RESV-DESIG-AUTOASSIGN AC-1
        designatedTherapistId,
        designatedTherapistName: designatedTherapistId ? (staffMap.get(designatedTherapistId) ?? null) : null,
        lastVisitDate,
        lastTreatmentSummary,
        lastTherapistName: lastTherapistId ? (staffMap.get(lastTherapistId) ?? null) : null,
      };
      setTherapistHistory(info);
      // T-20260525-foot-RESV-DESIG-AUTOASSIGN AC-1: designated_therapist_id 우선, 없으면 최빈 치료사 fallback
      setOverrideTherapistId(designatedTherapistId ?? primaryTherapistId ?? '');
      setTherapistHistoryLoading(false);
    };

    fetchHistory().catch(() => {
      if (!cancelled) setTherapistHistoryLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.customer_id, state?.visit_type, clinicId]);

  // T-20260522-foot-RESV-TREAT-HISTORY: AC-1/2/3/4 — 기존 고객 선택 시 시술내역 조회
  // AC-3: 기존 쿼리/서비스 재사용 (package_sessions + packages 동일 소스)
  useEffect(() => {
    const customerId = state?.customer_id;
    if (!customerId) {
      setTreatHistory([]);
      setTreatHistoryShowAll(false);
      return;
    }

    let cancelled = false;
    setTreatHistoryLoading(true);

    const fetchTreatHistory = async () => {
      // 1) 고객의 패키지 목록 (전체 상태)
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id, package_name, total_sessions')
        .eq('customer_id', customerId)
        .order('contract_date', { ascending: false });

      if (cancelled) return;

      const pkgs = (pkgData ?? []) as { id: string; package_name: string; total_sessions: number }[];
      if (pkgs.length === 0) {
        setTreatHistory([]);
        setTreatHistoryLoading(false);
        return;
      }

      // 2) 회차(시술) 이력 조회 — session_date 내림차순 (AC-2)
      // T-20260524-foot-RESV-TREAT-REFORMAT AC-2: performed_by + staff:performed_by(name) JOIN 추가
      const pkgIds = pkgs.map((p) => p.id);
      const pkgMap = new Map(pkgs.map((p) => [p.id, p]));

      const { data: sessData } = await supabase
        .from('package_sessions')
        .select('id, package_id, session_number, session_type, session_date, performed_by, staff:performed_by(name)')
        .in('package_id', pkgIds)
        // T-20260612-foot-USAGEHIST-DELETE-RESTORE: soft-delete(status='deleted') 회차는 시술이력 표시에서 제외.
        // (이 표시 쿼리는 status 필터가 없어 soft-delete 도입 후 삭제 회차가 정상 시술처럼 새어들 수 있음 → 명시 제외)
        .neq('status', 'deleted')
        .not('session_date', 'is', null)
        .order('session_date', { ascending: false })
        .limit(200);

      if (cancelled) return;

      const rows: TreatHistoryRow[] = (sessData ?? []).map((s: Record<string, unknown>) => {
        const pkg = pkgMap.get(s.package_id as string);
        // AC-2: staff JOIN 결과에서 치료사명 추출 (단일 객체)
        const staffObj = s.staff as { name: string } | null;
        const therapistName = staffObj?.name ?? '—';
        return {
          session_id: s.id as string,
          package_name: pkg?.package_name ?? '—',
          session_number: s.session_number as number,
          total_sessions: pkg?.total_sessions ?? 0,
          session_type: (s.session_type as string) || '—',
          therapist_name: therapistName, // AC-1: 치료사명
          session_date: s.session_date as string,
        };
      });

      setTreatHistory(rows);
      setTreatHistoryLoading(false);
    };

    fetchTreatHistory().catch(() => {
      if (!cancelled) setTreatHistoryLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.customer_id]);

  // T-PROGRESS-CHECKPOINT AC-2: 고객의 활성 패키지 로드 (customer_id 변경 시)
  useEffect(() => {
    const customerId = state?.customer_id;
    if (!customerId || !clinicId) {
      setLinkedPackages([]);
      return;
    }

    let cancelled = false;
    setLinkedPackagesLoading(true);

    const fetchPackages = async () => {
      // 활성 패키지 목록
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id, package_name, package_type, total_sessions')
        .eq('customer_id', customerId)
        .eq('clinic_id', clinicId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (!pkgData || pkgData.length === 0) {
        setLinkedPackages([]);
        setLinkedPackagesLoading(false);
        return;
      }

      // 각 패키지의 사용 회차 카운트
      const pkgIds = (pkgData as { id: string }[]).map(p => p.id);
      const { data: sessData } = await supabase
        .from('package_sessions')
        .select('package_id')
        .in('package_id', pkgIds)
        .eq('status', 'used');

      if (cancelled) return;

      const usedMap = new Map<string, number>();
      for (const s of (sessData ?? []) as { package_id: string }[]) {
        usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
      }

      const options: LinkedPackageOption[] = (pkgData as {
        id: string; package_name: string; package_type: string; total_sessions: number;
      }[]).map(p => ({
        id: p.id,
        package_name: p.package_name,
        package_type: p.package_type,
        total_sessions: p.total_sessions,
        used_sessions: usedMap.get(p.id) ?? 0,
      }));

      setLinkedPackages(options);
      setLinkedPackagesLoading(false);
    };

    fetchPackages().catch(() => {
      if (!cancelled) setLinkedPackagesLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.customer_id, clinicId]);

  // T-PROGRESS-CHECKPOINT AC-3: 경과분석 플랜 로드 (clinicId 설정 시 1회)
  useEffect(() => {
    if (!clinicId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('package_progress_plans')
      .select('session_count_tier, session_milestone, label, is_active')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .then(({ data }: { data: ProgressPlanEntry[] | null }) => {
        setProgressPlans((data ?? []) as ProgressPlanEntry[]);
      });
  }, [clinicId]);

  if (!state) return null;

  const update = <K extends keyof ReservationDraft>(k: K, v: ReservationDraft[K]) =>
    setState((s) => (s ? { ...s, [k]: v } : s));

  // T-PROGRESS-CHECKPOINT AC-2/3: 경과분석 파생 계산
  // T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND: 매칭을 회차 tier(total_sessions) 기준으로 교체.
  //   - 이름/FK 무관, 회차수(total_sessions)가 6의배수 tier에 걸리면 해당 milestone 발동.
  //   - total_sessions=0(체험/Re:Born 등) = 경과분석 제외 가드 (tier 0은 시드에 없지만 명시 배제).
  const selectedLinkedPkg = linkedPackages.find(p => p.id === state.linked_package_id);
  const anticipatedSession = selectedLinkedPkg ? selectedLinkedPkg.used_sessions + 1 : null;
  const progressCheckPlan = (anticipatedSession && selectedLinkedPkg && selectedLinkedPkg.total_sessions > 0)
    ? progressPlans.find(
        p => p.session_count_tier === selectedLinkedPkg.total_sessions
          && p.session_milestone === anticipatedSession
          && p.is_active,
      ) ?? null
    : null;

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

    // ─── 수정(UPDATE) 경로 — 인라인 유지(신규 생성경로와 분리, 회귀 0) ───────────────
    //   T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: 신규(INSERT) 경로만 단일소스 함수로 추출.
    //   수정 경로는 예약 변경/감사 로그(reschedule·update) 시맨틱이 달라 기존 인라인 그대로 보존.
    if (state.existingId) {
      const customerId: string | null = state.customer_id ?? null;

      // 초진 방문경로 → customers 동기 (편집 시에도 유지)
      if (customerId && state.visit_type === 'new' && state.visit_route) {
        const customerUpdate: Record<string, string | null> = {
          visit_route: state.visit_route,
          lead_source: state.visit_route,
        };
        if (state.visit_route === '지인소개') {
          customerUpdate.referral_name = state.referral_name?.trim() || null;
        }
        await supabase.from('customers').update(customerUpdate).eq('id', customerId);
      }

      const payload = {
        clinic_id: clinicId,
        customer_id: customerId,
        customer_name: state.name.trim(),
        customer_phone: (normalizeToE164(state.phone) ?? state.phone.trim()) || null,
        reservation_date: state.date,
        reservation_time: state.time,
        visit_type: state.visit_type,
        service_id: state.service_id || null,
        memo: state.memo.trim() || null,
        booking_memo: state.booking_memo?.trim() || null,
        // T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 힐러 의도(영속) — 수정 시에도 토글 반영.
        is_healer_intent: state.is_healer_intent ?? false,
        referral_source: (state.visit_type === 'new' && state.visit_route) ? state.visit_route : null,
        // T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI (AC2): 예약 수정(일자 변경 포함) → 담당자=마지막 수정 계정 overwrite.
        updated_by: changedBy,
        ...(state.visit_type === 'returning' ? { preferred_therapist_id: overrideTherapistId || null } : {}),
      };

      // 수정 전 원본 캡처 (감사 로그용)
      const { data: prev } = await supabase
        .from('reservations')
        .select('reservation_date, reservation_time, visit_type, customer_name, customer_phone, service_id, memo')
        .eq('id', state.existingId)
        .maybeSingle();
      const prevRow = (prev as Record<string, unknown>) ?? null;

      let result = await supabase
        .from('reservations')
        .update(payload)
        .eq('id', state.existingId)
        .select('id')
        .maybeSingle();
      // T-20260615-foot-RESVPOPUP-3BUG AC2: is_healer_intent 컬럼 미반영(PGRST204/42703) 시 제외 후 1회 재시도.
      if (result.error && isHealerIntentColMissing(result.error)) {
        const { is_healer_intent: _omit, ...payloadNoHealer } = payload as typeof payload & { is_healer_intent?: boolean };
        void _omit;
        result = await supabase
          .from('reservations')
          .update(payloadNoHealer)
          .eq('id', state.existingId)
          .select('id')
          .maybeSingle();
      }

      if (result.error) {
        toast.error(`저장 실패: ${result.error.message}`);
        setSubmitting(false);
        return;
      }
      // T-20260529-foot-RESV-TIME-EDIT-NOSYNC AC-1: UPDATE silent failure 감지 (RLS 0-row block)
      if (!result.data) {
        toast.error('예약 변경이 적용되지 않았습니다. 권한 또는 연결 상태를 확인해 주세요.');
        setSubmitting(false);
        onSaved();
        return;
      }

      const savedId = (result.data as { id: string }).id;
      if (prevRow) {
        const oldTime = String(prevRow.reservation_time ?? '').slice(0, 5);
        const newTime = state.time.slice(0, 5);
        const isReschedule = prevRow.reservation_date !== state.date || oldTime !== newTime;
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
      }

      if (state.booking_memo?.trim()) {
        await insertReservationMemo(savedId, clinicId, state.booking_memo.trim(), authorName);
      }
      // 재진 치료사 역동기화 (편집 시에도 유지)
      if (state.visit_type === 'returning' && overrideTherapistId && customerId) {
        await supabase
          .from('customers')
          .update({ designated_therapist_id: overrideTherapistId })
          .eq('id', customerId);
      }

      toast.success('수정됨');
      setSubmitting(false);
      onSaved();
      return;
    }

    // ─── 신규(CREATE) 경로 — 고객 resolve 후 단일소스 함수 위임 ─────────────────────
    //   고객 INSERT(전화→신규고객)는 여기서 resolve. 그 외 생성 무결성 5요소는 전부 함수 내부.
    let customerId: string | null = state.customer_id ?? null;

    if (!customerId && state.phone.trim()) {
      const normalizedCreatePhone = normalizeToE164(state.phone) ?? state.phone.trim();
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('phone', normalizedCreatePhone)
        .maybeSingle();
      if (existing) customerId = existing.id as string;
      else {
        const { data: created, error } = await supabase
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: state.name.trim(),
            phone: normalizedCreatePhone,
            visit_type: state.visit_type === 'new' ? 'new' : 'returning',
          })
          .select('id')
          .single();
        if (error) {
          // T-20260615-foot-RESVMGMT-REFIX-8 AC3-b GUARD parity (MSG-20260615-155718):
          //   customers (clinic_id, phone) FULL UNIQUE — 23505 시 에러로 막지 말고 기존 고객 재-resolve 해 재사용.
          if (error.code === '23505') {
            const { data: conflictHit } = await supabase
              .from('customers')
              .select('id')
              .eq('clinic_id', clinicId)
              .eq('phone', normalizedCreatePhone)
              .maybeSingle();
            if (conflictHit) {
              customerId = conflictHit.id as string;
            } else {
              toast.error('이미 등록된 전화번호입니다');
              setSubmitting(false);
              return;
            }
          } else {
            toast.error(`고객 생성 실패: ${error.message}`);
            setSubmitting(false);
            return;
          }
        } else {
          customerId = (created as { id: string }).id;
        }
      }
    }

    const progressCheck = state.linked_package_id
      ? { required: !!progressCheckPlan, label: progressCheckPlan?.label ?? null }
      : null;

    const res = await createReservationCanonical({
      clinicId,
      customerId,
      name: state.name,
      phone: state.phone,
      date: state.date,
      time: state.time,
      visit_type: state.visit_type,
      service_id: state.service_id,
      memo: state.memo,
      booking_memo: state.booking_memo,
      visit_route: state.visit_route,
      referral_name: state.referral_name,
      linked_package_id: state.linked_package_id,
      preferred_therapist_id: state.visit_type === 'returning' ? (overrideTherapistId || null) : null,
      is_healer_intent: state.is_healer_intent ?? false,
      progressCheck,
      maxPerSlot,
      changedBy,
      authorName,
      onDuplicateConfirm: (msg) => window.confirm(msg),
    });

    if (!res.ok) {
      if (res.reason === 'slot_full') toast.error(res.message ?? '이 시간대는 마감입니다');
      else if (res.reason === 'error') toast.error(`저장 실패: ${res.message ?? ''}`);
      // duplicate_cancelled → 사용자가 취소 선택, 조용히 종료
      setSubmitting(false);
      return;
    }

    // T-PROGRESS-CHECKPOINT AC-3: 경과분석 필요 토스트 알림
    if (progressCheckPlan) {
      toast.info(`🔔 경과분석 필요 — ${progressCheckPlan.label}`, { duration: 6000 });
    }
    toast.success('예약 등록');
    setSubmitting(false);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.existingId ? '예약 수정' : '예약 등록'}
            {!state.existingId && ` · ${state.date} ${state.time}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* AC-1: 날짜/시간 변경 — 수정 모달에서만 표시 */}
          {state.existingId && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>날짜</Label>
                <input
                  type="date"
                  value={state.date}
                  onChange={(e) => update('date', e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label>시간</Label>
                <select
                  value={state.time}
                  onChange={(e) => update('time', e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {EDIT_TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* AC-2/2b: 고객정보 — 수정 모달은 읽기 전용, 신규 예약은 InlinePatientSearch 유지 */}
          {state.existingId ? (
            /* AC-2: 수정 모달 — 고객정보 편집폼 제거, 이름·전화 읽기 표시만 유지 */
            <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm space-y-0.5">
              <div className="font-medium">{state.name || '(이름 없음)'}</div>
              {state.phone && (
                <div className="text-muted-foreground text-xs">{formatPhone(state.phone)}</div>
              )}
            </div>
          ) : (
            /* AC-2b: 신규 예약 — 기존 InlinePatientSearch 유지 */
            <>
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
            </>
          )}
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
          {/* T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 힐러 예약 ON/OFF 토글.
              ON 시 is_healer_intent(영속) 저장 → 캘린더 'HL N' 칩 / resvKind 가 체크인 후에도 힐러로 분류. */}
          <div className="space-y-1.5">
            <Label>힐러 예약</Label>
            <div className="grid grid-cols-2 gap-2">
              {([['off', false, 'OFF'], ['on', true, 'ON']] as [string, boolean, string][]).map(([key, val, label]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`healer-intent-${key}`}
                  aria-pressed={(state.is_healer_intent ?? false) === val}
                  onClick={() => update('is_healer_intent', val)}
                  className={cn(
                    'h-9 rounded-md border text-sm font-medium',
                    (state.is_healer_intent ?? false) === val
                      ? (val
                          ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                          : 'border-teal-600 bg-teal-50 text-teal-700')
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {label}
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
                  {/* T-20260525-foot-RESV-DESIG-AUTOASSIGN AC-1: designated_therapist_id 우선 표시 */}
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    {therapistHistory?.designatedTherapistName ? (
                      <>
                        <span className="font-medium text-emerald-800">지정 치료사</span>
                        <span className="text-emerald-700">{therapistHistory.designatedTherapistName}</span>
                      </>
                    ) : therapistHistory?.primaryTherapistName ? (
                      <>
                        <span className="font-medium text-emerald-800">담당 치료사</span>
                        <span className="text-emerald-700">
                          {therapistHistory.primaryTherapistName}
                          {therapistHistory.lastVisitDate && (
                            <span className="text-muted-foreground ml-1">(최근: {therapistHistory.lastVisitDate})</span>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-emerald-800">담당 치료사</span>
                        <span className="text-amber-600">미배정</span>
                      </>
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

          {/* T-20260522-foot-RESV-TREAT-HISTORY: AC-1 기존 고객 선택 시 시술내역 표시 */}
          {/* AC-1: customer_id 존재(기존 고객) 시만 표시 — 신규 등록(customer_id=null) 시 미표시 */}
          {state.customer_id && (
            <div
              data-testid="treat-history-panel"
              className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-xs space-y-1.5"
            >
              <div className="font-medium text-teal-700">시술내역</div>
              {treatHistoryLoading ? (
                /* AC-4: 로딩 스피너 */
                <div
                  data-testid="treat-history-loading"
                  className="flex items-center gap-1.5 text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>이력 조회 중…</span>
                </div>
              ) : treatHistory.length === 0 ? (
                /* AC-4: 이력 없음 안내 */
                <div
                  data-testid="treat-history-empty"
                  className="text-muted-foreground italic"
                >
                  시술 이력이 없습니다
                </div>
              ) : (
                <>
                  {/* T-20260524-foot-RESV-TREAT-REFORMAT AC-1: 5컬럼 헤더 — 패키지명/회차/치료명/치료사/시술일 */}
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] gap-1 text-[10px] font-semibold text-muted-foreground pb-0.5 border-b border-teal-100">
                    <span>패키지명</span>
                    <span>회차</span>
                    <span>치료명</span>
                    <span>치료사</span>
                    <span>시술일</span>
                  </div>
                  {/* T-20260522-foot-RESV-TREAT-UX AC-1: 최신 1건만 기본 표시 + 더보기 */}
                  {(treatHistoryShowAll ? treatHistory : treatHistory.slice(0, 1)).map((row) => (
                    <div
                      key={row.session_id}
                      data-testid={`treat-history-row-${row.session_id}`}
                      className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] gap-1 items-start"
                    >
                      <span className="truncate" title={row.package_name}>{row.package_name}</span>
                      {/* AC-5: 회차 빨간색+굵게 유지 */}
                      <span className="tabular-nums text-red-600 font-bold">{row.session_number}/{row.total_sessions}</span>
                      {/* AC-5: 치료명 한글 매핑 유지 */}
                      <span className="truncate" title={row.session_type}>{TREAT_KO[row.session_type] ?? (row.session_type || '—')}</span>
                      {/* AC-1: 치료사 컬럼 (없으면 — fallback) */}
                      <span className="truncate text-muted-foreground" title={row.therapist_name}>{row.therapist_name}</span>
                      <span className="tabular-nums text-muted-foreground">{row.session_date}</span>
                    </div>
                  ))}
                  {!treatHistoryShowAll && treatHistory.length > 1 && (
                    <button
                      type="button"
                      data-testid="treat-history-show-more"
                      onClick={() => setTreatHistoryShowAll(true)}
                      className="text-[10px] text-teal-600 hover:underline mt-0.5"
                    >
                      더보기 ({treatHistory.length - 1}건 더)
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* T-PROGRESS-CHECKPOINT AC-2/3: 패키지 연결 + 경과분석 배너 (기존 고객 + 신규 예약만) */}
          {state.customer_id && !state.existingId && (
            <div className="space-y-2" data-testid="progress-pkg-section">
              <div className="space-y-1.5">
                <Label>
                  패키지 연결{' '}
                  <span className="text-muted-foreground font-normal text-xs">(선택 — 경과분석 자동 감지)</span>
                </Label>
                {linkedPackagesLoading ? (
                  <div className="flex items-center gap-1.5 h-9 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    패키지 조회 중…
                  </div>
                ) : linkedPackages.length === 0 ? (
                  <div className="h-9 flex items-center px-3 rounded-md border border-dashed border-muted-foreground/30 text-xs text-muted-foreground">
                    활성 패키지 없음
                  </div>
                ) : (
                  <select
                    value={state.linked_package_id ?? ''}
                    onChange={(e) => update('linked_package_id', e.target.value || null)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="linked-package-select"
                  >
                    <option value="">— 연결 안 함 —</option>
                    {linkedPackages.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.package_name} ({p.used_sessions}/{p.total_sessions}회 진행)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 예상 회차 표시 */}
              {anticipatedSession && selectedLinkedPkg && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                  <span>예상 회차</span>
                  <span className="font-mono font-bold text-teal-700">{anticipatedSession}회</span>
                  <span className="text-muted-foreground">(완료 {selectedLinkedPkg.used_sessions}회 + 1)</span>
                </div>
              )}

              {/* 경과분석 감지 배너 */}
              {progressCheckPlan && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-teal-400 bg-teal-50 px-3 py-2.5 text-xs"
                  data-testid="progress-check-banner"
                >
                  <TrendingUp className="h-4 w-4 text-teal-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-teal-800">
                      🔔 경과분석 필요 — {progressCheckPlan.label}
                    </p>
                    <p className="text-teal-600 mt-0.5">
                      이 예약은 경과분석 대상입니다. 진료 차트에 경과분석지를 준비해 주세요.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AC-4: [서비스] 필드 제거 (DB 컬럼은 유지, UI 비노출) */}
          {/* T-20260612-foot-RESV-ROUTE-AUTOCLASS: 등록자 선택 드롭다운 — 방문경로 위에 우선 배치.
              선택값 → 방문경로 대분류 자동 고정 (데스크→인바운드 / TM팀→TM[대분류 '티엠']).
              GUARD: 신규등록 form(Reservations.tsx)에만. 예약상세팝업 미변경. enum 신설 금지(VISIT_ROUTE_OPTIONS 재사용). */}
          {state.visit_type === 'new' && (
            <div className="space-y-1.5">
              <Label>등록자 선택 <span className="text-muted-foreground font-normal text-xs">(선택 시 방문경로 자동 분류)</span></Label>
              <select
                value={state.registrar_type ?? ''}
                onChange={(e) => {
                  const rt = e.target.value;
                  // 등록자 유형 → 방문경로 대분류 자동 고정 (단일 setState로 동기 세팅 → race 방지)
                  const autoRoute = rt === 'desk' ? '인바운드' : rt === 'tm' ? 'TM' : null;
                  setState((s) =>
                    s ? { ...s, registrar_type: rt, ...(autoRoute !== null ? { visit_route: autoRoute } : {}) } : s
                  );
                }}
                data-testid="registrar-type-select"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— 선택 안 함 —</option>
                <option value="desk">데스크 직원 직접 등록</option>
                <option value="tm">TM팀 등록</option>
              </select>
            </div>
          )}
          {/* AC-5: 방문경로 드롭다운 — 초진만 표시, 재진 미표시 */}
          {state.visit_type === 'new' && (
            <div className="space-y-1.5">
              <Label>방문경로 <span className="text-muted-foreground font-normal text-xs">(선택)</span></Label>
              <select
                value={state.visit_route ?? ''}
                onChange={(e) => update('visit_route', e.target.value)}
                data-testid="visit-route-select"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— 선택 안 함 —</option>
                {/* T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 방문경로 옵션 SSOT 재사용.
                    W2-DB(item8): 신규 5종(TM/네이버/인콜/워크인/지인소개) + legacy 인바운드 현재값 보존. */}
                {visitRouteOptionsFor(state.visit_route).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          )}
          {/* T-20260515-foot-REFERRAL-NAME: 지인소개 시 소개자 성함 입력칸 */}
          {state.visit_type === 'new' && state.visit_route === '지인소개' && (
            <div className="space-y-1.5">
              <Label>소개자 성함 <span className="text-muted-foreground font-normal text-xs">(선택)</span></Label>
              <input
                type="text"
                value={state.referral_name ?? ''}
                onChange={(e) => update('referral_name', e.target.value)}
                placeholder="예: 홍길동"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
          {/* AC-4: 예약메모 — 수정 모달은 ReservationMemoTimeline(append-only), 신규는 단순 Textarea */}
          <div className="space-y-1.5">
            {state.existingId ? (
              <>
                <Label>예약메모 히스토리</Label>
                <ReservationMemoTimeline
                  reservationId={state.existingId}
                  clinicId={clinicId ?? ''}
                  authorName={authorName}
                />
              </>
            ) : (
              <>
                <Label>예약메모 추가 <span className="text-muted-foreground font-normal text-xs">(저장 시 기록에 누적됨)</span></Label>
                <Textarea
                  value={state.booking_memo ?? ''}
                  onChange={(e) => update('booking_memo', e.target.value)}
                  rows={2}
                  placeholder="예: 인스타그램 광고, 지인 소개, 힐러 지정 등"
                  className="text-sm"
                />
              </>
            )}
          </div>
        </div>
        {/* T-20260610-foot-RESV-OVERHAUL-7 AC-6/AC-7: 예약상세(수정) 모달 푸터 버튼 — 상태별 3버튼 */}
        {/*   정상(confirmed): [저장][예약취소][예약삭제] / 취소(cancelled): [예약복원][저장][예약삭제] */}
        {/*   신규 등록(existingId 없음): 기존 [취소][저장] 유지 */}
        <DialogFooter className="flex-wrap gap-2">
          {!state.existingId ? (
            <>
              <Button variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button disabled={submitting || !state.name.trim()} onClick={save}>
                {submitting ? '저장 중…' : '저장'}
              </Button>
            </>
          ) : state.status === 'cancelled' ? (
            <>
              <Button
                variant="outline"
                data-testid="resv-edit-restore-btn"
                disabled={submitting}
                onClick={() => state.existingId && onRestoreReservation?.(state.existingId)}
              >
                예약복원
              </Button>
              <Button disabled={submitting || !state.name.trim()} onClick={save}>
                {submitting ? '저장 중…' : '저장'}
              </Button>
              <Button
                variant="destructive"
                data-testid="resv-edit-delete-btn"
                disabled={submitting}
                onClick={() => state.existingId && onDeleteReservation?.(state.existingId)}
              >
                예약삭제
              </Button>
            </>
          ) : (
            <>
              <Button disabled={submitting || !state.name.trim()} onClick={save}>
                {submitting ? '저장 중…' : '저장'}
              </Button>
              <Button
                variant="outline"
                data-testid="resv-edit-cancel-btn"
                disabled={submitting}
                onClick={() => state.existingId && onCancelReservation?.(state.existingId)}
              >
                예약취소
              </Button>
              <Button
                variant="destructive"
                data-testid="resv-edit-delete-btn"
                disabled={submitting}
                onClick={() => state.existingId && onDeleteReservation?.(state.existingId)}
              >
                예약삭제
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

