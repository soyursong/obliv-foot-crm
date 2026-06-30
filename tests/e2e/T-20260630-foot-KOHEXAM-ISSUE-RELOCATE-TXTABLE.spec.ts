/**
 * E2E spec — T-20260630-foot-KOHEXAM-ISSUE-RELOCATE-TXTABLE [3] (재스펙 4q0l)
 *
 * 치료테이블 '균검사 & 피검사 대상자' 탭(ExamTargetsSection) — 균검사·피검사 분리 표기:
 *   reporter(김주연 총괄, MSG-20260630-212518-4q0l) "균검사, 피검사를 한 줄에서
 *   두 줄 또는 분단으로 분리 표기(한 줄 안에서 분단 가능하면 그것도 OK)".
 *   → 현행: 한 <td> 안에서 균검사·피검사가 가로(flex-wrap)로 섞여 표기.
 *   → 변경: 세로 2줄 스택(flex-col) + 피검사 줄 상단 점선 구분 — 한 줄에 섞여 보이지 않게.
 *
 * 범위: 치료테이블(치료사 영역) — §11 의사 공간 게이트 비대상. ADDITIVE UI, 데이터/DB 무변경.
 *   ([1] 발급 UI 진료대시보드→치료테이블 이전 / [2] 진료대시보드 read-only 축소는
 *    KohReportTab·DoctorCallDashboard(의사 공간) 건드림 → §11 medical_confirm_gate 별도 — 본 spec 범위 외.)
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 현장 클릭 시나리오(7번 스텝)를 코드 가드로 변환. NO-DDL. db_change=false.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('T-20260630-foot-KOHEXAM-ISSUE-RELOCATE-TXTABLE [3] 균검사·피검사 분리 표기', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── [3] 분리 표기: 세로 2줄 스택 ────────────────────────────────────────────
  test('[3] 균검사·피검사가 세로 2줄(flex-col)로 분리 — 가로 한 줄 섞임(flex-wrap) 회귀가드', () => {
    const b = sectionB();
    // 결과 영역 래퍼 = 세로 스택(2줄 분리)
    expect(b).toContain('data-testid="exam-result-stack"');
    expect(b).toContain('flex flex-col gap-1');
    // 회귀가드: 균검사·피검사를 한 줄에 가로로 섞던 flex-wrap 컨테이너가 사라졌는지
    expect(b).not.toContain('flex flex-wrap items-center gap-x-3 gap-y-1');
  });

  test('[3] 균검사 줄 / 피검사 줄 = 독립 그룹 + 피검사 줄 점선 시각 구분', () => {
    const b = sectionB();
    // 두 검사 그룹이 각각 별도 줄(그룹)로 존재
    expect(b).toContain('data-testid="exam-koh-group"');
    expect(b).toContain('data-testid="exam-blood-group"');
    // 피검사 줄 상단 점선 구분(두 줄 시각 분리) — 한 줄에 섞여 보이지 않게
    // (className 이 data-testid 보다 먼저 오므로 border → exam-blood-group 순으로 인접 매칭)
    expect(b).toMatch(/border-t border-dashed[\s\S]{0,80}?data-testid="exam-blood-group"/);
  });

  // ── 회귀: 기존 콘텐츠/동작 보존 ─────────────────────────────────────────────
  test('회귀: 배지·검사결과 동작·이름 인터랙션 전부 보존(레이아웃만 변경)', () => {
    const b = sectionB();
    // 균검사/피검사 배지 + 결과 동작 버튼 유지
    expect(b).toContain('exam-koh-badge');
    expect(b).toContain('exam-blood-badge');
    expect(b).toContain('data-testid="exam-koh-result-view"');
    expect(b).toContain('data-testid="exam-koh-result-new"');
    expect(b).toContain('data-testid="exam-blood-result-upload"');
    expect(b).toContain('data-testid="exam-blood-result-view"');
    // 이름 좌/우클릭 위임 보존
    expect(b).toContain('nameInteraction.onLeftClick(r.customerId)');
    expect(b).toContain('nameInteraction.onContextMenu');
  });

  test('회귀: NO-DDL read-only 보존 — insert/update/publish RPC 직접 호출 0(데이터 무변경)', () => {
    const b = sectionB();
    expect(b).not.toContain('.insert(');
    expect(b).not.toContain('.update(');
    expect(b).not.toContain("rpc('publish");
    // ADDITIVE 컬럼 미적용 prod 폴백 보존
    expect(b).toMatch(/42703/);
    expect(b).toContain('data-testid="exam-targets-empty"');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 — 티켓 시나리오1 스텝7):
 *   1. 로그인 → '치료 테이블' → '균검사 & 피검사 대상자' 탭 → 날짜 그룹 펼침
 *   2. 각 환자 행에서 '균검사' 줄과 '피검사' 줄이 위/아래 두 줄로 분리되어
 *      한 줄에 섞여 보이지 않는 것 확인(피검사 줄 위 점선 구분).
 *   3. 균검사/피검사 배지·결과 보기/생성/업로드 동작은 종전과 동일하게 작동.
 *
 * 비고: 치료테이블 영역(§11 비대상). NO-DDL. db_change=false. ADDITIVE UI(레이아웃만).
 *   [1] 발급 UI 이전 / [2] 진료대시보드 read-only = 의사 공간 → §11 medical_confirm_gate 별도(본 spec 범위 외).
 */
