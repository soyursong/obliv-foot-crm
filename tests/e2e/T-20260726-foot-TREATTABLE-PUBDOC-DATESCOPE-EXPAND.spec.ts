/**
 * E2E Spec — T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND (P0, FE-only hotfix, gate-exempt)
 *
 * 후속: TREATTABLE-DATA-MISSING 진단 → 치료테이블 [소견서·진단서] 탭에서 과거일자를 선택해도
 *   그 날의 '발행완료' 소견서/진단서가 안 보이던 결함 fix.
 *
 * RC: usePublishedOpinionRequests(opinionRequest.ts) 는 resolved_at KST==today 로 '당일 발행'만 반환.
 *   → 치료테이블(부모 날짜선택기로 과거일 조회 가능)에서 과거일을 골라도 발행완료가 빈 목록.
 *
 * FIX (FE-only, db_change=false):
 *   · 신규 useAllPublishedOpinionRequests(all-time) 훅 — clinic-scoped 발행완료(voided+resolved_reason=
 *     'published') 전건 반환. 날짜 스코프는 소비 컴포넌트 filterDiagDocByDate(선택 날짜)가 결정.
 *   · DiagDocSection 이 day-scoped 훅 → all-time 훅으로 소스 전환. 진단서/소견서 동일 스코프.
 *   · 진료대시보드(의사공간)용 usePublishedOpinionRequests(day-scoped) 미변경 → §11.1 의료 surface 동작 불변.
 *
 * 게이트(gate-exempt): 치료테이블 = 치료사 공간(비의료). 의사화면(DocRequestQueue) 코드/훅 무접촉.
 *
 * 시나리오(티켓 본문 3종):
 *   ① 과거일(7/24) 발행 7건 → 선택 날짜 7/24 에서 7건 노출.
 *   ② 오늘 날짜 회귀 없음 — 오늘 발행 건은 오늘 선택 시 그대로 노출(기존 동작 유지).
 *   ③ 발행 0인 과거일 → 빈 상태 유지(오노출 없음).
 *
 * 구성:
 *   A. 순수 로직 — 컴포넌트가 소비하는 동일 함수(buildDiagDocRows/filterDiagDocByDate) 직접 import.
 *   B. 정적 소스 가드 — all-time 훅 신설 + day-scoped 훅 미변경 + 단일 매핑 공유(mapPublishedRequestRow).
 *
 * 실행: npx playwright test T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDiagDocRows,
  filterDiagDocByDate,
  type DiagDocRow,
} from '../../src/components/treatment/DiagDocSection';
import type { OpinionRequestRow } from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/DiagDocSection.tsx'), 'utf-8');
const HOOK_SRC = () =>
  readFileSync(join(HERE, '../../src/lib/opinionRequest.ts'), 'utf-8');
const DOCQUEUE_SRC = () =>
  readFileSync(join(HERE, '../../src/components/doctor/DocRequestQueue.tsx'), 'utf-8');

// 발행완료 OpinionRequestRow 팩토리(useAllPublishedOpinionRequests 반환 형태 — 발행완료 전건).
//   requestedAt(KST)·resolvedAt 을 지정해 날짜 스코프를 재현. filterDiagDocByDate 는 requestedAt(신청 KST 날짜)
//   == 선택 날짜로 발행완료를 스코프한다(기존 semantics 유지).
function pub(id: string, requestedKstDate: string, docType: 'opinion' | 'diagnosis' = 'opinion'): OpinionRequestRow {
  const requestedAt = `${requestedKstDate}T10:30:00+09:00`;
  return {
    id,
    customerId: `cust-${id}`,
    checkInId: `ci-${id}`,
    docType,
    selectedKeys: [],
    staffMemo: '',
    oralMedReason: '',
    patientName: `환자-${id}`,
    chartNo: null,
    birthDate: null,
    requestedByName: '',
    requestedAt,
    createdAt: requestedAt,
    requestDate: requestedKstDate,
    resolvedAt: `${requestedKstDate}T11:00:00+09:00`,
  };
}

const TODAY = '2026-07-26';
const PAST = '2026-07-24';
const EMPTY_PAST = '2026-07-20';

// ── A. 순수 로직 — 날짜 스코프 시나리오 ─────────────────────────────────────────
test.describe('A. filterDiagDocByDate — 발행완료 날짜 스코프 (all-time 소스)', () => {
  test('① 과거일(7/24) 발행 7건 → 7/24 선택 시 7건 노출', () => {
    // all-time 훅이 반환하는 발행완료 전건(과거 7/24 7건 + 오늘 2건 혼재).
    const publishedAll: OpinionRequestRow[] = [
      ...Array.from({ length: 7 }, (_, i) => pub(`p24-${i}`, PAST, i % 2 === 0 ? 'opinion' : 'diagnosis')),
      pub('ptoday-1', TODAY),
      pub('ptoday-2', TODAY, 'diagnosis'),
    ];
    const merged = buildDiagDocRows([], publishedAll);
    const rows = filterDiagDocByDate(merged, PAST);
    const publishedRows = rows.filter((r) => r.publishStatus === 'published');
    expect(publishedRows).toHaveLength(7);
    // 과거일 선택 시 오늘 발행분은 섞이지 않음.
    expect(publishedRows.every((r) => r.id.startsWith('p24-'))).toBe(true);
    // 진단서/소견서 동일 스코프(둘 다 노출).
    expect(publishedRows.some((r) => r.docType === 'diagnosis')).toBe(true);
    expect(publishedRows.some((r) => r.docType === 'opinion')).toBe(true);
  });

  test('② 오늘 날짜 회귀 없음 — 오늘 선택 시 오늘 발행분 노출·과거일 미혼입', () => {
    const publishedAll: OpinionRequestRow[] = [
      ...Array.from({ length: 7 }, (_, i) => pub(`p24-${i}`, PAST)),
      pub('ptoday-1', TODAY),
      pub('ptoday-2', TODAY, 'diagnosis'),
    ];
    const merged = buildDiagDocRows([], publishedAll);
    const rows = filterDiagDocByDate(merged, TODAY);
    const publishedRows = rows.filter((r) => r.publishStatus === 'published');
    expect(publishedRows).toHaveLength(2);
    expect(publishedRows.every((r) => r.id.startsWith('ptoday-'))).toBe(true);
  });

  test('③ 발행 0인 과거일 → 빈 상태 유지(오노출 없음)', () => {
    const publishedAll: OpinionRequestRow[] = [
      ...Array.from({ length: 7 }, (_, i) => pub(`p24-${i}`, PAST)),
      pub('ptoday-1', TODAY),
    ];
    const merged = buildDiagDocRows([], publishedAll);
    const rows = filterDiagDocByDate(merged, EMPTY_PAST);
    expect(rows.filter((r) => r.publishStatus === 'published')).toHaveLength(0);
  });

  test('미발행(draft)은 날짜 무관 잔류 회귀 없음(발행완료 스코프 확장이 미발행 규칙을 안 깸)', () => {
    const draft: OpinionRequestRow = { ...pub('d1', PAST), resolvedAt: undefined };
    const merged = buildDiagDocRows([draft], []);
    // 신청일이 과거여도 미발행은 다른 날짜(오늘) 선택 시에도 잔류.
    const rows = filterDiagDocByDate(merged, TODAY);
    expect(rows.filter((r) => r.publishStatus === 'unpublished')).toHaveLength(1);
  });
});

// ── B. 정적 소스 가드 ───────────────────────────────────────────────────────────
test.describe('B. 소스 가드 — all-time 훅 신설 + 의료 surface 불변', () => {
  test('DiagDocSection 은 all-time 훅(useAllPublishedOpinionRequests)을 소비', () => {
    const src = SECTION_SRC();
    // 실제 훅 호출 = all-time.
    expect(src).toMatch(/const\s*\{[^}]*\}\s*=\s*useAllPublishedOpinionRequests\(clinicId\)/);
    // day-scoped 훅을 직접 호출(코드)하지 않음 — import 목록/주석 언급은 허용하되 호출부는 없어야 함.
    expect(src).not.toMatch(/=\s*usePublishedOpinionRequests\(clinicId\)/);
  });

  test('opinionRequest.ts — all-time 훅 신설 + day-scoped 훅 유지 + 단일 매핑 공유', () => {
    const src = HOOK_SRC();
    expect(src).toMatch(/export function useAllPublishedOpinionRequests\(/);
    // 진료대시보드(의사공간)용 day-scoped 훅은 그대로 존재(§11.1 불변).
    expect(src).toMatch(/export function usePublishedOpinionRequests\(/);
    // day-scoped 훅에만 존재하는 당일 필터(resolved_at KST==today) 는 all-time 훅으로 전이되지 않음:
    //   'today' 비교는 파일 전체에서 정확히 1회(usePublishedOpinionRequests 내부)만.
    const todayCmp = src.match(/seoulISODate\(ra\)\s*===\s*today/g) ?? [];
    expect(todayCmp).toHaveLength(1);
    // 단일 매핑 공유(drift 방지).
    expect(src).toMatch(/export function mapPublishedRequestRow\(/);
    const mapUses = src.match(/mapPublishedRequestRow\(r,\s*fd\)/g) ?? [];
    expect(mapUses.length).toBeGreaterThanOrEqual(2);
  });

  // ⚠ SUPERSEDED by T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN (§11 의사공간 게이트 CLEARED,
  //   문지은 대표원장 confirm). 07-26 당시 진료대시보드(DocRequestQueue)는 day-scoped 유지가 불변식이었으나,
  //   REOPEN 티켓이 바로 그 dashboard '서류 완료' 목록의 자정-교차 소실을 없애기 위해 all-time 로 확장했다.
  //   → 이제 DocRequestQueue 도 useAllPublishedOpinionRequests 를 소비. 이 spec 은 치료테이블 확장이
  //     여전히 유효함(all-time 훅·단일 매핑 존재)만 지키고, dashboard 훅 선택은 REOPEN spec 이 소유한다.
  test('DocRequestQueue 도 all-time 훅 소비 (REOPEN 후) — 치료테이블 확장은 불변', () => {
    const src = DOCQUEUE_SRC();
    // REOPEN: 진료대시보드도 이제 발행완료 소스를 all-time 로 확장(day-scoped 자정 소실 제거).
    expect(src).toMatch(/=\s*useAllPublishedOpinionRequests\(clinicId\)/);
  });

  test('read-only — 치료테이블 발행완료 소스에 write/RPC 없음', () => {
    const src = SECTION_SRC();
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    // RPC 실호출 없음(발행 파이프라인 무접촉). 주석의 'publish_opinion_doc RPC 미접촉' 언급은 허용.
    expect(src).not.toMatch(/\.rpc\(/);
  });
});
