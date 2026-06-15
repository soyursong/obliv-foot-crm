/**
 * E2E spec — T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN (문지은 대표원장, P2)
 * 진료차트(MedicalChartPanel) 처방내역 테이블 정렬·컬럼 정리 폴리시. ("내가 말한대로 100%")
 *
 * 100% FE presentation — 처방 데이터/저장/필드매핑/CRUD 동선 무변경.
 * 6 demand(AC1~AC6) 1:1:
 *   AC1 헤더 전부 가운데정렬(약이름(용량) 좌측→중앙)
 *   AC2 각 행 왼쪽 투여경로 색상 도트(●) 제거 — 선택/편집 동선 보존
 *   AC3 약이름(용량) 컬럼 폭을 용법 직전까지 최대화(나머지 흡수), 용법/횟수/일수 우측 고정
 *   AC4 약이름 뒤 회색 "용량"/"소량" dosage 라벨 표시 제거 — 데이터 무삭제, 이 테이블에서만 숨김
 *   AC5 용법/횟수/일수 균등 폭·가운데정렬
 *   AC6 셀 숫자전용 — 횟수 "3 회"→"3"(회 suffix 숨김) / 용법 "1일 3회"→"3","2~3회"→"2~3" / 일수 숫자, 셀 가운데정렬
 *
 * 검증 전략(기구현 presentation 검증 컨벤션):
 *   (A) rxFreqCore 순수함수 단위검증 — 용법 코어 추출/범위 보존(AC6).
 *   (B) MedicalChartPanel.tsx / RxCountInput.tsx 소스 정적 검증 — AC1~AC6 레이아웃 + 회귀 가드.
 *   (C) 실브라우저 라이브 렌더(seed) — ref_image 4약 시나리오 적재 후 6 demand 시각 검증 + 스크린샷.
 *       SUPABASE_SERVICE_ROLE_KEY 없으면 (C)만 환경 skip, (A)(B)는 항상 수행.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';
import { rxFreqCore } from '../../src/lib/rxFormat';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');
const RXCOUNT = () => SRC('components/admin/RxCountInput.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// (A) AC6 — rxFreqCore: frequency 자유텍스트 → 숫자/범위 코어 (presentation only)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('(A) AC6 rxFreqCore 용법 코어 추출', () => {
  test('한글 단위어를 벗기고 투여횟수 숫자/범위 코어만 남긴다(범위 ~ 손실 없음)', () => {
    // ref_image 4행 + 엣지
    expect(rxFreqCore('1일 3회')).toBe('3');
    expect(rxFreqCore('2~3회')).toBe('2~3');
    expect(rxFreqCore('1~2회')).toBe('1~2');
    expect(rxFreqCore('1회')).toBe('1');
    // 공백/축약/순수숫자/범위 공백 변형
    expect(rxFreqCore('1일3회')).toBe('3');
    expect(rxFreqCore('3회')).toBe('3');
    expect(rxFreqCore('3')).toBe('3');
    expect(rxFreqCore('2 ~ 3회')).toBe('2~3');
    expect(rxFreqCore('1일 2~3회')).toBe('2~3');
    // 빈값/단위어만 → 빈 문자열(텍스트 0)
    expect(rxFreqCore('')).toBe('');
    expect(rxFreqCore(null)).toBe('');
    expect(rxFreqCore(undefined)).toBe('');
    expect(rxFreqCore('필요시')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) 소스 정적 검증 — AC1~AC6 + 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('(B) 소스 정적 검증', () => {
  test('AC1: 컬럼 헤더 4종(약이름/용법/횟수/일수) 전부 text-center', () => {
    const src = PANEL();
    // 처방내역 테이블 thead 블록 추출
    const headStart = src.indexOf('<table className="w-full text-xs table-fixed">');
    expect(headStart).toBeGreaterThan(0);
    const headBlock = src.slice(headStart, headStart + 900);
    expect(headBlock).toMatch(/text-center px-3 py-1 font-medium">약이름 \(용량\)</);
    expect(headBlock).toMatch(/text-center px-2 py-1 font-medium w-16">용법</);
    expect(headBlock).toMatch(/text-center px-2 py-1 font-medium w-16">횟수</);
    expect(headBlock).toMatch(/text-center px-2 py-1 font-medium w-16">일수</);
    // 좌측정렬(text-left) 헤더 잔존 금지
    expect(headBlock).not.toMatch(/text-left[^>]*>약이름/);
  });

  test('AC2: 좌측 투여경로 색상 도트(rx-route-dot) + 도트 헬퍼 제거', () => {
    const src = PANEL();
    expect(src).not.toContain('rx-route-dot-');
    expect(src).not.toContain('aria-label={`투여경로');
    // 도트 전용 헬퍼/상수 정의 제거(noUnusedLocals 와도 정합) — 주석 언급은 허용, 실제 정의 부재로 판정
    expect(src).not.toContain('function rxItemStyle');
    expect(src).not.toContain('function rxRouteStyle');
    expect(src).not.toContain('const RX_ROUTE_STYLE');
  });

  test('AC3/AC5: 약이름 컬럼 폭 미지정(흡수) + 용법/횟수/일수 동일 w-16 + table-fixed', () => {
    const src = PANEL();
    expect(src).toContain('<table className="w-full text-xs table-fixed">');
    // 용법/횟수/일수 3컬럼 모두 동일 폭 w-16 (균등)
    const heads = src.match(/font-medium w-16">(용법|횟수|일수)</g) ?? [];
    expect(heads.length).toBe(3);
  });

  test('AC4: 약이름 셀에서 dosage 입력(rx-dosage)·용량 라벨 제거, 약이름만 표시', () => {
    const src = PANEL();
    expect(src).not.toContain('rx-dosage-');
    expect(src).not.toContain('aria-label="용량"');
    expect(src).not.toContain('placeholder="용량"');
    // 약이름 셀은 item.name span 만 (rx-name testid)
    expect(src).toMatch(/data-testid=\{`rx-name-\$\{idx\}`\}>\{item\.name\}/);
    // 데이터 무삭제 회귀 가드: dosage 필드 자체(updateRxItem dosage 경로)는 코드에 보존
    expect(src).toContain("updateRxItem(idx: number, field: 'frequency' | 'days' | 'dosage', value: string)");
  });

  test('AC6: 용법=rxFreqCore 코어 표시 + 셀 가운데정렬 + 일수 숫자전용(placeholder 텍스트 제거)', () => {
    const src = PANEL();
    // 용법 셀: 입력 input 이 아니라 rxFreqCore 코어를 가운데정렬로 표시
    expect(src).toMatch(/<td className="px-2 py-1 align-middle text-center" data-testid=\{`rx-frequency-\$\{idx\}`\}>\s*\{rxFreqCore\(item\.frequency\)\}/);
    // 일수 input: 가운데정렬 + 단위/플레이스홀더 텍스트 제거
    expect(src).toMatch(/value=\{item\.days\}[\s\S]{0,260}text-center[\s\S]{0,120}placeholder=""[\s\S]{0,80}data-testid=\{`rx-days-\$\{idx\}`\}/);
    expect(src).not.toContain('placeholder="일수"');
  });

  test('AC6: RxCountInput hideSuffix 시 "회" suffix 숨김(타 surface 기본 표시 유지)', () => {
    const panel = PANEL();
    const rxc = RXCOUNT();
    // 차트 호출부는 hideSuffix 전달
    expect(panel).toMatch(/<RxCountInput[\s\S]{0,320}hideSuffix/);
    // 컴포넌트: hideSuffix prop 가드 + 기본(false) 시 종전대로 '회' suffix 표시
    expect(rxc).toContain('hideSuffix?: boolean');
    expect(rxc).toMatch(/\{!hideSuffix && \(/);
    expect(rxc).toContain('data-testid="rx-count-suffix"');
  });

  test('회귀 가드: EDITMODE focus-border 제거 + DIAG-RX 테두리 제거 + CRUD 삭제버튼 보존', () => {
    const src = PANEL();
    // EDITMODE AC-12 focus-visible 테두리 제거(97524b8) 유지
    expect(src).toContain('[&_input]:focus-visible:ring-0');
    expect(src).toContain('[&_input]:focus-visible:outline-none');
    // DIAG-RX AC-4 input/button border 제거 유지
    expect(src).toMatch(/\[&_input\]:border-0[\s\S]{0,400}data-testid="prescription-items-table"/);
    // 행 삭제(CRUD) 동선 보존
    expect(src).toContain('aria-label="처방 항목 삭제"');
    expect(src).toContain("setFormRx(prev => prev.filter((_, i) => i !== idx))");
    // 행 구분선(EDITMODE) 유지
    expect(src).toMatch(/border-b border-gray-200 last:border-b-0[\s\S]{0,80}data-testid=\{`prescription-row-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) 실브라우저 라이브 렌더 — ref_image 4약 시나리오 + 스크린샷
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';
const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E처방정렬${SUFFIX}`;
const SET_NAME = `E2E세트정렬${SUFFIX}`;

// ref_image 4행 재현 (이름/용량/용법/횟수/일수)
const REF_ITEMS = [
  { name: '플루스칸캡슐150밀리그램(플루코나졸)_(0.15g/1캡슐)', dosage: '용량', route: '경구', frequency: '1일 3회', count: 3, days: 3 },
  { name: '에스로반연고(무피로신)10g', dosage: '소량', route: '외용', frequency: '2~3회', count: 3, days: 1 },
  { name: '하이트리크림 20g', dosage: '용량', route: '외용', frequency: '1~2회', count: 3, days: 1 },
  { name: '외용액', dosage: '소량', route: '외용', frequency: '1회', count: 3, days: 1 },
];

interface SeedIds { customerId: string; setId: number; }
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

async function openChartWithRx(page: Page): Promise<void> {
  await page.goto(`/chart/${seed!.customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('right-panel-tab-rx').click();
  await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });
  // 차트 surface picker는 searchable=false + 폴더 기본 전체 접힘 → folder(미지정='미분류') 폴더를 펼쳐 세트 노출.
  const folderNode = page.getByTestId('rx-set-folder-node').filter({ hasText: '미분류' }).first();
  await folderNode.getByTestId('rx-set-folder-toggle').click();
  const opt = page.getByTestId('rx-set-option').filter({ hasText: SET_NAME }).first();
  await opt.scrollIntoViewIfNeeded();
  await opt.click();
  await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('prescription-items-table').locator('tbody tr')).toHaveCount(4);
}

test.describe('(C) 라이브 렌더 — ref_image 4약 6 demand 시각 검증', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: clinic } = await admin.from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (!clinic) return;
    const { data: cust } = await admin.from('customers')
      .insert({ clinic_id: clinic.id, name: CUST_NAME, phone: `+82109${SUFFIX}` })
      .select('id').single();
    const { data: set } = await admin.from('prescription_sets')
      .insert({ name: SET_NAME, items: REF_ITEMS.map(i => ({ ...i, notes: '' })), is_active: true, sort_order: 9151 })
      .select('id').single();
    if (cust && set) seed = { customerId: cust.id as string, setId: set.id as number };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('prescription_sets').delete().eq('id', seed.setId);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음/seed 실패 — 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  test('6 demand 시각 검증 + 스크린샷', async ({ page }) => {
    await openChartWithRx(page);
    const table = page.getByTestId('prescription-items-table');

    // AC2: 좌측 색상 도트 없음
    await expect(page.locator('[data-testid^="rx-route-dot-"]')).toHaveCount(0);
    // AC4: dosage 입력/용량 라벨 없음 (이 테이블에서)
    await expect(page.locator('[data-testid^="rx-dosage-"]')).toHaveCount(0);
    // AC1: 헤더 가운데정렬
    for (const h of ['약이름 (용량)', '용법', '횟수', '일수']) {
      await expect(table.locator('thead th', { hasText: h })).toHaveClass(/text-center/);
    }
    // AC6: 용법 셀 숫자/범위 코어 (1일 3회→3, 2~3회→2~3, 1~2회→1~2, 1회→1)
    await expect(page.getByTestId('rx-frequency-0')).toHaveText('3');
    await expect(page.getByTestId('rx-frequency-1')).toHaveText('2~3');
    await expect(page.getByTestId('rx-frequency-2')).toHaveText('1~2');
    await expect(page.getByTestId('rx-frequency-3')).toHaveText('1');
    // AC6: 횟수 '회' suffix 없음 + 입력값 숫자만
    await expect(page.locator('[data-testid="rx-count-suffix"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="rx-count-input"]').first()).toHaveValue('3');
    // AC6: 일수 숫자만
    await expect(page.getByTestId('rx-days-0')).toHaveValue('3');
    await expect(page.getByTestId('rx-days-1')).toHaveValue('1');
    // 약이름은 그대로 표시(데이터 무삭제)
    await expect(table).toContainText('플루스칸캡슐150밀리그램');

    await table.screenshot({ path: 'evidence/T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN_table.png' });
    await page.getByTestId('medical-chart-drawer').screenshot({ path: 'evidence/T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN_drawer.png' });
  });

  test('회귀: 행 삭제(CRUD) + 횟수/일수 인라인 편집 동선 보존', async ({ page }) => {
    await openChartWithRx(page);
    // 횟수/일수 인라인 편집 (RX-CHART-ENHANCE 보존)
    const days0 = page.getByTestId('rx-days-0');
    if (!(await days0.isDisabled())) {
      await days0.fill('5');
      await expect(days0).toHaveValue('5');
    }
    // 행 삭제: 4 → 3
    const rows = page.getByTestId('prescription-items-table').locator('tbody tr');
    await rows.first().getByRole('button', { name: '처방 항목 삭제' }).click();
    await expect(rows).toHaveCount(3);
  });
});
