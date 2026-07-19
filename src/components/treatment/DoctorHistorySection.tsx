// DoctorHistorySection.tsx — 치료테이블 §A '진료 환자 이력'
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-2/3)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER
//   A. 컴팩트 — 테이블 px/py·텍스트 축소(정보밀도 ↑).
//   B. 날짜필터 — 내부 date state 제거, 부모(TreatmentTable) 공통 날짜선택기의 `date` prop 사용(controlled).
//   D. 이름 인터랙션 — 좌클릭=2번차트 open / 우클릭=CRM 컨텍스트 메뉴(부모 nameInteraction 핸들러 위임).
// Ticket: T-20260710-foot-TREATHIST-DOCREQ-DOCTORCOUNT (김주연 총괄)
//   요구1. 소견·진단서 열 = '신청여부' + '발행여부' 2항목 분리 표시.
//   요구2. 탭 상단 = 진료의별 금일 담당 환자수 요약(read-only 집계).
// Ticket: T-20260710-foot-VISITHIST-DOCSTATUS-DOCTORCOUNT (김주연 총괄) — 위 티켓의 코디팀 프레이밍 delta
//   요구①(집계보강). 상단에 '소견·진단서 금일 신청 N건 · 발행 M건' 한눈 요약(코디팀 오늘 신청/발행 건수 확인용).
//     · 신규 스키마·쿼리 0 — 이미 파생된 rows(docRequested/opinionIssued)를 read-only 카운트(computeDocStatusSummary).
//     · 신청 ≠ 발행 독립 축(같은 환자 신청만/발행만/둘다 가능) → 각각 별도 카운트.
//   요구②. 진료의별 금일 담당 환자수 = 상위 티켓에서 이미 충족(computeDoctorCountSummary). 회귀 유지.
//   ※ 착수 결정(note): db_change=false / ② grain=실제 진료(진료콜 등재 status_flag purple|pink) / ① 신청모델=form_submissions
//     staff_consult 재사용(KOHEXAM check_in_services 모델 미공유·신규모델 0).
//
// Ticket: T-20260714-foot-TREATHIST-COMPLETED-LIST-RETAIN (김주연 총괄) — 상태 풀림 보존
//   요구. 진료 환자 이력에서 상태변경을 풀면(status_flag null) 리스트에서 완전 소멸 → 한번 올라왔던 환자를
//     하단 [진료완료] 섹션으로 이동해 보존. db_change=false(FE 리스트 쿼리/그룹핑 레이어).
//   착수 결정(discovery): 상태전이='풀림'=상태 플래그 메뉴 활성 flag 재클릭→null(StatusContextMenu L116).
//     '한번 올라왔던'=status_flag_history 에 purple|pink 이력(진료콜 등재 이력) 有. AC5=HANDSTATE '되돌리기'와
//     다른 write 경로·다른 surface → 충돌 0(본 fix 는 write 경로 불간섭, read 레이어만). 리셋=당일(checked_in_at bound).
//
// 리스트 기준: 선택 날짜 기준 원장 진료콜 명단에 등재된 이력이 있는 환자(내원).
//   진료콜 등재 = check_ins.status_flag IN ('purple'=진료필요, 'pink'=진료완료). (doctor-call-notify SSOT)
//   + 상태 풀림 보존(위 티켓): status_flag=null 이나 status_flag_history 에 purple|pink 이력이 있는 행도 재확보(하단 보존).
//
// 신청/발행 O/X — read-only 재사용, 신규 스키마 0 (discovery-first, db_change=false):
//   · 처방전 발행  = check_ins.prescription_status='confirmed' AND doctor_confirm_prescription=true (그 내원 행).
//   · 소견·진단서 신청 = form_submissions 요청 row(field_data.request_origin='staff_consult') 존재(당일·고객).
//       └ 재사용 배관: T-20260620-CHART2-OPINION-SELECT-BOX-LINK / opinionRequest.ts (실장→원장 서류 발행요청).
//         draft=대기 요청 / voided(resolved_reason='published')=발행완료된 요청 → 둘 다 '신청됨'.
//         voided(resolved_reason='cancelled')=요청취소 → 신청 아님(제외).
//   · 소견·진단서 발행 = form_submissions(status='published', field_data.doc_kind='opinion_doc') 존재(고객+발행일).
//       └ 현행 발행추적 값 재사용(회귀 0). 신청 row(staff_consult)와는 별개 published row.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import TreatingDoctorSelect from '@/components/TreatingDoctorSelect';
import { useTreatingDoctorOptions } from '@/hooks/useTreatingDoctorOptions';
import { chartNoBadge } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import type { VisitType, StatusFlag } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Stethoscope, Users, Eye, FileText } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

interface DoctorHistoryRow {
  checkInId: string;
  customerId: string | null;
  customerName: string;
  chartNumber: string | null;
  visitType: string;
  checkedInAt: string;
  rxIssued: boolean;         // 처방전 발행 O/X
  docRequested: boolean;     // T-20260710 소견·진단서 신청 O/X (요구1)
  opinionIssued: boolean;    // 소견·진단서 발행 O/X
  treatingDoctorId: string | null; // T-20260708 진료의(요청 A) — check_ins.treating_doctor_id
  // T-20260714-foot-TREATTABLE-DONE-SECTION-RETAIN: 진료완료(pink) 분리 표시용 파생.
  statusFlag: StatusFlag | null; // 진료콜 색 플래그 (purple=진료필요/진행, pink=진료완료).
  completedAt: string | null;    // 진료완료(pink) 전이 시각 — status_flag_history 파생(하단 섹션 정렬키).
}

function dayBounds(date: string) {
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` };
}

// ─── 순수 파생 로직 (E2E spec 이 동일 함수를 직접 import·단언 → drift 방지) ───────────────

// 신청여부 파생 — staff_consult 서류 발행요청 row 존재 판정(요구1, AC-3).
//   draft=대기 요청 / voided(resolved_reason≠'cancelled')=발행완료된 요청 → '신청됨'.
//   voided(resolved_reason='cancelled')=요청취소 → 신청 아님. (opinionRequest.ts 상태전이 그라운딩)
export function isActiveDocRequest(status: string, resolvedReason: string | null): boolean {
  if (status === 'draft') return true;
  if (status === 'voided') return resolvedReason !== 'cancelled';
  return false;
}

// 진료의별 금일 담당 환자수 요약(요구2, AC-4). 미배정 → '미지정' 버킷.
//   ★합계 = 입력 rows.length 와 항상 정합(미지정 포함) — read-only 집계.
export const UNASSIGNED_DOCTOR_KEY = '__unassigned__';
export interface DoctorCountEntry {
  key: string;       // clinic_doctors.id | UNASSIGNED_DOCTOR_KEY
  name: string;
  count: number;
  unassigned: boolean;
}
export function computeDoctorCountSummary(
  rows: Array<{ treatingDoctorId: string | null }>,
  doctorNameById: Map<string, string>,
): DoctorCountEntry[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.treatingDoctorId ?? UNASSIGNED_DOCTOR_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries: DoctorCountEntry[] = [...counts.entries()].map(([key, count]) => ({
    key,
    count,
    unassigned: key === UNASSIGNED_DOCTOR_KEY,
    name: key === UNASSIGNED_DOCTOR_KEY ? '미지정' : (doctorNameById.get(key) ?? '진료의(비활성)'),
  }));
  // 미지정 버킷 맨 뒤 → 담당수 desc → 이름 asc(ko).
  entries.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, 'ko');
  });
  return entries;
}

// 소견·진단서 금일 신청/발행 집계(T-20260710-VISITHIST-DOCSTATUS, 요구①). 코디팀 '오늘 신청 N건·발행 M건' 한눈 확인.
//   read-only — 이미 파생된 rows(docRequested/opinionIssued)만 카운트. 신규 쿼리·스키마 0.
//   신청 ≠ 발행 독립 축 → 각각 별도 카운트. total(명단 총원)은 분모 참고용.
export interface DocStatusSummary {
  requestedCount: number; // 소견·진단서 '신청' O 인 환자 수(금일)
  issuedCount: number;    // 소견·진단서 '발행' O 인 환자 수(금일)
  total: number;          // 진료콜 명단 총원(참고)
}
export function computeDocStatusSummary(
  rows: Array<{ docRequested: boolean; opinionIssued: boolean }>,
): DocStatusSummary {
  let requestedCount = 0;
  let issuedCount = 0;
  for (const r of rows) {
    if (r.docRequested) requestedCount += 1;
    if (r.opinionIssued) issuedCount += 1;
  }
  return { requestedCount, issuedCount, total: rows.length };
}

// ─── T-20260714-foot-TREATTABLE-DONE-SECTION-RETAIN — 진료완료(pink) 2섹션 분리 파생 ──────────────
//   배경: 진료 환자 이력 목록 쿼리는 status_flag IN ('purple'=진료필요, 'pink'=진료완료) 를 fetch한다.
//     진료완료(pink) 전이 후에도 상단 활성목록에 섞여 표시되어, 완료/미완료 구분이 흐려진다(현장 피드백).
//   교정: 완료(pink)를 상단 활성목록에서 빼서 하단 [진료완료] read-only 섹션으로 이동(완전소멸 X).
//     완료 status = status_flag 'pink' (SHAKEHAND-NO-COMPLETE field-soak 정합: purple→pink=진료완료 SSOT).
//   당일 범위 = 부모(TreatmentTable) 공통 날짜의 checked_in_at [00:00,23:59:59] KST — 쿼리 불변(회귀 0).
//     익일엔 그 날짜의 check_ins만 fetch → 전일 완료건 자연 제외(AC-4).

// 진료완료(pink) 전이 시각 파생 — status_flag_history 중 flag==='pink' 최신 changed_at.
//   applyStatusFlagTransition 가 completed_at 을 쓰지 않으므로(pink는 status='done'와 별개 신호),
//   pink 전이 이력이 완료시각의 1순위 근거. 부재 시 상위 호출부가 checked_in_at 폴백(+note).
export function derivePinkCompletionAt(
  history: Array<{ flag: StatusFlag | null; changed_at: string }> | null | undefined,
): string | null {
  if (!history || history.length === 0) return null;
  let latest: string | null = null;
  for (const h of history) {
    if (h.flag === 'pink' && h.changed_at) {
      if (!latest || h.changed_at > latest) latest = h.changed_at;
    }
  }
  return latest;
}

// ─── T-20260714-foot-TREATHIST-COMPLETED-LIST-RETAIN — 상태 풀림(revert/unset) 보존 파생 ──────────
//   배경: 진료 환자 이력 목록은 status_flag IN ('purple','pink') 만 fetch → 상태 플래그 메뉴에서 활성 flag
//     재클릭 시 status_flag=null 로 '풀림'(StatusContextMenu L116)되면 필터에서 탈락, 명단에서 완전 소멸.
//     한번 진료콜에 올라왔던 환자를 당일 추적 불가(현장 피드백, 김주연 총괄).
//   교정(db_change=false, FE 리스트 레이어): '풀림'=status_flag null 을 별도 q2 로 재확보하되,
//     status_flag_history 에 purple|pink 이력이 있는('한번 올라왔던') 행만 보존해 하단 [진료완료] 섹션으로 이동.
//   상태전이 특정: '풀림' = 상태 플래그 메뉴 활성 flag 재클릭 → status_flag null (applyStatusFlagTransition null).
//     ⚠ T-20260614 HANDSTATE-COLORCYCLE '되돌리기'(진료알림판 ✋ 손상태 색 사이클 = doctor_ack_at 토글,
//        status_flag 불간섭)와는 다른 surface·다른 write 경로 → 코드경로 충돌 없음(AC5). 본 fix 는 write 경로를
//        일절 만지지 않고 리스트 read/쿼리/그룹핑 레이어만 변경하므로 어떤 revert 경로든 이력 기반으로 보존.

// '한번 올라왔던' 판정 — status_flag_history 에 purple|pink 엔트리가 하나라도 있으면 진료콜 등재 이력 O.
//   (풀림으로 현재 flag 가 null 이어도 이력이 흔적. append 실패 caveat 있으나 최초 flag set 시 이미 append됨.)
export function historyHadDoctorCall(
  history: Array<{ flag: StatusFlag | null }> | null | undefined,
): boolean {
  if (!history || history.length === 0) return false;
  return history.some((h) => h.flag === 'purple' || h.flag === 'pink');
}

// 하단 [진료완료] 섹션 편입 사유 — pink='completed'(진료완료) / 그 외(null 등)='released'(상태해제 보존).
//   라벨 정합(§확인필요-3): 라벨 그대로의 '진료완료'(pink)와 '상태해제 후 보존'(released)을 배지로 구분.
export type RetainReason = 'completed' | 'released';
export function retainReason(flag: StatusFlag | null): RetainReason {
  return flag === 'pink' ? 'completed' : 'released';
}

// active(진료 진행중=purple) vs done(하단 보존=진료완료 pink + 상태해제 그 외) 분리.
//   AC-1(본건): 상태 풀림(null) 행은 소멸하지 않고 done 으로 편입. AC-3: 다시 purple 로 활성화하면 active 복귀.
//   done 섹션 정렬 = 완료시각(pink 전이) desc, 부재 시 checked_in_at desc 폴백(+행 note).
export interface CompletionSplit {
  active: DoctorHistoryRow[];
  done: DoctorHistoryRow[];
}
export function splitByCompletion(rows: DoctorHistoryRow[]): CompletionSplit {
  const active: DoctorHistoryRow[] = [];
  const done: DoctorHistoryRow[] = [];
  for (const r of rows) {
    // 진료 진행중(purple)만 상단 활성. 진료완료(pink)·상태해제(null 등)는 하단 보존.
    if (r.statusFlag === 'purple') active.push(r);
    else done.push(r);
  }
  done.sort((a, b) => {
    const ka = a.completedAt ?? a.checkedInAt ?? '';
    const kb = b.completedAt ?? b.checkedInAt ?? '';
    return kb.localeCompare(ka); // 완료/해제 시각 역순
  });
  return { active, done };
}

const DOCTOR_HISTORY_SELECT =
  'id, customer_id, customer_name, visit_type, status_flag, status_flag_history, status, checked_in_at, prescription_status, doctor_confirm_prescription, treating_doctor_id';

function useDoctorHistory(clinicId: string | null | undefined, date: string) {
  return useQuery<DoctorHistoryRow[]>({
    queryKey: ['doctor_history', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { start, end } = dayBounds(date);

      // q1 — 진료콜 등재 내원(status_flag purple|pink). 처방 발행 판정 컬럼 동반 read. (쿼리 불변, 회귀 0)
      const { data: ciData, error: ciErr } = await supabase
        .from('check_ins')
        .select(DOCTOR_HISTORY_SELECT)
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .neq('status', 'cancelled')
        .in('status_flag', ['purple', 'pink'])
        .order('checked_in_at', { ascending: true });
      if (ciErr) {
        if (/status_flag|prescription_status|42703/.test(ciErr.message ?? '')) return [];
        throw ciErr;
      }

      // q2 — T-20260714-foot-TREATHIST-COMPLETED-LIST-RETAIN: 상태 풀림(status_flag=null) 보존 재확보.
      //   당일 범위·비취소 동일, status_flag IS NULL 만. 클라이언트에서 '한번 올라왔던'(history purple|pink) 행만 유지.
      //   실패 시 [] 로 degrade — 활성/완료(q1) 표시는 무파손(기존 대비 악화 0).
      let revRows: Array<Record<string, unknown>> = [];
      try {
        const { data: revData } = await supabase
          .from('check_ins')
          .select(DOCTOR_HISTORY_SELECT)
          .eq('clinic_id', clinicId)
          .gte('checked_in_at', start)
          .lte('checked_in_at', end)
          .neq('status', 'cancelled')
          .is('status_flag', null)
          .order('checked_in_at', { ascending: true });
        revRows = ((revData ?? []) as Array<Record<string, unknown>>).filter((c) =>
          historyHadDoctorCall(
            (c['status_flag_history'] as Array<{ flag: StatusFlag | null }> | null) ?? null,
          ),
        );
      } catch {
        // 상태해제 보존행 조회 실패 — q1(활성/완료)만으로 진행(섹션 무파손).
      }

      // q1(purple/pink) + q2(null 상태해제) 병합 — status_flag 로 상호배타이나 id Set 으로 중복 방어.
      const seen = new Set<string>();
      const ciRows: Array<Record<string, unknown>> = [];
      for (const c of [...((ciData ?? []) as Array<Record<string, unknown>>), ...revRows]) {
        const id = String(c['id'] ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ciRows.push(c);
      }
      if (ciRows.length === 0) return [];

      // 소견·진단서 발행본(form_submissions published, doc_kind='opinion_doc') — 해당 날짜·고객 집합.
      const custIds = [...new Set(ciRows.map((c) => String(c['customer_id'] ?? '')).filter(Boolean))];
      const publishedSet = new Set<string>();
      if (custIds.length > 0) {
        try {
          const { data: pub } = await supabase
            .from('form_submissions')
            .select('customer_id, field_data, created_at')
            .eq('clinic_id', clinicId)
            .eq('status', 'published')
            .eq('field_data->>doc_kind', 'opinion_doc')
            .in('customer_id', custIds)
            .gte('created_at', start)
            .lte('created_at', end);
          for (const r of (pub ?? []) as Array<Record<string, unknown>>) {
            const cid = String(r['customer_id'] ?? '');
            if (cid) publishedSet.add(cid);
          }
        } catch {
          // 발행본 조회 실패 — 소견·진단서 발행 O/X 는 X 폴백(섹션 무파손).
        }
      }

      // 소견·진단서 '신청'(요구1) — 실장→원장 서류 발행요청 row(request_origin='staff_consult').
      //   재사용 배관(opinionRequest.ts / CHART2-OPINION-SELECT-BOX-LINK). 신규 스키마 0.
      //   당일(created_at) 기준 — 코디팀 '오늘 서류 신청 건수' 프레이밍. draft/voided(취소 제외)만 '신청됨'.
      const requestedSet = new Set<string>();
      if (custIds.length > 0) {
        try {
          const { data: reqs } = await supabase
            .from('form_submissions')
            .select('customer_id, status, field_data, created_at')
            .eq('clinic_id', clinicId)
            .eq('field_data->>request_origin', 'staff_consult')
            .in('customer_id', custIds)
            .in('status', ['draft', 'voided'])
            .gte('created_at', start)
            .lte('created_at', end);
          for (const r of (reqs ?? []) as Array<Record<string, unknown>>) {
            const cid = String(r['customer_id'] ?? '');
            if (!cid) continue;
            const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
            const reason = (fd['resolved_reason'] as string | null) ?? null;
            if (isActiveDocRequest(String(r['status'] ?? ''), reason)) requestedSet.add(cid);
          }
        } catch {
          // 신청 조회 실패 — 소견·진단서 신청 O/X 는 X 폴백(섹션 무파손).
        }
      }

      return ciRows.map((c) => {
        const cid = c['customer_id'] ? String(c['customer_id']) : null;
        const rxIssued =
          c['prescription_status'] === 'confirmed' && c['doctor_confirm_prescription'] === true;
        const statusFlag = (c['status_flag'] as StatusFlag | null) ?? null;
        const history =
          (c['status_flag_history'] as Array<{ flag: StatusFlag | null; changed_at: string }> | null) ?? null;
        return {
          checkInId: String(c['id']),
          customerId: cid,
          customerName: String(c['customer_name'] ?? '—'),
          chartNumber: null,
          visitType: String(c['visit_type'] ?? ''),
          checkedInAt: String(c['checked_in_at'] ?? ''),
          rxIssued,
          docRequested: cid ? requestedSet.has(cid) : false,
          opinionIssued: cid ? publishedSet.has(cid) : false,
          treatingDoctorId: (c['treating_doctor_id'] as string | null) ?? null,
          statusFlag,
          // 완료/해제 시각 정렬키 — pink 전이 이력이 1순위(완료 후 풀린 행도 완료시각 유지). purple(active)는 미사용.
          completedAt: derivePinkCompletionAt(history),
        } as DoctorHistoryRow;
      });
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 차트번호 + 연락처 보강(read-only). 우클릭 메뉴 '예약하기' 프리필용 phone 동반(additive read).
interface CustMeta { chart: string | null; phone: string | null; }
function useCustomerMeta(clinicId: string | null | undefined, customerIds: string[]) {
  const key = [...new Set(customerIds)].sort().join(',');
  return useQuery<Map<string, CustMeta>>({
    queryKey: ['doctor_history_meta', clinicId, key],
    enabled: !!clinicId && key.length > 0,
    queryFn: async () => {
      const m = new Map<string, CustMeta>();
      if (!clinicId || !key) return m;
      const { data } = await supabase
        .from('customers')
        .select('id, chart_number, phone')
        .in('id', key.split(','));
      for (const c of (data ?? []) as Array<{ id: string; chart_number: string | null; phone: string | null }>) {
        if (c.id) m.set(c.id, { chart: c.chart_number ?? null, phone: c.phone ?? null });
      }
      return m;
    },
    staleTime: 60_000,
  });
}

// 상태 O/X 배지 (label = '신청' | '발행').
function IssueBadge({ issued, label, testid }: { issued: boolean; label: string; testid: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        issued ? 'bg-emerald-50 text-emerald-700' : 'bg-muted/40 text-muted-foreground/60'
      }`}
      data-testid={testid}
      data-issued={issued ? 'true' : 'false'}
    >
      {issued ? `${label} O` : `${label} X`}
    </span>
  );
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function DoctorHistorySection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const qc = useQueryClient();

  const { data: rows = [], isLoading, isError, error } = useDoctorHistory(clinic?.id, date);
  // 진료의(요청 A) 저장 후 목록 즉시 갱신 — 진료콜 명단과 single-field-share(check_ins.treating_doctor_id)라
  //   반대쪽(대시보드 진료콜)도 realtime/refetch로 자동 반영(AC3).
  const onTreatingSaved = () =>
    void qc.invalidateQueries({ queryKey: ['doctor_history', clinic?.id, date] });
  const custIds = rows.map((r) => r.customerId).filter(Boolean) as string[];
  const { data: metaMap } = useCustomerMeta(clinic?.id, custIds);

  // 집계 기준 = 진료콜 명단(purple/pink)만. T-20260714-COMPLETED-LIST-RETAIN 로 보존 편입된 상태해제(null) 행은
  //   '금일 담당/신청/발행' 카운트에서 제외 → 기존 요약 수치 회귀 0(보존은 리스트 표시 전용).
  const callRows = rows.filter((r) => r.statusFlag === 'purple' || r.statusFlag === 'pink');

  // 요구2 — 진료의별 금일 담당 환자수 요약. 옵션(clinic_doctors) 이름맵으로 treating_doctor_id 해석.
  const { data: doctorOptions = [] } = useTreatingDoctorOptions(clinic?.id, date);
  const doctorNameById = new Map(doctorOptions.map((o) => [o.id, o.name]));
  const doctorSummary = computeDoctorCountSummary(callRows, doctorNameById);

  // 요구①(집계보강) — 소견·진단서 금일 신청/발행 건수 요약(코디팀 한눈 확인). read-only, callRows 파생 재사용.
  //   ★ 집계(진료의별 담당수·소견 신청/발행)는 완료 포함 진료콜 명단(callRows) 기준 유지 — 회귀 0.
  const docStatus = computeDocStatusSummary(callRows);

  // T-20260714-foot-TREATTABLE-DONE-SECTION-RETAIN + COMPLETED-LIST-RETAIN — 상단/하단 분리.
  //   active(진료 진행중 purple) = 상단 활성목록 / done(진료완료 pink + 상태해제 null) = 하단 read-only 보존 섹션.
  const { active, done } = splitByCompletion(rows);

  return (
    <div className="flex flex-col gap-3" data-testid="doctor-history-section">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Stethoscope className="h-4 w-4 text-teal-600" />
          진료 환자 이력
        </p>
        {/* T-20260719-foot-PATHIST-DESC-TEXT-REMOVE: 상단 안내 문구 제거(김주연 총괄 요청). 데이터/기능 무접점. */}
      </div>

      {/* 요구2 — 진료의별 금일 담당 환자수 요약(상단). 명단 있을 때만 노출. 합계=명단 총원(미지정 포함). */}
      {!isLoading && !isError && doctorSummary.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-[12px]"
          data-testid="dh-doctor-count-summary"
        >
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-teal-600" />
            진료의별 금일 담당
          </span>
          {doctorSummary.map((s) => (
            <span
              key={s.key}
              className="flex items-center gap-1"
              data-testid="dh-doctor-count-chip"
              data-doctor-id={s.key}
              data-count={s.count}
            >
              <span className={s.unassigned ? 'text-muted-foreground/70' : 'font-medium'}>
                {s.name}
              </span>
              <span className="tabular-nums font-semibold text-teal-700">{s.count}명</span>
            </span>
          ))}
        </div>
      )}

      {/* 요구①(집계보강) — 소견·진단서 금일 신청/발행 건수(코디팀 '오늘 신청 N건·발행 M건' 한눈). 진료콜 명단 있을 때만 노출. */}
      {!isLoading && !isError && callRows.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-[12px]"
          data-testid="dh-doc-status-summary"
        >
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5 text-teal-600" />
            소견·진단서 금일
          </span>
          <span
            className="flex items-center gap-1"
            data-testid="dh-doc-status-requested"
            data-count={docStatus.requestedCount}
          >
            <span className="text-muted-foreground">신청</span>
            <span className="tabular-nums font-semibold text-teal-700">{docStatus.requestedCount}건</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span
            className="flex items-center gap-1"
            data-testid="dh-doc-status-issued"
            data-count={docStatus.issuedCount}
          >
            <span className="text-muted-foreground">발행</span>
            <span className="tabular-nums font-semibold text-emerald-700">{docStatus.issuedCount}건</span>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-6 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
          data-testid="doctor-history-empty"
        >
          <Users className="h-5 w-5 text-muted-foreground/40" />
          해당 날짜에 진료콜 명단에 오른 환자가 없습니다.
        </div>
      ) : (
        <>
        {/* 상단 활성목록 — 진료 필요/진행(active). AC-1: 진료완료(pink)는 여기서 제외되어 하단 섹션으로 이동. */}
        {active.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="doctor-history-table">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">접수</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">환자</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">방문</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">진료의</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">처방전</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">소견·진단서 신청</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap">소견·진단서 발행</th>
                <th className="px-2.5 py-1.5 whitespace-nowrap text-center">문서 보기</th>
              </tr>
            </thead>
            <tbody>
              {active.map((r, idx) => {
                const anyIssued = r.rxIssued || r.opinionIssued;
                const meta = r.customerId ? metaMap?.get(r.customerId) : undefined;
                return (
                  <tr
                    key={r.checkInId}
                    className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    data-testid="doctor-history-row"
                  >
                    <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                      {r.checkedInAt ? format(new Date(r.checkedInAt), 'HH:mm') : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                      {/* D. 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
                        data-testid="dh-name-clickable"
                        onClick={() => nameInteraction.onLeftClick(r.customerId)}
                        onContextMenu={(e) =>
                          nameInteraction.onContextMenu(e, {
                            id: r.customerId ?? '',
                            name: r.customerName,
                            phone: meta?.phone ?? null,
                            visit_type: (r.visitType as 'new' | 'returning') || 'returning',
                          })
                        }
                      >
                        <span>{r.customerName}</span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                          {chartNoBadge(meta?.chart ?? null)}
                        </span>
                      </button>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge className="bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0">
                        {VISIT_TYPE_KO[r.visitType as VisitType] ?? r.visitType ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-2.5 py-1.5">
                      {/* 요청 A: 진료의 선택(행별). duty_roster 근무 원장 옵션·오늘 휴무 disabled(요청 D).
                          진료콜 명단과 동일 필드(check_ins.treating_doctor_id) 공유 → 실시간 연동(AC3). */}
                      <TreatingDoctorSelect
                        checkInId={r.checkInId}
                        clinicId={clinic?.id}
                        date={date}
                        value={r.treatingDoctorId}
                        onSaved={onTreatingSaved}
                        data-testid="dh-treating-doctor-select"
                      />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <IssueBadge issued={r.rxIssued} label="발행" testid="dh-rx-issue" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <IssueBadge issued={r.docRequested} label="신청" testid="dh-opinion-request" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <IssueBadge issued={r.opinionIssued} label="발행" testid="dh-opinion-issue" />
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      {/* 뷰어 pending_decision(모달 vs 인라인) — 현장 confirm 후 빌드. 발행본 있을 때만 자리 노출(비활성). */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[11px]"
                        disabled
                        title={anyIssued ? '문서 뷰어 준비 중(현장 확인 후 제공)' : '발행된 문서 없음'}
                        data-testid="dh-view-btn"
                      >
                        <Eye className="h-3 w-3" />
                        {anyIssued ? '보기(준비중)' : '—'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : (
          <div
            className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground"
            data-testid="doctor-history-active-empty"
          >
            <Stethoscope className="h-4 w-4 text-muted-foreground/40" />
            진행 중인 진료 환자가 없습니다. (모두 진료완료)
          </div>
        )}

        {/* 하단 [진료완료] read-only 섹션 — AC-1/AC-2. 완료(pink) 환자를 당일 이력으로 열람.
            편집/상태변경 액션 없음(read-only): 진료의=텍스트, 처방전·소견 O/X 표시 전용, 이름 좌클릭=차트 열람(read). */}
        {done.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="doctor-history-done-section">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-pink-400" aria-hidden />
              진료완료
              <span className="tabular-nums font-semibold text-pink-600">{done.length}명</span>
              <span className="text-[11px] font-normal text-muted-foreground/60">· 당일 이력(열람 전용)</span>
            </p>
            <div className="overflow-x-auto rounded-lg border border-pink-100 bg-pink-50/20" data-testid="doctor-history-done-table">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-pink-50/40 text-left text-[11px] font-semibold text-muted-foreground">
                    <th className="px-2.5 py-1.5 whitespace-nowrap">#</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">완료</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">환자</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">방문</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">진료의</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">처방전</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">소견·진단서 신청</th>
                    <th className="px-2.5 py-1.5 whitespace-nowrap">소견·진단서 발행</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((r, idx) => {
                    const meta = r.customerId ? metaMap?.get(r.customerId) : undefined;
                    const doctorName = r.treatingDoctorId
                      ? (doctorNameById.get(r.treatingDoctorId) ?? '진료의(비활성)')
                      : '미지정';
                    // 완료시각: pink 전이(completedAt) 1순위 / 부재 시 접수시각(checked_in_at) 폴백 + note.
                    const hasCompletedAt = !!r.completedAt;
                    const shownTime = r.completedAt ?? r.checkedInAt;
                    // T-20260714-COMPLETED-LIST-RETAIN: 편입 사유 — completed(pink 진료완료) / released(상태해제 보존).
                    const reason = retainReason(r.statusFlag);
                    return (
                      <tr
                        key={r.checkInId}
                        className="border-b last:border-0"
                        data-testid="doctor-history-done-row"
                        data-completed-at={r.completedAt ?? ''}
                        data-retain-reason={reason}
                      >
                        <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                        <td className="px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                          {shownTime ? format(new Date(shownTime), 'HH:mm') : '—'}
                          {!hasCompletedAt && (
                            <span className="ml-1 text-[10px] text-muted-foreground/50" title="완료시각 미기록 — 접수시각으로 대체 표기">
                              (접수)
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
                            data-testid="dh-done-name-clickable"
                            onClick={() => nameInteraction.onLeftClick(r.customerId)}
                          >
                            <span>{r.customerName}</span>
                            <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                              {chartNoBadge(meta?.chart ?? null)}
                            </span>
                          </button>
                          {/* 라벨 정합(§확인필요-3): 진료완료(pink)와 상태해제(풀림) 보존을 구분. released 만 명시 배지. */}
                          {reason === 'released' && (
                            <span
                              className="ml-1.5 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                              data-testid="dh-done-released-badge"
                              title="상태변경을 풀어(해제) 활성 명단에서 내려온 환자입니다. 이력 보존용으로 표시됩니다."
                            >
                              상태해제
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <Badge className="bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0">
                            {VISIT_TYPE_KO[r.visitType as VisitType] ?? r.visitType ?? '—'}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-1.5 text-[12px] text-muted-foreground whitespace-nowrap" data-testid="dh-done-doctor">
                          {doctorName}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <IssueBadge issued={r.rxIssued} label="발행" testid="dh-done-rx-issue" />
                        </td>
                        <td className="px-2.5 py-1.5">
                          <IssueBadge issued={r.docRequested} label="신청" testid="dh-done-opinion-request" />
                        </td>
                        <td className="px-2.5 py-1.5">
                          <IssueBadge issued={r.opinionIssued} label="발행" testid="dh-done-opinion-issue" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
      )}

      {/* T-20260719-foot-PATHIST-DESC-TEXT-REMOVE: 하단 ※ 설명 블록 2줄 제거(김주연 총괄 요청). O/X 표기·배지 등 기능 요소는 유지, 안내 텍스트만 삭제. */}
    </div>
  );
}
