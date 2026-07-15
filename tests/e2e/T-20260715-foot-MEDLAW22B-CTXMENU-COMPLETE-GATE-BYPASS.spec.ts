/**
 * E2E spec — T-20260715-foot-MEDLAW22B-CTXMENU-COMPLETE-GATE-BYPASS
 *
 * 우클릭(컨텍스트 메뉴) 상태변경 → '완료' 경로가 급여 진료기록 하드차단
 * 게이트(MEDLAW22-B-GATE)를 우회하던 게이트 불일치 해소.
 *
 * RC(dev-foot 코드 근거, RC-REPRO MSG-162255-p1cp):
 *   - 드래그 경로(handleDragEnd else-branch) → newStatus==='done' 분기에서
 *     evaluateMedicalRecordGate(row) 호출 → 급여 진료기록 없으면 완료 하드블록.
 *   - 우클릭 경로(handleContextStatusChange) → 게이트 미호출 →
 *     급여 진료기록 없이도 완료 가능(우회). payments 이슈와 직교하는 별건.
 *
 * AC(티켓 §):
 *   AC-1 우클릭 완료 경로에도 드래그와 동일 조건·메시지로 evaluateMedicalRecordGate 적용.
 *   AC-2 게이트 조건(급여 여부·진료기록 정의)은 기존 evaluateMedicalRecordGate 로직 재사용
 *        — 신규 정의/재해석 금지. 비급여 건 불필요 하드블록 금지(드래그와 identical).
 *   AC-3 진료기록 있는 급여 완료 / 비급여 완료 정상 통과. 회귀 0.
 *
 * 검증 전략: 기존 MEDLAW22-B-GATE spec 과 동일 — 배선·정책은 소스 정적 가드
 *   (auth/DB 라이브 비의존). 게이트 판정 로직 자체는 medicalRecordGate lib 소유이며
 *   본 티켓은 '우클릭 진입점 배선 누락'만 고치므로, 배선 정합을 회귀 고정한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DASH = () => SRC('pages/Dashboard.tsx');

/** handleContextStatusChange 함수 본문만 잘라낸다(다음 핸들러 선언 전까지). */
function ctxHandlerBody(src: string): string {
  const start = src.indexOf('const handleContextStatusChange');
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  // 다음 핸들러(handleContextConsultStatusChange) 선언 전까지가 본 함수 범위.
  const end = rest.indexOf('const handleContextConsultStatusChange');
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 우클릭 완료 경로에 게이트 배선 (드래그와 동일 조건·메시지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 우클릭 완료 경로 게이트 배선', () => {
  test('handleContextStatusChange 의 done 분기에서 evaluateMedicalRecordGate(ci) 평가', () => {
    const body = ctxHandlerBody(DASH());
    // done 완료 시 게이트 평가 (드래그는 row, 우클릭은 ci 인자)
    expect(body).toMatch(/if\s*\(newStatus === 'done'\)\s*\{[\s\S]*evaluateMedicalRecordGate\(ci\)/);
  });

  test('blocked 시 return 으로 abort — 낙관적 업데이트(setRows) 이전', () => {
    const body = ctxHandlerBody(DASH());
    const gateIdx = body.indexOf('evaluateMedicalRecordGate(ci)');
    const firstSetRows = body.indexOf('setRows(');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(firstSetRows).toBeGreaterThan(-1);
    // 게이트 평가·abort 가 첫 setRows(낙관적 업데이트)보다 먼저 위치 → DB write/UI mutate 전 차단.
    expect(gateIdx).toBeLessThan(firstSetRows);
    // blocked 시 return
    const afterGate = body.slice(gateIdx);
    expect(afterGate).toMatch(/gate\.blocked[\s\S]*?return;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 기존 로직 재사용(신규 정의 없음) + 드래그와 identical
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 로직 재사용 / 드래그와 identical', () => {
  test('신규 게이트 정의/재해석 금지 — evaluateMedicalRecordGate 재사용만, 자체 급여판정 없음', () => {
    const body = ctxHandlerBody(DASH());
    // 컨텍스트 핸들러 내부에서 getTaxClass·loadFootBillingItems 등 급여 판정을 재구현하지 않음.
    //   (게이트 판정·하드차단 override 부재는 medicalRecordGate lib spec 소유 — 여기선 배선만.)
    expect(body).not.toMatch(/getTaxClass|loadFootBillingItems|is_insurance_covered/);
  });

  test('과차단 방지 — 게이트 평가 오류는 catch 후 통과(비차단), 드래그와 동일', () => {
    const body = ctxHandlerBody(DASH());
    // try/catch 로 감싸 오류 시 비차단(운영 연속성) — 드래그 else-branch 와 동일 방어.
    expect(body).toMatch(/try\s*\{[\s\S]*evaluateMedicalRecordGate\(ci\)[\s\S]*\}\s*catch/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 회귀 0 (비급여/기록보유 정상 통과는 게이트 lib 소유, 배선 무변경 확인)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 회귀 가드', () => {
  test('done 이 아닌 상태변경은 게이트 미진입 — done 분기 조건 가드', () => {
    const body = ctxHandlerBody(DASH());
    // 게이트 호출은 반드시 newStatus === 'done' 분기 안에서만.
    const doneBranch = body.indexOf("if (newStatus === 'done')");
    const gateCall = body.indexOf('evaluateMedicalRecordGate(ci)');
    expect(doneBranch).toBeGreaterThan(-1);
    expect(gateCall).toBeGreaterThan(doneBranch);
  });

  test('드래그 경로(경로2)·게이트 lib 정책은 그대로 유지 (import 존재)', () => {
    const src = DASH();
    expect(src).toMatch(/from '@\/lib\/medicalRecordGate'/);
    // 드래그 완료 경로 배선도 여전히 존재(경로2 회귀 없음).
    expect(src).toMatch(/evaluateMedicalRecordGate\(row\)/);
  });
});
