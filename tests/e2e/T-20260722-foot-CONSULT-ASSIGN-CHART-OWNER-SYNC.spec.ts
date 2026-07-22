/**
 * E2E spec — T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC
 *
 * 현장(김주연 총괄, 14:41): "사이드바 [상담·치료사 배정] 탭 배정을 2번차트 담당자 기준으로."
 *   = 2번차트 1구역 담당자(customers.assigned_staff_id) 를 수동배정 select 의 default 프리셋으로.
 *
 * ★컬럼분기 판정(planner): (a) customers.assigned_staff_id 채택. batch 엔진 컬럼통일(b)은 스코프 제외.
 *
 * 설계 확정(AC 그라운딩):
 *   - 대상: src/pages/Assignments.tsx (① 오늘 배정 현황 카드의 상담 축 수동배정 select).
 *   - point1: load() customers 벌크 select 에 assigned_staff_id 추가 + CustomerLite 타입 필드 추가(additive 클라 쿼리, DDL 아님).
 *   - point2: select default 프리셋 = check_ins.consultant_id IS NULL 이면 customers.assigned_staff_id, 값 있으면 기존값 유지.
 *   - point3: park(41009c25/658a33be) fetchAssignedStaffId 의 read 의미(SELECT assigned_staff_id FROM customers)만 계승,
 *             벌크 select 로 배치화. 양방향연동(withdrawn feature)·batch 엔진 코드는 미병합(wholesale merge 금지).
 *
 * RED LINE(불변식 계승 AC-1):
 *   - assigned_staff_id = read-only basis. 배정 write 는 check_ins.consultant_id/therapist_id 에만.
 *   - manualAssign/toss/pull/AC-6 어디에도 assigned_staff_id write 경로 없음.
 *   - batch 엔진(maybeAutoAssign/assign_consultant_atomic/assigned_consultant_id·designated_therapist_id) 무접촉.
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(형제 foot spec 동형).
 * 실렌더/현장 클릭 시나리오(2번차트 담당 default 프리셋 표시 + 저장 시 check_ins write)는
 * supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const NEWCHECKIN = 'src/components/NewCheckInDialog.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 point1: 벌크 로드 + 타입 필드
// ─────────────────────────────────────────────────────────────────────────────
test('point1-a: CustomerLite 타입에 assigned_staff_id 필드 추가', () => {
  const src = read(PAGE);
  expect(src).toMatch(/interface CustomerLite \{[\s\S]*?assigned_staff_id: string \| null;[\s\S]*?\}/);
});

test('point1-b: customers 벌크 select 에 assigned_staff_id 포함', () => {
  const src = read(PAGE);
  // 오늘분/당월분 두 customers select 모두 assigned_staff_id 를 함께 조회(배치화된 read)
  const selects = src.match(/\.select\('id, visit_type, lead_source, visit_route, assigned_staff_id'\)/g) ?? [];
  expect(selects.length).toBeGreaterThanOrEqual(1);
  // 구 select(assigned_staff_id 누락)이 잔존하지 않음
  expect(src).not.toMatch(/\.select\('id, visit_type, lead_source, visit_route'\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 point2: select default 프리셋(consultant_id IS NULL → assigned_staff_id)
// ─────────────────────────────────────────────────────────────────────────────
test('point2-a: assignSelectValue 프리셋 헬퍼 — 값 있으면 기존값 유지', () => {
  const src = read(PAGE);
  expect(src).toContain('const assignSelectValue = useCallback');
  // 이미 배정된 값(consultant_id/therapist_id)이 있으면 그대로 반환
  expect(src).toMatch(/if \(assignedId\) return assignedId;/);
});

test('point2-b: consultant_id IS NULL(consult 축)일 때만 assigned_staff_id 로 프리셋', () => {
  const src = read(PAGE);
  // consult 축에서 customers 맵의 assigned_staff_id 를 default 로
  expect(src).toMatch(/if \(role === 'consult'\)[\s\S]*?assigned_staff_id \?\? ''/);
});

test('point2-c: 상담 축 select 의 value 가 프리셋(selectVal)에 바인딩', () => {
  const src = read(PAGE);
  expect(src).toContain('const selectVal = assignSelectValue(ci, role);');
  expect(src).toContain('value={selectVal}');
  // 구 바인딩(value={assignedId ?? ''})이 잔존하지 않음
  expect(src).not.toContain("value={assignedId ?? ''}");
  // 프리셋 담당이 출근 풀에 없어도 option 보존 노출(controlled value 유지)
  expect(src).toMatch(/selectVal && !poolFor\(role\)\.some\(\(s\) => s\.id === selectVal\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE: read-only basis — assigned_staff_id write 경로 부재 + 엔진 무접촉
// ─────────────────────────────────────────────────────────────────────────────
test('RED-1: Assignments 에 assigned_staff_id write(.update/.insert/.upsert) 경로 부재', () => {
  const src = read(PAGE);
  // assigned_staff_id 는 .select(read)로만 등장. write payload(.update/.insert/.upsert)로 쓰지 않음.
  expect(src).not.toMatch(/\.update\([\s\S]*?assigned_staff_id[\s\S]*?\)/);
  expect(src).not.toMatch(/\.insert\([\s\S]*?assigned_staff_id[\s\S]*?\)/);
  expect(src).not.toMatch(/\.upsert\([\s\S]*?assigned_staff_id[\s\S]*?\)/);
  // assigned_staff_id 등장은 타입 필드 선언 + read select + 프리셋 헬퍼 뿐(write 아님).
  expect(src).toMatch(/lead_source, visit_route, assigned_staff_id'\)/);
});

test('RED-2: 배정 write 는 check_ins(consult=consultant_id / therapy=therapist_id)로만 — onChange=doManual', () => {
  const src = read(PAGE);
  expect(src).toContain('onChange={(e) => void doManual(ci, role, e.target.value)}');
  // doManual 은 manualAssign(check_ins write) 경유 — 프리셋은 표시 default 일 뿐 자동 write 없음.
  expect(src).toMatch(/manualAssign\(\{/);
});

test('RED-3: batch 엔진(NewCheckInDialog) 무접촉 — 양방향연동/park fetchAssignedStaffId 미병합', () => {
  const nci = read(NEWCHECKIN);
  // park 에서 초진 자동배정에 붙였던 fetchAssignedStaffId 헬퍼는 병합되지 않았다(엔진 무접촉).
  expect(nci).not.toContain('const fetchAssignedStaffId');
  // 초진 자동배정은 기존 balanced 엔진(autoAssignConsultant) 유지.
  expect(nci).toContain('autoAssignConsultant(clinicId)');
});
