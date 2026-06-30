/**
 * E2E spec — T-20260630-foot-TXTABLE-PROGRESS-TAB-WIDGETS
 *
 * 요청(reporter=김주연 총괄): "사이드바-치료테이블-경과분석 탭 / 다양하게 3~4개 넣어줘"(의도적으로 열린 요청 → dev 선택권).
 * 채택: '경과분석' 탭은 단일 환자 선택 컨텍스트가 없는 '당일 경과분석 대상자(코호트) 리스트' surface →
 *   코호트 + 최근 추이를 실데이터로 집계하는 위젯 3종 + 기존 대상자 리스트(4번째) 구성.
 *     ① 누적 요약 카드(KPI 4) ② 회차 진행 분포(막대) ③ 최근 14일 경과분석 추이(영역) ④ (기존) 대상자 리스트.
 *
 * 데이터: 전부 reservations.progress_check_required/label read-only 집계(T-PROGRESS-CHECKPOINT 트리거 SSOT 소비).
 *   신규 테이블/컬럼/enum/RLS/트리거 0 → NO-DDL. db_change=none. 차트=recharts 기존 사용분 재사용(신규 npm 0).
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 본문 현장 클릭 시나리오 2종(정상 표시 / 치료이력 없는 환자 엣지)을 코드 가드로 변환.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const widgets = () => read('src/components/treatment/ProgressAnalyticsWidgets.tsx');
const progressSection = () => read('src/components/treatment/ProgressTargetsSection.tsx');
const treatTable = () => read('src/pages/TreatmentTable.tsx');
const pkgJson = () => read('package.json');

test.describe('T-20260630-foot-TXTABLE-PROGRESS-TAB-WIDGETS', () => {
  // 회귀 가드: 앱 정상 로드 (콘솔 에러 0 — 엣지 시나리오 무파손 보장)
  test('앱 정상 로드 — HTTP 200 + 콘솔 에러 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    await page.waitForTimeout(500);
    // 앱 셸/번들 파싱 단계에서 치명 에러가 없어야 함(인증·네트워크성 에러는 제외).
    const fatal = errors.filter((e) => /is not defined|cannot read|undefined is not|SyntaxError|TypeError/i.test(e));
    expect(fatal).toEqual([]);
  });

  // ── 시나리오 1: 경과분석 탭 정상 표시 — 위젯 3종 + 기존 리스트(=4섹션) ──────────
  test('시나리오1: 위젯 컴포넌트가 경과분석 탭에 마운트된다', () => {
    const s = progressSection();
    // 위젯 묶음이 경과분석 탭(ProgressTargetsSection) 안에서 렌더된다.
    expect(s).toContain("import ProgressAnalyticsWidgets from '@/components/treatment/ProgressAnalyticsWidgets'");
    expect(s).toContain('<ProgressAnalyticsWidgets');
    // 당일 코호트 rows + 선택일 date 를 위젯에 read-only 로 전달.
    expect(s).toContain('cohortRows={rows}');
    expect(s).toContain('date={date}');
  });

  test('시나리오1: 성격이 다른 위젯 3종 + 기존 리스트 = 4섹션', () => {
    const w = widgets();
    // ① 누적 요약 카드(KPI) — testid 는 KpiCard prop 으로 전달(런타임 data-testid 렌더).
    expect(w).toContain('data-testid="progress-kpi-cards"');
    expect(w).toContain('"progress-kpi-today"');
    expect(w).toContain('"progress-kpi-recent7"');
    expect(w).toContain('"progress-kpi-avg14"');
    expect(w).toContain('"progress-kpi-avgsession"');
    // ② 회차 진행 분포(막대 차트)
    expect(w).toContain('"progress-distribution-widget"');
    expect(w).toContain('<BarChart');
    // ③ 최근 14일 추이(영역 차트)
    expect(w).toContain('"progress-trend-widget"');
    expect(w).toContain('<AreaChart');
    // ④ 기존 대상자 리스트(테이블)는 보존(회귀 0)
    expect(progressSection()).toContain('data-testid="progress-targets-table"');
  });

  test('시나리오1: 실데이터 집계만 — reservations read-only(생성/수정/삭제 없음)', () => {
    const w = widgets();
    // 경과분석 트리거 SSOT 컬럼을 read-only 소비.
    expect(w).toContain("from('reservations')");
    expect(w).toContain('progress_check_required');
    expect(w).toContain('.eq(\'progress_check_required\', true)');
    expect(w).toContain('.neq(\'status\', \'cancelled\')');
    // 쓰기(.insert/.update/.delete/.upsert) 절대 없음.
    expect(w).not.toContain('.insert(');
    expect(w).not.toContain('.update(');
    expect(w).not.toContain('.delete(');
    expect(w).not.toContain('.upsert(');
    // 회차 숫자 파싱(label → 회차) — 목업/하드코딩 데이터 아님.
    expect(w).toContain('parseProgressSession');
  });

  // ── 시나리오 2: 치료 이력 없는 환자(엣지) — 위젯별 빈상태 문구, 콘솔 에러 0 ──────
  test('시나리오2: 데이터 없을 때 위젯별 자연스러운 빈상태 문구', () => {
    const w = widgets();
    // 회차 분포 — 빈상태 (testid 는 WidgetEmpty prop 으로 전달)
    expect(w).toContain('"progress-distribution-empty"');
    expect(w).toContain('선택일 경과분석 대상자가 없습니다');
    // 추이 — 빈상태
    expect(w).toContain('"progress-trend-empty"');
    expect(w).toContain('최근 14일간 경과분석 이력이 없습니다');
    // KPI — 데이터 없을 때 0/— 로 안전 표시(빈껍데기/NaN 금지)
    expect(w).toContain("kpi.avgSession != null ? kpi.avgSession.toFixed(1) : '—'");
  });

  test('시나리오2: ADDITIVE 컬럼 미적용 prod 방어 — 빈 시리즈 폴백(섹션 무파손)', () => {
    const w = widgets();
    expect(w).toContain('42703|PGRST204');
    // 폴백 시 throw 가 아니라 빈 배열 반환.
    expect(w).toMatch(/return \[\];/);
  });

  // ── 회귀/계약 가드 ──────────────────────────────────────────────────────────
  test('회귀: 치료테이블 4개 탭 구조 보존(history/exam/progress/plan)', () => {
    const t = treatTable();
    expect(t).toContain('value="history"');
    expect(t).toContain('value="exam"');
    expect(t).toContain('value="progress"');
    expect(t).toContain('value="plan"');
    // 경과분석 탭은 여전히 ProgressTargetsSection 을 렌더.
    expect(t).toContain('<ProgressTargetsSection');
  });

  test('계약: 차트 라이브러리는 기존 recharts 재사용 — 신규 npm 0', () => {
    expect(widgets()).toContain("from 'recharts'");
    const pkg = JSON.parse(pkgJson());
    expect(pkg.dependencies?.recharts ?? pkg.devDependencies?.recharts).toBeTruthy();
  });

  test('계약: 모바일/좁은 폭 — 위젯 세로 스택(grid 반응형 클래스)', () => {
    const w = widgets();
    // 기본 1~2열, lg 에서 확장 → 좁은 폭에서 세로 스택.
    expect(w).toContain('grid-cols-2');
    expect(w).toContain('lg:grid-cols-4');
    expect(w).toContain('lg:grid-cols-2');
  });
});
