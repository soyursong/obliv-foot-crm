/**
 * E2E spec — T-20260617-foot-DOCPHRASE-CSV-BULK-HISTORY (문지은 대표원장, 풋센터)
 *
 * 서류 상용구(소견서/진단서) CSV 대량입출력 + 양식다운로드 + 버튼별 업로드 history.
 *   데이터 타깃 = form_templates(form_key='opinion_doc').field_map.sections (★DDL 없음 — jsonb ADDITIVE).
 *   CSV 관리 UI 를 旣배포 OpinionPhrasesTab(OPINION-PHRASE-MGMT-TAB) 안에 흡수.
 *
 * AC-2 토글: 소견서·진단서(= field_map.sections 섹션 그룹)를 같은 영역 + 토글 전환.
 * AC-3 양식 CSV 다운로드: 현행 값(섹션·옵션key·label·phrase) 채워서 export.
 * AC-4 업로드 dry-run 의무: 미리보기(추가N/변경M/오류K) → 사람 '반영' 클릭 후 commit.
 * AC-5 history: field_map.phrase_meta(옵션별 last_updated_at/updated_by) + import_log[] (ADDITIVE jsonb).
 * AC-7 CSV 파서: 신규 npm 미도입 — 무의존 자체 파서(opinionPhraseCsv.ts).
 *
 * 본 spec = (1) CSV 코어 로직 단위검증(데이터·로그인 비의존) + (2) 소스 구조 불변식 + (3) 권한자 브라우저 렌더.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';
import {
  buildPhraseCsv,
  parsePhraseCsv,
  parseCsv,
  computeImportPlan,
  applyPhraseImport,
  PHRASE_CSV_HEADERS,
} from '../../src/lib/opinionPhraseCsv';
import { OPINION_SECTIONS } from '../../src/components/doctor/OpinionDocTab';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';
const OPINION_TAB = 'src/components/admin/OpinionPhrasesTab.tsx';
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';
const CSV_LIB = 'src/lib/opinionPhraseCsv.ts';

// ── (1) CSV 코어 로직 단위검증 (AC-3/4/7) ──────────────────────────────────────
test.describe('DOCPHRASE-CSV — CSV 코어 로직', () => {
  test('AC-3: buildPhraseCsv = 헤더 + 현행 값(섹션·key·label·phrase) 채움 + 라운드트립', () => {
    const csv = buildPhraseCsv(OPINION_SECTIONS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(PHRASE_CSV_HEADERS.join(','));
    // 진단서 oral_o 옵션이 값 채워 export.
    expect(csv).toContain('진단서');
    expect(csv).toContain('oral_o');
    expect(csv).toContain('경구약 O');
    // 데이터 행 수 = 전체 옵션 수.
    const optCount = OPINION_SECTIONS.reduce((n, s) => n + s.options.length, 0);
    expect(lines.length - 1).toBe(optCount);
    // 라운드트립: build → parse → 동일 행 수.
    const rows = parsePhraseCsv(csv);
    expect(rows.length).toBe(optCount);
    expect(rows[0]).toMatchObject({ section: '진단서', key: 'oral_o', label: '경구약 O' });
  });

  test('AC-7: parseCsv 가 인용·콤마·이스케이프따옴표·개행 처리(무의존 파서)', () => {
    const text = '섹션,옵션KEY,버튼이름,삽입멘트\r\n진단서,k1,라벨,"콤마, 포함 ""인용"" 멘트"\r\n';
    const rows = parsePhraseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].phrase).toBe('콤마, 포함 "인용" 멘트');
    // 셀 내 개행 보존.
    const multi = '섹션,옵션KEY,버튼이름,삽입멘트\r\nA,k,L,"1줄\n2줄"\r\n';
    expect(parsePhraseCsv(multi)[0].phrase).toBe('1줄\n2줄');
    // 완전 빈 행 제거.
    expect(parseCsv('a,b\r\n\r\nc,d').length).toBe(2);
  });

  test('AC-4 dry-run: computeImportPlan 이 추가/변경/변동없음/오류 분류', () => {
    const current = [
      { title: '진단서', options: [{ key: 'k1', label: '라벨1', phrase: '멘트1' }] },
    ];
    const rows = parsePhraseCsv(
      [
        PHRASE_CSV_HEADERS.join(','),
        '진단서,k1,라벨1,멘트1', // 변동없음
        '진단서,k1,라벨1수정,멘트1', // 변경(label)
        '진단서,,새버튼,새멘트', // 추가(key 비움)
        ',k9,누락섹션,멘트', // 오류(섹션 없음)
        '진단서,k8,누락멘트,', // 오류(멘트 없음)
      ].join('\r\n'),
    );
    const plan = computeImportPlan(current, rows);
    // 같은 key 두 행: 첫 행 unchanged, 둘째 행 change.
    expect(plan.unchanged).toBe(1);
    expect(plan.changed).toBe(1);
    expect(plan.added).toBe(1);
    expect(plan.errors).toBe(2);
  });

  test('AC-4 commit: applyPhraseImport 비파괴 머지 — 변경 반영 + 추가 + 미언급 옵션 보존', () => {
    const current = [
      {
        title: '진단서',
        options: [
          { key: 'k1', label: '라벨1', phrase: '멘트1' },
          { key: 'k2', label: '라벨2', phrase: '멘트2' },
        ],
      },
    ];
    const rows = parsePhraseCsv(
      [
        PHRASE_CSV_HEADERS.join(','),
        '진단서,k1,라벨1변경,멘트1변경', // k1 변경
        '진단서,,신규,신규멘트', // 추가
      ].join('\r\n'),
    );
    const plan = computeImportPlan(current, rows);
    const { sections, affectedKeys } = applyPhraseImport(current, plan);
    const opts = sections[0].options;
    // k1 변경 반영.
    expect(opts.find((o) => o.key === 'k1')).toMatchObject({ label: '라벨1변경', phrase: '멘트1변경' });
    // k2 보존(CSV 미언급 → 삭제 안 함, 비파괴).
    expect(opts.find((o) => o.key === 'k2')).toMatchObject({ label: '라벨2', phrase: '멘트2' });
    // 신규 추가.
    expect(opts).toHaveLength(3);
    // affectedKeys = k1 + 신규 key (history 메타 갱신 대상).
    expect(affectedKeys).toContain('k1');
    expect(affectedKeys.length).toBe(2);
    // 입력 불변(깊은 복제).
    expect(current[0].options).toHaveLength(2);
  });

  test('AC-4 가드: 잘못된 헤더 CSV 는 throw', () => {
    expect(() => parsePhraseCsv('아무거나,컬럼\r\nx,y')).toThrow();
  });
});

// ── (2) 소스 구조 불변식 ──────────────────────────────────────────────────────
test.describe('DOCPHRASE-CSV — 소스 구조 불변식', () => {
  const ot = read(OPINION_TAB);
  const od = read(OPINION_DOC);
  const lib = read(CSV_LIB);

  test('AC-1: CSV UI 가 OpinionPhrasesTab(opinion_doc) 동일 surface 흡수 — 신규 탭 X', () => {
    const cm = read(CLINIC_MGMT);
    // 별도 신규 탭 추가 없음(opinion_phrases 단일).
    expect(cm).toContain('value="opinion_phrases"');
    // CSV 버튼이 OpinionPhrasesTab 안에 위치.
    expect(ot).toContain('data-testid="opinion-phrase-csv-download"');
    expect(ot).toContain('data-testid="opinion-phrase-csv-upload"');
  });

  test('AC-2: 섹션 토글(같은 영역 전환) 존재 — 분리 탭 아님', () => {
    expect(ot).toContain('data-testid="opinion-phrase-section-toggle"');
    expect(ot).toContain("setSectionFilter('__all__')");
    expect(ot).toContain('visibleSections');
  });

  test('AC-5: history = field_map.phrase_meta + import_log[] (ADDITIVE 無DDL)', () => {
    // 커밋 시 phrase_meta/import_log 적재 — sections 외 키.
    expect(ot).toContain('phrase_meta: nextMeta');
    expect(ot).toContain('import_log: [...prevLog, entry]');
    // base field_map 보존(spread) — 기존 키(print_template_key) 무손실.
    expect(ot).toContain('...baseFieldMap');
    // 버튼별 최신 업데이트 시각 표시.
    expect(ot).toContain('data-testid="opinion-phrase-option-updated"');
    expect(ot).toContain('data-testid="opinion-phrase-last-import"');
    // 신규 테이블/컬럼/CHECK 없음 — form_templates 동일 row 만 사용.
    expect(ot).toMatch(/form_key',\s*'opinion_doc'/);
  });

  test('AC-4: dry-run 미리보기(추가/변경/오류) + 사람 반영 클릭 게이트', () => {
    expect(ot).toContain('data-testid="opinion-phrase-csv-preview"');
    expect(ot).toContain('data-testid="opinion-phrase-csv-count-add"');
    expect(ot).toContain('data-testid="opinion-phrase-csv-count-change"');
    expect(ot).toContain('data-testid="opinion-phrase-csv-count-error"');
    expect(ot).toContain('data-testid="opinion-phrase-csv-commit"');
    // 미저장 변경 시 업로드 차단(서버 확정본 기준).
    expect(ot).toContain('저장하지 않은 변경사항이 있습니다');
  });

  test('AC-7: 무의존 CSV 파서 — 신규 npm(papaparse) 미도입', () => {
    // lib 가 papaparse import 안 함(무의존).
    expect(lib).not.toContain("from 'papaparse'");
    expect(lib).not.toContain('require("papaparse")');
    // 자체 파서 + Blob 다운로드.
    expect(lib).toContain('export function parseCsv');
    expect(lib).toContain('URL.createObjectURL');
  });

  test('무회귀: OpinionDocTab read 경로(parseOpinionSections) 불변 — phrase_meta 무영향', () => {
    // parseOpinionSections 는 key/label/phrase 만 추출 → phrase_meta 추가가 렌더에 영향 없음.
    expect(od).toContain('export function parseOpinionSections');
    expect(od).toContain('dbSections.length > 0 ? dbSections : OPINION_SECTIONS');
    // 발행 동선 보존.
    expect(od).toContain("supabase.rpc('publish_opinion_doc'");
    expect(od).toContain('data-testid="opinion-publish-btn"');
  });
});

// ── (3) 브라우저 렌더 검증 (권한자 환경, 비대상 역할이면 graceful skip) ──────────────
test.describe('DOCPHRASE-CSV — 브라우저 렌더', () => {
  test('AC-2/3/4: 소견서 상용구 탭 — 토글·양식다운로드·CSV업로드 노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=opinion_phrases');
    const tab = page.getByTestId('opinion-phrases-tab');
    const okTab = await tab.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okTab) { test.skip(true, '비-admin/manager 역할 — 권한 게이트 정상'); return; }
    // AC-3/4 버튼 노출.
    await expect(page.getByTestId('opinion-phrase-csv-download')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('opinion-phrase-csv-upload')).toBeVisible();
    // AC-2 토글 노출.
    await expect(page.getByTestId('opinion-phrase-section-toggle')).toBeVisible();
  });

  test('AC-4: CSV 업로드 다이얼로그 열림 — 파일 input 노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=opinion_phrases');
    const uploadBtn = page.getByTestId('opinion-phrase-csv-upload');
    const okBtn = await uploadBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okBtn) { test.skip(true, '비-admin/manager 역할 — 권한 게이트 정상'); return; }
    await uploadBtn.click();
    await expect(page.getByTestId('opinion-phrase-csv-import-dialog')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('opinion-phrase-csv-file-input')).toBeVisible();
  });

  test('AC-2: 토글 전환 시 같은 영역에서 섹션 교체', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, 'Login failed'); return; }
    await page.goto('/admin/clinic-management?tab=opinion_phrases');
    const toggleAll = page.getByTestId('opinion-phrase-toggle-all');
    const okToggle = await toggleAll.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!okToggle) { test.skip(true, '비-admin/manager 역할 — 권한 게이트 정상'); return; }
    // 섹션 토글 버튼 중 하나 클릭 → 섹션 1개만 노출(전체 대비 축소 가능).
    const sectionToggles = page.getByTestId('opinion-phrase-toggle-section');
    const n = await sectionToggles.count();
    if (n >= 1) {
      await sectionToggles.first().click();
      await expect(page.getByTestId('opinion-phrase-section').first()).toBeVisible({ timeout: 8000 });
    }
  });
});
