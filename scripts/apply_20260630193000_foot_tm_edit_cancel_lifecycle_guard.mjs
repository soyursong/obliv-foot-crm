/**
 * T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL — lifecycle 가드#5 보강 적용 (Supabase Management API).
 * 190000 합본 body 위 가드#5(checked_in/done/no_show stale edit·cancel reject) 추가. 함수 body-only CREATE OR REPLACE.
 * 게이트: 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). supervisor DDL-diff(함수 body diff). dry-run green 선행.
 * rollback: supabase/migrations/20260630193000_foot_tm_edit_cancel_lifecycle_guard.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dir, '../supabase/migrations/20260630193000_foot_tm_edit_cancel_lifecycle_guard.sql'), 'utf8');
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

console.log('🚀 apply lifecycle 가드#5 — T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL');
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: SQL }) });
const body = await resp.json();
console.log('Status:', resp.status);
if (!resp.ok) { console.error('❌ 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
console.log('✅ 완료');
