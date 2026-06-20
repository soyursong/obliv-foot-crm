/**
 * T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY — 마이그 단계 3~6 APPLY (영속)
 * ▶ 선행 조건: 20260621003000_..._unique.sql.DDL_DIFF_HOLD 마이그 단계1·2(컬럼+CHECK+트리거+RLS)가
 *   supervisor DDL-diff GO 후 이미 적용되어 있어야 함(is_deleted 컬럼 존재 필수).
 *
 * 단계(§B-0a):
 *   3. dedup dry-run 재카운트 → Bucket A/B 재분류·검증
 *   4. Bucket A(우발 dup) 잔여행 soft-delete(is_deleted=true, delete_reason='dedup-accidental-T20260611',
 *      deleted_by=NULL=system) — 유지행 규칙: 임상내용 non-null 최다행, 동률 시 created_at 최선두(원본).
 *      "무조건 latest 유지" 금지. Bucket B(동일일 진짜 별개=다른의사/상병) 발견 시 → 자동삭제 금지·ABORT(현장 에스컬레이션).
 *   5. 활성 dup=0 확인 후 CREATE UNIQUE INDEX CONCURRENTLY (txn 밖) → VALID 검증(INVALID 시 DROP).
 *   6. write-path 23505 는 FE(MedicalChartPanel handleSave)에서 처리(본 스크립트 범위 밖).
 *
 * 실행: node scripts/T-20260620-foot-MEDCHART-DELETE-SAMEDAY_index_apply.mjs [--commit]
 *   (--commit 없으면 단계3 dry-run + Bucket 분류만 출력하고 쓰기 0 — 안전 미리보기)
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
const COMMIT = process.argv.includes('--commit');
let P = process.env.SUPABASE_DB_PASSWORD;
if (!P && fs.existsSync('.env')) for (const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();}
const conn = () => new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });

const INDEX_NAME = 'uix_mc_customer_clinic_date';
// 임상내용 비공란 필드 개수 + 총길이로 "유지행"(non-null 최다, 동률시 최선두) 결정용
const CONTENT_COLS = ['chief_complaint','diagnosis','treatment_record','materials_used','treatment_result','clinical_progress'];

function contentScore(r){
  let fields=0, len=0;
  for(const c of CONTENT_COLS){ const v=(r[c]||'').trim(); if(v){ fields++; len+=v.length; } }
  const rx = Array.isArray(r.prescription_items) ? r.prescription_items.length : 0;
  if(rx>0){ fields++; len+=rx*10; }
  return { fields, len };
}
// Bucket A 판정: 그룹 내 모든 잉여행이 "내용 동일 or 한쪽(거의)공란 or 명백 junk" → 우발 dup
// Bucket B 판정: 둘 다 실질 내용 보유 + (다른 진료의 OR 다른 진단) → 진짜 별개차트
function classifyGroup(rows){
  const scored = rows.map(r=>({ ...r, _s: contentScore(r) }));
  const substantive = scored.filter(r=>r._s.len >= 20); // 실질 내용 보유 행(임의 임계 20자)
  if (substantive.length <= 1) return { bucket:'A', reason:'한쪽 공란/junk(실질내용 보유행 ≤1)' };
  const doctors = new Set(substantive.map(r=>r.signing_doctor_name||r.signing_doctor_id||null).filter(Boolean));
  const dxs = new Set(substantive.map(r=>(r.diagnosis||'').trim()).filter(Boolean));
  if (doctors.size > 1) return { bucket:'B', reason:'서로 다른 진료의' };
  if (dxs.size > 1)     return { bucket:'B', reason:'서로 다른 진단(상병)' };
  return { bucket:'A', reason:'동일 진료의·동일/유사 진단 — 우발 중복' };
}

const c = conn(); await c.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}  (mode=${COMMIT?'COMMIT(쓰기)':'DRY-RUN(미리보기)'})\n`);
try {
  // 선행조건: is_deleted 컬럼 존재
  const colChk = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' AND column_name='is_deleted'`);
  if (colChk.rowCount === 0) {
    console.error('❌ is_deleted 컬럼 부재 — 단계1·2 마이그(20260621003000...)를 먼저 적용하세요(supervisor DDL-diff GO 후).');
    await c.end(); process.exit(1);
  }

  // 단계 3: 동일일 활성 중복 그룹 조회
  const grp = await c.query(`
    SELECT customer_id, clinic_id, visit_date, count(*)::int AS n, array_agg(id ORDER BY created_at) ids
    FROM medical_charts WHERE is_deleted = false
    GROUP BY customer_id, clinic_id, visit_date HAVING count(*) > 1 ORDER BY n DESC`);
  console.log(`[단계3] 동일일 활성 중복 그룹: ${grp.rows.length}`);
  if (grp.rows.length === 0) { console.log('  중복 0 — dedup 불요. 인덱스 생성으로 진행.'); }

  const toSoftDelete = []; let bucketB = 0;
  for (const g of grp.rows) {
    const rowsRes = await c.query(
      `SELECT id, signing_doctor_id, signing_doctor_name, created_at, ${CONTENT_COLS.join(', ')}, prescription_items
       FROM medical_charts WHERE id = ANY($1) ORDER BY created_at`, [g.ids]);
    const rows = rowsRes.rows;
    const cls = classifyGroup(rows);
    // 유지행: non-null 최다(fields desc) → 총길이(len desc) → created_at 최선두(원본)
    const keep = [...rows].sort((a,b)=>{
      const sa=contentScore(a), sb=contentScore(b);
      if(sb.fields!==sa.fields) return sb.fields-sa.fields;
      if(sb.len!==sa.len) return sb.len-sa.len;
      return new Date(a.created_at)-new Date(b.created_at);
    })[0];
    const drop = rows.filter(r=>r.id!==keep.id);
    console.log(`\n  · cust=${String(g.customer_id).slice(0,8)} date=${String(g.visit_date).slice(0,15)} n=${g.n} → Bucket ${cls.bucket} (${cls.reason})`);
    console.log(`      keep=${keep.id.slice(0,8)} (${contentScore(keep).fields}필드/${contentScore(keep).len}자)  drop=${drop.map(r=>r.id.slice(0,8)).join(',')}`);
    if (cls.bucket === 'B') { bucketB++; continue; } // 자동삭제 금지
    drop.forEach(r=>toSoftDelete.push(r.id));
  }

  if (bucketB > 0) {
    console.error(`\n❌ ABORT — Bucket B(동일일 진짜 별개차트) ${bucketB}건 발견. 자동삭제 금지·임상오너 현장 에스컬레이션 필요. 인덱스 생성 보류.`);
    await c.end(); process.exit(2);
  }

  console.log(`\n[단계4] Bucket A soft-delete 대상: ${toSoftDelete.length}행`);
  if (!COMMIT) {
    console.log('  (DRY-RUN: 쓰기 미수행. --commit 으로 실제 적용)');
    await c.end(); process.exit(0);
  }

  // 단계 4: Bucket A 잔여행 soft-delete (트리거가 operation='DELETE' audit 자동 적재)
  if (toSoftDelete.length > 0) {
    await c.query('BEGIN');
    const res = await c.query(
      `UPDATE medical_charts
         SET is_deleted=true, deleted_at=NOW(), deleted_by=NULL,
             delete_reason='dedup-accidental-T20260611', updated_at=NOW()
       WHERE id = ANY($1) AND is_deleted=false`, [toSoftDelete]);
    await c.query('COMMIT');
    console.log(`  ✅ soft-delete 완료: ${res.rowCount}행 (audit_log DELETE 자동 적재)`);
  }

  // 단계 5: 활성 dup=0 확인
  const recheck = await c.query(`
    SELECT count(*)::int AS dup_groups FROM (
      SELECT 1 FROM medical_charts WHERE is_deleted=false
      GROUP BY customer_id, clinic_id, visit_date HAVING count(*)>1) t`);
  if (recheck.rows[0].dup_groups !== 0) {
    console.error(`❌ 활성 중복 잔존: ${recheck.rows[0].dup_groups} 그룹 — 인덱스 생성 보류.`);
    await c.end(); process.exit(3);
  }
  console.log('[단계5] 활성 동일일 중복 0 확인 → UNIQUE INDEX CONCURRENTLY 생성');

  // CONCURRENTLY 는 트랜잭션 밖에서만. partial(WHERE is_deleted=false) → soft-delete 행 제외.
  await c.query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME}
                 ON medical_charts (customer_id, clinic_id, visit_date) WHERE is_deleted=false`);
  const valid = await c.query(`
    SELECT i.indisvalid FROM pg_class c2 JOIN pg_index i ON i.indexrelid=c2.oid WHERE c2.relname=$1`, [INDEX_NAME]);
  if (!valid.rows[0]?.indisvalid) {
    console.error(`❌ 인덱스 ${INDEX_NAME} INVALID — DROP 후 재시도 필요.`);
    await c.query(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
    await c.end(); process.exit(4);
  }
  console.log(`  ✅ ${INDEX_NAME} 생성 + VALID 확인. 동일일 1차트 DB 강제 활성화.`);
  console.log('\n✅ 단계3~5 완료. 단계6(write-path 23505)은 FE에 배선됨.');
} catch (e) {
  console.error('❌ 실패:', e.message);
  await c.end(); process.exit(1);
}
await c.end();
