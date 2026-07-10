/**
 * E2E spec — T-20260710-foot-SECDEF-ANON-REVOKE
 * SECURITY DEFINER 함수 anon EXECUTE 회수 (default-deny PUBLIC+anon + allowlist 14, 단일 tx).
 * 계약 §15-5 / §16-3c / §1-8. 부모 T-20260710-ops-SECDEF-ANON-EXECUTE-GRANT-HYGIENE (DA AC1 GO).
 *
 * 본건은 grant 위생(proacl 권한 메타) 마이그 — behavioral surface = anon 공개 RPC EXECUTE 경계.
 * 결정론 소스-단언(마이그/롤백 구조 + 화이트리스트 14 + Tier-A 제외) + DB-GATE 기능 증거 참조.
 * 라이브 DB 증거(proacl 3자 대조·anon-role 기능 dry-run·pg_stat_statements 무호출)는
 *   db-gate/T-20260710-foot-SECDEF-ANON-REVOKE_dbgate_FINAL.md (supervisor DB-GATE 입력값)에 수록.
 *
 * AC1 — 화이트리스트 = 증거기반 14개(정확 sig, 오버로드 안전).
 * AC2 — deny-all(PUBLIC+anon) + allowlist, 단일 tx. authenticated/service_role 무접촉(무손실).
 * AC3 — 회귀 0: 공개 3흐름(문진·사전문진·셀프체크인) EXECUTE 보존 + Tier-A 돈-함수 회수.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIG = 'supabase/migrations/20260710223000_secdef_anon_execute_revoke_allowlist.sql';
const ROLLBACK = 'supabase/migrations/20260710223000_secdef_anon_execute_revoke_allowlist.rollback.sql';
const DBGATE = 'db-gate/T-20260710-foot-SECDEF-ANON-REVOKE_dbgate_FINAL.md';

// AC1 확정 화이트리스트 14 — 정확 시그니처(오버로드 안전). 마이그 GRANT 절과 1:1.
const WHITELIST: ReadonlyArray<string> = [
  'public.fn_health_q_submit(text, jsonb, text)',
  'public.fn_health_q_validate_token(text)',
  'public.fn_prescreen_start(uuid)',
  'public.fn_complete_prescreen_checklist(uuid, jsonb, text)',
  'public.fn_selfcheckin_create_health_q_token(uuid, uuid, text)',
  'public.fn_selfcheckin_dup_guard(uuid, uuid, text, date)',
  'public.fn_selfcheckin_reservation_banner(uuid, text)',
  'public.fn_selfcheckin_rrn_match(uuid, uuid)',
  'public.fn_selfcheckin_today_reservations(uuid, date)',
  'public.fn_selfcheckin_update_personal_info(uuid, uuid, text, text, text, text, boolean, boolean, text, text, boolean, timestamp with time zone, text)',
  'public.self_checkin_with_reservation_link(uuid, jsonb, date)',
  'public.next_queue_number(uuid, date)',
  'public.is_approved_user()',
  'public.current_user_is_admin_or_manager()',
];

// Tier-A 돈-함수 + 대표 비-WL 조회 — 회수 대상(anon GRANT 금지).
const TIER_A_MUST_NOT_GRANT: ReadonlyArray<string> = [
  'transfer_package_atomic',
  'consume_package_sessions_for_checkin',
  'refund_package_atomic',
  'calc_refund_amount',
  'get_package_remaining',
  'get_customer_packages',
];

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — 마이그 구조 (AC2)', () => {
  test('마이그·롤백·DB게이트 아티팩트 존재', () => {
    expect(fs.existsSync(path.resolve(MIG))).toBe(true);
    expect(fs.existsSync(path.resolve(ROLLBACK))).toBe(true);
    expect(fs.existsSync(path.resolve(DBGATE))).toBe(true);
  });

  test('단일 tx (BEGIN..COMMIT) 정확히 1쌍', () => {
    const sql = read(MIG);
    expect((sql.match(/^BEGIN;/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;/gm) ?? []).length).toBe(1);
  });

  test('deny-all = PUBLIC + anon 회수 (원안 anon-only no-op 정정)', () => {
    const sql = read(MIG);
    // 소급 회수: PUBLIC 과 anon 모두
    expect(sql).toMatch(/REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;/);
    // 신규 상속 차단: default privileges (postgres 창조 경로) PUBLIC + anon
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s*\n\s*REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s*\n\s*REVOKE EXECUTE ON FUNCTIONS FROM anon;/);
  });

  test('authenticated/service_role 무접촉 (무손실 — REVOKE/GRANT 대상 아님)', () => {
    // 주석(-- …) 제거 후 실행 SQL 문에서만 검사 (주석 내 언급은 허용)
    const stmts = read(MIG)
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    expect(stmts).not.toMatch(/\bauthenticated\b/);
    expect(stmts).not.toMatch(/\bservice_role\b/);
  });
});

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — 화이트리스트 14 (AC1)', () => {
  const sql = read(MIG);

  for (const sig of WHITELIST) {
    test(`GRANT 재부여: ${sig}`, () => {
      // 정확 시그니처로 GRANT ... TO anon (오버로드 안전)
      const esc = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      const re = new RegExp(`GRANT EXECUTE ON FUNCTION ${esc}\\s+TO anon;`);
      expect(sql).toMatch(re);
    });
  }

  test('anon 재부여 함수는 정확히 14개 (초과/누락 0)', () => {
    const grants = sql.match(/GRANT EXECUTE ON FUNCTION public\.[\s\S]*?TO anon;/g) ?? [];
    expect(grants.length).toBe(14);
    expect(WHITELIST.length).toBe(14);
  });
});

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — Tier-A 회수 (AC3)', () => {
  const sql = read(MIG);

  for (const fn of TIER_A_MUST_NOT_GRANT) {
    test(`Tier-A/비-WL 미재부여: ${fn}`, () => {
      const re = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\b[^;]*TO anon;`);
      expect(sql).not.toMatch(re);
    });
  }
});

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — 롤백 (가역·멱등)', () => {
  const rb = read(ROLLBACK);

  test('롤백 = PUBLIC + anon 원상복원 (anon 119 회복)', () => {
    expect(rb).toMatch(/GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;/);
    expect(rb).toMatch(/GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;/);
    expect(rb).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s*\n\s*GRANT EXECUTE ON FUNCTIONS TO PUBLIC;/);
    expect(rb).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s*\n\s*GRANT EXECUTE ON FUNCTIONS TO anon;/);
  });

  test('롤백도 단일 tx', () => {
    expect((rb.match(/^BEGIN;/gm) ?? []).length).toBe(1);
    expect((rb.match(/^COMMIT;/gm) ?? []).length).toBe(1);
  });
});

test.describe('T-20260710-foot-SECDEF-ANON-REVOKE — DB-GATE 증거 아티팩트 (AC2·AC3)', () => {
  const doc = read(DBGATE);

  test('proacl 3자 대조: anon 119→14 + 비-anon 무손실 기재', () => {
    expect(doc).toContain('119');
    expect(doc).toContain('14');
    expect(doc).toMatch(/authenticated[\s\S]*?133[\s\S]*?133/);
    expect(doc).toMatch(/service_role[\s\S]*?135[\s\S]*?135/);
  });

  test('Tier-A anon 무호출 증거(pg_stat_statements) 기재', () => {
    expect(doc).toMatch(/pg_stat_statements/);
    expect(doc).toMatch(/0\s*건|0건|무호출|DENIED-42501/);
  });

  test('supervisor 상위권한(supabase_admin default-priv) 항목 기재', () => {
    expect(doc).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/);
  });
});
