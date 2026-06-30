/**
 * T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL — superset RPC 적용 (Supabase Management API).
 * 3-티켓 합본(a TM-EDIT-CANCEL ⊃ b MEMO-PUSH-DROP ⊃ c COMPANION-RESV-INSERT-FAIL) 단일 CREATE OR REPLACE.
 * 게이트: 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO). 선행: supervisor DDL-diff + dry-run green.
 * rollback: supabase/migrations/20260630190000_foot_tm_edit_cancel_superset_rpc.rollback.sql
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dir, '../supabase/migrations/20260630190000_foot_tm_edit_cancel_superset_rpc.sql'), 'utf8');
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

console.log('🚀 apply superset RPC — T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL');
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: SQL }) });
const body = await resp.json();
console.log('Status:', resp.status);
if (!resp.ok) { console.error('❌ 실패:', JSON.stringify(body, null, 2)); process.exit(1); }
console.log('✅ 완료');
