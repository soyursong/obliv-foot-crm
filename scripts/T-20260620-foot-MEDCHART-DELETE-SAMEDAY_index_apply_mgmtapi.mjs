/**
 * T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY — 마이그 단계 3~5 APPLY (Management API 변형)
 *
 * 원본 scripts/T-20260620-foot-MEDCHART-DELETE-SAMEDAY_index_apply.mjs 는 pg 직결(SUPABASE_DB_PASSWORD).
 * 6/28 머신 이관 후 prod DB_PASSWORD 미보유 → Supabase Management API(/database/query, SUPABASE_ACCESS_TOKEN)로 동일 로직 수행.
 * dedup keep-rule·Bucket 분류·ABORT 게이트·VALID 검증 로직은 원본과 1:1 동치.
 *
 * 단계(§B-0a):
 *   3. dedup 재카운트 → Bucket A/B 재분류·검증
 *   4. Bucket A 잔여행 soft-delete(is_deleted=true, delete_reason='dedup-accidental-T20260611',
 *      deleted_by=NULL=system). 유지행=임상내용 non-null 최다 → 총길이 → created_at 최선두(원본). "무조건 latest" 금지.
 *      Bucket B(동일일 진짜 별개) 발견 시 자동삭제 금지·ABORT.
 *   5. 활성 dup=0 확인 후 CREATE UNIQUE INDEX CONCURRENTLY (단일 statement=txn 밖) → VALID 검증(INVALID 시 DROP).
 *
 * 실행: node scripts/T-20260620-foot-MEDCHART-DELETE-SAMEDAY_index_apply_mgmtapi.mjs [--commit]
 *   (--commit 없으면 단계3 dry-run + Bucket 분류만, 쓰기 0)
 */
import fs from 'fs';

const COMMIT = process.argv.includes('--commit');
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const uuidList = (arr) => arr.map((x) => `${lit(x)}::uuid`).join(',');

const INDEX_NAME = 'uix_mc_customer_clinic_date';
const CONTENT_COLS = ['chief_complaint', 'diagnosis', 'treatment_record', 'materials_used', 'treatment_result', 'clinical_progress'];

function contentScore(r) {
  let fields = 0, len = 0;
  for (const c of CONTENT_COLS) { const v = (r[c] || '').trim(); if (v) { fields++; len += v.length; } }
  const rx = Array.isArray(r.prescription_items) ? r.prescription_items.length : 0;
  if (rx > 0) { fields++; len += rx * 10; }
  return { fields, len };
}
function classifyGroup(rows) {
  const scored = rows.map((r) => ({ ...r, _s: contentScore(r) }));
  const substantive = scored.filter((r) => r._s.len >= 20);
  if (substantive.length <= 1) return { bucket: 'A', reason: '한쪽 공란/junk(실질내용 보유행 ≤1)' };
  const doctors = new Set(substantive.map((r) => r.signing_doctor_name || r.signing_doctor_id || null).filter(Boolean));
  const dxs = new Set(substantive.map((r) => (r.diagnosis || '').trim()).filter(Boolean));
  if (doctors.size > 1) return { bucket: 'B', reason: '서로 다른 진료의' };
  if (dxs.size > 1) return { bucket: 'B', reason: '서로 다른 진단(상병)' };
  return { bucket: 'A', reason: '동일 진료의·동일/유사 진단 — 우발 중복' };
}

console.log(`✅ Management API 연결  (mode=${COMMIT ? 'COMMIT(쓰기)' : 'DRY-RUN(미리보기)'})\n`);

// 선행조건: is_deleted 컬럼 존재
const colChk = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' AND column_name='is_deleted'`);
if (colChk.length === 0) { console.error('❌ is_deleted 컬럼 부재 — 단계1·2 마이그를 먼저 적용하세요.'); process.exit(1); }

// 단계 3: 동일일 활성 중복 그룹
const grp = await q(`
  SELECT customer_id, clinic_id, visit_date::text AS visit_date, count(*)::int AS n,
         array_agg(id ORDER BY created_at) AS ids
  FROM medical_charts WHERE is_deleted = false
  GROUP BY customer_id, clinic_id, visit_date HAVING count(*) > 1 ORDER BY n DESC`);
console.log(`[단계3] 동일일 활성 중복 그룹: ${grp.length}`);
if (grp.length === 0) console.log('  중복 0 — dedup 불요. 인덱스 생성으로 진행.');

const toSoftDelete = []; let bucketB = 0;
for (const g of grp) {
  const ids = g.ids;
  const rows = await q(`
    SELECT id, signing_doctor_id, signing_doctor_name, created_at::text AS created_at,
           ${CONTENT_COLS.join(', ')}, prescription_items
    FROM medical_charts WHERE id IN (${uuidList(ids)}) ORDER BY created_at`);
  const cls = classifyGroup(rows);
  const keep = [...rows].sort((a, b) => {
    const sa = contentScore(a), sb = contentScore(b);
    if (sb.fields !== sa.fields) return sb.fields - sa.fields;
    if (sb.len !== sa.len) return sb.len - sa.len;
    return new Date(a.created_at) - new Date(b.created_at);
  })[0];
  const drop = rows.filter((r) => r.id !== keep.id);
  console.log(`\n  · cust=${String(g.customer_id).slice(0, 8)} date=${String(g.visit_date).slice(0, 10)} n=${g.n} → Bucket ${cls.bucket} (${cls.reason})`);
  console.log(`      keep=${keep.id.slice(0, 8)} (${contentScore(keep).fields}필드/${contentScore(keep).len}자)  drop=${drop.map((r) => r.id.slice(0, 8)).join(',')}`);
  if (cls.bucket === 'B') { bucketB++; continue; }
  drop.forEach((r) => toSoftDelete.push(r.id));
}

if (bucketB > 0) {
  console.error(`\n❌ ABORT — Bucket B(동일일 진짜 별개차트) ${bucketB}건 발견. 자동삭제 금지·임상오너 현장 에스컬레이션 필요. 인덱스 생성 보류.`);
  process.exit(2);
}

console.log(`\n[단계4] Bucket A soft-delete 대상: ${toSoftDelete.length}행`);
if (!COMMIT) { console.log('  (DRY-RUN: 쓰기 미수행. --commit 으로 실제 적용)'); process.exit(0); }

// 단계 4: Bucket A 잔여행 soft-delete (BEFORE UPDATE 트리거가 operation='DELETE' audit 자동 적재)
if (toSoftDelete.length > 0) {
  const res = await q(`
    UPDATE medical_charts
       SET is_deleted=true, deleted_at=NOW(), deleted_by=NULL,
           delete_reason='dedup-accidental-T20260611', updated_at=NOW()
     WHERE id IN (${uuidList(toSoftDelete)}) AND is_deleted=false
     RETURNING id`);
  console.log(`  ✅ soft-delete 완료: ${res.length}행 (audit_log DELETE 자동 적재)`);
}

// 단계 5: 활성 dup=0 확인
const recheck = await q(`
  SELECT count(*)::int AS dup_groups FROM (
    SELECT 1 FROM medical_charts WHERE is_deleted=false
    GROUP BY customer_id, clinic_id, visit_date HAVING count(*)>1) t`);
if (recheck[0].dup_groups !== 0) { console.error(`❌ 활성 중복 잔존: ${recheck[0].dup_groups} 그룹 — 인덱스 생성 보류.`); process.exit(3); }
console.log('[단계5] 활성 동일일 중복 0 확인 → UNIQUE INDEX CONCURRENTLY 생성');

// CONCURRENTLY 는 단일 statement 로만(txn 밖). Management API 는 autocommit → 단일 DDL statement 로 전송.
await q(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME}
         ON medical_charts (customer_id, clinic_id, visit_date) WHERE is_deleted=false`);
const valid = await q(`SELECT i.indisvalid FROM pg_class c2 JOIN pg_index i ON i.indexrelid=c2.oid WHERE c2.relname=${lit(INDEX_NAME)}`);
if (!valid[0]?.indisvalid) {
  console.error(`❌ 인덱스 ${INDEX_NAME} INVALID — DROP 후 재시도 필요.`);
  await q(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
  process.exit(4);
}
console.log(`  ✅ ${INDEX_NAME} 생성 + VALID 확인. 동일일 1차트 DB 강제 활성화.`);
console.log('\n✅ 단계3~5 완료. 단계6(write-path 23505)은 FE에 배선됨(commit 97a8eaff).');
