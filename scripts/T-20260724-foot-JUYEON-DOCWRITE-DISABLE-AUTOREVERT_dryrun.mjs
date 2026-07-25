#!/usr/bin/env node
/**
 * Dry-run (no-persistence) — T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS (A안: 8/1 자동원복 해제)
 * migration: supabase/migrations/20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql
 *
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md v1.0
 *   ① stripTxnControl(BEGIN/COMMIT) ② plpgsql exception-handler 롤백 ③ post-probe 부재 실증.
 *
 * post-probe (INV-3):
 *   (a) 신규 함수 foot_juyeon_tempgrant_revert 부재 → CREATE FN 무영속 실증.
 *   (b) tick 정의에 자동원복 브랜치(v_revert_at) 잔존 → CREATE OR REPLACE(hold 재정의) 무영속 실증.
 *   추가: 대상 role dry-run 전/후 동일(=변경 0) 관측.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, procAbsent, q } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = join(__dirname, '..', 'supabase', 'migrations',
  '20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql');
const TARGET = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';

const roleSql = `SELECT role FROM public.user_profiles WHERE id='${TARGET}';`;

const pre = await q(roleSql);
console.log(`[pre]  target role = ${pre?.[0]?.role ?? '(absent)'}`);

const res = await runDryrun({
  upPath: UP,
  exitProcess: false,
  assertAbsent: [
    procAbsent('foot_juyeon_tempgrant_revert'),
    { label: 'tick auto-revert branch unchanged (신규 hold-def 무영속)',
      sql: `SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='foot_juyeon_tempgrant_tick' AND prosrc LIKE '%v_revert_at%') AS absent;` },
  ],
  passNote: 'A안 자동원복 해제 마이그 — 무영속 dry-run',
});

const post = await q(roleSql);
console.log(`[post] target role = ${post?.[0]?.role ?? '(absent)'}`);
console.log(`[role no-persistence] pre==post ? ${pre?.[0]?.role === post?.[0]?.role ? 'YES ✓' : 'NO ✗'}`);

process.exit(res.pass ? 0 : (res.code || 1));
