/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — audit3 성분명 추출 매핑표 (READ-ONLY)
 * custom 약이름 "상품명(성분명)" 의 괄호 안 성분명을 추출 → official name_ko/ingredient 와 매칭.
 * 결과: reporter(문지은 대표원장) 확인용 매핑표 (약이름 / 현 LEGACY코드 / HIRA후보 / 분류).
 * 분류: AUTO=후보1건 단일확정 / MANUAL=후보다수 / NONE=후보0(외부 HIRA 필요)
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

// 성분명 추출: 괄호 안 텍스트 + 알려진 상품명→성분 보조 사전(추정, reporter 확인 전제)
const BRAND_HINT = {
  '세파클리어': '세파클러', '록소포펜': '록소프로펜', '닥터로반': '무피로신',
  '오구멘토': '아목시실린', '루마졸크림': null, '하이트리크림': null, '스티렌': '애엽',
};
function extractIngredients(name) {
  const ings = [];
  const m = name.match(/\(([^)]+)\)/g);
  if (m) for (const g of m) {
    const inner = g.slice(1, -1);
    // 용량/제형 괄호 제외 (숫자/ml/g 포함 시 skip)
    if (!/\d|ml|mg|㎎|㎖/i.test(inner)) ings.push(inner);
  }
  // 염 접미어 제거해 코어 성분 도출
  return ings.map((s) => s.replace(/(염산염|염산|황산염|푸마르산염|발레로아세테이트|프로피오네이트|아세트산염|수화물)$/g, '').trim()).filter(Boolean);
}

async function main() {
  console.log('=== audit3 성분명 매핑표 (READ-ONLY) ' + new Date().toISOString() + ' ===\n');
  const { data: all } = await sb.from('prescription_codes').select('id,name_ko,claim_code,classification,ingredient_code,code_source');
  const custom = all.filter((r) => r.code_source === 'custom');
  const official = all.filter((r) => r.code_source === 'official');

  const rows = [];
  for (const c of custom) {
    let ings = extractIngredients(c.name_ko);
    if (ings.length === 0 && BRAND_HINT[c.name_ko] !== undefined) {
      if (BRAND_HINT[c.name_ko]) ings = [BRAND_HINT[c.name_ko]];
    }
    // official 중 성분명 포함 후보
    let cands = [];
    if (ings.length) {
      const seen = new Set();
      for (const ing of ings) {
        for (const o of official) {
          if ((o.name_ko || '').includes(ing) && !seen.has(o.id)) { seen.add(o.id); cands.push(o); }
        }
      }
    }
    const cls = cands.length === 0 ? 'NONE' : cands.length === 1 ? 'AUTO' : 'MANUAL';
    rows.push({ c, ings, cands, cls });
  }

  const order = { AUTO: 0, MANUAL: 1, NONE: 2 };
  rows.sort((a, b) => order[a.cls] - order[b.cls]);
  console.log('순번 | 분류 | custom약(현 LEGACY코드) | 추출성분 | HIRA후보(EDI코드)');
  console.log('─'.repeat(100));
  rows.forEach((r, i) => {
    console.log(`\n${i + 1}. [${r.cls}] "${r.c.name_ko}"`);
    console.log(`     현코드(claim)=${r.c.claim_code} / 추출성분=[${r.ings.join(', ') || '없음(상품명만)'}]`);
    if (r.cands.length === 0) console.log('     HIRA후보: 없음 → 내부 official 미수록(비급여신약/전문외용제 추정, 외부 HIRA 확인 필요)');
    else r.cands.slice(0, 6).forEach((o) => console.log(`     → "${o.name_ko}" EDI=${o.claim_code} cls=${o.classification ?? '-'}`));
  });

  const cnt = { AUTO: 0, MANUAL: 0, NONE: 0 };
  rows.forEach((r) => cnt[r.cls]++);
  console.log('\n═══ 요약 ═══');
  console.log(`  AUTO(후보1·단일확정후보) = ${cnt.AUTO}`);
  console.log(`  MANUAL(후보다수·수동선택) = ${cnt.MANUAL}`);
  console.log(`  NONE(후보0·외부HIRA필요) = ${cnt.NONE}`);
  console.log('  ⚠ AUTO 도 상품명 상이(custom상품명 ≠ official상품명) → 동일성분=동일약 보장 안 됨. reporter 확인 의무.');
  console.log('═══════════════════════════════════════════════════════════');
}
main().catch((e) => { console.error(e); process.exit(1); });
