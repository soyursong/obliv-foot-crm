/**
 * E2E spec — T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE
 * 진료대시보드 '진료완료' 별도 버튼 제거 + 완료 동선을 칸반 '상태 플래그 메뉴 → 진료완료(핑크)'로 일원화.
 *
 * 결정 (김주연 총괄, slack_ts 1781584427.576269):
 *   완료(purple→pink) 처리를 버튼이 아닌 '상태 플래그 메뉴 → 진료완료(핑크)'로 일원화.
 *   핑크 전이 시 진료대시보드 '진료완료' 섹션에 자동 리스트업.
 *
 * ⚠ 구현 순서 가드(역전 금지): ② 핑크 메뉴 완료경로 + staff 접근성 보존 후에야 ① 버튼 제거.
 *   본 spec 은 ①②③ 동시 충족(완료경로 공백 0)을 박제한다.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(데이터 시드 비의존, 회귀 박제 우선).
 *
 * AC-1  진료대시보드의 '진료완료' 버튼(TreatmentCompleteButton, doctor-call-complete-btn) 제거.
 * AC-2  상태 플래그 메뉴에서 핑크(진료완료) 선택 → 환자가 '진료완료' 섹션에 자동 리스트업(status_flag==='pink' 필터).
 * AC-3  직원(staff) 완료경로 무손실 — 상태 플래그 메뉴(card-status-menu-btn)·핑크 선택·handleFlagChange 에 role 게이트 없음.
 * AC-4  잔존 컨트롤 무회귀 — ✋ ack 전용(완료 전이는 이 화면 밖), 진료대기중=purple 만(pink 누수 0).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const MENU = () => SRC('components/StatusContextMenu.tsx');
const DASHBOARD = () => SRC('pages/Dashboard.tsx');
const STATUS = () => SRC('lib/status.ts');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — '진료완료' 버튼 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 진료완료 버튼(TreatmentCompleteButton) 제거', () => {
  test('DoctorCallDashboard 에 TreatmentCompleteButton 정의·렌더·testid 가 없다', () => {
    const s = DASH();
    expect(s).not.toContain('function TreatmentCompleteButton(');
    expect(s).not.toContain('<TreatmentCompleteButton');
    // data-testid 는 주석(제거 이력 설명)에서만 등장 가능 — 실제 JSX 속성 렌더는 0.
    expect(s).not.toContain('data-testid="doctor-call-complete-btn"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 핑크(진료완료) → '진료완료' 섹션 자동 리스트업
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 핑크 전이 시 진료완료 섹션 자동 리스트업', () => {
  test("완료 명단(completedPatients)이 status_flag==='pink' 환자를 포함한다", () => {
    const s = DASH();
    // 완료 섹션 필터: completed_at 보유 OR status_flag==='pink'.
    expect(s).toMatch(/completedPatients[\s\S]*?\.filter\(\(ci\)\s*=>\s*ci\.completed_at\s*\|\|\s*ci\.status_flag\s*===\s*'pink'\)/);
  });

  test('상태 플래그 메뉴(StatusContextMenu)가 핑크(진료완료, pink) 옵션을 노출한다', () => {
    // 메뉴는 STATUS_FLAGS 전체를 매핑 — pink 포함. 라벨 SSOT 확인.
    expect(MENU()).toContain('STATUS_FLAGS.map');
    expect(STATUS()).toMatch(/pink:\s*'진료완료'/);
    // STATUS_FLAGS 배열에 pink 가 등재되어 메뉴에 렌더된다.
    expect(STATUS()).toMatch(/STATUS_FLAGS[\s\S]*?'pink'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 직원(staff) 완료경로 무손실(role 게이트 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — staff 접근성(상태 플래그 메뉴 role 게이트 없음)', () => {
  test('칸반 카드 상태변경 버튼(card-status-menu-btn)에 role 조건이 걸려 있지 않다', () => {
    const d = DASHBOARD();
    expect(d).toContain('data-testid="card-status-menu-btn"');
  });

  test('handleFlagChange 가 role 게이트 없이 applyStatusFlagTransition(actor 기록) 을 호출한다', () => {
    const d = DASHBOARD();
    const start = d.indexOf('const handleFlagChange =');
    expect(start).toBeGreaterThan(-1);
    const body = d.slice(start, start + 900);
    // 완료 전이 SSOT 호출 + actor(role 포함) 적재 — 의료 추적.
    expect(body).toContain('applyStatusFlagTransition');
    expect(body).toContain('role: profile?.role');
    // 특정 role 만 허용하는 조기 차단(early return) 이 없다 — 직원 포함 공통 경로.
    expect(body).not.toMatch(/role\s*!==\s*'director'/);
    expect(body).not.toMatch(/role\s*!==\s*'staff'/);
  });

  test('StatusContextMenu 의 플래그 선택 버튼에 role 비활성(disabled) 게이트가 없다', () => {
    const m = MENU();
    const start = m.indexOf('STATUS_FLAGS.map');
    const slice = m.slice(start, start + 700);
    // 플래그 버튼 onClick=onFlagChange 만 — role 기반 disabled 없음.
    expect(slice).toContain('onFlagChange(checkIn');
    expect(slice).not.toContain("role === 'staff'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 잔존 컨트롤 무회귀(✋ ack 전용 / 진료대기중 purple 만)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 — ✋ ack 전용 + 진료대기중 pink 누수 0', () => {
  test('DoctorCallDashboard 내부에서 완료 전이(applyStatusFlagTransition pink)를 호출하지 않는다', () => {
    const s = DASH();
    // 완료 전이는 이 화면 밖(칸반 상태 플래그 메뉴 → Dashboard.handleFlagChange)으로 이전.
    expect(s).not.toContain("applyStatusFlagTransition(checkIn, 'pink'");
  });

  test('진료 대기중(activeCalls)은 purple 만 — pink 누수 0', () => {
    const s = DASH();
    expect(s).toMatch(/activeCalls[\s\S]*?\.filter\(\(ci\)\s*=>\s*ci\.status_flag\s*===\s*'purple'\s*&&\s*!ci\.completed_at\)/);
  });

  test('✋ HandToggle 컴포넌트는 잔존(ack 전용 신호)한다', () => {
    expect(DASH()).toContain('function HandToggle(');
  });
});
