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

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { canIssueKoh } from '@/lib/permissions';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, FlaskConical, ChevronLeft, ChevronRight, Search, FileCheck2 } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// 조갑부위 저장 — T-20260612-foot-KOH-REPORT-PHASE15 (A). RPC set_koh_nail_sites.
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

// ---------------------------------------------------------------------------
// 결과지 발행 mutation — T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4/AC-5).
//   publish_koh_result RPC(비가역·자동채번·published insert). 성공 시 발행 인덱스 invalidate.
//   반환 = {id, request_no, specimen_no}. 단건 발행 후 결과지 인쇄에 request_no 병합 사용.
// ---------------------------------------------------------------------------
function usePublishKoh(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, fieldData }: { serviceId: string; fieldData: Record<string, string> }) => {
      const { data, error } = await supabase.rpc('publish_koh_result', {
        p_check_in_service_id: serviceId,
        p_field_data: fieldData,
      });
      if (error) throw error;
      return data as { id: string; request_no: string; specimen_no: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['koh_published', clinicId] });
    },
  });
}

// ---------------------------------------------------------------------------
// 조갑부위 입력 위젯 — T-20260617-foot-KOHGEN-PUBLISH-SINGLESEL-2FIX (이슈2, 단일선택).
//   ※ reporter(문지은 대표원장) 직접 재정의 — KOHSHEET-RENEWAL §C 다중선택(multi)은 superseded.
//   레이아웃: [좌발] L1 L2 L3 L4 L5  │(구분선)│  [우발] R1 R2 R3 R4 R5  + '조갑' 고정.
//   단일선택: 각 버튼 = 라디오형 토글. 다른 부위 누르면 기존 해제 후 새 부위 1개만. 같은 부위 다시 누르면 해제(빈배열).
//   onCommit 배열 = 최대 1개. L→Lt, R→Rt. 저장 shape = canon {side:Lt|Rt, toe:1-5}(표시문자열 저장 금지).
//   旣 저장된 레거시 다중값 행은 파괴/마이그 없음 — 표시는 그대로(초기 current), 사용자가 누르는 순간 단일로 수렴.
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
  // 단일선택의 '선택됨' 강조 — sites 가 정확히 이 부위 1개일 때만 active(레거시 다중값은 수렴 전까지 다중 강조 허용).
  const isOnly = (side: NailSide, toe: number) =>
    sites.length === 1 && sites[0].side === side && sites[0].toe === toe;

  // 토글(단일선택, SINGLESEL-2FIX) — 다른 부위 누르면 기존 전부 해제 후 그 부위 1개만.
  //   현재 선택이 정확히 그 부위 1개면 다시 누른 것 → 해제(빈배열). onCommit 배열 = 최대 1개.
  const toggle = (side: NailSide, toe: number) => {
    const next: NailSite[] = isOnly(side, toe) ? [] : [{ side, toe }];
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

  // ── T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE: 라벨분기 제거 — 전직군 단일 '발급하기' ──
  //   reporter(문지은 대표원장, U0ALGAAAJAV) 직접 지시 "발급하기 권한 싹 풀어줘"로 KOHBTN-ROLE-LABEL-VALIDGATE
  //   라벨분기(의사='발급하기'/직원='발급요청', f600d896)를 제거. director 포함 전8역할 단일 '발급하기'.
  //   '발급요청'·'일괄발급요청' 라벨/문구는 폐기 — pubNoun 도 전직군 '발급'으로 통일(confirm/toast 문장용).
  //   실제 동작(publish_koh_result RPC, 서버측 게이트=is_approved_user)은 역할 무관 동일(무변경).
  const pubNoun = '발급';

  // ── T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE: 발급 버튼 노출/활성 대상(WHO) = 전직군(8역할) ──
  //   reporter(문지은 대표원장, U0ALGAAAJAV) 직접 지시 "권한 다 풀어줘 모든 직군 가능" → KOH_ISSUE_ROLES 전8역할.
  //   ★supersedes GRANT-3ROLE(4역할)·KOH-ISSUE-PERMISSION-SPEC(director 전용)★ — canIssue 로 노출/활성 게이트.
  //   라벨 분기는 제거됨(전직군 '발급하기'). canIssue 는 /admin/doctor-tools 라우트 가드 8역할과 동일 집합.
  const canIssue = canIssueKoh(profile?.role ?? '');

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
  // PHASE15(B): 당일의사 조인 인덱스(월 범위, read-only). PHASE15(A): 조갑부위 저장 mutation.
  const { data: doctorMap } = useKohSigningDoctorsByMonth(clinicId, ym);
  // BIRTHDATE-FROM-RRN-FALLBACK: 생년월일 서버 파생 인덱스(customer_id → birth_date_display). read-only.
  const { data: birthMap } = useKohBirthdates(clinicId, rows);
  /** 행의 유효 생년 — 정규 birth_date 우선, NULL이면 RRN 파생값. 둘 다 결측이면 null(AC-2 hard-block 보존). */
  const effectiveBirth = (r: KohRow): string | null => r.birth_date || (r.customer_id ? birthMap?.get(r.customer_id) ?? null : null);
  const saveNailSites = useSaveNailSites(clinicId, ym);

  // LIFECYCLE(AC-3/AC-4/AC-5): 발행 인덱스 + 발행 mutation + 일괄선택.
  const { data: publishedMap } = usePublishedKoh(clinicId);
  const publishKoh = usePublishKoh(clinicId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);

  // HTMLPORT: 결과지 미리보기/출력·복사·저장 다이얼로그. 발행 직후 + 발행완료 행 인쇄 진입점이 공유.
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);

  /** 발행 여부 — published 인덱스에 koh_service_id(=row.id) 존재. */
  const isPublished = (id: string) => publishedMap?.has(id) ?? false;
  /** 발행 가능 — 채취 조갑부위(저장값) 있고(AC-3) + 환자 생년월일 있고(4FIX 이슈3, hard-block) + 아직 미발행.
   *  4FIX 이슈3(의료문서 정확성): AC-0 선조사 결과 윤민희 등 prod birth_date NULL 다수 → 생년 누락 상태
   *  발행 차단. 2FIX 이슈1(발행불가도 탭 가능 + 사유 toast) 위에 hard-block 강화(policy_superseded).
   *  BACTCHECK-PUBLISH-THERAPIST(AC-1, 문지은 대표원장 2026-06-29 A안): 담당 치료사 배정 조건(therapist_id) 제거.
   *    → PUBLISH-BTN-REVERIFY-GATE AC-4(치료사 필수)를 정책 owner 본인이 철회. 치료사 미배정(박민석류)도 즉시 발행 가능.
   *    게이트는 nail_sites + 생년월일 둘만 남김(누락 시에만 차단). */
  //  BIRTHDATE-FROM-RRN-FALLBACK(AC①): 생년 게이트는 effectiveBirth(정규 birth_date || RRN 파생값) 기준.
  const canPublish = (r: KohRow) => r.nail_sites.length > 0 && !!effectiveBirth(r) && !isPublished(r.id);

  // 단건 발행(AC-5 confirm 가드 — 비가역) → 성공 시 결과지 인쇄.
  //   SINGLESEL-2FIX(이슈1): 발행 불가 시 silent return 금지 — 태블릿엔 hover 툴팁이 없어 버튼이
  //   '먹통'으로 보였음(현장 "발행 버튼 동작 안 함" RC). 사유를 toast 로 명시해 다음 행동을 안내한다.
  const handlePublish = async (r: KohRow) => {
    if (isPublished(r.id)) return; // 이미 발행 — 발행완료 분기에서 버튼 자체가 없음(도달 불가 방어).
    if (r.nail_sites.length === 0) {
      toast.error(
        r.treatment_sites.length > 0
          ? `표시된 치료부위는 아직 저장되지 않았습니다. 조갑부위 버튼을 눌러 확정한 뒤 ${pubNoun}해주세요.`
          : `채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 ${pubNoun}할 수 있습니다.`,
      );
      return;
    }
    // 4FIX 이슈3(hard-block, 의료문서 정확성): 환자 생년월일 누락 시 발행 차단.
    //   AC-0 선조사: customers.birth_date NULL 다수(윤민희 등) → 생년 없는 결과보고서 발행 금지.
    //   2FIX 사유 toast 패턴 재사용 — 다음 행동(고객정보 생년월일 입력) 안내.
    //   BIRTHDATE-FROM-RRN-FALLBACK(AC②): 정규 birth_date 와 RRN 파생값이 둘 다 결측일 때만 차단(hard-block 보존).
    if (!effectiveBirth(r)) {
      toast.error(`환자 생년월일 정보가 없어 ${pubNoun}할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.`);
      return;
    }
    // BACTCHECK-PUBLISH-THERAPIST(AC-2, 문지은 대표원장 2026-06-29 A안): 담당 치료사 미배정 차단 분기 제거.
    //   PUBLISH-BTN-REVERIFY-GATE AC-4(therapist 필수)를 정책 owner 본인이 철회 — 치료사 미배정도 발행 가능.
    if (!window.confirm(`${r.customer_name} 님의 검사결과 보고서를 ${pubNoun}하시겠습니까?\n\n${pubNoun} 후에는 수정·취소할 수 없습니다(비가역).`)) return;
    const doctorName = doctorNameForRow(r, doctorMap);
    const fieldData = buildKohFieldData(r, doctorName, effectiveBirth(r));
    try {
      await publishKoh.mutateAsync({ serviceId: r.id, fieldData });
      // KOHREPORT-PUBLISH-TOAST: 발행 성공 직후 자동 미리보기 팝업(setPreviewData) 제거 → 토스트 피드백으로 교체.
      //   reporter(문지은 대표원장) 요구 — 발급 클릭마다 뜨던 확인/미리보기 다이얼로그가 동선 방해.
      //   미리보기는 발행완료 행의 '💾 발행완료' 버튼(보기, line ~1152)으로 사용자가 의도적으로 열도록 보존(절대 제거 금지).
      //   문구 = {환자명} {차트번호} 발행완료. 자동 소멸 toast.success(sonner 재사용).
      toast.success([r.customer_name, r.chart_number].filter(Boolean).join(' ') + ' 발행완료');
    } catch (e) {
      toast.error(`발행 실패: ${(e as Error).message}`);
    }
  };

  // 일괄 발행(AC-3: 발행 동작만 일괄, 결과값 개별입력 없음) — 선택분 순차 발행. 인쇄는 미발화(다중 창 방지).
  //   BULK-PUBLISH(AC-4 부분실패): 성공건은 발행완료로 자연 제외, 실패건은 선택 유지 → 재시도 가능. 전체 롤백 아님.
  const handleBulkPublish = async () => {
    const targets = filtered.filter((r) => selected.has(r.id) && canPublish(r));
    if (targets.length === 0) return;
    if (!window.confirm(`선택한 ${targets.length}건의 검사결과 보고서를 일괄 ${pubNoun}하시겠습니까?\n\n${pubNoun} 후에는 수정·취소할 수 없습니다(비가역).`)) return;
    setBulkPublishing(true);
    let ok = 0;
    let fail = 0;
    const failedIds = new Set<string>();
    for (const r of targets) {
      try {
        const doctorName = doctorNameForRow(r, doctorMap);
        await publishKoh.mutateAsync({ serviceId: r.id, fieldData: buildKohFieldData(r, doctorName, effectiveBirth(r)) });
        ok += 1;
      } catch {
        fail += 1;
        failedIds.add(r.id); // AC-4: 실패 건 식별 — 선택 유지해 재시도 가능하게.
      }
    }
    setBulkPublishing(false);
    // AC-4: 성공 건(+stale 선택)은 해제, 실패 건만 선택 유지(재시도). 성공 건은 published invalidate 로 발행완료 전이.
    setSelected((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => { if (failedIds.has(id)) next.add(id); });
      return next;
    });
    if (fail === 0) toast.success(`${ok}건 일괄 ${pubNoun} 완료`);
    else toast.error(`${ok}건 ${pubNoun} 완료, ${fail}건 실패 — 실패 건은 선택 유지(재시도 가능)`);
  };

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

  // LIFECYCLE: 일괄발행 대상(발행가능=조갑부위+생년 있고 미발행) id 집합 — 전체선택 토글 근거.
  //   4FIX 이슈3: canPublish 와 동일 조건(생년 누락 행은 select-all 대상에서 제외).
  const publishableIds = useMemo(
    () => filtered.filter((r) => canPublish(r)).map((r) => r.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, publishedMap],
  );
  const selectedCount = publishableIds.filter((id) => selected.has(id)).length;
  const allSelected = publishableIds.length > 0 && selectedCount === publishableIds.length;
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (publishableIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        publishableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...publishableIds]);
    });
  };
  const toggleSelectOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // KOH-ISSUE-ROLE-GRANT-ALLROLE: 버튼 라벨 = 전직군 단일 '발급하기'(역할 분기 제거).
  //   단건='발급하기'. 일괄(0건 선택)='일괄발급하기'. 일괄(N건 선택)='선택 N건 일괄발급'.
  const publishBtnLabel = '발급하기';
  const bulkPublishBtnLabel =
    selectedCount > 0
      ? `선택 ${selectedCount}건 일괄${pubNoun}`
      : '일괄발급하기';

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
        <div className="flex items-center gap-2">
          {/* AC-2/AC-3(BULK-PUBLISH): 일괄발행 — 0건 선택 시 비활성(클릭 불가), 1건+ 선택 시 활성.
              발행 동작만 일괄(결과값 개별입력 없음), 선택분(발행가능)만 발행.
              ── T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE (supersedes GRANT-3ROLE) ──
              일괄발급 버튼 = canIssue(전직군 8역할). reporter(문지은 대표원장) 확정 '권한 다 풀어줘'.
              라벨분기 제거 → 전직군 단일 '일괄발급하기'. canIssue=false(tm 등)만 미노출(회귀 가드). */}
          {canIssue && (
          <Button
            size="sm"
            className="h-8 gap-1 bg-neutral-800 px-2.5 text-[11px] text-white hover:bg-neutral-900 disabled:opacity-40"
            onClick={handleBulkPublish}
            disabled={selectedCount === 0 || bulkPublishing || publishKoh.isPending}
            data-testid="koh-bulk-publish"
          >
            {bulkPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="h-3.5 w-3.5" />}
            {bulkPublishBtnLabel}
          </Button>
          )}
          <span className="text-xs text-muted-foreground" data-testid="koh-count">
            {formatYearMonthKo(ym)} 검사 <span className="font-semibold text-foreground">{filtered.length}</span>건
            {query.trim() && eligibleRows.length !== filtered.length && (
              <span className="ml-1 text-muted-foreground/70">(전체 {eligibleRows.length}건 중)</span>
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
            : `${formatYearMonthKo(ym)}에 검사 후 하루가 지난 KOH 진균검사 명단이 없습니다.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="koh-table">
          <table className="w-full text-sm">
            <thead>
              {/* T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT (AC-1/AC-8): 7컬럼 고정 —
                  이름·생년(만나이)·차트번호·채취조갑·진료의·상태·발행. 검사일 컬럼 제거(월별 조회 필터는 유지).
                  + LIFECYCLE: 선택(일괄발행) 컬럼은 canIssue 게이트로 맨 앞 유지(데이터 7컬럼과 별개). */}
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {/* T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE: 선택(일괄발급) 컬럼 = canIssue(전직군 8역할).
                    헤더·셀 동일 게이트로 정합. 비대상 역할(canIssue=false, tm 등)에겐 선택 컬럼 자체 미노출. */}
                {canIssue && (
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">
                  {/* AC-3: 전체선택(발행가능 행만 대상) */}
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-teal-600 disabled:opacity-40"
                    checked={allSelected}
                    disabled={publishableIds.length === 0}
                    onChange={toggleSelectAll}
                    aria-label="전체 선택"
                    data-testid="koh-select-all"
                  />
                </th>
                )}
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">이름</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">생년(만나이)</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">차트번호</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">채취조갑</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">진료의</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">상태</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">발행</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const published = publishedMap?.get(r.id);
                const rowPublishable = canPublish(r);
                return (
                <tr
                  key={r.id}
                  className={`border-b last:border-0 transition hover:bg-accent/30 ${
                    r.koh_requested ? '' : 'opacity-55'
                  }`}
                  data-testid="koh-row"
                  data-koh-active={r.koh_requested ? 'true' : 'false'}
                >
                  {/* AC-3: 행 선택(일괄발행) — 발행가능(조갑부위 있고 미발행)일 때만 활성.
                      KOH-ISSUE-ROLE-GRANT-3ROLE: canIssue(3역할+의사, 헤더 선택 컬럼과 동일 게이트). */}
                  {canIssue && (
                  <td className="px-1.5 py-1 text-center" data-testid="koh-cell-select">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 cursor-pointer accent-teal-600 disabled:opacity-30"
                      checked={selected.has(r.id)}
                      disabled={!rowPublishable}
                      onChange={() => toggleSelectOne(r.id)}
                      aria-label={`${r.customer_name} 선택`}
                      data-testid="koh-row-select"
                    />
                  </td>
                  )}
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
                  {/* T-20260620-foot-KOHDASH-PATIENTCOL-NAILFMT (AC-8): 검사일 컬럼 제거.
                      월별 조회(useKohReport ym 범위 필터)는 유지 — 표시 컬럼만 제거. */}
                  {/* PHASE15(A): 조갑부위 + NAILSYNC(AC2/AC3): 치료부위 프리필.
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
                            className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${
                              effective.length > 0 ? 'text-foreground' : 'text-muted-foreground/60'
                            }`}
                            data-testid="koh-nailsite-text"
                            title={effective.length > 0 ? formatNailSites(effective) : undefined}
                          >
                            {/* AC-2(§B): 컴팩트 'R1'(2글자) 표기. 풀표기(formatNailSites)는 title 툴팁으로 보존. */}
                            {formatNailSitesShort(effective)}
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
                  {/* AC-4/AC-5: 발행 — 미발행+조갑부위+생년 있을 때만 활성. 발행=비가역(완료 시 비활성). */}
                  <td className="px-1.5 py-1 text-center whitespace-nowrap" data-testid="koh-cell-publish">
                    {published ? (
                      /* 4FIX 이슈2: 발행완료+보기 2버튼 → '💾 발행완료' 단일 버튼만. 클릭 시 보기(미리보기) 팝업.
                         진입점만 단일화 — 기존 보기 팝업(KohResultDialog) 동일. */
                      <button
                        type="button"
                        onClick={() => setPreviewData(published.field_data)}
                        className="inline-flex items-center gap-0.5 rounded text-[11px] font-semibold text-emerald-700 hover:underline focus:underline focus:outline-none"
                        title={`의뢰번호 ${published.request_no} — 클릭 시 결과보고서 보기`}
                        data-testid="koh-published-btn"
                      >
                        💾 발행완료
                      </button>
                    ) : canIssue ? (
                      /* T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE (supersedes GRANT-3ROLE):
                         발급 버튼 = canIssue(전직군 8역할). reporter(문지은 대표원장) '권한 다 풀어줘' 확정.
                         라벨분기 제거 → publishBtnLabel='발급하기'(전직군 단일) — 동작은 역할무관 동일.
                         비대상 역할(canIssue=false, tm 등)은 미노출. 발행완료 행 보기(viewer)는 전 역할 공통(읽기). */
                      <Button
                        size="sm"
                        variant={rowPublishable ? 'default' : 'outline'}
                        className={
                          rowPublishable
                            ? 'h-7 gap-1 bg-neutral-800 px-2 text-[11px] text-white hover:bg-neutral-900 disabled:opacity-40'
                            : 'h-7 gap-1 px-2 text-[11px] text-muted-foreground disabled:opacity-40'
                        }
                        onClick={() => handlePublish(r)}
                        // SINGLESEL-2FIX(이슈1): 발행 불가 상태도 탭 가능하게(disabled 제거) — 태블릿 hover 부재로
                        //   사유가 안 보여 '먹통'으로 보였음. 탭 시 handlePublish 가 사유 toast 노출. busy 상태만 비활성.
                        disabled={publishKoh.isPending || bulkPublishing}
                        // 4FIX 이슈3: 발행 불가 사유(조갑부위/생년 누락)를 title 로 명시.
                        //   ALLROLE: title 도 pubNoun('발급')으로 전직군 통일(라벨분기 제거).
                        //   ★AC-3 회귀방지★: 의사 view에서 비검증 행은 outline(비활성처럼) 표시하되 disabled 는 busy 한정 유지 —
                        //     탭 시 handlePublish 가 사유 toast 노출(태블릿 hover 부재 대응, SINGLESEL-2FIX 이슈1 보존).
                        title={
                          rowPublishable
                            ? `검사결과 보고서 ${pubNoun}(비가역)`
                            : r.nail_sites.length === 0
                              ? `채취 조갑부위를 먼저 선택해야 ${pubNoun}할 수 있습니다 (눌러서 안내 보기)`
                              : !effectiveBirth(r)
                                ? `환자 생년월일 미입력 — ${pubNoun} 불가 (눌러서 안내 보기)`
                                : `${pubNoun} 불가 (눌러서 안내 보기)`
                        }
                        data-testid="koh-publish-btn"
                        data-publishable={rowPublishable ? 'true' : 'false'}
                      >
                        {publishBtnLabel}
                      </Button>
                    ) : null}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 안내 — PHASE15 범위 명시 + NAILSYNC */}
      <p className="text-[11px] text-muted-foreground/70">
        ※ 검사일(시행일) 기준 월별 명단입니다. 조갑부위는 좌발(L1~L5)·우발(R1~R5) 버튼을 눌러 입력하며 하나만 선택해 주세요(다시 누르면 해제, 다른 부위를 누르면 그 부위로 바뀝니다). 고객차트에서 선택한 치료부위가 비어있는 조갑부위에 자동 표시(치료부위 배지)되며, 원장이 입력한 값은 덮어쓰지 않습니다. 환자 이름을 누르면 고객차트가 열립니다. 진료의는 진료차트 서명 기준이며 미서명·차트없음은 '미정'으로 표시됩니다. <strong className="text-foreground/80">상태</strong>는 2번차트 패키지 탭의 KOH 신청 토글(ON=신청/OFF=미신청·회색)을 따릅니다. <strong className="text-foreground/80">발급하기</strong>는 채취 조갑부위 선택 + 환자 생년월일이 갖춰져야 가능하며(생년월일 미입력 시 고객 정보에서 먼저 입력), 발급 시 검사결과 보고서가 생성되어 고객차트 검사결과 탭에 자동 표시됩니다. 발급은 취소·수정할 수 없습니다(비가역). 여러 건을 선택해 일괄 발급할 수 있습니다. 발급 완료된 행은 <strong className="text-foreground/80">💾 발행완료</strong> 버튼을 누르면 결과보고서를 다시 볼 수 있습니다.
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
