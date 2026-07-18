/**
 * T-20260718-foot-RXSET-OGMENTO-MAP-APPLY — Step A 대상 확정 (READ-ONLY, NO WRITE)
 *
 * sibling T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY 구조 상속.
 *
 * 목적 (부모 T-20260617 §8 메커니즘):
 *  1) prescription_codes provenance 4컬럼 존재 확인(旣배포, FLUNACOEM DDL 20260716140100).
 *  2) '오구멘토' custom row(code_source='custom', LEGACY-f859925fdba2) 정확히 1건 식별. 동명 복수면 abort.
 *  3) 목표 official = 오구멘토정375밀리그램(아목시실린·클라불란산칼륨) / 주식회사 더유제약
 *     (품목기준 201908078 / 표준 8800570003904, 심평원 master active·취소일자 공란) 존재 여부 → Case1/Case2 분기.
 *  4) custom row 참조 지점: prescription_code_folders(폴더 배지 surface) + prescription_sets.items(묶음처방).
 *
 * ★ 오구멘틴(Augmentin/글락소, 200209643 정375mg 2012-04-26 취소)과 혼동 금지 — 타깃은 오구멘토(더유제약, active).
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

const LEGACY = 'LEGACY-f859925fdba2';
const PRODCODE = '201908078';       // 품목기준코드 9자리 (오구멘토정375밀리그램, 더유제약, active)
const STD13 = '8800570003904';      // 대표코드/표준코드 13자리

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260718-foot-RXSET-OGMENTO-MAP-APPLY — Step A (READ-ONLY)');
  console.log('실행:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════\n');

  // [1] provenance 컬럼 인벤토리
  const { data: sample, error: e0 } = await sb.from('prescription_codes').select('*').limit(1);
  if (e0) { console.error('LOAD ERR:', e0.message); process.exit(1); }
  const cols = sample.length ? Object.keys(sample[0]) : [];
  const prov = ['hira_verified_at', 'hira_match_basis', 'hira_mapped_to_code_id', 'hira_verified_by'];
  console.log('[1] provenance 4컬럼 존재(FLUNACOEM DDL 20260716140100 旣배포):');
  for (const c of prov) console.log(`      ${c.padEnd(24)} : ${cols.includes(c)}`);
  console.log('');

  // [2] custom row 식별 — LEGACY claim_code 우선, name_ko '오구멘토' 보조. 동명 복수 abort 체크.
  const { data: byLegacy } = await sb.from('prescription_codes').select('*').eq('claim_code', LEGACY);
  const { data: byName } = await sb.from('prescription_codes').select('*').ilike('name_ko', '%오구멘토%');
  console.log(`[2] custom 대상 식별`);
  console.log(`    claim_code=${LEGACY} → ${byLegacy?.length ?? 0}건`);
  for (const r of byLegacy ?? []) console.log('      ', JSON.stringify({ id: r.id, name_ko: r.name_ko, claim_code: r.claim_code, code_source: r.code_source, code_type: r.code_type, classification: r.classification, manufacturer: r.manufacturer, insurance_status: r.insurance_status }));
  console.log(`    name_ko ILIKE '%오구멘토%' → ${byName?.length ?? 0}건`);
  for (const r of byName ?? []) console.log('      ', JSON.stringify({ id: r.id, name_ko: r.name_ko, claim_code: r.claim_code, code_source: r.code_source }));
  const customList = (byName ?? []).filter((r) => r.code_source === 'custom');
  const custom = (byLegacy ?? [])[0] ?? customList[0];
  console.log(`    ⚠ custom(code_source=custom) '오구멘토*' 건수 = ${customList.length} (기대=1, 초과 시 abort)`);
  console.log('');

  // [3] 목표 official 존재 여부 — 품목/표준/이름 3경로
  console.log('[3] 목표 official (오구멘토정375밀리그램 / 더유제약, 품목 201908078 / 표준 8800570003904) 마스터 존재 여부');
  const officialHits = new Map();
  for (const [label, q] of [
    ['claim_code=HIRA std', sb.from('prescription_codes').select('*').or(`claim_code.eq.HIRA-${PRODCODE},claim_code.eq.HIRA-STD-${STD13}`)],
    ['name_ko ILIKE 오구멘토정375', sb.from('prescription_codes').select('*').ilike('name_ko', '%오구멘토정375%')],
    ['hira_match_basis prodcode', cols.includes('hira_match_basis') ? sb.from('prescription_codes').select('*').ilike('hira_match_basis', `%${PRODCODE}%`) : null],
    ['hira_match_basis std13', cols.includes('hira_match_basis') ? sb.from('prescription_codes').select('*').ilike('hira_match_basis', `%${STD13}%`) : null],
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
    const { data: sets } = await sb.from('prescription_sets').select('id,name,folder,items');
    let hitSets = 0;
    for (const s of sets ?? []) {
      const items = Array.isArray(s.items) ? s.items : [];
      const hit = items.filter((it) => (it?.prescription_code_id === custom.id) || (typeof it?.name === 'string' && it.name.includes('오구멘토')) || (typeof it?.name_ko === 'string' && it.name_ko.includes('오구멘토')));
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
  console.log(`    custom 대상 = ${customList.length}건 (기대=1)`);
  console.log(`    official 마스터 존재? ${officialExists} → ${officialExists ? 'Case1(참조 재지정+custom deprecate)' : 'Case2(신규 official ADDITIVE+reference-move)'}`);
  console.log('\n─ Step A 완료 (READ-ONLY) ─');
}
main().catch((e) => { console.error(e); process.exit(1); });
