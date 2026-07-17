/**
 * T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE — supervisor AC-4 foot-leg dry-fire (NO-PERSISTENCE)
 * BEGIN; 합성 check_in INSERT(도파민 연동 reservation) → 트리거 발화 → outbox visited_stage 캡처; ROLLBACK;
 * 무영속: 실 check_in/outbox 무생성. post-probe 로 잔존 0 확증.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim().replace(/^["']|["']$/g,'');
const REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('no token');process.exit(1);}
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
  const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const out={};
try{
  // (0) check_ins 필수 컬럼 파악(NOT NULL, default 없는 것)
  out.checkin_required_cols = await q(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='check_ins'
      AND is_nullable='NO' AND column_default IS NULL
    ORDER BY ordinal_position;`);

  // (1) 도파민 연동 reservation 후보 (source_system=dopamine + external_id not null) — 최근
  out.candidate = await q(`
    SELECT r.id, r.source_system, r.external_id, r.customer_id, r.clinic_id, r.reservation_date
    FROM reservations r
    WHERE r.source_system='dopamine' AND r.external_id IS NOT NULL
    ORDER BY r.created_at DESC LIMIT 1;`);

  // (baseline) outbox/checkin 총건수
  const b = await q(`SELECT
    (SELECT count(*) FROM dopamine_callback_outbox) ob,
    (SELECT count(*) FROM check_ins) ci;`);
  out.baseline = b[0];

  console.log(JSON.stringify(out,null,2));
}catch(e){ console.error('ERR', e.message); process.exit(1); }
