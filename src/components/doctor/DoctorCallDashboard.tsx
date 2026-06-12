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
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Stethoscope,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  FileText,
  Pill,
  MapPin,
  CheckCircle2,
  Clock,
  Loader2,
  Handshake,
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
import { todaySeoulISODate } from '@/lib/format';
import { getAssignedSlotName } from '@/lib/checkin-slot';
import {
  loadMute,
  saveMute,
  loadNotifyEnabled,
  saveNotifyEnabled,
  getCallTime,
  callKey,
  elapsedMinutes,
  formatSinceCall,
  treatmentLabel,
} from '@/lib/doctor-call-notify';
import { checkRxInClinic } from '@/lib/inClinicRxGate';
import {
  useDoctorCallNotifier,
  requestNotifyPermission,
  currentNotifyPermission,
} from '@/hooks/useDoctorCallNotifier';
import QuickRxBar, { isDoctor, RxConfirmedSummary } from './QuickRxBar';
import { DoctorAckButton, DoctorAckBadge, isDoctorAcked } from './DoctorAck';
import { applyStatusFlagTransition, type FlagTransitionActor } from '@/lib/statusFlagTransition';
import type { CheckIn } from '@/lib/types';

const CALL_SELECT =
  'id, customer_id, customer_name, visit_type, status, status_flag, status_flag_history, ' +
  'checked_in_at, completed_at, treatment_kind, treatment_category, prescription_status, prescription_items, ' +
  'doctor_call_memo, doctor_ack_at, queue_number, consultation_room, treatment_room, laser_room, examination_room';

// T-20260612-foot-DOCDASH-TABLE-BTN-MINIMIZE (문지은 대표원장 follow-up):
//   테이블 셀 액션을 '버튼 박스(bg/border)' → 텍스트/아이콘 링크로 축소. 클릭 동선은 유지(기능 제거 아님).
//   컬러는 상태 dot 1~2색만, 액션·아이콘은 무채색 텍스트 톤. chevron(펼침 화살표)은 전면 제거(aria-expanded로 상태 표현).
const CELL_ACTION_BTN =
  'inline-flex items-center gap-1 px-1 py-1 text-[11px] font-medium text-gray-600 transition-colors ' +
  'hover:text-gray-900 hover:underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:hover:no-underline';

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

  // 활성 호출(purple) — 발생시각 내림차순(신규 상단)
  const activeCalls = useMemo(
    () =>
      rows
        .filter((ci) => ci.status_flag === 'purple')
        .sort((a, b) => getCallTime(b).localeCompare(getCallTime(a))),
    [rows],
  );

  // 처리완료 호출(pink) — 흐리게 잔존
  const doneCalls = useMemo(
    () =>
      rows
        .filter((ci) => ci.status_flag === 'pink')
        .sort((a, b) => getCallTime(b).localeCompare(getCallTime(a))),
    [rows],
  );

  // 진료 완료 환자(completed_at) — 당일
  const completedPatients = useMemo(
    () =>
      rows
        .filter((ci) => ci.completed_at)
        .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
    [rows],
  );

  // 소리 + 브라우저 알림 (신규 호출 감지). 앱레벨 알림 OFF면 OS배너/토스트 생략(소리는 muted 별도).
  useDoctorCallNotifier(activeCalls, { muted, notifyEnabled });

  const feed = useMemo(() => [...activeCalls, ...doneCalls], [activeCalls, doneCalls]);

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

      {/* 알람 누적 피드 */}
      <section className="rounded-xl border border-red-200 bg-white" data-testid="doctor-call-feed">
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/70 px-3 py-2">
          {/* T-20260612-foot-DOCDASH-11FIX AC-1: 전화 아이콘 제거 → 호출 알람 의미의 Bell 로 교체. */}
          <Bell className="h-4 w-4 text-red-600" />
          <span className="text-sm font-semibold text-red-800">진료 호출 알람</span>
          <span className="rounded-full bg-red-100 px-1.5 py-px text-xs font-medium text-red-600">
            진료필요 {activeCalls.length}
          </span>
          {doneCalls.length > 0 && (
            <span className="rounded-full bg-gray-100 px-1.5 py-px text-xs font-medium text-gray-500">
              완료 {doneCalls.length}
            </span>
          )}
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
          // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE A안: 환자 목록 → 테이블뷰(행=환자, 열=이름|방|처방|상태).
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm" data-testid="doctor-call-feed-table">
              {/* T-20260612-foot-DOCDASH-11FIX AC-3: table-fixed + colgroup 으로 열 너비 고정 → 행마다 컬럼 어긋남 제거. */}
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[14%]" />
                <col className="w-[18%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-[11px] font-semibold text-muted-foreground">
                  <th className="px-3 py-1.5">이름</th>
                  <th className="px-3 py-1.5">방</th>
                  <th className="px-3 py-1.5">처방</th>
                  <th className="px-3 py-1.5">상태</th>
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
                    onOpenChart={openTreatmentChart}
                    onRefresh={() => void refetch()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 진료 완료 환자 */}
      <section className="rounded-xl border" data-testid="doctor-completed-section">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold">진료 완료 환자</span>
          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-xs font-medium text-emerald-700">
            {completedPatients.length}명
          </span>
        </div>
        {completedPatients.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            아직 진료 완료된 환자가 없어요.
          </div>
        ) : (
          // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE A안: 진료 완료 환자도 동일 테이블뷰(열=이름|방|처방|상태).
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm" data-testid="doctor-completed-table">
              {/* T-20260612-foot-DOCDASH-11FIX AC-3+AC-11: table-fixed + colgroup, 진료완료 테이블 한정 '임상경과' 열 추가. */}
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[18%]" />
                <col className="w-[28%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-[11px] font-semibold text-muted-foreground">
                  <th className="px-3 py-1.5">이름</th>
                  <th className="px-3 py-1.5">방</th>
                  <th className="px-3 py-1.5">처방</th>
                  <th className="px-3 py-1.5">상태</th>
                  <th className="px-3 py-1.5">임상경과</th>
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
  onOpenChart,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  role: string;
  clinicId: string;
  currentUserEmail: string | null;
  actor: FlagTransitionActor;
  onOpenChart: (customerId: string, variant?: 'full' | 'clinical') => void;
  onRefresh: () => void;
}) {
  const inactive = checkIn.status_flag === 'pink';
  const slotName = getAssignedSlotName(checkIn);
  // T-20260612-foot-DOCDASH-11FIX AC-7: 콜(진료호출 purple) 시각 기준 "콜 후 _분 경과" 표기.
  const elapsed = formatSinceCall(elapsedMinutes(getCallTime(checkIn)));
  const [showRx, setShowRx] = useState(false);
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 인풋(아코디언 아님), 토글로 노출/숨김.
  const [showClinical, setShowClinical] = useState(false);

  return (
    // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE A안: 행=환자, 열=이름|방|처방|상태. 액션은 각 열 내부 컴팩트 배치.
    //   기존 동작(이름→진료차트 / 처방 / 임상경과 / 진료완료 / 의사ack / 방이름)은 전부 유지 — 레이아웃만 테이블화.
    <>
      <tr
        data-testid="doctor-call-feed-row"
        data-checkin-id={checkIn.id}
        data-inactive={String(inactive)}
        className={cn('align-top transition', inactive ? 'bg-gray-50/60 opacity-70' : 'bg-white')}
      >
        {/* 이름 — T-20260612-foot-DOCDASH-11FIX AC-1(전화아이콘 제거)·AC-2(초/재진 좌측)·AC-4(손들기 우측+이름 너비)·AC-8(2단계) */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {/* AC-2: 초진/재진 레이블을 이름 왼쪽에 배치. */}
            <VisitBadge visitType={checkIn.visit_type} />
            {/* 이름 클릭 → 진료차트(variant='full') 서랍. 기존 onOpenChart 재사용(회귀 없음).
                AC-4: min-w 확보 + break-keep 으로 이름이 잘리지 않게. */}
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-call-name-chart-btn"
              title="이름 클릭 — 진료차트 열기 (서랍)"
              className={cn(
                'min-w-[4rem] break-keep text-sm font-semibold text-left underline-offset-2 transition-colors disabled:cursor-default disabled:no-underline',
                inactive
                  ? 'text-gray-500 hover:text-gray-700 hover:underline'
                  : 'text-gray-900 hover:text-indigo-700 hover:underline cursor-pointer',
              )}
            >
              {checkIn.customer_name}
            </button>
            {/* AC-4+AC-8: 손들기 2단계 워크플로우 — 이름 셀 오른쪽. 활성 호출(purple)에만. */}
            {!inactive && (
              <span className="ml-auto shrink-0">
                <HandRaiseFlow
                  checkIn={checkIn}
                  doctorMode={doctorMode}
                  actor={actor}
                  onRefresh={onRefresh}
                />
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{treatmentLabel(checkIn)}</p>
          {/* 전달사항 메모 */}
          {checkIn.doctor_call_memo && (
            <p className="mt-0.5 text-[11px] text-gray-600">📋 {checkIn.doctor_call_memo}</p>
          )}
        </td>

        {/* 방 — 방이름 표시 유지(reporter 긍정 확인됨, 회귀 금지) */}
        <td className="px-3 py-2" data-testid="doctor-call-room-cell">
          {slotName ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-600">
              <MapPin className="h-2.5 w-2.5 text-gray-400" />
              {slotName}
            </span>
          ) : (
            <span className="text-[11px] text-gray-300">-</span>
          )}
        </td>

        {/* 처방 */}
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowRx((v) => !v)}
              data-testid="doctor-call-rx-btn"
              aria-expanded={showRx}
              className={CELL_ACTION_BTN}
            >
              <Pill className="h-3 w-3 text-gray-400" />
              처방
            </button>
            {/* T-20260609-foot-QUICKRX-DROPDOWN-LIST-REDESIGN AC-2/4 + T-20260611-DISCHARGED-DASH-RXMUTATE-LOCK 게이트 prop 유지. */}
            {checkIn.prescription_status === 'confirmed' && (
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
              />
            )}
          </div>
        </td>

        {/* 상태 — 진료필요/완료 + 경과 + 임상경과/진료차트.
            T-20260612-foot-DOCDASH-11FIX AC-8: 의사ack(손들기)·진료완료는 이름 셀의 HandRaiseFlow(2단계)로 이전. */}
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700">
              <span
                className={cn('h-1.5 w-1.5 rounded-full', inactive ? 'bg-gray-300' : 'bg-red-500')}
              />
              {inactive ? '진료완료' : '진료필요'}
            </span>
            {/* AC-7: 콜 후 경과시간. */}
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {elapsed}
            </span>
            {/* 임상경과 — 한 줄 인풋 토글(B안). AC1-4 라벨 '임상경과' 유지. */}
            <button
              type="button"
              onClick={() => setShowClinical((v) => !v)}
              disabled={!checkIn.customer_id}
              aria-expanded={showClinical}
              data-testid="doctor-call-chart-btn"
              className={CELL_ACTION_BTN}
              title="임상경과를 한 줄로 빠르게 입력"
            >
              <FileText className="h-3 w-3 text-gray-400" />
              임상경과
            </button>
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-call-fullchart-btn"
              className={CELL_ACTION_BTN}
              title="전체 진료차트 열기 (서랍)"
            >
              <Stethoscope className="h-3 w-3 text-gray-400" />
              진료차트
            </button>
          </div>
        </td>
      </tr>

      {/* 처방 인라인 펼침 — 전체폭 행 */}
      {showRx && (
        <tr data-testid="doctor-call-rx-expand-row" className={inactive ? 'bg-gray-50/60' : 'bg-white'}>
          <td colSpan={4} className="px-3 pb-2">
            <div className="rounded-lg border bg-white p-2">
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
            </div>
          </td>
        </tr>
      )}

      {/* T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 텍스트 인풋(singleLine).
          tall 아코디언 제거 — MedicalChartPanel singleLine 모드 재사용(저장 로직·진료의 NOT NULL 강제 동일). */}
      {showClinical && checkIn.customer_id && (
        <tr data-testid="doctor-call-chart-inline-row" className={inactive ? 'bg-gray-50/60' : 'bg-white'}>
          <td colSpan={4} className="px-3 pb-2" data-testid="doctor-call-chart-inline">
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
}) {
  const slotName = getAssignedSlotName(checkIn);
  const [showRx, setShowRx] = useState(false);
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 = 한 줄 인풋(아코디언 아님) 토글.
  const [showClinical, setShowClinical] = useState(false);
  // T-20260612-foot-DOCDASH-11FIX AC-9/AC-10: 귀가(true discharge) 판정 = QUICKRX-INCLINIC-GATE SSOT 재사용.
  //   status==='done' → 귀가(처방게이트 reason='discharged'). 그 외(원내 잔류) → 처방 버튼 유지(회귀 금지).
  const dischargeGate = checkRxInClinic({
    status: checkIn.status,
    status_flag: checkIn.status_flag,
    checked_in_at: checkIn.checked_in_at,
  });
  const discharged = dischargeGate.reason === 'discharged';
  return (
    // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE A안: 진료완료 환자도 테이블 행(열=이름|방|처방|상태).
    <>
      <tr className="align-top" data-testid="doctor-completed-row" data-checkin-id={checkIn.id}>
        {/* 이름 — 클릭 시 진료차트(variant='full') 서랍 오픈(기존 onOpenChart 재사용).
            T-20260612-foot-DOCDASH-11FIX AC-2: 초/재진 레이블 이름 왼쪽 / AC-4: 이름 너비 확보. */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <VisitBadge visitType={checkIn.visit_type} />
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-completed-name-chart-btn"
              title="이름 클릭 — 진료차트 열기 (서랍)"
              className="min-w-[4rem] break-keep text-sm font-semibold text-left underline-offset-2 transition-colors cursor-pointer hover:text-indigo-700 hover:underline disabled:cursor-default disabled:no-underline"
            >
              {checkIn.customer_name}
            </button>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{treatmentLabel(checkIn)}</p>
        </td>

        {/* 방 — 방이름 표시 유지(회귀 금지) */}
        <td className="px-3 py-2" data-testid="doctor-completed-room-cell">
          {slotName ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-600">
              <MapPin className="h-2.5 w-2.5 text-gray-400" />
              {slotName}
            </span>
          ) : (
            <span className="text-[11px] text-gray-300">-</span>
          )}
        </td>

        {/* 처방 — T-20260612-foot-DOCDASH-11FIX AC-9: 귀가(discharged) 환자는 처방 버튼 숨기고 결과(내역)만 표시.
            원내 잔류(in-clinic) 환자는 기존 처방 버튼 유지(QUICKRX-INCLINIC-GATE 무회귀). */}
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {!discharged && (
              <button
                type="button"
                onClick={() => setShowRx((v) => !v)}
                aria-expanded={showRx}
                data-testid="doctor-completed-rx-btn"
                className={CELL_ACTION_BTN}
              >
                <Pill className="h-3 w-3 text-gray-400" />
                처방
              </button>
            )}
            {/* T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK 게이트 prop 유지(진료완료 무회귀). */}
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
              />
            ) : (
              <span className="text-[10px] text-muted-foreground">처방 없음</span>
            )}
          </div>
        </td>

        {/* 상태 — T-20260612-foot-DOCDASH-11FIX AC-10: '진료완료'(자명) → 귀가 여부 상태로 교체.
            귀가(status==='done') = '귀가'(emerald) / 원내 잔류 = '귀가 대기'(amber). */}
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700"
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
            {/* T-20260609-foot-DOCCALL-DOCTOR-ACK: 진료완료 환자도 의사 확인 이력 조회(표시 전용). */}
            <DoctorAckBadge ackAt={checkIn.doctor_ack_at} />
            <button
              type="button"
              onClick={() => setShowClinical((v) => !v)}
              disabled={!checkIn.customer_id}
              aria-expanded={showClinical}
              data-testid="doctor-completed-chart-btn"
              className={CELL_ACTION_BTN}
              title="임상경과를 한 줄로 빠르게 입력"
            >
              <FileText className="h-3 w-3 text-gray-400" />
              임상경과
            </button>
            <button
              type="button"
              onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}
              disabled={!checkIn.customer_id}
              data-testid="doctor-completed-fullchart-btn"
              className={CELL_ACTION_BTN}
              title="전체 진료차트 열기 (서랍)"
            >
              <Stethoscope className="h-3 w-3 text-gray-400" />
              진료차트
            </button>
          </div>
        </td>

        {/* 임상경과 — T-20260612-foot-DOCDASH-11FIX AC-11: 진료완료 테이블 한정 최신 임상경과 1줄 미리보기(말줄임). */}
        <td className="px-3 py-2" data-testid="doctor-completed-clinical-cell">
          {clinicalPreview ? (
            <span className="block truncate text-[11px] text-gray-600" title={clinicalPreview}>
              {clinicalPreview}
            </span>
          ) : (
            <span className="text-[11px] text-gray-300">-</span>
          )}
        </td>
      </tr>

      {showRx && (
        <tr data-testid="doctor-completed-rx-expand-row" className="bg-white">
          <td colSpan={5} className="px-3 pb-2">
            <div className="rounded-lg border bg-white p-2">
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
            </div>
          </td>
        </tr>
      )}

      {/* T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 진료완료 환자도 임상경과 = 한 줄 인풋(singleLine). */}
      {showClinical && checkIn.customer_id && (
        <tr data-testid="doctor-completed-chart-inline-row" className="bg-white">
          <td colSpan={5} className="px-3 pb-2" data-testid="doctor-completed-chart-inline">
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
    </>
  );
}

// ─── 손들기 2단계 워크플로우 ──────────────────────────────────────────────────
// T-20260612-foot-DOCDASH-11FIX AC-8 (문지은 대표원장):
//   1단계: 손들기 버튼(의사 전용 ✋확인 = doctor_ack_at) → '확인됨' + 손 두 개 겹친 아이콘(Handshake).
//   2단계: 두손 아이콘 클릭 → 진료완료(status_flag purple→pink). 의사 + 직원(staff) 모두 가능.
//   ⚠ GUARD(의료법): 1단계(ack)/2단계(완료) 모두 진료의 귀속(signing_doctor) NOT NULL 강제와 무관 —
//     ack 컬럼/완료 전이는 medical_charts 진료의 강제(MEDCHART-SIGN-AUDIT)를 만지지 않는다(무회귀).
//   상태머신 신설 0 — 기존 recordAck(DoctorAck) + applyStatusFlagTransition(SSOT) 재사용(스키마 무변경).
function HandRaiseFlow({
  checkIn,
  doctorMode,
  actor,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  actor: FlagTransitionActor;
  onRefresh: () => void;
}) {
  const acked = isDoctorAcked(checkIn.doctor_ack_at);
  // 2단계: 확인됨(acked) → 두손(Handshake) 클릭 = 진료완료. 의사+직원 공통.
  if (acked) {
    return <TreatmentCompleteButton checkIn={checkIn} actor={actor} onCompleted={onRefresh} />;
  }
  // 1단계: 손들기(의사 전용 ✋확인). 직원에겐 미노출(ack 권한 = 의사). 라벨만 '손들기'로 노출.
  return (
    <DoctorAckButton
      checkInId={checkIn.id}
      ackAt={checkIn.doctor_ack_at}
      doctorMode={doctorMode}
      onAcked={onRefresh}
      label="손들기"
    />
  );
}

// ─── 진료완료 버튼 (손들기 2단계 中 2단계 = 두손 겹친 아이콘) ────────────────────
// T-20260610-foot-TREATMENT-COMPLETE-BTN (문지은 대표원장, B안):
//   진료호출(purple) 환자를 의사/직원 누구나 '진료완료' 처리 → status_flag purple→pink 전이로
//   활성 명단(진료필요)에서 제거. status_flag 전이는 applyStatusFlagTransition(SSOT)에 위임 —
//   병렬 2nd write 신설 금지. 처리자(id/이름/역할)는 history 엔트리에 적재(의료 추적).
//   ⚠️ doctor_ack_at(✋확인=손들기 1단계)과 별개 — 이 버튼은 ack 컬럼을 만지지 않는다(종료 신호).
// T-20260612-foot-DOCDASH-11FIX AC-8: 아이콘 = 손 두 개 겹친 Handshake('확인됨' 상태 표상), 클릭 시 진료완료.
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
      data-ack="confirmed"
      aria-label="확인됨 — 클릭하면 진료완료 처리"
      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 active:scale-95 disabled:opacity-50"
      title="확인됨 — 클릭하면 이 환자 진료를 완료 처리해요 (활성 호출 명단에서 제거)"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Handshake className="h-3.5 w-3.5" />}
      진료완료
    </button>
  );
}

function VisitBadge({ visitType }: { visitType: CheckIn['visit_type'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: '초진', cls: 'bg-blue-100 text-blue-700' },
    returning: { label: '재진', cls: 'bg-emerald-100 text-emerald-700' },
    experience: { label: '체험', cls: 'bg-purple-100 text-purple-700' },
  };
  const { label, cls } = map[visitType] ?? { label: visitType, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={cn('rounded px-1 py-px text-[10px] font-medium', cls)}>{label}</span>
  );
}
