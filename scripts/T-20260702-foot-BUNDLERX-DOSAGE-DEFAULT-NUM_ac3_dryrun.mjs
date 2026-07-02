/**
 * T-20260702-foot-BUNDLERX-DOSAGE-DEFAULT-NUM — AC3 DRY-RUN (read-only)
 *
 * 목적: prescription_sets.items(JSONB) 중 dosage="적정량"(글자) 이 든 세트/항목 건수 산출.
 *   본 스크립트는 조회만(데이터 무변경). 대량 정비 판단·본적용은 결과 확인 후 별도.
 *
 * 실행: node scripts/T-20260702-foot-BUNDLERX-DOSAGE-DEFAULT-NUM_ac3_dryrun.mjs
 *   (SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL 를 .env.local 에서 로드)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function loadEnv() {
  const env = {};
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });

console.log('✅ AC3 DRY-RUN (read-only)', new Date().toISOString(), '\n');

const { data, error } = await sb.from('prescription_sets').select('id, name, items, is_active');
if (error) { console.error('❌ 조회 실패:', error.message); process.exit(1); }

let setsWith = 0, itemsWith = 0;
const affectedSets = [];
for (const s of data ?? []) {
  const items = Array.isArray(s.items) ? s.items : [];
  const hits = items.filter((it) => it && typeof it.dosage === 'string' && it.dosage.trim() === '적정량');
  if (hits.length > 0) {
    setsWith++;
    itemsWith += hits.length;
    affectedSets.push({ id: s.id, name: s.name, is_active: s.is_active, hitCount: hits.length, drugs: hits.map((h) => h.name) });
  }
}

console.log(`총 prescription_sets: ${data?.length ?? 0}건`);
console.log(`dosage="적정량" 포함 세트: ${setsWith}건 / 항목: ${itemsWith}건\n`);
if (affectedSets.length) {
  console.log('── 영향 세트 목록 ──');
  for (const a of affectedSets) {
    console.log(`  set#${a.id} "${a.name}" active=${a.is_active} 적정량항목=${a.hitCount} [${a.drugs.join(', ')}]`);
  }
} else {
  console.log('→ 정비 대상 0건. AC3 데이터 touch 불요(FE 기본값 변경만으로 충족).');
}
process.exit(0);
