/**
 * E2E spec — T-20260715-foot-MEDLAW22B-CTXMENU-COMPLETE-GATE-BYPASS
 *
 * (원안) 우클릭(컨텍스트 메뉴) 완료 경로가 급여 진료기록 하드차단 게이트(MEDLAW22-B-GATE)를
 * 우회하던 불일치를 해소 — 우클릭 완료에도 드래그와 동일하게 evaluateMedicalRecordGate 하드차단 적용.
 *
 * ★★ 2026-07-28 전면 supersede — T-20260728-foot-INSUR-POPUP-REMOVE (문지은 대표원장 "B안" 직접 컨펌)
 *   급여 진료기록 완료 하드차단이 드래그·우클릭·수납창 3지점 모두에서 완전 해제됨.
 *   원안(우클릭에도 하드차단 배선)은 더 이상 유효하지 않다 — 이제 우클릭·드래그 완료는
 *   진료기록 미작성이어도 차단 팝업 없이 정상 진행된다.
 *   본 spec 은 '우클릭·드래그 완료 경로에 하드차단이 부재함'을 회귀 고정하도록 전면 재고정한다.
 *   (급여청구 리마인드 inline ℹ️ 는 결제 미니창 soft 리마인더로 존치 — 상세는 INSUR-POPUP-REMOVE.spec.ts.)
 *
 * 검증 전략: 소스 정적 가드(auth/DB 라이브 비의존) — 주석 제외 실코드 기준으로 게이트 호출 부재 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DASH = () => SRC('pages/Dashboard.tsx');

/** 주석 제거 후 handleContextStatusChange(우클릭) 본문만 잘라낸다(다음 핸들러 선언 전까지). */
function ctxHandlerBody(rawSrc: string): string {
  const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const start = src.indexOf('const handleContextStatusChange');
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf('const handleContextConsultStatusChange');
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// supersede — 우클릭 완료 경로 하드차단 제거 (INSUR-POPUP-REMOVE)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('supersede(2026-07-28) — 우클릭 완료 경로 급여 진료기록 하드차단 제거', () => {
  test('handleContextStatusChange(우클릭) — evaluateMedicalRecordGate 하드차단 호출 부재', () => {
    const body = ctxHandlerBody(DASH());
    expect(body).not.toMatch(/evaluateMedicalRecordGate\s*\(/);
    expect(body).not.toMatch(/gate\.blocked/);
    // 완료 차단 안내 toast 문구도 부재.
    expect(body).not.toMatch(/진료기록 작성 후 완료할 수 있습니다/);
  });

  test('우클릭 완료 — done 분기가 차단 없이 통과(markRecentlyUpdated/setRows 로 정상 진행)', () => {
    const body = ctxHandlerBody(DASH());
    // 차단 abort 없이 낙관적 업데이트로 곧장 진행됨.
    expect(body).toMatch(/markRecentlyUpdated\(ci\.id\)/);
    expect(body).toMatch(/setRows\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// supersede — 드래그 완료 경로도 하드차단 제거 (경로2 정합)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('supersede(2026-07-28) — 드래그 완료 경로 하드차단 제거 + import 정리', () => {
  test('Dashboard 전체 — evaluateMedicalRecordGate 호출·차단 소비·import 부재', () => {
    const code = DASH().replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/evaluateMedicalRecordGate\s*\(/);
    expect(code).not.toMatch(/gate\.blocked/);
    expect(code).not.toMatch(/import\s*\{[^}]*evaluateMedicalRecordGate[^}]*\}\s*from\s*['"]@\/lib\/medicalRecordGate['"]/);
  });
});
