/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — 배치 apply Step A 감사 (READ-ONLY, NO WRITE)
 *
 * §19 apply GO 16종(#3~#18) 대상. FLUNACOEM stepA 계승 + 배치/dedup 확장.
 * 검증 항목:
 *  1) provenance 4컬럼 존재(§8 판정2 旣 PROD) + code_source enum 현재값.
 *  2) 16 custom row 정확 식별(LEGACY claim_code + code_source=custom + name_ko). 기대 16/16.
 *  3) 각 custom 폴더 membership(prescription_code_folders) + prescription_sets.items 참조.
 *  4) 13 distinct 목표 official claim_code(HIRA-{품목}) UNIQUE 충돌(기대 0/13 = 전건 Case2).
 *     ★충돌 발견 시 해당 건 Case1(참조 재지정, 신규 official 미생성) 강등 필요 → 표기.
 *  5) dedup 3쌍 폴더 collision: 같은 official 로 수렴하는 2 custom 이 같은 folder_id 인지(중복 membership 위험) 검사.
 *  6) 전체 custom 총계(기대 19: 16 대상 + 대웅 + 플루나코엠 deprecated) + 무접촉 3종 확인.
 *
 * *** SELECT 만. 어떤 write(DML/DDL) 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OFFICIALS, CUSTOMS, CLAIM } from './T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_batch16_mapping.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const env = Object.fromEntries(
  readFileSync(join(REPO, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const officialByKey = Object.fromEntries(OFFICIALS.map((o) => [o.key, o]));

async function main() {
  out('# T-20260617 배치 apply Step A 감사 (READ-ONLY) — 16종 #3~#18');
  out(`- prod: rxlomoozakkjesdqjtvd | ${new Date().toISOString()}`);
  out('');

  // [1] 컬럼/enum
  const { data: sample } = await sb.from('prescription_codes').select('*').limit(1);
  const cols = sample?.length ? Object.keys(sample[0]) : [];
  const prov = ['hira_verified_at', 'hira_match_basis', 'hira_mapped_to_code_id', 'hira_verified_by'];
  const provOk = prov.every((c) => cols.includes(c));
  out(`[1] provenance 4컬럼 존재: ${provOk} (${prov.filter((c) => cols.includes(c)).length}/4)`);
  const { data: srcVals } = await sb.from('prescription_codes').select('code_source');
  const srcHist = {};
  for (const r of srcVals ?? []) srcHist[r.code_source] = (srcHist[r.code_source] ?? 0) + 1;
  out(`    code_source 분포: ${JSON.stringify(srcHist)}`);
  out('');

  // [2] 16 custom 식별
  out('[2] 16 custom row 식별 (LEGACY claim_code + code_source=custom)');
  const customRows = {};
  let idOk = 0;
  for (const c of CUSTOMS) {
    const { data } = await sb.from('prescription_codes').select('id,name_ko,claim_code,code_source').eq('claim_code', c.legacy);
    const row = (data ?? []).find((r) => r.code_source === 'custom');
    customRows[c.legacy] = row ?? null;
    if (row) idOk++;
    const nameMatch = row ? (row.name_ko === c.name_ko ? '이름일치' : `⚠이름상이(DB:'${row.name_ko}')`) : '❌미식별';
    out(`    #${c.n} ${c.legacy} → ${row ? row.id : 'NULL'} ${nameMatch}`);
  }
  out(`    → 식별 ${idOk}/16`);
  out('');

  // [3] 폴더 membership + prescription_sets 참조
  out('[3] custom 참조 지점 (folder + prescription_sets)');
  const folderByLegacy = {};
  for (const c of CUSTOMS) {
    const row = customRows[c.legacy];
    if (!row) { out(`    #${c.n} 미식별 skip`); continue; }
    const { data: fol } = await sb.from('prescription_code_folders').select('*').eq('prescription_code_id', row.id);
    folderByLegacy[c.legacy] = fol ?? [];
    out(`    #${c.n} folder membership ${fol?.length ?? 0}건: ${(fol ?? []).map((f) => `folder=${f.folder_id}`).join(', ')}`);
  }
  // prescription_sets items 참조 (id 또는 name 문자열)
  const { data: sets } = await sb.from('prescription_sets').select('id,name,folder,items');
  let setHits = 0;
  for (const s of sets ?? []) {
    const items = Array.isArray(s.items) ? s.items : [];
    for (const c of CUSTOMS) {
      const row = customRows[c.legacy];
      const hit = items.filter((it) =>
        (row && it?.prescription_code_id === row.id) ||
        (typeof it?.name === 'string' && it.name === c.name_ko) ||
        (typeof it?.name_ko === 'string' && it.name_ko === c.name_ko));
      if (hit.length) { setHits++; out(`    ⚠ prescription_sets[${s.id}] "${s.name}" → #${c.n} 참조 ${hit.length}건`); }
    }
  }
  out(`    prescription_sets 참조 총 ${setHits}건 (0 기대 — FLUNACOEM 선례 0)`);
  out('');

  // [4] 13 distinct 목표 official claim_code 충돌 → Case 분기
  out('[4] 목표 official claim_code(HIRA-{품목}) 충돌 검사 → Case 분기');
  const caseByKey = {};
  for (const o of OFFICIALS) {
    const claim = CLAIM(o);
    const { data: hit } = await sb.from('prescription_codes').select('id,name_ko,code_source').eq('claim_code', claim);
    const cnt = hit?.length ?? 0;
    caseByKey[o.key] = cnt === 0 ? 'Case2' : 'Case1';
    out(`    ${o.key} ${claim} → 충돌 ${cnt}건 ⇒ ${caseByKey[o.key]}${cnt ? ` (기존:${JSON.stringify(hit)})` : ''}`);
  }
  out('');

  // [5] dedup 폴더 collision
  out('[5] dedup 3쌍 폴더 collision 검사 (같은 official 로 수렴하는 custom 들이 같은 folder_id 인가)');
  const byOfficial = {};
  for (const c of CUSTOMS) (byOfficial[c.official] ??= []).push(c);
  for (const [key, cs] of Object.entries(byOfficial)) {
    if (cs.length < 2) continue;
    const folderSets = cs.map((c) => ({ n: c.n, folders: (folderByLegacy[c.legacy] ?? []).map((f) => f.folder_id) }));
    const allFolders = folderSets.flatMap((x) => x.folders);
    const dup = allFolders.length !== new Set(allFolders).size;
    out(`    ${key} ← ${cs.map((c) => '#' + c.n).join(',')} | 폴더: ${JSON.stringify(folderSets)} | 동일폴더중복=${dup ? '⚠YES(reference-move 시 중복 membership → 1건만 이동·나머지 삭제 필요)' : 'NO(각각 이동 안전)'}`);
  }
  out('');

  // [6] 전체 custom 총계 + 무접촉
  const { data: allCustom } = await sb.from('prescription_codes').select('id,name_ko,claim_code').eq('code_source', 'custom');
  const targetLegacies = new Set(CUSTOMS.map((c) => c.legacy));
  const untouched = (allCustom ?? []).filter((r) => !targetLegacies.has(r.claim_code));
  out(`[6] custom 총계 ${allCustom?.length ?? 0}건 (기대 19)`);
  out(`    무접촉 custom ${untouched.length}건: ${untouched.map((r) => `${r.name_ko}(${r.claim_code})`).join(' / ')}`);
  out('');

  // 게이트 요약
  const case2Cnt = Object.values(caseByKey).filter((v) => v === 'Case2').length;
  const gatePass = provOk && idOk === 16 && setHits === 0;
  out('## Step A 게이트 요약');
  out('```');
  out(JSON.stringify({
    provenance_cols: provOk, custom_identified: `${idOk}/16`, prescription_sets_refs: setHits,
    officials_distinct: OFFICIALS.length, Case2: case2Cnt, Case1: OFFICIALS.length - case2Cnt,
    total_custom: allCustom?.length ?? 0, untouched_custom: untouched.length,
  }, null, 0));
  out('```');
  out(`판정: ${gatePass ? '✅ 배치 apply 스펙 확정 가능 (dry-run/migration 작성 GO)' : '❌ 불일치 — migration 작성 전 조사 필요'}`);

  const snapshot = {
    ticket: 'T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP (batch16)',
    captured_at: new Date().toISOString(),
    custom_rows: customRows,
    folders: folderByLegacy,
    case_by_official: caseByKey,
    prescription_sets_refs: setHits,
    total_custom: allCustom?.length ?? 0,
    untouched_custom: untouched.map((r) => ({ name_ko: r.name_ko, claim_code: r.claim_code })),
    gate_pass: gatePass,
  };
  const dir = join(REPO, 'db-gate');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-20260617-batch16_stepA_snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
  writeFileSync(join(dir, 'T-20260617-batch16_stepA_evidence.md'), log.join('\n') + '\n');
  console.log('\n📄 snapshot → db-gate/T-20260617-batch16_stepA_snapshot.json');
  process.exit(gatePass ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
