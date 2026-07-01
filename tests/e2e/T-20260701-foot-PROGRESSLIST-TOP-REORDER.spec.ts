/**
 * E2E spec — T-20260701-foot-PROGRESSLIST-TOP-REORDER
 *
 * 요청(reporter=김주연 총괄, foot C0ATE5P6JTH): 치료테이블 > 경과분석 탭에서
 *   경과분석 환자 '리스트' 섹션을 화면 최상단으로 이동. 최근 배포(T-20260630-...-WIDGETS)로 추가된
 *   위젯/표는 제거하지 말고 리스트 아래에 유지.
 *
 * 성격: 순수 FE 컴포넌트 렌더 순서 변경. DDL 0, 비즈로직 0. risk_verdict=GO.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 앱 로드(HTTP 200) + 컴포넌트 소스 렌더 순서 정적 가드
 *   (리스트가 위젯보다 소스상 먼저 마운트) + 위젯 보존(제거 X) + 기능 회귀 가드.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const progressSection = () => read('src/components/treatment/ProgressTargetsSection.tsx');

test.describe('T-20260701-foot-PROGRESSLIST-TOP-REORDER', () => {
  // 회귀 가드: 앱 정상 로드 (콘솔 치명 에러 0)
  test('앱 정상 로드 — HTTP 200 + 콘솔 치명 에러 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    await page.waitForTimeout(500);
    const fatal = errors.filter((e) => /is not defined|cannot read|undefined is not|SyntaxError|TypeError/i.test(e));
    expect(fatal).toEqual([]);
  });

  // ── AC1: 리스트가 화면 최상단(위젯보다 소스상 먼저 렌더) ──────────────────────
  test('AC1: 경과분석 리스트가 위젯/표 섹션보다 먼저 렌더된다', () => {
    const s = progressSection();
    const listIdx = s.indexOf('data-testid="progress-targets-table"');
    const listHeadingIdx = s.indexOf('data-testid="progress-targets-count"');
    const widgetIdx = s.indexOf('<ProgressAnalyticsWidgets');
    expect(listIdx).toBeGreaterThan(-1);
    expect(widgetIdx).toBeGreaterThan(-1);
    // 리스트(테이블/카운트 헤더)가 위젯 마운트보다 소스상 앞선다 = 화면 최상단.
    expect(listIdx).toBeLessThan(widgetIdx);
    expect(listHeadingIdx).toBeLessThan(widgetIdx);
  });

  // ── AC2: 위젯/표 섹션은 제거되지 않고 리스트 아래에 유지 ──────────────────────
  test('AC2: 위젯/표 섹션(ProgressAnalyticsWidgets)이 제거되지 않고 유지된다', () => {
    const s = progressSection();
    expect(s).toContain("import ProgressAnalyticsWidgets from '@/components/treatment/ProgressAnalyticsWidgets'");
    expect(s).toContain('<ProgressAnalyticsWidgets');
    // 위젯에 넘기는 read-only props 보존(집계 회귀 0).
    expect(s).toContain('cohortRows={rows}');
    expect(s).toContain('cohortLoading={isLoading}');
    expect(s).toContain('date={date}');
  });

  // ── AC3: 리스트 기존 정렬/필터/행 렌더 기능 회귀 없음 ─────────────────────────
  test('AC3: 리스트 정렬/행 렌더/이름 인터랙션 회귀 없음', () => {
    const s = progressSection();
    // 예약시각 오름차순 정렬(치료 흐름순) 보존.
    expect(s).toContain(".order('reservation_time', { ascending: true })");
    // 행/테이블 렌더 보존.
    expect(s).toContain('data-testid="progress-targets-row"');
    expect(s).toContain('data-testid="progress-targets-table"');
    // 이름 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 보존.
    expect(s).toContain('nameInteraction.onLeftClick');
    expect(s).toContain('nameInteraction.onContextMenu');
  });

  // ── AC4: 동일 surface 티켓(발행 버튼) 기능 보존 — 순서변경으로 인한 유실 없음 ──
  test('AC4: 발행 버튼/일괄처리(DOCISSUE-BTN) 요소 보존', () => {
    const s = progressSection();
    expect(s).toContain('data-testid="progress-issue-btn"');
    expect(s).toContain('data-testid="progress-bulk-action-btn"');
    expect(s).toContain('data-testid="progress-selectall-checkbox"');
    expect(s).toContain('data-testid="progress-row-checkbox"');
  });

  // ── AC5: 레이아웃 컨테이너 보존 — 겹침/잘림 방지(flex 세로 스택 유지) ─────────
  test('AC5: 섹션 컨테이너/세로 스택 레이아웃 보존', () => {
    const s = progressSection();
    // 최외곽 섹션 컨테이너는 세로 flex gap 유지(겹침 방지).
    expect(s).toContain('data-testid="progress-targets-section"');
    expect(s).toContain('flex flex-col gap-4');
    // 리스트/위젯 단일 부모 아래 세로 배치 — 순서만 바뀌고 구조 동일.
    const openTags = (s.match(/data-testid="progress-targets-section"/g) ?? []).length;
    expect(openTags).toBe(1);
  });
});
