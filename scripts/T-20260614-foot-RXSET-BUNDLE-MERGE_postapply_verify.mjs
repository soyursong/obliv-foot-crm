/**
 * T-20260614-foot-RXSET-BUNDLE-MERGE — APPLY 후 데이터 검증 (READ-ONLY, NO WRITE)
 * supervisor FIX-REQUEST(insufficient_verification) 대응 증빙.
 *   (1) folder='약' 단독약 세트 19건
 *   (2) 다종(items>1) 0건 → 묶음처방 탭 빈/잔존
 *   (3) set.name vs items[0].name — DRUGNAME-DISPLAY rider(약 이름 표시) 판정 데이터
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.from('prescription_sets')
  .select('id, name, items, folder, is_active, sort_order').order('id');
if (error) { console.error('ERR', error.message); process.exit(1); }
console.log('total=', data.length);
const drug = data.filter((s) => s.folder === '약');
const multi = data.filter((s) => Array.isArray(s.items) && s.items.length > 1);
console.log("folder='약' count=", drug.length, ' multi(items>1)=', multi.length);
const dist = {}; for (const s of data) { const k = s.folder ?? 'NULL'; dist[k] = (dist[k] || 0) + 1; }
console.log('folder distribution=', JSON.stringify(dist));
console.log('--- per-set: set.name vs items[0].name (issue#3) ---');
for (const s of data) {
  const it0 = Array.isArray(s.items) && s.items[0] ? s.items[0] : {};
  console.log(`id=${s.id} folder=${s.folder ?? 'NULL'} | set.name="${s.name}" | item0.name="${it0.name ?? ''}" route="${it0.route ?? ''}" dosage="${it0.dosage ?? ''}" len=${Array.isArray(s.items) ? s.items.length : 0}`);
}
