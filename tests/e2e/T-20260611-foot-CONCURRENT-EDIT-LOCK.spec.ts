/**
 * T-20260611-foot-CONCURRENT-EDIT-LOCK
 * 펜차트 양식 4종(pen_chart / health_questionnaire_general / health_questionnaire_senior /
 * refund_consent) "양식 관리(편집)" 화면 동시편집 잠금.
 *
 * ── 구성 ──────────────────────────────────────────────────────────────────
 * Part A (지금 실행 — 잠금 선출 순수 로직): 시나리오 1·2·3 의 핵심 동작
 *   (먼저 진입자 보유 / stale 자동 해제 / 양식 독립)을 결정론적 순수 함수 수준에서 검증.
 *   브라우저 불필요 → presence/네트워크 타이밍에 흔들리지 않는 안정 회귀선.
 *
 * Part B (skip — 현장 풀 동선 E2E): 시나리오 1·2·3 의 실제 두-세션 브라우저 동선.
 *   잠금이 붙을 "펜차트 양식 관리(편집) 화면" 본체가 아직 없음
 *   (T-20260611-foot-PENCHART-FORM-TEMPLATE-EDIT 가 blocked/human_pending).
 *   해당 화면 랜딩 후 selector 를 채우고 test.skip 을 해제할 것.
 */
import { test, expect } from '@playwright/test';
import {
  electLockOwner,
  evaluateLock,
  buildLockMessage,
  isLockableFormKey,
  LOCK_STALE_MS,
  LOCKABLE_FORM_KEYS,
  type LockParticipant,
} from '../../src/lib/formEditLock';

const NOW = 1_800_000_000_000;
const fresh = (over: Partial<LockParticipant>): LockParticipant => ({
  userId: 'u',
  userName: 'X',
  joinedAt: NOW,
  lastBeat: NOW,
  ...over,
});

test.describe('T-20260611-foot-CONCURRENT-EDIT-LOCK — Part A 잠금 선출 순수 로직', () => {
  // ── 시나리오 1: 정상 동선(동시 편집 잠금) ──
  test('S1-AC1·2: 먼저 진입한 직원A 가 잠금 보유, 이후 진입 직원B 는 read-only + 안내', () => {
    const A = fresh({ userId: 'A', userName: '직원A', joinedAt: NOW });
    const B = fresh({ userId: 'B', userName: '직원B', joinedAt: NOW + 2_000 });

    const evalA = evaluateLock([A, B], 'A', NOW + 3_000);
    expect(evalA.isOwner).toBe(true); // 저장 활성
    expect(evalA.isLocked).toBe(false);

    const evalB = evaluateLock([A, B], 'B', NOW + 3_000);
    expect(evalB.isOwner).toBe(false);
    expect(evalB.isLocked).toBe(true); // read-only
    expect(evalB.lockedByName).toBe('직원A');
    expect(buildLockMessage(evalB.lockedByName)).toBe(
      '지금 직원A님이 편집 중이에요. 편집이 끝나면 알려드릴게요.',
    );
  });

  test('S1-AC3: 직원A 저장 완료/이탈(presence 제거) → 직원B 잠금 해제, 편집 가능 전환', () => {
    const B = fresh({ userId: 'B', userName: '직원B', joinedAt: NOW + 2_000 });
    // A 가 빠진 뒤 — B 단독 → B 가 보유자.
    const evalB = evaluateLock([B], 'B', NOW + 3_000);
    expect(evalB.isLocked).toBe(false);
    expect(evalB.isOwner).toBe(true);
  });

  test('동시 진입(joinedAt 동률) → userId 사전순으로 결정론적(모든 클라이언트 동일 결론)', () => {
    const A = fresh({ userId: 'A', joinedAt: NOW });
    const B = fresh({ userId: 'B', joinedAt: NOW });
    expect(electLockOwner([A, B], NOW + 1_000)?.userId).toBe('A');
    expect(electLockOwner([B, A], NOW + 1_000)?.userId).toBe('A'); // 순서 무관 동일
  });

  // ── 시나리오 2: 엣지(stale lock 자동 해제) ──
  test('S2: 직원A 탭 강제종료(heartbeat 끊김) → stale 경과 후 잠금 자동 해제, 직원B 편집 가능', () => {
    const A = fresh({ userId: 'A', userName: '직원A', joinedAt: NOW, lastBeat: NOW });
    const B = fresh({ userId: 'B', userName: '직원B', joinedAt: NOW + 2_000, lastBeat: NOW + 2_000 });

    // stale 임계 직전: A 여전히 보유.
    const justBefore = NOW + LOCK_STALE_MS - 1;
    // B 의 lastBeat 는 살아있다고 가정(heartbeat 갱신).
    const aliveB = { ...B, lastBeat: justBefore };
    expect(evaluateLock([A, aliveB], 'B', justBefore).isLocked).toBe(true);

    // stale 임계 경과: A 후보 제외 → B 가 보유자 → 잠금 해제.
    const after = NOW + LOCK_STALE_MS + 1;
    const aliveB2 = { ...B, lastBeat: after };
    const evalB = evaluateLock([A, aliveB2], 'B', after);
    expect(evalB.isLocked).toBe(false);
    expect(evalB.isOwner).toBe(true);
  });

  test('S2: 전원 stale → 보유자 없음(null) — 잠금 영구 잔존 금지', () => {
    const A = fresh({ userId: 'A', lastBeat: NOW });
    expect(electLockOwner([A], NOW + LOCK_STALE_MS + 1)).toBeNull();
  });

  // ── 시나리오 3: 양식 4종 독립 잠금 ──
  test('S3: 양식 4종 모두 잠금 대상이며 form_key 별 독립(채널 분리로 서로 차단 안 됨)', () => {
    // 정책 레벨: 대상 4종 확정 + 비대상은 잠금 미적용.
    expect([...LOCKABLE_FORM_KEYS]).toEqual([
      'pen_chart',
      'health_questionnaire_general',
      'health_questionnaire_senior',
      'refund_consent',
    ]);
    expect(isLockableFormKey('pen_chart')).toBe(true);
    expect(isLockableFormKey('refund_consent')).toBe(true);
    expect(isLockableFormKey('some_other_form')).toBe(false);

    // 독립성: pen_chart 잠금 평가는 refund_consent 참가자와 무관(훅은 form_key 별 채널 구독).
    // 순수 로직에서는 "각 양식 참가자 집합이 분리되어 평가됨"을 모델로 검증.
    const penOwner = electLockOwner([fresh({ userId: 'A', joinedAt: NOW })], NOW + 100);
    const refundOwner = electLockOwner([fresh({ userId: 'B', joinedAt: NOW + 50 })], NOW + 100);
    expect(penOwner?.userId).toBe('A');
    expect(refundOwner?.userId).toBe('B'); // 서로 차단/간섭 없음
  });

  test('편집자 이름 누락 → 폴백 표기로 안내 문구 유지(빈 화면 방지)', () => {
    expect(buildLockMessage(null)).toBe('지금 다른 직원님이 편집 중이에요. 편집이 끝나면 알려드릴게요.');
    expect(buildLockMessage('   ')).toBe('지금 다른 직원님이 편집 중이에요. 편집이 끝나면 알려드릴게요.');
  });
});

/**
 * Part B — 현장 풀 동선 두-세션 E2E.
 * 마운트 지점(펜차트 양식 관리 편집 화면) 랜딩 후 활성화.
 * 활성화 체크리스트:
 *   1) T-20260611-foot-PENCHART-FORM-TEMPLATE-EDIT 배포로 "양식 관리 → pen_chart 편집" 라우트 확정.
 *   2) 편집 화면에 useFormEditLock(formKey) 배선 + isLocked 시 저장 disabled + <FormEditLockBanner/>.
 *   3) 아래 selector(편집 진입 버튼/저장 버튼/배너 testid=form-edit-lock-banner) 확정.
 *   4) browser.newContext() 2개(직원A/직원B 다른 storageState)로 동시 세션 구성.
 */
test.describe('T-20260611-foot-CONCURRENT-EDIT-LOCK — Part B 현장 두-세션 E2E', () => {
  test.skip(true, '편집 화면 본체(T-20260611-foot-PENCHART-FORM-TEMPLATE-EDIT) 미배포 — 랜딩 후 unskip');

  test('S1: 직원B 진입 시 배너 노출 + 저장 비활성, 직원A 저장/이탈 후 직원B 잠금 해제', async () => {
    // TODO(landing): 2 context, A 편집 진입 → B 편집 진입 → B 배너 노출 + 저장 disabled →
    //                A 저장/이탈 → B 배너 사라지고 저장 활성.
    expect(true).toBe(true);
  });

  test('S2: 직원A 탭 강제종료 → stale 경과 후 직원B 잠금 자동 해제', async () => {
    // TODO(landing): A context.close() → 약 LOCK_STALE_MS 경과 → B 배너 소멸 + 저장 활성.
    expect(true).toBe(true);
  });

  test('S3: 직원A pen_chart, 직원B refund_consent 동시 편집 — 서로 차단 안 됨', async () => {
    // TODO(landing): 서로 다른 양식 편집 진입 → 양측 모두 배너 없음 + 저장 활성.
    expect(true).toBe(true);
  });
});
