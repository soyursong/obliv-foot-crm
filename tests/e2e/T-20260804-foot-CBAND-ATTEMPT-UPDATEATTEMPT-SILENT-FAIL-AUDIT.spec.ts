import { test, expect } from '@playwright/test';
import {
  persistAuditWriteWithRetry,
  AUDIT_WRITE_MAX_ATTEMPTS,
  type AuditWriteOutcome,
} from '../../src/lib/cband/supabaseAttemptStore';

/**
 * T-20260804-foot-CBAND-ATTEMPT-UPDATEATTEMPT-SILENT-FAIL-AUDIT
 *   cband_payment_attempts.updateAttempt 사일런트 실패 → CAT 응답 감사트레일 유실 보강 (결정론·DB 무접촉).
 * ────────────────────────────────────────────────────────────────────────────
 * 관측(부모 field-soak): 실결제 attempt 8bdf3127 = raw_response=NULL·auth_no=NULL·status=attention.
 *   근본원인(단말 미마스킹 PAN → PCI 가드 RAISE → updateAttempt 삼킴) + rows-affected 표면화(AC-1)는
 *   RESPRECV-BANNER-RCA(8c3aa1cf)에서 이미 구현(중복 금지 = AC-4). 본 티켓 신규 facet = **AC-2 최종 영속 보강**:
 *   RCA가 제거한 원인 외 일시장애에서도 감사 write 가 조용히 유실되지 않도록 bounded 재시도.
 *
 * 계약: cross_crm_write_rowcheck_standard (Silent Write-Failure 금지, DID-IT-PERSIST).
 * 검증 대상 = persistAuditWriteWithRetry(공용 재시도 래퍼, sleep 주입으로 대기 없이 결정론 검증).
 *   ★throw 안 함(승인/수납 성립 보존·회귀0) — 재시도 소진 시 false 반환 + 큰 소리 표면화(로그)만.
 */

const noopSleep = async (_ms: number): Promise<void> => {};
const CTX = { label: '결제 시도 감사 갱신', msgTrace: '558080127045' };

test.describe('CBAND updateAttempt 감사 write 사일런트 실패 보강 (AC-2)', () => {
  // ── 시나리오 1: updateAttempt 실패 → 표면화 + 재시도로 최종 영속 ────────────────
  test('시나리오1a: 일시 실패 후 재시도 성공 → 최종 영속(ok=true), 유실 로그 없음', async () => {
    // 처음 2회는 유실(0행/에러), 3회차 성공 — RCA가 못 잡는 일시장애(순단/경합)의 재현.
    let calls = 0;
    const doWrite = async (): Promise<AuditWriteOutcome> => {
      calls += 1;
      if (calls === 1) return { ok: false, detail: '0행 반영(권한/스코프/가드 — INV-W2)' };
      if (calls === 2) return { ok: false, detail: 'network reset' };
      return { ok: true };
    };
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
    try {
      const persisted = await persistAuditWriteWithRetry(doWrite, CTX, { sleep: noopSleep });
      expect(persisted).toBe(true);            // ★DID-IT-PERSIST: 최종 영속 확정.
      expect(calls).toBe(3);                   // 3회차에 성공(=재시도 동작).
    } finally {
      console.error = origErr;
    }
    // 최종 영속 성공 → '유실 위험' 경보 로그가 남지 않는다(사일런트 아님 + false-alarm 아님).
    expect(errors.some((e) => e.includes('CBAND-AUDIT-WRITE-FAILURE'))).toBe(false);
  });

  test('시나리오1b: 즉시 성공(1회) → 재시도 없이 영속, 감사 로그 없음', async () => {
    let calls = 0;
    const doWrite = async (): Promise<AuditWriteOutcome> => { calls += 1; return { ok: true }; };
    const persisted = await persistAuditWriteWithRetry(doWrite, CTX, { sleep: noopSleep });
    expect(persisted).toBe(true);
    expect(calls).toBe(1);                     // 정상 경로 = 단 1회(회귀 0).
  });

  test('시나리오1c: 전 시도 실패 → 사일런트 아님(throw 없이 표면화 + ok=false 관측)', async () => {
    let calls = 0;
    const doWrite = async (): Promise<AuditWriteOutcome> => {
      calls += 1;
      return { ok: false, detail: 'PCI 가드 RAISE(가상)' };
    };
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
    let threw = false;
    let persisted: boolean | undefined;
    try {
      // ★throw 하지 않아야 한다(승인/수납 성립 보존). 반환값으로만 실패 관측.
      persisted = await persistAuditWriteWithRetry(doWrite, CTX, { sleep: noopSleep });
    } catch {
      threw = true;
    } finally {
      console.error = origErr;
    }
    expect(threw).toBe(false);                            // 무접점·회귀0 = throw 금지.
    expect(persisted).toBe(false);                        // 유실 관측 가능(사일런트 성공-오인 금지).
    expect(calls).toBe(AUDIT_WRITE_MAX_ATTEMPTS);         // 소진까지 재시도.
    // 큰 소리 표면화 = 로그에 유실 경보가 정확히 1회.
    const alarms = errors.filter((e) => e.includes('CBAND-AUDIT-WRITE-FAILURE'));
    expect(alarms.length).toBe(1);
    expect(alarms[0]).toContain(CTX.msgTrace);            // msg_trace 로 단말 [승인내역조회] 추적 가능.
    expect(alarms[0]).toContain('DID-IT-PERSIST');
  });

  test('시나리오1d: doWrite 가 throw 해도 삼키고 재시도(예외도 유실로 취급)', async () => {
    let calls = 0;
    const doWrite = async (): Promise<AuditWriteOutcome> => {
      calls += 1;
      if (calls < AUDIT_WRITE_MAX_ATTEMPTS) throw new Error('transient supabase 예외');
      return { ok: true };
    };
    const persisted = await persistAuditWriteWithRetry(doWrite, CTX, { sleep: noopSleep });
    expect(persisted).toBe(true);              // 예외를 유실로 취급 → 마지막 시도에서 회복.
    expect(calls).toBe(AUDIT_WRITE_MAX_ATTEMPTS);
  });

  // ── 시나리오 2: 정상 경로 회귀(재시도 파라미터 존중) ─────────────────────────────
  test('시나리오2: maxAttempts/ delays 주입 존중 — 최대 시도 초과 안 함', async () => {
    let calls = 0;
    const doWrite = async (): Promise<AuditWriteOutcome> => { calls += 1; return { ok: false, detail: 'x' }; };
    const origErr = console.error;
    console.error = () => {};
    try {
      const persisted = await persistAuditWriteWithRetry(doWrite, CTX, { maxAttempts: 2, delaysMs: [0], sleep: noopSleep });
      expect(persisted).toBe(false);
      expect(calls).toBe(2);                   // 주입한 maxAttempts=2 정확 존중.
    } finally {
      console.error = origErr;
    }
  });
});
