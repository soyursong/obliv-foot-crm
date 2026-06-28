// T-20260616-foot-PKG-CUSTNAME-ENCRYPTED — PROD 테스트픽스처 정리 (GATED · destructive)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ supervisor db-gate 통과 후에만 CONFIRM=1 로 실행. 기본은 DRY-RUN(읽기전용 카운트).
//   기준: dev_ops_policy(운영 DB 변경 supervisor 사전 승인). RC = E2E 테스트픽스처
//         (epoch 10자리명) PROD 누적 → 패키지/고객 목록 식별불가. RLS/암호화 무죄.
//   안전장치: (1) 백업 스키마에 전 영향행 복사 → 롤백 source.
//            (2) 단일 트랜잭션 · NO-ACTION 자식 → packages → customers 의존순서.
//            (3) 삭제대상 = epoch명(`[0-9]{10}`) AND clinic=jongno-foot 한정.
//            (4) 한글 실고객명은 매칭 안 됨(오탐 0 검증식 포함).
//   롤백: 백업 스키마 cleanup_bak_<ts> + 실행 시 명시적 롤백 SQL 파일
//         (scripts/rollback_cleanup_bak_<ts>.sql) 산출 → 백업스키마 유실 대비 durable artifact.
//         FK 순서 비의존(트리거 비활성 복원 패턴, pg_dump 표준). db-gate 항목#4 충족.
//   대상필터(#2 정당화): name ~ '[0-9]{10}' AND clinic=jongno-foot 는 의도된 협소 가드 —
//         E2E 픽스처는 항상 epoch(10+자리 ms)명을 생성하고, 실고객명(한글/영문)은 절대 매칭 안 됨.
//         넓히면 오탐 위험↑이므로 고정 유지가 안전. 오탐가드(L36)로 실측 0건 강제.
// 실행:  node scripts/..._cleanup_GATED.mjs            # DRY-RUN
//        CONFIRM=1 node scripts/..._cleanup_GATED.mjs  # 실제 백업+삭제 (gate 후)
import pg from 'pg'; import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url'; import { dirname, resolve, join } from 'node:path';
let P=process.env.SUPABASE_DB_PASSWORD;
// .env 경로는 스크립트 위치(<repo>/scripts/) 기준 repo root 에서 해석 — 머신/홈 경로 비의존.
// (2026-06-28 M3 Ultra 교체로 repo 가 ~/Documents/GitHub → ~/GitHub 이동, 하드코딩 경로 깨짐)
const __dir=dirname(fileURLToPath(import.meta.url));
const ENV_CANDIDATES=[resolve(__dir,'..','.env'), process.env.HOME+'/GitHub/obliv-foot-crm/.env', process.env.HOME+'/Documents/GitHub/obliv-foot-crm/.env'];
for(const ep of ENV_CANDIDATES){
  try{ for(const l of readFileSync(ep,'utf8').split('\n')){const m=l.match(/^SUPABASE_DB_PASSWORD=(.*)$/);if(m)P=m[1].trim();} break; }catch(e){ /* try next */ }
}
if(!P){ console.error('❌ SUPABASE_DB_PASSWORD 미해석 — .env 없음 + env var 미설정. 중단.'); process.exit(1); }
const CONFIRM = process.env.CONFIRM === '1';
const c=new pg.Client({host:'aws-1-ap-southeast-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.rxlomoozakkjesdqjtvd',password:P,ssl:{rejectUnauthorized:false}});
await c.connect();

const {rows:cl}=await c.query(`SELECT id FROM clinics WHERE slug='jongno-foot'`);
const JID=cl[0].id;
// 삭제대상 customer 집합 정의 (CTE 로 모든 쿼리에서 재사용)
const C = `SELECT id FROM customers WHERE clinic_id='${JID}' AND name ~ '[0-9]{10}'`;

console.log(`MODE: ${CONFIRM?'⚠ DESTRUCTIVE (CONFIRM=1)':'DRY-RUN (읽기전용)'}`);

// 오탐 안전성 — 삭제대상 중 한글 "성씨 2~4자 단독" 패턴(실고객 의심) 0건 확인
const {rows:sus}=await c.query(`SELECT count(*) n FROM customers WHERE clinic_id='${JID}' AND name ~ '[0-9]{10}' AND name ~ '^[가-힣]{2,4}$'`);
console.log(`오탐가드(epoch명+순수한글2~4자 단독): ${sus[0].n}건 (0 이어야 안전)`);
if(Number(sus[0].n)>0){ console.error('❌ 오탐 의심 — 중단. 패턴 재검토 필요.'); await c.end(); process.exit(1); }

const {rows:tgt}=await c.query(`SELECT count(*) n FROM (${C}) t`);
console.log(`삭제대상 customers: ${tgt[0].n}명`);

if(!CONFIRM){
  // 영향행 카운트만 출력
  for(const [t,col] of [['check_ins','customer_id'],['payments','customer_id'],['reservations','customer_id'],['medical_charts','customer_id'],['package_payments','customer_id'],['packages','customer_id']]){
    try{const {rows}=await c.query(`SELECT count(*) n FROM ${t} WHERE ${col} IN (${C})`);console.log(`  ${t}.${col}: ${rows[0].n}`);}catch(e){console.log(`  ${t}: skip(${e.code})`);}
  }
  console.log('\n[DRY-RUN] 삭제 미수행. gate 후 CONFIRM=1 로 재실행.');
  console.log('[롤백 SQL] CONFIRM=1 실행 시 백업 직후 scripts/rollback_cleanup_bak_<ts>.sql 산출 — 삭제 전 durable 복구 artifact 보장(db-gate 항목#4).');
  await c.end(); process.exit(0);
}

// ── DESTRUCTIVE PATH (gate 후) ──────────────────────────────────────────────
const TS = new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);
const BAK = `cleanup_bak_${TS}`;
console.log(`백업 스키마: ${BAK}`);
await c.query(`CREATE SCHEMA IF NOT EXISTS ${BAK}`);

const childTables = ['check_ins','payments','reservations','medical_charts','package_payments',
  'checklists','consent_forms','form_submissions','insurance_documents','insurance_receipts',
  'insurance_claims','payment_code_claims','prescriptions','service_charges',
  'clinical_images','customer_special_notes','customer_treatment_memos','health_q_results',
  'health_q_tokens','message_logs','notification_opt_outs','reservation_memo_history'];

try{
  await c.query('BEGIN');
  // 백업: customers + packages + package_sessions(of pkgs) + 모든 customer 참조 자식
  await c.query(`CREATE TABLE ${BAK}.customers AS SELECT * FROM customers WHERE id IN (${C})`);
  await c.query(`CREATE TABLE ${BAK}.packages AS SELECT * FROM packages WHERE customer_id IN (${C})`);
  await c.query(`CREATE TABLE ${BAK}.package_sessions AS SELECT * FROM package_sessions WHERE package_id IN (SELECT id FROM packages WHERE customer_id IN (${C}))`);
  for(const t of childTables){
    try{
      const col = (t==='patient_room_daily_log')?'patient_id':'customer_id';
      await c.query(`CREATE TABLE ${BAK}.${t} AS SELECT * FROM ${t} WHERE ${col} IN (${C})`);
    }catch(e){ console.log(`  backup skip ${t}: ${e.code}`); }
  }
  console.log('백업 완료.');

  // ── 롤백 SQL artifact 산출 (삭제 전, durable) ───────────────────────────────
  // 백업 스키마에 실제 생성된 테이블만 대상. FK 순서 비의존 — 복원 트랜잭션 내
  // 트리거(=FK 검사) 비활성 후 일괄 INSERT, 재활성 (pg_dump 표준 복원 패턴).
  const {rows:bakTbls}=await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='${BAK}' ORDER BY (table_name='customers') DESC, (table_name='packages') DESC, table_name`);
  const tnames = bakTbls.map(r=>r.table_name);
  const rb = [
    `-- ROLLBACK for ${BAK} (T-20260616-foot-PKG-CUSTNAME-ENCRYPTED)`,
    `-- 사용: psql "$DATABASE_URL" -f <this file>   (백업 스키마 ${BAK} 존재 시에만 유효)`,
    `BEGIN;`,
    ...tnames.map(t=>`ALTER TABLE public.${t} DISABLE TRIGGER ALL;`),
    ...tnames.map(t=>`INSERT INTO public.${t} SELECT * FROM ${BAK}.${t} ON CONFLICT DO NOTHING;`),
    ...tnames.map(t=>`ALTER TABLE public.${t} ENABLE TRIGGER ALL;`),
    `COMMIT;`,
    `-- 복원 검증: SELECT count(*) FROM public.customers WHERE id IN (SELECT id FROM ${BAK}.customers);`,
    ``,
  ].join('\n');
  const rbPath = join(__dir, `rollback_${BAK}.sql`);
  writeFileSync(rbPath, rb, 'utf8');
  console.log(`롤백 SQL 산출: ${rbPath} (대상 ${tnames.length}개 테이블)`);

  // 삭제 1) check_ins (customer 또는 대상 package 참조) — NO ACTION
  await c.query(`DELETE FROM check_ins WHERE customer_id IN (${C}) OR package_id IN (SELECT id FROM packages WHERE customer_id IN (${C}))`);
  // 삭제 2) 기타 NO ACTION customer 자식
  for(const t of ['payments','reservations','medical_charts','package_payments','checklists','consent_forms','form_submissions','insurance_documents','insurance_receipts','payment_code_claims','prescriptions','service_charges']){
    try{ await c.query(`DELETE FROM ${t} WHERE customer_id IN (${C})`); }catch(e){ console.log(`  del skip ${t}: ${e.code}`); }
  }
  // 삭제 3) packages 자기참조 끊기 후 삭제 (package_sessions/package_payments CASCADE)
  await c.query(`UPDATE packages SET transferred_to=NULL WHERE transferred_to IN (SELECT id FROM packages WHERE customer_id IN (${C}))`);
  await c.query(`UPDATE packages SET transferred_from=NULL WHERE transferred_from IN (SELECT id FROM packages WHERE customer_id IN (${C}))`);
  await c.query(`DELETE FROM packages WHERE customer_id IN (${C})`);
  // 삭제 4) customers (11개 CASCADE 자동 + referrer_id SET NULL)
  const {rowCount}=await c.query(`DELETE FROM customers WHERE id IN (SELECT id FROM ${BAK}.customers)`);
  console.log(`customers 삭제: ${rowCount}명`);

  // 검증
  const {rows:chk}=await c.query(`SELECT count(*) n FROM customers WHERE clinic_id='${JID}' AND name ~ '[0-9]{10}'`);
  if(Number(chk[0].n)!==0) throw new Error(`잔존 ${chk[0].n}건 — 롤백`);
  const {rows:pkgChk}=await c.query(`SELECT count(*) n FROM packages WHERE clinic_id='${JID}' AND status='active'`);
  console.log(`정리 후 jongno-foot active packages: ${pkgChk[0].n}건`);

  await c.query('COMMIT');
  console.log(`✅ 정리 완료. 롤백 source = 스키마 ${BAK} + SQL 파일 ${rbPath}`);
}catch(e){
  await c.query('ROLLBACK');
  console.error('❌ 실패 → ROLLBACK:', e.message);
  process.exit(1);
}
await c.end();
