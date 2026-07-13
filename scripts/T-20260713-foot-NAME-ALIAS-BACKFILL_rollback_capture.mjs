/**
 * T-20260713-foot-NAME-ALIAS-BACKFILL — rollback capture (READ-ONLY)
 * apply 전 대상 customer 의 현재값(별칭 포함) 캡처 → rollback/T-...-name_alias_rollback.csv
 * apply 후 되돌릴 근거. 트리거 재캐스케이드 검증 포함용. UPDATE 없음.
 * 사용: node ... <id1> <id2> ...  (기본 = Tier-A ascii 3행)
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DEFAULT_IDS = [
  'ac65896b-ab76-49df-8992-582e51865abd',
  '5bcf3bd9-...', '151fc672-...', // full ids resolved at runtime from freeze json
];
const ids = process.argv.slice(2);
if (!ids.length) { console.error('usage: node rollback_capture.mjs <customer_uuid...>'); process.exit(1); }

const { data: cs, error } = await supabase.from('customers')
  .select('id, name, phone, updated_at').in('id', ids);
if (error) throw error;
const lines = ['customer_id,current_name_b64,phone_tail,captured_updated_at'];
for (const c of cs) {
  const tail = (''+(c.phone||'')).replace(/[^0-9]/g,'').slice(-4);
  const b64 = Buffer.from(c.name || '', 'utf8').toString('base64'); // PHI: name base64 (git-tracked 원문 회피)
  lines.push(`${c.id},${b64},${tail},${c.updated_at}`);
  console.log(`captured ${c.id.slice(0,8)} tail=${tail} name_len=${(c.name||'').length}`);
}
writeFileSync('rollback/T-20260713-foot-NAME-ALIAS-BACKFILL_capture.csv', lines.join('\n'));
console.log(`\n캡처 ${cs.length}행 → rollback/T-20260713-foot-NAME-ALIAS-BACKFILL_capture.csv (name=base64)`);
