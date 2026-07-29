import { test, expect } from '@playwright/test';
import {
  OWNER_FORCED_VISIT_TYPE,
  applyOwnerForcedVisitType,
} from '../../src/lib/visitTypeOverrides';

/**
 * T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE (Phase 2A)
 *
 * 재진 과다집계(직원별 누적) 교정 — 두 불변식 잠금:
 *   (I)  self-contamination 경계교정: 초진/재진 판정경계 = '판정대상 check_in 자기 시각'(strict <).
 *        → 자기·후속 방문을 배제해 "과거날짜 첫 완료방문" 자기-오염 재진 오승격을 차단.
 *   (II) owner-forced 보존: recency 재파생이 총괄 수동판단(초진/재진)을 덮어쓰지 않도록 pin.
 *
 * ※ 라이브 데이터 전량 재적용 검증(229행 before→after, per-consultant)은
 *    scripts/..._phase2_reconcile_dryrun.mjs (READ-ONLY) = AC4 근거. 본 spec 은 순수 불변식 잠금.
 */

// ── (I) 경계교정 순수 미러 — 배포 resolver(resolveVisitTypesByCheckIn) 판정 코어와 동형 ──
const WINDOW = 365;
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** self checked_in_at(KST date) + 완료방문일들(KST date, 오름차순) → 초진/재진 (자기 시각 이전만) */
function classifyByCheckIn(selfDate: string, priorDoneDates: string[]): 'new' | 'returning' {
  let lastPrior: string | null = null;
  for (const d of priorDoneDates) {
    if (d < selfDate) lastPrior = d; // strict < : 자기·후속 배제
    else break;
  }
  if (!lastPrior) return 'new';
  return diffDays(lastPrior, selfDate) <= WINDOW ? 'returning' : 'new';
}

test.describe('T-20260727 RECLASS 2A — 초진/재진 판정 불변식', () => {
  test('(I-a) RC 재현: 과거날짜 첫 완료방문은 자기 시각 판정에서 초진(자기-오염 배제)', () => {
    // 오픈 후 첫 방문이 이미 done — 유일한 done 이 자기 자신. 자기 시각 이전 done = 0 → 초진.
    const self = '2026-07-05';
    const dones = ['2026-07-05']; // 자기 완료방문만 존재
    expect(classifyByCheckIn(self, dones)).toBe('new');
  });

  test('(I-b) 자기 이전 done 존재 → 재진 (365일 이내)', () => {
    // 배정 07-25, 이전 done 07-18 → 재진 (KEEP 강경민 b3b7eac9 동형). dones=오름차순.
    expect(classifyByCheckIn('2026-07-25', ['2026-07-18'])).toBe('returning');
  });

  test('(I-c) 365일 경계: 정확히 365일 전=재진, 366일 전=초진', () => {
    expect(classifyByCheckIn('2027-07-18', ['2026-07-18'])).toBe('returning'); // diff=365 inclusive
    expect(classifyByCheckIn('2027-07-19', ['2026-07-18'])).toBe('new'); // diff=366 exclusive
  });

  test('(I-d) 후속(미래) 완료방문은 재진 근거 아님', () => {
    // 자기 07-02, 이후 07-10 done 존재 → 07-02 판정에는 미반영 → 초진.
    expect(classifyByCheckIn('2026-07-02', ['2026-07-10'])).toBe('new');
  });

  // ── (II) owner-forced 보존 ──
  test('(II-a) owner-forced 맵 = 총괄 confirm 4건 정확 pin', () => {
    // 정명희#4270 (JMH sibling) → 초진 / EDGE-KEEP ③⑥⑦ → 재진
    expect(OWNER_FORCED_VISIT_TYPE['1c2117de-b091-4227-b8a5-a167c1d865b7']).toBe('new');
    expect(OWNER_FORCED_VISIT_TYPE['9b701267-3681-4380-a2c9-7dcf9dbec6a2']).toBe('returning');
    expect(OWNER_FORCED_VISIT_TYPE['ebea2e1f-a589-47ad-b3e8-c71a0340f513']).toBe('returning');
    expect(OWNER_FORCED_VISIT_TYPE['01baf9ea-23e4-4e3f-9ec2-288638eece4b']).toBe('returning');
    expect(Object.keys(OWNER_FORCED_VISIT_TYPE)).toHaveLength(4);
  });

  test('(II-b) recency 가 초진이라도 owner-forced 재진이면 재진 유지 (③⑥⑦ 회귀가드)', () => {
    // ③⑥⑦ = prior done 0 → recency 'new' 예측. owner pin 이 'returning' 으로 보존.
    const recency = classifyByCheckIn('2026-07-10', []); // 이전 done 없음 → new
    expect(recency).toBe('new');
    expect(applyOwnerForcedVisitType('9b701267-3681-4380-a2c9-7dcf9dbec6a2', recency)).toBe('returning');
  });

  test('(II-c) recency 가 재진이라도 owner-forced 초진이면 초진 유지 (정명희 override 보존)', () => {
    // 정명희 = prior done 06-20 → recency 'returning'. owner pin 이 'new' 로 보존(재-파생 덮어쓰기 차단).
    const recency = classifyByCheckIn('2026-07-10', ['2026-06-20']); // 이전 done → returning
    expect(recency).toBe('returning');
    expect(applyOwnerForcedVisitType('1c2117de-b091-4227-b8a5-a167c1d865b7', recency)).toBe('new');
  });

  test('(II-d) override 없는 레코드는 recency 결과 그대로 통과', () => {
    expect(applyOwnerForcedVisitType('ffffffff-0000-0000-0000-000000000000', 'returning')).toBe('returning');
    expect(applyOwnerForcedVisitType('ffffffff-0000-0000-0000-000000000000', 'new')).toBe('new');
  });
});
