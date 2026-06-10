// DoctorPatientList — 진료 완료 환자 리스트 + 빠른처방 버튼
// T-20260512-foot-QUICK-RX-BUTTON
//
// 오늘 접수된 환자 목록을 보여주고, 각 행에 빠른처방 버튼을 노출.
// 치료사: 원장 구두 지시 듣고 → 해당 환자 행 버튼 클릭 → 임시 처방 입력
// 원장  : 직접 버튼 클릭 → 바로 확정 / 또는 임시 처방 확인 후 확정 버튼

import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { todaySeoulISODate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { Loader2, CheckCircle2, Clock, ChevronDown, ChevronUp, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import QuickRxBar, { isDoctor, RxConfirmedSummary } from './QuickRxBar';
import { STATUS_KO, isInClinic } from '@/lib/status';
import { useChart } from '@/lib/chartContext';
import { formatRxConfirmedSummary } from '@/lib/rxTooltip';
import type { CheckInStatus } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PatientRow {
  id: string;
  /** T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE: 귀가 차단 시 차트 진입(useChart.openChart). */
  customer_id: string | null;
  customer_name: string;
  visit_type: 'new' | 'returning' | 'experience';
  status: CheckInStatus;
  checked_in_at: string;
  queue_number: number | null;
  prescription_status: 'none' | 'pending' | 'confirmed';
  doctor_confirmed_at: string | null;
  prescription_items: unknown;
  doctor_confirm_prescription: boolean;
  /** T-20260517-foot-HEALER-MEMO-DISPLAY: 예약메모 (reservations.booking_memo join) */
  booking_memo: string | null;
  /** T-20260609-foot-PASTVISIT-TREATMENT-VIEW: 과거 내원 '받은 치료' 요약(read-only).
   *  treatment_* 는 check_ins 기존 컬럼(T-20260504-foot-TREATMENT-SIMPLIFY) — SELECT 확장만. */
  treatment_category: string | null;
  treatment_contents: string[] | null;
  treatment_kind: string | null;
  /** T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY: 이력 모드 히러레이저 ✅/❌ 배지.
   *  check_ins 기존 컬럼(20260504_doctor_treatment_flow, BOOLEAN NOT NULL DEFAULT false) — SELECT 확장만. */
  healer_laser_confirm: boolean;
}

// ---------------------------------------------------------------------------
// 받은 치료 요약 — T-20260609-foot-PASTVISIT-TREATMENT-VIEW (AC-2/3)
//   category · (contents 우선, 없으면 kind). 예: "발톱무좀 · 가열레이저, 수액".
//   전부 비면 null → 호출부에서 '치료내역 없음' 표기. [object Object]·undefined 노출 방지.
// ---------------------------------------------------------------------------
function treatmentSummary(row: Pick<PatientRow, 'treatment_category' | 'treatment_contents' | 'treatment_kind'>): string | null {
  const category = (row.treatment_category ?? '').trim();
  const contents = Array.isArray(row.treatment_contents)
    ? row.treatment_contents.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim())
    : [];
  const kind = (row.treatment_kind ?? '').trim();
  const detail = contents.length > 0 ? contents.join(', ') : kind;
  const parts = [category, detail].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// 처방 내용 요약 — hover 툴팁용 (T-20260609 ③)
//   prescription_items 는 unknown(JSONB). 빠른처방 저장 shape {name, frequency, days}
//   또는 정식 처방 shape {medication_name, dosage, duration_days} 를 방어적으로 흡수.
// ---------------------------------------------------------------------------
function prescriptionSummary(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const parts = items
    .map((raw) => {
      const it = raw as {
        name?: string;
        medication_name?: string;
        frequency?: string;
        dosage?: string | null;
        days?: number;
        duration_days?: number | null;
      };
      const name = it.name ?? it.medication_name;
      if (!name) return null;
      const freq = it.frequency ?? it.dosage ?? '';
      const days = it.days ?? it.duration_days ?? null;
      const tail = [freq, days != null ? `${days}일` : ''].filter(Boolean).join(' ');
      return tail ? `${name} (${tail})` : name;
    })
    .filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ---------------------------------------------------------------------------
// 처방 상태 배지 — T-20260609 ③: '처방전 O'/'처방전 X' 표기 + hover 처방내용 툴팁
// ---------------------------------------------------------------------------
function PrescriptionStatusBadge({
  status,
  items,
}: {
  status: PatientRow['prescription_status'];
  items: unknown;
}) {
  const summary = prescriptionSummary(items);
  let badge: ReactNode;
  if (status === 'confirmed') {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
        <CheckCircle2 className="h-2.5 w-2.5" />
        처방전 O
      </span>
    );
  } else if (status === 'pending') {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        <Clock className="h-2.5 w-2.5" />
        임시
      </span>
    );
  } else {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
        처방전 X
      </span>
    );
  }

  // hover 툴팁: 처방 내용이 있을 때만(확정/임시). 없으면 native title="처방 없음".
  if (!summary) {
    return (
      <span data-testid="prescription-badge" title="처방 없음">
        {badge}
      </span>
    );
  }
  return (
    <span
      className="group relative inline-flex"
      data-testid="prescription-badge"
      title={summary}
    >
      {badge}
      <span
        role="tooltip"
        data-testid="rx-tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-max max-w-[240px] rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md group-hover:block"
      >
        {summary}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// 이력 모드 처방 한 줄 — T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY (AC-2)
//   포맷은 DOCDASH-LABEL-RX-REFINE 정본(formatRxConfirmedSummary, '{name} {freq} *' 나열)을 재사용.
//   prescription_items 는 JSONB(빠른처방 {name,frequency,days} | 정식 {medication_name,dosage,...})
//   → name/frequency 를 방어적으로 흡수(prescriptionSummary 와 동일 키 매핑)해 정본 포맷에 투입.
//   처방 없으면 '처방없음'(AC-2). 토큰 세부(1/3/2) 정형은 RX-TOKEN-FORMAT(blocked) 별도 축 — 미선반영.
// ---------------------------------------------------------------------------
function prescriptionOneLine(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '처방없음';
  const normalized = items.map((raw) => {
    const it = raw as {
      name?: string;
      medication_name?: string;
      frequency?: string;
      dosage?: string | null;
    };
    return {
      name: it.name ?? it.medication_name ?? null,
      frequency: it.frequency ?? it.dosage ?? null,
    };
  });
  const out = formatRxConfirmedSummary(normalized).trim();
  return out || '처방없음';
}

// ---------------------------------------------------------------------------
// 히러레이저 배지 — T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY (AC-2)
//   healer_laser_confirm(Boolean) → '레이저 ✅' / '레이저 ❌'. 이력 모드 전용 read-only 표기.
// ---------------------------------------------------------------------------
function HealerLaserBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        confirmed ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'
      }`}
      data-testid="healer-laser-badge"
      title={confirmed ? '히러레이저 컨펌됨' : '히러레이저 미확인'}
    >
      레이저 {confirmed ? '✅' : '❌'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 날짜 유틸 — T-20260606-foot-RX-PATIENT-LIST-DATENAV
//   KST(Asia/Seoul) 캘린더 날짜 기준 전/후 이동. 정오(UTC) 기준으로 더해 DST/경계 드리프트 방지.
// ---------------------------------------------------------------------------
function shiftISODate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'M월 d일 (EEE)' (캘린더 날짜만, 타임존 무관) */
function formatISOToKoLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'M월 d일 (EEE)', { locale: ko });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
// T-20260606-foot-RX-PATIENT-LIST-DATENAV: 조회 날짜를 파라미터화(기본=오늘 KST).
//   ※ '해당 의사' 귀속 필터는 미적용 — check_ins 에 doctor 귀속 컬럼(doctor_id 등)이 없어
//     로그인 의사 기준 분기 불가. 임의 매핑 신설 금지(planner 선결) → 클리닉 단위 일자 조회 유지.
function usePatientsByDate(clinicId: string | null, dateISO: string) {
  return useQuery({
    queryKey: ['quick_rx_patient_list', clinicId, dateISO],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      // T-20260531-foot-DASHBOARD-KST-FILTER: checked_in_at은 UTC(timestamptz)로 저장.
      // 기존 today = format(new Date(),...) (브라우저 로컬) + 타임존 suffix 없는 bound 비교는
      // Postgres가 naive 문자열을 UTC로 해석 → KST 오전(00:00~09:00) 체크인(전날 UTC)이
      // 당일 범위 밖으로 제외됨(빨강 체크인 누락). KST 기준 날짜 + '+09:00' 바운드로 교정.
      const day = dateISO;
      // T-20260517-foot-HEALER-MEMO-DISPLAY: reservation:reservation_id join → booking_memo
      const { data, error } = await supabase
        .from('check_ins')
        .select(
          // T-20260609-foot-PASTVISIT-TREATMENT-VIEW: treatment_* 추가(기존 컬럼, SELECT 확장만 — AC-5)
          // T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY: healer_laser_confirm 추가(기존 컬럼, SELECT 확장만 — AC-3)
          'id, customer_id, customer_name, visit_type, status, checked_in_at, queue_number, prescription_status, doctor_confirmed_at, prescription_items, doctor_confirm_prescription, treatment_category, treatment_contents, treatment_kind, healer_laser_confirm, reservation:reservation_id(booking_memo)',
        )
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${day}T00:00:00+09:00`)
        .lte('checked_in_at', `${day}T23:59:59+09:00`)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      // Supabase may return reservation as array or object — flatten to booking_memo
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
        const resv = row['reservation'];
        let booking_memo: string | null = null;
        if (Array.isArray(resv) && resv.length > 0) {
          booking_memo = (resv[0] as { booking_memo?: string | null }).booking_memo ?? null;
        } else if (resv && typeof resv === 'object' && !Array.isArray(resv)) {
          booking_memo = (resv as { booking_memo?: string | null }).booking_memo ?? null;
        }
        return { ...row, booking_memo } as unknown as PatientRow;
      });
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function useConfirmPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (checkInId: string) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('check_ins')
        .update({
          prescription_status: 'confirmed',
          doctor_confirm_prescription: true,
          doctor_confirmed_at: now,
        })
        .eq('id', checkInId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick_rx_patient_list'] });
      toast.success('처방이 확정됐어요.');
    },
    onError: (e: Error) => toast.error(`확정 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// 방문 유형 배지
// ---------------------------------------------------------------------------
function VisitTypeBadge({ type }: { type: PatientRow['visit_type'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: '초진', cls: 'bg-blue-100 text-blue-700' },
    returning: { label: '재진', cls: 'bg-emerald-100 text-emerald-700' },
    // experience: 배지 미표시 (AC-4) — fallback 처리
  };
  const { label, cls } = map[type] ?? { label: type, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-center ${cls}`}
      data-testid="visit-type-badge"
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 환자 행 컴포넌트
// ---------------------------------------------------------------------------
function PatientRow({
  row,
  doctorMode,
  role,
  onRefresh,
  onOpenChart,
  isPast = false,
}: {
  row: PatientRow;
  doctorMode: boolean;
  role: string;
  onRefresh: () => void;
  /** T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE: 귀가 차단 시 차트 진입 동선. */
  onOpenChart?: () => void;
  /** T-20260609-foot-PASTVISIT-TREATMENT-VIEW: 과거 날짜(어제 이전) read-only '받은 치료' 모드. */
  isPast?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const confirm = useConfirmPrescription();

  const hasPendingRx = row.prescription_status === 'pending';
  const isConfirmed = row.prescription_status === 'confirmed';

  // ---------------------------------------------------------------------------
  // T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY (AC-1/2): 어제 이전 날짜 = 이력 모드(read-only).
  //   PASTVISIT-TREATMENT-VIEW 의 isPast read-only 모드를 누적 확장(분기 기준=DATENAV 날짜 state 재사용).
  //   - '상태' 컬럼 숨김 + 처방 확정/취소 버튼 전부 숨김(read-only) → RXCANCEL-GATE 를 포섭(별개 축).
  //   - 이름+초진/재진(visit_type), 처방 내용 한 줄(formatRxConfirmedSummary 재사용), 처방전 O/X 배지 유지.
  //   - 치료 종류: treatment_kind 텍스트(없으면 '받은 치료' 요약으로 폴백 — PASTVISIT 값 보존).
  //   - 히러레이저: healer_laser_confirm → ✅/❌ 배지.
  //   - 행 클릭: 해당 환자 진료차트 열람(onOpenChart=useChart.openChart, LOGIC-LOCK L-004 단일 게이트웨이 호출만).
  // ---------------------------------------------------------------------------
  if (isPast) {
    const rxLine = prescriptionOneLine(row.prescription_items);
    const hasRx = rxLine !== '처방없음';
    const kind = (row.treatment_kind ?? '').trim();
    const received = treatmentSummary(row); // PASTVISIT 정본 — treatment_kind 결측 시 폴백
    const treatmentText = kind || received || '—';
    return (
      <button
        type="button"
        onClick={onOpenChart}
        disabled={!onOpenChart}
        className="w-full rounded-lg border border-border bg-card text-left transition hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-card"
        data-testid="patient-row"
        data-mode="history"
      >
        <div className="grid grid-cols-[1.75rem_3rem_5rem_5.5rem_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5">
          {/* 번호 */}
          <span className="text-xs font-mono text-muted-foreground text-center">
            {row.queue_number ?? '—'}
          </span>
          {/* 방문유형 배지 (초진/재진) */}
          <div className="flex justify-center">
            <VisitTypeBadge type={row.visit_type} />
          </div>
          {/* 이름 */}
          <span
            className="text-sm font-semibold truncate text-center"
            title={row.customer_name}
            data-testid="patient-name"
          >
            {row.customer_name}
          </span>
          {/* 처방 상태 배지 (처방전 O/X) — 그날의 사실 기록(read-only) */}
          <div className="flex justify-center">
            <PrescriptionStatusBadge status={row.prescription_status} items={row.prescription_items} />
          </div>
          {/* 처방 내용 한 줄 — 없으면 '처방없음' (AC-2) */}
          <span
            className={`text-[12px] truncate ${hasRx ? 'text-foreground' : 'text-muted-foreground/70'}`}
            title={rxLine}
            data-testid="rx-oneline"
          >
            {rxLine}
          </span>
          {/* 치료 종류 (treatment_kind, 폴백=받은 치료) */}
          <span
            className="text-[12px] text-emerald-700 font-medium truncate max-w-[8rem]"
            title={treatmentText}
            data-testid="treatment-kind"
          >
            {treatmentText}
          </span>
          {/* 히러레이저 ✅/❌ 배지 */}
          <HealerLaserBadge confirmed={row.healer_laser_confirm} />
        </div>
      </button>
    );
  }

  return (
    <div
      className={`rounded-lg border transition ${
        hasPendingRx ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-card'
      }`}
      data-testid="patient-row"
    >
      {/*
        기본 행 — T-20260609 ⑤: flex → grid 고정 열 레이아웃.
        열 순서: 번호 / 방문배지(②이름왼쪽) / 이름(④고정폭) / 처방배지(③이름오른쪽) / 상태 / 메모 / 액션
        모든 행이 동일 grid-template → 큐번호·배지·이름·처방·시간 항목이 행마다 동일 x위치(스크롤 무관).
      */}
      <div className="grid grid-cols-[1.75rem_3rem_5rem_5.5rem_3.75rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
        {/* 번호 */}
        <span className="text-xs font-mono text-muted-foreground text-center">
          {row.queue_number ?? '—'}
        </span>

        {/* ② 방문유형 배지 — 이름 왼쪽(행 첫 식별 위치) */}
        <div className="flex justify-center">
          <VisitTypeBadge type={row.visit_type} />
        </div>

        {/* ④ 이름 — 고정 너비(글자수 변동 무관), 초과 시 truncate.
            T-20260609-foot-DOCDASH-LABEL-RX-REFINE item4: 셀 내 가로 중앙정렬(text-center).
            grid items-center(세로 중앙)는 기존 유지 — 컬럼 정의 보존, alignment만 보정. */}
        <span
          className="text-sm font-semibold truncate text-center"
          title={row.customer_name}
          data-testid="patient-name"
        >
          {row.customer_name}
        </span>

        {/* ③ 처방 상태 배지 — 이름 오른쪽 + hover 처방내용 툴팁.
            item4: justify-start → justify-center (이름과 같이 가로 중앙정렬). */}
        <div className="flex justify-center">
          <PrescriptionStatusBadge status={row.prescription_status} items={row.prescription_items} />
        </div>

        {/* 상태 */}
        <span className="text-[11px] text-muted-foreground truncate">
          {STATUS_KO[row.status] ?? row.status}
        </span>

        {/* 예약메모 — T-20260517-foot-HEALER-MEMO-DISPLAY AC-1~4 */}
        <span
          className="text-[11px] text-muted-foreground truncate"
          title={row.booking_memo ?? undefined}
          data-testid="booking-memo"
        >
          {row.booking_memo || '—'}
        </span>

        {/* 액션 — 확정 버튼 / 대기 알림 / 펼치기 토글 */}
        <div className="flex items-center gap-1.5 justify-end">
          {/* 임시 처방이고 의사인 경우 → 확정 버튼 */}
          {hasPendingRx && doctorMode && (
            <Button
              size="sm"
              className="h-6 text-[11px] bg-teal-600 hover:bg-teal-700 px-2"
              onClick={() => confirm.mutate(row.id)}
              disabled={confirm.isPending}
              data-testid="confirm-prescription-btn"
            >
              {confirm.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-0.5" />
              )}
              확정
            </Button>
          )}

          {/* 임시 처방 알림 (치료사용) */}
          {hasPendingRx && !doctorMode && (
            <span className="text-[10px] text-amber-700 flex items-center gap-0.5">
              <AlertCircle className="h-3 w-3" />
              원장 확인 대기
            </span>
          )}

          {/* 펼치기 토글 */}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="rounded p-0.5 hover:bg-accent transition text-muted-foreground"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* 펼쳐진 영역 — 빠른처방 버튼 */}
      {expanded && !isConfirmed && (
        <div className="border-t px-3 py-2.5 bg-white rounded-b-lg">
          <QuickRxBar
            doctorMode={doctorMode}
            role={role}
            checkInId={row.id}
            onApplied={onRefresh}
            checkInStatus={row.status}
            checkedInAt={row.checked_in_at}
            /* T-20260610-foot-QUICKRX-BLOCK-PANEL-HIDE: 차트 연결 버그 수정 — onOpenChart 미전달로
               원내 비잔류 시 차트 열기 버튼이 렌더되지 않던 버그. */
            onOpenChart={onOpenChart}
            compact
          />
          {hasPendingRx && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              ℹ 이미 임시 처방이 입력되어 있습니다. 버튼 클릭 시 덮어씌워집니다.
            </p>
          )}
        </div>
      )}

      {/* 확정된 경우 — T-20260609-foot-QUICKRX-DROPDOWN-LIST-REDESIGN AC-2/4:
          "처방완료" + 약물리스트(검은글씨, 다중약 전체). 재클릭 → 취소 확인 팝업(별도 취소버튼 폐지). */}
      {expanded && isConfirmed && (
        <div className="border-t px-3 py-2.5 bg-green-50/60 rounded-b-lg">
          <div className="flex items-center gap-1.5">
            <RxConfirmedSummary
              checkInId={row.id}
              items={row.prescription_items}
              doctorMode={doctorMode}
              onCancelled={onRefresh}
              label="처방 내용"
              /* T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE:
                 귀가(원내 비잔류) 환자 처방취소 차단(inClinicRxGate SSOT) + 차트 진입 동선. */
              checkInStatus={row.status}
              checkedInAt={row.checked_in_at}
              onOpenChart={onOpenChart}
            />
            {row.doctor_confirmed_at && (
              <span className="ml-auto shrink-0 text-[11px] text-green-600">
                {format(new Date(row.doctor_confirmed_at), 'HH:mm', { locale: ko })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DoctorPatientList — Main Export
// ---------------------------------------------------------------------------
export default function DoctorPatientList() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const doctorMode = isDoctor(profile?.role ?? '');
  // LOGIC-LOCK: L-004 — 차트 접근은 useChart() 경유만. 귀가 환자 처방취소 차단 시 '차트에서 수정' 진입.
  const { openChart } = useChart();

  // T-20260606-foot-RX-PATIENT-LIST-DATENAV AC-1: 기본 조회 날짜 = 오늘(KST). AC-2: < > 로 전/후 이동.
  const todayISO = todaySeoulISODate();
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const isToday = selectedDate === todayISO;
  // T-20260609-foot-PASTVISIT-TREATMENT-VIEW: 어제 이전 = 과거(read-only '받은 치료' 모드).
  //   ISO 'YYYY-MM-DD' 사전식 비교 = 캘린더 비교(타임존 무관). 미래(다음날) 조회는 과거 아님 → 현행 유지.
  const isPast = selectedDate < todayISO;

  const { data: patients = [], isLoading, refetch } = usePatientsByDate(clinicId, selectedDate);

  // 필터 상태
  // T-20260609-foot-DOCDASH-LABEL-RX-REFINE item6: '처방없음'(none) → '처방나감'(confirmed)으로 교정.
  //   reporter 의도 = "처방전 있는(처방이 나간) 환자만" 필터 → prescription_status === 'confirmed'.
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed'>('all');

  // T-20260609 ①: 정렬 옵션 — 시간순(접수시간) / 이름순(가나다). 기본=시간순.
  const [sortBy, setSortBy] = useState<'time' | 'name'>('time');

  const filtered = patients.filter((p) => {
    if (filter === 'pending') return p.prescription_status === 'pending';
    // item6: '처방나감' = 처방전 있는(확정·나간) 환자만 노출. (술어 방향 교정: none → confirmed)
    if (filter === 'confirmed') return p.prescription_status === 'confirmed';
    return true;
  });

  // T-20260609 ①: 원내(in-clinic) 환자 최우선 상단 그룹핑(정렬 옵션 무관) →
  //   그룹 내에서 시간순/이름순. 날짜 조회 로직(DATENAV)과 독립한 "목록 내 정렬".
  const sorted = [...filtered].sort((a, b) => {
    const aIn = isInClinic(a.status) ? 0 : 1;
    const bIn = isInClinic(b.status) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn; // 원내 그룹 항상 상단
    if (sortBy === 'name') return a.customer_name.localeCompare(b.customer_name, 'ko');
    // 시간순(접수시간 오름차순). checked_in_at 은 ISO 문자열 → 사전식 비교로 시간순 동일.
    if (a.checked_in_at < b.checked_in_at) return -1;
    if (a.checked_in_at > b.checked_in_at) return 1;
    return 0;
  });

  const pendingCount = patients.filter((p) => p.prescription_status === 'pending').length;
  // item6: '처방나감'(처방 확정·발행된) 환자 수 — 필터 탭 카운트.
  const confirmedCount = patients.filter((p) => p.prescription_status === 'confirmed').length;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">진료 환자 목록</p>
          {/* T-20260606-foot-RX-PATIENT-LIST-DATENAV AC-1/AC-2: 날짜 헤더 + < > 전/후 이동 + 접수 인원 */}
          <div className="flex items-center gap-1 mt-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() => setSelectedDate((d) => shiftISODate(d, -1))}
              aria-label="전날"
              data-testid="patient-list-prev-day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-xs text-muted-foreground min-w-[150px] text-center" data-testid="patient-list-date-header">
              <span className="font-medium text-foreground">{formatISOToKoLabel(selectedDate)}</span>
              {isToday && <span className="ml-1 text-teal-600 font-medium">· 오늘</span>}
              <span className="mx-1">·</span>
              <span>{patients.length}명 접수</span>
              {pendingCount > 0 && (
                <span className="ml-1.5 text-amber-600 font-medium">⚠ 임시처방 {pendingCount}명</span>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() => setSelectedDate((d) => shiftISODate(d, 1))}
              aria-label="다음날"
              data-testid="patient-list-next-day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2 ml-1"
                onClick={() => setSelectedDate(todayISO)}
                data-testid="patient-list-today-btn"
              >
                오늘
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 역할 배지 */}
          <span
            className={`text-[10px] font-medium px-2 py-1 rounded-full border ${
              doctorMode
                ? 'border-teal-400 bg-teal-50 text-teal-700'
                : 'border-amber-300 bg-amber-50 text-amber-700'
            }`}
          >
            {doctorMode ? '의사 모드 — 바로 확정' : '치료사 모드 — 임시 처방'}
          </span>
        </div>
      </div>

      {/* 필터 탭 + 정렬 토글 (T-20260609 ①) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {[
            { key: 'all' as const, label: `전체 (${patients.length})` },
            { key: 'pending' as const, label: `임시 (${pendingCount})` },
            // item6: '처방 없음' → '처방나감'(처방전 있는 환자 필터). 라벨·술어 동시 교정.
            { key: 'confirmed' as const, label: `처방나감 (${confirmedCount})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filter === key
                  ? 'bg-teal-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 정렬 셀렉터 — 원내 우선 그룹은 정렬 옵션과 무관하게 항상 상단 유지 */}
        <div className="flex items-center gap-1 shrink-0" data-testid="patient-sort-toggle">
          <span className="text-[11px] text-muted-foreground mr-0.5">정렬</span>
          {[
            { key: 'time' as const, label: '시간순' },
            { key: 'name' as const, label: '이름순' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              data-testid={`sort-by-${key}`}
              aria-pressed={sortBy === key}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                sortBy === key
                  ? 'bg-teal-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {filter === 'all'
            ? `${isToday ? '오늘' : formatISOToKoLabel(selectedDate)} 접수된 환자가 없습니다.`
            : '해당 조건의 환자가 없습니다.'}
        </div>
      ) : (
        <div className="space-y-2" data-testid="patient-list">
          {sorted.map((row) => (
            <PatientRow
              key={row.id}
              row={row}
              doctorMode={doctorMode}
              role={profile?.role ?? ''}
              onRefresh={() => refetch()}
              onOpenChart={row.customer_id ? () => openChart(row.customer_id as string) : undefined}
              isPast={isPast}
            />
          ))}
        </div>
      )}

      {/* 사용 안내 */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground space-y-0.5">
        <p className="font-medium text-foreground/60">사용 방법</p>
        <p>• 환자 행 오른쪽 화살표를 눌러 빠른처방 버튼을 펼치세요.</p>
        <p>• {doctorMode ? '원장 모드: 버튼 클릭 시 바로 확정 처리됩니다.' : '치료사 모드: 버튼 클릭 시 임시(pending) 상태로 저장되고, 원장 확인 후 확정됩니다.'}</p>
        <p>• 임시(⚠) 상태인 행은 노란 테두리로 표시됩니다.</p>
      </div>
    </div>
  );
}
