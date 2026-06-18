/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — BACKFILL DRY-RUN (read-only)
 *
 * 데이터 현실 (inspect 결과):
 *   prescription_codes = 518건 (HIRA 전국 약가 마스터 — ULTRASOUND CATHETER 등 풋과 무관 코드 포함)
 *   services 처방약(category_label='처방약') = 21건 (풋센터 큐레이션 처방약 = reporter가 쓰는 약)
 *   정확(EXACT) name 매칭 = 1건뿐 (포맷차 "밀리그람"↔"mg", 공백, 괄호성분 표기 등)
 *
 * → 올바른 브릿지 방향: 21건 services 처방약 각각에 대해 prescription_codes(HIRA 마스터)에서
 *    매칭되는 행을 찾아 그 prescription_codes 행의 service_id 를 set.
 *    517건 HIRA 잡코드를 services 로 신설하는 것은 명백히 오류 → 하지 않음.
 *
 * 본 스크립트는 매핑 후보만 산출(데이터 무변경). 본적용은 별도 _backfill_apply (사람확인 후).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

// ── 정규화: 포맷차 흡수 ──
//  밀리그람/밀리그램→mg, 공백 제거, 소문자, 마지막 _(용량/포장) 꼬리 제거
const norm = (s) => (s||'')
  .replace(/밀리그?람/g, 'mg')
  .replace(/마이크로그?람/g, 'mcg')
  .replace(/\s+/g, '')
  .replace(/_\([^)]*\)\s*$/,'')   // 끝의 _(0.3g/30g) 꼬리 제거
  .toLowerCase();
// 성분/용량 괄호까지 떼어낸 더 느슨한 키 (코어 약명)
const core = (s) => norm(s).replace(/\([^)]*\)/g, '').replace(/\d+(\.\d+)?(mg|mcg|ml|g|ki?\.?u|단위|%)/g,'');

const c = conn();
await c.connect();
console.log('✅ DB 연결 (BACKFILL DRY-RUN, read-only)', new Date().toISOString(), '\n');

const svc = (await c.query(`SELECT id, name FROM services WHERE category_label='처방약' ORDER BY name`)).rows;
const pc  = (await c.query(`SELECT id, name_ko, claim_code, insurance_status FROM prescription_codes`)).rows;

// prescription_codes 인덱스 (정규화 키)
const pcByNorm = new Map();
const pcByCore = new Map();
for (const r of pc) {
  const n = norm(r.name_ko), k = core(r.name_ko);
  if (!pcByNorm.has(n)) pcByNorm.set(n, []); pcByNorm.get(n).push(r);
  if (k.length>=2) { if (!pcByCore.has(k)) pcByCore.set(k, []); pcByCore.get(k).push(r); }
}

console.log('── services 처방약 21건 → prescription_codes 매핑 후보 ──\n');
const auto=[], review=[], none=[];
for (const s of svc) {
  const n = norm(s.name), k = core(s.name);
  const exact = pcByNorm.get(n) || [];
  if (exact.length === 1) {
    auto.push({ svc: s, pc: exact[0], kind: 'NORM-EXACT' });
    console.log(`✅ AUTO  svc "${s.name}"\n        → pc "${exact[0].name_ko}" [${exact[0].id.slice(0,8)}] claim=${exact[0].claim_code}`);
  } else if (exact.length > 1) {
    review.push({ svc: s, candidates: exact, kind: 'NORM-MULTI' });
    console.log(`⚠️  REVIEW svc "${s.name}" → ${exact.length}건 정규화-동일 후보:`);
    for (const e of exact) console.log(`            · "${e.name_ko}" [${e.id.slice(0,8)}] claim=${e.claim_code}`);
  } else {
    const coreHits = pcByCore.get(k) || [];
    if (coreHits.length >= 1) {
      review.push({ svc: s, candidates: coreHits, kind: 'CORE-FUZZY' });
      console.log(`⚠️  REVIEW svc "${s.name}" (정확매칭 無, 코어약명 후보 ${coreHits.length}건):`);
      for (const e of coreHits.slice(0,5)) console.log(`            · "${e.name_ko}" [${e.id.slice(0,8)}] claim=${e.claim_code}`);
    } else {
      none.push({ svc: s });
      console.log(`❌ NONE  svc "${s.name}" → prescription_codes 후보 없음 (services 단독 약)`);
    }
  }
}

console.log(`\n── 요약 ──`);
console.log(`  AUTO   (정규화 정확 1:1, 자동매핑 후보): ${auto.length}`);
console.log(`  REVIEW (사람확인 필요 — 다중/퍼지): ${review.length}`);
console.log(`  NONE   (services 단독, HIRA 마스터 미존재): ${none.length}`);
console.log(`\n※ AUTO=service_id 자동 set 후보. REVIEW/NONE 은 사람확인(planner/supervisor) 전 본적용 금지.`);
console.log(`※ NONE 은 prescription_codes 에 신설하지 않음(통합뷰에서 services 단독행으로 표시). HIRA 517 잡코드도 services 신설 안 함.`);

// 머신리더블 산출
const out = { generated: new Date().toISOString(), auto, review: review.map(r=>({svc:r.svc, kind:r.kind, candidates:r.candidates.map(c=>({id:c.id,name_ko:c.name_ko,claim_code:c.claim_code}))})), none };
fs.writeFileSync('scripts/T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY_backfill_mapping.json', JSON.stringify(out, null, 2));
console.log('\n📄 매핑 후보 저장: scripts/T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY_backfill_mapping.json');

await c.end();
