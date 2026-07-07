/**
 * E2E spec — T-20260615-foot-SHAKEHAND-NO-COMPLETE  (P0 핫픽스, 문지은 대표원장)
 *
 * 증상: 진료호출알람 ✋SHAKE HAND 클릭 시 ack(수신확인)만 되어야 하는데 '진료 완료처리'까지 오발동(status_flag 오염).
 * 근본원인: T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT 이 별도 '진료완료' 버튼(e6138e7 TreatmentCompleteButton)을
 *   제거하고 완료 전이(applyStatusFlagTransition purple→pink)를 ✋ 핸들러(초록 탭)에 결합 → ack 와 완료가 한 손에 얽힘.
 *   doctor_ack_at 은 stepper '원장확인'·재호출 잔존 등 다른 동선에서 선점되어 손이 '초록'으로 도착할 수 있어
 *   '초록 탭=완료' 로직이 의사의 '첫 손 탭'을 완료로 만들었다(직전 2-탭 arm 땜질로도 결합은 잔존).
 * 교정(SSOT 분리 환원): ✋ 핸들러에서 완료/상태전이 호출을 제거하고 ack write(recordAck)만 남긴다.
 *
 * ⚠ 아키텍처 갱신(T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE, 김주연 총괄 확정): SHAKEHAND-NO-COMPLETE 최초 픽스가
 *   복원했던 '진료완료' 버튼(TreatmentCompleteButton, doctor-call-complete-btn)은 이후 제거되고, 완료(purple→pink)
 *   동선은 칸반 '상태 플래그 메뉴 → 진료완료(핑크)'(Dashboard.tsx handleFlagChange → applyStatusFlagTransition)로
 *   일원화됐다. 즉 진료 알림판(DoctorCallDashboard) 자체에는 이제 완료 전이 호출이 0건이어야 한다.
 *   본 spec 은 그 현행 아키텍처 기준으로 SHAKEHAND-NO-COMPLETE 불변식(✋=ack-only, 완료 트리거 0)을 가드한다.
 *
 * AC: ✋클릭=doctor_ack_at 만 write / completed_at·status_flag 전이 트리거 금지 / 재클릭 idempotent /
 *     완료는 별도 명시 액션(칸반 상태 메뉴)에서만 / 회귀 가드 테스트 추가.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일.
 *   ⚠ 실브라우저 클릭 분리 동선은 supervisor field-soak / 갤탭 현장 confirm 게이트에서 최종 확인.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const ACK = () => SRC('components/doctor/DoctorAck.tsx');
const FLAG = () => SRC('lib/statusFlagTransition.ts');
const DASHBOARD_PAGE = () => SRC('pages/Dashboard.tsx');

/** HandToggle 함수 본문만 추출(인접 컴포넌트·후행 주석 오염 방지). */
const HAND_FN = () => {
  const s = DASH();
  const start = s.indexOf('function HandToggle(');
  expect(start).toBeGreaterThan(0);
  // COMPLETEBTN-REMOVE 이후 HandToggle 직후 섹션 헤더 = '// ─── 진료완료 처리 동선' 직전까지 = 함수 본문만.
  const end = s.indexOf('// ─── 진료완료 처리 동선', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — ✋ 핸들러 = ack-only (완료/상태전이 호출 0)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — ✋ HandToggle = 수신확인(ack) 전용', () => {
  test('HandToggle 본문 전체에 완료 전이(applyStatusFlagTransition) 호출이 없다', () => {
    const fn = HAND_FN();
    expect(fn).not.toContain('applyStatusFlagTransition'); // ✋ 는 완료를 절대 만들지 않는다
  });

  test('HandToggle 본문에 status_flag/completed_at write 가 없다(상태 오염 0)', () => {
    const fn = HAND_FN();
    expect(fn).not.toContain('status_flag');
    expect(fn).not.toContain('completed_at');
    expect(fn).not.toContain("'pink'");
  });

  test('회색(shake) 분기는 recordAck 만 수행한다', () => {
    const fn = HAND_FN();
    expect(fn).toContain('await recordAck(checkIn.id)');
    // ack write 는 1회뿐(회색 분기), 완료 경로 없음
    expect(fn.match(/recordAck\(/g)?.length).toBe(1);
  });

  test('직전 2-탭 arm 땜질(armedCompleteCalls)이 완전히 제거됐다', () => {
    const s = DASH();
    expect(s).not.toContain('armedCompleteCalls');
    expect(s).not.toContain('data-hand-armed');
  });

  test('recordAck 는 doctor_ack_at 만 write — completed_at/status_flag 불변(SSOT 격리)', () => {
    const a = ACK();
    const start = a.indexOf('export async function recordAck');
    expect(start).toBeGreaterThan(0);
    const next = a.indexOf('\nexport ', start + 1);
    const fn = a.slice(start, next > 0 ? next : undefined);
    expect(fn).toContain('.update({ doctor_ack_at: new Date().toISOString() })');
    expect(fn.match(/\.update\(/g)?.length).toBe(1);
    expect(fn).not.toContain('completed_at');
    expect(fn).not.toContain('status_flag');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 재클릭 idempotent (초록/파랑 재탭 = 상태 변화 없음, 안내만)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 재클릭 idempotent', () => {
  test('초록(이미 ack됨) 재클릭은 안내 토스트만, 완료/전이 호출 없음(idempotent)', () => {
    const fn = HAND_FN();
    const greenStart = fn.indexOf("if (visual === 'green')");
    expect(greenStart).toBeGreaterThan(0);
    const greenBlock = fn.slice(greenStart, fn.indexOf('// 회색(초기)', greenStart));
    expect(greenBlock).toContain('return;'); // 변화 없이 종료
    expect(greenBlock).not.toContain('applyStatusFlagTransition');
    expect(greenBlock).not.toContain('recordAck'); // 재 write 도 안 함
  });

  test('파랑(완료) 재클릭은 완료 해제 안 함(안내만)', () => {
    const fn = HAND_FN();
    const blueStart = fn.indexOf("if (visual === 'blue')");
    expect(blueStart).toBeGreaterThan(0);
    const blueBlock = fn.slice(blueStart, fn.indexOf('// 초록', blueStart));
    expect(blueBlock).toContain('return;');
    expect(blueBlock).not.toContain('applyStatusFlagTransition');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 완료는 '별도 명시 액션'에서만 (COMPLETEBTN-REMOVE: 칸반 상태 플래그 메뉴로 일원화)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3 — 완료는 별도 명시 액션(칸반 상태 메뉴)에서만', () => {
  test('진료 알림판(DoctorCallDashboard)에는 완료 전이 호출이 0건이다(손도, 그 어떤 진입점도 아님)', () => {
    // COMPLETEBTN-REMOVE 이후 대시보드 자체에는 applyStatusFlagTransition 호출이 존재하지 않는다(주석 언급만 허용).
    const calls = DASH().match(/applyStatusFlagTransition\s*\(/g)?.length ?? 0;
    expect(calls).toBe(0);
  });

  test('구 진료완료 버튼(TreatmentCompleteButton/doctor-call-complete-btn)은 제거되어 존재하지 않는다', () => {
    const s = DASH();
    expect(s).not.toContain('function TreatmentCompleteButton(');
    expect(s).not.toContain('<TreatmentCompleteButton');
    // testid 는 제거 근거 주석에는 남아있을 수 있으나, 실제 렌더 어트리뷰트로는 없어야 함.
    expect(s).not.toContain('data-testid="doctor-call-complete-btn"');
  });

  test('완료 전이(purple→pink) 정본 write 는 칸반 상태 메뉴(Dashboard.handleFlagChange)의 SSOT 경유다', () => {
    const s = DASHBOARD_PAGE();
    // handleFlagChange 가 status_flag 전이를 SSOT applyStatusFlagTransition 으로 위임(핑크 포함 임의 flag).
    expect(s).toContain('await applyStatusFlagTransition(ci, flag, {');
  });

  test('완료 동선 일원화가 소스 주석에 명시적으로 문서화돼 있다(COMPLETEBTN-REMOVE)', () => {
    const s = DASH();
    expect(s).toContain('T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE');
    expect(s).toContain('상태 플래그 메뉴');
  });

  test('대기(purple) 행에는 ✋(비완료)만 렌더된다 — 손과 완료가 한 행에서 분리(완료 버튼 없음)', () => {
    const s = DASH();
    expect(s).toContain('<HandToggle');
    expect(s).toContain('completed={false}'); // 대기 행 손은 비완료
    expect(s).not.toContain('<TreatmentCompleteButton');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4 — 회귀 가드 (의사전용 ack 게이트 / 3색 매핑 / SSOT 격리)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 4 — 회귀 가드', () => {
  test('회색→ack 는 의사 전용 게이트 보존(비의사 차단 안내)', () => {
    const fn = HAND_FN();
    expect(fn).toContain('if (!doctorMode)');
    expect(fn).toContain('의사만 확인');
  });

  test('3-상태 색 매핑 무변경(shake/green/blue) — 위젯 형태·팔레트 보존', () => {
    const fn = HAND_FN();
    expect(fn).toContain("completed ? 'blue' : acked ? 'green' : 'shake'");
    expect(fn).toContain("'text-gray-400 animate-shake'");
    expect(fn).toContain("'text-emerald-600'");
    expect(fn).toContain("'text-blue-600'");
  });

  test('status_flag 전이 SSOT는 ack 컬럼을 만지지 않음(doctor_ack_at 별개 신호 유지)', () => {
    const f = FLAG();
    expect(f).not.toContain('doctor_ack_at:'); // 전이 함수는 ack write 안 함
  });

  test('대기 테이블 ✋=completed{false} / 완료 테이블 ✋=completed(파랑·잠금)', () => {
    const s = DASH();
    expect(s).toContain('completed={false}');
    expect(s).toMatch(/<HandToggle[\s\S]*?completed\s*\n\s*onRefresh/);
  });
});
