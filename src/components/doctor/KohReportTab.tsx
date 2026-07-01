// KohReportTab — 균검사지(KOH 진균검사) 명단 리포트 탭
// Ticket: T-20260611-foot-KOH-REPORT-TAB (Phase 1) + T-20260612-foot-KOH-REPORT-PHASE15 (Phase 1.5)
//         + T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR (균검사지 6컬럼 재정의 + 조갑부위 multi-select)
//         + T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE (발급 권한=전직군 8역할 + 라벨분기 제거: 전직군 단일
//           '발급하기'. reporter=문지은 대표원장 '권한 다 풀어줘'. KOHBTN-ROLE-LABEL 라벨분기 superseded.)
//
// KOH(수산화칼륨) 진균검사를 시행한 환자 명단을 '검사일'(월 단위) 기준으로 조회한다.
// 컬럼(KOHSHEET-RENEWAL §B, 6컬럼 통일): 이름 · 생년 · 차트 · 검사일(날짜만) · 조갑부위 · 진료의
//   ※ Phase 1.5(PHASE15, 3중 게이트 ALL GO): 조갑부위(입력) + 당일의사명(조인) 추가.
//   ※ KOHSHEET-RENEWAL: 검사일 시간 제거(날짜만, B2) + 조갑부위 입력 단일→복수선택 완화(C2).
//
// === KOHSHEET-RENEWAL (T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR) ===
//  B. 6컬럼 재정의 — 헤더 라벨 통일(이름/생년/차트/검사일/조갑부위/진료의). 검사일=날짜만(YYYY-MM-DD, FE 한정).
//  C. 조갑부위 입력 = 좌발 L1~L5 | 우발 R1~R5 toggle, ~~다중선택~~ → **단일선택**(SUPERSEDED).
//     ※ T-20260617-foot-KOHGEN-PUBLISH-SINGLESEL-2FIX(이슈2): reporter(문지은 대표원장) 직접 재정의로
//       §C 다중선택은 단일선택으로 대체. 하나만 선택(다시 누르면 해제), onCommit 배열 ≤1.
//     L→Lt, R→Rt. 저장 shape 는 PHASE15 canon {side:Lt|Rt, toe:1-5} 그대로(DB 무변경, 배열 이미 지원).
//     旣 저장된 레거시 다중값 행 파괴/마이그 없음 — 표시 보존, 발행 시 sites[0]만 사용.
//
// === Phase 1.5 (T-20260612-foot-KOH-REPORT-PHASE15) ===
//  A. 조갑부위 = check_in_services.koh_nail_sites jsonb. 원소 {side:Rt|Lt, toe:1-5}.
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

// T-20260630-foot-KOHEXAM-ISSUE-RELOCATE-TXTABLE [2]: 진료대시보드 균검사지 = READ-ONLY 축소.
//   채취조갑 선택 위젯 + 발급하기/일괄발급/선택 컬럼을 제거하고, ①신청유무 ②채취부위(R1) ③발급여부만
//   보여주는 읽기전용 리스트로 간략화. 발급 '동작'은 치료테이블(ExamTargetsSection)로 이전됨.
//   ※ 발급 field_data 정본 헬퍼(buildKohFieldData 등)는 여기서 export 유지 — ExamTargetsSection 이 재사용(재구현 0).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, FlaskConical, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { parseFootSites, type FootSite } from '@/components/FootSiteSelector';
import MedicalChartPanel from '@/components/MedicalChartPanel';
import KohResultDialog from '@/components/KohResultDialog';

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

// ---------------------------------------------------------------------------
// 일별 보기 — 'YYYY-MM-DD' 날짜 이동/표기 (T-20260629-foot-KOHLIST-INACTIVE-PURGE-DAYMONTH-FILTER, AC-2/AC-3).
//   월 이동(shiftYearMonth)과 동일하게 UTC 정오 기준 — DST/월경계 드리프트 없음.
// ---------------------------------------------------------------------------
/** 'YYYY-MM-DD' 에 deltaDays 더한 날짜(KST 캘린더 일자). */
export function shiftISODate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → 'YYYY년 M월 D일' 표기 */
export function formatDateKo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 생년월일 표시 — DATE/timestamptz 어느 쪽이든 YYYY-MM-DD 10자리만, 결측 '—' */
export function formatBirthDate(birth: string | null | undefined): string {
  if (!birth) return '—';
  const s = String(birth).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || '—';
}

/**
 * 생년(만나이) 표시 — T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT (AC-6).
 *   진료대시보드 균검사지 명단의 '생년(만나이)' 컬럼. 생년월일 전체가 아니라 '생년 + (만 N세)'.
 *   예) '1990-03-15' + 오늘(2026-06-21) → '1990 (36세)'.
 *   만나이 = 오늘(KST, todayISO) 연도 − 생년, 단 올해 생일 미경과면 −1. 결측 '—'.
 *   10자리(YYYY-MM-DD) 정규 + 6자리(YYMMDD) 방어 파싱(formatBirthKo 세기 규칙 동일).
 */
export function formatBirthYearWithAge(
  birth: string | null | undefined,
  todayISO: string,
): string {
  if (!birth) return '—';
  const s = String(birth).trim();
  let by: number, bm: number, bd: number;
  const m10 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m10) {
    by = parseInt(m10[1], 10);
    bm = parseInt(m10[2], 10);
    bd = parseInt(m10[3], 10);
  } else {
    const m6 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (!m6) return s || '—';
    const yy = parseInt(m6[1], 10);
    by = parseInt((yy >= 0 && yy <= 26 ? '20' : '19') + m6[1], 10);
    bm = parseInt(m6[2], 10);
    bd = parseInt(m6[3], 10);
  }
  const tm = todayISO.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!tm) return String(by);
  const ty = parseInt(tm[1], 10);
  const tmo = parseInt(tm[2], 10);
  const td = parseInt(tm[3], 10);
  let age = ty - by;
  if (tmo < bm || (tmo === bm && td < bd)) age -= 1;
  if (age < 0) return String(by); // 미래 생년 등 방어 — 나이 음수면 생년만
  return `${by} (${age}세)`;
}

/**
 * 결과지 표기용 생년월일 — 대표원장 양식 'YYYY년 MM월 DD일'.
 *   T-20260617-foot-KOHGEN-HTMLPORT (AC①): DB DATE(YYYY-MM-DD) 정규 경로 + 6자리(YYMMDD) 방어 파싱.
 *   6자리 세기 추정 = 00~26 → 20xx, 그 외 → 19xx(대표원장 HTML formatBirth 규칙 동일). 결측 ''.
 */
export function formatBirthKo(birth: string | null | undefined): string {
  if (!birth) return '';
  const s = String(birth).trim();
  const m10 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m10) return `${m10[1]}년 ${m10[2]}월 ${m10[3]}일`;
  const m6 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m6) {
    const yy = parseInt(m6[1], 10);
    const prefix = yy >= 0 && yy <= 26 ? '20' : '19';
    return `${prefix}${m6[1]}년 ${m6[2]}월 ${m6[3]}일`;
  }
  return s;
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
// 조갑부위(KOH 검사부위) — T-20260612-foot-KOH-REPORT-PHASE15 (A).
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

/**
 * 컴팩트 표기(2글자) — T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT (§B, AC-2).
 *   진료대시보드 명단 '채취조갑' 컬럼 전용. 'Rt 1지 조갑' → 'R1', 'Lt 5지 조갑' → 'L5'.
 *   R/L(대문자) + 발가락번호(1~5) = 정확히 2글자. '조갑'·'지'·공백 등 부가문자 제거.
 *   ⚠ policy_superseded: PHASE15 canon 풀표기(formatNailSite)는 발급문서 본문 등 타 surface 보존.
 *      본 헬퍼는 진료대시보드 명단 컬럼 표시에 한정(전역 supersede 아님).
 */
export function formatNailSiteShort(site: NailSite): string {
  return `${site.side === 'Rt' ? 'R' : 'L'}${site.toe}`;
}

/**
 * 배열 → 컴팩트 표기(첫 부위만). 단일선택(SINGLESEL)이라 통상 1건, 레거시 다중값은 정렬 후 sites[0].
 *   빈/결측 = '—'. (DB 저장 shape·RPC 무변경 — 표시변환만, 신규 스키마 0.)
 */
export function formatNailSitesShort(sites: NailSite[] | null | undefined): string {
  if (!sites || sites.length === 0) return '—';
  return formatNailSiteShort(sortNailSites(sites)[0]);
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
  id: string;                    // check_in_services.id (= KOH 검사 인스턴스, 조갑부위 귀속 키)
  service_name: string;
  created_at: string;            // 검사일(UTC timestamptz)
  customer_id: string | null;    // PHASE15(B): 당일의사 조인 키(+visit_date)
  customer_name: string;         // 표기명 — customers.name 우선, fallback check_ins.customer_name
  birth_date: string | null;     // 생년월일
  chart_number: string | null;   // 차트번호
  nail_sites: NailSite[];        // PHASE15(A): 조갑부위(koh_nail_sites jsonb 파생)
  treatment_sites: NailSite[];   // NAILSYNC(AC1): 치료부위(treatment_memo.foot_site → L→Lt/R→Rt 정규화 미러)
  koh_requested: boolean;        // LIFECYCLE(AC-1/AC-2): KOH 신청 플래그. true=active(신청)/false=inactive(미신청·취소)
  therapist_id: string | null;   // PUBLISH-BTN-REVERIFY-GATE(AC-4): 배정 치료사(check_ins.therapist_id, read-only). 발급 enable-gate '치료사 배정됨' 판정용 — 신규 스키마 0(기존 컬럼).
}

// ---------------------------------------------------------------------------
// 목록 표시 필터 — T-20260629-foot-KOHLIST-INACTIVE-PURGE-DAYMONTH-FILTER.
//   (AC-1/AC-4) 비활성(미신청 = koh_requested false) 건은 기본 목록에서 제외. '비활성 포함' 토글 ON 시 전부 노출.
//     ⚠ 표시 제외만 — DB DELETE 없음(레코드 100% 보존, 토글 OFF→ON 재조회 시 다시 보임).
//   (AC-2/AC-3) 일별 보기 = 선택 일자(KST) 검사분만, 월별 보기 = 해당 월 전체(월 쿼리 그대로).
// ---------------------------------------------------------------------------
export type KohViewMode = 'day' | 'month';

/** 비활성(미신청) 제외 — includeInactive=true면 전부 통과(표시 제외만, 데이터 보존). */
export function filterKohActive<T extends { koh_requested: boolean }>(rows: T[], includeInactive: boolean): T[] {
  return includeInactive ? rows : rows.filter((r) => r.koh_requested);
}

/** 일별 일자 매칭 — 검사일(created_at, UTC)의 KST 캘린더 일자 === selectedDate('YYYY-MM-DD'). */
export function isKohOnSelectedDay(createdAt: string | null | undefined, selectedDate: string): boolean {
  if (!createdAt) return false;
  return seoulISODate(createdAt) === selectedDate;
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

      // PHASE15: koh_nail_sites(조갑부위) + check_ins.customer_id(당일의사 조인키) 추가.
      //   ⚠ FE-DB 순서 안전장치: koh_nail_sites 컬럼이 아직 없으면(마이그 적용 전 prod 도달 시)
      //     select 가 42703(컬럼없음)으로 실패 → 기존 Phase1 탭이 깨진다. column-missing 감지 시
      //     koh_nail_sites 제외 select 로 1회 폴백(조갑부위는 빈값). 마이그 적용 후 자동 활성.
      // NAILSYNC(AC1/AC2): check_ins.treatment_memo 동봉 → 치료부위(foot_site) 미러 소스.
      //   treatment_memo 는 既존 jsonb 컬럼(신규 컬럼 0). 균검사지에서 치료부위 선택분을 프리필.
      // LIFECYCLE(AC-1/AC-2): koh_requested(신청 플래그) 추가. koh_nail_sites 와 동일 column-missing 폴백 대상.
      // PUBLISH-BTN-REVERIFY-GATE(AC-4): check_ins.therapist_id(기존 컬럼, read-only) 동봉 — 발급 enable-gate '치료사 배정됨' 판정. 신규 스키마 0.
      const SELECT_WITH = 'id, service_name, created_at, koh_nail_sites, koh_requested, check_ins!inner(clinic_id, customer_id, customer_name, therapist_id, treatment_memo, customers(name, birth_date, chart_number))';
      const SELECT_WITHOUT = 'id, service_name, created_at, check_ins!inner(clinic_id, customer_id, customer_name, therapist_id, treatment_memo, customers(name, birth_date, chart_number))';
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
          | { customer_id?: string | null; customer_name?: string | null; therapist_id?: string | null; treatment_memo?: unknown; customers?: unknown }
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
          therapist_id: ci?.therapist_id ?? null, // AC-4: 배정 치료사(read-only). null=미배정 → 발급 비활성.
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

// ---------------------------------------------------------------------------
// 생년월일 서버 파생 fallback — T-20260623-foot-KOHDOC-BIRTHDATE-FROM-RRN-FALLBACK.
//   customers.birth_date NULL 다수(윤민희 등 prod) → hard-block 으로 균검사지 발행 불가 환자 실발생.
//   이미 prod 배포된 fn_customer_birthdates RPC(birth_date 우선, NULL이면 rrn 세기코드 파생, migration
//   20260613120000) 파생값을 FE fallback 으로 적용. DB 무변경·read-only·REUSE.
//   PHI: birth_date_display(파생 표시값)만 수신 — 평문 RRN 은 클라에 미노출(Customers.loadCustomerStats 동일 패턴).
//   청크 IN(URL 길이 한계 회피, Customers.tsx L141 미러). RPC 실패는 fallback 미적용(정규 경로 유지·비차단).
// ---------------------------------------------------------------------------
const BIRTH_CHUNK = 200;
function useKohBirthdates(clinicId: string | null, rows: KohRow[]) {
  // 명단 행의 customer_id 고유집합(정렬) — queryKey 안정화 + 중복 호출 방지.
  const ids = useMemo(
    () => [...new Set(rows.map((r) => r.customer_id).filter((v): v is string => !!v))].sort(),
    [rows],
  );
  return useQuery<Map<string, string>>({
    queryKey: ['koh_birthdates', clinicId, ids],
    enabled: !!clinicId && ids.length > 0,
    queryFn: async () => {
      const birthMap = new Map<string, string>();
      if (!clinicId || ids.length === 0) return birthMap;
      for (let i = 0; i < ids.length; i += BIRTH_CHUNK) {
        const chunk = ids.slice(i, i + BIRTH_CHUNK);
        const { data, error } = await supabase.rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: chunk });
        if (error) continue; // RPC 실패 청크는 건너뜀 — 정규 birth_date 경로 유지(발행 흐름 비차단).
        for (const row of (data ?? []) as { customer_id: string; birth_date_display: string | null }[]) {
          if (row.birth_date_display) birthMap.set(row.customer_id, row.birth_date_display);
        }
      }
      return birthMap;
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

// RELOCATE[2]: 조갑부위 저장(useSaveNailSites) RPC 훅은 치료테이블(ExamTargetsSection)로 이전.
//   진료대시보드 균검사지는 read-only 이므로 여기서는 조갑부위를 저장하지 않는다(표시만).

// ---------------------------------------------------------------------------
// 발행 결과지 인덱스 — T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-3/AC-5).
//   koh_result 템플릿의 published form_submissions 를 koh_service_id(=check_in_services.id)로 인덱싱.
//   행이 이미 발행됐는지 판정(버튼 비활성·발행완료 표시) + 결과지 인쇄(field_data) 소스.
//   템플릿(마이그) 미적용 시 빈 맵 폴백 — 발행기능 비활성(에러 미표출).
// ---------------------------------------------------------------------------
function usePublishedKoh(clinicId: string | null) {
  return useQuery<Map<string, PublishedKoh>>({
    queryKey: ['koh_published', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, PublishedKoh>();
      if (!clinicId) return map;
      const { data: tpl } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'koh_result')
        .limit(1)
        .maybeSingle();
      if (!tpl?.id) return map; // 마이그 미적용 → 발행기능 비활성 폴백
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('template_id', tpl.id)
        .eq('status', 'published');
      if (error) throw error;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
        const sid = String(fd['koh_service_id'] ?? '');
        if (!sid) continue;
        map.set(sid, {
          id: String(r['id']),
          koh_service_id: sid,
          request_no: String(fd['request_no'] ?? ''),
          field_data: fd,
          created_at: String(r['created_at'] ?? ''),
        });
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * 발행 RPC 전달용 field_data 구성 — 정본 양식(검사결과지 양식.png) FE 표시필드.
 *   의뢰번호/검체번호/의뢰기관/koh_service_id 는 RPC(publish_koh_result)에서 채워 병합(자동채번·고정값).
 *   검사결과 라인(KOH mount Hyphae/Yeast)은 양식 고정값(AC-3 동일결과) → 템플릿 HTML에 고정, 여기 미포함.
 *   검체번호(specimen_no) = RPC 자동채번 K+YYMMDD-폰뒷4(T-20260616-KOH-SPECIMENNO-FORMAT). FE 빈값은 RPC override.
 */
export function buildKohFieldData(r: KohRow, doctorName: string, birthOverride?: string | null): Record<string, string> {
  // SINGLESEL-2FIX(이슈2): 조갑부위 = 단일선택. 신규 입력은 ≤1건이지만,
  //   旣 저장된 레거시 다중값 행은 파괴/마이그 없이 보존하되 '발행 시 sites[0]만' 사용(planner 지시).
  //   formatNailSites 는 정렬 후 join → slice(0,1)로 첫 부위(정렬 기준 좌발 우선)만 검체종류에 기재.
  const primaryType = formatNailSites(r.nail_sites.slice(0, 1));
  return {
    doctor_name: doctorName === '미정' ? '' : doctorName,
    patient_name: r.customer_name === '—' ? '' : r.customer_name,
    chart_number: r.chart_number ?? '',
    // HTMLPORT(AC①): 대표원장 양식 'YYYY년 MM월 DD일'(6자리 방어 파싱 포함).
    // BIRTHDATE-FROM-RRN-FALLBACK(AC①/AC③): 정규 birth_date 우선, NULL이면 파생값(birthOverride).
    //   정규값이 있으면 birthOverride 가 와도 r.birth_date 가 먼저 — 파생값이 정규값 미덮음(회귀0).
    birth_date: formatBirthKo(r.birth_date || birthOverride || null),
    remark: '',
    collected_date: formatDocDate(r.created_at),
    requested_date: formatDocDate(r.created_at),
    specimen_type: primaryType === '—' ? '' : primaryType,
    specimen_no: '',
  };
}

// RELOCATE[2]: 결과지 발행 mutation(usePublishKoh)·조갑부위 입력 위젯(NailSiteEditor)은
//   치료테이블(ExamTargetsSection)로 이전. 진료대시보드 균검사지는 read-only 이므로 발급/입력 동작 없음.
//   ※ buildKohFieldData(위)는 export 유지 — 치료테이블 발급이 정본 field_data 를 재사용(재구현 0).

// ---------------------------------------------------------------------------
// KohReportTab — Main
// ---------------------------------------------------------------------------
export default function KohReportTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  // RELOCATE[2]: 발급 권한 게이트(canIssue)·발급 라벨(pubNoun)은 발급 동작이 치료테이블로 이전되며 제거.
  //   진료대시보드 균검사지는 read-only(발급 액션 없음)이므로 발급 권한 판정이 불필요하다.

  // ── T-20260629-foot-KOHLIST-INACTIVE-PURGE-DAYMONTH-FILTER ──
  //   (AC-2) 일별/월별 보기 토글 — 첫 진입 기본 = 일별(선택 일자 = 오늘).
  //   (AC-1) 비활성(미신청) 포함 토글 — 기본 OFF(비활성 제외). 표시 제외만, DELETE 없음(AC-4).
  const [viewMode, setViewMode] = useState<KohViewMode>('day');
  const [selectedDate, setSelectedDate] = useState<string>(todaySeoulISODate());
  const [includeInactive, setIncludeInactive] = useState(false);
  const [ym, setYm] = useState<string>(currentYearMonthSeoul());
  const [query, setQuery] = useState('');
  const todayISO = todaySeoulISODate();
  // 데이터 쿼리 기준 월 — 일별 보기면 선택 일자의 월, 월별 보기면 ym. (월 단위 1쿼리 후 일자 필터는 클라.)
  const queryYm = viewMode === 'day' ? selectedDate.slice(0, 7) : ym;
  const isCurrentMonth = ym === currentYearMonthSeoul();
  const isToday = selectedDate === todayISO;
  const periodLabel = viewMode === 'day' ? formatDateKo(selectedDate) : formatYearMonthKo(ym);

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

  const { data: rows = [], isLoading, isError, error } = useKohReport(clinicId, queryYm);
  // PHASE15(B): 당일의사 조인 인덱스(월 범위, read-only) — 진료의 컬럼 표시.
  const { data: doctorMap } = useKohSigningDoctorsByMonth(clinicId, queryYm);
  // BIRTHDATE-FROM-RRN-FALLBACK: 생년월일 서버 파생 인덱스(customer_id → birth_date_display). read-only 생년 표기.
  const { data: birthMap } = useKohBirthdates(clinicId, rows);
  /** 행의 유효 생년 — 정규 birth_date 우선, NULL이면 RRN 파생값. 둘 다 결측이면 null. (read-only 생년 표기용) */
  const effectiveBirth = (r: KohRow): string | null => r.birth_date || (r.customer_id ? birthMap?.get(r.customer_id) ?? null : null);

  // 발행 인덱스(read-only) — RELOCATE[2]: 발급여부(발행완료/미발행)만 표시. 발급 동작(publish/bulk/select)은 치료테이블로 이전.
  const { data: publishedMap } = usePublishedKoh(clinicId);

  // HTMLPORT: 결과지 미리보기 다이얼로그 — 발행완료 행 '💾 발행완료' 버튼으로 결과보고서 보기(read).
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);

  // T-20260611-foot-KOH-REPORT-TAB (AC-1/AC-3): +1일 경과(검사 다음날부터)만 노출.
  //   검사 당일(+1일 미경과) row 는 제외 — isKohExamEligible(검사일 KST < 오늘 KST).
  //   이번 달 조회 시 오늘 검사분이 걸러지고, 과거 달은 전부 경과 → 자연 통과.
  const eligibleRows = useMemo(
    () => rows.filter((r) => isKohExamEligible(r.created_at, todayISO)),
    [rows, todayISO],
  );

  // KOHLIST-INACTIVE-PURGE-DAYMONTH-FILTER: 검색 전 단계 — (AC-1/AC-4) 비활성 제외 + (AC-2/AC-3) 일별/월별 범위.
  //   비활성 제외는 표시 필터일 뿐 DB 미변경(데이터 보존). 일별=선택 일자 검사분만, 월별=eligible 월 전체.
  const scopedRows = useMemo(() => {
    const active = filterKohActive(eligibleRows, includeInactive);
    return viewMode === 'day'
      ? active.filter((r) => isKohOnSelectedDay(r.created_at, selectedDate))
      : active;
  }, [eligibleRows, includeInactive, viewMode, selectedDate]);

  // 이름/차트번호 클라이언트 검색(read-only). 공백 trim, 대소문자 무시.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedRows;
    return scopedRows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.chart_number ?? '').toLowerCase().includes(q),
    );
  }, [scopedRows, query]);

  // RELOCATE[2]: 일괄발행 대상 집합·선택(select-all/one)·발급 라벨은 발급 동작이 치료테이블로 이전되며 제거.
  //   진료대시보드 균검사지는 read-only 리스트(신청유무·채취부위·발급여부)만 보여준다.

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
            KOH(진균) 검사 후 하루가 지난 환자 명단입니다. 검사일 기준 일별/월별 조회(당일 검사분은 다음날 표시). 신청유무·채취부위·발급여부를 확인하는 <strong className="text-foreground/80">읽기전용</strong> 리스트입니다(채취조갑 선택·발급하기는 <strong className="text-foreground/80">치료 테이블</strong>의 ‘균검사 &amp; 피검사 대상자’에서). 비활성(미신청) 건은 기본 제외됩니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* AC-2: 일별/월별 보기 토글 — 첫 진입 기본 = 일별. 기존 월 네비/검색 UI와 teal 톤 일관. */}
          <div
            className="inline-flex overflow-hidden rounded-md border"
            role="group"
            aria-label="보기 단위"
            data-testid="koh-view-toggle"
          >
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`h-8 px-3 text-xs font-semibold transition ${
                viewMode === 'day'
                  ? 'bg-teal-600 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              }`}
              aria-pressed={viewMode === 'day'}
              data-testid="koh-view-day"
            >
              일별
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`h-8 border-l px-3 text-xs font-semibold transition ${
                viewMode === 'month'
                  ? 'bg-teal-600 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              }`}
              aria-pressed={viewMode === 'month'}
              data-testid="koh-view-month"
            >
              월별
            </button>
          </div>

          {/* AC-3: 보기 단위에 맞춘 네비게이터 — 일별=일자 이동, 월별=월 이동. */}
          {viewMode === 'day' ? (
            <div className="flex items-center gap-1" data-testid="koh-day-nav">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => setSelectedDate((v) => shiftISODate(v, -1))}
                aria-label="이전 날"
                data-testid="koh-prev-day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span
                className="min-w-[120px] text-center text-sm font-semibold text-foreground"
                data-testid="koh-day-label"
              >
                {formatDateKo(selectedDate)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => setSelectedDate((v) => shiftISODate(v, 1))}
                aria-label="다음 날"
                data-testid="koh-next-day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isToday && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-1 h-8 px-2 text-[11px]"
                  onClick={() => setSelectedDate(todayISO)}
                  data-testid="koh-today"
                >
                  오늘
                </Button>
              )}
            </div>
          ) : (
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
        <div className="flex items-center gap-2">
          {/* AC-1/AC-4: 비활성(미신청) 포함 보기 — 기본 OFF(비활성 제외). 표시 제외만, DB DELETE 없음(데이터 보존). */}
          <label
            className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="koh-include-inactive-label"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-teal-600"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              data-testid="koh-include-inactive"
            />
            비활성 포함
          </label>
          {/* RELOCATE[2]: 일괄발급(koh-bulk-publish) 버튼은 발급 동작이 치료테이블로 이전되며 제거(read-only). */}
          <span className="text-xs text-muted-foreground" data-testid="koh-count">
            {periodLabel} 검사 <span className="font-semibold text-foreground">{filtered.length}</span>건
            {query.trim() && scopedRows.length !== filtered.length && (
              <span className="ml-1 text-muted-foreground/70">(전체 {scopedRows.length}건 중)</span>
            )}
          </span>
        </div>
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
            : `${periodLabel}에 검사 후 하루가 지난 KOH 진균검사 명단이 없습니다.${includeInactive ? '' : ' (비활성 건은 제외 — 보려면 "비활성 포함")'}`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="koh-table">
          <table className="w-full text-sm">
            <thead>
              {/* RELOCATE[2]: read-only 리스트 — 이름·생년(만나이)·차트번호·채취부위·진료의·신청유무·발급여부.
                  선택(일괄발행) 컬럼·채취조갑 입력 위젯·발급 버튼은 제거(발급 동작은 치료테이블로 이전). */}
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">이름</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">생년(만나이)</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">차트번호</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">채취부위</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">진료의</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">신청유무</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">발급여부</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const published = publishedMap?.get(r.id);
                return (
                <tr
                  key={r.id}
                  className={`border-b last:border-0 transition hover:bg-accent/30 ${
                    r.koh_requested ? '' : 'opacity-55'
                  }`}
                  data-testid="koh-row"
                  data-koh-active={r.koh_requested ? 'true' : 'false'}
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
                  {/* 4FIX 이슈1(생년): AC-0 선조사 = 바인딩 정상이나 prod birth_date NULL 다수(데이터 부재).
                      생년 누락 시 '미입력' 경고 배지 — 발급 차단(이슈3) 사유를 명단에서 바로 인지. */}
                  <td className="px-1.5 py-1 tabular-nums text-foreground/90 whitespace-nowrap" data-testid="koh-cell-birth">
                    {effectiveBirth(r) ? (
                      // AC-6: '생년 + (만 N세)' 표기(예 1990 (36세)). 만나이=오늘(KST) 기준 생일 경과 계산.
                      // BIRTHDATE-FROM-RRN-FALLBACK(AC①): 정규 birth_date 결측 시 RRN 파생값으로 명단 생년 표기.
                      formatBirthYearWithAge(effectiveBirth(r), todayISO)
                    ) : (
                      <span
                        className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                        title="생년월일 미입력 — 고객 정보에서 입력해야 발급 가능"
                        data-testid="koh-birth-missing"
                      >
                        미입력
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-1 font-mono text-foreground/90 whitespace-nowrap" data-testid="koh-cell-chart">
                    {r.chart_number || '—'}
                  </td>
                  {/* RELOCATE[2]: 채취부위 — READ-ONLY 표기(컴팩트 R1). NAILFMT 포맷 재사용(재구현 0).
                      입력 위젯(NailSiteEditor)은 치료테이블로 이전 — 여기서는 저장값을 보기만 한다.
                      저장값(nail_sites) 우선, 미저장이면 치료부위(treatment_sites) 참고 표기(수정 불가). */}
                  {(() => {
                    const effective = r.nail_sites.length > 0 ? r.nail_sites : r.treatment_sites;
                    return (
                      <td className="px-1.5 py-1" data-testid="koh-cell-nailsite">
                        <span
                          className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${
                            effective.length > 0 ? 'text-foreground' : 'text-muted-foreground/60'
                          }`}
                          data-testid="koh-nailsite-text"
                          title={effective.length > 0 ? formatNailSites(effective) : undefined}
                        >
                          {formatNailSitesShort(effective)}
                        </span>
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
                  {/* AC-2: KOH 신청 상태 — active(신청)/inactive(미신청). OFF=행 유지·회색(위 opacity). */}
                  <td className="px-1.5 py-1 text-center whitespace-nowrap" data-testid="koh-cell-status">
                    {r.koh_requested ? (
                      <span className="inline-flex items-center rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700" data-testid="koh-status-active">
                        신청
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid="koh-status-inactive">
                        미신청
                      </span>
                    )}
                  </td>
                  {/* RELOCATE[2]: 발급여부 — READ-ONLY. 발행완료 = '💾 발행완료'(클릭 시 결과보고서 보기, read),
                      미발행 = '미발행' 텍스트. 발급하기/일괄발급 버튼은 치료테이블로 이전(여기서 발급 액션 없음). */}
                  <td className="px-1.5 py-1 text-center whitespace-nowrap" data-testid="koh-cell-publish">
                    {published ? (
                      <button
                        type="button"
                        onClick={() => setPreviewData(published.field_data)}
                        className="inline-flex items-center gap-0.5 rounded text-[11px] font-semibold text-emerald-700 hover:underline focus:underline focus:outline-none"
                        title={`의뢰번호 ${published.request_no} — 클릭 시 결과보고서 보기`}
                        data-testid="koh-published-btn"
                      >
                        💾 발행완료
                      </button>
                    ) : (
                      <span
                        className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        data-testid="koh-unpublished"
                      >
                        미발행
                      </span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 안내 — RELOCATE[2]: read-only 리스트(신청유무·채취부위·발급여부). 발급/입력은 치료테이블로 이전. */}
      <p className="text-[11px] text-muted-foreground/70">
        ※ 검사일(시행일) 기준 <strong className="text-foreground/80">읽기전용</strong> 명단입니다. 상단 <strong className="text-foreground/80">일별/월별</strong> 토글로 보기 단위를 바꿀 수 있으며(첫 진입은 일별), <strong className="text-foreground/80">비활성(미신청)</strong> 건은 기본 제외됩니다(목록에서만 숨김 — 삭제 아님, "비활성 포함"을 켜면 다시 표시). 각 행은 <strong className="text-foreground/80">신청유무</strong>(2번차트 패키지 탭의 KOH 신청 토글 ON=신청/OFF=미신청·회색), <strong className="text-foreground/80">채취부위</strong>(치료 테이블에서 선택한 조갑부위, 예: R1), <strong className="text-foreground/80">발급여부</strong>(발행완료/미발행)를 보여줍니다. 환자 이름을 누르면 고객차트가 열리며, 진료의는 진료차트 서명 기준(미서명·차트없음은 '미정')입니다. <strong className="text-foreground/80">채취조갑 선택과 발급하기는 치료 테이블의 ‘균검사 &amp; 피검사 대상자’</strong>에서 진행합니다. 발급 완료된 행은 <strong className="text-foreground/80">💾 발행완료</strong> 버튼을 누르면 결과보고서를 다시 볼 수 있습니다.
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

      {/* HTMLPORT: 결과지 미리보기 + 출력/복사/저장(PNG). 발행 직후 + 발행완료 행 '보기' 진입점 공유. */}
      <KohResultDialog
        open={previewData !== null}
        onOpenChange={(v) => { if (!v) setPreviewData(null); }}
        fieldData={previewData}
      />
    </div>
  );
}
