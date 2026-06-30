/** 사후 검증: source_system 컬럼·partial unique·RPC body 결선 확인 (supervisor DDL-diff 5항 대응) */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }) });
  const b = await r.json(); if (!r.ok) { console.error(JSON.stringify(b)); process.exit(1); } return b;
}
// (a) 컬럼
console.log('(a) source_system 컬럼:', JSON.stringify(await q(
  `SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_name='reservation_memo_history' AND column_name='source_system';`)));
// (b) partial unique index
console.log('(b) uq_rmh_resv_source:', JSON.stringify(await q(
  `SELECT indexname, indexdef FROM pg_indexes WHERE indexname='uq_rmh_resv_source';`)));
// (c)+(d) RPC body 결선
const def = (await q(
  `SELECT pg_get_functiondef('public.upsert_reservation_from_source(text,text,text,text,text,date,time,text,text,text,text,uuid,uuid,text,text,text,boolean)'::regprocedure) AS d;`))[0].d;
console.log('(c) reservations.memo COALESCE(EXCLUDED.memo) 제거:', !/memo\s*=\s*COALESCE\(EXCLUDED\.memo/.test(def));
console.log('(c) reservation_memo_history INSERT 존재:', /reservation_memo_history/.test(def));
console.log('(d) clinic_id=v_clinic_id 결선(v_reservation_id, v_clinic_id, v_memo_clean):', /v_reservation_id,\s*v_clinic_id,\s*v_memo_clean/.test(def));
console.log('(d) ON CONFLICT (reservation_id, source_system):', /ON CONFLICT \(reservation_id, source_system\)/.test(def));
