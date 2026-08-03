import { test, expect } from '@playwright/test';
import { CBAND_SEND_TIMEOUT_MS } from '../../src/lib/cband/catClient';
import { classify } from '../../src/lib/cband/protocol';

/**
 * T-20260803-foot-CBAND-PAYRESP-WAIT-TIMEOUT-EXTEND
 * ────────────────────────────────────────────────────────────────────────────
 * 코밴/CAT 직결결제 응답 대기 timeout 규명 + 조건부 연장.
 *
 * AC-1(규명): 25초 대기 timeout 출처 = CRM 클라 상수 `CBAND_SEND_TIMEOUT_MS`
 *             (src/lib/cband/catClient.ts:26). 데몬/외부 강제값 아님 — send() 내부
 *             setTimeout 으로 CRM 이 자기 타이머로 응답 대기를 종료. → AC-2(CRM설정 BUILD) 분기.
 * AC-2(연장): 25_000 → 45_000. 단말 자가종료(카드 미투입 시 31~32초 후 결과 반환) 초과 +
 *             결과 전문 수신 여유. GO_WARN 상한 60초 이내, 권장 밴드 40~50초.
 *
 * ★ 값만 조정 — 성공/실패/타임아웃 판정(classify)·이중결제방지(send-lock)·전문 파싱 불변을 회귀 고정.
 */

test.describe('CBAND-PAYRESP-WAIT-TIMEOUT-EXTEND', () => {
  test('AC-2: send timeout 이 단말 자가종료(32초)를 초과하도록 연장됨', () => {
    // 현장 실측: 단말은 카드 미투입 시 최대 32초에 자가종료 후 결과 전문 반환.
    // CRM 대기가 그보다 짧으면(종전 25초) 어중간 구간 발생 → 단말 결과를 수신할 만큼 길어야 함.
    expect(CBAND_SEND_TIMEOUT_MS).toBeGreaterThan(32_000);
  });

  test('AC-2/GO_WARN: 과다연장 방지 — 60초 상한 이내(권장 40~50초대)', () => {
    expect(CBAND_SEND_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    // 연장 후 확정값 = 45초(단말 32초 + 결과 수신 여유 ~13초).
    expect(CBAND_SEND_TIMEOUT_MS).toBe(45_000);
  });

  test('불변: 무응답(타임아웃)은 여전히 ATTENTION 으로 분류(자동 재시도 금지·이중결제 방지)', () => {
    // timeout → send 는 raw=null,timedOut=true 반환 → 상위에서 resp=null → classify(null)=ATTENTION.
    // timeout 값 변경이 이 판정 로직에 영향을 주지 않음을 회귀 고정.
    expect(classify(null)).toBe('ATTENTION');
  });
});
