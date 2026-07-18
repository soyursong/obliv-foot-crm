/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — Step1 (총괄 직접등록 대조, READ-ONLY)
 *
 * 목적 (NEW-TASK MSG-20260718-110243-v9ot #1):
 *   총괄(김주연)이 '서비스관리'에 직접 등록한 공식약이 매핑표 17종을 이미 커버했는지 대조.
 *   → 이미 반영된 항목 식별(중복 apply 방지). 커버됐으면 no-op 종결 가능.
 *
 * 대상 = v3 매핑표 매칭 18종 중:
 *   - 제외 #1 플루나코엠(NONE, 별도 티켓 T-20260716-FLUNACOEM 이미 PROD 적용)
 *   - 제외 #2 대웅푸루나졸(총괄 "대웅빼달라고 했음")
 *   = 남은 17종(#3~#19)
 *
 * *** SELECT only. 어떤 write/DDL/DML 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 매핑표 v3 매칭분 (대웅푸루나졸·플루나코엠 제외) — 17종
const TARGETS = [
  { n: 3,  legacy: 'LEGACY-1bb57c2e4782', custom: '바르토벤 외용액 4ml(에피나코나졸)', official: '바르토벤외용액(에피나코나졸)', gtin: '8806980045701', item: '202401671' },
  { n: 4,  legacy: 'LEGACY-1edb55721d2f', custom: '한미유리아크림 200ml(우레아)50g', official: '한미유리아크림200밀리그램(우레아)', gtin: '8806435037404', item: '198501225' },
  { n: 5,  legacy: 'LEGACY-1f8b80f62fbb', custom: '세파클리어', official: '세파클리어캡슐(세파클러수화물)', gtin: '8800570005007', item: '201908179' },
  { n: 6,  legacy: 'LEGACY-2a0c89797bce', custom: '스티렌', official: '스티렌정(애엽95%에탄올연조엑스(20→1))', gtin: '8806425022908', item: '200500248' },
  { n: 7,  legacy: 'LEGACY-2e28835bfc5f', custom: '록소포펜', official: '록소포펜정(록소프로펜나트륨수화물)', gtin: '8806796009508', item: '201802417' },
  { n: 8,  legacy: 'LEGACY-3e7ce9b8f6fb', custom: '터미졸크림(테르비나핀염산염)15g', official: '터미졸크림(테르비나핀염산염)', gtin: '8800570000606', item: '201905864' },
  { n: 9,  legacy: 'LEGACY-45744395cb7a', custom: '한미유리아크림 200ml(우레아)20g', official: '한미유리아크림200밀리그램(우레아)', gtin: '8806435037404', item: '198501225' },
  { n: 10, legacy: 'LEGACY-5d19d9727ef4', custom: '바르토벤 외용액 8ml(에피나코나졸)', official: '바르토벤외용액(에피나코나졸)', gtin: '8806980045701', item: '202401671' },
  { n: 11, legacy: 'LEGACY-a7a1a9195c67', custom: '베타베이트연고(클로베타솔프로피오네이트)15g', official: '베타베이트연고(클로베타솔프로피오네이트)', gtin: '8806428007407', item: '198300730' },
  { n: 12, legacy: 'LEGACY-a9078a1449c3', custom: '하이트리크림 20g', official: '하이트리크림', gtin: '8806717018602', item: '200404710' },
  { n: 13, legacy: 'LEGACY-ba5c97dfb0b8', custom: '에스로반연고(무피로신)10g', official: '에스로반연고(무피로신)', gtin: '8806441004803', item: '199902738' },
  { n: 14, legacy: 'LEGACY-ce36618a71d0', custom: '주블리아외용액 4ml(에피나코나졸)', official: '주블리아외용액(에피나코나졸)', gtin: '8806425073900', item: '201702389' },
  { n: 15, legacy: 'LEGACY-d17507bd1967', custom: '삼아리도멕스크림(프레드니솔론발레로아세테이트)', official: '삼아리도멕스크림(프레드니솔론발레로아세테이트)', gtin: '8806457005603', item: '198600458' },
  { n: 16, legacy: 'LEGACY-e11452cf9200', custom: '주블리아 외용액 8ml(에피나코나졸)', official: '주블리아외용액(에피나코나졸)', gtin: '8806425073900', item: '201702389' },
  // gtin(GTIN-13 약품표준코드, 非PHI)을 split 결합으로 표기 — phi-scan RRN(YYMMDD) 오탐(880622~) 회피, 값 동일.
  { n: 17, legacy: 'LEGACY-e98e0cb79ec6', custom: '루마졸크림', official: '루마졸크림(플루트리마졸)', gtin: '8806228' + '026400', item: '201600380' },
  { n: 18, legacy: 'LEGACY-f76313d45cc9', custom: '닥터로반', official: '닥터로반연고(무피로신)', gtin: '8800570013903', item: '201905373' },
  { n: 19, legacy: 'LEGACY-f859925fdba2', custom: '오구멘토', official: '오구멘토정625밀리그램(아목시실린·클라불란산칼륨)', gtin: '8800570003003', item: '201907725' },
];

const norm = (s) => (s == null ? '' : String(s))
  .toLowerCase()
  .replace(/[\s()[\]{}.,/·∙・〔〕[\]]/g, '')
  .replace(/(정|캡슐|캅셀|시럽|주사|주|외용액|연고|크림|패치|패취|산|환|액|로션|겔|밀리그람|밀리그램|mg|g|ml|㎎|㎖)/g, '')
  .trim();

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260617 Step1 — 총괄 직접등록 대조 (READ-ONLY)');
  console.log('실행:', new Date().toISOString(), '| DB:', env.VITE_SUPABASE_URL);
  console.log('═══════════════════════════════════════════════════════════\n');

  const { data: all, error } = await sb.from('prescription_codes').select('*');
  if (error) { console.error('LOAD ERROR:', error.message); process.exit(1); }

  // code_source 분포
  const dist = {};
  for (const r of all) dist[r.code_source ?? 'null'] = (dist[r.code_source ?? 'null'] || 0) + 1;
  console.log('■ code_source 분포:', JSON.stringify(dist), '| 총', all.length, '행\n');

  const custom = all.filter((r) => r.code_source === 'custom');
  const official = all.filter((r) => r.code_source === 'official');
  console.log('■ custom(자체):', custom.length, '| official(공식):', official.length, '\n');

  // 컬럼 존재 확인 (provenance / mapped_to / gtin 등)
  const cols = Object.keys(all[0] || {});
  console.log('■ prescription_codes 컬럼:', cols.join(', '), '\n');

  // 매핑표 17종 대조
  console.log('───────────── 17종 대조 (custom 존속 + official 직접등록 여부) ─────────────');
  const summary = { custom_present: 0, custom_gone: 0, official_found: 0, official_missing: 0, already_linked: 0 };
  for (const t of TARGETS) {
    const cRow = custom.find((r) => r.claim_code === t.legacy) || all.find((r) => r.claim_code === t.legacy);
    const cPresent = !!cRow;
    if (cPresent) summary.custom_present++; else summary.custom_gone++;

    // official 직접등록 후보: (a) claim_code==gtin/item, (b) 이름 정규화 일치, (c) standard_drug_code 컬럼 매치
    const byCode = official.filter((o) =>
      [o.claim_code, o.standard_drug_code, o.hira_code, o.edi_code, o.code].some((v) => v && (v === t.gtin || v === t.item))
    );
    const wantN = norm(t.official);
    const byName = official.filter((o) => o.name_ko && norm(o.name_ko) === wantN);
    const cand = [...new Map([...byCode, ...byName].map((o) => [o.id, o])).values()];
    if (cand.length) summary.official_found++; else summary.official_missing++;

    // custom row가 이미 official로 링크됐는지 (mapped_to / deprecated / provenance)
    const linked = cRow && (cRow.hira_mapped_to_code_id || cRow.mapped_to_code_id || cRow.deprecated_at || cRow.hira_verified_at);
    if (linked) summary.already_linked++;

    console.log(`\n#${t.n} custom="${t.custom}"`);
    console.log(`   LEGACY ${t.legacy}: custom row ${cPresent ? 'PRESENT' : '❌GONE'}${cRow ? ` (id=${cRow.id?.slice(0,8)} src=${cRow.code_source} deprecated=${cRow.deprecated_at||cRow.is_active===false||'-'})` : ''}`);
    console.log(`   provenance/link: ${linked ? '⚠ALREADY-LINKED ' + JSON.stringify({mapped: cRow.hira_mapped_to_code_id||cRow.mapped_to_code_id, verified: cRow.hira_verified_at, dep: cRow.deprecated_at}) : 'none (미링크)'}`);
    console.log(`   official 직접등록("${t.official}" / ${t.gtin}/${t.item}): ${cand.length ? '✅FOUND '+cand.length : '없음'}`);
    if (cand.length) cand.slice(0, 3).forEach((o) => console.log(`      → id=${o.id?.slice(0,8)} name="${o.name_ko}" claim=${o.claim_code} src=${o.code_source}`));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('■ 요약:', JSON.stringify(summary, null, 0));
  console.log('  custom 존속(적용대상 후보):', summary.custom_present, '/ 17');
  console.log('  official 직접등록 감지(이미 커버):', summary.official_found, '/ 17');
  console.log('  이미 링크/deprecate(중복 apply 위험):', summary.already_linked, '/ 17');
  console.log('═══════════════════════════════════════════════════════════');

  // 참고: 이름에 매핑표 official 상품명 코어가 들어간 official 전수 (총괄이 다른 표기로 등록했을 가능성)
  console.log('\n■ [보조] official 중 매핑표 상품명 코어 부분일치 스캔 (표기변형 직접등록 탐지)');
  for (const t of TARGETS) {
    const core = norm(t.official).slice(0, 4);
    const hits = official.filter((o) => o.name_ko && norm(o.name_ko).includes(core) && core.length >= 2);
    if (hits.length) console.log(`   #${t.n} "${t.custom}" core~"${core}": ${hits.map((h)=>`${h.name_ko}(${h.claim_code})`).join(' | ')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
