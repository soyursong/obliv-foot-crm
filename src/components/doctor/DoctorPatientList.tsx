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
import { Loader2, CheckCircle2, Clock, ChevronDown, ChevronUp, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import QuickRxBar, { isDoctor, RxConfirmedSummary } from './QuickRxBar';
import {
  // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 처방확정 공통 가드 + 차트변경 audit.
  assertInClinicForRxMutation,
  logRxAudit,
  summarizeRxForAudit,
  IN_CLINIC_GATE_CODE,
} from '@/lib/rxMutationGuard';
import { isInClinic } from '@/lib/status';
// T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-2: 진료대시보드 이름 클릭은 진료차트(MedicalChartPanel)
//   직접오픈으로 전환됨 → useChart().openChart(2번차트 서랍) 미사용. 다른 진입점(고객관리 등)의 CHART-LOCK 게이트웨이는 무영향.
import { formatRxConfirmedSummary, normalizeRxItem } from '@/lib/rxTooltip';
// T-20260617-foot-DOCDASH-DOCLIST-5FIX B2-3: 진료완료목록 뷰어 re-skin으로 방 칼럼 제거 →
//   getAssignedSlotName(치료실 파생) 미사용 → import 제거. *_room 컬럼 SELECT/스키마는 무변경.
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
  /** 행별 진료완료 시각 구분(isVisitDone)용. completed_at 보유 OR status_flag='pink'.
   *  ※ 목록 모집단 필터는 T-20260616-foot-RXLIST-RENAME-DOCTORCALL-FILTER로 진료콜 명단(DoctorCallListBar) 멤버십으로 교체됨.
   *  check_ins 기존 컬럼 — SELECT 확장만, 스키마 무변경. */
  completed_at: string | null;
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
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
        <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
        처방전 O
      </span>
    );
  } else if (status === 'pending') {
    badge = (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        <Clock className="h-2.5 w-2.5 shrink-0" />
        임시
      </span>
    );
  } else {
    // AC-2: 처방전 X = 회색(유지·정밀화). 강조 없는 중립 회색.
    badge = (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400">
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
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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
// T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-1: 과거 날짜(isPast) 진료환자목록 소실 수정.
//   RC = RXLIST-RENAME-DOCTORCALL-FILTER(L290~) 진료콜 명단 멤버십 필터가 과거날짜(전원 귀가=dark_gray,
//   명단 이탈)를 전부 제거 → 빈 목록. 진료콜 명단은 '오늘 진료 대상'을 좁히는 운영 필터이므로 과거 이력
//   조회에는 부적절. → isPast면 멤버십 필터 skip하고 그날 non-cancelled 체크인(=받은 치료 이력) 전체 표시.
//   오늘/미래는 기존 필터 유지(회귀 0). isPast를 queryKey에 포함해 캐시 분리.
function usePatientsByDate(clinicId: string | null, dateISO: string, isPast = false) {
  return useQuery({
    queryKey: ['quick_rx_patient_list', clinicId, dateISO, isPast],
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
          // T-20260615-foot-RXLIST-RENAME-DOCFILTER item2: completed_at 추가(기존 컬럼, SELECT 확장만).
          //   ※ T-20260616-foot-RXLIST-RENAME-DOCTORCALL-FILTER로 목록 모집단 필터는 진료콜 명단(status_flag/status)으로 교체됨.
          //     completed_at은 이제 행별 isVisitDone(진료완료 시각 구분) 표시에만 사용(필터 SSOT 아님).
          'id, customer_id, customer_name, visit_type, status, status_flag, completed_at, checked_in_at, queue_number, prescription_status, doctor_confirmed_at, prescription_items, doctor_confirm_prescription, treatment_category, treatment_contents, treatment_kind, healer_laser_confirm, consultation_room, treatment_room, laser_room, examination_room, reservation:reservation_id(booking_memo), customers!customer_id(chart_number)',
        )
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${day}T00:00:00+09:00`)
        .lte('checked_in_at', `${day}T23:59:59+09:00`)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      // Supabase may return reservation as array or object — flatten to booking_memo
      const mapped = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
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
      // T-20260616-foot-RXLIST-RENAME-DOCTORCALL-FILTER (AC-2): '처방 환자 목록' 모집단을
      //   '금일 내방객 전체' → '금일 원장 진료콜 명단(doctor_call list) 교집합'으로 좁힘(진료콜 명단에 오른 환자만).
      //   ※ 6/15 RXLIST-RENAME-DOCFILTER의 '진료완료'(completed_at OR pink) 필터를 본 티켓이 정정·교체한다.
      //   진료콜 명단 멤버십 SSOT = DoctorCallListBar.displayList(activeList ∪ doneList)와 글자 그대로 1:1 동일:
      //     activeList: status_flag==='purple'(진료필요) OR status_flag==='yellow'(HL) OR status==='healer_waiting'(힐러대기)
      //     doneList  : status_flag==='pink'(진료완료/비활성)
      //   → 진료콜 명단에 한 번도 오르지 않은 행, 귀가(status='done'→status_flag='dark_gray', 명단 이탈) 행은 제외.
      //   '표시 대상 행만 축소' — 행별 처방 배지/요약/확정 등 표시 로직은 무변경(회귀 0).
      //   빈 명단(0건) 엣지: filter 결과 [] → 하단 빈 상태 정상 렌더(크래시 없음).
      //   T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-1: 과거 날짜는 진료콜 명단 멤버십 필터를 적용하지
      //     않고 그날 non-cancelled 체크인 전체(받은 치료 이력)를 표시 → 과거날짜 목록 소실 해소.
      if (isPast) return mapped;
      return mapped.filter(
        (row) =>
          row.status_flag === 'purple' ||
          row.status_flag === 'yellow' ||
          row.status_flag === 'pink' ||
          row.status === 'healer_waiting',
      );
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
// T-20260617-foot-DOCTABLE-VISITTYPE-UNIFY AC1 (문지은 대표원장, #foot, "모두 통일 반드시반드시"):
//   의사 환자 테이블뷰 초/재 배지 통일 — 진료 알림판(DoctorCallDashboard VisitBadge) 미러.
//   '초진'→'초' / '재진'→'재' 단일글자 라벨로 축약(좁은 칼럼 가독성). 분류 판정 로직·배지 배경색(cls)·
//   칼럼폭/폰트(className)·hover/title·data-testid 불변 — 표시 라벨만 축약(AC1·AC3 회귀금지).
//   좌정렬 블록 invariant: 배지는 grid 독립 칼럼(③, 폭 3rem 고정, flex justify-start)에서 이름(④) 바로 왼쪽 →
//   배지 left-edge 가 모든 행에서 세로 일치(이름 길이 무관). DASHCOL-REALIGN 확정 레이아웃 보존.
function VisitTypeBadge({ type }: { type: PatientRow['visit_type'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: '초', cls: 'bg-blue-100 text-blue-700' },
    returning: { label: '재', cls: 'bg-emerald-100 text-emerald-700' },
    // experience: 배지 미표시 (AC-4) — fallback 처리
  };
  const { label, cls } = map[type] ?? { label: type, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-center ${cls}`}
      data-testid="visit-type-badge"
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// T-20260617-foot-DOCDASH-DOCLIST-5FIX B2-3 (문지은 대표원장, MSG-20260618-002622-dfwd 경량 re-skin):
//   진료완료목록 뷰어가 진료알림판 진료완료 섹션을 미러 → '상태' 칼럼 제거. StatusCell 미사용 → 함수 삭제.
//   (A2 '진료완료 행 상태 우정렬'은 본 뷰어의 상태칼럼 자체가 사라져 superseded — status_flag 데이터·완료판정 SSOT 무변경.)
// ---------------------------------------------------------------------------

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
  // T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY (문지은 대표원장, item3):
  //   '진료완료' 판정 SSOT = 목록 필터(usePatients L285) · DoctorCallDashboard.completedPatients · RXLIST-RENAME-DOCFILTER 와
  //   글자 그대로 1:1 동일 — completed_at(귀가/원내잔류-시술완료) 보유 OR status_flag==='pink'(진료완료 처리).
  //   ⚠ prescription_status==='confirmed'(처방 확정)와는 다른 축. 진료완료 환자의 임상경과는 읽기전용(차트에서 수정).
  const isVisitDone = !!row.completed_at || row.status_flag === 'pink';

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
        {/* T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item⑤(B안): 진료알림판 테이블(41015d7) 밀도 통일 — 셀 px-1.5 py-1. 그리드 레이아웃/컬럼셋 무변경.
            T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN(이력 모드 통일): 이력 모드는 read-only 설계로 상태·방·예약메모·액션 컬럼 부재(DATEMODE-HISTORY AC-1/2).
            공유 컬럼(방문유형→이름→차트번호→처방)은 오늘 모드 확정 순서와 동일한 상대 배치 — 추가 재배치 불요(방문유형=이름 바로 왼쪽 유지). */}
        <div className="grid grid-cols-[3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto] items-center gap-1.5 px-1.5 py-1">
          {/* T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE(B): 대기순번(queue_number) 표시 칼럼 제거. */}
          {/* 방문유형 배지 (초진/재진) — 이름 바로 왼쪽(오늘 모드 확정 순서와 통일) */}
          <div className="flex justify-start">
            <VisitTypeBadge type={row.visit_type} />
          </div>
          {/* 이름 — T-20260612-foot-CHARTNO-COL-SPLIT-P1: 차트번호 서브텍스트 제거 → 옆 독립 칼럼으로 이전.
              item⑤(B안): 테이블 이름셀 톤 통일 — text-[15px] font-semibold text-gray-900. */}
          <span
            className="min-w-0 max-w-full truncate text-left text-[15px] font-semibold text-gray-900"
            title={row.customer_name}
            data-testid="patient-name"
          >
            {row.customer_name}
          </span>
          {/* 차트번호 — CHARTNO-COL-SPLIT-P1: 이름 바로 옆 독립 칼럼. 미발번은 '(미발번)'(빈칸 금지).
              item⑤(B안): 테이블 차트번호셀 톤 통일 — font-mono text-[13px] text-gray-500. */}
          <span
            className="min-w-0 max-w-full truncate text-left font-mono text-[13px] text-gray-500"
            title={chartNoDisplay(row.chart_number)}
            data-testid="patient-chartno"
          >
            {chartNoDisplay(row.chart_number)}
          </span>
          {/* 처방 상태 배지 (처방전 O/X) — 그날의 사실 기록(read-only) */}
          <div className="flex justify-start">
            <PrescriptionStatusBadge status={row.prescription_status} items={row.prescription_items} />
          </div>
          {/* 처방 내용 한 줄 — 없으면 '처방없음' (AC-2). item⑤(B안): 본문/빈값 톤 통일 — text-[13px] gray-700/gray-300. */}
          <span
            className={`text-[13px] truncate ${hasRx ? 'text-gray-700' : 'text-gray-300'}`}
            title={rxLine}
            data-testid="rx-oneline"
          >
            {rxLine}
          </span>
          {/* 치료 종류 (treatment_kind, 폴백=받은 치료) — item⑤(B안): 밀도 통일 text-[13px](의미색 emerald 보존). */}
          <span
            className="text-[13px] text-emerald-700 font-medium truncate max-w-[8rem]"
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
        T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN (문지은 대표원장 실화면 confirm, "다 통일하자"):
          확정 열 순서 = 방 → 상태 → 초진/재진(방문유형) → 이름 → 차트번호 → 처방 → 예약메모 → [버튼].
          진료 알림판(DoctorCallDashboard CallFeedRow: 방→상태→이름→…→처방) 흐름과 통일.
          방문유형 = 상태와 이름 사이 독립 컬럼(이름 바로 왼쪽). 예약메모 = 액션 버튼 바로 앞.
          ⚠ 칸 너비·크기 변경 0 — 각 컬럼 폭값을 컬럼과 함께 이동만(순서 재배치, 폭/비율 보존).
        T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-3: 치료실(방이름) 컬럼.
        T-20260612-foot-CHARTNO-COL-SPLIT-P1: 이름 칸 내 차트번호 서브텍스트 제거 → 이름 바로 옆 독립 칼럼.
        T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE(B): 대기순번(queue_number) 칼럼 제거 → 차트번호만 숫자.
        모든 행이 동일 grid-template → 방·상태·배지·이름·차트번호·처방·메모 항목이 행마다 동일 x위치(스크롤 무관).
      */}
      {/* T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item⑤(B안): 진료알림판 테이블(41015d7) 밀도 통일 — 셀 px-1.5 py-1.
          T-20260615 DASHCOL-REALIGN: 컬럼 순서만 재배치(폭값은 각 컬럼에 동반 이동, 너비 무변경). */}
      {/* T-20260617-foot-DOCDASH-DOCLIST-5FIX B2-3/B2-4 (문지은 대표원장, MSG-20260618-002622-dfwd 경량 re-skin):
          진료완료목록 뷰어 = 진료알림판 진료완료 섹션 미러 → 방·상태 칼럼 제거(B2-3) + '당일시술' 칼럼 추가(B2-4).
          카드그리드 유지(table 전환·thead 신설·birth_date/clinicalPreview 배선 금지). 컬럼셋: 방문유형·이름·차트번호·당일시술·처방·예약메모·액션. */}
      <div className="grid grid-cols-[3rem_5rem_4.5rem_7rem_5.5rem_minmax(0,1fr)_auto] items-center gap-1.5 px-1.5 py-1">
        {/* T-20260613-foot-DOCPATIENTLIST-MIRROR-MONOTONE(B): 대기순번(queue_number) 표시 칼럼 제거. queue_number 타입/SELECT/정렬·RPC 무손상. */}

        {/* ① 방문유형 배지(초진/재진) — B2-3 후 행 선두(폭 3rem 보존, 이름 바로 왼쪽). */}
        <div className="flex justify-start">
          <VisitTypeBadge type={row.visit_type} />
        </div>

        {/* ④ 이름 — 고정 너비(글자수 변동 무관, 폭 5rem 보존), 초과 시 truncate.
            T-20260612-foot-CHARTNO-COL-SPLIT-P1: 차트번호 서브텍스트 제거 → 옆 독립 칼럼으로 이전.
            item⑤(B안): 테이블 이름셀 톤 통일 — text-[15px] font-semibold text-gray-900.
            T-20260623-foot-DOCDASH-PATIENTNAME-CHART-DRAWER (문지은 대표원장): 이름 클릭 → 진료차트 서랍(MedicalChartPanel) 직접오픈.
              형제 DoctorCallDashboard(doctor-call-name-chart-btn) 동선과 통일 — onOpenChart=openTreatmentChart(full) 旣 배선 재사용(신규 drawer 스택 신설 0).
              ⚠ 회귀0: 펼치기 토글(임상경과 인라인, embed clinical)·귀가 readonly 게이트는 무접촉. data-testid="patient-name"/text-left 보존(기존 스펙 호환).
              isPast(이력) 모드는 행 전체가 이미 onOpenChart 버튼 → 이 today 분기에서만 이름 버튼화(중첩 버튼 방지). */}
        <button
          type="button"
          onClick={onOpenChart}
          disabled={!onOpenChart}
          className="min-w-0 max-w-full truncate text-left text-[15px] font-semibold text-gray-900 underline-offset-2 transition-colors hover:text-indigo-700 hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-gray-900"
          title={onOpenChart ? `${row.customer_name} — 이름 클릭, 진료차트 열기 (서랍)` : row.customer_name}
          data-testid="patient-name"
        >
          {row.customer_name}
        </button>

        {/* ⑤ 차트번호 — CHARTNO-COL-SPLIT-P1: 이름 바로 옆 독립 칼럼(폭 4.5rem 보존). 미발번은 '(미발번)'(빈칸 금지).
            item⑤(B안): 테이블 차트번호셀 톤 통일 — font-mono text-[13px] text-gray-500. */}
        <span
          className="min-w-0 max-w-full truncate text-left font-mono text-[13px] text-gray-500"
          title={chartNoDisplay(row.chart_number)}
          data-testid="patient-chartno"
        >
          {chartNoDisplay(row.chart_number)}
        </span>

        {/* B2-4 (문지은 대표원장): '오늘시술'→'당일시술' 칼럼 — 진료알림판 진료완료 섹션 미러(차트번호 오른쪽, 처방 왼쪽).
            값 = treatmentSummary(SSOT: treatment_category·contents·kind 파생, read-only). 카드그리드라 thead 없음 → 셀 내 미니 라벨로 칼럼명 노출. */}
        <div className="flex min-w-0 flex-col leading-tight" data-testid="treatment-today">
          <span className="text-[10px] text-gray-400">당일시술</span>
          {(() => {
            const t = treatmentSummary(row);
            return (
              <span
                className={`truncate text-[13px] font-medium ${t ? 'text-emerald-700' : 'text-gray-300'}`}
                title={t ?? undefined}
              >
                {t ?? '—'}
              </span>
            );
          })()}
        </div>

        {/* ⑥ 처방 상태 배지 — 당일시술 오른쪽(폭 5.5rem 보존) + hover 처방내용 툴팁. */}
        <div className="flex justify-start">
          <PrescriptionStatusBadge status={row.prescription_status} items={row.prescription_items} />
        </div>

        {/* ⑦ 예약메모 — DASHCOL-REALIGN: 액션 버튼 바로 앞(유연폭 1fr 보존). T-20260517-foot-HEALER-MEMO-DISPLAY AC-1~4.
            item⑤(B안): 테이블 본문/빈값 톤 통일 — text-[13px] gray-600/gray-300. */}
        <span
          className={`text-[13px] truncate ${row.booking_memo ? 'text-gray-600' : 'text-gray-300'}`}
          title={row.booking_memo ?? undefined}
          data-testid="booking-memo"
        >
          {row.booking_memo || '—'}
        </span>

        {/* ⑧ 액션 — 확정 버튼 / 대기 알림 / 펼치기 토글 */}
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
      {/* B2-5: 진료완료(isVisitDone) 행은 처방 read-only preview(아래)로 대체 → 편집폼(QuickRxBar) 미노출. */}
      {expanded && !isConfirmed && !isVisitDone && (
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
      {/* B2-5: 진료완료(isVisitDone) 행은 처방 read-only preview(아래)로 대체 → 확정/취소 버튼(RxConfirmedSummary) 미노출. */}
      {expanded && isConfirmed && !isVisitDone && (
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

      {/* T-20260617-foot-DOCDASH-DOCLIST-5FIX B2-5 (문지은 대표원장): 진료완료(isVisitDone) 행 처방 = read-only preview.
          DONE-CLINICAL-READONLY(800be4d9) 게이트 재사용 — 편집폼(QuickRxBar)·확정/취소 버튼 미노출, 내용 없으면 '내용 없음'.
          처방 데이터/완료판정 SSOT(completed_at||pink) 무변경, 표시만 read-only. */}
      {expanded && isVisitDone && (
        <div className="border-t px-3 py-2.5 bg-white" data-testid="done-rx-readonly">
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">처방</span>
            {(() => {
              const rxLine = prescriptionOneLine(row.prescription_items);
              const hasRx = rxLine !== '처방없음';
              return (
                <span
                  className={`text-[11px] ${hasRx ? 'text-foreground' : 'text-muted-foreground/60'}`}
                  title={hasRx ? rxLine : undefined}
                >
                  {hasRx ? rxLine : '내용 없음'}
                </span>
              );
            })()}
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
          {/* B2-5: 진료완료 행은 위 done-rx-readonly preview가 처방을 표시 → 중복 방지(isVisitDone 제외). */}
          {!isConfirmed && !isVisitDone && (
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
                {/* T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3): 당일 외(과거/미래) 읽기전용 명시.
                    T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY: 진료완료 환자도 읽기전용(완료조건 가산) —
                    당일 외(AC-3) 회귀 0 유지, 사유에 맞는 안내 문구 분기. */}
                {(!isToday || isVisitDone) && (
                  <span className="ml-1 font-normal text-muted-foreground/60">
                    {isVisitDone ? '(읽기전용 · 진료완료 — 차트에서 수정)' : '(읽기전용 · 당일 환자만 수정)'}
                  </span>
                )}
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
                   당일 외(미래 날짜 — 과거는 isPast 분기로 미마운트)는 readOnly=true 로 편집 차단.
                   T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY: '당일' AND '진료 미완료'일 때만 편집 허용.
                   진료완료(isVisitDone) 환자는 당일이어도 읽기전용 → 편집 입력창·저장버튼 미노출(MedicalChartPanel embed readOnly). */
                readOnly={!isToday || isVisitDone}
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

  // T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-2: 진료대시보드 이름 클릭 → '무조건 진료차트'.
  //   RC = 기존 onOpenChart가 useChart().openChart(customerId)(=2번차트 서랍/고객차트)로 라우팅 →
  //   현장 기대(진단/경과/처방 진료차트)와 어긋남. 형제 DoctorCallDashboard는 RX-CHART-FOLLOWUP3 C-1에서
  //   진료차트(MedicalChartPanel) 직접오픈으로 정정됐으나 본 목록만 누락(CHART-OPEN-ENTRYPOINT-UNIFY 결함클래스 재발).
  //   → DoctorCallDashboard와 동일하게 로컬 상태 MedicalChartPanel 직접오픈으로 이식.
  //   ※ AC-3: 본 변경은 진료대시보드 진료환자목록 진입점만 정정 — 고객관리 등 다른 진입점의
  //     useChart().openChart(2번차트 서랍, CHART-LOCK) 동선은 무접촉(회귀 0).
  const [medicalChartCustomerId, setMedicalChartCustomerId] = useState<string | null>(null);
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  const [medicalChartVariant, setMedicalChartVariant] = useState<'full' | 'clinical'>('full');
  const openTreatmentChart = (customerId: string, variant: 'full' | 'clinical' = 'full') => {
    setMedicalChartCustomerId(customerId);
    setMedicalChartVariant(variant);
    setMedicalChartOpen(true);
  };

  // T-20260606-foot-RX-PATIENT-LIST-DATENAV AC-1: 기본 조회 날짜 = 오늘(KST). AC-2: < > 로 전/후 이동.
  const todayISO = todaySeoulISODate();
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const isToday = selectedDate === todayISO;
  // T-20260609-foot-PASTVISIT-TREATMENT-VIEW: 어제 이전 = 과거(read-only '받은 치료' 모드).
  //   ISO 'YYYY-MM-DD' 사전식 비교 = 캘린더 비교(타임존 무관). 미래(다음날) 조회는 과거 아님 → 현행 유지.
  const isPast = selectedDate < todayISO;

  // T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-1: isPast 전달 → 과거날짜 진료콜 멤버십 필터 skip.
  const { data: patients = [], isLoading, refetch } = usePatientsByDate(clinicId, selectedDate, isPast);

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
          {/* T-20260617-foot-DOCDASH-DOCLIST-5FIX B1(A4): 헤더 라벨도 서브탭과 일관 — '처방 환자 목록'→'진료 환자 목록'(reporter-explicit). */}
          <p className="text-sm font-medium">진료 환자 목록</p>
          {/* T-20260606-foot-RX-PATIENT-LIST-DATENAV AC-1/AC-2: 날짜 헤더 + < > 전/후 이동 + 진료완료 인원 */}
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
              {/* T-20260615-foot-RXLIST-RENAME-DOCFILTER item2: 목록이 진료완료 고객만 → '접수'→'진료완료' 표기 정합. */}
              <span>{patients.length}명 진료완료</span>
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
          {/* T-20260616-foot-RXLIST-RENAME-DOCTORCALL-FILTER: 모집단=진료콜 명단 → 빈 상태 문구도 명단 기준으로 정정. */}
          {filter === 'all'
            ? `${isToday ? '오늘' : formatISOToKoLabel(selectedDate)} 진료콜 명단에 오른 환자가 없습니다.`
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
              onOpenChart={row.customer_id ? () => openTreatmentChart(row.customer_id as string, 'full') : undefined}
              isPast={isPast}
              clinicId={clinicId}
              currentUserEmail={profile?.email ?? null}
              isToday={isToday}
            />
          ))}
        </div>
      )}

      {/* T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-2: 진료차트(MedicalChartPanel) — 이름 클릭 시 직접 오픈.
          DoctorCallDashboard(RX-CHART-FOLLOWUP3 C-1)와 동일 패턴·동일 medical_charts 소스. 부모 단일 렌더(행 누수 0). */}
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
        onOpenFull={() => setMedicalChartVariant('full')}
      />
    </div>
  );
}
