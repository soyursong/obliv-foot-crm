/**
 * T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE — Step1 READ-ONLY 조사
 *
 * 목적:
 *   1) 서비스관리 약품 마스터(prescription_codes)에서 약명='대웅푸루나졸'(동명·규격 상이 전건) 조회 → 대상 id 셋 freeze.
 *   2) 각 대상 row 참조 존재 여부 검사 (파괴적 hard-DELETE 안전성 판정용):
 *        - prescription_code_folders        (약품폴더 배정 = 서비스관리 목록 노출 surface, FK ON DELETE CASCADE)
 *        - prescription_contraindications    (약품 금기증 = 의료안전, FK ON DELETE CASCADE)
 *        - prescription_sets.items[]         (묶음처방 템플릿, JSONB 무FK 스냅샷)
 *        - medical_charts.prescription_items[] (실 처방 이력 = 환자 차트, JSONB 무FK 스냅샷)
 *   ※ service_charges 는 service_id(services) 참조 — 약(prescription_code_id) 직접 참조 없음 → 대상 제외(스키마 확인).
 *
 *   부모 T-20260617 대조: code_source='custom' 이며 '매핑 제외'(미접촉)로 남아있는지 함께 확인.
 *
 * SELECT ONLY. UPDATE/DELETE 절대 없음. 결과 스냅샷을 db-gate/*_step1_freeze.json 에 기록.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

// ── env 로드 (.env.local) ──
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.local)'); process.exit(1); }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const stamp = new Date().toISOString();
console.log(`[Step1 READ-ONLY] ${stamp}  DB=${URL_}`);
console.log('='.repeat(70));

// ── 1) 약명 매칭 조회 (broad → 규격 상이 동명 전건 포착) ──
//    '대웅푸루나졸' 정확 + 부분(푸루나졸/대웅) 후보를 함께 노출해 오누락/오포함 human 판정 근거 남김.
const NAME_EXACT = '대웅푸루나졸';
const { data: byName, error: e1 } = await sb
  .from('prescription_codes')
  .select('id,name_ko,claim_code,code_type,classification,manufacturer,code_source,insurance_status,hira_verified_at,hira_match_basis,service_id,created_at')
  .or('name_ko.ilike.%푸루나졸%,name_ko.ilike.%대웅%')
  .order('name_ko', { ascending: true });
if (e1) { console.error('조회 실패:', e1.message); process.exit(1); }

console.log(`\n[약명 후보 조회] '푸루나졸' 또는 '대웅' 포함 = ${byName.length}건`);
for (const r of byName) {
  const exact = r.name_ko === NAME_EXACT ? '  ★EXACT' : '';
  console.log(`  ${r.name_ko}  | claim=${r.claim_code} | src=${r.code_source} | cls=${r.classification} | mfr=${r.manufacturer ?? '-'} | ins=${r.insurance_status ?? '-'}${exact}`);
  console.log(`      id=${r.id}`);
}

// freeze 셋 = 약명이 '대웅푸루나졸'로 시작(prefix)하는 전건.
//   근거: 실제 마스터엔 '대웅푸루나졸정150mg(플루코나졸)'처럼 규격 접미가 붙음. 총괄 '동명(규격 다수) 전건' = prefix 매칭.
const targets = byName.filter(r => (r.name_ko || '').startsWith(NAME_EXACT));
const ids = targets.map(r => r.id);
console.log(`\n[freeze 대상] name_ko LIKE '${NAME_EXACT}%'(prefix) = ${targets.length}건`);
targets.forEach(r => console.log(`  - ${r.id}  claim=${r.claim_code}  src=${r.code_source}  cls=${r.classification}`));

if (ids.length === 0) {
  console.log('\n⚠ 정확일치 0건 — 약명 표기 차이 가능. 위 후보 목록으로 human 판정 필요. 참조검사 skip.');
  writeFileSync(new URL('../db-gate/T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE_step1_freeze.json', import.meta.url),
    JSON.stringify({ ticket: 'T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE', stamp, name_exact: NAME_EXACT, candidates: byName, targets: [], ids: [], refs: null, note: 'exact 0건' }, null, 2));
  await Promise.resolve();
  process.exit(0);
}

// ── 2) 참조 검사 ──
console.log(`\n${'='.repeat(70)}\n[참조 검사] freeze ${ids.length}건에 대해`);
const refs = { by_id: {}, totals: { folders: 0, contraindications: 0, prescription_sets: 0, medical_charts: 0 } };

// 2a) prescription_code_folders (FK CASCADE) — id IN
const { data: fld, error: ef } = await sb.from('prescription_code_folders')
  .select('prescription_code_id,folder_id,sort_order').in('prescription_code_id', ids);
if (ef) console.log(`  [folders] 조회오류: ${ef.message}`);
else { refs.totals.folders = fld.length; console.log(`  prescription_code_folders(약품폴더 배정): ${fld.length}행`); fld.forEach(r => console.log(`      code=${r.prescription_code_id} folder=${r.folder_id}`)); }

// 2b) prescription_contraindications (FK CASCADE)
const { data: ci, error: ec } = await sb.from('prescription_contraindications')
  .select('id,prescription_code_id,contraindication_text,severity').in('prescription_code_id', ids);
if (ec) console.log(`  [contraindications] 조회오류: ${ec.message}`);
else { refs.totals.contraindications = ci.length; console.log(`  prescription_contraindications(금기증): ${ci.length}행`); ci.forEach(r => console.log(`      code=${r.prescription_code_id} sev=${r.severity} txt=${(r.contraindication_text||'').slice(0,30)}`)); }

// JSONB 참조는 PostgREST cs(contains) 연산이 array-of-object 에서 400 → 전건 fetch 후 JS 스캔.
const idSet = new Set(ids);
const scanJsonb = (rows, col) => {
  const hits = { total: 0, byId: {} };
  for (const row of rows || []) {
    const arr = Array.isArray(row[col]) ? row[col] : [];
    for (const it of arr) {
      const cid = it && it.prescription_code_id;
      if (cid && idSet.has(cid)) { hits.total++; hits.byId[cid] = (hits.byId[cid]||0)+1; }
    }
  }
  return hits;
};

// 2c) prescription_sets.items JSONB (묶음처방)
const { data: setRows, error: es } = await sb.from('prescription_sets').select('id,items');
if (es) console.log(`  [prescription_sets] 조회오류: ${es.message}`);
const setHits = scanJsonb(setRows, 'items');
refs.totals.prescription_sets = setHits.total;
console.log(`  prescription_sets.items[](묶음처방 참조): ${setHits.total}행 (전체 ${setRows?.length ?? 0}세트 스캔)`);

// 2d) medical_charts.prescription_items JSONB (실 처방 이력) — 페이지네이션 fetch 후 스캔
let mcRows = [], from = 0; const PAGE = 1000;
for (;;) {
  const { data, error } = await sb.from('medical_charts').select('id,prescription_items').range(from, from + PAGE - 1);
  if (error) { console.log(`  [medical_charts] 조회오류: ${error.message}`); break; }
  mcRows = mcRows.concat(data || []);
  if (!data || data.length < PAGE) break;
  from += PAGE;
}
const mcHits = scanJsonb(mcRows, 'prescription_items');
refs.totals.medical_charts = mcHits.total;
console.log(`  medical_charts.prescription_items[](실 처방 이력 참조): ${mcHits.total}행 (전체 ${mcRows.length}차트 스캔)`);
for (const id of ids) {
  refs.by_id[id] = { ...(refs.by_id[id]||{}), prescription_sets: setHits.byId[id]||0, medical_charts: mcHits.byId[id]||0 };
}

// per-id folders/contra 채우기
for (const id of ids) {
  refs.by_id[id] = {
    folders: (fld||[]).filter(r=>r.prescription_code_id===id).length,
    contraindications: (ci||[]).filter(r=>r.prescription_code_id===id).length,
    prescription_sets: refs.by_id[id]?.prescription_sets ?? 0,
    medical_charts: refs.by_id[id]?.medical_charts ?? 0,
  };
}

const anyRef = Object.values(refs.totals).some(v => v > 0);
console.log(`\n${'='.repeat(70)}`);
console.log(`[판정] 총 참조: folders=${refs.totals.folders} contra=${refs.totals.contraindications} sets=${refs.totals.prescription_sets} charts=${refs.totals.medical_charts}`);
console.log(anyRef
  ? '  → 참조 존재 → hard-DELETE 금지. archive-first + 참조 보존(soft) 방식 필요. (medical_charts/sets = JSONB 스냅샷이라 name 렌더 유지)'
  : '  → 참조 없음 → archive-first 스냅샷 후 제거 가능(방식은 supervisor DML 게이트 판정).');

// ── 3) freeze 스냅샷 기록 ──
const out = {
  ticket: 'T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE',
  stamp, db: URL_, name_exact: NAME_EXACT,
  candidates: byName,
  targets, ids, refs, any_ref: anyRef,
};
writeFileSync(new URL('../db-gate/T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE_step1_freeze.json', import.meta.url),
  JSON.stringify(out, null, 2));
console.log(`\n스냅샷 기록: db-gate/T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE_step1_freeze.json`);
console.log('READ-ONLY 완료. UPDATE/DELETE 0건.');
