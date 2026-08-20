/**
 * E2E spec — T-20260807-foot-CONSULTASSIGN-NOCONFIRM-AUTOACCRUE-VOID (P1)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH):
 *   박효식(F-5716) 미상담 귀가 + 상담사 [확정] 미클릭인데 최현희 실장 '상담 배정 수' 자동 누적.
 *
 * Phase 2 방식 확정(김주연 총괄 confirm 2026-08-07, MSG-20260807-144848-6uvz):
 *   ① [확정] 클릭 = 배정 카운팅 게이트 (방법 C) — KPI '상담 배정 수' = 확정된 배정만 count.
 *   ② 미상담 귀가(cancelled/no-show) 배정은 부하분산(다음 배정 대상)에서도 void(미계수).
 *
 * ─ 게이트 술어 = consult_notify_status IS NOT NULL (='sending'|'sent'|'failed') = "[확정] 클릭됨"(내구 신호).
 *   'sent' 단독 금지 — CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN(ebbd230a) 후 Slack 실패는 'failed'/'sending'
 *   착지(NULL 롤백 아님)이며 그 배정도 [확정]된 정당 배정. IS NOT NULL 은 pre/post DECOUPLE 양쪽 정확(merge-order 안전).
 *
 * ─ 부하축(fetchTodayConsultAssignCounts)은 결정②(취소/삭제 제외)만 적용 — 결정①(notify 게이트) 미적용.
 *   dev-foot 부하 공정성 판단: 미확정-활성 배정을 부하축에서 빼면 pile-up(차기 배정 쏠림) → 공정성 붕괴.
 *
 * 프로드 실측 검증(2026-08-07, read-only): 당월 활성 consult 배정 178 → 확정 142 / 미확정 36 drop.
 *   최현희 = 미확정 4 + 확정 2 → 게이트 후 KPI 2(phantom 4 제외). 오늘 부하축 47건 中 1건 cancelled(F-5716) 제외.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(미상담 귀가 → 배정 미누적 / 정상 [확정] → +1)는 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const STRATEGY = 'src/lib/assignmentStrategy.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 결정①(방법 C) — KPI '상담 배정 수' 표시 count = [확정] 클릭된 배정만 (staffStats)
// ─────────────────────────────────────────────────────────────────────────────
// ⓘ T-20260820-...-STAFFSTATS-REGRESSION Option A 로 게이트가 notify-only → notify ∪ '상담단계 지남'
//   으로 OR-확장됨. 아래 결정① 회귀 단언은 "notify IS NOT NULL 계수분 보존"(=OR 의 한 branch)만 검증하도록
//   갱신(narrowing 아님). '상담단계 지남' branch 자체의 단언은 신규 STAFFSTATS-REGRESSION spec 이 소유.
test('결정①: staffStats 상담 배정 count 게이트에 consult_notify_status IS NOT NULL branch 보존', () => {
  const src = read(PAGE);
  // 상담 분기(consultant_id) 게이트가 notify != null 을 (OR 의 한 축으로) 계속 포함해야 한다(08-07 계수분 무회귀).
  expect(src).toMatch(/s\.role === 'consultant'/);
  expect(src).toMatch(/ci\.consult_notify_status != null/);
});

test('결정①: 게이트 술어는 IS NOT NULL — "=== \'sent\'" 단독 게이트 금지(DECOUPLE merge-safe)', () => {
  const src = read(PAGE);
  // staffStats 배정 count 게이트가 'sent' 문자열 등가 비교에 의존하지 않는다(!= null 사용).
  //   ('sent' 리터럴은 금일 배분 이력 [확정] 버튼 상태표시(doConfirmNotify/렌더)에는 존재 — 그건 count 게이트 아님)
  // OR-확장으로 게이트가 여러 줄로 분리 → 게이트 고유 앵커(hasPassedConsult 결합 술어) 범위에서 검증.
  //   (src.indexOf("s.role === 'consultant'") 는 ensure() 노출 루프에도 매칭 → 게이트 앵커로 부적합)
  const anchor = src.indexOf('ci.consult_notify_status != null');
  expect(anchor).toBeGreaterThan(-1);
  const gateBlock = src.slice(anchor, anchor + 120);
  expect(gateBlock).toContain('consult_notify_status != null');
  expect(gateBlock).not.toContain("consult_notify_status === 'sent'");
});

test('결정①: 치료(therapy)축은 notify 게이트 미적용(치료엔 확정/notify 개념 부재)', () => {
  const src = read(PAGE);
  // therapist_id 분기는 consult_notify_status 조건 없이 유지(치료축 불변).
  const therapyBlock = src.slice(src.indexOf('if (ci.therapist_id)'));
  const firstBump = therapyBlock.slice(0, therapyBlock.indexOf('bumpAssign'));
  expect(firstBump).not.toContain('consult_notify_status');
});

// ─────────────────────────────────────────────────────────────────────────────
// 결정②(no-show void) — 부하분산 count 에서 취소/삭제 배정 제외
// ─────────────────────────────────────────────────────────────────────────────
test('결정②: fetchTodayConsultAssignCounts 가 check_ins 조인으로 취소/삭제 배정 제외', () => {
  const src = read(STRATEGY);
  const fn = src.slice(src.indexOf('export async function fetchTodayConsultAssignCounts'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  // 앵커 check_in 상태 조인.
  expect(body).toContain('check_ins!inner(status, deleted_at)');
  // cancelled 또는 soft-delete 면 부하 count 제외(no-show void).
  expect(body).toMatch(/ci\.status === 'cancelled' \|\| ci\.deleted_at != null/);
});

test('결정②: 부하축은 결정①(notify 게이트) 미적용 — 미확정-활성은 계속 계수(pile-up 방지)', () => {
  const src = read(STRATEGY);
  const fn = src.slice(src.indexOf('export async function fetchTodayConsultAssignCounts'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  // 부하 count 로직 본문(주석 제외)에서 consult_notify_status 필터를 쓰지 않는다.
  const codeOnly = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n');
  expect(codeOnly).not.toContain('consult_notify_status');
});
