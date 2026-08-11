/**
 * T-20260725-foot-HOLIDAY-INITFEE-ITEM-DEACTIVATE — APPLY
 * 수동 '공휴일 초진진찰료-의원'(24,490, base 18,840×1.3 가산 baked) active=false 폐기.
 * 하드 가드:
 *   - 대상 = 가산 baked 단가(24,490) 수동 항목 1건(id=3eb86239)만.
 *   - 정규 '초진진찰료-의원'(급여 covered, hira_score, base 18,840, id=de611ed5)은 절대 미변경.
 *   - DDL 없음. services 레코드 UPDATE(active=false)만. 되돌릴 수 있는 config 변경.
 *
 * 실행: node scripts/T-20260725-foot-HOLIDAY-INITFEE-ITEM-DEACTIVATE_apply.mjs        (dry-run: 대상만 표시)
 *       node scripts/T-20260725-foot-HOLIDAY-INITFEE-ITEM-DEACTIVATE_apply.mjs --apply (실제 UPDATE)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(__dirname,'..','.env.local'),'utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const APPLY = process.argv.includes('--apply');

const TARGET_ID = '3eb86239-af92-468c-afd3-94daa28acad6'; // 공휴일 초진진찰료-의원 (ACTIVE, 24,490)
const KEEP_ID   = 'de611ed5-154a-475d-9eb3-19d6d3bad881'; // 초진진찰료-의원 (급여, hira_score, 18,840) — 미변경
const money = (n) => (n == null ? n : Number(n).toLocaleString());

// 1) 폐기 대상 pre-check
const { data: tgt, error: e1 } = await sb.from('services')
  .select('id, name, price, active, is_insurance_covered, hira_score')
  .eq('id', TARGET_ID).maybeSingle();
if (e1) { console.error('TARGET QUERY ERROR', e1); process.exit(1); }
if (!tgt) { console.error('ABORT: 대상 id 미존재', TARGET_ID); process.exit(1); }
// 방어: 정확히 수동 가산 baked 항목인지 재검증
if (tgt.name !== '공휴일 초진진찰료-의원' || Number(tgt.price) !== 24490 || tgt.is_insurance_covered !== false || tgt.hira_score != null) {
  console.error('ABORT: 대상 항목 지문 불일치(name/price/covered/hira_score)', tgt); process.exit(1);
}
console.log('폐기 대상:', `id=${tgt.id} name="${tgt.name}" price=${money(tgt.price)} active=${tgt.active}`);

// 2) 유지 대상 pre-check (건드리지 않음 — 스냅샷만)
const { data: keep, error: e2 } = await sb.from('services')
  .select('id, name, price, active, is_insurance_covered, hira_score').eq('id', KEEP_ID).maybeSingle();
if (e2 || !keep) { console.error('ABORT: 유지 대상(정규 진찰료) 조회 실패', e2); process.exit(1); }
console.log('유지 대상(불변):', `id=${keep.id} name="${keep.name}" price=${money(keep.price)} active=${keep.active} covered=${keep.is_insurance_covered} hira_score=${keep.hira_score}`);

// 3) 격리 스냅샷: active 항목 총수 (before)
const { count: activeBefore } = await sb.from('services').select('id', { count: 'exact', head: true }).eq('clinic_id', tgt_clinic()).eq('active', true);
function tgt_clinic(){ return '74967aea-a60b-4da3-a0e7-9c997a930bc8'; }
console.log('격리: clinic active services (before) =', activeBefore);

if (!APPLY) {
  if (tgt.active === false) console.log('\n[dry-run] 대상이 이미 inactive — 변경 불필요.');
  else console.log('\n[dry-run] --apply 없이 실행됨. 위 대상 1건을 active=false 로 폐기 예정. 실제 적용하려면 --apply.');
  process.exit(0);
}

// 4) APPLY — 방어적 WHERE (id + name + price + active=true) → 정확히 1건
const { data: upd, error: e3 } = await sb.from('services')
  .update({ active: false })
  .eq('id', TARGET_ID).eq('name', '공휴일 초진진찰료-의원').eq('price', 24490).eq('active', true)
  .select('id, name, price, active');
if (e3) { console.error('UPDATE ERROR', e3); process.exit(1); }
console.log(`\nUPDATE rows affected = ${upd.length}`);
if (upd.length !== 1) { console.error(`ABORT-VERIFY: 예상 1건, 실제 ${upd.length}건. 롤백 검토 필요.`); process.exit(1); }
console.log('폐기 완료:', `id=${upd[0].id} name="${upd[0].name}" active=${upd[0].active}`);

// 5) POST-VERIFY: 유지 대상 불변 + active 총수 -1
const { data: keepAfter } = await sb.from('services').select('id, active, is_insurance_covered, hira_score, price').eq('id', KEEP_ID).maybeSingle();
const { count: activeAfter } = await sb.from('services').select('id', { count: 'exact', head: true }).eq('clinic_id', tgt_clinic()).eq('active', true);
console.log('POST: 유지 대상:', `active=${keepAfter.active} covered=${keepAfter.is_insurance_covered} hira_score=${keepAfter.hira_score} price=${money(keepAfter.price)}`);
console.log('POST: clinic active services (after) =', activeAfter, `(delta=${activeAfter - activeBefore})`);
const ok = keepAfter.active === true && keepAfter.is_insurance_covered === true && Number(keepAfter.price) === 18840 && (activeAfter - activeBefore) === -1;
console.log(ok ? '\n✅ POST-VERIFY PASS (유지 대상 불변 + active 총수 -1)' : '\n❌ POST-VERIFY FAIL — 롤백 검토');
process.exit(ok ? 0 : 1);
