/**
 * T-20260713-foot-RESV-NAME-ALIAS-CONTAM — 앵커 케이스 검증 probe (READ-ONLY)
 * INFO MSG-20260713-112956-cpxo (planner): 박민지 TM팀장 제공 실사례로 AC-F4 폐쇄.
 * 앵커(저위험키): 별칭 alias="ok" / 예약일 2026-07-21. 본명·전화 원문 = 슬랙 조회(git 미저장).
 * 검증: (1) 이 예약 customer_name이 "ok"(별칭)로 오염돼 있는가 [AC-1 재현]
 *       (2) 연결 customer.name / customer_real_name 상태
 *       (3) 백필 freeze 후보(도파민연결 + 7/8 이후 갱신)에 포함되는가 [AC-4]
 * author: dev-foot / 2026-07-13 · DB 無변경(SELECT only)
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const mask = s => s==null ? null : (String(s).length<=1 ? '∙' : String(s)[0]+'○'.repeat(Math.max(1,String(s).length-1)));
const out={};
// 0) reservations schema sanity (date col + name cols)
out.resv_cols = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name IN ('reservation_date','customer_name','customer_real_name','customer_id','source_system','updated_at','created_at','visit_route') ORDER BY column_name;`);
// 1) anchor by low-risk keys: date 2026-07-21 + alias-ish name 'ok'
out.anchor_resv = await q(`
  SELECT id, customer_id, customer_name, customer_real_name, source_system, visit_route,
         reservation_date, created_at, updated_at
  FROM reservations
  WHERE reservation_date = DATE '2026-07-21'
  ORDER BY (lower(btrim(customer_name))='ok') DESC, updated_at DESC
  LIMIT 20;`);
// 2) any reservation named exactly 'ok' (alias signature) regardless of date
out.name_ok_all = await q(`
  SELECT id, customer_id, customer_name, reservation_date, source_system, updated_at
  FROM reservations
  WHERE lower(btrim(customer_name)) = 'ok'
  ORDER BY updated_at DESC LIMIT 20;`);
console.log(JSON.stringify({schema:out.resv_cols, anchor_by_date:out.anchor_resv, name_eq_ok:out.name_ok_all},null,2));
