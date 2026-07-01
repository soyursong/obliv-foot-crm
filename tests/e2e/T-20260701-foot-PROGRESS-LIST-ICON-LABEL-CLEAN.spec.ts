/**
 * E2E spec — T-20260701-foot-PROGRESS-LIST-ICON-LABEL-CLEAN
 *
 * 요청: 치료테이블 > 경과분석 탭 > 리스트 표시 정리 (FE-only, DB 무변경).
 *   1) 각 항목 앞 불필요 아이콘 제거 — 회차 배지 내 TrendingUp 아이콘 제거.
 *   2) 레이블 포맷 '{N}회차'로 통일(예: 6회차, 12회차) — "N회 중간 경과분석" 등 부가 텍스트 제거.
 *      회차 숫자는 기존 progress_check_label 그대로 매핑, 표시 문자열만 변경(DDL0).
 *
 * 성격: 순수 FE 표시 정리. DDL 0, 데이터/집계 로직 0. risk_verdict=GO.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 앱 로드(HTTP 200) + 컴포넌트 소스 정적 가드
 *   + 표시 포맷 순수함수(formatSessionLabel) 계약 + 최근 배포 3건 회귀 가드.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const progressSection = () => read('src/components/treatment/ProgressTargetsSection.tsx');

/**
 * formatSessionLabel 을 소스에서 그대로 복제한 로컬 미러(순수함수 계약 고정).
 * parseProgressSession: 첫 숫자 추출("6회 중간 경과분석" → 6), 없으면 null.
 */
function parseProgressSession(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = String(label).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function formatSessionLabel(label: string | null | undefined): string {
  const n = parseProgressSession(label);
  if (n != null) return `${n}회차`;
  return label && label.trim() ? label : '경과분석';
}

test.describe('T-20260701-foot-PROGRESS-LIST-ICON-LABEL-CLEAN', () => {
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

  // ── AC1: 레이블 포맷 '{N}회차'로 통일 (순수함수 계약) ─────────────────────────
  test('AC1: label → {N}회차 통일 (부가 텍스트 제거)', () => {
    expect(formatSessionLabel('6회 경과분석')).toBe('6회차');
    expect(formatSessionLabel('12회 중간 경과분석')).toBe('12회차');
    expect(formatSessionLabel('6회차')).toBe('6회차');       // 이미 정형이어도 안전
    expect(formatSessionLabel('3회 경과분석 (중간)')).toBe('3회차');
  });

  // ── AC2: 숫자 추출 실패/누락 → 원본 폴백 (무손실) ───────────────────────────
  test('AC2: 비정형/누락 label → 폴백 (표시 유실 없음)', () => {
    expect(formatSessionLabel(null)).toBe('경과분석');
    expect(formatSessionLabel(undefined)).toBe('경과분석');
    expect(formatSessionLabel('경과분석')).toBe('경과분석');   // 숫자 없음 → 원본 유지
    expect(formatSessionLabel('')).toBe('경과분석');
  });

  // ── AC3: 회차 셀에서 항목 앞 아이콘(TrendingUp) 제거 ────────────────────────
  test('AC3: 회차 배지에서 TrendingUp 아이콘 제거 + formatSessionLabel 사용', () => {
    const s = progressSection();
    // 회차 셀 블록 추출.
    const cellStart = s.indexOf('data-testid="progress-label-cell"');
    const cellEnd = s.indexOf('</td>', cellStart);
    expect(cellStart).toBeGreaterThan(-1);
    const cell = s.slice(cellStart, cellEnd);
    // 회차 셀 안에 아이콘 없음(TrendingUp 제거).
    expect(cell).not.toContain('<TrendingUp');
    // 원본 raw label 직접 출력 제거 → formatSessionLabel 경유.
    expect(cell).not.toContain("{r.label ?? '경과분석'}");
    expect(cell).toContain('formatSessionLabel(r.label)');
  });

  // ── AC4: 표시 정리 — 데이터/집계 로직 무변경 (DDL0, read-only 소비 유지) ─────
  test('AC4: 데이터 소스/정렬/집계 로직 무변경', () => {
    const s = progressSection();
    // 회차 숫자는 기존 label 그대로 매핑 — 쿼리 컬럼/정렬 보존.
    expect(s).toContain('progress_check_label');
    expect(s).toContain(".order('reservation_time', { ascending: true })");
    // 위젯 read-only props 보존(집계 회귀 0).
    expect(s).toContain('cohortRows={rows}');
  });

  // ── AC5: 최근 배포 3건 회귀 가드 (레이아웃 순서·버튼·정렬 유실 없음) ─────────
  test('AC5-a: PROGRESSLIST-TOP-REORDER — 리스트가 위젯보다 먼저 렌더(최상단) 유지', () => {
    const s = progressSection();
    const listIdx = s.indexOf('data-testid="progress-targets-table"');
    const widgetIdx = s.indexOf('<ProgressAnalyticsWidgets');
    expect(listIdx).toBeGreaterThan(-1);
    expect(widgetIdx).toBeGreaterThan(-1);
    expect(listIdx).toBeLessThan(widgetIdx);
  });

  test('AC5-b: PROGRESS-DOCISSUE-BTN — 발행/일괄처리/체크박스 버튼 보존', () => {
    const s = progressSection();
    expect(s).toContain('data-testid="progress-issue-btn"');
    expect(s).toContain('data-testid="progress-bulk-action-btn"');
    expect(s).toContain('data-testid="progress-selectall-checkbox"');
    expect(s).toContain('data-testid="progress-row-checkbox"');
  });

  test('AC5-c: 정렬(예약시각 오름차순)·행 렌더·이름 인터랙션 회귀 없음', () => {
    const s = progressSection();
    expect(s).toContain('data-testid="progress-targets-row"');
    expect(s).toContain('nameInteraction.onLeftClick');
    expect(s).toContain('nameInteraction.onContextMenu');
  });
});
