/**
 * E2E spec — T-20260615-foot-DOCDASH-SHAKE-ACK-NOT-COMPLETE  (P0 핫픽스, 문지은 대표원장)
 *
 * 증상: 진료호출알람 수신 후 손(✋) '첫 탭'이 ack(수신확인)가 아니라 곧장 '진료완료'로 점프.
 * 근본원인(가설 A 확정): 대시보드 HandToggle 의 acked = doctor_ack_at(값존재). 그런데 doctor_ack_at 은
 *   (1) 진료알림판 floating 호출바 DoctorStageStepper '원장확인' 노드(setDoctorStage(1)) 와
 *   (2) 동일 check_in 재호출(purple→pink→purple) 시 직전 라운드 잔존
 *   으로 '선점(preset)'되어 손이 '초록'으로 도착 → 기존 '초록 탭=즉시 완료' 로직이 '첫 손 탭'을 완료시킴.
 * 교정(consumption-point, 스키마/스텝퍼 무변경): 초록이라도 '이 위젯에서 완료 의도가 확인(arm)된 두 번째 탭'에서만 완료.
 *   arm = (a) 회색→ack 탭 자동 set(정상 2-탭 보존) 또는 (b) 초록 첫 탭에서 안내 토스트와 함께 set.
 *   arm 레지스트리 = 현재 호출키(id@콜시각) 단위 모듈 스코프 → refetch/remount 보존 + 재호출마다 자연 리셋.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec(T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT) 컨벤션 동일.
 *   ⚠ 실브라우저 2-탭 분리 동선(AC6)은 supervisor field-soak / 현장 confirm 게이트에서 최종 확인.
 *
 * 시나리오 1 (ack-only 첫 탭): 회색 SHAKE 첫 탭 → recordAck 만, status_flag/completed_at 불변(완료 점프 0).
 * 시나리오 2 (두 번째 탭에서만 완료): ack(초록) → arm 된 탭에서만 applyStatusFlagTransition('pink').
 * 시나리오 3 (회귀 가드): 파랑 완료해제 차단 / 회색→ack 의사 전용 게이트 / 완료 섹션 무회귀.
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

/** HandToggle 함수 본문만 추출(인접 컴포넌트 오염 방지). */
const HAND_FN = () => {
  const s = DASH();
  const start = s.indexOf('function HandToggle(');
  expect(start).toBeGreaterThan(0);
  // 다음 최상위 컴포넌트(VisitBadge) 직전까지 = HandToggle 스코프
  const end = s.indexOf('function VisitBadge(', start);
  return s.slice(start, end > 0 ? end : undefined);
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — ack-only 첫 탭 (회색 SHAKE 첫 탭 = 수신확인만, 완료 점프 0)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — 회색(SHAKE) 첫 탭 = ack only', () => {
  test('shake 분기는 recordAck 만 수행하고 status_flag 전이를 호출하지 않는다', () => {
    const fn = HAND_FN();
    const shakeStart = fn.indexOf("if (visual === 'shake')");
    expect(shakeStart).toBeGreaterThan(0);
    // shake 분기는 다음(초록) 분기 시작 전까지 — 그 범위 안엔 완료 전이가 없어야 함
    const greenMarker = fn.indexOf('// 초록(확인됨)', shakeStart);
    const shakeBlock = fn.slice(shakeStart, greenMarker > 0 ? greenMarker : undefined);
    expect(shakeBlock).toContain('await recordAck(checkIn.id)');
    expect(shakeBlock).not.toContain('applyStatusFlagTransition'); // 회색→완료 점프 0
  });

  test('shake 탭은 정상 2-탭 보존을 위해 현재 호출을 arm 한다(ack 직후 다음 탭이 완료)', () => {
    const fn = HAND_FN();
    const shakeStart = fn.indexOf("if (visual === 'shake')");
    const greenMarker = fn.indexOf('// 초록(확인됨)', shakeStart);
    const shakeBlock = fn.slice(shakeStart, greenMarker);
    expect(shakeBlock).toContain('armedCompleteCalls.add(callId)');
  });

  test('ack(recordAck)는 doctor_ack_at 만 write — completed_at/status_flag 불변(SSOT 격리)', () => {
    const a = ACK();
    const start = a.indexOf('export async function recordAck');
    expect(start).toBeGreaterThan(0);
    const next = a.indexOf('\nexport ', start + 1);
    const fn = a.slice(start, next > 0 ? next : undefined); // recordAck 함수 본문만(주석 오염 배제)
    expect(fn).toContain('.update({ doctor_ack_at: new Date().toISOString() })');
    expect(fn.match(/\.update\(/g)?.length).toBe(1); // update 1회(ack 컬럼)뿐
    expect(fn).not.toContain('completed_at');
    expect(fn).not.toContain('status_flag');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 완료는 '두 번째' 명시 탭에서만 (초록 선점 첫 탭 = 완료 예고만)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 완료는 arm 된 두 번째 탭에서만', () => {
  test('arm 레지스트리는 모듈 스코프 Set(refetch/remount 보존)', () => {
    expect(DASH()).toContain('const armedCompleteCalls = new Set<string>();');
  });

  test('arm 키는 현재 호출키(callKey = id@콜시각) — 재호출 시 자연 리셋', () => {
    const fn = HAND_FN();
    expect(fn).toContain('const callId = callKey(checkIn);');
  });

  test('초록 첫 탭(미-arm)은 완료가 아니라 arm + 안내 토스트 후 return(완료 미수행)', () => {
    const fn = HAND_FN();
    const guardStart = fn.indexOf('if (!armedCompleteCalls.has(callId))');
    expect(guardStart).toBeGreaterThan(0);
    const guardBlock = fn.slice(guardStart, fn.indexOf('}', guardStart) + 1);
    expect(guardBlock).toContain('armedCompleteCalls.add(callId)');
    expect(guardBlock).toContain('한 번 더 누르면 진료완료');
    expect(guardBlock).toContain('return;');
    // 가드 블록 안에는 완료 전이가 없어야 함
    expect(guardBlock).not.toContain('applyStatusFlagTransition');
  });

  test('완료 전이는 가드(!armed return) 이후에만 도달 — 즉 arm 된 두 번째 탭에서만 실행', () => {
    const fn = HAND_FN();
    const guardIdx = fn.indexOf('if (!armedCompleteCalls.has(callId))');
    const completeIdx = fn.indexOf("applyStatusFlagTransition(checkIn, 'pink', actor)");
    expect(guardIdx).toBeGreaterThan(0);
    expect(completeIdx).toBeGreaterThan(guardIdx); // 완료는 가드 뒤에 위치
  });

  test('완료 처리 후 arm 해제(호출 종료)', () => {
    const fn = HAND_FN();
    expect(fn).toContain('armedCompleteCalls.delete(callId)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 회귀 가드 (파랑 해제차단 / 회색 의사전용 / 완료 SSOT 격리)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3 — 회귀 가드', () => {
  test('파랑(완료) 탭은 완료 해제 안 함(안내만, 전이 호출 없음)', () => {
    const fn = HAND_FN();
    const blueStart = fn.indexOf("if (visual === 'blue')");
    const blueBlock = fn.slice(blueStart, fn.indexOf('}', blueStart) + 1);
    expect(blueBlock).toContain('완료 해제는 지원하지 않아요');
    expect(blueBlock).not.toContain('applyStatusFlagTransition');
  });

  test('회색→ack 는 의사 전용 게이트 보존(비의사 차단 안내)', () => {
    const fn = HAND_FN();
    const shakeStart = fn.indexOf("if (visual === 'shake')");
    const shakeBlock = fn.slice(shakeStart, fn.indexOf('// 초록(확인됨)', shakeStart));
    expect(shakeBlock).toContain('if (!doctorMode)');
    expect(shakeBlock).toContain('의사만 확인');
  });

  test('3-상태 색 매핑 무변경(shake/green/blue) — 위젯 형태·팔레트 비범위 보존', () => {
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

  test('완료 테이블 HandToggle 은 completed(파랑)·대기 테이블은 completed={false}', () => {
    const s = DASH();
    expect(s).toContain('completed={false}');
    expect(s).toMatch(/<HandToggle[\s\S]*?completed\s*\n\s*onRefresh/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 비범위 가드 — PURPLE-STEPPER A/B 결정 선점 금지 / 스키마·위젯 형태 무변경
// ─────────────────────────────────────────────────────────────────────────────
test.describe('비범위 가드 — A/B 결정·스키마·위젯 형태 무변경', () => {
  test('스텝퍼 컴포넌트(DoctorStageStepper)를 대시보드 손 토글에 도입하지 않음(A/B 선점 0)', () => {
    const s = DASH();
    // 주석 언급은 허용(근본원인 기록), 실제 import/JSX 사용만 금지(A/B 결정 선점 0)
    expect(s).not.toMatch(/from ['"][^'"]*DoctorStageStepper['"]/); // import 경로 없음
    expect(s).not.toContain('<DoctorStageStepper'); // JSX 렌더 없음
  });

  test('신규 컬럼/스키마 write 신설 0 — 기존 recordAck/applyStatusFlagTransition 재사용', () => {
    const fn = HAND_FN();
    expect(fn).toContain('await recordAck(checkIn.id)');
    expect(fn).toContain("applyStatusFlagTransition(checkIn, 'pink', actor)");
  });
});
