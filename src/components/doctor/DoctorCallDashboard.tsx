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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
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

// T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-6 (문지은 대표원장): 신설 '차트' 칼럼(처방 오른쪽) 이모지 버튼.
//   FULLWIDTH-INLINE-EMOJI 가 이름 옆에 두었던 임상경과(📝)/진료차트(🩺) 이모지 버튼을 본 칼럼으로 이동(이름 옆은 제거).
//   동선 보존: 임상경과(📝) → 인라인 임상경과 입력(showClinical 토글·CLINICAL-INLINE-REFINE 저장경로),
//             진료차트(🩺) → 전체 진료차트 서랍(기존 onOpenChart 'full' 라우트). 신규 저장경로/라우트 0.
const CHART_CELL_EMOJI_BTN =
  'inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-1.5 py-0.5 ' +
  'text-[15px] leading-none transition-colors hover:bg-gray-100 active:scale-95 ' +
  'disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white';

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
const DOCDASH_COLSPAN = 10; // 진료 대기중(호출): 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간
const DOCDASH_COMPLETED_COLSPAN = 9; // 진료 완료: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과

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

  const { data: rows = [], isLoading, refetch } = useDoctorCallFeed(clinicId);
  // T-20260612-foot-DOCDASH-11FIX AC-11: 진료완료 환자 임상경과 미리보기 맵(customer_id → 최신 1줄).
  const { data: clinicalMap } = useCompletedClinicalProgress(clinicId);

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
          {/* 카운트는 plain text. T-20260612-WAITELAPSED-POLISH AC-1: '완료 N명' 배지 완전 제거(진료필요만 노출). */}
          <span className="text-xs font-medium text-red-600">진료필요 {activeCalls.length}</span>
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
                  T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item③(문지은 대표원장): 방·상태·이름·생년 추가 압축 → 처방 미리보기만 확대.
                  순서: 방 6 · 상태(✋) 10 · 이름 11 · 생년(만나이) 10 · 차트번호 9 · 오늘시술 11 · 차트 7 · 처방 18 · 임상경과 12 · 시간 6.
                  (시간=AC-1 dev판단 기본보존, 맨 끝 append) */}
              <colgroup>
                <col className="w-[6%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[7%]" />
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[6%]" />
              </colgroup>
              {/* DOCDASH_THEAD — CALLUX-3FIX AC-1: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간. */}
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-[13px] font-semibold text-muted-foreground">
                  <th className="px-1.5 py-1">방</th>
                  <th className="px-1.5 py-1">상태</th>
                  <th className="px-1.5 py-1">이름</th>
                  <th className="px-1.5 py-1">생년(만나이)</th>
                  <th className="px-1.5 py-1">차트번호</th>
                  <th className="px-1.5 py-1">오늘시술</th>
                  <th className="px-1.5 py-1">차트</th>
                  <th className="px-1.5 py-1">처방</th>
                  <th className="px-1.5 py-1">임상경과</th>
                  <th className="px-1.5 py-1">시간</th>
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
        {completedPatients.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            아직 진료 완료된 환자가 없어요.
          </div>
        ) : (
          // T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7: 진료 완료 섹션은 경과시간 칼럼 제거(7칼럼).
          //   호출 섹션(8칼럼)과 폭 통일이 아닌 독립 — 완료환자는 대기시간 불요(문지은 대표원장). 제거된 11% 재분배.
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-[15px]" data-testid="doctor-completed-table">
              {/* COMPLETED COLGROUP — T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: 경과시간 제거(UX7 유지) + 생년 신설(9칼럼).
                  T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item③(문지은 대표원장): 방·상태·이름·생년 추가 압축 → 처방 미리보기만 확대.
                  순서·합 100%: 방6 · 상태(✋)11 · 이름12 · 생년(만나이)11 · 차트번호10 · 오늘시술12 · 차트8 · 처방18 · 임상경과12. */}
              <colgroup>
                <col className="w-[6%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[8%]" />
                <col className="w-[18%]" />
                <col className="w-[12%]" />
              </colgroup>
              {/* COMPLETED THEAD — CALLUX-3FIX AC-1: 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과(시간 없음). */}
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-[13px] font-semibold text-muted-foreground">
                  <th className="px-1.5 py-1">방</th>
                  <th className="px-1.5 py-1">상태</th>
                  <th className="px-1.5 py-1">이름</th>
                  <th className="px-1.5 py-1">생년(만나이)</th>
                  <th className="px-1.5 py-1">차트번호</th>
                  <th className="px-1.5 py-1">오늘시술</th>
                  <th className="px-1.5 py-1">차트</th>
                  <th className="px-1.5 py-1">처방</th>
                  <th className="px-1.5 py-1">임상경과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100" data-testid="doctor-completed-rows">
                {completedPatients.map((ci) => (
                  <CompletedRow
                    key={ci.id}
                    checkIn={ci}
                    doctorMode={doctorMode}
                    role={profile?.role ?? ''}
                    clinicId={clinicId ?? ''}
                    currentUserEmail={profile?.email ?? null}
                    actor={actor}
                    clinicalPreview={ci.customer_id ? clinicalMap?.get(ci.customer_id) ?? null : null}
                    onOpenChart={openTreatmentChart}
                    onRefresh={() => void refetch()}
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
}) {
  const inactive = checkIn.status_flag === 'pink';
  const slotName = getAssignedSlotName(checkIn);
  // T-20260612-foot-WAITELAPSED-POLISH AC-3: 콜(진료호출 purple) 시각 기준 "+N분" 분단위 컴팩트 표기('콜 후' 제거).
  const elapsed = formatElapsedPlus(elapsedMinutes(getCallTime(checkIn)));
  const [showRx, setShowRx] = useState(false);
  // T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 팝오버 anchor(알약 버튼) — 좌표 기준점.
  const rxBtnRef = useRef<HTMLButtonElement>(null);
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 인풋(아코디언 아님), 토글로 노출/숨김.
  const [showClinical, setShowClinical] = useState(false);
  // T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④(문지은 대표원장): 임상경과 미리보기 셀 클릭 → 행 아래로 전체내용 펼침(읽기). 재클릭/외부클릭→접힘.
  const [expandClinical, setExpandClinical] = useState(false);

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
        <td className="px-1.5 py-1 text-left" data-testid="doctor-call-room-cell">
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
        <td className="px-1.5 py-1 text-left">
          <span className="inline-flex items-center justify-start gap-1 text-[13px] font-medium text-gray-700">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', inactive ? 'bg-gray-300' : 'bg-red-500')}
            />
            {inactive ? '진료완료' : '진료필요'}
            {!inactive && (
              <HandToggle
                checkIn={checkIn}
                doctorMode={doctorMode}
                actor={actor}
                completed={false}
                onRefresh={onRefresh}
              />
            )}
          </span>
        </td>

        {/* 3. 이름 — 초/재 레이블 + 이름(중앙정렬, 진료차트 클릭). 이름 옆 이모지/손/꺾쇠 없음. */}
        <td className="px-1.5 py-1 text-left">
          <div className="flex items-center justify-start gap-1.5">
            <VisitBadge visitType={checkIn.visit_type} />
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-call-name-chart-btn"
              title="이름 클릭 — 진료차트 열기 (서랍)"
              className={cn(
                'min-w-[4rem] break-keep text-left underline-offset-2 transition-colors disabled:cursor-default disabled:no-underline',
                inactive
                  ? 'text-gray-500 hover:text-gray-700 hover:underline'
                  : 'text-gray-900 hover:text-indigo-700 hover:underline cursor-pointer',
              )}
            >
              <span className="block text-[15px] font-semibold">{checkIn.customer_name}</span>
            </button>
          </div>
          {/* 전달사항 메모 */}
          {checkIn.doctor_call_memo && (
            <p className="mt-0.5 text-[13px] text-gray-600">📋 {checkIn.doctor_call_memo}</p>
          )}
        </td>

        {/* 4. 생년(만나이) — T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: customers.birth_date 파생 "YYYY (만 N세)". 결측 '—'. 중앙정렬. */}
        <td className="px-1.5 py-1 text-left">
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
        <td className="px-1.5 py-1 text-left">
          <span className="font-mono text-[13px] text-gray-500" data-testid="doctor-call-chartno">
            {chartNoDisplay(readChartNo(checkIn))}
          </span>
        </td>

        {/* 6. 오늘시술 — 중앙정렬. */}
        <td className="px-1.5 py-1 text-left">
          <ProcedureCell checkIn={checkIn} />
        </td>

        {/* 7. 차트 — 임상경과 단축이모지(📝, 인라인 입력 토글) + 진료차트(🩺, 서랍). 중앙정렬. */}
        <td className="px-1.5 py-1 text-left" data-testid="doctor-call-chart-cell">
          <div className="inline-flex items-center justify-start gap-1">
            <button
              type="button"
              onClick={() => setShowClinical((v) => !v)}
              disabled={!checkIn.customer_id}
              aria-expanded={showClinical}
              data-testid="doctor-call-chart-btn"
              className={CHART_CELL_EMOJI_BTN}
              title="임상경과 한 줄 입력"
            >
              <span aria-hidden>📝</span>
            </button>
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-call-fullchart-btn"
              className={CHART_CELL_EMOJI_BTN}
              title="진료차트 열기 (서랍)"
            >
              <span aria-hidden>🩺</span>
            </button>
          </div>
        </td>

        {/* 8. 처방 — AC-7(FULLWIDTH 보존): 확정 시 알약버튼 제거→파란글씨 '처방완료'(plainText)+약명 미리보기. 미처방 시 알약 드롭다운. 중앙정렬. */}
        <td className="px-1.5 py-1 text-left" data-testid="doctor-call-rx-cell">
          <div className="flex flex-wrap items-center justify-start gap-1.5">
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

        {/* 9. 임상경과 — CALLUX-3FIX AC-1: 처방 '오른쪽'(요청순서 끝). 미리보기 전용(최신 1줄 말줄임, 입력은 차트칼럼 📝). 중앙정렬.
            T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④: 내용 있으면 클릭 가능 → 행 아래로 전체내용 펼침(읽기 토글). */}
        <td className="px-1.5 py-1 text-left" data-testid="doctor-call-clinical-cell">
          {clinicalPreview ? (
            <button
              type="button"
              onClick={() => setExpandClinical((v) => !v)}
              aria-expanded={expandClinical}
              data-testid="doctor-call-clinical-expand-btn"
              title="클릭하면 전체 내용이 펼쳐져요"
              className="block w-full max-w-full truncate text-left text-[13px] text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              {clinicalPreview}
            </button>
          ) : (
            <span className="text-[13px] text-gray-300">—</span>
          )}
        </td>

        {/* 10(끝). 시간 — AC-1 dev판단 기본보존(요청순서 미포함이나 경과시간 유지). 시계 이모지 제거, "+N분" 텍스트만. 중앙정렬. */}
        <td className="px-1.5 py-1 text-left">
          <span className="text-[13px] text-muted-foreground" data-testid="doctor-call-elapsed">
            {elapsed}
          </span>
        </td>
      </tr>

      {/* T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 드롭다운 펼침행(<tr colSpan>) 폐지 →
          처방 셀의 RxPopover(알약 anchor portal 팝오버)로 대체. 더 이상 행을 밀어내지 않음. */}

      {/* T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 텍스트 인풋(singleLine).
          tall 아코디언 제거 — MedicalChartPanel singleLine 모드 재사용(저장 로직·진료의 NOT NULL 강제 동일). */}
      {showClinical && checkIn.customer_id && (
        <tr data-testid="doctor-call-chart-inline-row" className={inactive ? 'bg-gray-50/60' : 'bg-white'}>
          <td colSpan={DOCDASH_COLSPAN} className="px-3 pb-2" data-testid="doctor-call-chart-inline">
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
              onSaved={() => setShowClinical(false)}
            />
          </td>
        </tr>
      )}

      {/* T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④: 임상경과 미리보기 클릭 시 행 아래 전체내용(읽기) 펼침.
          말줄임 없는 전문(whitespace 보존). 재클릭은 동일 셀 버튼 토글로 접힘. 입력은 별도(📝 차트칼럼). */}
      {expandClinical && clinicalPreview && (
        <tr data-testid="doctor-call-clinical-expand-row" className={inactive ? 'bg-gray-50/60' : 'bg-gray-50'}>
          <td colSpan={DOCDASH_COLSPAN} className="px-3 pb-2 pt-0">
            <div
              className="whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-gray-700"
              data-testid="doctor-call-clinical-expand"
            >
              {clinicalPreview}
            </div>
          </td>
        </tr>
      )}
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
  actor,
  clinicalPreview,
  onOpenChart,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  role: string;
  clinicId: string;
  currentUserEmail: string | null;
  /** T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-4: 상태셀 ✋ 토글(HandToggle) status_flag 전이 처리자 기록. */
  actor: FlagTransitionActor;
  /** T-20260612-foot-DOCDASH-11FIX AC-11: 최신 임상경과 1줄 미리보기(없으면 null). */
  clinicalPreview: string | null;
  onOpenChart: (customerId: string, variant?: 'full' | 'clinical') => void;
  onRefresh: () => void;
}) {
  const slotName = getAssignedSlotName(checkIn);
  // T-20260612-foot-DOCDASH-WAITFILTER-UX7 AC-7 (POLISH AC-4 supersede): 진료 완료 섹션은 경과시간 칼럼 자체 제거(7칼럼).
  //   완료환자는 대기시간 불요(문지은 대표원장). 호출 섹션은 경과시간 유지.
  const [showRx, setShowRx] = useState(false);
  // T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 팝오버 anchor(알약 버튼) — 좌표 기준점.
  const rxBtnRef = useRef<HTMLButtonElement>(null);
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 인풋(아코디언 아님) 토글.
  const [showClinical, setShowClinical] = useState(false);
  // T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④(문지은 대표원장): 임상경과 미리보기 셀 클릭 → 행 아래로 전체내용 펼침(읽기). 재클릭→접힘.
  const [expandClinical, setExpandClinical] = useState(false);
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
        <td className="px-1.5 py-1 text-left" data-testid="doctor-completed-room-cell">
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
        <td className="px-1.5 py-1 text-left">
          <div className="flex flex-wrap items-center justify-start gap-1.5">
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
            {/* T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-4/AC-5a: 진료완료 = 파랑 ✋(의사ack 뱃지 대체). cross-client DB-backed. */}
            <HandToggle
              checkIn={checkIn}
              doctorMode={doctorMode}
              actor={actor}
              completed
              onRefresh={onRefresh}
            />
          </div>
        </td>

        {/* 3. 이름 — 초/재 레이블 + 이름(중앙정렬, 진료차트 클릭). 이름 옆 이모지/손/꺾쇠 없음. */}
        <td className="px-1.5 py-1 text-left">
          <div className="flex items-center justify-start gap-1.5">
            <VisitBadge visitType={checkIn.visit_type} />
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-completed-name-chart-btn"
              title="이름 클릭 — 진료차트 열기 (서랍)"
              className="min-w-[4rem] break-keep text-left underline-offset-2 transition-colors cursor-pointer hover:text-indigo-700 hover:underline disabled:cursor-default disabled:no-underline"
            >
              <span className="block text-[15px] font-semibold">{checkIn.customer_name}</span>
            </button>
          </div>
        </td>

        {/* 4. 생년(만나이) — T-20260613-foot-DOCDASH-CALLUX-3FIX AC-1: customers.birth_date 파생 "YYYY (만 N세)". 결측 '—'. 중앙정렬. */}
        <td className="px-1.5 py-1 text-left">
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
        <td className="px-1.5 py-1 text-left">
          <span className="font-mono text-[13px] text-gray-500" data-testid="doctor-completed-chartno">
            {chartNoDisplay(readChartNo(checkIn))}
          </span>
        </td>

        {/* 6. 오늘시술 — 중앙정렬. */}
        <td className="px-1.5 py-1 text-left">
          <ProcedureCell checkIn={checkIn} />
        </td>

        {/* 7. 차트 — 임상경과 단축이모지(📝, 인라인 입력 토글) + 진료차트(🩺, 서랍). 중앙정렬. */}
        <td className="px-1.5 py-1 text-left" data-testid="doctor-completed-chart-cell">
          <div className="inline-flex items-center justify-start gap-1">
            <button
              type="button"
              onClick={() => setShowClinical((v) => !v)}
              disabled={!checkIn.customer_id}
              aria-expanded={showClinical}
              data-testid="doctor-completed-chart-btn"
              className={CHART_CELL_EMOJI_BTN}
              title="임상경과 한 줄 입력"
            >
              <span aria-hidden>📝</span>
            </button>
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-completed-fullchart-btn"
              className={CHART_CELL_EMOJI_BTN}
              title="진료차트 열기 (서랍)"
            >
              <span aria-hidden>🩺</span>
            </button>
          </div>
        </td>

        {/* 8. 처방 — AC-7(보존): 귀가(discharged) 미처방 '-', 원내잔류 알약 드롭다운, 확정 시 파란글씨 '처방완료'+미리보기. 중앙정렬. */}
        <td className="px-1.5 py-1 text-left" data-testid="doctor-completed-rx-cell">
          <div className="flex flex-wrap items-center justify-start gap-1.5">
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

        {/* 9(끝). 임상경과 — CALLUX-3FIX AC-1: 처방 '오른쪽'(요청순서 끝). 미리보기 전용(입력은 차트칼럼 📝). 중앙정렬.
            T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④: 내용 있으면 클릭 가능 → 행 아래로 전체내용 펼침(읽기 토글). */}
        <td className="px-1.5 py-1 text-left" data-testid="doctor-completed-clinical-cell">
          {clinicalPreview ? (
            <button
              type="button"
              onClick={() => setExpandClinical((v) => !v)}
              aria-expanded={expandClinical}
              data-testid="doctor-completed-clinical-expand-btn"
              title="클릭하면 전체 내용이 펼쳐져요"
              className="block w-full max-w-full truncate text-left text-[13px] text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              {clinicalPreview}
            </button>
          ) : (
            <span className="text-[13px] text-gray-300">—</span>
          )}
        </td>
      </tr>

      {/* T-20260612-foot-DOCDASH-RXCELL-REFINE item2: 처방 드롭다운 펼침행(<tr colSpan>) 폐지 →
          처방 셀의 RxPopover(알약 anchor portal 팝오버)로 대체(완료 섹션 동일). */}

      {/* T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 진료완료 환자도 임상경과 = 한 줄 인풋(singleLine). */}
      {showClinical && checkIn.customer_id && (
        <tr data-testid="doctor-completed-chart-inline-row" className="bg-white">
          <td colSpan={DOCDASH_COMPLETED_COLSPAN} className="px-3 pb-2" data-testid="doctor-completed-chart-inline">
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
              onSaved={() => setShowClinical(false)}
            />
          </td>
        </tr>
      )}

      {/* T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item④: 임상경과 미리보기 클릭 시 행 아래 전체내용(읽기) 펼침(완료 섹션 동일).
          말줄임 없는 전문(whitespace 보존). 재클릭은 동일 셀 버튼 토글로 접힘. 입력은 별도(📝 차트칼럼). */}
      {expandClinical && clinicalPreview && (
        <tr data-testid="doctor-completed-clinical-expand-row" className="bg-gray-50">
          <td colSpan={DOCDASH_COMPLETED_COLSPAN} className="px-3 pb-2 pt-0">
            <div
              className="whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-gray-700"
              data-testid="doctor-completed-clinical-expand"
            >
              {clinicalPreview}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── 상태 셀 ✋ 손 토글 (단색 미니멀) ──────────────────────────────────────────
// T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT AC-4/AC-5 (현장 미니멀 리레이아웃):
//   상태 셀 '진료필요' 옆 ✋ 아이콘 1개로 3-상태 토글. 별도 버튼/라벨 없이 손 아이콘 색으로 단계 표상:
//     • 회색 + SHAKE  = 진료필요·미ack(초기). 클릭 → 의사 전용 ✋확인(recordAck → doctor_ack_at).
//     • 초록(emerald) = 의사 확인됨(acked). 클릭 → 진료완료(applyStatusFlagTransition purple→pink). 의사+직원.
//     • 파랑(blue)    = 진료완료(completed). AC-5b 옵션 B(데이터 보수) — 클릭해도 완료 해제 안 함(안내 토스트만).
//   교차 클라이언트 동기화(AC-5a): 로컬 state 아님 — doctor_ack_at/status_flag DB값을 그대로 색으로 투영,
//     write 후 onRefresh → realtime refetch 로 타 기기 자동 반영.
//   ⚠ 상태머신 신설 0 — 기존 recordAck(DoctorAck) + applyStatusFlagTransition(SSOT) 재사용(스키마 무변경).
//   ⚠ GUARD(의료법): ack/완료 전이는 medical_charts 진료의 강제(MEDCHART-SIGN-AUDIT) 무관(무회귀).
//   권한: 회색→초록(ack) = 의사 전용. 초록→파랑(완료) = 의사 + 직원(staff) 공통.
function HandToggle({
  checkIn,
  doctorMode,
  actor,
  completed,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  actor: FlagTransitionActor;
  /** 진료 완료 테이블(파랑·잠금) 여부. true면 AC-5b 옵션 B 안내 토스트만. */
  completed: boolean;
  onRefresh: () => void;
}) {
  const [pending, setPending] = useState(false);
  const acked = isDoctorAcked(checkIn.doctor_ack_at);
  const visual: 'blue' | 'green' | 'shake' = completed ? 'blue' : acked ? 'green' : 'shake';

  const handleClick = async () => {
    if (pending) return;
    // 파랑(완료) — AC-5b 옵션 B: 완료 해제 안 함(데이터 보수). 안내만.
    if (visual === 'blue') {
      toast.warning('이미 진료완료된 환자예요. 완료 해제는 지원하지 않아요.');
      return;
    }
    // 회색(초기) — 의사 전용 ✋확인(ack). 직원 클릭은 차단 안내.
    if (visual === 'shake') {
      if (!doctorMode) {
        toast.warning('의사만 확인(손 들기)할 수 있어요.');
        return;
      }
      setPending(true);
      try {
        await recordAck(checkIn.id);
        onRefresh();
        toast.confirm('환자에게 손을 들었어요. 호출 직원 화면에 바로 표시돼요.');
      } catch (e) {
        toast.error(`확인 표시 실패: ${(e as Error).message}`);
      } finally {
        setPending(false);
      }
      return;
    }
    // 초록(확인됨) — 진료완료 전이(purple→pink). 의사+직원 공통.
    setPending(true);
    try {
      await applyStatusFlagTransition(checkIn, 'pink', actor);
      onRefresh();
      toast.confirm('진료완료 처리했어요. 활성 호출 명단에서 빠졌어요.');
    } catch (e) {
      toast.error(`진료완료 처리 실패: ${(e as Error).message}`);
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
      ? '진료완료됨 (완료 해제 미지원)'
      : visual === 'green'
        ? '의사 확인됨 — 클릭하면 진료완료 처리'
        : '의사 확인(손 들기) — 클릭하면 환자에게 확인 신호';

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
