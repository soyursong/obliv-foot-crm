/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — no-op 재대조 (READ-ONLY, NO WRITE)
 *
 * 목적 (§ frontmatter UNBLOCK 지시 a):
 *   총괄(김주연) 회신 "대조해서 서비스관리 등록 한거임" → 총괄이 서비스관리에서 직접
 *   등록/승격했을 수 있음. dev 첫 의무 = prod READ-ONLY 대조로 중복적용 방지.
 *   16종(오구멘토/대웅/플루나코엠 = 별도 스핀오프 티켓, 본 배치 제외)이
 *     (A) 여전히 code_source='custom' + LEGACY-* claim_code (미반영 → apply 후보), 또는
 *     (B) 이미 official 승격 or 매칭 official row 존재 (no-op / 중복위험)
 *   중 무엇인지 판별.
 *
 * *** SELECT 만. 어떤 write(DML/DDL) 도 하지 않는다. ***
 * 정본 매핑 = evidence/..._mapping_table_v3_hira.md §3.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// v3 §3 매핑표 — LEGACY claim_code → {name, 품목기준코드, 배치포함여부, 스핀오프}
const MAP = [
  { legacy: 'LEGACY-015b55130567', name: '플루나코엠캡슐(플루코나졸)', prod: null,        spinoff: 'FLUNACOEM(NONE)' },
  { legacy: 'LEGACY-12d7730e32e8', name: '대웅푸루나졸정150mg',        prod: '200600116', spinoff: 'DAEWOONG-DELETE' },
  { legacy: 'LEGACY-1bb57c2e4782', name: '바르토벤 외용액 4ml',        prod: '202401671', spinoff: null },
  { legacy: 'LEGACY-1edb55721d2f', name: '한미유리아크림 50g',         prod: '198501225', spinoff: null },
  { legacy: 'LEGACY-1f8b80f62fbb', name: '세파클리어',                 prod: '201908179', spinoff: null },
  { legacy: 'LEGACY-2a0c89797bce', name: '스티렌',                     prod: '200500248', spinoff: null },
  { legacy: 'LEGACY-2e28835bfc5f', name: '록소포펜',                   prod: '201802417', spinoff: null },
  { legacy: 'LEGACY-3e7ce9b8f6fb', name: '터미졸크림 15g',             prod: '201905864', spinoff: null },
  { legacy: 'LEGACY-45744395cb7a', name: '한미유리아크림 20g',         prod: '198501225', spinoff: null },
  { legacy: 'LEGACY-5d19d9727ef4', name: '바르토벤 외용액 8ml',        prod: '202401671', spinoff: null },
  { legacy: 'LEGACY-a7a1a9195c67', name: '베타베이트연고 15g',         prod: '198300730', spinoff: null },
  { legacy: 'LEGACY-a9078a1449c3', name: '하이트리크림 20g',           prod: '200404710', spinoff: null },
  { legacy: 'LEGACY-ba5c97dfb0b8', name: '에스로반연고 10g',           prod: '199902738', spinoff: null },
  { legacy: 'LEGACY-ce36618a71d0', name: '주블리아외용액 4ml',         prod: '201702389', spinoff: null },
  { legacy: 'LEGACY-d17507bd1967', name: '삼아리도멕스크림',           prod: '198600458', spinoff: null },
  { legacy: 'LEGACY-e11452cf9200', name: '주블리아외용액 8ml',         prod: '201702389', spinoff: null },
  { legacy: 'LEGACY-e98e0cb79ec6', name: '루마졸크림',                 prod: '201600380', spinoff: null },
  { legacy: 'LEGACY-f76313d45cc9', name: '닥터로반',                   prod: '201905373', spinoff: null },
  { legacy: 'LEGACY-f859925fdba2', name: '오구멘토',                   prod: '201907725', spinoff: 'OGMENTO' },
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260617 RXSET-CUSTOM-DRUG-HIRA-MAP — no-op 재대조 (READ-ONLY)');
  console.log('실행:', new Date().toISOString(), '| target: prod', env.VITE_SUPABASE_URL);
  console.log('═══════════════════════════════════════════════════════════\n');

  // [0] provenance 4컬럼 존재 확인
  const { data: sample, error: e0 } = await sb.from('prescription_codes').select('*').limit(1);
  if (e0) { console.error('LOAD ERR:', e0.message); process.exit(1); }
  const cols = sample.length ? Object.keys(sample[0]) : [];
  const prov = ['hira_verified_at', 'hira_match_basis', 'hira_mapped_to_code_id', 'hira_verified_by'];
  console.log('[0] provenance 4컬럼:', prov.map((c) => `${c}=${cols.includes(c)}`).join(' | '), '\n');

  // [1] 전체 code_source 분포
  const { data: allRows, error: e1 } = await sb.from('prescription_codes').select('code_source');
  if (e1) { console.error('COUNT ERR:', e1.message); process.exit(1); }
  const dist = {};
  for (const r of allRows) dist[r.code_source] = (dist[r.code_source] || 0) + 1;
  console.log('[1] code_source 분포:', JSON.stringify(dist), `(total ${allRows.length})\n`);

  // [2] 19종 LEGACY 현재 상태 + 매칭 official 존재 여부
  console.log('[2] 대상별 현재 prod 상태 (custom row + 매칭 official 후보)\n');
  const summary = { customStill: [], promotedOrMissing: [], officialCollision: [] };

  for (const m of MAP) {
    const { data: byLegacy } = await sb
      .from('prescription_codes')
      .select('id, name_ko, claim_code, code_source, code_type, classification, insurance_status, hira_verified_at, hira_mapped_to_code_id')
      .eq('claim_code', m.legacy);
    const cust = (byLegacy ?? [])[0];
    const tag = m.spinoff ? `  [스핀오프:${m.spinoff}]` : '';
    const inBatch = !m.spinoff;

    let officialHits = [];
    if (m.prod) {
      const { data: off } = await sb
        .from('prescription_codes')
        .select('id, name_ko, claim_code, code_source')
        .or(`claim_code.eq.HIRA-${m.prod},claim_code.eq.HIRA-STD-${m.prod}`);
      officialHits = off ?? [];
    }

    const custState = cust
      ? `custom_row: src=${cust.code_source} claim=${cust.claim_code} verified=${cust.hira_verified_at ?? 'NULL'} mapped=${cust.hira_mapped_to_code_id ?? 'NULL'}`
      : 'custom_row: ⚠ NOT FOUND (LEGACY 부재 — 삭제/교체됨?)';
    const offState = m.prod
      ? `official(HIRA-${m.prod}): ${officialHits.length}건 ${officialHits.map((o) => o.claim_code).join(',')}`
      : 'official: (NONE 대상, 매칭 없음)';

    console.log(`  ${m.name}${tag}`);
    console.log(`     ${custState}`);
    console.log(`     ${offState}`);

    if (inBatch) {
      if (!cust) summary.promotedOrMissing.push(m.name + ' (LEGACY 부재)');
      else if (cust.code_source === 'custom' && cust.claim_code?.startsWith('LEGACY-')) {
        if (officialHits.length > 0) summary.officialCollision.push(m.name);
        else summary.customStill.push(m.name);
      } else summary.promotedOrMissing.push(m.name + ` (src=${cust.code_source})`);
    }
    console.log('');
  }

  // [3] 결론
  console.log('═══════════════════════════════════════════════════════════');
  console.log('[3] 배치 16종(스핀오프 3종 제외) no-op 판정');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  · 여전히 custom+LEGACY (apply 후보) : ${summary.customStill.length}종`);
  summary.customStill.forEach((n) => console.log(`      - ${n}`));
  console.log(`  · 매칭 official 이미 존재 (중복위험) : ${summary.officialCollision.length}종`);
  summary.officialCollision.forEach((n) => console.log(`      - ${n}`));
  console.log(`  · 승격됨/LEGACY부재 (no-op)          : ${summary.promotedOrMissing.length}종`);
  summary.promotedOrMissing.forEach((n) => console.log(`      - ${n}`));
  console.log('');
  const verdict = summary.customStill.length === 0 && summary.officialCollision.length === 0
    ? 'NO-OP → 총괄 직접등록으로 반영완료 추정 → 종결 가능(planner 보고)'
    : `APPLY 후보 존재 (${summary.customStill.length}종) → 매핑표 갱신 + supervisor DML 게이트 진행`;
  console.log('  ▶ VERDICT:', verdict);
  console.log('═══════════════════════════════════════════════════════════');
}
main().catch((e) => { console.error(e); process.exit(1); });
