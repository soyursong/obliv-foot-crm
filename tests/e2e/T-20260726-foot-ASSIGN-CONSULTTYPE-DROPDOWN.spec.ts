/**
 * E2E spec — T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1785029897.172259 / 스펙보강 1785298981.350789):
 *   "상담·치료사 배정 → 상담 → 오늘 배정 현황 / 금일 배분 이력 에서 담당(배정 실장) 옆에
 *    '상담유형' 드롭다운(초진/재진/당일재상담/대리상담, 기본값 초진)을 추가.
 *    실장이 유형을 직접 선택하면 '직원별 누적'의 배정(초진)·배정(재진) 카운트가 그 선택대로 잡힌다."
 *
 * 저장모델(DA 확정, da_decision_foot_assign_consulttype_dropdown_20260726.md):
 *   - 단일 `assignment_consult_type TEXT NULL` 1컬럼 + named CHECK {초진|재진|당일재상담|대리상담}.
 *   - App default='초진'(신규 배정 pre-select), DB DEFAULT 없음(백필 금지). 과거행 NULL=미분류 → 카운터 제외.
 *
 * 카운터 매핑(총괄 SSOT):
 *   배정(초진)=초진 / 배정(재진)=재진·대리상담 / 당일재상담=전부 제외 / NULL(미분류)=전부 제외.
 *   7/17 통일축(T-20260713 접수·배지·자동배정 365 자동판정)은 불변 — 배정 카운트 축만 수동 부분 재분리.
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(형제 foot spec 동형).
 * 실렌더/클릭·카운트 연동 값 검증은 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강(§현장 클릭 시나리오 1~4).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const TYPES = 'src/lib/types.ts';
const MIG = 'supabase/migrations/20260729150000_foot_assign_consult_type.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260729150000_foot_assign_consult_type.rollback.sql';

// ─────────────────────────────────────────────────────────────────────────────
// 저장모델 — DA 단일 네임스페이스 enum + named CHECK, ADDITIVE nullable(백필 금지)
// ─────────────────────────────────────────────────────────────────────────────
test('저장모델: assignment_consult_type 단일 컬럼 ADDITIVE nullable(DEFAULT 없음)', () => {
  const mig = read(MIG);
  expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS assignment_consult_type TEXT;/);
  // DB-level DEFAULT '초진' 금지(백필 방지) — 초진 default 는 App 층
  expect(mig).not.toMatch(/assignment_consult_type TEXT[^\n;]*DEFAULT/i);
  // bare consult_type / visit_type 컬럼 신설 금지(자동 365 축 점유)
  expect(mig).not.toMatch(/ADD COLUMN IF NOT EXISTS (consult_type|visit_type) /);
});

test('저장모델: named CHECK = {초진|재진|당일재상담|대리상담} (오타·잡값 차단)', () => {
  const mig = read(MIG);
  expect(mig).toContain('chk_check_ins_assignment_consult_type');
  expect(mig).toMatch(
    /CHECK \(assignment_consult_type IS NULL[\s\S]*?IN \('초진', '재진', '당일재상담', '대리상담'\)\)/,
  );
});

test('저장모델: 역연산 롤백 = CHECK + 컬럼 DROP(멱등)', () => {
  const rb = read(MIG_ROLLBACK);
  expect(rb).toContain('DROP CONSTRAINT IF EXISTS chk_check_ins_assignment_consult_type');
  expect(rb).toContain('DROP COLUMN IF EXISTS assignment_consult_type');
});

test('타입: CheckIn.assignment_consult_type nullable 추가', () => {
  const t = read(TYPES);
  expect(t).toMatch(/assignment_consult_type\?: string \| null;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// write helper — 단일 컬럼 write + rows-affected 가드(RED LINE: 매출귀속 무접촉)
// ─────────────────────────────────────────────────────────────────────────────
test('helper: setAssignmentConsultType — check_ins.assignment_consult_type 만 update + rows-affected 가드', () => {
  const a = read(AUTOASSIGN);
  expect(a).toContain('export async function setAssignmentConsultType');
  expect(a).toMatch(/\.update\(\{ assignment_consult_type: opts\.value \}\)/);
  // rows-affected 가드: .select('id') 후 0행이면 실패(silent write-failure 금지)
  expect(a).toMatch(/\.select\('id'\)/);
  // consultant_id / 매출귀속 컬럼을 이 helper 가 write 하지 않음(RED LINE)
  expect(a).not.toMatch(/setAssignmentConsultType[\s\S]*?consultant_id:/);
});

test('helper: 4종 상수 + App default = 초진', () => {
  const a = read(AUTOASSIGN);
  expect(a).toMatch(/ASSIGNMENT_CONSULT_TYPES = \['초진', '재진', '당일재상담', '대리상담'\]/);
  expect(a).toMatch(/ASSIGNMENT_CONSULT_TYPE_DEFAULT: AssignmentConsultType = '초진'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 드롭다운 노출(담당 옆) + 기본값 초진 (오늘 배정 현황 / 금일 배분 이력)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 오늘 배정 현황 — 담당 옆 상담유형 드롭다운(4종), 기본값 초진 pre-select', () => {
  const src = read(PAGE);
  // '담당' th 다음에 '상담유형' th
  expect(src).toMatch(/>담당<\/th>[\s\S]*?>상담유형<\/th>/);
  // 드롭다운 testid + 4종 옵션 + 기본값 = 저장값 ?? 초진 default
  expect(src).toMatch(/data-testid=\{`assign-consult-type-\$\{ci\.id\}`\}/);
  expect(src).toContain('value={ci.assignment_consult_type ?? ASSIGNMENT_CONSULT_TYPE_DEFAULT}');
  expect(src).toContain('ASSIGNMENT_CONSULT_TYPES.map((t) => (');
});

test('시나리오1: 금일 배분 이력 — 담당 옆 상담유형 셀(상담 탭 한정)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/data-testid=\{`dist-consult-type-\$\{r\.id\}`\}/);
  expect(src).toContain('value={r.checkIn.assignment_consult_type ?? ASSIGNMENT_CONSULT_TYPE_DEFAULT}');
});

test('시나리오1: 드롭다운 onChange → doSetConsultType → check_ins write + load 재계산', () => {
  const src = read(PAGE);
  expect(src).toContain('const doSetConsultType = async (ci: CheckIn, value: AssignmentConsultType)');
  expect(src).toMatch(/setAssignmentConsultType\(\{ checkInId: ci\.id, value \}\)/);
  // onChange 배선(두 표면 공통)
  expect(src).toMatch(/onChange=\{\(e\) => void doSetConsultType\(ci, e\.target\.value as AssignmentConsultType\)\}/);
  expect(src).toMatch(/onChange=\{\(e\) => void doSetConsultType\(r\.checkIn, e\.target\.value as AssignmentConsultType\)\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2/3: 카운터 매핑 SSOT — 초진→배정(초진) / 재진·대리상담→배정(재진) / 당일재상담·NULL→제외
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2/3: 카운터 분류 = assignment_consult_type 기반(자동 365 monthAxisOf 대체)', () => {
  const src = read(PAGE);
  // 상담 카운트 분류 헬퍼가 매출/축이 아닌 수동 상담유형으로 분기
  expect(src).toContain('const assignConsultBucket = (ci: CheckIn):');
  // 초진 → assigned(배정 초진)
  expect(src).toMatch(/case '초진':\s*\n\s*return 'assigned';/);
  // 재진 · 대리상담 → returning(배정 재진)
  expect(src).toMatch(/case '재진':\s*\n\s*case '대리상담':\s*\n\s*return 'returning';/);
  // 당일재상담 → null(전부 제외)
  expect(src).toMatch(/case '당일재상담':\s*\n\s*return null;/);
  // NULL/미분류(default) → null(제외)
  expect(src).toMatch(/default:\s*\n\s*return null;/);
});

test('시나리오2/3: 상담 배정 카운트는 auto-recency(monthAxisOf consult) 대신 상담유형 버킷 사용', () => {
  const src = read(PAGE);
  // consultant_id 집계에 assignConsultBucket 사용
  expect(src).toMatch(/if \(s && s\.role === 'consultant'\) \{\s*\n\s*bumpAssign\(ensure\(s\), assignConsultBucket\(ci\)/);
  // 구 경로(monthAxisOf(ci, 'consult') === 'returning') 잔존 금지 — 카운트 소스는 수동 상담유형
  expect(src).not.toMatch(/bumpAssign\(ensure\(s\), monthAxisOf\(ci, 'consult'\)/);
});

test('스코프 경계: 치료(therapy) 축은 auto-axis 유지(재진 개념 무해당 — 부분 재분리 대상 아님)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/monthAxisOf\(ci, 'therapy'\) === 'returning' \? 'returning' : 'assigned'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: (엣지) 미선택(기본값 유지) 저장 → 초진 default-persist
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오4: 상담 배정 시 상담유형 미보유(NULL)면 default 초진 함께 영속', () => {
  const src = read(PAGE);
  expect(src).toMatch(
    /if \(res\.ok && role === 'consult' && !ci\.assignment_consult_type\) \{\s*\n\s*await setAssignmentConsultType\(\{ checkInId: ci\.id, value: ASSIGNMENT_CONSULT_TYPE_DEFAULT \}\);/,
  );
});
