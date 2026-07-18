/**
 * E2E spec — T-20260710-foot-SECDEF-ANON-REVOKE  ★ SUPERSEDED (2026-07-18) ★
 *
 * supervisor DB-GATE NO-GO(2026-07-18) + dev-foot 재baseline 결과 CLOSE-AS-SUPERSEDED.
 * 원안(anon 119→14 whitelist) 은 stale baseline. 현 prod(2026-07-18) anon=33 = 전량 self-service CLASS,
 * money/Tier-A anon-grant 0건, postgres 창조경로 default-deny 이미 적용 → 핵심 보안목표 이미 달성.
 * 원안 apply 시 회귀(live self-checkin 함수 회수 → 파손). 따라서 forward/rollback = inert no-op.
 *
 * 본 spec 은 v1(마이그 구조·whitelist 14 단언) 을 폐기하고, SUPERSEDED 불변식을 결정론 소스-단언한다:
 *  (S1) forward/rollback 마이그가 inert no-op(회귀 유발 REVOKE/GRANT 부재).
 *  (S2) 재baseline 증거(dbgate_FINAL v2) 가 현 prod baseline(anon 33) + live 함수 보존 + SUPERSEDED 판정 수록.
 *  (S3) 잔여 유효 항목(supabase_admin default-priv) 기재.
 * 라이브 DB 증거(proacl 3자·pg_stat_statements)는 db-gate/…_dbgate_FINAL.md (재baseline v2) 참조.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIG = 'supabase/migrations/20260710223000_secdef_anon_execute_revoke_allowlist.sql';
const ROLLBACK = 'supabase/migrations/20260710223000_secdef_anon_execute_revoke_allowlist.rollback.sql';
const DBGATE = 'db-gate/T-20260710-foot-SECDEF-ANON-REVOKE_dbgate_FINAL.md';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');

// 원안 apply 시 회수돼 파손됐을 live self-service 함수(재baseline v2 §3 증거).
const LIVE_MUST_PRESERVE: ReadonlyArray<string> = [
  'self_checkin_lookup',
  'get_today_reservations',
  'fn_selfcheckin_today_reservations',
];

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — SUPERSEDED 아티팩트 (S1·S2)', () => {
  test('마이그·롤백·DB게이트 아티팩트 존재', () => {
    expect(fs.existsSync(path.resolve(MIG))).toBe(true);
    expect(fs.existsSync(path.resolve(ROLLBACK))).toBe(true);
    expect(fs.existsSync(path.resolve(DBGATE))).toBe(true);
  });

  test('(S1) forward 마이그 = inert no-op — 회귀 유발 REVOKE/GRANT 부재', () => {
    const sql = read(MIG);
    expect(sql).toMatch(/SUPERSEDED/i);
    // 주석 제거 후 실행 SQL 에 파괴적 REVOKE/GRANT 없음
    const stmts = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(stmts).not.toMatch(/REVOKE\s+EXECUTE/i);
    expect(stmts).not.toMatch(/GRANT\s+EXECUTE/i);
    expect(stmts).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/i);
  });

  test('(S1) rollback 마이그 = inert no-op', () => {
    const rb = read(ROLLBACK);
    expect(rb).toMatch(/SUPERSEDED/i);
    const stmts = rb.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(stmts).not.toMatch(/REVOKE\s+EXECUTE/i);
    expect(stmts).not.toMatch(/GRANT\s+EXECUTE/i);
  });
});

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — 재baseline 증거 (S2·S3)', () => {
  const doc = read(DBGATE);

  test('(S2) 현 prod baseline(anon 33) + v1 119 폐기 명시', () => {
    expect(doc).toMatch(/33/);
    expect(doc).toMatch(/119/);
    expect(doc).toMatch(/stale|폐기|무효/);
  });

  test('(S2) SUPERSEDED 판정 + 핵심 보안목표 이미 달성 기재', () => {
    expect(doc).toMatch(/SUPERSEDED/i);
    expect(doc).toMatch(/default-deny/i);
    expect(doc).toMatch(/Tier-A/);
    expect(doc).toMatch(/이미 달성|이미 봉합|이미 제거/);
  });

  test('(S2) live self-service 함수 보존 근거(회수 금지) 기재', () => {
    for (const fn of LIVE_MUST_PRESERVE) {
      expect(doc).toContain(fn);
    }
    expect(doc).toMatch(/pg_stat_statements/);
  });

  test('(S3) 잔여 유효 항목 supabase_admin default-priv 기재', () => {
    expect(doc).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/);
  });
});
