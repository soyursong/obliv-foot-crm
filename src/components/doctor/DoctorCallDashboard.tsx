/**
 * DoctorCallDashboard — 진료부 통합 대시보드
 * Ticket: T-20260601-foot-DOCTOR-CALL-PUSH-DASH
 *
 * 진료부가 한 창만 켜놓고 (1) 알람 누적 (2) 처방 (3) 차팅 (4) 진료완료 환자를 모두 처리.
 *   - 알람 누적 피드: 당일 진료 호출(status_flag purple/pink) 시간순 누적.
 *       활성(purple) 상단, 처리완료(pink)는 흐리게 잔존(화면 이탈 후 복귀해도 유지 — DB 파생).
 *   - 신규 호출 수신 시 소리 + 브라우저 알림(useDoctorCallNotifier). 음소거 토글(localStorage 영속).
 *   - 진료 완료(completed_at) 환자 당일 목록.
 *   - 각 행: 차팅(→ 진료차트 MedicalChartPanel 직접 오픈, FOLLOWUP3 C-1) · 처방(QuickRxBar 인라인) 진입.
 *
 * 데이터 모델: 풋 CRM의 진료 호출 = check_ins.status_flag (별도 doctor_call 테이블 없음).
 *   기존 발신/상태머신/집계 로직은 변경하지 않고 표시만 추가(회귀 0).
 * 실시간: check_ins postgres_changes 구독 → refetch (3초 내 반영, AC-1).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Stethoscope,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  Pill,
  MapPin,
  CheckCircle2,
  Loader2,
  Hand,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
// T-20260603-foot-RX-CHART-FOLLOWUP3 C-1 (문지은 대표원장, 현장 승인): 진료알림판 차팅 진입은
//   '진료차트'(MedicalChartPanel)를 직접 열어야 함. FOLLOWUP2 #6에서 useChart().openChart()(2번차트
//   서랍=펜차트/기본차트)로 라우팅했으나, 현장이 기대한 것은 진단/경과/처방을 보는 '진료차트'였음.
//   → Dashboard.tsx handleOpenMedicalChart 패턴 재사용(로컬 MedicalChartPanel 렌더). 2번차트 서랍 게이트웨이
//   (CHART-LOCK-011)는 다른 진입점에 그대로 유지되며, 본 화면만 진료차트 직접 오픈으로 정정.
import MedicalChartPanel from '@/components/MedicalChartPanel';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { todaySeoulISODate, chartNoDisplay, birthYearAgeDisplay } from '@/lib/format';
import { getAssignedSlotName } from '@/lib/checkin-slot';
import {
  loadMute,
  saveMute,
  loadNotifyEnabled,
  saveNotifyEnabled,
  getCallTime,
  callKey,
  elapsedMinutes,
  formatElapsedPlus,
} from '@/lib/doctor-call-notify';
import { checkRxInClinic } from '@/lib/inClinicRxGate';
import {
  useDoctorCallNotifier,
  requestNotifyPermission,
  currentNotifyPermission,
} from '@/hooks/useDoctorCallNotifier';
import QuickRxBar, { isDoctor, RxConfirmedSummary } from './QuickRxBar';
// T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2): 처방완료 펼침(읽기) 전문 — 약 1건당 '약물명 1/3/2' 토큰(RX-TOKEN-FORMAT SSOT).
import { formatRxItemToken } from '@/lib/rxTooltip';
import { recordAck, isDoctorAcked } from './DoctorAck';
import { applyStatusFlagTransition, type FlagTransitionActor } from '@/lib/statusFlagTransition';
import type { CheckIn } from '@/lib/types';

const CALL_SELECT =
  'id, customer_id, customer_name, visit_type, status, status_flag, status_flag_history, ' +
  'checked_in_at, completed_at, treatment_kind, treatment_category, prescription_status, prescription_items, ' +
  'doctor_call_memo, doctor_ack_at, queue_number, consultation_room, treatment_room, laser_room, examination_room, ' +
  // T-20260612-foot-CHARTNO-B2-P1: 이름 셀 차트번호 인접 표기용 join(KohReportTab 패턴). read-only, DB 무변경.
  // T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: 생년(만나이) 칼럼용 birth_date 추가(read-only, 파생표기). DB 무변경.
  'customers!customer_id(chart_number, birth_date)';

// T-20260612-foot-DOCDASH-TABLE-BTN-MINIMIZE (문지은 대표원장 follow-up):
//   테이블 셀 액션을 '버튼 박스(bg/border)' → 텍스트/아이콘 링크로 축소. 클릭 동선은 유지(기능 제거 아님).
//   컬러는 상태 dot 1~2색만, 액션·아이콘은 무채색 텍스트 톤. chevron(펼침 화살표)은 전면 제거(aria-expanded로 상태 표현).
const CELL_ACTION_BTN =
  'inline-flex items-center gap-1 px-1 py-1 text-[13px] font-medium text-gray-600 transition-colors ' +
  'hover:text-gray-900 hover:underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:hover:no-underline';

// T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2 (문지은 대표원장, ts 1781527085 spec_correction):
//   '차트' 칼럼(📝 임상경과 토글 + 🩺 진료차트 서랍 이모지 버튼)을 헤더+셀 통째로 제거.
//   동선 보존(신규 진입점으로 대체): 진료차트(🩺) → 이름 텍스트 클릭(item1, onOpenChart 'full'),
//   임상경과(📝) → 임상경과 빈값 '—' 클릭(item3, showClinical 토글). CHART_CELL_EMOJI_BTN 더 이상 미사용으로 제거.

// T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE AC-3/AC-4 (문지은 대표원장, 변경 불가):
//   양 섹션(진료 대기중·진료 완료)을 동일 flat 테이블로 통일 — 칼럼 너비/순서/스키마 '완전 동일'.
//   8칼럼 고정 순서: 이름 | 상태 | 경과시간 | 방 | 오늘시술 | 처방 | 임상경과 | 진료차트.
//   colgroup·thead는 두 테이블에 '글자 그대로 동일'하게 인라인(아래 DOCDASH_COLGROUP/DOCDASH_THEAD 주석 기준) —
//   양쪽 폭/순서가 동일함을 시각·테스트로 함께 보장. 인라인 펼침 행 colSpan 도 8칼럼 고정.
//   T-20260612-WAITELAPSED-POLISH AC-2: 헤더 '콜경과시간' → '경과시간'. AC-6: 헤더·셀 텍스트 중앙정렬.
//   T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7 (문지은 대표원장 실사용 후속, POLISH AC-4 supersede):
//     진료 완료 섹션은 경과시간을 '-'로 두지 않고 칼럼 자체를 제거 → 완료환자는 대기시간 불요(7칼럼).
//     호출(진료 대기중) 섹션은 경과시간 8칼럼 그대로 유지. 두 테이블은 별도 <table> 이라 폭 정렬은 시각적 독립.
// T-20260612-foot-CHARTNO-COL-SPLIT-P1 (문지은 대표원장, §13.1.A reporter 권위로 B2-P1 supersede):
//   차트번호를 이름 칸 내 서브텍스트가 아니라 이름 칼럼 '바로 옆 독립 칼럼'으로 분리. 각 테이블 칼럼 +1.
// T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-3 (문지은 대표원장): 진료차트 별도 칼럼 제거(이름 옆 이모지 버튼으로 대체).
//   진료 대기중 9→8칼럼: 이름·차트번호·상태·경과시간·방·오늘시술·처방·임상경과. (이름 셀에 임상경과/진료차트 이모지 버튼 내장)
//   진료 완료 8→7칼럼: 경과시간 제거(UX7 AC-7) + 진료차트 제거 → 이름·차트번호·상태·방·오늘시술·처방·임상경과.
// T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-3 (문지은 대표원장): 칼럼 재배치 + 차트 칼럼 신설.
//   진료 대기중 9칼럼: 이름·차트번호·상태(✋)·시간·방·오늘시술·임상경과·처방·차트. (임상경과=처방 왼쪽, 차트=처방 오른쪽 신설)
//   진료 완료 8칼럼: 이름·차트번호·상태(✋)·방·오늘시술·임상경과·처방·차트 (경과시간 제거 UX7 유지).
// T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1 (문지은 대표원장, MONOTONE-RELAYOUT supersede 컬럼순서):
//   재배치 좌→우: 방 | 상태 | 이름 | 생년(만나이) | 차트번호 | 오늘시술 | 차트 | 처방 | 임상경과.
//   · 생년(만나이) = 신설 칼럼(customers.birth_date 파생 "YYYY (만 N세)").
//   · 시간(경과시간) 칼럼: 본 요청 순서 미포함이나 AC-1 dev판단 '기본 보존' → 대기(호출) 테이블 맨 끝에 보존
//     (요청 9칼럼 순서를 contiguous prefix 로 그대로 유지, 시간만 끝에 append = 10칼럼). responder confirm 대상.
//   · 완료 테이블은 경과시간이 UX7 에서 이미 제거(완료환자 대기시간 불요) → 9칼럼(시간 없음).
// T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2: '차트' 칼럼 제거 → 10→9칼럼.
// T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1(문지은 대표원장): 별도 '시간(경과시간)' 칼럼 제거 →
//   "+N분"을 상태 셀 ✋ 옆 인라인으로 이전. 두 테이블 모두 9→8칼럼.
const DOCDASH_COLSPAN = 8; // 진료 대기중(호출): 방·상태(✋+N분)·이름·생년·차트번호·오늘시술·처방·임상경과
const DOCDASH_COMPLETED_COLSPAN = 8; // 완료 테이블도 대기와 동일 8칼럼(시간 칼럼 제거)

// T-20260612-foot-CHARTNO-B2-P1: customers 임베드(to-one)에서 차트번호 안전 추출.
//   PostgREST 임베드는 object|array 양쪽으로 직렬화될 수 있어 둘 다 흡수(KohReportTab 흡수 패턴 동일).
function readChartNo(ci: CheckIn): string | number | null | undefined {
  const c = ci.customers as
    | { chart_number?: string | null }
    | Array<{ chart_number?: string | null }>
    | null
    | undefined;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.chart_number ?? null;
  return c.chart_number ?? null;
}

// T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: 생년(만나이) 칼럼용 birth_date 안전 추출(readChartNo 흡수 패턴 동일).
function readBirthDate(ci: CheckIn): string | null | undefined {
  const c = ci.customers as
    | { birth_date?: string | null }
    | Array<{ birth_date?: string | null }>
    | null
    | undefined;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.birth_date ?? null;
  return c.birth_date ?? null;
}

// T-20260612-foot-DOCDASH-RXCELL-REFINE item2/AC-2 (문지은 대표원장):
//   처방 드롭다운이 "행 전체폭 펼침행(<td colSpan>)"으로 떠 다른 행을 밀어내던 것을 →
//   처방(알약) 버튼에 anchor된 portal+fixed 팝오버로 전환. 행을 밀지 않고 알약 근처에만 뜸.
//   좌표 선례 재사용: QuickRxButton 툴팁(createPortal+position:fixed+getBoundingClientRect+viewport clamp)
//   = CLINICAL-SINGLELINE-DROPDOWN-POS / PHRASE-SLASH-DROPDOWN-POS 패턴(신규 패키지·좌표 로직 난발 0).
//   하단 행에서 아래 공간 부족 시 위쪽으로 열어 viewport 밖 잘림 방지(up/down clamp).
//   QuickRxBar 내부·저장·취소 로직은 children 으로 그대로 주입 — 컨테이너 위치/형태만 변경.
const RX_POPOVER_W = 320; // max-w-xs(20rem) 환산. 처방 셀 근처 폭(행 전체폭 아님).

function RxPopover({
  open,
  anchorRef,
  onClose,
  children,
  testId,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'down' | 'up' } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function compute() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 가로: 알약 좌측 기준 + 우측 화면 이탈 방지 clamp(8px 여백) — QuickRxButton 툴팁 선례와 동일.
      const left = Math.max(8, Math.min(r.left, vw - RX_POPOVER_W - 8));
      // 세로: 콘텐츠 높이 측정 후 아래 공간 부족 + 위 공간 더 넓으면 위쪽으로(하단 행 잘림 방지).
      const estH = popRef.current?.offsetHeight ?? 220;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      let placement: 'down' | 'up' = 'down';
      let top = r.bottom + 6;
      if (spaceBelow < estH + 12 && spaceAbove > spaceBelow) {
        placement = 'up';
        top = Math.max(8, r.top - estH - 6);
      }
      setPos({ top, left, placement });
    }
    compute();
    // 콘텐츠 렌더 후 실제 높이로 1회 재계산(up/down 정확도).
    const raf = requestAnimationFrame(compute);
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open, anchorRef]);

  // 바깥 클릭 + Esc 로 닫기(앵커 버튼 클릭은 토글이 처리하므로 제외).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={popRef}
      data-testid={testId}
      data-placement={pos.placement}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: RX_POPOVER_W, zIndex: 9999 }}
      className="rounded-lg border bg-white p-2 shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

// T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM 재정의 — 문지은 대표원장 MSG-20260614-213335-rdin):
//   종전(05b0453, 무효): 처방완료/임상경과 셀 클릭 → '행 전체폭 펼침행(<tr colSpan>)'으로 아래 인라인 확장.
//     → 다른 컬럼(환자명·시간·생년) 시야를 가리는 문제. full-width row expand 폐기.
//   변경: 클릭한 '해당 컬럼 폭 범위 안에서만' 셀 바로 아래로 드롭다운/팝오버처럼 열림(대표원장 "약간 아래에 드롭다운 열리듯이").
//     · 폭 = 앵커 셀(=컬럼) 폭 → 가로로 다른 컬럼 절대 침범 0(비가림 보장).
//     · 전문이 길면 컬럼 폭 안에서 줄바꿈(break-words) + 세로 스크롤(max-h + overflow-y-auto).
//     · 좌표·바깥클릭 닫힘·up/down clamp = RxPopover( = CHART-CLINICAL-CLICKOUTSIDE mousedown) 패턴 그대로 재사용 — 신규 토글 컴포넌트 난립 0.
//   → 기존 EXPAND-CLINICAL/EXPAND-COURSE-RXHISTORY 펼침 엔진을 column-anchored popover 레이아웃으로 리워크(상태축 expandRx/expandClinical 보존).
function ColumnExpandPopover({
  open,
  anchorRef,
  onClose,
  children,
  testId,
  widthScale = 1,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
  /**
   * T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item2(문지은 대표원장): 처방 드롭다운만 폭 ×2(가독성).
   *   policy_superseded: f8ad7a9 '비가림(폭=앵커 컬럼폭)' 설계를 rx 드롭다운 한정 역전(reporter-explicit 예외).
   *   left clamp 로 우측 화면 이탈만 방지(다른 드롭다운=임상경과는 widthScale=1 유지, 무회귀).
   */
  widthScale?: number;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; placement: 'down' | 'up' } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function compute() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 폭 = 앵커 셀(컬럼) 폭 × widthScale — 기본 1(비가림). item2: rx 드롭다운만 ×2(가독성). 셀 좌측 정렬, 우측 이탈 clamp.
      const width = Math.min(r.width * widthScale, vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      // 세로: 아래 공간 부족 + 위 공간 더 넓으면 위쪽으로(하단 행 잘림 방지) — RxPopover 선례 동일.
      const estH = popRef.current?.offsetHeight ?? 160;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      let placement: 'down' | 'up' = 'down';
      let top = r.bottom + 4;
      if (spaceBelow < estH + 12 && spaceAbove > spaceBelow) {
        placement = 'up';
        top = Math.max(8, r.top - estH - 4);
      }
      setPos({ top, left, width, placement });
    }
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open, anchorRef, widthScale]);

  // 바깥 클릭 + Esc 닫기(앵커 셀 클릭은 본문 토글이 처리하므로 제외) — CHART-CLINICAL-CLICKOUTSIDE mousedown 패턴.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={popRef}
      data-testid={testId}
      data-placement={pos.placement}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="max-h-[60vh] overflow-y-auto rounded-lg border bg-white shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

// T-20260614-foot-CHART-CLINICAL-CLICKOUTSIDE (문지은 대표원장) — CANON narrow (FIX-REQUEST MSG-20260614-181732):
//   ↩ 정정: 8b14746 은 "차트 📝 토글(showClinical) 전체를 외부클릭 시 닫는다"는 coarse 선해석(OVERSHOOT)이었다.
//   reporter(17:48) 명확화 = "진료의 ___ 토글 누르면 드롭다운 열려 수정상태, 다른데 커서 옮기면 [라벨로] 원복".
//   즉 닫혀야 할 대상은 'showClinical embed 전체'가 아니라 '진료의 select(editingSingleDoctor)' 하나뿐이다.
//   embed 전체 닫힘은 (a) "진료의 ○○○" 읽기 라벨까지 사라지고(reporter 라벨 유지 기대 위배),
//   (b) 작성 중 임상경과 한 줄 입력 미저장분을 언마운트로 폐기(data-loss)시켜 canon 위배.
//   → CANON = embed 전체 외부클릭 닫힘 동작을 제거(data-loss 0, 라벨 유지). 진료의 select 만의 click-away
//     라벨 원복은 MedicalChartPanel(editingSingleDoctor 상태 소유자, 아키텍처상 올바른 자리)의 단일 핸들러
//     (item②, commit 7f6cd8b)가 담당 — clickOutside(mousedown) 패턴 재사용, 중복 핸들러 신설 없음.
//   showClinical 토글 닫힘은 오직 📝 버튼 재클릭(onClick)으로만. 외부클릭은 embed 를 닫지 않음.

function useDoctorCallFeed(clinicId: string | null) {
  return useQuery({
    queryKey: ['doctor_call_dashboard', clinicId],
    enabled: !!clinicId,
    queryFn: async (): Promise<CheckIn[]> => {
      if (!clinicId) return [];
      // 당일·KST 범위 (DoctorPatientList와 동일한 KST 바운드 컨벤션)
      const today = todaySeoulISODate();
      const { data, error } = await supabase
        .from('check_ins')
        .select(CALL_SELECT)
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${today}T00:00:00+09:00`)
        .lte('checked_in_at', `${today}T23:59:59+09:00`)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CheckIn[];
    },
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}

// T-20260612-foot-DOCDASH-11FIX AC-11: 진료완료 환자 테이블 '임상경과' 1줄 미리보기용 조회.
//   medical_charts(당일·KST visit_date) 에서 환자별 최신 clinical_progress 를 읽어 customer_id → text 맵으로 반환.
//   read-only(스키마 무변경). 진료완료 테이블에만 사용 — 다른 surface 비간섭.
function useCompletedClinicalProgress(clinicId: string | null) {
  return useQuery({
    queryKey: ['docdash_completed_clinical', clinicId],
    enabled: !!clinicId,
    queryFn: async (): Promise<Map<string, string>> => {
      if (!clinicId) return new Map();
      const today = todaySeoulISODate();
      const { data, error } = await supabase
        .from('medical_charts')
        .select('customer_id, clinical_progress, updated_at')
        .eq('clinic_id', clinicId)
        .eq('visit_date', today)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as Array<{ customer_id: string | null; clinical_progress: string | null }>) {
        if (!r.customer_id) continue;
        const text = (r.clinical_progress ?? '').trim();
        // updated_at desc 정렬 → 환자별 첫 비어있지 않은 값이 최신.
        if (text && !map.has(r.customer_id)) map.set(r.customer_id, text);
      }
      return map;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export default function DoctorCallDashboard() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const doctorMode = isDoctor(profile?.role ?? '');
  // T-20260610-foot-TREATMENT-COMPLETE-BTN: 진료완료 처리자 기록(의료 추적) — 의사/직원 공통.
  const actor: FlagTransitionActor = useMemo(
    () => ({ id: profile?.id ?? null, name: profile?.name ?? null, role: profile?.role ?? null }),
    [profile?.id, profile?.name, profile?.role],
  );
  // T-20260603-foot-RX-CHART-FOLLOWUP3 C-1: 차팅 클릭 → '진료차트'(MedicalChartPanel) 직접 오픈.
  //   FOLLOWUP2 #6은 2번차트 서랍(펜차트=기본차트)으로 열려 현장 의도(진단/경과/처방 진료차트)와 어긋났음.
  //   Dashboard 패턴 재사용 — 로컬 상태로 MedicalChartPanel 단독 오픈.
  // T-20260609-foot-CHARTBTN-MINIMAL-COURSE-DRAWER (진입점 분기, AC-1/2/3):
  //   '차팅' 버튼 → 미니멀 임상경과(variant='clinical'), '차트 열기' 버튼 → 전체 진료차트(variant='full').
  //   둘 다 같은 MedicalChartPanel·같은 medical_charts 소스(AC-3) — variant 상태로 모드만 분기.
  const [medicalChartCustomerId, setMedicalChartCustomerId] = useState<string | null>(null);
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  const [medicalChartVariant, setMedicalChartVariant] = useState<'full' | 'clinical'>('clinical');
  const openTreatmentChart = (customerId: string, variant: 'full' | 'clinical' = 'clinical') => {
    setMedicalChartCustomerId(customerId);
    setMedicalChartVariant(variant);
    setMedicalChartOpen(true);
  };

  const queryClient = useQueryClient();
  const { data: rows = [], isLoading, refetch } = useDoctorCallFeed(clinicId);
  // T-20260612-foot-DOCDASH-11FIX AC-11: 진료완료 환자 임상경과 미리보기 맵(customer_id → 최신 1줄).
  // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-3: 인라인 임상경과 저장 직후 미리보기 칼럼 즉시 반영용 refetch.
  const { data: clinicalMap, refetch: refetchClinical } = useCompletedClinicalProgress(clinicId);

  // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3 (지연 해소): 3FIX 의 refetch 트리거만으로는
  //   useCompletedClinicalProgress 재조회(Supabase 왕복) 동안 미리보기가 옛 값/빈값으로 남아 체감 지연이 남았다.
  //   → 저장 콜백에서 방금 저장한 본문으로 미리보기 맵(queryKey ['docdash_completed_clinical', clinicId])을
  //     optimistic 갱신(0지연 반영) 후 refetchClinical 로 백그라운드 정합. 데이터 CRUD/스키마 불변(캐시 표시만).
  const applyClinicalOptimistic = useCallback(
    (customerId: string | null, savedText?: string) => {
      if (customerId) {
        const text = (savedText ?? '').trim();
        queryClient.setQueryData<Map<string, string>>(
          ['docdash_completed_clinical', clinicId],
          (old) => {
            const next = new Map(old ?? []);
            if (text) next.set(customerId, text);
            else next.delete(customerId);
            return next;
          },
        );
      }
      void refetchClinical();
    },
    [queryClient, clinicId, refetchClinical],
  );

  // 음소거 (localStorage 영속, AC-2)
  const [muted, setMuted] = useState<boolean>(() => loadMute());
  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      saveMute(next);
      return next;
    });
  };

  // 브라우저 알림 권한 상태
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    currentNotifyPermission(),
  );
  const askPermission = async () => {
    const result = await requestNotifyPermission();
    setPerm(result);
    if (result === 'granted') toast.confirm('브라우저 알림이 켜졌어요.');
    else if (result === 'denied')
      toast.warning('알림 권한이 거부됨 — 화면 토스트로 대신 알려드려요.');
  };

  // 앱레벨 알림 on/off (localStorage 영속, T-20260609 ALARM-TOGGLE-OFF).
  //   브라우저 권한이 granted여도 앱이 푸시/토스트를 안 띄우게 직접 끌 수 있음.
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => loadNotifyEnabled());
  const toggleNotify = () => {
    setNotifyEnabled((on) => {
      const next = !on;
      saveNotifyEnabled(next);
      toast.confirm(next ? '진료 호출 알림을 켰어요.' : '진료 호출 알림을 껐어요.');
      return next;
    });
  };

  // 실시간 구독 — 호출 발생/변경 즉시 refetch (3초 내 반영)
  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel(`doctor_call_dash_${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'check_ins', filter: `clinic_id=eq.${clinicId}` },
        () => {
          void refetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clinicId, refetch]);

  // 진료 대기중 = 활성 호출(purple)만. completed_at(귀가/완료) 보유는 제외.
  // T-20260612-foot-DOCDASH-WAITELAPSED-POLISH AC-1 (문지은 대표원장 '아직도 완료가 있다' 재신고 근본 제거):
  //   ▸ 잔존 경로 진단(실코드 추적): 부모 SECTION-RESTRUCTURE 는 진료 대기중 feed 를 activeCalls + pink호출 을
  //     이어붙여, 진료완료(status_flag='pink', completed_at 없음=원내잔류) 환자를 '진료완료' 라벨로 대기중에
  //     흐리게 잔존시켰다(구주석). 이 pink 행 + 완료 카운트 plain-text 가 현장이 본 '완료'의 정체.
  //   ▸ 근본 제거: feed 에서 pink 를 완전 분리 → 진료 대기중에는 activeCalls(purple)만. 완료 카운트 위젯 제거.
  //   ▸ STATUS-SPLIT 보존(AC-0): pink(원내잔류) 환자를 삭제하지 않고 '진료 완료' 섹션으로 이전한다.
  //     CompletedRow 의 처방게이트는 status==='done'(귀가)만 차단 → pink(원내잔류, status≠done)는 처방 허용 유지.
  // AC-5: 경과시간 내림차순(급한순=가장 오래 기다린 순) = 호출시각 오름차순(가장 이른 콜 상단).
  //   DOCTORCALL-SORT(WS-1, 신규상단)와 충돌 시 본건 우선(현장 '급한 환자 위로').
  const activeCalls = useMemo(
    () =>
      rows
        .filter((ci) => ci.status_flag === 'purple' && !ci.completed_at)
        .sort((a, b) => getCallTime(a).localeCompare(getCallTime(b))),
    [rows],
  );

  // 진료 완료 — completed_at(귀가/원내잔류-시술완료) 보유 OR status_flag='pink'(진료완료 처리, completed_at 미발생).
  // T-20260612-foot-WAITELAPSED-POLISH AC-1: pink 원내잔류를 여기로 이전(STATUS-SPLIT 처방허용 surface 보존).
  //   정렬키 = completed_at ?? getCallTime(콜시각) 내림차순 → 최근 처리/완료가 상단(0건도 빈 배열 정상 렌더, AC-9).
  const completedPatients = useMemo(
    () =>
      rows
        .filter((ci) => ci.completed_at || ci.status_flag === 'pink')
        .sort((a, b) =>
          (b.completed_at ?? getCallTime(b)).localeCompare(a.completed_at ?? getCallTime(a)),
        ),
    [rows],
  );

  // T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY ⑤: 진료완료 섹션 처방상태 필터 태그.
  //   재활용 SSOT = DoctorPatientList 처방환자목록 필터(prescription_status 'pending'/'confirmed').
  //   전체 / 처방확인대기(pending) / 처방완료(confirmed). 표시 대상 행만 축소 — CompletedRow 로직 무변경(회귀 0).
  const [completedFilter, setCompletedFilter] = useState<'all' | 'pending' | 'confirmed'>('all');
  const completedPendingCount = useMemo(
    () => completedPatients.filter((ci) => ci.prescription_status === 'pending').length,
    [completedPatients],
  );
  const completedConfirmedCount = useMemo(
    () => completedPatients.filter((ci) => ci.prescription_status === 'confirmed').length,
    [completedPatients],
  );
  const filteredCompleted = useMemo(
    () =>
      completedFilter === 'all'
        ? completedPatients
        : completedPatients.filter((ci) => ci.prescription_status === completedFilter),
    [completedPatients, completedFilter],
  );

  // 소리 + 브라우저 알림 (신규 호출 감지). 앱레벨 알림 OFF면 OS배너/토스트 생략(소리는 muted 별도).
  useDoctorCallNotifier(activeCalls, { muted, notifyEnabled });

  // 진료 대기중 표시 명단 = activeCalls(purple)만. AC-1: pink 누수 제거.
  const feed = activeCalls;

  return (
    <div className="space-y-4" data-testid="doctor-call-dashboard">
      {/* 헤더 — 음소거 / 알림 권한 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-red-600" />
          <div>
            <p className="text-sm font-bold">진료부 통합 대시보드</p>
            <p className="text-xs text-muted-foreground">
              호출 알람·처방·차팅·진료완료를 한 화면에서 확인해요.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMute}
            data-testid="doctor-call-mute-toggle"
            aria-pressed={muted}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium min-h-[40px] transition-colors',
              muted
                ? 'border-gray-300 bg-gray-100 text-gray-600'
                : 'border-teal-300 bg-teal-50 text-teal-700',
            )}
            title={muted ? '소리 켜기' : '소리 끄기'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {muted ? '소리 켜기' : '소리 끄기'}
          </button>
          {/* 브라우저 알림 권한이 default(미요청)일 때만 권한 요청 버튼 */}
          {perm === 'default' && (
            <button
              type="button"
              onClick={askPermission}
              data-testid="doctor-call-notify-permission"
              className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 min-h-[40px] hover:bg-amber-100"
              title="브라우저 알림 켜기"
            >
              <BellOff className="h-4 w-4" />
              알림 켜기
            </button>
          )}
          {/* 권한 결정됨(granted/denied) → 앱레벨 알림 on/off 토글(영속).
              T-20260609 ALARM-TOGGLE-OFF: granted여도 앱 푸시를 직접 끌 수 있어야 함. */}
          {perm !== 'default' && perm !== 'unsupported' && (
            <button
              type="button"
              onClick={toggleNotify}
              data-testid="doctor-call-notify-toggle"
              aria-pressed={!notifyEnabled}
              title={notifyEnabled ? '진료 호출 알림 끄기' : '진료 호출 알림 켜기'}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium min-h-[40px] transition-colors',
                notifyEnabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-gray-300 bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {notifyEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {notifyEnabled ? '알림 끄기' : '알림 켜기'}
            </button>
          )}
        </div>
      </div>

      {/* 진료 대기중 — T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE AC-2(제목)·AC-3(테두리 제거, flat) */}
      <section className="bg-white" data-testid="doctor-call-feed">
        <div className="flex items-center gap-2 px-1 py-2">
          {/* T-20260612-foot-DOCDASH-11FIX AC-1: 전화 아이콘 제거 → 호출 알람 의미의 Bell 로 교체. */}
          <Bell className="h-4 w-4 text-red-600" />
          <span className="text-sm font-semibold text-gray-800">진료 대기중</span>
          {/* T-20260615-foot-DOCDASH-WAITDONE-ALIGN-CNTNUM (문지은 대표원장): '진료필요' 라벨 제거 → 숫자만 크게·볼드.
              섹션 제목 「진료 대기중」 + 행 상태 라벨에 '진료필요'가 이미 있어 배지 라벨은 중복. (WAITELAPSED-POLISH AC-1 plain text 갱신) */}
          <span className="text-2xl font-bold text-red-600" data-testid="doctor-call-active-count">
            {activeCalls.length}
          </span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : feed.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            오늘 진료 호출이 아직 없어요.
          </div>
        ) : (
          // T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE AC-3/AC-4: 공유 colgroup/thead 로 진료 완료 섹션과 칼럼 폭·순서 완전 동일.
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-[15px]" data-testid="doctor-call-feed-table">
              {/* DOCDASH_COLGROUP — T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1(문지은 대표원장, MONOTONE 컬럼순서 supersede): 10칼럼, 합 100%.
                  T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE: EXPAND-QUICKEDIT 배포본(방5·상태9·이름11·처방24) 기준 비율 축소.
                  방 ×0.75(5→4) · 상태 ×0.75(9→7) · 이름 ×0.50(11→6) · 처방 ×0.50(24→12). 해방된 20%p 전량을 임상경과 본문(14→34)에 재분배(나머지 불변).
                  순서·합 100%: 방 4 · 상태(✋) 7 · 이름 6 · 생년(만나이) 9 · 차트번호 8 · 오늘시술 9 · 차트 6 · 처방 12 · 임상경과 34 · 시간 5.
                  T-20260615-foot-DOCDASH-STATNAME-WIDEN-CENTER: 상태 7→8·이름 6→7(×1.2 재확대), 임상경과 34→32(차감 흡수). 합 100%.
                  T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2: '차트' 칼럼(6%) 제거 → 해방 6%p 전량 임상경과(32→38)에 재분배. 9칼럼 합 100%.
                  T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: '시간(경과시간)' 칼럼(5%) 제거 → 해방 5%p 전량 임상경과(32→37)에 재분배. 8칼럼 합 100%. */}
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                {/* T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item3(문지은 대표원장): 처방 12%→18%(×1.5).
                    +6%p 는 임상경과(38→32)에서 흡수 — 합 100% 유지, 타 컬럼 불변, 양 테이블 동일. */}
                <col className="w-[18%]" />
                <col className="w-[37%]" />
              </colgroup>
              {/* DOCDASH_THEAD — 3FIX item2: 방·상태·이름·생년·차트번호·오늘시술·처방·임상경과 ('차트'·'시간' 칼럼 제거). */}
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-center text-[13px] font-semibold text-muted-foreground">
                  <th className="px-1.5 py-1">방</th>
                  <th className="px-1.5 py-1">상태</th>
                  <th className="px-1.5 py-1">이름</th>
                  <th className="px-1.5 py-1">생년(만나이)</th>
                  <th className="px-1.5 py-1">차트번호</th>
                  <th className="px-1.5 py-1">오늘시술</th>
                  <th className="px-1.5 py-1">처방</th>
                  <th className="px-1.5 py-1">임상경과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100" data-testid="doctor-call-feed-rows">
                {feed.map((ci) => (
                  <CallFeedRow
                    key={callKey(ci)}
                    checkIn={ci}
                    doctorMode={doctorMode}
                    role={profile?.role ?? ''}
                    clinicId={clinicId ?? ''}
                    currentUserEmail={profile?.email ?? null}
                    actor={actor}
                    /* T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-3: 끝 임상경과 칼럼 미리보기(저장 즉시 반영). */
                    clinicalPreview={ci.customer_id ? clinicalMap?.get(ci.customer_id) ?? null : null}
                    onOpenChart={openTreatmentChart}
                    onRefresh={() => void refetch()}
                    /* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3: 저장 본문으로 미리보기 optimistic 0지연 반영 + 백그라운드 정합. */
                    onClinicalSaved={(saved) => applyClinicalOptimistic(ci.customer_id, saved)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 진료 완료 — T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE AC-2(제목)·AC-3(테두리 제거, flat) */}
      <section className="bg-white" data-testid="doctor-completed-section">
        <div className="flex items-center gap-2 px-1 py-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-gray-800">진료 완료</span>
          {/* AC-5: 카운트는 배지가 아니라 plain text. */}
          <span className="text-xs font-medium text-emerald-600">{completedPatients.length}명</span>
        </div>
        {/* T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY ⑤: 처방상태 필터 태그(전체/처방확인대기/처방완료).
            DoctorPatientList 처방환자목록 태그 컴포넌트 스타일 재활용. 완료 환자가 1명 이상일 때만 노출. */}
        {completedPatients.length > 0 && (
          <div className="flex gap-1 px-1 pb-2" data-testid="doctor-completed-filter">
            {[
              { key: 'all' as const, label: `전체 (${completedPatients.length})` },
              { key: 'pending' as const, label: `처방확인 대기 (${completedPendingCount})` },
              { key: 'confirmed' as const, label: `처방완료 (${completedConfirmedCount})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCompletedFilter(key)}
                data-testid={`doctor-completed-filter-${key}`}
                aria-pressed={completedFilter === key}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  completedFilter === key
                    ? 'bg-teal-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {completedPatients.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            아직 진료 완료된 환자가 없어요.
          </div>
        ) : filteredCompleted.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="doctor-completed-filter-empty">
            {completedFilter === 'pending'
              ? '처방 확인 대기중인 환자가 없어요.'
              : '처방 완료된 환자가 없어요.'}
          </div>
        ) : (
          // T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7: 진료 완료 섹션은 경과시간(시간) 값은 표시 안 함(완료환자 대기시간 불요).
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-[15px]" data-testid="doctor-completed-table">
              {/* COMPLETED COLGROUP — T-20260615-foot-DOCDASH-WAITDONE-ALIGN-CNTNUM (문지은 대표원장):
                  진료대기↔진료완료 두 테이블 칼럼 세로경계를 픽셀단위 일치(같은 테이블처럼). 접근(a): 완료 테이블을
                  대기 테이블과 '글자 그대로 동일' 10칼럼 colgroup 으로 맞추고, 시간 칼럼은 빈칸 placeholder(값 미표시, UX7 유지).
                  폭 = STATNAME-WIDEN-CENTER 확정 대기 실폭과 1:1 동일.
                  T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2: '차트' 칼럼(6%) 제거 → 임상경과 32→38 재분배 (대기 테이블과 동일). 9칼럼 합 100%.
                  T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: '시간' placeholder 칼럼(5%) 제거 → 임상경과 32→37 (대기 테이블과 동일). 8칼럼 합 100%. */}
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                {/* T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item3(문지은 대표원장): 처방 12%→18%(×1.5).
                    +6%p 는 임상경과(38→32)에서 흡수 — 합 100% 유지, 타 컬럼 불변, 양 테이블 동일. */}
                <col className="w-[18%]" />
                <col className="w-[37%]" />
              </colgroup>
              {/* COMPLETED THEAD — WAITDONE-ALIGN: 대기 테이블과 동일 순서·폭('차트'·'시간' 칼럼 제거). */}
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-center text-[13px] font-semibold text-muted-foreground">
                  <th className="px-1.5 py-1">방</th>
                  <th className="px-1.5 py-1">상태</th>
                  <th className="px-1.5 py-1">이름</th>
                  <th className="px-1.5 py-1">생년(만나이)</th>
                  <th className="px-1.5 py-1">차트번호</th>
                  <th className="px-1.5 py-1">오늘시술</th>
                  <th className="px-1.5 py-1">처방</th>
                  <th className="px-1.5 py-1">임상경과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100" data-testid="doctor-completed-rows">
                {filteredCompleted.map((ci) => (
                  <CompletedRow
                    key={ci.id}
                    checkIn={ci}
                    doctorMode={doctorMode}
                    role={profile?.role ?? ''}
                    clinicId={clinicId ?? ''}
                    currentUserEmail={profile?.email ?? null}
                    clinicalPreview={ci.customer_id ? clinicalMap?.get(ci.customer_id) ?? null : null}
                    onOpenChart={openTreatmentChart}
                    onRefresh={() => void refetch()}
                    /* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3: 저장 본문으로 미리보기 optimistic 0지연 반영 + 백그라운드 정합. */
                    onClinicalSaved={(saved) => applyClinicalOptimistic(ci.customer_id, saved)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* T-20260603-foot-RX-CHART-FOLLOWUP3 C-1: 진료차트(MedicalChartPanel) — 차팅 클릭 시 직접 오픈 */}
      <MedicalChartPanel
        open={medicalChartOpen}
        onOpenChange={(v) => {
          if (!v) {
            setMedicalChartOpen(false);
            setMedicalChartCustomerId(null);
          }
        }}
        customerId={medicalChartCustomerId}
        clinicId={clinicId ?? ''}
        currentUserRole={profile?.role ?? ''}
        currentUserEmail={profile?.email ?? null}
        variant={medicalChartVariant}
        // T-20260609-foot-MEDDASH-MINIMAL-TABLE AC-5: clinical 미니멀 drawer 내 '본 차트 열기' →
        //   같은 환자/같은 패널 인스턴스 유지하며 variant만 'full' 전환(작성 중 임상경과 보존, AC-6 2단 레이아웃 그대로).
        onOpenFull={() => setMedicalChartVariant('full')}
      />
    </div>
  );
}

// ─── 전달사항 메모 미니멀 표시 ────────────────────────────────────────────────
// T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP (문지은 대표원장):
//   이름 아래 노출하던 전달사항 메모(doctor_call_memo) 텍스트 제거 → 상태셀(✋/진료완료 옆)에
//   빨간 미니멀 종 아이콘. hover 시 메모 전문 툴팁(CSS group-hover, 잘림 없음 whitespace-pre-wrap).
//   메모 無 시 미표시(호출부 조건부 가드). DB·SELECT·메모 소스 불변, 시각 추가만.
function MemoBell({ memo }: { memo: string }) {
  return (
    <span className="group relative inline-flex items-center" data-testid="doctor-call-memo-bell">
      <Bell className="h-3.5 w-3.5 text-red-500" aria-label="전달사항 메모" />
      {/* hover 툴팁 — 잘림 없이 전문. whitespace-pre-wrap + max-w로 줄바꿈 보존. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden w-max max-w-[18rem]
          -translate-x-1/2 whitespace-pre-wrap rounded-md bg-gray-900 px-2.5 py-1.5 text-left
          text-[12px] font-normal leading-snug text-white shadow-lg group-hover:block"
        data-testid="doctor-call-memo-tooltip"
      >
        {memo}
      </span>
    </span>
  );
}

// ─── 알람 피드 행 ───────────────────────────────────────────────────────────
function CallFeedRow({
  checkIn,
  doctorMode,
  role,
  clinicId,
  currentUserEmail,
  actor,
  clinicalPreview,
  onOpenChart,
  onRefresh,
  onClinicalSaved,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  role: string;
  clinicId: string;
  currentUserEmail: string | null;
  actor: FlagTransitionActor;
  /** T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-3: 끝 임상경과 칼럼 최신 1줄 미리보기(없으면 null). */
  clinicalPreview: string | null;
  onOpenChart: (customerId: string, variant?: 'full' | 'clinical') => void;
  onRefresh: () => void;
  /** T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3: 인라인 임상경과 저장 직후 미리보기 optimistic 반영(저장 본문 전달). */
  onClinicalSaved?: (savedText?: string) => void;
}) {
  const inactive = checkIn.status_flag === 'pink';
  const slotName = getAssignedSlotName(checkIn);
  // T-20260612-foot-WAITELAPSED-POLISH AC-3: 콜(진료호출 purple) 시각 기준 "+N분" 분단위 컴팩트 표기('콜 후' 제거).
  // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: 계산 로직(elapsedMinutes/formatElapsedPlus)은 그대로 재사용,
  //   표시 위치만 별도 '시간' 칼럼 → 상태 셀 ✋ 옆 인라인. elapsedMin 으로 30분↑ 빨간색 분기.
  const elapsedMin = elapsedMinutes(getCallTime(checkIn));
  const elapsed = formatElapsedPlus(elapsedMin);
  const [showRx, setShowRx] = useState(false);
  // T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 팝오버 anchor(알약 버튼) — 좌표 기준점.
  const rxBtnRef = useRef<HTMLButtonElement>(null);
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 인풋(아코디언 아님), 토글로 노출/숨김.
  const [showClinical, setShowClinical] = useState(false);
  // T-20260614-foot-CHART-CLINICAL-CLICKOUTSIDE (CANON narrow): 외부클릭으로 embed 전체를 닫지 않는다(data-loss 0).
  //   showClinical 닫힘 = 📝 버튼 재클릭만. 진료의 select click-away 라벨 원복은 MedicalChartPanel item② 단일 핸들러 담당.
  // T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④(문지은 대표원장): 임상경과 미리보기 셀 클릭 → 행 아래로 전체내용 펼침(읽기). 재클릭/외부클릭→접힘.
  const [expandClinical, setExpandClinical] = useState(false);
  // T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM): 처방완료/임상경과 본문 클릭 → 해당 컬럼 폭 안에서
  //   셀 바로 아래 드롭다운(ColumnExpandPopover)으로 전문 펼침(읽기). 행 전체폭 펼침 폐기 → 다른 컬럼 비가림. 상태축은 보존.
  const [expandRx, setExpandRx] = useState(false);
  // 앵커 = 처방/임상경과 '셀(컬럼)' — 팝오버 폭이 컬럼 폭과 같아져 가로로 다른 컬럼을 가리지 않음.
  const rxCellRef = useRef<HTMLTableCellElement>(null);
  const clinicalCellRef = useRef<HTMLTableCellElement>(null);
  const rxFullLines = Array.isArray(checkIn.prescription_items)
    ? (checkIn.prescription_items as unknown[]).map((it) => formatRxItemToken(it))
    : [];

  return (
    // T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-3 (문지은 대표원장): 행=환자, 9칼럼 재배치
    //   이름 | 차트번호 | 상태(✋) | 시간 | 방 | 오늘시술 | 임상경과 | 처방 | 차트.
    //   · 이름 옆 임상경과/진료차트/손 이모지 제거(AC-1) → 손은 상태셀(AC-4), 임상경과/진료차트는 차트칼럼(AC-6).
    //   · 시간 셀 시계 이모지 제거(AC-2). 임상경과=처방 왼쪽. FULLWIDTH 처방 스코프(plainText 처방완료·미리보기) 보존(AC-7).
    <>
      <tr
        data-testid="doctor-call-feed-row"
        data-checkin-id={checkIn.id}
        data-inactive={String(inactive)}
        className={cn('align-top transition', inactive ? 'bg-gray-50/60 opacity-70' : 'bg-white')}
      >
        {/* 1. 방 — getAssignedSlotName SSOT(치료실 preconditioning=treatment_room 분기 내장). plain text(배지 아님). 중앙정렬. */}
        <td className="px-1.5 py-1 text-center" data-testid="doctor-call-room-cell">
          {slotName ? (
            <span className="inline-flex items-center justify-start gap-0.5 text-[13px] font-medium text-gray-600">
              <MapPin className="h-2.5 w-2.5 text-gray-400" />
              {slotName}
            </span>
          ) : (
            <span className="text-[13px] text-gray-300">—</span>
          )}
        </td>

        {/* 2. 상태 — 진료필요 + 손들기 ✋: 진료필요 텍스트 바로 오른쪽. shake→초록(ack)→파랑(완료) 토글. 중앙정렬. */}
        <td className="px-1.5 py-1 text-center">
          <span className="inline-flex items-center justify-start gap-1 text-[13px] font-medium text-gray-700">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', inactive ? 'bg-gray-300' : 'bg-red-500')}
            />
            {inactive ? '진료완료' : '진료필요'}
            {!inactive && (
              <>
                {/* ✋ 손 = 수신확인(ack) 전용. 진료완료는 손이 아닌 옆 '진료완료' 명시 버튼에서만. */}
                <HandToggle
                  checkIn={checkIn}
                  doctorMode={doctorMode}
                  completed={false}
                  onRefresh={onRefresh}
                />
                {/* T-20260615-foot-SHAKEHAND-NO-COMPLETE: 완료 전이는 별도 명시 액션(이 버튼)에서만. */}
                <TreatmentCompleteButton
                  checkIn={checkIn}
                  actor={actor}
                  onCompleted={onRefresh}
                />
                {/* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: 별도 '시간' 칼럼 폐지 → ✋ 옆 "+N분" 인라인.
                    30분 이상 빨간색(급한 대기 환자 강조). 손 상태머신·ack 동작과 무관(표시 전용). */}
                <span
                  className={cn(
                    'text-[12px] tabular-nums',
                    elapsedMin >= 30 ? 'font-semibold text-red-500' : 'text-muted-foreground',
                  )}
                  data-testid="doctor-call-elapsed"
                >
                  {elapsed}
                </span>
              </>
            )}
            {/* 전달사항 메모 有 → ✋/진료완료 옆 빨간 종 + hover 전문 툴팁. 無 시 미표시(AC1/AC3/AC5). */}
            {checkIn.doctor_call_memo && <MemoBell memo={checkIn.doctor_call_memo} />}
          </span>
        </td>

        {/* 3. 이름 — 초/재 레이블 + 이름(중앙정렬, 진료차트 클릭). 이름 옆 이모지/손/꺾쇠 없음. */}
        <td className="px-1.5 py-1 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <VisitBadge visitType={checkIn.visit_type} />
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-call-name-chart-btn"
              title="이름 클릭 — 진료차트 열기 (서랍)"
              className={cn(
                'min-w-[4rem] break-keep text-center underline-offset-2 transition-colors cursor-pointer disabled:cursor-default disabled:no-underline',
                inactive
                  ? 'text-gray-500 hover:text-gray-700 hover:underline'
                  : 'text-gray-900 hover:text-indigo-700 hover:underline',
              )}
            >
              <span className="block text-[15px] font-semibold">{checkIn.customer_name}</span>
            </button>
          </div>
          {/* T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP AC4: 이름 아래 메모 텍스트 제거 → 상태셀 MemoBell로 이전. */}
        </td>

        {/* 4. 생년(만나이) — T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: customers.birth_date 파생 "YYYY (만 N세)". 결측 '—'. 중앙정렬. */}
        <td className="px-1.5 py-1 text-center">
          {(() => {
            const bd = birthYearAgeDisplay(readBirthDate(checkIn));
            return bd ? (
              <span className="text-[13px] text-gray-600" data-testid="doctor-call-birth">{bd}</span>
            ) : (
              <span className="text-[13px] text-gray-300" data-testid="doctor-call-birth">—</span>
            );
          })()}
        </td>

        {/* 5. 차트번호 — T-20260612-foot-CHARTNO-COL-SPLIT-P1: 독립 칼럼. 미발번은 '(미발번)'(빈칸 금지). */}
        <td className="px-1.5 py-1 text-center">
          <span className="font-mono text-[13px] text-gray-500" data-testid="doctor-call-chartno">
            {chartNoDisplay(readChartNo(checkIn))}
          </span>
        </td>

        {/* 6. 오늘시술 — 중앙정렬. */}
        <td className="px-1.5 py-1 text-center">
          <ProcedureCell checkIn={checkIn} />
        </td>

        {/* T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2: '차트' 칼럼(📝/🩺 이모지) 제거.
            진료차트 진입 → 이름 클릭(item1), 임상경과 입력 → 임상경과 빈값 '—' 클릭(item3). */}

        {/* 7. 처방 — AC-7(FULLWIDTH 보존): 확정 시 알약버튼 제거→파란글씨 '처방완료'(plainText)+약명 미리보기. 미처방 시 알약 드롭다운. 중앙정렬.
            COLWIDTH-EXPAND-QUICKEDIT AC-2: rxCellRef = 처방완료 펼침 드롭다운(ColumnExpandPopover) 앵커(컬럼 폭). */}
        <td ref={rxCellRef} className="px-1.5 py-1 text-center" data-testid="doctor-call-rx-cell">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {checkIn.prescription_status === 'confirmed' ? (
              <RxConfirmedSummary
                checkInId={checkIn.id}
                items={checkIn.prescription_items}
                doctorMode={doctorMode}
                onCancelled={onRefresh}
                checkInStatus={checkIn.status}
                checkedInAt={checkIn.checked_in_at}
                checkInFlag={checkIn.status_flag}
                onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
                surface="doctor_call_dashboard"
                customerId={checkIn.customer_id}
                plainText
                /* T-20260613-foot-DOCDASH-CALLUX-3FIX AC-3: 처방완료 클릭 → 즉시취소 금지, 드롭다운(수정/취소). 귀가 환자 비활성. */
                actionMenu
                /* T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2/AC-3): 본문 클릭=펼침(읽기), 연필=빠른수정(차트 풀오픈 X)/취소. */
                role={role}
                onToggleExpand={() => setExpandRx((v) => !v)}
                expanded={expandRx}
              />
            ) : (
              <>
                <button
                  ref={rxBtnRef}
                  type="button"
                  onClick={() => setShowRx((v) => !v)}
                  data-testid="doctor-call-rx-btn"
                  aria-expanded={showRx}
                  className={CELL_ACTION_BTN}
                >
                  <Pill className="h-3 w-3 text-gray-400" />
                  처방
                </button>
                {/* T-20260612-foot-DOCDASH-RXCELL-REFINE item2/AC-2: 알약 anchor portal 팝오버(행 전체폭 펼침행 폐지). */}
                <RxPopover
                  open={showRx}
                  anchorRef={rxBtnRef}
                  onClose={() => setShowRx(false)}
                  testId="doctor-call-rx-popover"
                >
                  <QuickRxBar
                    doctorMode={doctorMode}
                    role={role}
                    checkInId={checkIn.id}
                    onApplied={onRefresh}
                    checkInStatus={checkIn.status}
                    checkedInAt={checkIn.checked_in_at}
                    /* T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)는 원내 잔류 → 처방 허용(귀가만 차단). */
                    checkInFlag={checkIn.status_flag}
                    onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
                    /* T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차트변경 audit attribution. */
                    surface="doctor_call_dashboard"
                    customerId={checkIn.customer_id}
                    compact
                  />
                </RxPopover>
              </>
            )}
          </div>
        </td>

        {/* 8. 임상경과 — CALLUX-3FIX AC-1: 처방 '오른쪽'(요청순서 끝). 미리보기 전용(최신 1줄 말줄임). 중앙정렬.
            T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④: 내용 있으면 클릭 가능 → 셀 아래 드롭다운으로 전체내용 펼침(읽기 토글).
            COLWIDTH-EXPAND-QUICKEDIT AC-2: clinicalCellRef = 임상경과 펼침 드롭다운(ColumnExpandPopover) 앵커(컬럼 폭).
            T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item3: 빈값 '—' = 클릭 시 인라인 임상경과 편집창 열기(showClinical, 기존 📝 동선 재사용) + 옅은회색→진한톤 가독. */}
        <td ref={clinicalCellRef} className="px-1.5 py-1 text-center" data-testid="doctor-call-clinical-cell">
          {clinicalPreview ? (
            <button
              type="button"
              onClick={() => setExpandClinical((v) => !v)}
              aria-expanded={expandClinical}
              data-testid="doctor-call-clinical-expand-btn"
              title="클릭하면 전체 내용이 펼쳐져요"
              className="block w-full max-w-full truncate text-center text-[13px] text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              {clinicalPreview}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => checkIn.customer_id && setShowClinical(true)}
              disabled={!checkIn.customer_id}
              aria-expanded={showClinical}
              data-testid="doctor-call-clinical-empty-btn"
              title="클릭하면 임상경과를 작성할 수 있어요"
              className="text-[15px] font-medium text-gray-500 underline-offset-2 transition-colors hover:text-gray-800 hover:underline disabled:cursor-default disabled:text-gray-300 disabled:no-underline cursor-pointer"
            >
              —
            </button>
          )}
        </td>

        {/* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: 별도 '시간(경과시간)' 칼럼 제거.
            "+N분" 은 상태 셀(✋ 옆)로 이전 — elapsed testid 동일 유지(회귀 spec 보존). */}
      </tr>

      {/* T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 드롭다운 펼침행(<tr colSpan>) 폐지 →
          처방 셀의 RxPopover(알약 anchor portal 팝오버)로 대체. 더 이상 행을 밀어내지 않음. */}

      {/* T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 텍스트 인풋(singleLine).
          tall 아코디언 제거 — MedicalChartPanel singleLine 모드 재사용(저장 로직·진료의 NOT NULL 강제 동일). */}
      {showClinical && checkIn.customer_id && (
        <tr data-testid="doctor-call-chart-inline-row" className={inactive ? 'bg-gray-50/60' : 'bg-white'}>
          {/* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-2: 인라인 임상경과 패널 full-width → 50% + 오른쪽 끝 정렬.
              colSpan(8)은 폭 정렬 위해 유지하되, 내부 div(ml-auto w-1/2 overflow-hidden)로 우측 절반만 차지·내부 overflow truncate.
              패널 내부(textarea 확대·담당의 one-row=CLINICAL-INLINE-REFINE)는 미접촉. */}
          <td colSpan={DOCDASH_COLSPAN} className="px-3 pb-2" data-testid="doctor-call-chart-inline">
            <div className="ml-auto w-1/2 overflow-hidden" data-testid="doctor-call-chart-inline-half">
              <MedicalChartPanel
                embed
                open
                variant="clinical"
                singleLine
                customerId={checkIn.customer_id}
                clinicId={clinicId}
                currentUserRole={role}
                currentUserEmail={currentUserEmail}
                onOpenChange={(v) => { if (!v) setShowClinical(false); }}
                onSaved={(saved) => { setShowClinical(false); onClinicalSaved?.(saved); }}
              />
            </div>
          </td>
        </tr>
      )}

      {/* T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM 재정의): 임상경과 미리보기 클릭 시
          '임상경과 컬럼 폭' 안에서 셀 바로 아래 드롭다운으로 전체내용(읽기) 펼침 — 다른 컬럼 비가림(행 전체폭 펼침행 폐기).
          말줄임 없는 전문(whitespace 보존) + 길면 컬럼 폭 내 세로 스크롤. 재클릭/바깥클릭으로 접힘. 입력은 별도(📝 차트칼럼). */}
      <ColumnExpandPopover
        open={expandClinical && !!clinicalPreview}
        anchorRef={clinicalCellRef}
        onClose={() => setExpandClinical(false)}
        testId="doctor-call-clinical-expand-pop"
      >
        <div
          className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-relaxed text-gray-700"
          data-testid="doctor-call-clinical-expand"
        >
          {clinicalPreview}
        </div>
      </ColumnExpandPopover>

      {/* T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM 재정의): 처방완료 본문 클릭 시
          '처방 컬럼 폭' 안에서 셀 바로 아래 드롭다운으로 처방 전문 펼침(읽기) — 다른 컬럼 비가림.
          약 1건당 '약물명 1/3/2'(RX-TOKEN-FORMAT). 길면 컬럼 폭 내 줄바꿈+세로 스크롤. 입력/수정은 별도(연필). */}
      <ColumnExpandPopover
        open={expandRx && checkIn.prescription_status === 'confirmed'}
        anchorRef={rxCellRef}
        onClose={() => setExpandRx(false)}
        testId="doctor-call-rx-expand-pop"
        widthScale={2}
      >
        <div
          className="px-3 py-2 text-[13px] leading-relaxed text-gray-700"
          data-testid="doctor-call-rx-expand"
        >
          {/* T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item5(문지은 대표원장): 드롭다운 '처방 전체' 헤더 텍스트 제거. */}
          {rxFullLines.length > 0 ? (
            <ul className="space-y-0.5">
              {rxFullLines.map((line, i) => (
                <li key={i} className="break-words">• {line}</li>
              ))}
            </ul>
          ) : (
            <span className="text-gray-400">처방 내용 없음</span>
          )}
        </div>
      </ColumnExpandPopover>
    </>
  );
}

// ─── 진료 완료 환자 행 ───────────────────────────────────────────────────────
function CompletedRow({
  checkIn,
  doctorMode,
  role,
  clinicId,
  currentUserEmail,
  clinicalPreview,
  onOpenChart,
  onRefresh,
  onClinicalSaved,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  role: string;
  clinicId: string;
  currentUserEmail: string | null;
  /** T-20260612-foot-DOCDASH-11FIX AC-11: 최신 임상경과 1줄 미리보기(없으면 null). */
  clinicalPreview: string | null;
  onOpenChart: (customerId: string, variant?: 'full' | 'clinical') => void;
  onRefresh: () => void;
  /** T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3: 인라인 임상경과 저장 직후 미리보기 optimistic 반영(저장 본문 전달). */
  onClinicalSaved?: (savedText?: string) => void;
}) {
  const slotName = getAssignedSlotName(checkIn);
  // T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7 (POLISH AC-4 supersede): 진료 완료 섹션은 경과시간 칼럼 자체 제거(7칼럼).
  //   완료환자는 대기시간 불요(문지은 대표원장). 호출 섹션은 경과시간 유지.
  const [showRx, setShowRx] = useState(false);
  // T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 팝오버 anchor(알약 버튼) — 좌표 기준점.
  const rxBtnRef = useRef<HTMLButtonElement>(null);
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 인풋(아코디언 아님) 토글.
  const [showClinical, setShowClinical] = useState(false);
  // T-20260614-foot-CHART-CLINICAL-CLICKOUTSIDE (CANON narrow): 외부클릭으로 embed 전체를 닫지 않는다(data-loss 0).
  //   showClinical 닫힘 = 📝 버튼 재클릭만. 진료의 select click-away 라벨 원복은 MedicalChartPanel item② 단일 핸들러 담당.
  // T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④(문지은 대표원장): 임상경과 미리보기 셀 클릭 → 행 아래로 전체내용 펼침(읽기). 재클릭→접힘.
  const [expandClinical, setExpandClinical] = useState(false);
  // T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM): 처방완료/임상경과 본문 클릭 → 컬럼 폭 안 셀 아래 드롭다운(읽기). 행 전체폭 폐기.
  const [expandRx, setExpandRx] = useState(false);
  // 앵커 = 처방/임상경과 '셀(컬럼)' — 팝오버 폭=컬럼 폭, 다른 컬럼 비가림.
  const rxCellRef = useRef<HTMLTableCellElement>(null);
  const clinicalCellRef = useRef<HTMLTableCellElement>(null);
  const rxFullLines = Array.isArray(checkIn.prescription_items)
    ? (checkIn.prescription_items as unknown[]).map((it) => formatRxItemToken(it))
    : [];
  // T-20260612-foot-DOCDASH-11FIX AC-9/AC-10: 귀가(true discharge) 판정 = QUICKRX-INCLINIC-GATE SSOT 재사용.
  //   status==='done' → 귀가(처방게이트 reason='discharged'). 그 외(원내 잔류) → 처방 버튼 유지(회귀 금지).
  const dischargeGate = checkRxInClinic({
    status: checkIn.status,
    status_flag: checkIn.status_flag,
    checked_in_at: checkIn.checked_in_at,
  });
  const discharged = dischargeGate.reason === 'discharged';
  return (
    // T-20260612-foot-DOCDASH-SECTION-RESTRUCTURE AC-4: 진료 완료 환자도 진료 대기중과 동일 8칼럼
    //   이름 | 상태 | 콜경과시간 | 방 | 오늘시술 | 처방 | 임상경과 | 진료차트.
    //   AC-0(회귀 rebase): 귀가여부 상태(11FIX AC-10)·처방 게이트(STATUS-SPLIT/AC-9)·의사ack 뱃지·임상경과 미리보기(AC-11) 보존.
    <>
      <tr className="align-top" data-testid="doctor-completed-row" data-checkin-id={checkIn.id}>
        {/* 1. 방 — getAssignedSlotName SSOT(치료실 preconditioning=treatment_room). plain text. 중앙정렬. */}
        <td className="px-1.5 py-1 text-center" data-testid="doctor-completed-room-cell">
          {slotName ? (
            <span className="inline-flex items-center justify-start gap-0.5 text-[13px] font-medium text-gray-600">
              <MapPin className="h-2.5 w-2.5 text-gray-400" />
              {slotName}
            </span>
          ) : (
            <span className="text-[13px] text-gray-300">—</span>
          )}
        </td>

        {/* 2. 상태 — 귀가/귀가 대기 + 손들기 ✋: 진료완료 상태이므로 파랑(완료) 표시. cross-client. 중앙정렬. */}
        <td className="px-1.5 py-1 text-center">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-700"
              data-testid="doctor-completed-discharge-status"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  discharged ? 'bg-emerald-500' : 'bg-amber-500',
                )}
              />
              {discharged ? '귀가' : '귀가 대기'}
            </span>
            {/* 진료완료 환자 = 파랑 ✋(의사ack 표상). 완료 테이블이라 ✋ 는 안내 토스트만(완료 해제 미지원). */}
            <HandToggle
              checkIn={checkIn}
              doctorMode={doctorMode}
              completed
              onRefresh={onRefresh}
            />
          </div>
        </td>

        {/* 3. 이름 — 초/재 레이블 + 이름(중앙정렬, 진료차트 클릭). 이름 옆 이모지/손/꺾쇠 없음. */}
        <td className="px-1.5 py-1 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <VisitBadge visitType={checkIn.visit_type} />
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-completed-name-chart-btn"
              title="이름 클릭 — 진료차트 열기 (서랍)"
              className="min-w-[4rem] break-keep text-center underline-offset-2 transition-colors cursor-pointer hover:text-indigo-700 hover:underline disabled:cursor-default disabled:no-underline"
            >
              <span className="block text-[15px] font-semibold">{checkIn.customer_name}</span>
            </button>
          </div>
        </td>

        {/* 4. 생년(만나이) — T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: customers.birth_date 파생 "YYYY (만 N세)". 결측 '—'. 중앙정렬. */}
        <td className="px-1.5 py-1 text-center">
          {(() => {
            const bd = birthYearAgeDisplay(readBirthDate(checkIn));
            return bd ? (
              <span className="text-[13px] text-gray-600" data-testid="doctor-completed-birth">{bd}</span>
            ) : (
              <span className="text-[13px] text-gray-300" data-testid="doctor-completed-birth">—</span>
            );
          })()}
        </td>

        {/* 5. 차트번호 — T-20260612-foot-CHARTNO-COL-SPLIT-P1: 독립 칼럼. 미발번은 '(미발번)'(빈칸 금지). */}
        <td className="px-1.5 py-1 text-center">
          <span className="font-mono text-[13px] text-gray-500" data-testid="doctor-completed-chartno">
            {chartNoDisplay(readChartNo(checkIn))}
          </span>
        </td>

        {/* 6. 오늘시술 — 중앙정렬. */}
        <td className="px-1.5 py-1 text-center">
          <ProcedureCell checkIn={checkIn} />
        </td>

        {/* T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item2: '차트' 칼럼(📝/🩺 이모지) 제거.
            진료차트 진입 → 이름 클릭(item1), 임상경과 입력 → 임상경과 빈값 '—' 클릭(item3). */}

        {/* 7. 처방 — AC-7(보존): 귀가(discharged) 미처방 '-', 원내잔류 알약 드롭다운, 확정 시 파란글씨 '처방완료'+미리보기. 중앙정렬.
            COLWIDTH-EXPAND-QUICKEDIT AC-2: rxCellRef = 처방완료 펼침 드롭다운 앵커(컬럼 폭). */}
        <td ref={rxCellRef} className="px-1.5 py-1 text-center" data-testid="doctor-completed-rx-cell">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {checkIn.prescription_status === 'confirmed' ? (
              /* T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK 게이트 prop 유지(진료완료 무회귀).
                 item9: plainText 파란글씨 '처방완료'(버튼 chrome 제거). item8: 약명 RXSET 표시모델 셀 미리보기. */
              <RxConfirmedSummary
                checkInId={checkIn.id}
                items={checkIn.prescription_items}
                doctorMode={doctorMode}
                onCancelled={onRefresh}
                checkInStatus={checkIn.status}
                checkedInAt={checkIn.checked_in_at}
                checkInFlag={checkIn.status_flag}
                onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
                surface="doctor_call_dashboard"
                customerId={checkIn.customer_id}
                plainText
                /* T-20260613-foot-DOCDASH-CALLUX-3FIX AC-3: 처방완료 클릭 → 즉시취소 금지, 드롭다운(수정/취소). 귀가 환자 비활성. */
                actionMenu
                /* T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2/AC-3): 본문 클릭=펼침(읽기), 연필=빠른수정(차트 풀오픈 X)/취소. */
                role={role}
                onToggleExpand={() => setExpandRx((v) => !v)}
                expanded={expandRx}
              />
            ) : !discharged ? (
              <>
                <button
                  ref={rxBtnRef}
                  type="button"
                  onClick={() => setShowRx((v) => !v)}
                  aria-expanded={showRx}
                  data-testid="doctor-completed-rx-btn"
                  className={CELL_ACTION_BTN}
                >
                  <Pill className="h-3 w-3 text-gray-400" />
                  처방
                </button>
                {/* T-20260612-foot-DOCDASH-RXCELL-REFINE item2/AC-2: 알약 anchor portal 팝오버(행 전체폭 펼침행 폐지). */}
                <RxPopover
                  open={showRx}
                  anchorRef={rxBtnRef}
                  onClose={() => setShowRx(false)}
                  testId="doctor-completed-rx-popover"
                >
                  <QuickRxBar
                    doctorMode={doctorMode}
                    role={role}
                    checkInId={checkIn.id}
                    onApplied={onRefresh}
                    checkInStatus={checkIn.status}
                    checkedInAt={checkIn.checked_in_at}
                    /* T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)는 원내 잔류 → 처방 허용(귀가만 차단). */
                    checkInFlag={checkIn.status_flag}
                    onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
                    /* T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차트변경 audit attribution. */
                    surface="doctor_call_dashboard"
                    customerId={checkIn.customer_id}
                    compact
                  />
                </RxPopover>
              </>
            ) : (
              /* T-20260612-WAITELAPSED-POLISH AC-7: 귀가·미처방 표기를 '-' 로 축약. */
              <span className="text-[13px] text-gray-300" data-testid="doctor-completed-no-rx">-</span>
            )}
          </div>
        </td>

        {/* 8(끝). 임상경과 — CALLUX-3FIX AC-1: 처방 '오른쪽'(요청순서 끝). 미리보기 전용. 중앙정렬.
            T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④: 내용 있으면 클릭 가능 → 셀 아래 드롭다운으로 전체내용 펼침(읽기 토글).
            COLWIDTH-EXPAND-QUICKEDIT AC-2: clinicalCellRef = 임상경과 펼침 드롭다운 앵커(컬럼 폭).
            T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX item3: 빈값 '—' 클릭=인라인 임상경과 편집창 열기(showClinical) + 진한톤. (완료 행도 진료 알림판=작성 흐름이라 빈값 작성 진입 정상 — DoctorPatientList 완료 읽기전용 게이트와 무관) */}
        <td ref={clinicalCellRef} className="px-1.5 py-1 text-center" data-testid="doctor-completed-clinical-cell">
          {clinicalPreview ? (
            <button
              type="button"
              onClick={() => setExpandClinical((v) => !v)}
              aria-expanded={expandClinical}
              data-testid="doctor-completed-clinical-expand-btn"
              title="클릭하면 전체 내용이 펼쳐져요"
              className="block w-full max-w-full truncate text-center text-[13px] text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              {clinicalPreview}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => checkIn.customer_id && setShowClinical(true)}
              disabled={!checkIn.customer_id}
              aria-expanded={showClinical}
              data-testid="doctor-completed-clinical-empty-btn"
              title="클릭하면 임상경과를 작성할 수 있어요"
              className="text-[15px] font-medium text-gray-500 underline-offset-2 transition-colors hover:text-gray-800 hover:underline disabled:cursor-default disabled:text-gray-300 disabled:no-underline cursor-pointer"
            >
              —
            </button>
          )}
        </td>

        {/* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1: '시간' placeholder 칼럼 제거(대기 테이블도 칼럼 제거 → 정렬 유지). */}
      </tr>

      {/* T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 드롭다운 펼침행(<tr colSpan>) 폐지 →
          처방 셀의 RxPopover(알약 anchor portal 팝오버)로 대체(완료 섹션 동일). */}

      {/* T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 진료완료 환자도 임상경과 = 한 줄 인풋(singleLine). */}
      {showClinical && checkIn.customer_id && (
        <tr data-testid="doctor-completed-chart-inline-row" className="bg-white">
          {/* T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-2: 인라인 임상경과 패널 full-width → 50% + 오른쪽 끝 정렬(대기 섹션 동일). */}
          <td colSpan={DOCDASH_COMPLETED_COLSPAN} className="px-3 pb-2" data-testid="doctor-completed-chart-inline">
            <div className="ml-auto w-1/2 overflow-hidden" data-testid="doctor-completed-chart-inline-half">
              <MedicalChartPanel
                embed
                open
                variant="clinical"
                singleLine
                customerId={checkIn.customer_id}
                clinicId={clinicId}
                currentUserRole={role}
                currentUserEmail={currentUserEmail}
                onOpenChange={(v) => { if (!v) setShowClinical(false); }}
                onSaved={(saved) => { setShowClinical(false); onClinicalSaved?.(saved); }}
              />
            </div>
          </td>
        </tr>
      )}

      {/* T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM 재정의): 임상경과 미리보기 클릭 시
          '임상경과 컬럼 폭' 안에서 셀 바로 아래 드롭다운으로 전체내용(읽기) 펼침(완료 섹션 동일) — 다른 컬럼 비가림.
          말줄임 없는 전문(whitespace 보존) + 길면 컬럼 폭 내 세로 스크롤. 재클릭/바깥클릭으로 접힘. 입력은 별도(📝). */}
      <ColumnExpandPopover
        open={expandClinical && !!clinicalPreview}
        anchorRef={clinicalCellRef}
        onClose={() => setExpandClinical(false)}
        testId="doctor-completed-clinical-expand-pop"
      >
        <div
          className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-relaxed text-gray-700"
          data-testid="doctor-completed-clinical-expand"
        >
          {clinicalPreview}
        </div>
      </ColumnExpandPopover>

      {/* T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (AC-2 PARADIGM 재정의): 처방완료 본문 클릭 시
          '처방 컬럼 폭' 안에서 셀 바로 아래 드롭다운으로 처방 전문 펼침(읽기, 완료 섹션 동일) — 다른 컬럼 비가림. */}
      <ColumnExpandPopover
        open={expandRx && checkIn.prescription_status === 'confirmed'}
        anchorRef={rxCellRef}
        onClose={() => setExpandRx(false)}
        testId="doctor-completed-rx-expand-pop"
        widthScale={2}
      >
        <div
          className="px-3 py-2 text-[13px] leading-relaxed text-gray-700"
          data-testid="doctor-completed-rx-expand"
        >
          {/* T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item5(문지은 대표원장): 드롭다운 '처방 전체' 헤더 텍스트 제거. */}
          {rxFullLines.length > 0 ? (
            <ul className="space-y-0.5">
              {rxFullLines.map((line, i) => (
                <li key={i} className="break-words">• {line}</li>
              ))}
            </ul>
          ) : (
            <span className="text-gray-400">처방 내용 없음</span>
          )}
        </div>
      </ColumnExpandPopover>
    </>
  );
}

// ─── 상태 셀 ✋ 손 토글 (수신확인 ack 전용) ──────────────────────────────────────
// T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-4/AC-5: 상태 셀 '진료필요' 옆 ✋ 손 아이콘.
//   색으로 단계 표상 — 회색+SHAKE=미ack / 초록=의사 확인됨(acked) / 파랑=진료완료된 환자.
//   교차 클라이언트 동기화(AC-5a): 로컬 state 아님 — doctor_ack_at/status_flag DB값을 그대로 색으로 투영,
//     write 후 onRefresh → realtime refetch 로 타 기기 자동 반영.
//
// T-20260615-foot-SHAKEHAND-NO-COMPLETE (문지은 대표원장 P0 핫픽스) — ✋ = 수신확인(ack) 전용으로 환원.
//   증상: ✋ 클릭이 ack 만 되어야 하는데 진료완료까지 오발동(status_flag 오염). 재현: 운영 중 첫 손 탭이 완료로 점프.
//   근본원인: T-20260613 RELAYOUT 이 별도 '진료완료' 버튼(e6138e7 TreatmentCompleteButton)을 제거하고
//     완료 전이(applyStatusFlagTransition purple→pink)를 ✋ 핸들러(초록 탭)에 결합 → ack 와 완료가 한 손에 얽힘.
//     doctor_ack_at 은 stepper '원장확인' 클릭·재호출 잔존 등 다른 동선에서 선점되어 손이 초록으로 도착할 수 있어
//     '초록 탭=완료' 로직이 의사의 '첫 손 탭'을 완료로 만들었다(직전 2-탭 arm 땜질로도 결합은 잔존).
//   교정(SSOT 분리 환원): ✋ 핸들러에서 완료/상태전이 호출을 제거하고 ack write(recordAck)만 남긴다.
//     완료(purple→pink)는 손이 아닌 '별도 명시 액션' TreatmentCompleteButton('진료완료' 라벨 버튼)에서만 일어난다.
//   AC: ✋클릭=doctor_ack_at 만 write / completed_at·status_flag 전이 트리거 금지 / 회색↔초록 재클릭 idempotent /
//       파랑(완료)은 안내만 / 완료는 별도 명시 액션에서만.
//   ⚠ doctor_ack_at(ack=진료 시작 신호)과 status_flag(purple/pink) 는 설계상 별개 — ✋ 는 ack 컬럼만 만진다.
function HandToggle({
  checkIn,
  doctorMode,
  completed,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  /** 진료 완료 테이블(파랑·잠금) 여부. true면 안내 토스트만. */
  completed: boolean;
  onRefresh: () => void;
}) {
  const [pending, setPending] = useState(false);
  const acked = isDoctorAcked(checkIn.doctor_ack_at);
  const visual: 'blue' | 'green' | 'shake' = completed ? 'blue' : acked ? 'green' : 'shake';

  const handleClick = async () => {
    if (pending) return;
    // 파랑(완료) — 안내만. ✋ 는 완료를 만들지도 해제하지도 않는다.
    if (visual === 'blue') {
      toast.warning('이미 진료완료된 환자예요. 진료완료/해제는 손이 아닌 진료완료 버튼에서 처리해요.');
      return;
    }
    // 초록(확인됨) — 이미 ack 됨. 재클릭은 idempotent(상태 변화 없음). 완료 전이 절대 호출 안 함.
    if (visual === 'green') {
      toast.info('이미 확인(손 들기)한 환자예요. 진료완료는 진료완료 버튼에서 처리해요.');
      return;
    }
    // 회색(초기) — 의사 전용 ✋확인(ack=doctor_ack_at). 직원 클릭은 차단 안내.
    if (!doctorMode) {
      toast.warning('의사만 확인(손 들기)할 수 있어요.');
      return;
    }
    setPending(true);
    try {
      // SHAKEHAND-NO-COMPLETE: 수신확인(ack) write 만. 완료/상태 전이 호출 없음(분리된 명시 버튼 담당).
      await recordAck(checkIn.id);
      onRefresh();
      toast.confirm('환자에게 손을 들었어요. 호출 직원 화면에 바로 표시돼요.');
    } catch (e) {
      toast.error(`확인 표시 실패: ${(e as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  const colorClass =
    visual === 'blue'
      ? 'text-blue-600'
      : visual === 'green'
        ? 'text-emerald-600'
        : 'text-gray-400 animate-shake';
  const title =
    visual === 'blue'
      ? '진료완료됨 — 완료 처리는 진료완료 버튼에서'
      : visual === 'green'
        ? '의사 확인됨 — 진료완료는 진료완료 버튼에서 처리'
        : '의사 확인(손 들기) — 클릭하면 환자에게 확인 신호 (ack)';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      data-testid="doctor-hand-toggle"
      data-hand-state={visual}
      aria-label={title}
      title={title}
      className="inline-flex items-center justify-center rounded p-0.5 transition active:scale-90 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className={cn('h-4 w-4 animate-spin', colorClass)} />
      ) : (
        <Hand className={cn('h-4 w-4', colorClass)} />
      )}
    </button>
  );
}

// ─── 진료완료 버튼 (별도 명시 액션) ───────────────────────────────────────────
// T-20260615-foot-SHAKEHAND-NO-COMPLETE: 완료(purple→pink)는 손(✋)이 아니라 이 명시 버튼에서만.
//   e6138e7(TREATMENT-COMPLETE-BTN) 원형 복원 — RELAYOUT 이 제거했던 분리 액션을 되살린다.
//   진료호출(purple) 환자를 의사/직원 누구나 '진료완료' 처리 → status_flag purple→pink 전이로 활성 명단에서 제거.
//   status_flag 전이는 applyStatusFlagTransition(SSOT)에 위임 — ⚠ doctor_ack_at(✋)은 만지지 않는다(별개 신호).
function TreatmentCompleteButton({
  checkIn,
  actor,
  onCompleted,
}: {
  checkIn: CheckIn;
  actor: FlagTransitionActor;
  onCompleted: () => void;
}) {
  const [pending, setPending] = useState(false);
  const handleComplete = async () => {
    if (pending) return;
    setPending(true);
    try {
      await applyStatusFlagTransition(checkIn, 'pink', actor);
      onCompleted();
      toast.confirm('진료완료 처리했어요. 활성 호출 명단에서 빠졌어요.');
    } catch (e) {
      toast.error(`진료완료 처리 실패: ${(e as Error).message}`);
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleComplete}
      disabled={pending}
      data-testid="doctor-call-complete-btn"
      aria-label="진료완료 처리"
      className="inline-flex items-center gap-0.5 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50 active:scale-95 disabled:opacity-50"
      title="이 환자 진료를 완료 처리해요 (활성 호출 명단에서 제거)"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
      진료완료
    </button>
  );
}

// T-20260612-foot-WAITELAPSED-POLISH AC-8: 초진/재진(/체험) 레이블을 한 글자(초/재/체)로 축약.
//   색상(cls)·매핑 동작은 유지 — 좁은 칼럼에서 이름·차트번호 가독성 확보. title 로 풀이 hover 제공(AC-9 안전).
function VisitBadge({ visitType }: { visitType: CheckIn['visit_type'] }) {
  const map: Record<string, { label: string; full: string; cls: string }> = {
    new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' },
    returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' },
    experience: { label: '체', full: '체험', cls: 'bg-purple-100 text-purple-700' },
  };
  const { label, full, cls } = map[visitType] ?? {
    label: visitType,
    full: visitType,
    cls: 'bg-gray-100 text-gray-600',
  };
  return (
    <span
      className={cn('rounded px-1 py-px text-[10px] font-medium', cls)}
      title={full}
      data-testid="doctor-visit-badge"
    >
      {label}
    </span>
  );
}

// T-20260612-foot-DOCDASH-11FIX AC-12: 시술 정보를 이름 셀에서 분리해 독립 칼럼으로 표시.
//   데이터 소스는 treatmentLabel과 동일(treatment_kind ?? treatment_category)이나, 전용 칼럼에서는
//   '시술 미지정' 대신 '미지정'(회색)으로 컴팩트 표기. 미지정은 read-only(DB 무변경).
function ProcedureCell({ checkIn }: { checkIn: Pick<CheckIn, 'treatment_kind' | 'treatment_category'> }) {
  const v = (checkIn.treatment_kind ?? checkIn.treatment_category ?? '').trim();
  return v === '' ? (
    <span className="text-[13px] text-gray-300" data-testid="doctor-procedure-cell">
      미지정
    </span>
  ) : (
    <span className="text-[13px] font-medium text-gray-700" data-testid="doctor-procedure-cell">
      {v}
    </span>
  );
}
