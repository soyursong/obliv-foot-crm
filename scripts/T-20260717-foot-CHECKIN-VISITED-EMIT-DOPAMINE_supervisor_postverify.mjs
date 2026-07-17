/**
 * T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE — supervisor 사후검증 (READ-ONLY)
 * POSTCHECK 재대사 + AC-4 라이브 신호(outbox) 관찰. 무변경.
 * 실행: node scripts/T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE_supervisor_postverify.mjs
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
  // (1) event_type CHECK constraint 실측
  out.check_constraint = await q(`
    SELECT con.conname, pg_get_constraintdef(con.oid) def
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    WHERE c.relname='dopamine_callback_outbox' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%event_type%';`);

  // (2) enqueue_dopamine_visited_stage func 존재
  out.enqueue_func = await q(`
    SELECT p.proname, count(*) n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='enqueue_dopamine_visited_stage' GROUP BY 1;`);

  // (3) 트리거: 신규 stage 축 + 기존 base 축 무손상
  out.triggers = await q(`
    SELECT tgname, tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relname='check_ins' AND tgname IN ('trg_dopamine_cb_checkin_stage','trg_dopamine_cb_checkin') ORDER BY tgname;`);

  // (4) ledger
  out.ledger = await q(`SELECT version FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260718120000','20260718130000') ORDER BY version;`);

  // ── AC-4 신호: outbox visited_stage 행 관찰 (apply 이후) ──
  out.outbox_by_type = await q(`
    SELECT event_type, status, count(*) n
    FROM dopamine_callback_outbox
    WHERE created_at >= '2026-07-18 00:00:00+09'
    GROUP BY 1,2 ORDER BY 1,2;`);

  out.visited_stage_recent = await q(`
    SELECT id, event_type, event_id, status, attempts, created_at, sent_at, last_error
    FROM dopamine_callback_outbox
    WHERE event_type='visited_stage'
    ORDER BY created_at DESC LIMIT 10;`);

  // check_ins 최근 활동
  out.recent_checkins = await q(`
    SELECT count(*) total FROM check_ins WHERE created_at >= '2026-07-18 00:00:00+09';`);

  // 트리거 함수 본문에서 leak-guard 참조 컬럼(어느 테이블 경유인지) 확인
  out.enqueue_func_src = await q(`
    SELECT substring(pg_get_functiondef(p.oid) from 1 for 1200) src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='enqueue_dopamine_visited_stage';`);

  console.log(JSON.stringify(out,null,2));
}catch(e){ console.error('ERR', e.message); process.exit(1); }
