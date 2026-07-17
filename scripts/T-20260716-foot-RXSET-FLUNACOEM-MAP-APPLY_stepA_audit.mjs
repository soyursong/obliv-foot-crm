/**
 * T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY — Step A 대상 확정 (READ-ONLY, NO WRITE)
 *
 * 목적 (부모 T-20260617 §8 메커니즘 상속):
 *  1) prescription_codes 컬럼 인벤토리 — provenance 4컬럼(hira_verified_at/hira_match_basis/
 *     hira_mapped_to_code_id/hira_verified_by) 존재 여부(§8 판정2 ADDITIVE) + deprecation 표현 컬럼 탐색.
 *  2) 플루나코엠캡슐 custom row(code_source='custom', LEGACY-015b55130567) 1건 정확 식별.
 *  3) 목표 official = 플루코엠캡슐(플루코나졸)50mg / (주)마더스제약
 *     (표준 8806228052102 / 품목기준 201403310) 마스터 존재 여부 → Case1/Case2 분기.
 *  4) custom row 참조 지점: prescription_code_folders(폴더 배지 surface) + prescription_sets.items(묶음처방).
 *
 * *** SELECT 만. 어떤 write(DML/DDL) 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LEGACY = 'LEGACY-015b55130567';
const STD = '8806228052102';
const PRODCODE = '201403310';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY — Step A (READ-ONLY)');
  console.log('실행:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════\n');

  // [1] 컬럼 인벤토리
  const { data: sample, error: e0 } = await sb.from('prescription_codes').select('*').limit(1);
  if (e0) { console.error('LOAD ERR:', e0.message); process.exit(1); }
  const cols = sample.length ? Object.keys(sample[0]) : [];
  console.log('[1] prescription_codes 컬럼(' + cols.length + '):');
  console.log('    ' + cols.join(', '));
  const prov = ['hira_verified_at', 'hira_match_basis', 'hira_mapped_to_code_id', 'hira_verified_by'];
  console.log('    provenance 4컬럼 존재:');
  for (const c of prov) console.log(`      ${c.padEnd(24)} : ${cols.includes(c)}`);
  const depCandidates = cols.filter((c) => /deprecat|status|is_active|active|retired|archived|superseded|valid|enabled/i.test(c));
  console.log('    deprecation 후보 컬럼: ' + (depCandidates.join(', ') || '(없음 — code_source/참조제거로 표현)'));
  console.log('');

  // [2] custom row 식별 — LEGACY claim_code 우선, name_ko '플루나코엠' 보조
  const { data: byLegacy } = await sb.from('prescription_codes').select('*').eq('claim_code', LEGACY);
  const { data: byName } = await sb.from('prescription_codes').select('*').ilike('name_ko', '%플루나코엠%');
  console.log(`[2] custom 대상 식별`);
  console.log(`    claim_code=${LEGACY} → ${byLegacy?.length ?? 0}건`);
  for (const r of byLegacy ?? []) console.log('      ', JSON.stringify({ id: r.id, name_ko: r.name_ko, claim_code: r.claim_code, code_source: r.code_source, manufacturer: r.manufacturer, code_type: r.code_type, insurance_status: r.insurance_status }));
  console.log(`    name_ko ILIKE '%플루나코엠%' → ${byName?.length ?? 0}건`);
  for (const r of byName ?? []) console.log('      ', JSON.stringify({ id: r.id, name_ko: r.name_ko, claim_code: r.claim_code, code_source: r.code_source }));
  const custom = (byLegacy ?? [])[0] ?? (byName ?? []).find((r) => r.code_source === 'custom');
  console.log('');

  // [3] 목표 official 존재 여부 — 표준/품목/이름 3경로
  console.log('[3] 목표 official (플루코엠캡슐 50mg / 마더스제약) 마스터 존재 여부');
  const officialHits = new Map();
  for (const [label, q] of [
    ['claim_code=EDI/HIRA std', sb.from('prescription_codes').select('*').or(`claim_code.eq.HIRA-${PRODCODE},claim_code.eq.HIRA-STD-${STD}`)],
    ['name_ko ILIKE 플루코엠', sb.from('prescription_codes').select('*').ilike('name_ko', '%플루코엠%')],
    ['hira_match_basis std', cols.includes('hira_match_basis') ? sb.from('prescription_codes').select('*').ilike('hira_match_basis', `%${STD}%`) : null],
  ]) {
    if (!q) { console.log(`    [${label}] (컬럼 부재 skip)`); continue; }
    const { data, error } = await q;
    if (error) { console.log(`    [${label}] ERR ${error.message}`); continue; }
    console.log(`    [${label}] → ${data?.length ?? 0}건`);
    for (const r of data ?? []) {
      officialHits.set(r.id, r);
      console.log('      ', JSON.stringify({ id: r.id, name_ko: r.name_ko, claim_code: r.claim_code, code_source: r.code_source, manufacturer: r.manufacturer }));
    }
  }
  console.log('');

  // [4] 참조 지점
  console.log('[4] custom row 참조 지점');
  if (custom) {
    const { data: fol } = await sb.from('prescription_code_folders').select('*').eq('prescription_code_id', custom.id);
    console.log(`    prescription_code_folders(폴더 배지 surface) → ${fol?.length ?? 0}건`);
    for (const r of fol ?? []) console.log('      ', JSON.stringify(r));
    // 묶음처방 items 내 name_ko/ id 참조
    const { data: sets } = await sb.from('prescription_sets').select('id,name,folder,items');
    let hitSets = 0;
    for (const s of sets ?? []) {
      const items = Array.isArray(s.items) ? s.items : [];
      const hit = items.filter((it) => (it?.prescription_code_id === custom.id) || (typeof it?.name === 'string' && it.name.includes('플루나코엠')) || (typeof it?.name_ko === 'string' && it.name_ko.includes('플루나코엠')));
      if (hit.length) { hitSets++; console.log(`    prescription_sets[${s.id}] "${s.name}" folder=${s.folder} → item ${hit.length}건: ${JSON.stringify(hit)}`); }
    }
    console.log(`    prescription_sets 참조 세트 → ${hitSets}건`);
  } else {
    console.log('    ⚠ custom row 미식별 — 중단');
  }
  console.log('');

  // [5] Case 판정
  console.log('[5] Case 판정');
  const officialExists = officialHits.size > 0;
  console.log(`    official 마스터 존재? ${officialExists} → ${officialExists ? 'Case1(참조 재지정+custom deprecate)' : 'Case2(신규 official ADDITIVE+reference-move)'}`);
  console.log('\n─ Step A 완료 (READ-ONLY) ─');
}
main().catch((e) => { console.error(e); process.exit(1); });
