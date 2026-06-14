// DoctorPatientList — 진료 완료 환자 리스트 + 빠른처방 버튼
// T-20260512-foot-QUICK-RX-BUTTON
//
// 오늘 접수된 환자 목록을 보여주고, 각 행에 빠른처방 버튼을 노출.
// 치료사: 원장 구두 지시 듣고 → 해당 환자 행 버튼 클릭 → 임시 처방 입력
// 원장  : 직접 버튼 클릭 → 바로 확정 / 또는 임시 처방 확인 후 확정 버튼

import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { todaySeoulISODate, chartNoDisplay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { Loader2, CheckCircle2, Clock, ChevronDown, ChevronUp, AlertCircle, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import QuickRxBar, { isDoctor, RxConfirmedSummary } from './QuickRxBar';
import {
  // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 처방확정 공통 가드 + 차트변경 audit.
  assertInClinicForRxMutation,
  logRxAudit,
  summarizeRxForAudit,
  IN_CLINIC_GATE_CODE,
} from '@/lib/rxMutationGuard';
import { STATUS_KO, isInClinic } from '@/lib/status';
import { useChart } from '@/lib/chartContext';
import { formatRxConfirmedSummary, normalizeRxItem } from '@/lib/rxTooltip';
// T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-3: 치료실명(방이름) 표시 — DoctorCallDashboard와 동일한
//   배정 슬롯 파생 SSOT 재사용. read-only(기존 *_room 컬럼 조회만), 스키마/비즈로직 무변경.
import { getAssignedSlotName } from '@/lib/checkin-slot';
import type { CheckInStatus } from '@/lib/types';
// T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY (AC-1): 임상경과 = DoctorCallDashboard
//   showClinical 과 동일 SSOT(MedicalChartPanel embed variant='clinical'). 신규 조회경로/Drawer 신설 금지.
//   기존 차트 존재 시 read 모드(isReadOnly)로 로드 — read 뷰 요건 충족.
import MedicalChartPanel from '@/components/MedicalChartPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PatientRow {
  id: string;
  /** T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE: 귀가 차단 시 차트 진입(useChart.openChart). */
  customer_id: string | null;
  customer_name: string;
  /** T-20260612-foot-CHARTNO-B2-P1: 이름 옆 차트번호 인접 표기용(customers join). 미발번이면 null → '#미발번'. */
  chart_number: string | null;
  visit_type: 'new' | 'returning' | 'experience';
  status: CheckInStatus;
  /** T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)/귀가(done) 시각 구분 + 처방 게이트 컨텍스트.
   *  check_ins 기존 컬럼(status_flag) — SELECT 확장만, 스키마 무변경. */
  status_flag: string | null;
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
  /** T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-3: 치료실(방) 배정 — getAssignedSlotName 파생용.
   *  check_ins 기존 컬럼(consultation/treatment/laser/examination_room) — SELECT 확장만. */
  consultation_room: string | null;
  treatment_room: string | null;
  laser_room: string | null;
  examination_room: string | null;
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
// 처방 JSONB 1건 정규화는 SSOT(@/lib/rxTooltip normalizeRxItem)로 수렴.
//   T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX (AC-2): 묶음처방 흡수 경로(MedicalChartPanel)와
//   동일 단일 정규화 경로를 쓰기 위해 로컬 복제(구 T-20260610 RX-TOKEN-FORMAT 정의)를 제거하고
//   rxTooltip 의 export 를 import. 흡수 규칙·null 가드 동작 동일(회귀 0).
// ---------------------------------------------------------------------------
// 처방 내용 요약 — hover 툴팁용 (T-20260609 ③ → RX-TOKEN-FORMAT 정합)
//   배지 hover 툴팁/네이티브 title 도 한 줄 셀과 동일한 1/3/2 토큰 포맷(formatRxConfirmedSummary)
//   으로 통일 — 원문 용법('1일 3회') 노출 제거(reporter 문지은 6/10 재보고). 처방 없으면 null.
// ---------------------------------------------------------------------------
function prescriptionSummary(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const out = formatRxConfirmedSummary(items.map(normalizeRxItem)).trim();
  return out || null;
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
    // T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-2 (문지은 대표원장, 9ghw/thif/p2bc 흡수 정밀화):
    //   처방전 O = reporter 명시 '하늘색(sky)'. 이전 초록(green)을 "이상한 민트색"이라 거부, 일반 blue도 아님.
    //   → sky-100/700 + sky-200 테두리로 확정(명확히 '하늘색'으로 보이게). 일반 blue 잔재 교체.
    //   ⚠️ green/emerald/teal/mint/cyan/blue 계열 금지 — reporter가 거부한 톤. 아이콘·모양·툴팁·위치 전부 유지, 색만 교체. DB 무변경.
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
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
    // AC-2: 처방전 X = 회색(유지·정밀화). 강조 없는 중립 회색.
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400">
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
//   포맷은 정본(formatRxConfirmedSummary, '{name} {dosage}/{count}/{days} *' 나열)을 재사용.
//   T-20260610-foot-RX-TOKEN-FORMAT: 전 토큰 필드(normalizeRxItem)를 정본에 투입해 1/3/2 도출.
//   prescription_items JSONB(빠른처방 {name,dosage,count,frequency,days} | 정식 {medication_name,...})
//   를 normalizeRxItem 으로 흡수. 처방 없으면 '처방없음'(AC-2).
// ---------------------------------------------------------------------------
function prescriptionOneLine(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '처방없음';
  const out = formatRxConfirmedSummary(items.map(normalizeRxItem)).trim();
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
          // T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-3: *_room 추가(기존 컬럼, SELECT 확장만) — 치료실명 표시.
          // T-20260610-foot-DOCDASH-STATUS-SPLIT: status_flag 추가(기존 컬럼, SELECT 확장만) — 진료완료/귀가 구분.
          // T-20260612-foot-CHARTNO-B2-P1: 이름 옆 차트번호 인접 표기용 customers join 추가(read-only, DB 무변경).
          'id, customer_id, customer_name, visit_type, status, status_flag, checked_in_at, queue_number, prescription_status, doctor_confirmed_at, prescription_items, doctor_confirm_prescription, treatment_category, treatment_contents, treatment_kind, healer_laser_confirm, consultation_room, treatment_room, laser_room, examination_room, reservation:reservation_id(booking_memo), customers!customer_id(chart_number)',
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
        // T-20260612-foot-CHARTNO-B2-P1: customers 임베드(object|array 양쪽 흡수)에서 차트번호 평탄화.
        const cust = row['customers'];
        let chart_number: string | null = null;
        if (Array.isArray(cust) && cust.length > 0) {
          chart_number = (cust[0] as { chart_number?: string | null }).chart_number ?? null;
        } else if (cust && typeof cust === 'object') {
          chart_number = (cust as { chart_number?: string | null }).chart_number ?? null;
        }
        return { ...row, booking_memo, chart_number } as unknown as PatientRow;
      });
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// 서명한 의사별 필터 인덱스 — T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER
//   signing_doctor_{id,name} 은 MEDCHART-SIGN-AUDIT(deployed b65357e)에서 medical_charts 에
//   이미 추가된 기존 컬럼 → 신규 스키마 불요, read-only 조회만.
//   ※ 연결경로(STEP1 그라운딩): medical_charts 에 check_in_id 컬럼 없음 →
//      check_ins(행) ↔ signing_doctor 의 유일 연결키 = customer_id + visit_date.
//      DoctorPatientList 는 이미 selectedDate(=visit_date)로 check_ins 를 조회하므로,
//      같은 날짜·클리닉의 medical_charts 를 customer_id 로 매핑한다.
//      1환자 N차트 = 그 날짜 진료의 id 들의 합집합(Set). 미서명/레거시(NULL)·차트없음 = 'unsigned' 그룹.
//      (동일 환자 동일날짜 복수 check_in 은 모두 같은 차트 집합에 매핑 — 차트의 visit 단위 분해 불가, 허용 근사.)
// ---------------------------------------------------------------------------
interface SigningDoctorIndex {
  /** customer_id → 그 날짜에 서명(진료의 귀속)된 doctor id Set (non-null만) */
  byCustomer: Map<string, Set<string>>;
  /** 그 날짜에 서명 진료의가 1건 이상 귀속된 customer_id */
  signedCustomers: Set<string>;
  /** 드롭다운 옵션: 그 날짜에 등장한 진료의 [{id,name}] (이름 가나다순) */
  doctors: { id: string; name: string }[];
}

function useSigningDoctorsByDate(clinicId: string | null, dateISO: string) {
  return useQuery<SigningDoctorIndex>({
    queryKey: ['patient_list_signing_doctors', clinicId, dateISO],
    enabled: !!clinicId,
    queryFn: async () => {
      const empty: SigningDoctorIndex = { byCustomer: new Map(), signedCustomers: new Set(), doctors: [] };
      if (!clinicId) return empty;
      const { data, error } = await supabase
        .from('medical_charts')
        .select('customer_id, signing_doctor_id, signing_doctor_name')
        .eq('clinic_id', clinicId)
        .eq('visit_date', dateISO);
      if (error) throw error;
      const byCustomer = new Map<string, Set<string>>();
      const signedCustomers = new Set<string>();
      const nameById = new Map<string, string>();
      for (const raw of (data ?? []) as Array<{
        customer_id: string | null;
        signing_doctor_id: string | null;
        signing_doctor_name: string | null;
      }>) {
        const cid = raw.customer_id;
        const did = raw.signing_doctor_id;
        if (!cid || !did) continue; // 미서명/레거시 NULL → unsigned 그룹(매핑 제외)
        signedCustomers.add(cid);
        let set = byCustomer.get(cid);
        if (!set) { set = new Set(); byCustomer.set(cid, set); }
        set.add(did);
        if (!nameById.has(did)) nameById.set(did, (raw.signing_doctor_name ?? '').trim() || '이름없음');
      }
      const doctors = [...nameById.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      return { byCustomer, signedCustomers, doctors };
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function useConfirmPrescription() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ checkInId, customerId }: { checkInId: string; customerId?: string | null }) => {
      // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 처방확정도 인플레이스 chart mutate →
      //   공통 가드로 귀가환자 차단(fail-closed, 우회 0). 비잔류면 audit(차단) 후 throw.
      const actor = { id: profile?.id ?? null, name: profile?.name ?? null, role: profile?.role ?? null };
      const cur = await assertInClinicForRxMutation(checkInId, {
        blockedAction: 'rx_confirm_blocked',
        surface: 'doctor_patient_list',
        actor,
        customerId,
      });
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
      // 차트변경 내부로그(성공) — confirm.
      void logRxAudit({
        checkInId,
        customerId,
        action: 'rx_confirm',
        surface: 'doctor_patient_list',
        actor,
        beforeSummary: summarizeRxForAudit(cur.prescription_items),
        afterSummary: summarizeRxForAudit(cur.prescription_items),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick_rx_patient_list'] });
      toast.success('처방이 확정됐어요.');
    },
    onError: (e: Error & { code?: string }) => {
      // 귀가환자 차단(IN_CLINIC_GATE) — 친절 안내. 그 외 일반 실패.
      if (e.code === IN_CLINIC_GATE_CODE) toast.error(e.message);
      else toast.error(`확정 실패: ${e.message}`);
    },
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
// 상태 셀 — T-20260610-foot-DOCDASH-STATUS-SPLIT (AC-5):
//   진료완료(status_flag='pink')와 귀가(status='done')를 시각적으로 구분.
//   · 진료완료 = emerald 배지 '진료완료'(원내 잔류, 처방 허용) — pink 우선(done 아님).
//   · 귀가     = gray 배지 '귀가'(수납완료, 처방 차단).
//   · 그 외     = 기존 STATUS_KO 텍스트(현행 유지).
//   pink와 done(dark_gray)은 상호배타라 분기 충돌 없음. 진료완료가 귀가보다 우선 표기.
// ---------------------------------------------------------------------------
function StatusCell({ status, statusFlag }: { status: CheckInStatus; statusFlag: string | null }) {
  if (statusFlag === 'pink') {
    return (
      <span
        className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
        data-testid="status-cell"
        data-state="treatment-done"
        title="진료완료 — 원내 잔류(처방 가능)"
      >
        진료완료
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span
        className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600"
        data-testid="status-cell"
        data-state="discharged"
        title="귀가 — 수납완료(처방은 차트에서 수정)"
      >
        귀가
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground truncate" data-testid="status-cell" data-state="in-clinic">
      {STATUS_KO[status] ?? status}
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
  clinicId,
  currentUserEmail,
  isToday = false,
}: {
  row: PatientRow;
  doctorMode: boolean;
  role: string;
  onRefresh: () => void;
  /** T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE: 귀가 차단 시 차트 진입 동선. */
  onOpenChart?: () => void;
  /** T-20260609-foot-PASTVISIT-TREATMENT-VIEW: 과거 날짜(어제 이전) read-only '받은 치료' 모드. */
  isPast?: boolean;
  /** T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY: 확장 임상경과(MedicalChartPanel) 컨텍스트. */
  clinicId?: string | null;
  currentUserEmail?: string | null;
  /** T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-2/3, 문지은 대표원장): 조회 날짜=오늘 여부.
   *  당일 접수 환자만 임상경과 인라인 편집 허용 → false(당일 외)면 readOnly로 전달(오기입 방지). */
  isToday?: boolean;
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
        <div className="grid grid-cols-[3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto] items-center gap-1.5 px-2 py-1.5">
          {/* T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE(B): 대기순번(queue_number) 표시 칼럼 제거. */}
          {/* 방문유형 배지 (초진/재진) */}
          <div className="flex justify-start">
            <VisitTypeBadge type={row.visit_type} />
          </div>
          {/* 이름 — T-20260612-foot-CHARTNO-COL-SPLIT-P1: 차트번호 서브텍스트 제거 → 옆 독립 칼럼으로 이전. */}
          <span
            className="min-w-0 max-w-full truncate text-left text-sm font-semibold"
            title={row.customer_name}
            data-testid="patient-name"
          >
            {row.customer_name}
          </span>
          {/* 차트번호 — CHARTNO-COL-SPLIT-P1: 이름 바로 옆 독립 칼럼. 미발번은 '(미발번)'(빈칸 금지). */}
          <span
            className="min-w-0 max-w-full truncate text-left font-mono text-[11px] text-muted-foreground"
            title={chartNoDisplay(row.chart_number)}
            data-testid="patient-chartno"
          >
            {chartNoDisplay(row.chart_number)}
          </span>
          {/* 처방 상태 배지 (처방전 O/X) — 그날의 사실 기록(read-only) */}
          <div className="flex justify-start">
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
        열 순서: 방문배지(②이름왼쪽) / 이름(④고정폭) / 차트번호(독립칼럼) / 처방배지(③이름오른쪽) / 상태 / 치료실 / 메모 / 액션
        T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-3: '상태'와 '메모' 사이에 치료실(방이름) 컬럼 추가.
        T-20260612-foot-CHARTNO-COL-SPLIT-P1: 이름 칸 내 차트번호 서브텍스트 제거 → 이름 바로 옆 독립 칼럼.
        T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE(B): 대기순번(queue_number) 칼럼 제거 → 차트번호만 숫자.
        모든 행이 동일 grid-template → 배지·이름·차트번호·처방·시간 항목이 행마다 동일 x위치(스크롤 무관).
      */}
      <div className="grid grid-cols-[3rem_5rem_4.5rem_5.5rem_3.75rem_4.75rem_minmax(0,1fr)_auto] items-center gap-1.5 px-2 py-1.5">
        {/* T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE(B): 대기순번(queue_number=1036) 표시 칼럼 제거.
            차트번호 외 식별 숫자 비표시(reporter 요청). queue_number 타입/SELECT/정렬·RPC는 무손상 — 표시만 숨김. */}

        {/* ② 방문유형 배지 — 이름 왼쪽(행 첫 식별 위치) */}
        <div className="flex justify-start">
          <VisitTypeBadge type={row.visit_type} />
        </div>

        {/* ④ 이름 — 고정 너비(글자수 변동 무관), 초과 시 truncate.
            T-20260609-foot-DOCDASH-LABEL-RX-REFINE item4: 셀 내 가로 중앙정렬(text-center).
            T-20260612-foot-CHARTNO-COL-SPLIT-P1: 차트번호 서브텍스트 제거 → 옆 독립 칼럼으로 이전. */}
        <span
          className="min-w-0 max-w-full truncate text-left text-sm font-semibold"
          title={row.customer_name}
          data-testid="patient-name"
        >
          {row.customer_name}
        </span>

        {/* 차트번호 — CHARTNO-COL-SPLIT-P1: 이름 바로 옆 독립 칼럼. 미발번은 '(미발번)'(빈칸 금지). */}
        <span
          className="min-w-0 max-w-full truncate text-left font-mono text-[11px] text-muted-foreground"
          title={chartNoDisplay(row.chart_number)}
          data-testid="patient-chartno"
        >
          {chartNoDisplay(row.chart_number)}
        </span>

        {/* ③ 처방 상태 배지 — 이름 오른쪽 + hover 처방내용 툴팁.
            item4: justify-start → justify-center (이름과 같이 가로 중앙정렬). */}
        <div className="flex justify-start">
          <PrescriptionStatusBadge status={row.prescription_status} items={row.prescription_items} />
        </div>

        {/* 상태 — T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)/귀가(done) 시각 구분(AC-5). */}
        <StatusCell status={row.status} statusFlag={row.status_flag} />

        {/* 치료실(방이름) — T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-3.
            getAssignedSlotName(SSOT) 파생 — 배정된 방 있으면 '◯번 치료실' 등 표시, 미배정/대기면 '—'. */}
        {(() => {
          const slotName = getAssignedSlotName(row as unknown as Parameters<typeof getAssignedSlotName>[0]);
          return slotName ? (
            <span
              className="inline-flex min-w-0 items-center gap-0.5 rounded border border-teal-100 bg-teal-50 px-1 py-px text-[10px] font-medium text-teal-700"
              title={slotName}
              data-testid="patient-room"
            >
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{slotName}</span>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/50 text-left" data-testid="patient-room">—</span>
          );
        })()}

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
              onClick={() => confirm.mutate({ checkInId: row.id, customerId: row.customer_id })}
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

      {/* 펼쳐진 영역 — 빠른처방 버튼
          T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY: 아래에 임상경과+처방내역 블록이
          이어지므로 rounded-b-lg 는 최하단 블록으로 이관(여기선 제거). 게이트/버튼 로직 불변(AC-3). */}
      {expanded && !isConfirmed && (
        <div className="border-t px-3 py-2.5 bg-white">
          <QuickRxBar
            doctorMode={doctorMode}
            role={role}
            checkInId={row.id}
            onApplied={onRefresh}
            checkInStatus={row.status}
            checkedInAt={row.checked_in_at}
            /* T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)는 원내 잔류 → 처방 허용(귀가만 차단). */
            checkInFlag={row.status_flag}
            /* T-20260610-foot-QUICKRX-BLOCK-PANEL-HIDE: 차트 연결 버그 수정 — onOpenChart 미전달로
               원내 비잔류 시 차트 열기 버튼이 렌더되지 않던 버그. */
            onOpenChart={onOpenChart}
            /* T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차트변경 audit attribution. */
            surface="doctor_patient_list"
            customerId={row.customer_id}
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
        <div className="border-t px-3 py-2.5 bg-green-50/60">
          <div className="flex items-center gap-1.5">
            <RxConfirmedSummary
              checkInId={row.id}
              items={row.prescription_items}
              doctorMode={doctorMode}
              onCancelled={onRefresh}
              label="처방 내용"
              /* T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE:
                 귀가(원내 비잔류) 환자 처방취소 차단(inClinicRxGate SSOT) + 차트 진입 동선.
                 T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)는 원내 잔류 → 취소 허용(귀가만 차단). */
              checkInStatus={row.status}
              checkedInAt={row.checked_in_at}
              checkInFlag={row.status_flag}
              onOpenChart={onOpenChart}
              /* T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차트변경 audit attribution. */
              surface="doctor_patient_list"
              customerId={row.customer_id}
            />
            {row.doctor_confirmed_at && (
              <span className="ml-auto shrink-0 text-[11px] text-green-600">
                {format(new Date(row.doctor_confirmed_at), 'HH:mm', { locale: ko })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 확장 상세 — 임상경과 + 처방내역 read 뷰.
          T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY (AC-1/2, 문지은 6/10):
          - 351dd72/497672b 이후 비잔류(빠른처방 불가) 행은 QuickRxBar가 빈 렌더 → 그 빈 자리를
            임상경과+처방내역으로 채운다(planner 최소 요건 (b)). 동선 일관성 위해 모든 확장 행에 표시(옵션 a, dev 판단).
          - 처방내역: prescriptionOneLine(formatRxConfirmedSummary 정본) 다중약 전체 read 한 줄.
            확정 행은 상단 RxConfirmedSummary가 이미 약물리스트 표시 → 중복 방지 위해 !isConfirmed 행만 노출.
          - 임상경과: MedicalChartPanel embed variant='clinical'(DoctorCallDashboard showClinical 동일 SSOT).
            customer_id+clinic_id 있을 때만. 기존 차트 있으면 read 모드(isReadOnly) 로드. 신규 조회경로/Drawer 없음. */}
      {expanded && (
        <div
          className="border-t px-3 py-2.5 bg-white rounded-b-lg space-y-2"
          data-testid="patient-expand-detail"
        >
          {!isConfirmed && (
            <div className="flex items-start gap-1.5" data-testid="expand-rx-history">
              <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">처방내역</span>
              {(() => {
                const rxLine = prescriptionOneLine(row.prescription_items);
                const hasRx = rxLine !== '처방없음';
                return (
                  <span
                    className={`text-[11px] ${hasRx ? 'text-foreground' : 'text-muted-foreground/60'}`}
                    title={rxLine}
                  >
                    {rxLine}
                  </span>
                );
              })()}
            </div>
          )}

          {row.customer_id && clinicId ? (
            <div data-testid="expand-clinical-course">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                임상경과
                {/* T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3): 당일 외(과거/미래) 읽기전용 명시. */}
                {!isToday && <span className="ml-1 font-normal text-muted-foreground/60">(읽기전용 · 당일 환자만 수정)</span>}
              </span>
              <MedicalChartPanel
                embed
                open
                variant="clinical"
                customerId={row.customer_id}
                clinicId={clinicId}
                currentUserRole={role}
                currentUserEmail={currentUserEmail ?? null}
                onOpenChange={() => { /* embed clinical: 호출부 토글 없음 — 확장 토글이 가시성 제어 */ }}
                onSaved={onRefresh}
                /* T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-2/3): 당일 접수 환자만 편집 허용.
                   당일 외(미래 날짜 — 과거는 isPast 분기로 미마운트)는 readOnly=true 로 편집 차단. */
                readOnly={!isToday}
              />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/60" data-testid="expand-clinical-na">
              임상경과를 표시할 수 없습니다(고객 정보 없음).
            </p>
          )}
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

  // T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER: 그 날짜의 진료의 귀속 인덱스(read-only).
  const { data: signingIdx } = useSigningDoctorsByDate(clinicId, selectedDate);
  const doctorOptions = signingIdx?.doctors ?? [];
  const signedCustomers = signingIdx?.signedCustomers ?? new Set<string>();
  const byCustomer = signingIdx?.byCustomer ?? new Map<string, Set<string>>();

  // 필터 상태
  // T-20260609-foot-DOCDASH-LABEL-RX-REFINE item6: '처방없음'(none) → '처방나감'(confirmed)으로 교정.
  //   reporter 의도 = "처방전 있는(처방이 나간) 환자만" 필터 → prescription_status === 'confirmed'.
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed'>('all');

  // T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER: '서명한 의사별' 필터.
  //   값 = 'all'(기본·현 동작 유지) | doctor_id | '__unsigned__'(미서명/차트없음).
  const [doctorFilter, setDoctorFilter] = useState<string>('all');

  // 미서명(서명 차트 없는) 행 존재 여부 — '미서명' 옵션 노출 조건.
  const hasUnsigned = patients.some((p) => !p.customer_id || !signedCustomers.has(p.customer_id));

  // 날짜 이동 시 진료의 옵션 셋이 바뀌므로 의사 필터를 '전체'로 초기화(stale 선택 → 전 행 누락 방지).
  useEffect(() => {
    setDoctorFilter('all');
  }, [selectedDate]);

  // 방어: 현재 옵션에 없는 doctor_id(혹은 미서명 행 없는데 '__unsigned__')면 '전체'로 폴백.
  const validDoctorIds = new Set(doctorOptions.map((d) => d.id));
  const effectiveDoctorFilter =
    doctorFilter === 'all' ||
    (doctorFilter === '__unsigned__' && hasUnsigned) ||
    validDoctorIds.has(doctorFilter)
      ? doctorFilter
      : 'all';

  // T-20260609 ①: 정렬 옵션 — 시간순(접수시간) / 이름순(가나다). 기본=시간순.
  const [sortBy, setSortBy] = useState<'time' | 'name'>('time');

  const filtered = patients.filter((p) => {
    // 기존 처방상태 필터 (item6: '처방나감' = confirmed)
    if (filter === 'pending' && p.prescription_status !== 'pending') return false;
    if (filter === 'confirmed' && p.prescription_status !== 'confirmed') return false;
    // T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER: 서명한 의사별(누적 AND 조건).
    if (effectiveDoctorFilter === 'all') return true;
    const cid = p.customer_id;
    if (effectiveDoctorFilter === '__unsigned__') return !cid || !signedCustomers.has(cid);
    return !!cid && (byCustomer.get(cid)?.has(effectiveDoctorFilter) ?? false);
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
            { key: 'pending' as const, label: `처방확인 대기 (${pendingCount})` },
            // item6: '처방 없음' → '처방나감' → '처방환자 목록'(처방전 있는 환자 필터). 표시 라벨만 교정(필터 key='confirmed'/카운트 로직 불변).
            { key: 'confirmed' as const, label: `처방환자 목록 (${confirmedCount})` },
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

        <div className="flex items-center gap-2 shrink-0">
        {/* 서명한 의사별 필터 — T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER.
            그 날짜에 서명 진료의가 있는 차트가 있을 때만 노출(없으면 현 동작 그대로 = 정렬만). */}
        {doctorOptions.length > 0 && (
          <div className="flex items-center gap-1" data-testid="signdoctor-filter">
            <span className="text-[11px] text-muted-foreground mr-0.5">진료의</span>
            <select
              value={effectiveDoctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              data-testid="signdoctor-select"
              aria-label="서명한 의사별 필터"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="all">전체</option>
              {doctorOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
              {hasUnsigned && <option value="__unsigned__">미서명</option>}
            </select>
          </div>
        )}

        {/* 정렬 셀렉터 — 원내 우선 그룹은 정렬 옵션과 무관하게 항상 상단 유지 */}
        <div className="flex items-center gap-1" data-testid="patient-sort-toggle">
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
              clinicId={clinicId}
              currentUserEmail={profile?.email ?? null}
              isToday={isToday}
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
