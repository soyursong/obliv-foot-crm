// T-20260516-foot-RESV-DETAIL-POPUP: 예약 상세 팝업 4분할 레이아웃
// 환자 클릭 시 2열 × 2행 = 4분할 모달
// 좌상: 환자정보 8필드 | 우상: 선택 예약 상세
// 좌하: 전체 예약 히스토리 | 우하: 메모 2종
// T-20260611-foot-CHECKIN-XFER-OLDFORM-REMOVE: 초진 [체크인 전환] 구 정보입력 폼(주민번호+건보동의서) 제거
//   → 초진도 재진처럼 폼 없이 바로 doCheckIn. 주민번호/동의서 수집은 펜차트로 일원화(정책: RRN-FIELD-REMOVE/CHECKIN-CONSENT-REMOVE).

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
// T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: new-mode 시간 선택지(기존 schedule 슬롯 생성기 재사용, 신규 로직 0)
import { generateSlots } from '@/lib/schedule';
import { VISIT_TYPE_KO } from '@/lib/status';
import { formatPhone, formatPhoneInput, chartNoBadge, birthDateYMD } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ReservationMemoTimeline } from '@/components/ReservationMemoTimeline';
// T-20260522-foot-RESV-HISTORY-SYNC AC-2/3: 예약 변경 이력 공유 패널
import { ReservationAuditLogPanel } from '@/components/ReservationAuditLogPanel';
// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-1: 고객 검색창 (기존 인라인 검색 재사용, 신규 PII 경로 금지)
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-3: 2번구역 미니 캘린더 (기존 month-grid 패턴 재사용)
import { MiniMonthCalendar } from '@/components/MiniMonthCalendar';
// T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC1: 미니캘린더 날짜클릭 → 시간대별 예약현황 패널(read-only)
import { ReservationDayTimeslotPanel } from '@/components/ReservationDayTimeslotPanel';
// T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC5: 활성패키지/치료내역 = 2번차트 패키지탭 양식(read-only) 재사용
import { PackageTicketReadonlyList, type PackageSessionRow } from '@/components/PackageTicketReadonlyList';
import type { Customer, Package, Reservation, ReservationRegistrar, Staff } from '@/lib/types';
import { VISIT_ROUTE_OPTIONS, visitRouteOptionsFor, resolveVisitRouteDisplay } from '@/lib/types';

// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-2: check_ins 재진판정용 타입.
//   신규 테이블/컬럼 없음(기존 check_ins 컬럼 재사용).
//   T-20260619-RESVPOPUP-DETAIL-REVERIFY-4FIX AC3(orphan 데드코드 정리): 독립 치료내역 섹션 제거 후
//   유일 소비처는 getVisitTypeDisplay 의 hasPriorVisit(L684) 뿐 → checked_in_at 1개만 참조한다.
//   completed_at·visit_type·treatment_category·treatment_contents·treatment_kind·therapist_id 는
//   섹션 제거로 어디서도 쓰이지 않는 orphan → 타입·select 에서 제거(over-fetch 차단, read-only·스키마 무변경).
type TreatmentRow = {
  id: string;
  checked_in_at: string;
};

const STATUS_LABEL: Record<Reservation['status'], string> = {
  confirmed: '예약',
  checked_in: '체크인',
  cancelled: '취소',
  no_show: '노쇼',
};

const VISIT_TYPE_BADGE_CLASS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  // T-20260625-foot-COLOR-CONVENTION-UNIFY (총괄 A안): 재진 = 초록(firstvisit 토큰). sage(그레이)→A안 초록 통일.
  returning: 'bg-firstvisit-100 text-firstvisit-700',
  experience: 'bg-amber-100 text-amber-700',
};

const GENDER_KO: Record<string, string> = { M: '남', F: '여' };

// T-20260614-foot-RESVPOPUP-RRN-NOBIND: 예약상세 1번구역 '주민번호' 마스킹 표시.
//   PHI 가드: 평문 rrn 미수신. 서버파생 생년월일(fn_customer_birthdates → YYYY-MM-DD)과
//   성별(M/F)만으로 마스킹 표기(YYMMDD-G******)를 구성한다. 성별 다음 6자리는 항상 마스킹,
//   신규 복호/노출 경로 없음(AC-3). 성별코드 G = 세기(생년)·성별 파생(내국인 기준):
//   1900s 남1/여2, 2000s 남3/여4, 1800s 남9/여0. 세기·성별은 화면에 이미 노출되는 비민감 정보.
function maskRrnDisplay(
  birthYmd: string | null | undefined,
  gender: 'M' | 'F' | null | undefined,
): string {
  if (!birthYmd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthYmd);
  if (!m) return '';
  const year = parseInt(m[1], 10);
  const front = `${m[1].slice(2)}${m[2]}${m[3]}`; // YYMMDD
  const century = Math.floor(year / 100); // 18 | 19 | 20
  let g = '*';
  if (gender === 'M') {
    g = century === 20 ? '3' : century === 18 ? '9' : '1';
  } else if (gender === 'F') {
    g = century === 20 ? '4' : century === 18 ? '0' : '2';
  }
  return `${front}-${g}******`;
}

// T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: new-mode 시간 선택지 (07:00~22:00, 30분 — editor EDIT_TIME_SLOTS 동일 규칙)
const NEW_RESV_TIME_SLOTS = generateSlots('07:00', '22:00', 30);

// new-mode 생성 콜백 파라미터 (parent = 단일소스 createReservationCanonical 위임)
// T-20260615-foot-RESVMGMT-REFIX-8 AC3-b: 시스템에 없는 완전 신규 고객 등록 허용 → customerId 가 null 일 수 있음.
//   이때 parent 가 phone(E.164 정규화)으로 기존고객 resolve 또는 신규 customers INSERT 후 단일소스 함수 위임.
//   고객 INSERT 책임은 parent(호출측) — 팝업 내 customers/reservations.insert = 0 유지(🔒 L-002·기존 계약 §137).
type CreateReservationParams = {
  customerId: string | null;
  name: string;
  phone: string | null;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  visit_type: 'new' | 'returning';
  // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: 신규 예약 생성 시 예약경로/예약등록자 영속.
  //   컬럼(reservations.visit_route / registrar_id)·마스터(reservation_registrars)는 기존(REGISTRAR-ROUTE-FIELDS deployed) — 신규 스키마 0.
  visit_route?: string | null;
  registrar_id?: string | null;
  // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE: 예약등록자 표시 스냅샷(registrar_name).
  //   편집경로(saveRouteAndRegistrar)는 이미 스냅샷을 쓰는데 생성경로는 registrar_id 만 써서 @태그/'내 예약'
  //   필터(registrar_name 기준)에 신규 예약이 안 잡히던 갭 보강 — default 선택값이 실제로 반영되도록 함께 영속.
  registrar_name?: string | null;
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모(brief_note) + 예약메모(booking_memo).
  brief_note?: string | null;
  booking_memo?: string | null;
  // T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX (김주연 총괄): 간략메모 [힐러] 칩 선택 시 힐러 의도 영속.
  //   ⚠ brief_note(텍스트)와 직교한 플래그 — is_healer_intent(영속 컬럼, T-20260614 HEALER-RESV-CLASSIFY-DEF)
  //   write-path(createReservationCanonical, 5699b54) 재사용. 신규 컬럼/저장경로 0(DB 무변경). 캘린더 resvKind→노란박스(#FFFDE7).
  is_healer_intent?: boolean | null;
};

// T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 초진 간략메모 빠른선택 칩(발톱무좀/내성발톱) + 직접입력.
// T-20260629-foot-NEWRESV-UNIFIED-MODAL AC6(항목10 amendment): 간략메모 3종으로 확장 — 발각질케어 추가.
const BRIEF_NOTE_QUICK = ['발톱무좀', '내성발톱', '발각질케어'] as const;

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────

export function ReservationDetailPopup({
  reservation,
  noshowCount,
  changedBy,
  authorName,
  isAdmin,
  currentUserRole,
  onClose,
  onEdit,
  onChanged,
  onCreateReservation,
  newMode = false,
  clinicId = null,
  initialDate = null,
  initialTime = null,
  initialCustomer = null,
}: {
  reservation: Reservation | null;
  noshowCount: number;
  changedBy: string | null;
  authorName: string;
  isAdmin?: boolean;
  // T-20260630-foot-RESVPOPUP-TM-REGISTRAR-LOCK: 로그인 계정 role. role==='tm'이면 예약등록자(registrar)
  //   드롭다운 read-only(disabled) + 저장 시 registrar_id/registrar_name 변경 차단(통계 상담사 귀속 오염 방지).
  //   admin/manager/consultant 등 타 역할은 기존대로 편집 가능(AC-3 회귀 게이트).
  currentUserRole?: string;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
  onChanged: () => void;
  // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (AC2 시나리오1): (+) 새 예약 → 기존 예약(anchor) 없이
  //   팝업을 new-mode 로 오픈. reservation === null 이어도 검색→날짜→시간→초/재→생성 폼만 렌더(메인 렌더 불변).
  //   🔒 L-002: 팝업 내 reservations.insert = 0 — 생성은 onCreateReservation(parent 단일소스 함수) 위임.
  newMode?: boolean;
  // new-mode 는 anchor 예약이 없어 clinic_id 를 reservation 에서 못 얻음 → parent(useClinic) 가 직접 주입.
  clinicId?: string | null;
  // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (현장 확정 "A 등록 → B 검색 → 신규예약", 옵션A · L-002 개정):
  //   1번구역 검색으로 B고객 로드 → '팝업 안에서' new-mode(날짜·시간·초/재·생성버튼) 완결(모달 스폰 폐기).
  //   🔒 L-002(개정): 팝업은 이 parent 콜백만 호출 — 팝업 내 reservations.insert = 0. 생성 무결성 5요소는
  //   parent 의 단일소스 createReservationCanonical 내부에 보존. 미전달 시 검색창/new-mode 숨겨 graceful degrade.
  onCreateReservation?: (params: CreateReservationParams) => Promise<{ ok: boolean; reason?: string; message?: string }>;
  // T-20260615-foot-RESVMGMT-REFIX-8 AC3 (planner GO · 🔒L-002/L-004 준수): 캘린더 빈슬롯 (+) → new-mode 진입 시
  //   클릭한 슬롯의 날짜·시간 prefill. 상단 '새 예약' 버튼은 미전달(null) → 빈 진입(기존 동작 불변).
  //   생성 capability·affordance 는 팝업 new-mode 폼이 그대로 보존 — 진입 '배선'만 통일(구 ReservationEditor 스폰 폐기).
  initialDate?: string | null;   // 'yyyy-MM-dd'
  initialTime?: string | null;   // 'HH:mm'
  // T-20260630-foot-RESV-CUSTCTX-PREFILL: 고객 컨텍스트로 진입(동선1 대시보드 고객박스 우클릭 / 동선2 2번차트 [다음예약]) →
  //   new-mode 슬롯클릭 폼 오픈 시 이 고객을 자동 prefill(재진). null = 일반 빈 진입(회귀 0). parent 가 customers 조회로 enrich 한
  //   완전한 PatientMatch 를 전달 → 팝업은 handleSelectOtherCustomer 와 동일 경로로 1번구역(고객정보·패키지·치료내역)까지 자동 로드.
  initialCustomer?: PatientMatch | null;
}) {
  // ── 액션 상태
  const [busy, setBusy] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // ── 2구역 데이터
  const [customer, setCustomer] = useState<Customer | null>(null);
  // T-20260614-foot-RESVPOPUP-RRN-NOBIND: 주민번호 마스킹 표시용 서버파생 생년월일(YYYY-MM-DD).
  //   PHI: 평문 rrn 미수신 — fn_customer_birthdates RPC가 birth_date_display만 반환(기존 자산 재사용).
  const [birthDisplay, setBirthDisplay] = useState<string | null>(null);
  const [allResvs, setAllResvs] = useState<Reservation[]>([]);
  // T-20260611-foot-RESVPOPUP-2ZONE: 클리닉 전체 활성 staff (담당상담사 드롭다운 + 치료사 이름 resolve).
  //   기존 consultant-만-로드 → 전체 로드로 확장: assigned_staff_id 가 role!=consultant 직원이어도
  //   이름 resolve 가능(처리로그 17:04 '담당상담사 raw UUID 표시' 부수 개선).
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  // T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC5: 패키지 시술내역(차감기록) — 2번차트 양식 표시용 read-only
  const [packageSessions, setPackageSessions] = useState<PackageSessionRow[]>([]);
  // T-20260611-foot-RESVPOPUP-2ZONE AC-2: check_ins 내원 이력 — T-20260619-REVERIFY-4FIX AC3 이후
  //   독립 치료내역 섹션은 제거됐고, 이 state 는 재진 판정(hasPriorVisit)에서만 사용한다.
  const [treatments, setTreatments] = useState<TreatmentRow[]>([]);

  // T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC1: 팝업 내 다른 고객 불러오기(B) — 1번구역만 교체, 팝업 닫지 않음.
  //   loadedMatch 가 set 이면 1번구역(고객정보/패키지/치료내역/메모)이 B 로 교체된 '신규예약 대상' 상태.
  //   ⚠ 저장 컨텍스트 안전분리: B 로딩 중에는 footer 의 현재예약(A) 액션(저장/체크인/취소/노쇼/삭제) 숨김 →
  //      엉뚱한 예약/고객에 저장 0. 신규예약 생성은 onCreateReservation(parent 단일소스 함수) 위임(L-002 보존).
  const [loadedMatch, setLoadedMatch] = useState<PatientMatch | null>(null);

  // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: B 로드 시 '팝업 안에서' 신규예약 생성하는 new-mode 입력 상태.
  //   날짜=pickedDate(미니캘린더), 시간=newResvTime, 초/재=newResvVisitType. 생성은 onCreateReservation 위임(팝업 insert 0).
  const [newResvTime, setNewResvTime] = useState<string>('10:00');
  // T-20260615-foot-RESVMGMT-REFIX-8 AC3: 빈슬롯 (+) prefill 시간이 클리닉 슬롯간격(예 15/20분)이라 30분 고정
  //   NEW_RESV_TIME_SLOTS 에 없을 수 있음 → 현재 값을 옵션에 합류시켜 controlled select 가 빈 표시되지 않게 보강.
  const newResvTimeOptions = NEW_RESV_TIME_SLOTS.includes(newResvTime)
    ? NEW_RESV_TIME_SLOTS
    : [...NEW_RESV_TIME_SLOTS, newResvTime].sort();
  const [newResvVisitType, setNewResvVisitType] = useState<'new' | 'returning'>('returning');
  const [creatingResv, setCreatingResv] = useState(false);

  // T-20260615-foot-RESVMGMT-REFIX-8 AC3-b: (+) new-mode 팝업에서 '시스템에 없는 완전 신규 고객' 직접 등록.
  //   검색으로 못 찾은 고객을 성함+연락처 입력으로 예약·등록. 고객 INSERT 는 parent(onCreateReservation) 책임 —
  //   기존 신규고객 생성 경로(RESVPOPUP-AC2-NEWMODE-L002, 1dcbca5) 재사용. 팝업은 폼 입력값만 위임(insert 0).
  const [manualNew, setManualNew] = useState(false);   // true = 직접 등록 모드(검색 미선택 대신)
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState(''); // 하이픈 표시(formatPhoneInput) — parent 가 E.164 정규화
  // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모(brief_note, 발톱무좀/내성발톱 선택 또는 직접입력) + 예약메모(booking_memo).
  const [briefNote, setBriefNote] = useState('');
  const [newBookingMemo, setNewBookingMemo] = useState('');
  // T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX: 간략메모 [힐러] 칩 ON/OFF(영속 is_healer_intent).
  //   brief_note(텍스트 3종)와 직교 — 동시 선택 가능(예: 발톱무좀 + 힐러). 신규 스키마 0(기존 컬럼·write-path 재사용).
  const [isHealerIntent, setIsHealerIntent] = useState(false);

  // T-20260629-foot-NEWRESV-UNIFIED-MODAL AC1: (+) 진입동선 통합 — 구 [신규/기존] 2버튼·existingSearch 분기 제거.
  //   통합 폼 직진(성함·연락처 입력 → 기존 매칭 시 재진 자동전환). 별도 진입상태 불필요.

  // 드롭다운 옵션 = 활성 consultant 만. (이름 resolve 는 비활성/타직군 포함 allStaff 전체로 — UUID 노출 방지)
  const consultants = allStaff.filter((s) => s.role === 'consultant' && s.active);
  // T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC4: 담당자 raw UUID 노출 버그 수정.
  //   assigned_staff_id 가 clinic staff 목록(allStaff)에 없을 때(타클리닉/삭제/비활성 누락) Select 가 raw UUID 를
  //   그대로 표기하던 문제 → 해당 id 를 직접 1건 조회해 이름 확보(없으면 친화 fallback, UUID 절대 비노출).
  const [assignedStaffName, setAssignedStaffName] = useState<string | null>(null);
  // T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX AC3: 치료내역 섹션 제거에 따라
  //   섹션 전용 helper(staffName·treatmentSummary) 데드코드 정리. treatments state/fetch 는
  //   재진 판정(hasPriorVisit)에서 계속 사용하므로 유지.

  // ── T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약경로 + 예약등록자 (현재 예약 대상 편집)
  const [registrars, setRegistrars] = useState<ReservationRegistrar[]>([]);
  const [visitRoute, setVisitRoute] = useState<string>('');      // '' = 미지정
  const [registrarId, setRegistrarId] = useState<string>('');    // '' = 미지정
  const [routeSaving, setRouteSaving] = useState(false);
  // T-20260630-foot-RESVPOPUP-TM-REGISTRAR-LOCK: TM 역할은 예약등록자 드롭다운 read-only + 저장 차단.
  const isTmRole = currentUserRole === 'tm';

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

  // T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC2: 시간대 패널에서 선택한 시간(HH:mm).
  //   anchor 예약(reservation)의 reservation_time update(저장) 대상. 날짜 변경 시 stale 선택 초기화.
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(null);
  const [reschedulingTime, setReschedulingTime] = useState(false);

  // 현재 우상에 표시할 예약 (좌하 클릭 선택, 기본값 = 원본 예약)
  const selectedResv: Reservation | undefined =
    allResvs.find((r) => r.id === selectedResvId) ?? reservation ?? undefined;

  // T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC6: 캘린더 영역 '예약등록자 필터' 드롭다운 삭제(중복 표기 제거).
  //   예약이력·캘린더 점표기는 전체 예약(allResvs) 그대로 표시. 상단 예약정보의 '예약등록자'(편집)만 유지.
  const visibleResvs = allResvs;

  // T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC2: 날짜를 바꾸면 이전 날짜의 시간 선택은 무효 → 초기화.
  //   (다른 날짜 슬롯을 stale 선택 상태로 anchor 예약에 잘못 저장하는 것을 방지)
  useEffect(() => {
    setSelectedSlotTime(null);
  }, [pickedDate]);

  // ── T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC1/AC5: 1번구역(고객정보·활성패키지·치료내역) 로더.
  //   현재 예약 고객(A) 최초 로드 + 검색으로 다른 고객(B) 불러올 때 동일 함수 재사용 → 1번구역만 교체(팝업 닫지 않음).
  //   zone2(예약이력·캘린더·등록자)는 현재 예약(A)에 고정 — 본 로더는 1번구역 한정.
  const loadZone1Data = (customerId: string) => {
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
    // 1b) 주민번호 마스킹 표시용 생년월일(서버파생) — T-20260614-foot-RESVPOPUP-RRN-NOBIND.
    //   원인진단(AC-4): 기존엔 비어있기 쉬운 customers.birth_date 컬럼에 직접 바인딩 → '칸은 있는데 비어있음'.
    //   보정: 기존 fn_customer_birthdates RPC(서버에서 rrn 복호 후 birth_date_display만 반환) 재사용.
    //   PHI: 평문 rrn·뒷자리 클라 미수신(AC-3). 신규 컴포넌트/복호경로 없음.
    setBirthDisplay(null);
    if (reservation?.clinic_id) {
      supabase
        .rpc('fn_customer_birthdates', { p_clinic_id: reservation.clinic_id, p_ids: [customerId] })
        .then(({ data }) => {
          const row = ((data ?? []) as { customer_id: string; birth_date_display: string | null }[])[0];
          setBirthDisplay(row?.birth_date_display ?? null);
        });
    }
    // 4) 보유 패키지 (활성) — 2번차트 양식 표시 위해 전체 컬럼 + 시술내역(package_sessions) 로드
    supabase
      .from('packages')
      .select('*')
      .eq('customer_id', customerId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const pkgs = (data ?? []) as Package[];
        setPackages(pkgs);
        const pkgIds = pkgs.map((p) => p.id);
        if (pkgIds.length === 0) {
          setPackageSessions([]);
          return;
        }
        // 2번차트와 동일 select(staff:performed_by(name) join)로 담당자 이름 resolve
        supabase
          .from('package_sessions')
          .select('id, package_id, session_number, session_type, session_date, status, staff:performed_by(name)')
          .in('package_id', pkgIds)
          .order('session_number', { ascending: true })
          .then(({ data: sess }) => {
            setPackageSessions(
              ((sess ?? []) as Record<string, unknown>[]).map((s) => ({
                id: s.id as string,
                package_id: s.package_id as string,
                session_number: s.session_number as number,
                session_type: s.session_type as string,
                session_date: s.session_date as string,
                status: s.status as string,
                staff_name: (s.staff as { name: string } | null)?.name ?? null,
              })),
            );
          });
      });
    // 6) 치료내역 — 이 고객의 check_ins(시술내역) 최신순. 신규 테이블/컬럼 0(기존 check_ins 재사용).
    //   T-20260615-foot-RESVPOPUP-DETAIL-8FIX AC3(팝업 surface): 취소/삭제된 내원이 치료내역에 잔존 표시되는 문제.
    //   chart2 패키지탭 로더(CustomerChartPage L2209: .neq('status','cancelled'))와 동일 관례로 정렬 →
    //   취소 내원은 치료내역 목록에서 제외(읽기 필터만, DB/스키마 무변경 → data-architect CONSULT 면제).
    //   ⚠ check_in 삭제↔package_sessions 차감 원복(깊은 cascade)은 삭제 핸들러 surface(본 read-only 팝업 영역 밖).
    // T-20260619-RESVPOPUP-DETAIL-REVERIFY-4FIX AC3: 독립 치료내역 섹션 제거 → 재진판정(hasPriorVisit)만 잔존.
    //   select 도 그 유일 소비 컬럼(id·checked_in_at)으로 축소 = orphan 컬럼 over-fetch 제거.
    supabase
      .from('check_ins')
      .select('id, checked_in_at')
      .eq('customer_id', customerId)
      .neq('status', 'cancelled')
      .order('checked_in_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setTreatments((data ?? []) as TreatmentRow[]);
      });
  };

  // ── 데이터 로드
  // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (AC2 시나리오1): (+) 로 new-mode 오픈할 때마다 깨끗한 빈 상태로 리셋.
  //   컴포넌트는 부모 트리에 상시 마운트(reservation=null 시 과거엔 null 반환) → newMode 토글만으론 reset effect 미발화.
  //   stale loadedMatch/pickedDate 잔존 차단. (검색창 활성·빈 상태 = AC2 시나리오1 요건)
  useEffect(() => {
    if (newMode) {
      setLoadedMatch(null);
      setCustomer(null);
      setSearchValue('');
      // T-20260615-foot-RESVMGMT-REFIX-8 AC3: 빈슬롯 (+) 진입이면 클릭 슬롯의 날짜/시간 prefill,
      //   상단 '새 예약'(initial 미전달)이면 기존대로 빈 진입(null / '10:00'). 'yyyy-MM-dd' → 로컬 자정 Date(타임존 드리프트 0).
      // T-20260629-foot-NEWRESV-UNIFIED-MODAL AC2/AC9: 모달 내 날짜 캘린더/picker 제거 → 날짜는 진입 시 자동 주입(readOnly).
      //   캘린더 (+) 셀 진입 = 클릭 슬롯 날짜, 상단/목록 [새 예약] 진입(initialDate 미전달) = 오늘 날짜 기본 주입(picker 부재 graceful).
      if (initialDate) {
        const [y, m, d] = initialDate.split('-').map(Number);
        setPickedDate(new Date(y, m - 1, d));
      } else {
        const t = new Date();
        setPickedDate(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
      }
      setNewResvTime(initialTime || '10:00');
      setNewResvVisitType('returning');
      setCreatingResv(false);
      // T-20260629-foot-NEWRESV-UNIFIED-MODAL: 예약경로·예약등록자 클린 리셋(통합 폼 빈상태 보장).
      setVisitRoute('');
      setRegistrarId('');
      // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모·예약메모 매 진입 클린 리셋(stale 차단).
      setBriefNote('');
      setNewBookingMemo('');
      // T-20260630-foot-RESV-CUSTCTX-PREFILL: 고객 컨텍스트로 진입(동선1·2)이면 해당 고객 자동 prefill(재진),
      //   아니면 기존 빈 진입(검색창 활성, AC4 회귀 0). 고객 prefill 은 검색 선택과 동일 경로(handleSelectOtherCustomer)
      //   재사용 → 1번구역(고객정보·패키지·치료내역) 자동 로드 + 이름·연락처 populate. 🔒 L-002: 생성 로직 무변경(인젝션 0).
      if (initialCustomer) {
        handleSelectOtherCustomer(initialCustomer);
      } else {
        // T-20260629-foot-NEWRESV-UNIFIED-MODAL AC1/AC4: 1차 팝업(신규/기존 선택) 제거 → 통합 폼 직진.
        //   manualNew 기본 true(=신규 직접입력 폼 상시 노출). 성함·연락처 입력→기존고객 매칭 선택 시 loadedMatch(재진) 자동전환.
        setManualNew(true);
        setNewCustName('');
        setNewCustPhone('');
      }
    }
    // handleSelectOtherCustomer 는 hoisted function 선언(매 렌더 재생성) → deps 포함 시 setState 루프.
    //   initialCustomer/initialDate/initialTime/newMode 변화에만 재실행하면 충분(prefill 1회).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newMode, initialDate, initialTime, initialCustomer]);

  useEffect(() => {
    if (!reservation) {
      setCustomer(null);
      setBirthDisplay(null);
      setAllResvs([]);
      setPackages([]);
      setPackageSessions([]);
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
      setLoadedMatch(null);
      setNewResvTime('10:00');
      setNewResvVisitType('returning');
      setCreatingResv(false);
      return;
    }

    setSelectedResvId(reservation.id);
    setBusy(false);
    setSearchValue('');
    setPickedDate(null);
    // AC1: 다른 예약 오픈 시 B 로딩 상태 초기화(현재 예약 A 기준 복귀)
    setLoadedMatch(null);
    // T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: new-mode 입력 초기화
    setNewResvTime('10:00');
    setNewResvVisitType('returning');
    setCreatingResv(false);
    // T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 현재 예약의 예약경로/예약등록자 프리로드
    setVisitRoute(reservation.visit_route ?? '');
    setRegistrarId(reservation.registrar_id ?? '');

    const customerId = reservation.customer_id;
    const clinicId = reservation.clinic_id;

    if (customerId) {
      // 1·4·6) 1번구역(고객정보·활성패키지·치료내역) = 공용 로더 (AC1 B 불러오기와 재사용)
      loadZone1Data(customerId);

      // 2) 전체 예약 히스토리 (최신순) — zone2, 현재 예약(A) 고정
      supabase
        .from('reservations')
        .select('*')
        .eq('customer_id', customerId)
        .order('reservation_date', { ascending: false })
        .order('reservation_time', { ascending: false })
        .then(({ data }) => {
          if (data) setAllResvs(data as Reservation[]);
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

  // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: new-mode(anchor 예약 없음)에서도 예약등록자 마스터 로드.
  //   기존 마스터 로더는 reservation 효과 내부 → newMode 진입 시 registrars 가 비어 드롭다운이 공란이 되는 문제 보강.
  //   clinicId(parent useClinic 주입)로 동일 select 재사용(신규 테이블/스키마 0).
  useEffect(() => {
    if (!newMode || !clinicId) return;
    let cancelled = false;
    supabase
      .from('reservation_registrars')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .order('group_name', { ascending: true })
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setRegistrars(data as ReservationRegistrar[]);
      });
    return () => { cancelled = true; };
  }, [newMode, clinicId]);

  // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE (김주연 총괄):
  //   "드롭 선택 박스 유지 / 접속한 계정 기준 기본값 / 수기 변경 허용".
  //   예약등록자 드롭(registrar_id, reservation_registrars 마스터)의 default = 로그인 계정 표시명(authorName)과
  //   이름이 일치하는 활성 예약등록자. 드롭은 그대로 유지 → 사용자가 다른 값으로 수기 변경 가능(AC1/AC2).
  //   ⚠ registrar_id/registrar_name 은 '표시·선택용' 값 — 감사용 created_by/updated_by(booker)와 분리.
  //     default·수기 override 는 registrar 스냅샷만 바꾸고 감사추적(누가 실제 생성)은 보존(AC3).
  //   SCOPE: 신규 등록 폼(new-mode)에만 적용 — 편집(기존 예약)은 저장값을 그대로 로드(회귀 0, AC4).
  //   1회 가드: 팝업 재오픈(newMode/reservation 전환)마다 1번만. 이후 사용자가 '미지정'으로 되돌려도 재주입 안 함.
  const registrarDefaultAppliedRef = useRef(false);
  useEffect(() => {
    registrarDefaultAppliedRef.current = false;
  }, [newMode, reservation?.id]);
  useEffect(() => {
    if (!newMode) return;                              // 신규 폼 전용(편집 미적용)
    if (registrarDefaultAppliedRef.current) return;    // 이미 1회 적용됨
    if (registrars.length === 0) return;               // 마스터 로드 대기
    registrarDefaultAppliedRef.current = true;         // 가드 확정(이후 수기변경 보존)
    const me = (authorName ?? '').replace(/\s+/g, '');
    if (!me) return;                                   // 로그인 표시명 없음 → 미지정 유지(graceful)
    if (registrarId !== '') return;                    // 이미 선택값 있으면 default 미적용
    const match = registrars.find((r) => r.name.replace(/\s+/g, '') === me);
    if (match) setRegistrarId(match.id);               // 일치 시 자동주입(없으면 미지정 유지)
  }, [newMode, registrars, authorName, registrarId]);

  // T-20260629-foot-NEWRESV-REGISTRANT-UUID-LABEL: 예약등록자 Select 선택값(SingleValue) 표기 resolver.
  //   Base UI Select.Value 는 children(render-fn) 미제공 시 raw value(=registrar_id UUID)를 그대로 렌더.
  //   드롭다운 '목록' option 은 정상(이름)인데, 닫힌 트리거의 '선택값'만 UUID 로 노출되던 버그(신규 예약 모달 보고).
  //   → 4FIX(담당자 드롭) 와 동일 패턴: value→이름 직접 해석(아이템 lazy 등록 타이밍 무관, UUID 절대 비노출).
  //   표기 = 목록과 동일 라벨 포맷([group] name = [TM]/[원내] prefix 유지). 저장값(registrar_id)은 무변경(표시 전용).
  const resolveRegistrarLabel = (val: string) => {
    if (!val || val === '__none__') return '예약등록자 선택';
    const reg = registrars.find((r) => r.id === val);
    if (!reg) return '예약등록자 선택';           // 마스터 미로드/삭제 → placeholder graceful (UUID 비노출)
    return reg.group_name ? `[${reg.group_name}] ${reg.name}` : reg.name;
  };

  // T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC4: 담당자(assigned_staff_id) 이름 resolve.
  //   clinic staff 목록(allStaff)에 있으면 그 이름, 없으면(타클리닉/삭제/비활성 누락) id 1건 직접 조회.
  //   어느 경우에도 raw UUID 가 Select 트리거에 노출되지 않도록 보장.
  useEffect(() => {
    if (!selectedConsultantId) {
      setAssignedStaffName(null);
      return;
    }
    const inList = allStaff.find((s) => s.id === selectedConsultantId);
    if (inList) {
      setAssignedStaffName(inList.display_name ?? inList.name);
      return;
    }
    let cancelled = false;
    supabase
      .from('staff')
      .select('id, name')
      .eq('id', selectedConsultantId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setAssignedStaffName((data as { name?: string } | null)?.name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedConsultantId, allStaff]);

  // ─── T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002 (AC2 시나리오1): (+) 새 예약 → 팝업 new-mode 빈 진입 ───
  //   anchor 예약(A)이 없는 신규 진입. 별도 폼/화면 이동 폐기 — 이 팝업 안에서 검색→날짜→시간→초/재→생성 완결.
  //   메인 렌더(693~)는 reservation 에 깊게 결합 → 회귀 0 위해 손대지 않고, 격리된 compact 분기로 분리.
  //   🔒 L-002: 팝업 내 reservations.insert = 0 — submitNewReservation 이 onCreateReservation(parent 단일소스 함수)만 호출.
  // ─── T-20260629-foot-NEWRESV-UNIFIED-MODAL (항목8·9·10 통합) ───
  //   6/25 개편 2탄: (+)·[새 예약] 진입 시 1차 팝업(신규/기존·초/재진 선택) 제거 → 단일 통합 폼 직진(AC1).
  //   날짜 캘린더/picker 제거 → 진입 시 자동 주입된 날짜·시간 readOnly 표시(AC2). 모달 더 컴팩트(AC5).
  //   성함·연락처 입력 → 기존 기록 매칭(InlinePatientSearch, 재진판정 자산 재사용) 선택 시 loadedMatch(재진)·
  //   미선택 시 신규(초진) 자동판별(AC4, L-002 보존 — 신규 판별 로직 0). 재진이면 진행중 패키지 N/N 자동로드(AC7).
  //   🔒 L-002: 팝업 내 reservations.insert = 0 — submitNewReservation 이 onCreateReservation(parent 단일소스)만 호출.
  if (newMode && !reservation) {
    const effectiveClinicId = clinicId ?? undefined;
    const isReturning = !!loadedMatch;
    return (
      <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
        {/* AC5: 컴팩트 — 폭 축소(560→440), 본문 여백 축소. */}
        <DialogContent className="max-w-[440px] max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-4 pb-2.5 border-b shrink-0">
            <div className="flex items-center justify-between gap-3 pr-8">
              <DialogTitle className="text-base">신규 예약</DialogTitle>
              {/* AC2: 진입 시 자동 주입된 날짜·시간 — readOnly(별도 캘린더/picker 없음). */}
              <div className="flex items-center gap-2 text-xs tabular-nums" data-testid="newmode-datetime-readonly">
                <span className="font-medium text-teal-800">
                  {pickedDate ? format(pickedDate, 'M/d (E)', { locale: ko }) : '—'}
                </span>
                <span className="font-semibold text-teal-700">{newResvTime}</span>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5 min-h-0">
            {/* ── 고객 식별: 성함·연락처 입력 → 기존 기록 매칭 시 재진 자동전환 ── */}
            {isReturning ? (
              // AC4/AC7: 기존 고객 매칭 = 재진 자동판별. 패키지 N/N 자동로드 + 패키지·치료이력(read-only) 노출.
              //   RESVPOPUP-2ZONE 자산(PackageTicketReadonlyList) 재사용 — 신규 컴포넌트 0.
              <div className="rounded-xl border border-teal-300 bg-teal-50/70 px-3 py-2.5 shadow-sm space-y-2" data-testid="popup-newmode-customer">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="newmode-visittype-badge">재진</span>
                      <span className="text-[11px] font-medium text-teal-700">기존 고객 불러옴</span>
                      {/* AC7: 진행중 패키지(최신 active 1건) N/N — loadZone1Data 선로드 자산 재사용(자동로드). */}
                      {(() => {
                        const activePkg = packages[0];
                        if (!activePkg) return null;
                        const total = activePkg.total_sessions ?? 0;
                        const used = packageSessions.filter(
                          (s) => s.package_id === activePkg.id && s.status === 'used',
                        ).length;
                        return (
                          <span
                            data-testid="newmode-existing-pkg-nn"
                            title={`패키지 ${used}/${total} 회차`}
                            className="inline-flex shrink-0 items-center rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-teal-700"
                          >
                            패키지 {used}/{total}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                    onClick={() => {
                      // 재진 해제 → 신규 직접입력 폼으로 복귀(manualNew=true: submit 가드 정합 보존).
                      setLoadedMatch(null); setManualNew(true); setNewCustName(''); setNewCustPhone(''); setSearchValue('');
                    }}
                    data-testid="btn-newmode-existing-research"
                  >
                    다시 입력
                  </button>
                </div>
                {/* T-20260629-foot-RESVCREATE-CUSTAUTOLOAD AC3: 선택 시 자동 채워진 성함·연락처를 '수정 가능' plain input 으로 노출.
                    읽기전용 강제 금지(오입력 정정용). 신원(loadedMatch.id)은 선택값 고정 — 값 편집은 이 예약의 표기 스냅샷만 갱신.
                    생년월일(loadedMatch.birth_date)은 식별 보조용 read-only 표시(예약 생성에 별도 입력칸 없음). */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Label htmlFor="newmode-existing-name" className="w-12 shrink-0 text-muted-foreground">성함</Label>
                    <input
                      id="newmode-existing-name"
                      type="text"
                      value={newCustName}
                      onChange={(e) => setNewCustName(e.target.value)}
                      className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid="newmode-existing-name-input"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Label htmlFor="newmode-existing-phone" className="w-12 shrink-0 text-muted-foreground">연락처</Label>
                    <input
                      id="newmode-existing-phone"
                      type="text"
                      inputMode="numeric"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(formatPhoneInput(e.target.value))}
                      className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid="newmode-existing-phone-input"
                    />
                  </div>
                  {loadedMatch!.birth_date && (
                    <div className="flex items-center gap-2 text-xs" data-testid="newmode-existing-birth">
                      <span className="w-12 shrink-0 text-muted-foreground">생년월일</span>
                      {/* T-20260630-foot-CRM-BIRTHDATE-RRN-GLOBAL [B]: raw YYMMDD → SSOT birthDateYMD(YYYY-MM-DD). read-only 표기 통일. */}
                      <span className="text-sm text-teal-800 tabular-nums">{birthDateYMD(loadedMatch!.birth_date) || loadedMatch!.birth_date}</span>
                    </div>
                  )}
                </div>
                {/* 패키지·치료이력(2번차트 양식 read-only) — loadZone1Data 로 선로드됨 */}
                <div className="rounded-lg border border-border/50 bg-card/70 px-2.5 py-2" data-testid="popup-newmode-pkg-history">
                  <div className="text-[10px] font-medium text-muted-foreground mb-1">패키지 · 치료이력</div>
                  <PackageTicketReadonlyList packages={packages} sessions={packageSessions} />
                </div>
              </div>
            ) : (
              // AC4: 성함·연락처 입력 폼 — 기존 기록 매칭(InlinePatientSearch) 선택 시 재진 전환, 미매칭=신규(초진).
              <div className="rounded-xl border border-teal-300 bg-teal-50/60 px-3 py-2.5 shadow-sm space-y-2" data-testid="popup-newmode-manual-form">
                <div className="flex items-center justify-between">
                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-500 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="newmode-visittype-badge">신규(초진)</span>
                  <span className="text-[10px] text-muted-foreground">성함·연락처에 기존 기록 있으면 자동으로 재진 전환</span>
                </div>
                {/* 성함 — InlinePatientSearch(name): 입력 시 기존 고객 후보 노출, 선택 시 재진 자동판별(handleSelectOtherCustomer). */}
                <div className="flex items-center gap-2 text-xs">
                  <Label htmlFor="newmode-cust-name" className="w-12 shrink-0 text-muted-foreground">성함</Label>
                  <div className="flex-1 min-w-0">
                    <InlinePatientSearch
                      value={newCustName}
                      onChange={setNewCustName}
                      onSelect={handleSelectOtherCustomer}
                      searchField="name"
                      clinicId={effectiveClinicId}
                      placeholder="고객 성함"
                      id="newmode-cust-name"
                    />
                  </div>
                </div>
                {/* 연락처 — InlinePatientSearch(phone): 하이픈 자동포맷 + 기존 고객 매칭. parent 가 E.164 정규화. */}
                <div className="flex items-center gap-2 text-xs">
                  <Label htmlFor="newmode-cust-phone" className="w-12 shrink-0 text-muted-foreground">연락처</Label>
                  <div className="flex-1 min-w-0">
                    <InlinePatientSearch
                      value={newCustPhone}
                      onChange={setNewCustPhone}
                      onSelect={handleSelectOtherCustomer}
                      searchField="phone"
                      clinicId={effectiveClinicId}
                      placeholder="010-1234-5678"
                      id="newmode-cust-phone"
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* AC5: 예약경로 / 예약등록자 — 한 줄(2칸 grid) 배치. REGISTRAR-ROUTE-FIELDS 자산 재사용(신규 스키마 0). */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col gap-0.5 min-w-0">
                <Label htmlFor="newmode-visit-route" className="text-[10px] text-muted-foreground">예약경로</Label>
                <Select value={visitRoute || '__none__'} onValueChange={(v) => setVisitRoute(v === '__none__' ? '' : v)}>
                  <SelectTrigger id="newmode-visit-route" className="h-9 w-full text-sm" data-testid="newmode-visit-route-select">
                    <SelectValue placeholder="예약경로 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">— 미지정 —</SelectItem>
                    {/* AC3: 예약경로 = TM/네이버/인콜/워크인/지인소개(VISIT_ROUTE_OPTIONS, RESV-ROUTE-AUTOCLASS 정합). */}
                    {VISIT_ROUTE_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <Label htmlFor="newmode-registrar" className="text-[10px] text-muted-foreground">예약등록자</Label>
                {/* T-20260630-foot-RESVPOPUP-TM-REGISTRAR-LOCK AC-4: TM 역할은 신규 예약 모드에서도 예약등록자 disabled. */}
                <Select value={registrarId || '__none__'} onValueChange={(v) => setRegistrarId(v === '__none__' ? '' : v)} disabled={isTmRole}>
                  <SelectTrigger id="newmode-registrar" className="h-9 w-full text-sm" data-testid="newmode-registrar-select">
                    {/* AC8: T-20260629-foot-NEWRESV-REGISTRANT-UUID-LABEL — 선택값을 value→이름으로 해석(UUID 비노출). */}
                    <SelectValue placeholder="예약등록자 선택">
                      {(val) => resolveRegistrarLabel(val)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">— 미지정 —</SelectItem>
                    {registrars.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-xs">
                        {r.group_name ? `[${r.group_name}] ${r.name}` : r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* AC6: 간략메모 — 발톱무좀/내성발톱/발각질케어 3종 체크박스 + 직접입력(brief_note).
                T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX (김주연 총괄): 4번째 [힐러] 칩 추가.
                  ⚠ 힐러 칩은 brief_note 텍스트가 아니라 is_healer_intent(영속 플래그) 토글 — 3종과 직교(동시선택 가능).
                  ON 시 캘린더 resvKind()→healer 분류→노란박스(#FFFDE7, healer 토큰). 신규 색/토큰/컬럼 0. */}
            <div className="flex flex-col gap-1 text-xs">
              <Label htmlFor="newmode-brief-note" className="text-[10px] text-muted-foreground">간략메모</Label>
              <div className="flex flex-wrap gap-1.5">
                {BRIEF_NOTE_QUICK.map((label) => {
                  const active = briefNote.trim() === label;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setBriefNote((prev) => (prev.trim() === label ? '' : label))}
                      className={cn(
                        'h-8 rounded-md border px-3 text-sm font-medium transition-colors',
                        active
                          ? 'border-teal-600 bg-teal-100 text-teal-700'
                          : 'border-input bg-background hover:bg-muted',
                      )}
                      data-testid={`newmode-brief-quick-${label}`}
                    >
                      {label}
                    </button>
                  );
                })}
                {/* [힐러] 칩 — is_healer_intent 토글. active 시 healer 토큰(노랑)로 노란박스 연동 telegraph. */}
                <button
                  type="button"
                  onClick={() => setIsHealerIntent((prev) => !prev)}
                  aria-pressed={isHealerIntent}
                  className={cn(
                    'h-8 rounded-md border px-3 text-sm font-medium transition-colors',
                    isHealerIntent
                      ? 'border-healer-400 bg-healer-50 text-healer-700'
                      : 'border-input bg-background hover:bg-muted',
                  )}
                  data-testid="newmode-brief-quick-힐러"
                >
                  힐러
                </button>
              </div>
              <input
                id="newmode-brief-note"
                type="text"
                value={briefNote}
                onChange={(e) => setBriefNote(e.target.value)}
                placeholder="발톱무좀 · 내성발톱 · 발각질케어 또는 직접입력"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="newmode-brief-note-input"
              />
            </div>

            {/* AC6: 예약메모(booking_memo) — 간략메모와 별개 칸. */}
            <div className="flex flex-col gap-1 text-xs">
              <Label htmlFor="newmode-booking-memo" className="text-[10px] text-muted-foreground">예약메모</Label>
              <input
                id="newmode-booking-memo"
                type="text"
                value={newBookingMemo}
                onChange={(e) => setNewBookingMemo(e.target.value)}
                placeholder="예약 관련 메모 (선택)"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="newmode-booking-memo-input"
              />
            </div>

            {/* AC2: 날짜·시간은 진입 시 자동 주입(readOnly) — 모달 내 캘린더/picker 없음. */}
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs" data-testid="newmode-datetime-row">
              <span className="text-muted-foreground">예약일시</span>
              <span className="font-medium text-teal-800 tabular-nums">
                {pickedDate ? format(pickedDate, 'yyyy-MM-dd (E)', { locale: ko }) : '—'} {newResvTime}
              </span>
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>닫기</Button>
            <Button
              size="sm"
              disabled={
                creatingResv ||
                !pickedDate ||
                // 신규(미매칭) 모드는 성함+연락처 미입력 시 생성 차단(빈 고객 INSERT 방지).
                // T-20260629-foot-RESVCREATE-CUSTAUTOLOAD AC3: 재진(매칭)도 성함이 비면 차단 — 단 연락처는
                //   신원이 customer id 로 고정되므로 빈값 허용(연락처 없는 기존 고객도 예약 가능).
                (loadedMatch ? !newCustName.trim() : (!newCustName.trim() || !newCustPhone.trim()))
              }
              onClick={submitNewReservation}
              data-testid="btn-newmode-create-entry"
            >
              {creatingResv ? '생성 중…' : isReturning ? `${loadedMatch!.name}님 예약 생성` : '신규 예약 생성'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!reservation) return null;

  // ── 소요 시간 표시 행은 AC5a(현장 요청)로 제거됨 → getDuration 헬퍼도 함께 삭제.

  // ── 초·재진 표시값 (AC5b)
  // 규칙(planner 확정): 해당 고객의 "과거 내원 이력"(이 예약일 이전 check_in) 존재 시 → '재진' 자동 표기.
  //   - 표시 전용. visit_type write 변경 없음(DB 무변경, 순수 FE 파생).
  //   - treatments = 이 고객 check_ins(최신순). 현재 예약일 이전 내원이 1건이라도 있으면 재진으로 본다.
  //   - 과거 이력이 없으면 원본 visit_type 표기 유지(experience='예약없이 방문' 등 보존).
  const getVisitTypeDisplay = (resv: Reservation) => {
    const base = VISIT_TYPE_KO[resv.visit_type];
    if (resv.visit_type === 'returning') return base; // 이미 재진
    const hasPriorVisit = treatments.some((t) => {
      if (!t.checked_in_at) return false;
      return t.checked_in_at.slice(0, 10) < resv.reservation_date;
    });
    return hasPriorVisit ? VISIT_TYPE_KO.returning : base;
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

  // ── 액션: AC2 시간 변경 (시간대 패널에서 선택한 시간으로 anchor 예약 reservation_time update)
  // T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC2 (field clarify Q3=저장 O, ts=1781796980.363939):
  //   미니캘린더 날짜(pickedDate) + 시간대 패널 선택(selectedSlotTime) → 현재 예약(anchor)의
  //   reservation_date/reservation_time update. reschedule 단일 패턴(Reservations.tsx:1104) 재사용.
  //   🔒 GUARD(RESV-ROUTE-AUTOCLASS): update payload = 날짜·시간만. visit_type/visit_route write 무접촉.
  //   Q2(마감 표시 불필요) → 최대인원/마감 차단 로직 미적용(예약 현황 숫자만 표기, 차단 없음).
  const rescheduleToSelectedTime = async () => {
    if (!pickedDate || !selectedSlotTime) return;
    const newDate = format(pickedDate, 'yyyy-MM-dd');
    const newTime = selectedSlotTime; // 'HH:mm' (reschedule 경로와 동일 포맷)
    const oldData = { date: reservation.reservation_date, time: reservation.reservation_time.slice(0, 5) };
    if (oldData.date === newDate && oldData.time === newTime) {
      toast.info('이미 해당 시간으로 예약되어 있습니다');
      return;
    }
    setReschedulingTime(true);
    const { error } = await supabase
      .from('reservations')
      .update({ reservation_date: newDate, reservation_time: newTime }) // visit_type 무접촉(GUARD)
      .eq('id', reservation.id);
    if (error) {
      toast.error(`시간 변경 실패: ${error.message}`);
      setReschedulingTime(false);
      return;
    }
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'reschedule',
      old_data: oldData,
      new_data: { date: newDate, time: newTime },
      changed_by: changedBy,
    });
    setReschedulingTime(false);
    setSelectedSlotTime(null);
    toast.success(
      oldData.date === newDate
        ? `예약 시간 변경: ${oldData.time} → ${newTime}`
        : `예약 이동: ${oldData.date} ${oldData.time} → ${newDate} ${newTime}`,
    );
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
      // AC-1/AC-2: 재진 → 치료대기(treatment_waiting), 예약없이방문 → 상담대기(consult_waiting). canonical 분기 복원.
      // T-20260613-foot-FIELDBATCH item2: 초진(new) → [접수중](receiving). 우클릭→예약상세→초진 체크인 진입점. 셀프접수 초진(receiving)과 통일.
      status: reservation.visit_type === 'returning'
        ? 'treatment_waiting'
        : reservation.visit_type === 'new'
          ? 'receiving'
          : 'consult_waiting',
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
    if (error) { toast.error(`담당자 저장 실패: ${error.message}`); return; }
    toast.success('담당자 저장됨');
  };

  // ── T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약경로 + 예약등록자 저장
  //    현재 예약(reservation) 대상에 visit_route + registrar_id/registrar_name(스냅샷) 영속.
  //    registrar_name 스냅샷 → 마스터가 리네임/삭제돼도 고객박스 @표시 안정.
  const saveRouteAndRegistrar = async () => {
    setRouteSaving(true);
    const reg = registrars.find((r) => r.id === registrarId) ?? null;
    // T-20260630-foot-RESVPOPUP-TM-REGISTRAR-LOCK AC-2: TM 역할은 registrar_id/registrar_name 변경을 DB에 쓰지 않음
    //   (드롭다운 disabled UX 우회 방어). 예약경로(visit_route)는 정상 저장. admin/manager/consultant는 기존대로 전 필드 저장.
    const registrarFields = isTmRole ? {} : {
      registrar_id: registrarId === '' ? null : registrarId,
      registrar_name: reg ? reg.name : null,
    };
    const { error } = await supabase
      .from('reservations')
      .update({
        visit_route: visitRoute === '' ? null : visitRoute,
        ...registrarFields,
      })
      .eq('id', reservation.id);
    setRouteSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('예약경로·예약등록자 저장됨');
    onChanged();
  };

  // ── T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC1: 검색창에서 다른 고객(B) 선택
  //    → 팝업을 닫지 않고 1번구역(고객정보·패키지·치료내역·메모)만 B 로 교체(신규예약 대상).
  //    검색 입력값도 즉시 초기화(stale text clear). 실제 생성은 new-mode 폼 → onCreateReservation 위임.
  //    🔒 L-002: 신규 생성 로직 작성 0 — parent 단일소스 함수 재사용.
  // function 선언(hoisted): AC2 new-mode 분기(렌더 상단)가 이 핸들러를 참조 — TDZ 회피.
  function handleSelectOtherCustomer(p: PatientMatch) {
    setSearchValue('');
    setLoadedMatch(p);
    // T-20260615-foot-RESVMGMT-REFIX-8 AC3-b: 기존 고객을 검색 선택하면 직접 등록 모드 해제(stale 입력 차단).
    setManualNew(false);
    // T-20260629-foot-RESVCREATE-CUSTAUTOLOAD AC3: 후보 선택 시 예약 입력 필드(이름·연락처)를 자동 populate(비우지 않음).
    //   채워진 값은 그대로 수정 가능(읽기전용 강제 금지) — 신규예약 모달 재진 카드에서 plain input 으로 편집 노출.
    //   phone 은 formatPhoneInput 으로 하이픈 표시(+82 E.164 → 010 정규화 포함). 신원(loadedMatch.id)은 선택값 고정.
    setNewCustName(p.name ?? '');
    setNewCustPhone(p.phone ? formatPhoneInput(p.phone) : '');
    // T-20260614-foot-RESVPOPUP-AC2-NEWMODE: B 로드 시 new-mode 입력 기본값 리셋(초/재 재진 기본).
    setNewResvVisitType('returning');
    // T-20260629-foot-RESVCREATE-CUSTAUTOLOAD: 통합 모달(new-mode)은 진입 시 주입된 날짜·시간 readOnly 유지 —
    //   고객 선택이 그 슬롯 시간을 10:00 으로 덮어쓰지 않도록 보존(헤더 검색창=big-modal 경로만 기본 10:00).
    if (!newMode) setNewResvTime('10:00');
    loadZone1Data(p.id);
  }

  // AC1: 다시 현재 예약(A) 고객으로 1번구역 복귀
  const resetToOriginalCustomer = () => {
    setLoadedMatch(null);
    setSearchValue('');
    setCreatingResv(false);
    if (reservation.customer_id) loadZone1Data(reservation.customer_id);
  };

  // ── T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: 팝업 new-mode 신규예약 생성.
  //    날짜=pickedDate(미니캘린더), 시간=newResvTime, 초/재=newResvVisitType. 생성은 parent 단일소스 함수 위임.
  //    🔒 팝업 내 reservations.insert = 0 — onCreateReservation(parent) 만 호출. 생성 무결성 5요소는 parent 보존.
  // function 선언(hoisted): AC2 new-mode 분기(렌더 상단)가 이 핸들러를 참조 — TDZ 회피.
  async function submitNewReservation() {
    if (!onCreateReservation) return;
    // T-20260615-foot-RESVMGMT-REFIX-8 AC3-b: 대상 = 검색 선택 고객(loadedMatch) 또는 직접 등록(manualNew).
    //   직접 등록이면 성함+연락처 필수. customerId=null 위임 → parent 가 기존고객 resolve/신규 INSERT(고객 INSERT 책임 parent).
    const manualName = newCustName.trim();
    const manualPhone = newCustPhone.trim();
    if (!loadedMatch && manualNew) {
      if (!manualName) {
        toast.error('신규 고객 성함을 입력하세요.');
        return;
      }
      if (!manualPhone) {
        toast.error('신규 고객 연락처를 입력하세요.');
        return;
      }
    } else if (!loadedMatch) {
      return; // 대상 미확정(검색 미선택 & 직접등록 아님) — 가드
    }
    if (!pickedDate) {
      toast.error('예약 캘린더에서 날짜를 먼저 선택하세요.');
      return;
    }
    if (!newResvTime) {
      toast.error('예약 시간을 선택하세요.');
      return;
    }
    // T-20260629-foot-RESVCREATE-CUSTAUTOLOAD AC3: 자동 채움 값이 수정됐을 수 있음 → 편집된 newCust* 우선(빈값이면 매칭값 fallback).
    //   신원(customerId=loadedMatch.id)은 선택 고정 — 편집은 이 예약의 표기(name/phone) 스냅샷에만 반영(고객 마스터 무변경, 🔒L-002).
    const targetName = loadedMatch ? (newCustName.trim() || loadedMatch.name) : manualName;
    setCreatingResv(true);
    const res = await onCreateReservation({
      customerId: loadedMatch ? loadedMatch.id : null,
      name: targetName,
      phone: loadedMatch ? (newCustPhone.trim() || loadedMatch.phone || null) : manualPhone,
      date: format(pickedDate, 'yyyy-MM-dd'),
      time: newResvTime,
      // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW 2-f: 신규 고객 직접 등록(manualNew)은 무조건 초진(new) 고정 — race-safe guard.
      visit_type: (!loadedMatch && manualNew) ? 'new' : newResvVisitType,
      // T-20260617-foot-RESVMGMT-COMPACT-POPUPFLOW AC-4: 신규 고객 등록 시 입력한 예약경로/예약등록자 영속(컬럼·마스터 기존).
      visit_route: visitRoute || null,
      registrar_id: registrarId || null,
      // T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE: 선택된 예약등록자 이름 스냅샷 동봉.
      //   편집경로(saveRouteAndRegistrar L1105)와 동일 시맨틱 — 마스터 리네임/삭제돼도 @표시·필터 안정.
      registrar_name: registrars.find((r) => r.id === registrarId)?.name ?? null,
      // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모 + 예약메모 영속.
      brief_note: briefNote.trim() || null,
      booking_memo: newBookingMemo.trim() || null,
      // T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX: 힐러 칩 → is_healer_intent(영속) 위임. parent createReservationCanonical 가 기존 write-path 로 저장.
      is_healer_intent: isHealerIntent,
    });
    setCreatingResv(false);
    if (!res.ok) {
      // slot_full / error 는 메시지 노출, duplicate_cancelled 는 사용자 취소(조용히)
      if (res.reason !== 'duplicate_cancelled') {
        toast.error(res.message ?? '예약 생성에 실패했습니다.');
      }
      return;
    }
    toast.success(`${targetName}님 신규예약이 등록되었습니다.`);
    // 생성 후 현재 예약(A) 기준으로 복귀 + 팝업 닫기(부모 onChanged → 목록 새로고침)
    setLoadedMatch(null);
    setManualNew(false);
    setNewCustName('');
    setNewCustPhone('');
    // T-20260629-foot-NEWRESV-UNIFIED-MODAL: 예약경로·예약등록자 클린 리셋.
    setVisitRoute('');
    setRegistrarId('');
    // T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB (item3/10): 간략메모·예약메모 클린 리셋.
    setBriefNote('');
    setNewBookingMemo('');
    // T-20260630-foot-RESVMEMO-HEALER-CHIP-YELLOWBOX: 힐러 칩 클린 리셋(다음 신규예약에 잔존 금지).
    setIsHealerIntent(false);
    onChanged();
  };

  // ─── 렌더 ─────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="max-w-[1100px] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

          {/* 헤더
              T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC3: 고객 검색창을 헤더 우상단(× 닫기 버튼 왼쪽)으로 이동.
                좌측 제목블록 + 우측 검색창. 이름/연락처 단일창 OR 검색('both'). 불필요 안내문구 제거. */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <div className="flex items-start justify-between gap-3 pr-8">
              <DialogTitle className="flex flex-wrap items-center gap-2 text-base min-w-0">
                {/* T-20260615-foot-RESVPOPUP-3BUG AC1 (BUG-1): 헤더 고객명이 검색으로 불러온 고객(B)으로 갱신 안 되는
                    stale 버그. 환자정보 섹션(아래)은 customer state 로 이미 갱신되나 헤더 타이틀만 reservation.customer_name
                    (원본 A)에 하드바인딩돼 있었음. loadedMatch(검색 선택 즉시) → customer(loadZone1Data 갱신) → 원본 순으로
                    바인딩해 검색 선택 시 헤더 고객명도 즉시 B 로 반영. (6FIX AC1 의 1번구역 갱신 동선과 정합) */}
                <span>{loadedMatch?.name ?? customer?.name ?? reservation.customer_name}</span>
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
              {/* AC3: 헤더 우상단 고객 검색창 (이름 또는 연락처). graceful: onCreateReservation 미전달 시 숨김 */}
              {onCreateReservation && (
                <div className="w-[230px] shrink-0">
                  <InlinePatientSearch
                    value={searchValue}
                    onChange={setSearchValue}
                    onSelect={handleSelectOtherCustomer}
                    searchField="both"
                    clinicId={reservation.clinic_id}
                    placeholder="이름 또는 연락처로 고객 검색"
                    id="resv-popup-customer-search"
                  />
                </div>
              )}
            </div>
          </DialogHeader>

          {/* T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR: 2구역 전면 재구성.
              1번구역(좌)=고객정보: 검색창 / 환자정보(+담당상담사 relocate) / 활성패키지(relocate) / 치료내역(net-new) / 고객메모(relocate)
              2번구역(우)=예약정보: 예약경로 / 예약등록자 / 미니캘린더 / 선택일자·시간 / 예약메모 / 예약이력(히스토리+변경이력)
              🔒 L-002: 신규예약 생성 capability 불변(팝업 내 reservations.insert 0). chart2 read-only. */}
          <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden min-h-0">

            {/* ── 1번구역 (좌) = 고객정보 ── */}
            <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1" data-testid="popup-zone1-customer">

              {/* AC1: 다른 고객(B) 불러옴 — 1번구역만 교체된 '신규예약 대상' 배너.
                  검색은 헤더 우상단 검색창에서 수행(AC3). 여기서는 로딩 상태 표시 + 원복/등록 안내. */}
              {loadedMatch && (
                <div className="rounded-xl border border-teal-300 bg-teal-50/70 px-3.5 py-2.5 shadow-sm flex-shrink-0" data-testid="popup-loaded-customer-banner">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium text-teal-700">신규예약 대상 (다른 고객 불러옴)</div>
                      <div className="text-sm font-semibold text-teal-800 truncate">{loadedMatch.name}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground shrink-0"
                      onClick={resetToOriginalCustomer}
                      data-testid="btn-reset-original-customer"
                    >
                      원래 고객으로
                    </Button>
                  </div>
                </div>
              )}

              {/* 환자 정보 (+ 담당 상담사 RELOCATE from 2번구역) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">환자 정보</SectionHeader>
                <div className="space-y-1 text-xs">
                  <FieldRow label="이름" value={customer?.name ?? reservation.customer_name ?? '—'} />
                  <FieldRow label="고객번호" value={customer?.chart_number ?? '—'} />
                  {/* T-20260614-foot-RESVPOPUP-RRN-NOBIND: 마스킹 주민번호.
                      1순위) 서버파생 생년월일(birthDisplay)+성별 → YYMMDD-G******.
                      2순위) (RPC 결측 시) customers.birth_date 컬럼 휴리스틱 → YYMMDD-*******.
                      3순위) 둘 다 결측 → '—'(AC-2 placeholder). 평문 rrn 미사용(AC-3). */}
                  <FieldRow
                    label="주민번호"
                    value={
                      maskRrnDisplay(birthDisplay, customer?.gender) ||
                      (customer?.birth_date
                        ? `${customer.birth_date.slice(0, 6)}-*******`
                        : '—')
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

                {/* T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC4: 항목명 "담당 상담사"→"담당자".
                    표시값 raw UUID 노출 버그 수정 — assigned_staff_id 가 consultants/allStaff 에 없어도
                    assignedStaffName(직접 조회) 로 SelectItem 을 보장 생성 → 트리거에 항상 이름 표기(UUID 비노출). */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1.5">담당자</div>
                  {(() => {
                    const inConsultants = consultants.some((c) => c.id === selectedConsultantId);
                    const inAllStaff = allStaff.find((s) => s.id === selectedConsultantId);
                    // consultants 드롭다운에 없는 배정자 → 보장 SelectItem (이름: allStaff → 직접조회 → 친화 fallback)
                    const assignedExtra =
                      selectedConsultantId && !inConsultants
                        ? {
                            id: selectedConsultantId,
                            label: inAllStaff
                              ? (inAllStaff.display_name ?? inAllStaff.name)
                              : (assignedStaffName ?? '이전 담당자'),
                          }
                        : null;
                    return (
                      <Select
                        value={selectedConsultantId || '__none__'}
                        onValueChange={saveConsultant}
                        disabled={consultantSaving || !reservation.customer_id}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid="popup-consultant">
                          {/* AC1: 트리거 표시명을 value→이름으로 직접 해석(아이템 등록 타이밍 무관, UUID 비노출).
                              allStaff(드롭다운 개폐와 무관하게 로드) → assignedStaffName(직접조회) → 친화 fallback. */}
                          <SelectValue placeholder="담당자 선택">
                            {(val) => {
                              if (!val || val === '__none__') return '담당자 선택';
                              return inAllStaff
                                ? (inAllStaff.display_name ?? inAllStaff.name)
                                : (assignedStaffName ?? '이전 담당자');
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">— 미배정 —</SelectItem>
                          {assignedExtra && (
                            <SelectItem value={assignedExtra.id} className="text-xs">
                              {assignedExtra.label} (담당)
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

              {/* T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC5: 활성패키지 = 2번차트 "구매 패키지(티켓)" 양식(read-only).
                  카드(패키지명·발행일·상태) / 총금액 / 시술명·수가·총횟수·사용·잔여 표 / 시술내역(회차·시술명·날짜·담당자). */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0" data-testid="popup-active-packages">
                <SectionHeader accent="teal">활성 패키지</SectionHeader>
                <PackageTicketReadonlyList packages={packages} sessions={packageSessions} />
              </div>

              {/* T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX AC3: 독립 "치료내역" 섹션 제거.
                  패키지 섹션 내 시술내역(usedSessions)으로 치료내역이 함께 노출되므로 별도 섹션 불필요(reporter 지시).
                  ⚠ 본 팝업은 치료내역 read-only — 삭제 핸들러/cascade 로직은 본래 없음(L326 주석: 삭제 핸들러는 팝업 영역 밖).
                  따라서 orphan 핸들러 0. treatments state/fetch 는 §재진 판정(hasPriorVisit, L682)에서 계속 사용 → 유지.
                  섹션 전용 helper(staffName·treatmentSummary)는 데드코드가 되어 제거(상단 정의부). */}

              {/* 고객메모 (RELOCATE: 기존 우하 메모 → 1번구역. 예약메모와 구분: 고객메모≠예약메모) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                {/* AC7: 컬러 텍스트(파랑) 제거 → 전체 흐름 통일(teal 기본) */}
                <SectionHeader accent="teal">고객메모</SectionHeader>
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
                      // T-20260630-foot-FOOTPUSH-ROUTE-TM-REGISTRANT AC-1: 도파민→풋 ingest 예약은
                      //   visit_route 미착지(legacy/미수신)여도 source_system='dopamine' 마커로 'TM' 표시.
                      //   ⚠ 순수 display — state(visitRoute)·DB는 미변경(저장 시 사용자가 명시 선택한 값만 영속).
                      value={resolveVisitRouteDisplay(visitRoute, reservation.source_system) || '__none__'}
                      onValueChange={(v) => setVisitRoute(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1" data-testid="popup-visit-route">
                        <SelectValue placeholder="예약경로 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs">— 미지정 —</SelectItem>
                        {/* W2-DB(item8): 신규 5종 + legacy 인바운드 현재값 보존(visitRouteOptionsFor).
                            ROUTE-TM-REGISTRANT AC-1: 도파민 fallback('TM')도 옵션에 포함되도록 resolved 값 기준. */}
                        {visitRouteOptionsFor(resolveVisitRouteDisplay(visitRoute, reservation.source_system)).map((opt) => (
                          <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 min-w-0 items-center">
                    <span className="text-muted-foreground shrink-0 w-[4.5rem]">예약등록자</span>
                    {/* T-20260630-foot-RESVPOPUP-TM-REGISTRAR-LOCK AC-1: TM 역할은 기존 예약 예약등록자 disabled. */}
                    <Select
                      value={registrarId || '__none__'}
                      onValueChange={(v) => setRegistrarId(v === '__none__' ? '' : v)}
                      disabled={isTmRole}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1" data-testid="popup-registrar">
                        {/* T-20260629-foot-NEWRESV-REGISTRANT-UUID-LABEL AC5(재사용처): 선택값 value→이름 해석(UUID 비노출). */}
                        <SelectValue placeholder="예약등록자 선택">
                          {(val) => resolveRegistrarLabel(val)}
                        </SelectValue>
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
                  T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX AC6: 캘린더 영역의 '예약등록자 필터' 드롭다운 삭제(중복 제거).
                  예약등록자는 상단 '예약 정보' 섹션(편집)만 유지. 캘린더 점표기·예약이력은 전체 예약 표시. */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                <SectionHeader accent="teal">예약 캘린더</SectionHeader>
                <MiniMonthCalendar
                  value={pickedDate}
                  onSelect={(d) => setPickedDate((prev) => (prev && d.getTime() === prev.getTime() ? null : d))}
                  markedDates={visibleResvs
                    .filter((r) => r.status !== 'cancelled')
                    .map((r) => r.reservation_date)}
                />
                {/* T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC1/AC2: 선택 일자 시간대별 예약현황.
                    AC1=날짜클릭(pickedDate)→시간대별 초/재/힐러 카운트. AC2=시간대 클릭→선택(저장은 아래 버튼).
                    🔒 다른 고객(B) 로드 중(loadedMatch)에는 시간선택을 끔 — anchor 예약(A)에 잘못 저장 방지.
                       (B는 신규예약 생성 흐름이며 reservations.update 대상 아님) */}
                <ReservationDayTimeslotPanel
                  date={pickedDate}
                  clinicId={reservation.clinic_id}
                  selectedTime={loadedMatch ? null : selectedSlotTime}
                  onSelectTime={loadedMatch ? undefined : setSelectedSlotTime}
                />
                {/* AC2 Q3=저장 O: 선택 시간으로 현재 예약 시간 변경(저장). visit_type 무접촉(GUARD). */}
                {!loadedMatch && pickedDate && selectedSlotTime && (
                  <div
                    className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2"
                    data-testid="popup-reschedule-bar"
                  >
                    <span className="text-xs text-teal-800">
                      선택: <span className="font-semibold">{format(pickedDate, 'M월 d일', { locale: ko })} {selectedSlotTime}</span>
                    </span>
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={reschedulingTime}
                      onClick={rescheduleToSelectedTime}
                      data-testid="btn-reschedule-time"
                    >
                      {reschedulingTime ? '변경 중…' : '이 시간으로 변경'}
                    </Button>
                  </div>
                )}
              </div>

              {/* T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: 다른 고객(B) 로드 시 '팝업 안에서' 신규예약 생성 폼.
                  검색(헤더) + 미니캘린더 날짜(pickedDate) + 시간 + 초/재 + 생성버튼. 생성은 parent 단일소스 함수 위임.
                  🔒 팝업 내 reservations.insert = 0 — onCreateReservation 콜백만 호출. */}
              {loadedMatch && onCreateReservation && (
                <div
                  className="rounded-xl border border-teal-300 bg-teal-50/50 px-3.5 py-3 shadow-sm flex-shrink-0"
                  data-testid="popup-newmode-form"
                >
                  <SectionHeader accent="teal">신규예약 만들기 — {loadedMatch.name}</SectionHeader>
                  <div className="space-y-2.5">
                    {/* 날짜 (미니캘린더에서 선택) */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-12 shrink-0 text-muted-foreground">날짜</span>
                      {pickedDate ? (
                        <span className="font-medium text-teal-800">{format(pickedDate, 'yyyy-MM-dd (E)', { locale: ko })}</span>
                      ) : (
                        <span className="font-medium text-amber-600">위 캘린더에서 날짜를 선택하세요</span>
                      )}
                    </div>
                    {/* 시간 */}
                    <div className="flex items-center gap-2 text-xs">
                      <Label htmlFor="newmode-time" className="w-12 shrink-0 text-muted-foreground">시간</Label>
                      <select
                        id="newmode-time"
                        value={newResvTime}
                        onChange={(e) => setNewResvTime(e.target.value)}
                        className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        data-testid="newmode-time-select"
                      >
                        {newResvTimeOptions.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    {/* 초/재 선택 */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-12 shrink-0 text-muted-foreground">유형</span>
                      <div className="grid flex-1 grid-cols-2 gap-2">
                        {(['new', 'returning'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setNewResvVisitType(v)}
                            className={cn(
                              'h-9 rounded-md border text-sm font-medium',
                              newResvVisitType === v
                                ? 'border-teal-600 bg-teal-50 text-teal-700'
                                : 'border-input hover:bg-muted',
                            )}
                            data-testid={`newmode-visit-${v}`}
                          >
                            {VISIT_TYPE_KO[v]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 생성 버튼 */}
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={creatingResv || !pickedDate}
                      onClick={submitNewReservation}
                      data-testid="btn-newmode-create"
                    >
                      {creatingResv ? '생성 중…' : `${loadedMatch.name}님 신규예약 생성`}
                    </Button>
                  </div>
                </div>
              )}

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
                      {/* AC5a: '소요 시간' 행 제거(현장 요청) */}
                      {/* AC5b: 과거 내원 이력 존재 시 '재진' 자동 표기(표시 전용, DB 무변경) */}
                      <FieldRow label="초·재진" value={getVisitTypeDisplay(selectedResv)} />
                      {/* T-20260615-foot-RESVMGMT-REFIX-8 AC2 (현장 확정 MSG-...gkj2: "예약 상세 - 예약 등록자 그대로 가져와"):
                          신규 담당자 드롭다운 신설 아님 — 예약상세의 예약 등록자(registrar_name 스냅샷)를 그대로 표시.
                          기존엔 '다른 예약 보기 중'(id !== anchor)일 때만 노출 → 본 예약(anchor) 상세에서도 항상 렌더.
                          데이터 소스 = AC7과 동일(registrar_name). AC7 DB검증 결과(write 무결·생성시 미수집)상 미할당 예약은 '—' graceful. */}
                      <FieldRow label="예약등록자" value={selectedResv.registrar_name ?? '—'} />
                      {selectedResv.id !== reservation.id && (
                        // T-20260630-foot-FOOTPUSH-ROUTE-TM-REGISTRANT AC-1: 도파민 ingest 예약 'TM' 표시(순수 display).
                        <FieldRow label="예약경로" value={resolveVisitRouteDisplay(selectedResv.visit_route, selectedResv.source_system) || '—'} />
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground italic">예약 선택 없음</div>
                  )}
                </div>
              </div>

              {/* AC-4 #5: 예약메모 (현재 보기 예약 기준) */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0">
                {/* AC7: 컬러 텍스트(주황) 제거 → 전체 흐름 통일(teal 기본 + 메모박스 neutral) */}
                <SectionHeader accent="teal">예약메모</SectionHeader>
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
              {/* T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX AC4: 예약이력(카운트 박스) 칸 밖 이탈(8FIX AC6 회귀) 근본수정.
                  RC: zone2 는 flex-col 칼럼이라 자식 flex item 의 기본 min-width:auto 가 콘텐츠 폭을 강제 →
                      좁은 갤탭 뷰포트에서 박스가 칼럼(기입 칸) 우측 경계를 넘어 이탈(데스크톱 E2E 뷰포트에선 미재현).
                  FIX: 박스에 min-w-0 + overflow-hidden 추가 → 칼럼 폭으로 강제 수축, 내부 truncate 가 실제 클립.
                       높이는 리스트 max-h-56 + flex-shrink-0 로 기존대로 한정(세로 폭주도 zone2 스크롤이 흡수). */}
              <div className="rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm flex-shrink-0 flex flex-col min-w-0 overflow-hidden" data-testid="popup-reservation-history">
                <SectionHeader accent="teal">
                  예약이력{visibleResvs.length > 0 && ` (${visibleResvs.length}건)`}
                </SectionHeader>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
                  {visibleResvs.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic py-2">
                      예약 없음
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
                          {/* AC6: 내용이 카드 밖으로 넘치던 문제 — min-w-0/truncate + 배지 shrink-0 으로 박스 안에 가둠 */}
                          <div className="flex items-center justify-between gap-1 min-w-0">
                            <span className="font-medium tabular-nums truncate min-w-0">
                              {r.reservation_date} {r.reservation_time.slice(0, 5)}
                            </span>
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0',
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
            {loadedMatch ? (
              /* T-20260614-foot-RESVPOPUP-AC2-NEWMODE-L002: 다른 고객(B) 조회됨 → 예약(A) 액션 전부 숨김(엉뚱저장 0).
                 신규예약 생성은 위 2번구역 new-mode 폼(생성버튼)에서 완결(모달 스폰 폐기). 푸터는 복귀/닫기만. */
              <>
                <span className="text-xs text-muted-foreground self-center">
                  위 ‘신규예약 만들기’에서 날짜·시간·유형 선택 후 생성하세요.
                </span>
                <Button variant="outline" size="sm" onClick={resetToOriginalCustomer}>
                  원래 고객으로
                </Button>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
                  닫기
                </Button>
              </>
            ) : (
              <>
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
                          setStatus('no_show');
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
                {(reservation.status === 'cancelled' || reservation.status === 'no_show') && (
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
              </>
            )}
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
