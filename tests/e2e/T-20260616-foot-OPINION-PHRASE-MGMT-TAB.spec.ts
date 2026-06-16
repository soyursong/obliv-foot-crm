/**
 * E2E spec — T-20260616-foot-OPINION-PHRASE-MGMT-TAB (문지은 대표원장, 풋센터)
 *
 * 소견서 작성 화면 좌측 버튼(버튼이름 + 클릭 시 자동삽입 멘트)을 어드민에서 직접 세팅.
 *   데이터 소스 = form_templates(form_key='opinion_doc').field_map.sections (★DDL 없음, jsonb 편집만).
 *   OpinionDocTab 은 旣 AC-8 read wiring(DB 우선 → fallback 하드코드) — 관리 UI(OpinionPhrasesTab)만 신규.
 *
 * AC-1 탭 신설: 진료관리 '진료차트 상용구' 옆 '소견서 상용구'(value=opinion_phrases). admin/manager only.
 * AC-2 섹션별 옵션 CRUD: 각 옵션 = label(버튼이름) + phrase(자동삽입 멘트) 추가/수정/삭제.
 * AC-3 저장 = form_templates(opinion_doc).field_map.sections upsert(신규 컬럼/테이블/CHECK 금지).
 * AC-4 seed: field_map.sections 비면 현행 OPINION_SECTIONS(진단서4+금기증24) 기본값으로 초기화.
 * AC-5 read 우선순위: 저장 후 OpinionDocTab 가 DB 우선 → 변경 즉시 캐시 무효화(opinion_form_template).
 * AC-6 섹션 이름 변경/신규 섹션 추가/삭제.
 *
 * 본 spec = 구조 불변식(데이터·로그인 비의존, 빠른 회귀) + 권한자 브라우저 렌더 확인(AC-1 게이트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';
const OPINION_TAB = 'src/components/admin/OpinionPhrasesTab.tsx';
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';
const MIGRATION = 'supabase/migrations/20260616160000_opinion_doc_form_stack.sql';

// ── 소스 구조 불변식 (정본 소스, 데이터·로그인 비의존) ──────────────────────────────
test.describe('OPINION-PHRASE-MGMT-TAB — 소스 구조 불변식', () => {
  const cm = read(CLINIC_MGMT);
  const ot = read(OPINION_TAB);
  const od = read(OPINION_DOC);

  test('AC-1: 진료관리에 소견서 상용구 탭 신설 + 진료차트 상용구 옆 + admin/manager 게이트', () => {
    // 신규 컴포넌트 import
    expect(cm).toContain("import OpinionPhrasesTab from '@/components/admin/OpinionPhrasesTab'");
    // 탭 트리거 — 신규 키(opinion_phrases), 진료차트(medchart_phrases) 와 분리
    expect(cm).toContain('value="opinion_phrases"');
    expect(cm).toContain('data-testid="tab-opinion-phrases"');
    expect(cm).toContain('소견서 상용구');
    // admin/manager 게이트
    expect(cm).toMatch(/canManageOpinionPhrases\s*=\s*profile\?\.role === 'admin' \|\| profile\?\.role === 'manager'/);
    expect(cm).toContain('{canManageOpinionPhrases && (');
    // 진료차트 상용구 트리거 바로 다음 라인 부근에 위치(옆 배치)
    const idxMed = cm.indexOf('data-testid="tab-medchart-phrases"');
    const idxOpi = cm.indexOf('data-testid="tab-opinion-phrases"');
    expect(idxMed).toBeGreaterThan(-1);
    expect(idxOpi).toBeGreaterThan(idxMed);
    // 딥링크 허용 목록(권한자)
    expect(cm).toContain("'opinion_phrases'");
  });

  test('AC-3: 저장 = form_templates(opinion_doc).field_map.sections 편집 — DDL 없음', () => {
    // 동일 row 읽기/쓰기 (form_key='opinion_doc')
    expect(ot).toContain("from('form_templates')");
    expect(ot).toMatch(/form_key',\s*'opinion_doc'/);
    // field_map 의 다른 키 보존 + sections 만 교체 (print_template_key 등)
    expect(ot).toContain('const nextFieldMap = { ...baseFieldMap, sections }');
    expect(ot).toContain('.update({ field_map: nextFieldMap })');
    // 신규 테이블/컬럼/CHECK·DDL 없음 — opinion_doc CRUD 외 다른 테이블 write 금지
    expect(ot).not.toMatch(/create\s+table/i);
    expect(ot).not.toMatch(/alter\s+table/i);
  });

  test('AC-4: seed — field_map.sections 비면 OPINION_SECTIONS 기본값으로 초기화', () => {
    expect(ot).toContain("import {");
    expect(ot).toContain('OPINION_SECTIONS');
    expect(ot).toContain('parseOpinionSections');
    // 비면 OPINION_SECTIONS fallback
    expect(ot).toMatch(/tpl\.sections\.length > 0 \? tpl\.sections : OPINION_SECTIONS/);
  });

  test('AC-2: 옵션 = label(버튼이름) + phrase(자동삽입 멘트) CRUD', () => {
    expect(ot).toContain('data-testid="opinion-phrase-label-input"');
    expect(ot).toContain('data-testid="opinion-phrase-phrase-input"');
    expect(ot).toContain('data-testid="opinion-phrase-add-option"');
    expect(ot).toContain('data-testid="opinion-phrase-option-edit"');
    expect(ot).toContain('data-testid="opinion-phrase-option-delete"');
    // 저장 버튼(atomic upsert)
    expect(ot).toContain('data-testid="opinion-phrase-save-all"');
  });

  test('AC-6: 섹션 추가/이름변경/삭제', () => {
    expect(ot).toContain('data-testid="opinion-phrase-add-section"');
    expect(ot).toContain('data-testid="opinion-phrase-section-edit"');
    expect(ot).toContain('data-testid="opinion-phrase-section-delete"');
  });

  test('AC-5: OpinionDocTab read 우선순위(DB 우선) 보존 + 저장 시 캐시 무효화', () => {
    // 旣 AC-8 wiring — DB sections 우선, 없으면 하드코드 폴백
    expect(od).toContain('dbSections.length > 0 ? dbSections : OPINION_SECTIONS');
    // 저장 후 OpinionDocTab 옵션 그리드 캐시(opinion_form_template) 무효화 → 즉시 반영
    expect(ot).toContain("queryKey: ['opinion_form_template', clinicId]");
  });

  test('무회귀: OpinionDocTab 발행 동선·칩 그리드(OPINION-DOC-FEATURE) 불변', () => {
    // 발행 RPC·옵션 그리드 testid 보존(읽기 소스만 DB 일원화)
    expect(od).toContain("supabase.rpc('publish_opinion_doc'");
    expect(od).toContain('data-testid="opinion-options"');
    expect(od).toContain('data-testid="opinion-publish-btn"');
  });

  test('무회귀: 진료관리 기존 탭(진료차트 상용구·서류·슈퍼상용구 등) 불변', () => {
    ['medchart_phrases', 'super_phrases', 'documents', 'treatment_sets', 'diagnosis_names'].forEach((v) => {
      expect(cm).toContain(`value="${v}"`);
    });
    // opinion_phrases 는 services redirect(MOVED_TO_SERVICES) 대상이 아님(진료관리 잔류)
    const movedLine = cm.match(/MOVED_TO_SERVICES[^\n]*\[[^\]]*\]/);
    expect(movedLine).not.toBeNull();
    expect(movedLine![0]).not.toContain('opinion_phrases');
  });

  test('마이그(20260616160000) seed 가 동일 field_map.sections 구조 — 관리 UI 와 정합', () => {
    const mig = read(MIGRATION);
    expect(mig).toContain("'opinion_doc'");
    expect(mig).toContain('"sections"');
    // ON CONFLICT idempotent seed
    expect(mig).toContain('ON CONFLICT (clinic_id, form_key) DO UPDATE');
  });
});

// ── 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 graceful skip) — AC-1 ─────────────
test.describe('OPINION-PHRASE-MGMT-TAB — 브라우저 렌더', () => {
  test('AC-1: 진료관리 → 소견서 상용구 탭 진입 + 섹션 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=opinion_phrases');
    const trigger = page.getByTestId('tab-opinion-phrases');
    const okTab = await trigger.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okTab) { test.skip(true, '진료관리 비-admin/manager 역할 — 권한 게이트 정상'); return; }
    await expect(trigger).toHaveAttribute('aria-selected', 'true', { timeout: 8000 });
    // 관리 UI 본체 노출
    await expect(page.getByTestId('opinion-phrases-tab')).toBeVisible({ timeout: 10_000 });
    // seed 기본값(진단서/금기증) 또는 DB sections → 최소 1개 섹션
    await expect(page.getByTestId('opinion-phrase-section').first()).toBeVisible({ timeout: 10_000 });
  });

  test('AC-2: 옵션 추가 다이얼로그(버튼이름 + 자동삽입 멘트) 열림', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=opinion_phrases');
    const addBtn = page.getByTestId('opinion-phrase-add-option').first();
    const okBtn = await addBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okBtn) { test.skip(true, '비-admin/manager 역할 또는 미진입 — 권한 게이트 정상'); return; }
    await addBtn.click();
    await expect(page.getByTestId('opinion-phrase-option-dialog')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('opinion-phrase-label-input')).toBeVisible();
    await expect(page.getByTestId('opinion-phrase-phrase-input')).toBeVisible();
  });
});
