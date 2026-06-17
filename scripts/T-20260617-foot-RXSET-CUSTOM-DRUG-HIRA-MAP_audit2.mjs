/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — 검증 audit2 (READ-ONLY)
 * audit1 결과 "자동매칭 0 / 불가 19" 의외값 검증:
 *  (1) official 모집단 성격 — classification 분포 + 샘플 20건
 *  (2) 항진균 핵심 성분명(플루코나졸/에피나코나졸/테르비나핀/우레아/무피로신/세파클러 등) official ilike 직접 검색
 *  (3) custom 19종이 실제 노출되는 surface — drug_folder_items(DrugFolderTree) 참조 여부
 * *** SELECT only ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== audit2 검증 (READ-ONLY) ' + new Date().toISOString() + ' ===\n');

  const { data: official } = await sb.from('prescription_codes').select('id,name_ko,claim_code,classification,code_type,ingredient_code').eq('code_source', 'official');
  // (1) classification 분포
  const cd = {};
  for (const o of official) { const k = o.classification ?? '∅'; cd[k] = (cd[k] || 0) + 1; }
  console.log('[1] official classification 분포 (top15):');
  Object.entries(cd).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`    ${String(k).padEnd(24)}: ${v}`));
  console.log('\n[1b] code_type 분포:');
  const ct = {}; for (const o of official) { const k = o.code_type ?? '∅'; ct[k] = (ct[k] || 0) + 1; }
  Object.entries(ct).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${String(k).padEnd(16)}: ${v}`));
  console.log('\n[1c] official 샘플 15건:');
  official.slice(0, 15).forEach((o) => console.log(`    "${o.name_ko}" claim=${o.claim_code} cls=${o.classification ?? '-'} ingr=${o.ingredient_code ?? '-'}`));

  // (2) 핵심 성분명 직접 검색 (norm 매칭 누락 검증)
  const terms = ['플루코나졸', '에피나코나졸', '테르비나핀', '우레아', '무피로신', '세파클러', '세파클', '아목시실린', '클로베타솔', '프레드니솔론', '나프티핀', '암로핀', '시클로피록스', '이트라코나졸', '아목시실린'];
  console.log('\n[2] official 항진균/외용제 핵심 성분명 ilike 직접 검색:');
  for (const t of terms) {
    const hits = official.filter((o) => (o.name_ko || '').includes(t) || (o.ingredient_code || '').includes(t));
    console.log(`    "${t}" : ${hits.length}건` + (hits.length ? ' → ' + hits.slice(0, 3).map((h) => `"${h.name_ko}"(${h.claim_code})`).join(', ') : ''));
  }

  // (3) custom surface — drug_folder_items 참조
  console.log('\n[3] custom 19종 노출 surface 확인:');
  const { data: custom } = await sb.from('prescription_codes').select('id,name_ko').eq('code_source', 'custom');
  const customIds = new Set(custom.map((c) => `${c.id}`));
  // drug_folder_items 테이블 존재여부 + 참조
  const tablesToCheck = ['drug_folder_items'];
  for (const tbl of tablesToCheck) {
    try {
      const { data, error } = await sb.from(tbl).select('*').limit(2000);
      if (error) { console.log(`    ${tbl}: 조회실패(${error.message})`); continue; }
      const refCol = data.length ? Object.keys(data[0]).find((k) => k.includes('prescription_code')) : null;
      const refd = refCol ? data.filter((r) => customIds.has(`${r[refCol]}`)).length : 0;
      console.log(`    ${tbl}: rows=${data.length}, refCol=${refCol}, custom참조=${refd}건`);
    } catch (e) { console.log(`    ${tbl}: 예외(${e.message})`); }
  }
  // prescription_sets 재확인 (items JSON 안의 name 매칭으로도)
  const { data: sets } = await sb.from('prescription_sets').select('id,name,items,folder');
  const customNames = new Set(custom.map((c) => c.name_ko));
  let setNameHit = 0;
  for (const s of sets ?? []) {
    const items = Array.isArray(s.items) ? s.items : [];
    for (const it of items) if (customNames.has(it?.name)) setNameHit++;
  }
  console.log(`    prescription_sets items[].name 이 custom 약이름과 일치 = ${setNameHit}건 (id아닌 name기준)`);
  console.log('\n=== end ===');
}
main().catch((e) => { console.error(e); process.exit(1); });
