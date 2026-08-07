// T-20260806-foot-LASER-SLOT-FIXEDACTIVE — READ-ONLY census
// 목적: (1) laser room 슬롯 전수 (name/type/active) — L2/L6/L7/L12 이 laser 전부인지 subset인지
//       (2) daily_room_status 에서 L2/L6/L7/L12 현재 상태 (carry_over / is_active / date)
//       (3) A/B 확정 판단 근거
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
async function q(sql){
  const r = await fetch('https://api.supabase.com/v1/projects/rxlomoozakkjesdqjtvd/database/query',{method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

console.log('=== A. rooms census (전체 room_type 분포) ===');
console.log(JSON.stringify(await q(`SELECT room_type, count(*) n, count(*) FILTER (WHERE active) active_n FROM rooms GROUP BY room_type ORDER BY room_type`), null, 2));

console.log('\n=== B. laser rooms 전수 (name, active, sort_order, clinic) ===');
console.log(JSON.stringify(await q(`SELECT r.name, r.room_type, r.active, r.sort_order, c.name AS clinic FROM rooms r JOIN clinics c ON c.id=r.clinic_id WHERE r.room_type IN ('laser','heated_laser') ORDER BY c.name, r.sort_order`), null, 2));

console.log('\n=== C. daily_room_status 에서 L2/L6/L7/L12 현재 상태 ===');
console.log(JSON.stringify(await q(`SELECT room_name, is_active, carry_over, date, disabled_by FROM daily_room_status WHERE room_name IN ('L2','L6','L7','L12') ORDER BY room_name, date DESC`), null, 2));

console.log('\n=== D. carry_over=true 레코드 전수 (어느 방들이 carry-over inactive 상태인가) ===');
console.log(JSON.stringify(await q(`SELECT room_name, is_active, count(*) n, max(date) latest FROM daily_room_status WHERE carry_over=true GROUP BY room_name, is_active ORDER BY room_name`), null, 2));

console.log('\n=== E. room_name=L% (라벨 명명 확인) ===');
console.log(JSON.stringify(await q(`SELECT DISTINCT room_name FROM daily_room_status WHERE room_name LIKE 'L%' ORDER BY room_name`), null, 2));
