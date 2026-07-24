/**
 * E2E spec — T-20260724-foot-ASSIGNHIST-ROW-EDIT-DELETE (요청1(A) only)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, MSG-20260724-135801-8o1d):
 *   "「담당자 배정 > 금일 배분 이력」 각 줄의 담당 실장을 바로 바꾸거나(요청1),
 *    잘못된 줄을 삭제(요청2)할 수 있게 해달라."
 *
 * scope 재확정(planner 2026-07-25 02:05, dev-foot MSG-8gg2 crux 해소):
 *   - 본 spec = 요청1(A) 만. write 타깃 = check_ins.consultant_id/therapist_id(per-visit) UPDATE 만.
 *     customers.assigned_staff_id(고객 영구담당=매출 live-join 포인터)는 무접점(RED LINE) → 과거매출 소급 재귀속 0.
 *   - 요청2(삭제) = DA CONSULT 회신 대기(hold). 요청3(2번차트↔배분이력 자동연동) = reporter 재확인 대기.
 *   두 건은 본 spec 미포함(scope 밖 구현 금지).
 *
 * 안전 가드 인코딩:
 *   - rows-affected 검증(cross_crm_write_rowcheck_standard): 0-row(+error=null) 성공 오인 금지.
 *   - 권한 게이트(admin/manager/director) + check_ins UPDATE RLS(is_admin_or_manager) 이중.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(수정 저장/영속/권한 비노출) 확인은 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const ENGINE = 'src/lib/autoAssign.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / 시나리오 1: 금일 배분 이력 각 row 담당을 인라인으로 변경할 수 있다
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 금일 배분 이력 담당 컬럼에 row별 인라인 수정 select 렌더', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid={`dist-edit-select-${r.id}`}');
  // 현재 담당(r.staffId) 이 select value 로 프리셋
  expect(src).toMatch(/value=\{r\.staffId \?\? ''\}/);
  // 변경 시 doManual(check_ins per-visit UPDATE 경로)로 write. 같은 사람이면 no-op.
  expect(src).toMatch(/if \(e\.target\.value && e\.target\.value !== r\.staffId\)\s*\n?\s*void doManual\(r\.checkIn, r\.role, e\.target\.value\)/);
});

test('AC-1: 담당 옵션 = 현재 탭(activeTab) 역할의 active staff 전체', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const distEditStaffOptions = useMemo<Staff\[\]>/);
  expect(src).toMatch(/const target = activeTab === 'consult' \? 'consultant' : 'therapist'/);
  expect(src).toMatch(/\}, \[staff, activeTab\]\)/);
  // 옵션 풀에 없는 현재 담당(비활성/타역할)도 보존 노출
  expect(src).toMatch(/!distEditStaffOptions\.some\(\(s\) => s\.id === r\.staffId\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 / 시나리오 3: 권한 게이트 — admin/manager/director 만 수정 UI, 그 외 read-only
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: canEditDistribution(admin/manager/director) 게이트 — 미권한은 기존 read-only 표시', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const canEditDistribution =\s*\n?\s*profile\?\.role === 'admin' \|\| profile\?\.role === 'manager' \|\| profile\?\.role === 'director'/);
  // 권한 있으면 select, 없으면 staffName(read-only)
  expect(src).toMatch(/canEditDistribution \? \(/);
  expect(src).toMatch(/\) : \(\s*\n?\s*staffName\(r\.staffId\)\s*\n?\s*\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 / 안전가드: rows-affected 검증(silent write-failure 금지)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: manualAssign 이 .select(id) 로 영향 행 회수 + 0-row 성공 오인 차단', () => {
  const eng = read(ENGINE);
  // check_ins UPDATE 뒤 .select('id') 로 rows-affected 회수
  expect(eng).toMatch(/\.update\(\{ \[assignedCol\]: opts\.toStaffId \}\)\s*\n?\s*\.eq\('id', opts\.checkInId\)\s*\n?\s*\.select\('id'\)/);
  // 0-row(+error=null) → ok:false (거짓 성공 토스트 차단)
  expect(eng).toMatch(/if \(!data \|\| data\.length === 0\)\s*\n?\s*return \{ ok: false/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE: customers.assigned_staff_id 무접점 (과거매출 소급 재귀속 0)
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE: manualAssign write 타깃은 check_ins 만 — assigned_staff_id UPDATE 금지', () => {
  const eng = read(ENGINE);
  // manualAssign 함수 본문 추출
  const start = eng.indexOf('export async function manualAssign');
  expect(start).toBeGreaterThan(-1);
  const body = eng.slice(start, eng.indexOf('export async function', start + 1));
  // 주석 제거 후 실제 코드에서만 검사(코멘트의 RED LINE 설명 오탐 방지)
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  // customers 테이블 write / assigned_staff_id 컬럼 write 부재
  expect(code).not.toMatch(/from\('customers'\)/);
  expect(code).not.toMatch(/assigned_staff_id/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 금일 배분 이력 카드/헤더 유지 + 요청2(삭제) 미착수
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: 금일 배분 이력 카드 유지 + 수정 가능 안내 문구', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-today-distribution-card"');
  expect(src).toContain('금일 배분 이력');
  expect(src).toMatch(/canEditDistribution \? ' · 담당 수정 가능' : ' · 표시 전용'/);
});

test('회귀(scope): 요청2(삭제) 미착수 — 배분 이력 row 삭제/DELETE UI 부재', () => {
  const src = read(PAGE);
  // 금일 배분 이력 카드 범위 내 삭제 버튼/확인 다이얼로그 testid 부재
  expect(src).not.toContain('data-testid="dist-delete-btn');
  expect(src).not.toContain('배분 이력을 삭제');
});
