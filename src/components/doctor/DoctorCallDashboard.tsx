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
  Phone,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  FileText,
  Pill,
  MapPin,
  Check,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
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
  getCallTime,
  callKey,
  elapsedMinutes,
  formatElapsed,
  treatmentLabel,
} from '@/lib/doctor-call-notify';
import {
  useDoctorCallNotifier,
  requestNotifyPermission,
  currentNotifyPermission,
} from '@/hooks/useDoctorCallNotifier';
import QuickRxBar, { isDoctor } from './QuickRxBar';
import type { CheckIn } from '@/lib/types';

const CALL_SELECT =
  'id, customer_id, customer_name, visit_type, status, status_flag, status_flag_history, ' +
  'checked_in_at, completed_at, treatment_kind, treatment_category, prescription_status, ' +
  'doctor_call_memo, queue_number, consultation_room, treatment_room, laser_room, examination_room';

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

export default function DoctorCallDashboard() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const doctorMode = isDoctor(profile?.role ?? '');
  // T-20260603-foot-RX-CHART-FOLLOWUP3 C-1: 차팅 클릭 → '진료차트'(MedicalChartPanel) 직접 오픈.
  //   FOLLOWUP2 #6은 2번차트 서랍(펜차트=기본차트)으로 열려 현장 의도(진단/경과/처방 진료차트)와 어긋났음.
  //   Dashboard 패턴 재사용 — 로컬 상태로 MedicalChartPanel 단독 오픈.
  const [medicalChartCustomerId, setMedicalChartCustomerId] = useState<string | null>(null);
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  const openTreatmentChart = (customerId: string) => {
    setMedicalChartCustomerId(customerId);
    setMedicalChartOpen(true);
  };

  const { data: rows = [], isLoading, refetch } = useDoctorCallFeed(clinicId);

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

  // 소리 + 브라우저 알림 (신규 호출 감지)
  useDoctorCallNotifier(activeCalls, { muted });

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
            title={muted ? '음소거 해제' : '음소거'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {muted ? '음소거' : '소리 켜짐'}
          </button>
          {perm !== 'granted' && perm !== 'unsupported' && (
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
          {perm === 'granted' && (
            <span
              className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 min-h-[40px]"
              data-testid="doctor-call-notify-granted"
            >
              <Bell className="h-4 w-4" />
              알림 켜짐
            </span>
          )}
        </div>
      </div>

      {/* 알람 누적 피드 */}
      <section className="rounded-xl border border-red-200 bg-white" data-testid="doctor-call-feed">
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/70 px-3 py-2">
          <Phone className="h-4 w-4 text-red-600" />
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
          <ul className="divide-y divide-gray-100" data-testid="doctor-call-feed-rows">
            {feed.map((ci) => (
              <CallFeedRow
                key={callKey(ci)}
                checkIn={ci}
                doctorMode={doctorMode}
                role={profile?.role ?? ''}
                onOpenChart={openTreatmentChart}
                onRefresh={() => void refetch()}
              />
            ))}
          </ul>
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
          <ul className="divide-y divide-gray-100" data-testid="doctor-completed-rows">
            {completedPatients.map((ci) => (
              <CompletedRow
                key={ci.id}
                checkIn={ci}
                doctorMode={doctorMode}
                role={profile?.role ?? ''}
                onOpenChart={openTreatmentChart}
                onRefresh={() => void refetch()}
              />
            ))}
          </ul>
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
      />
    </div>
  );
}

// ─── 알람 피드 행 ───────────────────────────────────────────────────────────
function CallFeedRow({
  checkIn,
  doctorMode,
  role,
  onOpenChart,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  role: string;
  onOpenChart: (customerId: string) => void;
  onRefresh: () => void;
}) {
  const inactive = checkIn.status_flag === 'pink';
  const slotName = getAssignedSlotName(checkIn);
  const elapsed = formatElapsed(elapsedMinutes(getCallTime(checkIn)));
  const [showRx, setShowRx] = useState(false);

  return (
    <li
      data-testid="doctor-call-feed-row"
      data-checkin-id={checkIn.id}
      data-inactive={String(inactive)}
      className={cn('px-3 py-2.5 transition', inactive ? 'bg-gray-50/60 opacity-60' : 'bg-white')}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* 호출 상태 점 */}
        {inactive ? (
          <Check className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <Phone className="h-4 w-4 shrink-0 animate-pulse text-red-600" />
        )}
        {/* 이름 */}
        <span className={cn('text-sm font-semibold', inactive ? 'text-gray-500' : 'text-gray-900')}>
          {checkIn.customer_name}
        </span>
        <VisitBadge visitType={checkIn.visit_type} />
        {/* 위치 */}
        {slotName && (
          <span className="inline-flex items-center gap-0.5 rounded border border-teal-100 bg-teal-50 px-1 py-px text-[10px] font-medium text-teal-700">
            <MapPin className="h-2.5 w-2.5" />
            {slotName}
          </span>
        )}
        {/* 시술명 */}
        <span className="text-xs text-muted-foreground">{treatmentLabel(checkIn)}</span>
        {/* 경과시간 */}
        <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {elapsed}
        </span>
      </div>

      {/* 전달사항 메모 */}
      {checkIn.doctor_call_memo && (
        <p className="mt-1 pl-6 text-xs text-gray-600">📋 {checkIn.doctor_call_memo}</p>
      )}

      {/* 액션 — 차팅 / 처방 */}
      <div className="mt-1.5 flex items-center gap-1.5 pl-6">
        <button
          type="button"
          onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id)}
          disabled={!checkIn.customer_id}
          data-testid="doctor-call-chart-btn"
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <FileText className="h-3 w-3" />
          차팅
        </button>
        <button
          type="button"
          onClick={() => setShowRx((v) => !v)}
          data-testid="doctor-call-rx-btn"
          className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100"
        >
          <Pill className="h-3 w-3" />
          처방
          {showRx ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {checkIn.prescription_status === 'confirmed' && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700">
            <CheckCircle2 className="h-3 w-3" />
            처방확정
          </span>
        )}
      </div>

      {showRx && (
        <div className="mt-1.5 ml-6 rounded-lg border bg-white p-2">
          <QuickRxBar
            doctorMode={doctorMode}
            role={role}
            checkInId={checkIn.id}
            onApplied={onRefresh}
            checkInStatus={checkIn.status}
            checkedInAt={checkIn.checked_in_at}
            onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id)}
            compact
          />
        </div>
      )}
    </li>
  );
}

// ─── 진료 완료 환자 행 ───────────────────────────────────────────────────────
function CompletedRow({
  checkIn,
  doctorMode,
  role,
  onOpenChart,
  onRefresh,
}: {
  checkIn: CheckIn;
  doctorMode: boolean;
  role: string;
  onOpenChart: (customerId: string) => void;
  onRefresh: () => void;
}) {
  const [showRx, setShowRx] = useState(false);
  return (
    <li className="px-3 py-2.5" data-testid="doctor-completed-row" data-checkin-id={checkIn.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{checkIn.customer_name}</span>
        <VisitBadge visitType={checkIn.visit_type} />
        <span className="text-xs text-muted-foreground">{treatmentLabel(checkIn)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {checkIn.prescription_status === 'confirmed' ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700">
              <CheckCircle2 className="h-3 w-3" />
              처방확정
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">처방 없음</span>
          )}
          <button
            type="button"
            onClick={() => checkIn.customer_id && onOpenChart(checkIn.customer_id)}
            disabled={!checkIn.customer_id}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <FileText className="h-3 w-3" />
            차팅
          </button>
          <button
            type="button"
            onClick={() => setShowRx((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100"
          >
            <Pill className="h-3 w-3" />
            처방
          </button>
        </div>
      </div>
      {showRx && (
        <div className="mt-1.5 rounded-lg border bg-white p-2">
          <QuickRxBar
            doctorMode={doctorMode}
            role={role}
            checkInId={checkIn.id}
            onApplied={onRefresh}
            checkInStatus={checkIn.status}
            checkedInAt={checkIn.checked_in_at}
            onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id)}
            compact
          />
        </div>
      )}
    </li>
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
