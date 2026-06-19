/**
 * E2E spec — T-20260619-foot-SVCMGMT-SIDEBAR-LAYOUT
 *
 * 김주연 총괄 요청: 서비스목록 > 서비스관리 화면의 코드리스트 위 가로 카테고리 필터칩을
 *   '상용구 관리' 레이아웃처럼 좌측 카테고리 사이드바(카테고리명 + 카운트) + 우측 리스트로 전환.
 *
 * AC-1: 카테고리 선택 UI가 좌측 사이드바(카테고리명 + 카운트 배지)로 표시.
 * AC-2: 좌측 카테고리 클릭 시 우측 리스트가 해당 카테고리로 필터링(현행 필터 로직 결과 동일).
 * AC-3: 우측 리스트 컬럼·행·정렬·관리(수정/삭제) 동작이 현행과 동일하게 유지.
 * AC-4: 상단 우측 액션(비활성 보기 / 엑셀 내보내기 / + 서비스 추가)·검색창 동작 회귀 없음.
 * AC-5: 카테고리별 카운트가 현재와 동일(소스·산식 무변경 — tabCounts useMemo 재사용).
 * AC-6: DB·RPC·집계 무변경(순수 프론트 레이아웃) — fetchServices/필터 로직 불변 검증.
 *
 * 순수 UI 레이아웃 재배치이므로 구조 불변식을 정본 그대로 인코딩(데이터·로그인 비의존, 빠른 회귀 가드)
 *  + 브라우저 렌더(좌측 사이드바 가시성 + 카테고리 클릭 필터) 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SERVICES = 'src/pages/Services.tsx';

// ── AC-1: 좌측 카테고리 사이드바 레이아웃 ─────────────────────────────────────
test('AC-1: 카테고리 네비가 좌측 사이드바(2-컬럼 flex)로 구성', () => {
  const svc = read(SERVICES);
  // 본 티켓 마커 + 2-컬럼 레이아웃 컨테이너
  expect(svc).toContain('SVCMGMT-SIDEBAR-LAYOUT');
  expect(svc).toContain('flex flex-1 min-h-0 gap-4');
  // 좌측 사이드바 tablist (testid 보존 — 기존 E2E 호환) + 고정폭 세로 스택
  expect(svc).toContain('data-testid="svc-tab-nav"');
  expect(svc).toContain('w-32 shrink-0 overflow-y-auto rounded-lg border bg-muted/10');
  // 사이드바 활성 카테고리 좌측 강조 바 (상용구 관리 패턴)
  expect(svc).toContain('border-l-2 border-l-teal-500');
});

test('AC-1: 각 카테고리 탭 버튼 + 카운트 배지 보존 (8개 카테고리)', () => {
  const svc = read(SERVICES);
  // 카테고리 정의 불변 (전체 + 7 category_label)
  expect(svc).toContain("CATEGORY_LABEL_OPTIONS = ['기본', '검사', '상병', '처방약', '풋케어', '수액', '풋화장품']");
  expect(svc).toContain("CATEGORY_TABS = ['전체', ...CATEGORY_LABEL_OPTIONS]");
  // 각 탭 testid + 카운트 배지 렌더
  expect(svc).toContain('data-testid={`svc-tab-${tab}`}');
  expect(svc).toContain('tabCounts[tab]');
});

// ── AC-2: 카테고리 클릭 → 필터링 (필터 로직 불변) ─────────────────────────────
test('AC-2/AC-5: setActiveTab + tabItems/tabCounts 필터 로직 불변', () => {
  const svc = read(SERVICES);
  // 클릭 시 activeTab 변경 (필터 트리거)
  expect(svc).toContain('onClick={() => setActiveTab(tab)}');
  // 필터 산식 불변 — effectiveCategoryLabel 기준 필터
  expect(svc).toContain('effectiveCategoryLabel(svc) !== activeTab');
  // 카운트 산식 불변 — tabCounts useMemo
  expect(svc).toContain('counts[tab] = rows.filter((s) => effectiveCategoryLabel(s) === tab');
});

// ── AC-3: 우측 리스트(테이블) 구성 불변 ───────────────────────────────────────
test('AC-3: 테이블 컬럼·행·정렬·관리 동작 불변 (SortableServiceRow/DnD 보존)', () => {
  const svc = read(SERVICES);
  // 테이블 컬럼 헤더 보존
  for (const col of ['상품코드', '시술명', '단가', 'VAT', '관리']) {
    expect(svc).toContain(`>${col}</th>`);
  }
  // 전체 탭 항목분류 컬럼 + DnD 정렬 + 수정/삭제 핸들러 보존
  expect(svc).toContain('항목분류');
  expect(svc).toContain('SortableServiceRow');
  expect(svc).toContain('onReorder={handleReorderBtn}');
  expect(svc).toContain('onEdit={setEditTarget}');
  expect(svc).toContain('onSoftDelete={softDelete}');
  expect(svc).toContain('onHardDelete={hardDelete}');
});

// ── AC-4: 상단 액션 + 검색창 보존 ─────────────────────────────────────────────
test('AC-4: 비활성 보기 / 엑셀 내보내기 / + 서비스 추가 + 검색창 보존', () => {
  const svc = read(SERVICES);
  expect(svc).toContain('비활성 보기');
  expect(svc).toContain('엑셀 내보내기');
  expect(svc).toContain('서비스 추가');
  // 검색창 (우측 영역으로 이동, 로직 불변)
  expect(svc).toContain('placeholder="시술명 또는 상품코드 검색"');
  expect(svc).toContain('onChange={(e) => setSearchQuery(e.target.value)}');
});

// ── AC-6: DB·집계 무변경 ──────────────────────────────────────────────────────
test('AC-6: fetchServices 조회 로직 불변 (DB/RPC 무변경)', () => {
  const svc = read(SERVICES);
  // 조회 쿼리 불변 — services 테이블 select + clinic_id 필터 + 3단 정렬
  expect(svc).toContain(".from('services')");
  expect(svc).toContain(".eq('clinic_id', clinic.id)");
  expect(svc).toContain(".order('sort_order', { ascending: true })");
});

// ── 브라우저 렌더 검증 (인증 storageState 사용) ──────────────────────────────
test('렌더: 서비스 관리 진입 시 좌측 카테고리 사이드바 표시', async ({ page }) => {
  await page.goto('/admin/services');
  // 서비스 목록(기본) 탭 진입 — 좌측 카테고리 사이드바 가시
  const sidebar = page.getByTestId('svc-tab-nav');
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  // '전체' 카테고리 버튼 가시
  await expect(page.getByTestId('svc-tab-전체')).toBeVisible();
});

test('렌더: 좌측 카테고리 클릭 시 우측 리스트 필터링(activeTab 전환)', async ({ page }) => {
  await page.goto('/admin/services');
  const allTab = page.getByTestId('svc-tab-전체');
  await expect(allTab).toBeVisible({ timeout: 10_000 });

  // '처방약' 카테고리 클릭 → aria-selected 전환
  const rxTab = page.getByTestId('svc-tab-처방약');
  if ((await rxTab.count()) === 0) {
    test.skip(true, '처방약 카테고리 미노출(데이터/권한) — 코드레벨 AC-2 가 회귀 담당');
    return;
  }
  await rxTab.click();
  await expect(rxTab).toHaveAttribute('aria-selected', 'true');

  // '전체' 클릭 시 다시 전체 선택
  await allTab.click();
  await expect(allTab).toHaveAttribute('aria-selected', 'true');
});
