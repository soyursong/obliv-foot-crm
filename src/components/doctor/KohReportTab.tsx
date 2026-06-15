// KohReportTab — 균검사지(KOH 진균검사) 명단 리포트 탭
// Ticket: T-20260611-foot-KOH-REPORT-TAB (Phase 1) + T-20260612-foot-KOH-REPORT-PHASE15 (Phase 1.5)
//         + T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR (균검사지 6컬럼 재정의 + 조갑부위 multi-select)
//
// KOH(수산화칼륨) 진균검사를 시행한 환자 명단을 '검사일'(월 단위) 기준으로 조회한다.
// 컬럼(KOHSHEET-RENEWAL §B, 6컬럼 통일): 이름 · 생년 · 차트 · 검사일(날짜만) · 조갑부위 · 진료의
//   ※ Phase 1.5(PHASE15, 3중 게이트 ALL GO): 발톱부위(입력) + 당일의사명(조인) 추가.
//   ※ KOHSHEET-RENEWAL: 검사일 시간 제거(날짜만, B2) + 조갑부위 입력 단일→복수선택 완화(C2).
//
// === KOHSHEET-RENEWAL (T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR) ===
//  B. 6컬럼 재정의 — 헤더 라벨 통일(이름/생년/차트/검사일/조갑부위/진료의). 검사일=날짜만(YYYY-MM-DD, FE 한정).
//  C. 조갑부위 입력 = 좌발 L1~L5 | 우발 R1~R5 toggle, **다중선택**(복수 부위), 선택 강조.
//     L→Lt, R→Rt. 저장 shape 는 PHASE15 canon {side:Lt|Rt, toe:1-5} 그대로(DB 무변경, 배열 이미 지원).
//     PHASE15 단일선택 UI 를 본 티켓 multi 로 직접 교체(churn 금지, 1회 ship).
//
// === Phase 1.5 (T-20260612-foot-KOH-REPORT-PHASE15) ===
//  A. 발톱부위 = check_in_services.koh_nail_sites jsonb. 원소 {side:Rt|Lt, toe:1-5}.
//     입력 위젯 = (KOHSHEET-RENEWAL C 로 대체) 좌발 L1~L5 | 우발 R1~R5 다중선택 토글.
//     쓰기 = RPC set_koh_nail_sites (check_in_services UPDATE RLS=consultant+ 우회, 승인 사용자 누구나).
//     DB엔 구조만 저장 — 표시문자열은 FE 파생(formatNailSite: 'Rt 1지 조갑').
//  B. 당일의사명 = medical_charts.signing_doctor_name (deployed b65357e) read-only 조인.
//     연결키 = customer_id + visit_date(=검사일 KST). 1환자 N차트 = 그날 진료의 합집합(Set).
//     미서명/차트없음/레거시 NULL = '미정'. ❌ 신규 컬럼/role 신설 금지.
//
// 데이터 경로 (AC-0 evidence: db-gate/T-20260611-foot-KOH-REPORT-TAB_ac0_evidence.md):
//   check_in_services(검사일=created_at, KOH 매칭=service_name)
//     → check_ins!inner(clinic_id, customer_id, customer_name)        [check_in_id FK]
//       → customers(name, birth_date, chart_number)                    [customer_id FK, 표기명 우선]
//
//   KOH 매칭식(denormalized service_name ILIKE):
//     service_name ILIKE '%KOH%' OR service_name ILIKE '%진균검사%'
//   ⚠ service_code/hira_code 매칭 금지 — DX-KOH-01(미존재)·D6591/D2502001(비활성).
//     실운영 서비스명 = '일반진균검사-KOH도말-조갑조직'(service_code=D620300HZ, active).

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, FlaskConical, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { parseFootSites, type FootSite } from '@/components/FootSiteSelector';
import MedicalChartPanel from '@/components/MedicalChartPanel';

// ---------------------------------------------------------------------------
// KOH 진균검사 매칭 — service_name denormalized ILIKE 정본(SSOT).
//   service_code/hira_code 매칭 금지(AC-0 evidence). 'KOH'는 대소문자 무시, '진균검사'는 그대로.
// ---------------------------------------------------------------------------
export function kohServiceNameMatches(serviceName: string | null | undefined): boolean {
  if (!serviceName) return false;
  return serviceName.toUpperCase().includes('KOH') || serviceName.includes('진균검사');
}

// ---------------------------------------------------------------------------
// 월(YYYY-MM) 이동 — UTC 정오 기준으로 ±N개월, DST/경계 드리프트 없음.
// ---------------------------------------------------------------------------
export function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + deltaMonths, 1, 12, 0, 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 오늘(KST) 기준 'YYYY-MM' */
export function currentYearMonthSeoul(): string {
  return todaySeoulISODate().slice(0, 7);
}

/** 'YYYY-MM' → 'YYYY년 M월' 표기 */
export function formatYearMonthKo(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** 생년월일 표시 — DATE/timestamptz 어느 쪽이든 YYYY-MM-DD 10자리만, 결측 '—' */
export function formatBirthDate(birth: string | null | undefined): string {
  if (!birth) return '—';
  const s = String(birth).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || '—';
}

/** 검사일 표시(레거시, 날짜+시간) — created_at(UTC) → KST 'YYYY-MM-DD HH:mm'. */
export function formatExamDateTime(createdAt: string | null | undefined): string {
  if (!createdAt) return '—';
  const date = seoulISODate(createdAt);
  const time = new Date(createdAt).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${date} ${time}`;
}

/** 검사일 표시 — KOHSHEET-RENEWAL §B2: 날짜만(시간 제거). created_at(UTC) → KST 'YYYY-MM-DD'. */
export function formatExamDate(createdAt: string | null | undefined): string {
  if (!createdAt) return '—';
  return seoulISODate(createdAt);
}

// ---------------------------------------------------------------------------
// 발톱부위(KOH 검사부위) — T-20260612-foot-KOH-REPORT-PHASE15 (A).
//   원소 = {side:'Rt'|'Lt', toe:1-5}. DB엔 구조만 저장(표시문자열 저장 금지) → 아래 render 는 FE 파생.
// ---------------------------------------------------------------------------
export type NailSide = 'Rt' | 'Lt';
export interface NailSite {
  side: NailSide;
  toe: number; // 1-5
}

/** canonical render — 단일 원소 'Rt 1지 조갑' */
export function formatNailSite(site: NailSite): string {
  return `${site.side} ${site.toe}지 조갑`;
}

/** 안정 정렬 — KOHSHEET-RENEWAL §C: 다중선택 표시 일관성. 좌발(Lt) 먼저, 같은 발이면 발가락 오름차순. */
export function sortNailSites(sites: NailSite[]): NailSite[] {
  const sideRank: Record<NailSide, number> = { Lt: 0, Rt: 1 };
  return [...sites].sort((a, b) => sideRank[a.side] - sideRank[b.side] || a.toe - b.toe);
}

/** 배열 → 표시문자열(', ' join, 정렬 적용). 빈/결측 = '—' */
export function formatNailSites(sites: NailSite[] | null | undefined): string {
  if (!sites || sites.length === 0) return '—';
  return sortNailSites(sites).map(formatNailSite).join(', ');
}

/** jsonb(unknown) → NailSite[] 방어적 파싱. closed-enum(Rt/Lt, 1-5) 외 원소는 버림. */
export function parseNailSites(raw: unknown): NailSite[] {
  if (!Array.isArray(raw)) return [];
  const out: NailSite[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const side = (e as { side?: unknown }).side;
    const toe = Number((e as { toe?: unknown }).toe);
    if ((side === 'Rt' || side === 'Lt') && Number.isInteger(toe) && toe >= 1 && toe <= 5) {
      out.push({ side, toe });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 치료부위 → 균검사지 조갑부위 정규화 매핑 — T-20260615-foot-KOHSHEET-NAILSYNC-CHARTOPEN (AC1).
//   소스 = check_ins.treatment_memo.foot_site(s) (FootSite {side:'L'|'R', toe:1-5}).
//   타겟 = koh_nail_sites (NailSite {side:'Lt'|'Rt', toe:1-5}).
//   다른 테이블 + 다른 side enum → 단순 복사 불가. L→Lt / R→Rt, toe 1:1 변환. 단방향(AC4).
// ---------------------------------------------------------------------------
/** FootSite('L'/'R') → NailSite('Lt'/'Rt'), toe 동일. */
export function footSiteToNailSite(s: FootSite): NailSite {
  return { side: s.side === 'L' ? 'Lt' : 'Rt', toe: s.toe };
}

/**
 * treatment_memo(jsonb) → 치료부위 정규화 NailSite[].
 *   foot_sites(신규 배열) 우선, 없으면 레거시 단일 foot_site 폴백(CheckInDetailSheet 동선과 동일 파서).
 *   L→Lt / R→Rt 변환 후 중복 제거 + 정렬. 결측·잡값은 빈 배열.
 */
export function treatmentNailSites(treatmentMemo: unknown): NailSite[] {
  const tm =
    treatmentMemo && typeof treatmentMemo === 'object'
      ? (treatmentMemo as { foot_sites?: unknown; foot_site?: unknown })
      : null;
  if (!tm) return [];
  const footSites = parseFootSites(tm.foot_sites ?? tm.foot_site);
  const out: NailSite[] = [];
  for (const fs of footSites) {
    const ns = footSiteToNailSite(fs);
    if (!out.some((o) => o.side === ns.side && o.toe === ns.toe)) out.push(ns);
  }
  return sortNailSites(out);
}

// ---------------------------------------------------------------------------
// +1일 경과 판정 — T-20260611-foot-KOH-REPORT-TAB (AC-1/AC-3 SSOT).
//   현장 요구 = "KOH 균검사를 받은 지 하루 지난 환자"만 명단에 노출(검사지 발행 대상).
//   판정식: 검사일(KST 캘린더 날짜) < 오늘(KST) → 검사 다음날부터 표시. 당일/미래 검사는 제외.
//   ISO 'YYYY-MM-DD' 사전식 비교 = 캘린더 비교(타임존 무관). 시·분 무관(날짜 경계 기준).
//   AC-3: 검사 당일(+1일 미경과) 환자 / 미수검(KOH row 없음) 환자는 자연히 제외.
// ---------------------------------------------------------------------------
export function isKohExamEligible(createdAt: string | null | undefined, todayISO: string): boolean {
  if (!createdAt) return false;
  return seoulISODate(createdAt) < todayISO;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface KohRow {
  id: string;                    // check_in_services.id (= KOH 검사 인스턴스, 발톱부위 귀속 키)
  service_name: string;
  created_at: string;            // 검사일(UTC timestamptz)
  customer_id: string | null;    // PHASE15(B): 당일의사 조인 키(+visit_date)
  customer_name: string;         // 표기명 — customers.name 우선, fallback check_ins.customer_name
  birth_date: string | null;     // 생년월일
  chart_number: string | null;   // 차트번호
  nail_sites: NailSite[];        // PHASE15(A): 발톱부위(koh_nail_sites jsonb 파생)
  treatment_sites: NailSite[];   // NAILSYNC(AC1): 치료부위(treatment_memo.foot_site → L→Lt/R→Rt 정규화 미러)
  koh_requested: boolean;        // LIFECYCLE(AC-1/AC-2): KOH 신청 플래그. true=active(신청)/false=inactive(미신청·취소)
}

// ---------------------------------------------------------------------------
// 발행 결과지 — T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-3/AC-4/AC-5).
//   form_submissions(status='published', template=koh_result) 1건 = 1 발행 결과지.
//   KOH 검사행 ↔ 결과지 연결 = field_data.koh_service_id(스키마 무변경).
// ---------------------------------------------------------------------------
export interface PublishedKoh {
  id: string;                       // form_submissions.id
  koh_service_id: string;           // 연결 check_in_services.id
  request_no: string;               // 의뢰번호(자동채번)
  field_data: Record<string, unknown>;
  created_at: string;
}

/** 검체채취일/검사의뢰일 표기 — 진료일(검사일) KST 'YYYY.MM.DD'(정본 양식 점 구분). */
export function formatDocDate(createdAt: string | null | undefined): string {
  if (!createdAt) return '—';
  return seoulISODate(createdAt).replace(/-/g, '.');
}

// ---------------------------------------------------------------------------
// 조회 hook — 월 범위 + clinic + KOH 매칭(read-only)
//   범위 바운드: [YYYY-MM-01 00:00 KST, 다음달-01 00:00 KST) — KST 경계 정확.
// ---------------------------------------------------------------------------
function useKohReport(clinicId: string | null, ym: string) {
  return useQuery<KohRow[]>({
    queryKey: ['koh_report', clinicId, ym],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const startBound = `${ym}-01T00:00:00+09:00`;
      const endBound = `${shiftYearMonth(ym, 1)}-01T00:00:00+09:00`;

      // PHASE15: koh_nail_sites(발톱부위) + check_ins.customer_id(당일의사 조인키) 추가.
      //   ⚠ FE-DB 순서 안전장치: koh_nail_sites 컬럼이 아직 없으면(마이그 적용 전 prod 도달 시)
      //     select 가 42703(컬럼없음)으로 실패 → 기존 Phase1 탭이 깨진다. column-missing 감지 시
      //     koh_nail_sites 제외 select 로 1회 폴백(발톱부위는 빈값). 마이그 적용 후 자동 활성.
      // NAILSYNC(AC1/AC2): check_ins.treatment_memo 동봉 → 치료부위(foot_site) 미러 소스.
      //   treatment_memo 는 既존 jsonb 컬럼(신규 컬럼 0). 균검사지에서 치료부위 선택분을 프리필.
      // LIFECYCLE(AC-1/AC-2): koh_requested(신청 플래그) 추가. koh_nail_sites 와 동일 column-missing 폴백 대상.
      const SELECT_WITH = 'id, service_name, created_at, koh_nail_sites, koh_requested, check_ins!inner(clinic_id, customer_id, customer_name, treatment_memo, customers(name, birth_date, chart_number))';
      const SELECT_WITHOUT = 'id, service_name, created_at, check_ins!inner(clinic_id, customer_id, customer_name, treatment_memo, customers(name, birth_date, chart_number))';
      const runQuery = (sel: string) =>
        supabase
          .from('check_in_services')
          .select(sel)
          // 임베드(check_ins)는 !inner — clinic 필터가 부모행을 실제로 제한.
          .eq('check_ins.clinic_id', clinicId)
          // KOH 매칭(denormalized name ILIKE). service_code/hira_code 매칭 금지.
          .or('service_name.ilike.%KOH%,service_name.ilike.%진균검사%')
          .gte('created_at', startBound)
          .lt('created_at', endBound)
          .order('created_at', { ascending: false });

      let { data, error } = await runQuery(SELECT_WITH);
      // koh_nail_sites 또는 koh_requested 컬럼 부재(마이그 적용 전) 시 1회 폴백 — 둘 다 같은 마이그.
      if (error && /(koh_nail_sites|koh_requested)/.test(error.message ?? '')) {
        ({ data, error } = await runQuery(SELECT_WITHOUT));
      }
      if (error) throw error;

      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
        // PostgREST 임베드는 환경에 따라 object/array 양쪽 → 방어적 flatten.
        const ciRaw = row['check_ins'];
        const ci = (Array.isArray(ciRaw) ? ciRaw[0] : ciRaw) as
          | { customer_id?: string | null; customer_name?: string | null; treatment_memo?: unknown; customers?: unknown }
          | undefined;
        const custRaw = ci?.customers;
        const cust = (Array.isArray(custRaw) ? custRaw[0] : custRaw) as
          | { name?: string | null; birth_date?: string | null; chart_number?: string | null }
          | undefined;
        const name = (cust?.name ?? '').trim() || (ci?.customer_name ?? '').trim() || '—';
        return {
          id: String(row['id']),
          service_name: String(row['service_name'] ?? ''),
          created_at: String(row['created_at'] ?? ''),
          customer_id: ci?.customer_id ?? null,
          customer_name: name,
          birth_date: cust?.birth_date ?? null,
          chart_number: cust?.chart_number ?? null,
          nail_sites: parseNailSites(row['koh_nail_sites']),
          treatment_sites: treatmentNailSites(ci?.treatment_memo),
          koh_requested: row['koh_requested'] === true, // 컬럼 부재 폴백 시 undefined → false(미신청)
        } as KohRow;
      });
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// 당일 진료의사 조인 — T-20260612-foot-KOH-REPORT-PHASE15 (B). 신규 스키마 ZERO(read-only).
//   medical_charts.signing_doctor_name(deployed b65357e) 를 customer_id + visit_date(=검사일 KST)로
//   조인. live 패턴(DoctorPatientList.useSigningDoctorsByDate) 재사용 — 단, 본 탭은 '월' 단위라
//   월 범위 medical_charts 를 한 번에 받아 (customer_id|visit_date) → 진료의명 Set 으로 인덱싱.
//   1환자 N차트 = 그날 진료의 합집합. 미서명/레거시 NULL/차트없음 = 키 부재 → 호출부에서 '미정'.
// ---------------------------------------------------------------------------
function useKohSigningDoctorsByMonth(clinicId: string | null, ym: string) {
  return useQuery<Map<string, Set<string>>>({
    queryKey: ['koh_signing_doctors', clinicId, ym],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, Set<string>>();
      if (!clinicId) return map;
      // visit_date 는 DATE → 'YYYY-MM-DD' 사전식 범위([ym-01, 다음달-01)). seoulISODate(검사일)과 동일 포맷.
      const startDate = `${ym}-01`;
      const endDate = `${shiftYearMonth(ym, 1)}-01`;
      const { data, error } = await supabase
        .from('medical_charts')
        .select('customer_id, visit_date, signing_doctor_name')
        .eq('clinic_id', clinicId)
        .gte('visit_date', startDate)
        .lt('visit_date', endDate);
      if (error) throw error;
      for (const raw of (data ?? []) as Array<{
        customer_id: string | null;
        visit_date: string | null;
        signing_doctor_name: string | null;
      }>) {
        const cid = raw.customer_id;
        const vd = raw.visit_date;
        const nm = (raw.signing_doctor_name ?? '').trim();
        if (!cid || !vd || !nm) continue; // 미서명/레거시 NULL → 매핑 제외('미정' 처리)
        const key = `${cid}|${vd.slice(0, 10)}`;
        let set = map.get(key);
        if (!set) { set = new Set(); map.set(key, set); }
        set.add(nm);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** 행 → 당일 진료의명. customer_id + 검사일(KST) 조인. 없으면 '미정'(unsigned). 합집합 가나다순. */
function doctorNameForRow(r: KohRow, doctorMap: Map<string, Set<string>> | undefined): string {
  if (!r.customer_id) return '미정';
  const vd = seoulISODate(r.created_at);
  const set = doctorMap?.get(`${r.customer_id}|${vd}`);
  if (!set || set.size === 0) return '미정';
  return [...set].sort((a, b) => a.localeCompare(b, 'ko')).join(', ');
}

// ---------------------------------------------------------------------------
// 발톱부위 저장 — T-20260612-foot-KOH-REPORT-PHASE15 (A). RPC set_koh_nail_sites.
//   check_in_services UPDATE RLS(consultant+) 우회 — 승인 사용자 누구나(치료사 포함) 한 필드만 쓰기.
// ---------------------------------------------------------------------------
function useSaveNailSites(clinicId: string | null, ym: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, sites }: { serviceId: string; sites: NailSite[] }) => {
      const { error } = await supabase.rpc('set_koh_nail_sites', {
        p_service_id: serviceId,
        p_sites: sites,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['koh_report', clinicId, ym] });
    },
    onError: (e: Error) => {
      toast.error(`조갑부위 저장 실패: ${e.message}`);
    },
  });
}

// ---------------------------------------------------------------------------
// 발톱부위 입력 위젯 — KOHSHEET-RENEWAL §C (PHASE15 §A-2 단일선택 위젯 흡수·대체).
//   레이아웃: [좌발] L1 L2 L3 L4 L5  │(구분선)│  [우발] R1 R2 R3 R4 R5  + '조갑' 고정.
//   다중선택(C2): 각 버튼 = 독립 토글. 누르면 {side,toe} 가 배열에 추가/제거(누적). 선택 강조(C3).
//   L→Lt, R→Rt(C1). 저장 shape = PHASE15 canon {side:Lt|Rt, toe:1-5} 구조만(표시문자열 저장 금지).
//   태블릿 동선 — 즉시 저장(별도 저장버튼 없음). 미선택 = 빈배열 저장(허용).
//   ※ current(서버 SSOT) 를 로컬 미러 + useEffect 동기화 → 저장 왕복 중 즉시 반영 + 외부 갱신 흡수.
// ---------------------------------------------------------------------------
const TOES = [1, 2, 3, 4, 5] as const;

/** 좌/우발 라벨(현장 표기) — Lt=좌발, Rt=우발. */
const FEET: { side: NailSide; label: string; prefix: 'L' | 'R' }[] = [
  { side: 'Lt', label: '좌발', prefix: 'L' },
  { side: 'Rt', label: '우발', prefix: 'R' },
];

function NailSiteEditor({
  current,
  saving,
  onCommit,
}: {
  current: NailSite[];
  saving: boolean;
  onCommit: (sites: NailSite[]) => void;
}) {
  // 로컬 미러 — 저장 왕복(invalidate→refetch) 전에도 토글이 즉시 반영. 외부 current 변경은 동기화.
  const [sites, setSites] = useState<NailSite[]>(() => sortNailSites(current));
  useEffect(() => {
    setSites(sortNailSites(current));
  }, [current]);

  const has = (side: NailSide, toe: number) => sites.some((s) => s.side === side && s.toe === toe);

  // 토글 — 있으면 제거, 없으면 추가(다중). 정렬 적용 후 즉시 commit.
  const toggle = (side: NailSide, toe: number) => {
    const exists = has(side, toe);
    const next = sortNailSites(
      exists
        ? sites.filter((s) => !(s.side === side && s.toe === toe))
        : [...sites, { side, toe }],
    );
    setSites(next);
    onCommit(next);
  };

  const btn = (active: boolean) =>
    `inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition disabled:opacity-50 ${
      active
        ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
        : 'border-input bg-background text-foreground hover:bg-accent'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="nail-site-editor">
      {FEET.map((foot, idx) => (
        <div key={foot.side} className="flex items-center gap-1">
          {/* 좌/우발 사이 구분선 */}
          {idx > 0 && <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{foot.label}</span>
          <div className="flex gap-0.5" data-testid={`nail-foot-${foot.prefix}`}>
            {TOES.map((t) => (
              <button
                key={`${foot.prefix}${t}`}
                type="button"
                disabled={saving}
                onClick={() => toggle(foot.side, t)}
                className={btn(has(foot.side, t))}
                aria-pressed={has(foot.side, t)}
                data-testid={`nail-${foot.prefix}${t}`}
              >
                {foot.prefix}{t}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* '조갑' 고정 텍스트 */}
      <span className="text-xs font-medium text-muted-foreground">조갑</span>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KohReportTab — Main
// ---------------------------------------------------------------------------
export default function KohReportTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const [ym, setYm] = useState<string>(currentYearMonthSeoul());
  const [query, setQuery] = useState('');
  const isCurrentMonth = ym === currentYearMonthSeoul();
  const todayISO = todaySeoulISODate();

  // NAILSYNC(AC5): 균검사지 고객차트 열기 — DoctorCallDashboard.openTreatmentChart 패턴 이식.
  //   같은 MedicalChartPanel·같은 진입 동선(clinical 기본 + '본 차트 열기'로 full 전환).
  //   누락이었던 핸들러를 결선(자매 진료호출 대시보드엔 존재, 본 탭엔 부재였음).
  const [medicalChartCustomerId, setMedicalChartCustomerId] = useState<string | null>(null);
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  const [medicalChartVariant, setMedicalChartVariant] = useState<'full' | 'clinical'>('clinical');
  const openTreatmentChart = (customerId: string) => {
    setMedicalChartCustomerId(customerId);
    setMedicalChartVariant('clinical');
    setMedicalChartOpen(true);
  };

  const { data: rows = [], isLoading, isError, error } = useKohReport(clinicId, ym);
  // PHASE15(B): 당일의사 조인 인덱스(월 범위, read-only). PHASE15(A): 발톱부위 저장 mutation.
  const { data: doctorMap } = useKohSigningDoctorsByMonth(clinicId, ym);
  const saveNailSites = useSaveNailSites(clinicId, ym);

  // T-20260611-foot-KOH-REPORT-TAB (AC-1/AC-3): +1일 경과(검사 다음날부터)만 노출.
  //   검사 당일(+1일 미경과) row 는 제외 — isKohExamEligible(검사일 KST < 오늘 KST).
  //   이번 달 조회 시 오늘 검사분이 걸러지고, 과거 달은 전부 경과 → 자연 통과.
  const eligibleRows = useMemo(
    () => rows.filter((r) => isKohExamEligible(r.created_at, todayISO)),
    [rows, todayISO],
  );

  // 이름/차트번호 클라이언트 검색(read-only). 공백 trim, 대소문자 무시.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligibleRows;
    return eligibleRows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.chart_number ?? '').toLowerCase().includes(q),
    );
  }, [eligibleRows, query]);

  return (
    <div className="space-y-4">
      {/* 헤더 + 월 네비게이터 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <FlaskConical className="h-4 w-4 text-teal-600" />
            균검사지 — KOH 진균검사 명단
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            KOH(진균) 검사 후 하루가 지난 환자 명단입니다. 검사일 기준 월별 조회(당일 검사분은 다음날 표시).
          </p>
        </div>

        <div className="flex items-center gap-1" data-testid="koh-month-nav">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => setYm((v) => shiftYearMonth(v, -1))}
            aria-label="이전 달"
            data-testid="koh-prev-month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[88px] text-center text-sm font-semibold text-foreground"
            data-testid="koh-month-label"
          >
            {formatYearMonthKo(ym)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => setYm((v) => shiftYearMonth(v, 1))}
            aria-label="다음 달"
            data-testid="koh-next-month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isCurrentMonth && (
            <Button
              size="sm"
              variant="outline"
              className="ml-1 h-8 px-2 text-[11px]"
              onClick={() => setYm(currentYearMonthSeoul())}
              data-testid="koh-this-month"
            >
              이번 달
            </Button>
          )}
        </div>
      </div>

      {/* 검색 + 건수 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="환자이름 · 차트번호 검색"
            className="h-9 pl-8 text-sm"
            data-testid="koh-search"
          />
        </div>
        <span className="text-xs text-muted-foreground" data-testid="koh-count">
          {formatYearMonthKo(ym)} 검사 <span className="font-semibold text-foreground">{filtered.length}</span>건
          {query.trim() && eligibleRows.length !== filtered.length && (
            <span className="ml-1 text-muted-foreground/70">(전체 {eligibleRows.length}건 중)</span>
          )}
        </span>
      </div>

      {/* 본문 */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-8 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query.trim()
            ? '검색 결과가 없습니다.'
            : `${formatYearMonthKo(ym)}에 검사 후 하루가 지난 KOH 진균검사 명단이 없습니다.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="koh-table">
          <table className="w-full text-sm">
            <thead>
              {/* KOHSHEET-RENEWAL §B: 6컬럼 통일 — 이름/생년/차트/검사일/조갑부위/진료의 */}
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">이름</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">생년</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">차트</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">검사일</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">조갑부위</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">진료의</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition hover:bg-accent/30"
                  data-testid="koh-row"
                >
                  {/* NAILSYNC(AC5): 이름 클릭 → 고객차트(MedicalChartPanel) 열기. customer_id 없으면 비활성 텍스트. */}
                  <td
                    className="px-1.5 py-1 whitespace-nowrap max-w-[8rem]"
                    data-testid="koh-cell-name"
                  >
                    {r.customer_id ? (
                      <button
                        type="button"
                        onClick={() => openTreatmentChart(r.customer_id as string)}
                        className="block max-w-full truncate text-left font-semibold text-teal-700 underline-offset-2 hover:underline focus:underline focus:outline-none"
                        title={`${r.customer_name} · ${r.service_name} — 클릭 시 고객차트 열기`}
                        data-testid="koh-open-chart"
                      >
                        {r.customer_name}
                      </button>
                    ) : (
                      <span
                        className="block truncate font-semibold text-foreground"
                        title={`${r.customer_name} · ${r.service_name}`}
                      >
                        {r.customer_name}
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-1 tabular-nums text-foreground/90 whitespace-nowrap" data-testid="koh-cell-birth">
                    {formatBirthDate(r.birth_date)}
                  </td>
                  <td className="px-1.5 py-1 font-mono text-foreground/90 whitespace-nowrap" data-testid="koh-cell-chart">
                    {r.chart_number || '—'}
                  </td>
                  {/* KOHSHEET-RENEWAL §B2: 검사일 = 날짜만(시간 제거). */}
                  <td className="px-1.5 py-1 tabular-nums text-muted-foreground whitespace-nowrap" data-testid="koh-cell-examdate">
                    {formatExamDate(r.created_at)}
                  </td>
                  {/* PHASE15(A): 발톱부위 + NAILSYNC(AC2/AC3): 치료부위 프리필.
                      AC3 가드 — 균검사지=원장 시술 판단 근거. 조갑부위(koh_nail_sites)가 비어있을 때만
                      치료부위(treatment_sites)로 프리필. 원장이 한 번이라도 입력/저장(nail_sites 非빈)하면
                      그 값이 SSOT가 되어 치료부위 변경이 silent 덮어쓰기 못 함(단방향, AC4).
                      프리필은 표시·편집기 초기값 한정 — 자동 DB 쓰기 없음(원장 명시 토글 시에만 저장). */}
                  {(() => {
                    const prefilled = r.nail_sites.length === 0 && r.treatment_sites.length > 0;
                    const effective = r.nail_sites.length > 0 ? r.nail_sites : r.treatment_sites;
                    return (
                      <td className="px-1.5 py-1" data-testid="koh-cell-nailsite">
                        <div className="space-y-1.5">
                          <span
                            className={`flex items-center gap-1 text-xs font-medium ${
                              effective.length > 0 ? 'text-foreground' : 'text-muted-foreground/60'
                            }`}
                            data-testid="koh-nailsite-text"
                          >
                            {formatNailSites(effective)}
                            {prefilled && (
                              <span
                                className="shrink-0 rounded bg-teal-50 px-1 py-px text-[10px] font-medium text-teal-700"
                                title="고객차트에서 선택한 치료부위가 자동 표시됨(미저장). 버튼을 눌러 확정하세요."
                                data-testid="koh-nailsite-prefill-badge"
                              >
                                치료부위
                              </span>
                            )}
                          </span>
                          <NailSiteEditor
                            current={effective}
                            saving={
                              saveNailSites.isPending && saveNailSites.variables?.serviceId === r.id
                            }
                            onCommit={(sites) => saveNailSites.mutate({ serviceId: r.id, sites })}
                          />
                        </div>
                      </td>
                    );
                  })()}
                  {/* PHASE15(B): 당일 진료의사 — customer_id+검사일 조인. 없으면 '미정'. */}
                  <td
                    className={`px-1.5 py-1 text-xs ${
                      doctorNameForRow(r, doctorMap) === '미정'
                        ? 'text-muted-foreground/60'
                        : 'font-medium text-foreground'
                    }`}
                    data-testid="koh-cell-doctor"
                  >
                    {doctorNameForRow(r, doctorMap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 안내 — PHASE15 범위 명시 + NAILSYNC */}
      <p className="text-[11px] text-muted-foreground/70">
        ※ 검사일(시행일) 기준 월별 명단입니다. 조갑부위는 좌발(L1~L5)·우발(R1~R5) 버튼을 눌러 입력하며 여러 부위를 함께 선택할 수 있습니다(다시 누르면 해제). 고객차트에서 선택한 치료부위가 비어있는 조갑부위에 자동 표시(치료부위 배지)되며, 원장이 입력한 값은 덮어쓰지 않습니다. 환자 이름을 누르면 고객차트가 열립니다. 진료의는 진료차트 서명 기준이며 미서명·차트없음은 '미정'으로 표시됩니다.
      </p>

      {/* NAILSYNC(AC5): 고객차트 — 환자 이름 클릭 시 오픈. DoctorCallDashboard 패턴 이식. */}
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
