/**
 * T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME
 *
 * 치료테이블 탭 진열순서 재정렬 + 명칭변경 + '경과분석 플랜' 중첩 (순수 FE presentational, db_change=false).
 *
 * A. 탭 진열순서(왼→오): 진료(history) → 소견서·진단서(diagdoc) → 균검사(exam) → 피검사(blood) → 경과분석(progress).
 * B. '진료 환자 이력' 라벨 → '진료' (라벨만; 탭 key=history·라우팅·DoctorHistorySection 컴포넌트 불변).
 * C. 구 top-level '경과분석 플랜'(plan) 탭 → '경과분석'(progress) 하위 서브탭으로 중첩.
 *    콘텐츠 미합침 — 부모=경과분석, 하위 2서브탭 각각 유지:
 *      서브탭1 '경과분석'(targets=ProgressTargetsSection) / 서브탭2 '경과분석 플랜'(plan=ProgressPlansTab).
 *    value="plan"·testid=tab-progress-plans·testid=tab-progress-targets 전량 보존.
 *
 * 금지선: 각 탭 콘텐츠·기능 무회귀(배치/순서/명칭/중첩만), 청구/계산/데이터 무접촉.
 *
 * 정적(빌드 산출 소스) 검증 — presentational, DB 상태 미의존.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const treat = () => read('src/pages/TreatmentTable.tsx');

// TabsList(최상위 탭바) 영역만 잘라 트리거 진열순서를 정확히 검증.
function tabListBlock(): string {
  const src = treat();
  const start = src.indexOf('data-testid="treatment-section-tabs"');
  const end = src.indexOf('</TabsList>', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('A. 탭 진열순서 — 진료 → 소견서·진단서 → 균검사 → 피검사 → 경과분석', () => {
  test('최상위 탭바에서 5개 트리거가 목표 순서대로 진열', () => {
    const b = tabListBlock();
    const idxHistory = b.indexOf('data-testid="tab-doctor-history"');
    const idxDiag = b.indexOf('data-testid="tab-diagdoc"');
    const idxExam = b.indexOf('data-testid="tab-exam-targets"');
    const idxBlood = b.indexOf('data-testid="tab-blood-daily"');
    const idxProgress = b.indexOf('data-testid="tab-progress"');

    for (const [name, i] of Object.entries({ idxHistory, idxDiag, idxExam, idxBlood, idxProgress })) {
      expect(i, `${name} 트리거 부재`).toBeGreaterThan(-1);
    }
    // 왼→오 순서: 진료 < 소견서·진단서 < 균검사 < 피검사 < 경과분석
    expect(idxHistory).toBeLessThan(idxDiag);
    expect(idxDiag).toBeLessThan(idxExam);
    expect(idxExam).toBeLessThan(idxBlood);
    expect(idxBlood).toBeLessThan(idxProgress);
  });

  test('경과분석 플랜은 최상위 탭바에서 제거(하위 서브탭으로 이동)', () => {
    const b = tabListBlock();
    // 최상위 탭바 블록에는 plan 서브탭 트리거가 없어야 함(경과분석 부모만 노출).
    expect(b).not.toContain('data-testid="tab-progress-plans"');
    expect(b).not.toContain('data-testid="tab-progress-targets"');
  });
});

test.describe('B. 명칭변경 — 진료 환자 이력 → 진료 (라벨만)', () => {
  test('탭 라벨은 "진료", key/컴포넌트는 불변', () => {
    const t = treat();
    // 렌더 영역(TabsList)에 구 '진료 환자 이력' 라벨 소멸(주석 문서화 언급은 허용).
    expect(tabListBlock()).not.toContain('진료 환자 이력');
    // key·testid·컴포넌트 보존(라벨↔key 혼용 금지).
    expect(t).toContain('value="history"');
    expect(t).toContain('data-testid="tab-doctor-history"');
    expect(t).toContain('DoctorHistorySection');
  });

  test('진료 트리거 블록이 "진료" 라벨을 포함', () => {
    const t = treat();
    const trigStart = t.indexOf('data-testid="tab-doctor-history"');
    const trigEnd = t.indexOf('</TabsTrigger>', trigStart);
    const trig = t.slice(trigStart, trigEnd);
    expect(trig).toContain('진료');
  });
});

test.describe('C. 경과분석 플랜 → 경과분석 하위 서브탭 중첩', () => {
  test('경과분석(progress) 부모 탭 하위에 2서브탭(targets/plan) 중첩', () => {
    const t = treat();
    // 부모 = 경과분석(progress), 최상위 트리거 testid=tab-progress
    expect(t).toContain('data-testid="tab-progress"');
    // 하위 서브탭 컨테이너 + 서브탭 상태
    expect(t).toContain('data-testid="progress-subtabs"');
    expect(t).toContain('ProgressSubTab');
    expect(t).toContain('progressSub');
  });

  test('서브탭 value·testid·컴포넌트 전량 보존(콘텐츠 미합침)', () => {
    const t = treat();
    // 서브탭1 경과분석(targets) — 오늘 대상자
    expect(t).toContain('data-testid="tab-progress-targets"');
    expect(t).toContain('ProgressTargetsSection');
    // 서브탭2 경과분석 플랜(plan) — 설정. value="plan"·testid 보존.
    expect(t).toContain('value="plan"');
    expect(t).toContain('data-testid="tab-progress-plans"');
    expect(t).toContain('ProgressPlansTab');
    // 두 서브탭 라벨 각각 유지(합치지 않음)
    expect(t).toContain('경과분석 플랜');
  });

  test('서브탭 진열순서: 경과분석(targets) → 경과분석 플랜(plan)', () => {
    const t = treat();
    const subStart = t.indexOf('data-testid="progress-subtabs"');
    const subEnd = t.indexOf('</TabsList>', subStart);
    const sub = t.slice(subStart, subEnd);
    const idxTargets = sub.indexOf('data-testid="tab-progress-targets"');
    const idxPlan = sub.indexOf('data-testid="tab-progress-plans"');
    expect(idxTargets).toBeGreaterThan(-1);
    expect(idxPlan).toBeGreaterThan(-1);
    expect(idxTargets).toBeLessThan(idxPlan);
  });
});

test.describe('무회귀 — 콘텐츠/컴포넌트 배선 보존', () => {
  test('5개 탭 컨텐츠 컴포넌트가 모두 배선', () => {
    const t = treat();
    for (const comp of [
      'DoctorHistorySection',
      'DiagDocSection',
      'ExamTargetsSection',
      'BloodDailyListSection',
      'ProgressTargetsSection',
      'ProgressPlansTab',
    ]) {
      expect(t, `${comp} 배선 누락`).toContain(comp);
    }
  });

  test('SectionTab 타입에서 plan 제거(최상위 탭 아님) + progress 유지', () => {
    const t = treat();
    expect(t).toContain("type SectionTab = 'history' | 'diagdoc' | 'exam' | 'blood' | 'progress'");
  });
});
