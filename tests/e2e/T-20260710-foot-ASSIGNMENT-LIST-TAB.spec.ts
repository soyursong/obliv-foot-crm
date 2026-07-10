/**
 * E2E spec — T-20260710-foot-ASSIGNMENT-LIST-TAB
 *
 * 현장(김주연 총괄, C0ATE5P6JTH):
 *   "상담·치료사 배정 화면에 [배정목록] 탭 신설. 카테고리(상담/치료) 드롭 → 담당자(상담사/치료사) 드롭
 *    → 선택 담당자의 금일 배정 환자목록을 한 번에 표시(이름·시간 등)."
 *
 * 착수 전 확인(dev-foot) 결과 인코딩:
 *   - 금일 배정 grain 실측(2026-07-10 prod): 앵커=check_ins(consultant_id/therapist_id).
 *     reservations엔 배정필드 부재(preferred_therapist_id=예약 선호값), visits 테이블 부재
 *     → TREATING-DOCTOR-SELECT-SYNC 선례와 정합. 신규 스키마 불요(db_change=false).
 *   - 담당자 role 매핑: 상담→consultant / 치료→therapist (cross_crm_data_contract staff role 기준).
 *   - feasibility: consultant_id(상담 담당자→환자 배정) prod 실재 확인 → 신규 영속 불요.
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 탭 활성/드롭 갱신/목록 렌더의 실렌더 확인은 supervisor 맥스튜디오 실브라우저 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const LAYOUT = 'src/components/AdminLayout.tsx';
const APP = 'src/App.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / 시나리오 1-3: 상담·치료사 배정 화면에 [배정목록] 탭이 보인다
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: [배정목록] 탭 트리거 추가 + 3-way mainTab 와이어링(상담/치료/배정목록)', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-tab-list"');
  expect(src).toContain('배정목록');
  // 3-way 상위 탭 상태
  expect(src).toMatch(/useState<'consult' \| 'therapy' \| 'list'>\('consult'\)/);
  // Tabs value/onValueChange 가 mainTab 에 묶임
  expect(src).toMatch(/value=\{mainTab\}/);
  expect(src).toMatch(/setMainTab/);
});

test('AC-1: 상담/치료 탭은 기존 activeTab(role) 동기화 — 운영 카드 로직 회귀 0', () => {
  const src = read(PAGE);
  // 상담/치료 선택 시에만 activeTab 동기화(배정목록은 자체 드롭 조회)
  expect(src).toMatch(/if \(next === 'consult' \|\| next === 'therapy'\) setActiveTab\(next\)/);
  // 기존 운영 카드는 배정목록 탭에서 미노출
  expect(src).toMatch(/mainTab !== 'list' && \(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 / 시나리오 1-4: 카테고리 드롭다운(상담/치료) 노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 카테고리 드롭다운(상담/치료) — 배정목록 탭 전용 렌더', () => {
  const src = read(PAGE);
  expect(src).toMatch(/mainTab === 'list' && \(/);
  expect(src).toContain('data-testid="list-category-select"');
  expect(src).toContain('data-testid="assignments-list-card"');
  // 카테고리 상태
  expect(src).toMatch(/const \[listCategory, setListCategory\] = useState<AssignmentRole>\('consult'\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 / 시나리오 2: 카테고리 선택 시 담당자 드롭다운 갱신 (상담사 ↔ 치료사)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 담당자 드롭 옵션 = 카테고리 role(consultant/therapist) 필터', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="list-staff-select"');
  // 카테고리→role 매핑: 상담→consultant / 치료→therapist
  expect(src).toMatch(/const target = listCategory === 'consult' \? 'consultant' : 'therapist'/);
  expect(src).toMatch(/staff\s*\.filter\(\(s\) => s\.role === target\)/);
  // listStaffOptions 가 listCategory 변화에 재계산
  expect(src).toMatch(/\}, \[staff, listCategory\]\)/);
});

test('시나리오 2: 카테고리 전환 시 담당 선택 초기화(직전 목록 잔존 X)', () => {
  const src = read(PAGE);
  // onChange 에서 listStaffId 리셋
  expect(src).toMatch(/setListCategory\(e\.target\.value as AssignmentRole\);\s*\n\s*setListStaffId\(''\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 / 시나리오 1-7: 담당자 선택 시 그 담당자의 금일 배정 환자목록 표시
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 금일 배정 환자목록 — 앵커=check_ins(consultant_id/therapist_id), 오늘 필터 + 취소 제외', () => {
  const src = read(PAGE);
  // 금일 앵커: monthCheckIns 를 오늘로 필터
  expect(src).toMatch(/const todayStartMs = new Date\(`\$\{todayIso\}T00:00:00\+09:00`\)\.getTime\(\)/);
  expect(src).toContain("if (ci.status === 'cancelled') continue;");
  // 배정 = 카테고리별 consultant_id / therapist_id
  expect(src).toMatch(/const staffId = listCategory === 'consult' \? ci\.consultant_id : ci\.therapist_id/);
  // 담당 선택 시 그 담당만 (미배정 제외)
  expect(src).toContain('if (!staffId) continue;');
  expect(src).toMatch(/if \(listStaffId && staffId !== listStaffId\) continue;/);
});

test('AC-4: 목록 렌더 — 환자명 + 배정시각(Asia/Seoul) 표시', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="list-patient-rows"');
  // 배정시각 컬럼 + Asia/Seoul 로케일
  expect(src).toContain('배정시각');
  expect(src).toMatch(/timeZone: 'Asia\/Seoul'/);
  // 배정시각 파생: 최신 action created_at 우선, fallback checked_in_at
  expect(src).toMatch(/at: act\?\.created_at \?\? ci\.checked_in_at/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 / 시나리오 3-2: 담당자 미선택 시 금일 전체 배정 목록 표시
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 담당 미선택("") → 카테고리 전체 배정 표시 + 담당 컬럼 노출', () => {
  const src = read(PAGE);
  // 미선택 옵션
  expect(src).toMatch(/전체 \(\{listCategory === 'consult' \? '상담사' : '치료사'\} 전원\)/);
  // 미선택 시 담당 컬럼 노출
  expect(src).toMatch(/\{!listStaffId && <th[^>]*>담당<\/th>\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3-1: 금일 배정 0명 담당자 → 빈 상태 메시지(에러/빈화면 X)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오 3: 금일 배정 0명 → 빈 상태 안내 메시지', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="list-empty"');
  expect(src).toContain('금일 배정된 환자가 없습니다.');
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 사이드바 단일 메뉴/route 무변경 (read-only surface 추가일 뿐)
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: /admin/assignments 단일 nav 항목 + route 무변경', () => {
  const layout = read(LAYOUT);
  const occurrences = (layout.match(/\/admin\/assignments/g) ?? []).length;
  expect(occurrences).toBe(1);
  const app = read(APP);
  expect(app).toContain('assignments');
  expect(app).not.toContain('assignments/list');
});
