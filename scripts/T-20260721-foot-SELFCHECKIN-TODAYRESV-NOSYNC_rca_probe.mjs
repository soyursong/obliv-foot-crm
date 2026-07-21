/**
 * T-20260721-foot-SELFCHECKIN-TODAYRESV-NOSYNC — READ-ONLY RCA probe
 * 셀프접수 키오스크 fn_selfcheckin_today_reservations 전량 0행 원인 규명.
 * 가설 A(planner 1순위): INVOKER drift → anon customers lockdown(07-20 mig#3) → JOIN 붕괴.
 * 가설 B(planner 2순위 / dev-foot 유력): FE p_date 이중 TZ 변환 → 09시 이전 전일 날짜 전송 → date 미스매치 0행.
 * DEFINER 함수는 postgres 로 body 실행 → 본 API(postgres) 호출 결과 = anon 이 받는 행과 동일.
 * author: dev-foot / 2026-07-21 · READ-ONLY (SELECT/introspection only, mutation 0)
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
const out={};
// 1) 함수 메타: SECURITY DEFINER? owner? search_path? (INVOKER drift 규명)
out.fn_meta = await q(`
  SELECT p.proname, p.prosecdef AS is_definer, r.rolname AS owner, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';`);
// 2) anon EXECUTE grant 잔존?
out.anon_exec = await q(`
  SELECT has_function_privilege('anon','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE') AS anon_execute;`);
// 3) clinic 목록 (총괄테스트/종로 확인)
out.clinics = await q(`SELECT id, name, slug FROM clinics ORDER BY name;`);
// 4) confirmed 예약 날짜 분포 (최근)
out.resv_dates = await q(`
  SELECT clinic_id, reservation_date, count(*) n
  FROM reservations WHERE status='confirmed' AND reservation_date >= '2026-07-18'
  GROUP BY clinic_id, reservation_date ORDER BY reservation_date DESC, clinic_id;`);
// 5) 현재 서버시각 (UTC) + KST 환산
out.now = await q(`SELECT now() AS utc_now, (now() AT TIME ZONE 'Asia/Seoul') AS kst_now, current_date AS server_current_date;`);
console.log(JSON.stringify(out,null,2));
