#!/usr/bin/env node
/**
 * Phase A apply — 레거시 self_checkin_create(text,text,text) deprecate/REVOKE (소스차단 先).
 * supervisor GATE-GO (MSG-20260718-023728-bjpq): Phase A DDL-diff 게이트 통과.
 * 비파괴·가역·멱등. NON-dry-run: 실제 영속(BEGIN/COMMIT 유지).
 */
import { q } from './dryrun_lib.mjs';
import { readFileSync } from 'node:fs';

const SQL_PATH = 'supabase/migrations/20260716090000_selfcheckin_create_legacy_deprecate_sourceclose.sql';

const main = async () => {
  const sql = readFileSync(SQL_PATH, 'utf8');
  console.log(`[apply] ${SQL_PATH} → prod`);
  await q(sql);
  console.log('[apply] OK (REVOKE + COMMENT committed).');
};
main().catch(e => { console.error('APPLY FAIL:', e.message); process.exit(1); });
