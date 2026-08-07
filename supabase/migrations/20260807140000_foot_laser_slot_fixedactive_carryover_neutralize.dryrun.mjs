// DRY-RUN: T-20260806-foot-LASER-SLOT-FIXEDACTIVE (no-persistence)
// Migration Dry-Run No-Persistence Protocol 준수:
//   DO 블록 안에서 UPDATE → row_count 확인 → RAISE EXCEPTION 으로 강제 롤백(무영속).
//   이후 post-probe 로 prod 실재가 변하지 않았음을 확인.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
async function q(sql){const r=await fetch('https://api.supabase.com/v1/projects/rxlomoozakkjesdqjtvd/database/query',{method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});return{status:r.status,body:await r.text()};}

console.log('=== PRE: carry_over=true & inactive count (기대 6) ===');
console.log((await q(`SELECT count(*) n FROM daily_room_status WHERE room_name IN ('L2','L6','L7','L12') AND carry_over=true AND is_active=false`)).body);

console.log('\n=== DRY-RUN: UPDATE then forced rollback via exception ===');
const dry = await q(`DO $$
DECLARE n integer;
BEGIN
  UPDATE daily_room_status SET carry_over=false
   WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
     AND room_name IN ('L2','L6','L7','L12') AND carry_over=true AND is_active=false;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE EXCEPTION 'DRYRUN_OK rows_affected=%', n;   -- 강제 롤백 (무영속)
END $$;`);
console.log('status', dry.status, '=>', dry.body, '(expect error containing DRYRUN_OK rows_affected=6)');

console.log('\n=== POST-PROBE: 무영속 확인 (여전히 6이어야 함) ===');
console.log((await q(`SELECT count(*) n FROM daily_room_status WHERE room_name IN ('L2','L6','L7','L12') AND carry_over=true AND is_active=false`)).body);
