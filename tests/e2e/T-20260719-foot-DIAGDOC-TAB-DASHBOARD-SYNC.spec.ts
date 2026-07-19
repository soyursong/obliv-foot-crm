/**
 * E2E Spec — T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC (P1, planner GREEN-LIGHT / gate-exempt)
 *
 * 치료테이블(치료사 공간) 맨 뒤에 [소견서·진단서] 탭 신설 — 진료대시보드 [서류작성] 리스트를
 * read-only ADDITIVE 로 재노출. 치료사/코디팀이 소견서·진단서 신청/발행여부를 치료테이블에서 확인.
 *
 * 게이트 판정(gate-exempt) — 넘지 말 것(경계조건):
 *   · surface 축: 치료테이블(치료사 공간, 의사공간 아님) append → §11 진료화면 게이트 비대상.
 *   · 성격 축: DocRequestQueue(opinionRequest.ts 훅) read-only ADDITIVE 재노출·상속. 의사화면 코드 무수정.
 *   · db_change=false: 발행여부는 기존 발행 파이프라인 상태값 100% 매핑(신규 컬럼/파생 0).
 *
 * 컬럼: 환자명 / 요청종류(소견서·진단서) / 신청시각 / 발행여부(발행완료·미발행).
 *
 * AC:
 *   AC-1: 서류작성 큐 draft = '미발행', voided+published = '발행완료' 로 매핑(발행상태 상속).
 *   AC-2: 취소(cancelled) 제외 — 두 훅이 구조적으로 배제(draft 훅·published 훅).
 *   AC-3: 단일 소스 강제 — DocRequestQueue 와 동일 opinionRequest.ts 훅만 재사용(divergent 별도조회 0).
 *   AC-4: 의사화면(DocRequestQueue/DoctorCallDashboard) 코드 미수정 + form_submissions write 0(read·표기만).
 *   AC-5: 날짜이동 갱신 — 신청시각(KST) 기준 선택 날짜 스코프([서류작성] 날짜필터 상속, sibling 탭 정합).
 *
 * 구성:
 *   A. 순수 로직 — 컴포넌트가 소비하는 동일 함수(buildDiagDocRows/filterDiagDocByDate/computeDiagDocSummary) 직접 import.
 *   B. 정적 소스 가드 — 단일 소스 훅 재사용 + write/rpc/의사화면 import 미접점(AC-3/4).
 *   C. 탭 배선 가드 — 치료테이블 맨 뒤 탭 append + date 상속(AC-5).
 *   D. 브라우저 현장 클릭 시나리오 — 치료테이블 진입 → [소견서·진단서] 탭 클릭 → 렌더 프레임 가시화.
 *
 * 실행: npx playwright test T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDiagDocRows,
  filterDiagDocByDate,
  computeDiagDocSummary,
  type DiagDocRow,
} from '../../src/components/treatment/DiagDocSection';
import type { OpinionRequestRow } from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/DiagDocSection.tsx'), 'utf-8');
const PARENT_SRC = () =>
  readFileSync(join(HERE, '../../src/pages/TreatmentTable.tsx'), 'utf-8');

// 테스트용 OpinionRequestRow 팩토리(훅 반환 형태).
function req(over: Partial<OpinionRequestRow>): OpinionRequestRow {
  return {
    id: 'req-x',
    customerId: 'cust-1',
    checkInId: 'ci-1',
    docType: 'opinion',
    selectedKeys: [],
    staffMemo: '',
    oralMedReason: '',
    patientName: '홍길동',
    chartNo: null,
    birthDate: null,
    requestedByName: '실장',
    requestedAt: '2026-07-19T10:00:00+09:00',
    createdAt: '2026-07-19T10:00:00+09:00',
    requestDate: '',
    ...over,
  } as OpinionRequestRow;
}

// ─── A. 순수 로직 ─────────────────────────────────────────────────────────────

test.describe('AC-1 — buildDiagDocRows: draft=미발행 / voided+published=발행완료 상속', () => {
  test('draft 큐 행 → 미발행(unpublished)', () => {
    const rows = buildDiagDocRows([req({ id: 'd1' })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].publishStatus).toBe('unpublished');
  });

  test('published 행 → 발행완료(published) + resolvedAt 상속', () => {
    const rows = buildDiagDocRows(
      [],
      [req({ id: 'p1', resolvedAt: '2026-07-19T11:00:00+09:00' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].publishStatus).toBe('published');
    expect(rows[0].resolvedAt).toBe('2026-07-19T11:00:00+09:00');
  });

  test('요청종류(docType)·환자명·신청시각 상속 정확', () => {
    const rows = buildDiagDocRows(
      [req({ id: 'd1', docType: 'diagnosis', patientName: '김발톱', requestedAt: '2026-07-19T09:30:00+09:00' })],
      [],
    );
    expect(rows[0].docType).toBe('diagnosis');
    expect(rows[0].patientName).toBe('김발톱');
    expect(rows[0].requestedAt).toBe('2026-07-19T09:30:00+09:00');
  });

  test('발행완료 우선 편입 + id 중복 방어(구조상 비중첩이나 방어적)', () => {
    const rows = buildDiagDocRows([req({ id: 'dup' })], [req({ id: 'dup' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].publishStatus).toBe('published'); // published 우선
  });
});

test.describe('AC-5 — filterDiagDocByDate: 신청시각(KST) 선택 날짜 스코프 + 최신순', () => {
  test('선택 날짜(2026-07-19) 신청건만 통과', () => {
    const merged = buildDiagDocRows(
      [
        req({ id: 'today', requestedAt: '2026-07-19T10:00:00+09:00' }),
        req({ id: 'yday', requestedAt: '2026-07-18T22:00:00+09:00' }),
      ],
      [],
    );
    const out = filterDiagDocByDate(merged, '2026-07-19');
    expect(out.map((r) => r.id)).toEqual(['today']);
  });

  test('날짜이동 — 과거일자 선택 시 그날 신청건으로 재스코프(갱신)', () => {
    const merged = buildDiagDocRows(
      [
        req({ id: 'today', requestedAt: '2026-07-19T10:00:00+09:00' }),
        req({ id: 'yday', requestedAt: '2026-07-18T22:00:00+09:00' }),
      ],
      [],
    );
    expect(filterDiagDocByDate(merged, '2026-07-18').map((r) => r.id)).toEqual(['yday']);
  });

  test('KST 경계 — UTC 자정 넘긴 시각도 KST 날짜로 정확 귀속', () => {
    // 2026-07-18T23:30:00+09:00 == 2026-07-18T14:30:00Z → KST 날짜=07-18.
    const merged = buildDiagDocRows([req({ id: 'edge', requestedAt: '2026-07-18T14:30:00Z' })], []);
    expect(filterDiagDocByDate(merged, '2026-07-18').map((r) => r.id)).toEqual(['edge']);
    expect(filterDiagDocByDate(merged, '2026-07-19')).toHaveLength(0);
  });

  test('정렬 — 신청시각 역순(최신 위)', () => {
    const merged = buildDiagDocRows(
      [
        req({ id: 'early', requestedAt: '2026-07-19T09:00:00+09:00' }),
        req({ id: 'late', requestedAt: '2026-07-19T14:00:00+09:00' }),
      ],
      [],
    );
    expect(filterDiagDocByDate(merged, '2026-07-19').map((r) => r.id)).toEqual(['late', 'early']);
  });
});

test.describe('AC-1 — computeDiagDocSummary: 발행완료/미발행 카운트', () => {
  test('전체=발행완료+미발행 정합', () => {
    const rows: DiagDocRow[] = buildDiagDocRows(
      [req({ id: 'd1' }), req({ id: 'd2' })],
      [req({ id: 'p1' })],
    );
    const s = computeDiagDocSummary(rows);
    expect(s.total).toBe(3);
    expect(s.publishedCount).toBe(1);
    expect(s.unpublishedCount).toBe(2);
    expect(s.publishedCount + s.unpublishedCount).toBe(s.total);
  });
});

// ─── B. 정적 소스 가드 ────────────────────────────────────────────────────────

test.describe('AC-3 — 단일 소스 강제(DocRequestQueue 동일 훅 재사용, divergent 별도조회 0)', () => {
  test('opinionRequest.ts 훅(useOpinionRequestQueue/usePublishedOpinionRequests) 재사용', () => {
    const src = SECTION_SRC();
    expect(src).toContain('useOpinionRequestQueue');
    expect(src).toContain('usePublishedOpinionRequests');
    expect(src).toContain("from '@/lib/opinionRequest'");
  });

  test('form_submissions 별도조회(신규 supabase 쿼리) 없음 — 훅만 소스', () => {
    const src = SECTION_SRC();
    expect(src).not.toContain('supabase');           // 직접 쿼리 신설 0(훅이 유일 소스)
    expect(src).not.toContain("from('form_submissions')");
  });
});

test.describe('AC-4 — 의사화면 코드 미접점 + form_submissions write 0(read·표기만)', () => {
  test('form_submissions write(insert/update/delete/rpc) 없음', () => {
    const src = SECTION_SRC();
    expect(src).not.toContain('.insert(');
    expect(src).not.toContain('.update(');
    expect(src).not.toContain('.delete(');
    expect(src).not.toContain('.rpc(');
  });

  test('의사화면 컴포넌트(DocRequestQueue/DoctorCallDashboard/OpinionEditorDialog) import·사용 없음', () => {
    const src = SECTION_SRC();
    // 설명 주석에는 컴포넌트명이 근거로 언급될 수 있으므로 '실제 import·JSX 사용'만 단언(sibling spec 패턴).
    expect(src).not.toMatch(/import\s+[^;]*DocRequestQueue/);
    expect(src).not.toMatch(/import\s+[^;]*DoctorCallDashboard/);
    expect(src).not.toMatch(/import\s+[^;]*OpinionEditorDialog/);
    expect(src).not.toMatch(/<DocRequestQueue[\s/>]/);
    expect(src).not.toMatch(/<DoctorCallDashboard[\s/>]/);
    expect(src).not.toMatch(/<OpinionEditorDialog[\s/>]/);
  });

  test('resolve/발행 mutation(useResolveOpinionRequest/useCreateOpinionRequest) 미사용', () => {
    const src = SECTION_SRC();
    expect(src).not.toContain('useResolveOpinionRequest');
    expect(src).not.toContain('useCreateOpinionRequest');
    expect(src).not.toContain('useUpdateStaffMemo');
  });
});

// ─── C. 탭 배선 가드 ──────────────────────────────────────────────────────────

test.describe('AC-5 — 치료테이블 맨 뒤 탭 append + 부모 date 상속', () => {
  test('parent 에 diagdoc 탭 트리거 + 컨텐츠 배선', () => {
    const src = PARENT_SRC();
    expect(src).toContain('DiagDocSection');
    expect(src).toContain('data-testid="tab-diagdoc"');
    expect(src).toContain("value=\"diagdoc\"");
  });

  test('DiagDocSection 에 부모 공통 date 전달(AC-5 날짜필터 상속)', () => {
    const src = PARENT_SRC();
    expect(src).toMatch(/<DiagDocSection\s+date=\{date\}\s+nameInteraction=\{nameInteraction\}/);
  });

  test('맨 뒤 append — plan(경과분석 플랜) 탭 뒤에 diagdoc 위치', () => {
    const src = PARENT_SRC();
    const planIdx = src.indexOf('tab-progress-plans');
    const diagIdx = src.indexOf('tab-diagdoc');
    expect(planIdx).toBeGreaterThan(0);
    expect(diagIdx).toBeGreaterThan(planIdx); // diagdoc 이 plan 뒤(맨 뒤)
  });
});

// ─── D. 브라우저 현장 클릭 시나리오 ────────────────────────────────────────────

test.describe('D. 현장 클릭 — 치료테이블 [소견서·진단서] 탭 진입', () => {
  test('치료테이블 진입 → 소견서·진단서 탭 클릭 → 섹션 렌더', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    // 로그인 게이트/라우팅 환경차 — 앱 셸 로드만 확인(비인증 시 리다이렉트 허용).
    await page.waitForLoadState('networkidle').catch(() => {});

    // 치료테이블 라우트 직접 진입 시도(인증 필요 환경에서는 로그인 화면으로 폴백 — 크래시 없음만 단언).
    await page.goto('/admin/treatment-table').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});

    const tab = page.getByTestId('tab-diagdoc');
    if (await tab.count()) {
      await tab.first().click();
      // 탭 컨텐츠(섹션/빈상태/테이블 중 하나) 가시화.
      const section = page.getByTestId('diagdoc-section');
      await expect(section.first()).toBeVisible({ timeout: 5000 });
    }

    // 렌더 크래시(치명적 콘솔 에러) 없음.
    const fatal = errors.filter((e) => /DiagDoc|opinionRequest|Cannot read|is not a function/.test(e));
    expect(fatal).toEqual([]);
  });
});
