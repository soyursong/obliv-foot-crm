/**
 * T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT — STEP 5.5 (A+B) PROD APPLY (Management API 변형)
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * 인가 = supervisor DB-GATE-REPLY MSG-20260802-134806-3lbo:
 *   · §5.5-A(170002 phantom oob-reconcile) + §5.5-B(forward-doc 20260724200000) = GO(사전승인·apply 위임).
 *   · STEP5(170003 NOT NULL) = CONDITIONAL — ★본 러너 절대 미적용★. DA iy3f 종결 + census NULL=0 clean 후
 *     별도 게이트에서만. override 금지.
 *
 * apply 대상 = 170002(phantom NULL→'oob-unreconciled' 정직마커 ADDITIVE) + forwarddoc(DOC-ONLY no-op) 2개만.
 *   170003(STEP5) = 본 러너 코드경로에 아예 없음(fail-safe: 파일 상수 미포함).
 *
 * 경계(supervisor 금지사항 집행):
 *   · 20260802160000(PMW OOB) 무접촉 — 러너 어떤 write 도 이 version 건드리지 않음(DA iy3f 소관).
 *   · §5.5-A 스코프 = 정확히 phantom 20260724200000 1행만(blanket 금지).
 *   · census 우회/강제 SET NOT NULL 없음(NOT NULL DDL 자체가 본 러너에 부재).
 *
 * 실행:
 *   node scripts/..._step55_prod_apply_mgmtapi.mjs census   # 읽기전용 사전센서스
 *   node scripts/..._step55_prod_apply_mgmtapi.mjs dryrun   # dry-run 4종(170000/170001/170002/170003) + 무영속 post-probe
 *   node scripts/..._step55_prod_apply_mgmtapi.mjs apply    # 재센서스 게이트 + 170002+forwarddoc apply + post-apply
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const PHANTOM = '20260724200000';
const PMW_OOB = '20260802160000';           // DA iy3f 소관 — 무접촉
const MARKER = 'oob-unreconciled';

// apply 대상 (STEP5 170003 는 의도적으로 부재)
const M2 = 'supabase/migrations/20260802170002_foot_schema_migrations_phantom_oob_reconcile.sql';
const FWD = 'supabase/migrations/20260724200000_oob_unreconciled_phantom_forwarddoc.sql';

// dry-run 4종 (무영속 검증만; 170003 은 apply 아님·no-persistence 확인 목적)
const DRYRUNS = [
  ['STEP3 170000 discriminator', 'supabase/migrations/20260802170000_foot_schema_migrations_discriminator_additive.dryrun.sql'],
  ['STEP2+4 170001 backfill',    'supabase/migrations/20260802170001_foot_schema_migrations_createdby_classa_backfill.dryrun.sql'],
  ['STEP5.5A 170002 phantom reconcile', 'supabase/migrations/20260802170002_foot_schema_migrations_phantom_oob_reconcile.dryrun.sql'],
  ['STEP5 170003 NOT NULL (게이트 확인용, 미적용)', 'supabase/migrations/20260802170003_foot_schema_migrations_notnull_collision_failclosed.dryrun.sql'],
];

const readEnv = (f, k) => { if (!fs.existsSync(f)) return null; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(new RegExp('^' + k + '=(.*)$')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } return null; };
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN || readEnv('.env.local', 'SUPABASE_ACCESS_TOKEN');
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미설정 — 중단'); process.exit(2); }

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (r.status !== 200 && r.status !== 201) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

// ── 원장 introspection(읽기전용, mgmt 컨텍스트 명시) ──
async function census(label) {
  console.log(`\n════════ CENSUS: ${label} ════════`);
  const total = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations`))[0].c;
  const nullc = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE created_by IS NULL`))[0].c;
  const nullRows = await q(`SELECT version, created_by FROM supabase_migrations.schema_migrations WHERE created_by IS NULL ORDER BY version`);
  const hasCol = (await q(`SELECT count(*)::int c FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='content_checksum'`))[0].c === 1;
  const ckNull = hasCol ? (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE content_checksum IS NULL`))[0].c : null;
  const phantom = await q(`SELECT version, created_by FROM supabase_migrations.schema_migrations WHERE version='${PHANTOM}'`);
  const pmw = await q(`SELECT version, (created_by IS NULL) is_null FROM supabase_migrations.schema_migrations WHERE version='${PMW_OOB}'`);
  const isNullable = (await q(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='created_by'`))[0].is_nullable;
  const trig = (await q(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='trg_foot_schema_migrations_collision_guard' AND NOT tgisinternal`))[0].c;
  const maxv = (await q(`SELECT coalesce(max(version),'(none)') v FROM supabase_migrations.schema_migrations`))[0].v;
  const pre170002 = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE version='20260802170002'`))[0].c;

  console.log(`  총 행                      : ${total}`);
  console.log(`  created_by NULL            : ${nullc}   / NON-NULL: ${total - nullc}`);
  console.log(`  NULL 행 목록               : ${nullRows.map(r => r.version).join(', ') || '(없음)'}`);
  console.log(`  content_checksum 컬럼      : ${hasCol ? `존재(NULL 행=${ckNull})` : '부재'}`);
  console.log(`  phantom ${PHANTOM}   : ${phantom.length ? `존재(created_by=${phantom[0].created_by === null ? 'NULL' : phantom[0].created_by})` : '부재!'}`);
  console.log(`  PMW ${PMW_OOB} (iy3f) : ${pmw.length ? (pmw[0].is_null ? 'created_by=NULL(미reconcile)' : 'created_by=SET(reconciled·무접촉)') : '부재'}`);
  console.log(`  created_by is_nullable     : ${isNullable}   (STEP5 미적용 기대 = YES)`);
  console.log(`  collision-guard 트리거     : ${trig ? '존재' : '부재'}   (STEP5 미적용 기대 = 부재)`);
  console.log(`  max version                : ${maxv}   / 170002 선재 = ${pre170002}`);
  return { total, nullc, nullRows, hasCol, ckNull, phantom, pmw, isNullable, trig, maxv, pre170002 };
}

const stage = process.argv[2];

if (stage === 'census') {
  await census('사전 (read-only)');
  console.log('\n[census] 완료 — 읽기전용, 변경 없음.');
  process.exit(0);
}

if (stage === 'dryrun') {
  const pre = await census('dry-run 직전 baseline');
  for (const [tag, f] of DRYRUNS) {
    console.log(`\n──── DRY-RUN ${tag}\n       (${f}) ────`);
    const sql = fs.readFileSync(f, 'utf8');
    try { await q(sql); console.log('  ✅ dry-run 통과(BEGIN..ROLLBACK 무영속, hard-error 없음)'); }
    catch (e) { console.error('  ❌ dry-run 실패:', e.message); process.exit(1); }
  }
  const post = await census('dry-run 직후 post-probe (무영속 검증)');
  console.log('\n──── 무영속(no-persistence) 검증 ────');
  const checks = [
    ['총 행 불변', post.total === pre.total, `${pre.total}→${post.total}`],
    ['created_by NULL 불변', post.nullc === pre.nullc, `${pre.nullc}→${post.nullc}`],
    ['content_checksum 컬럼 상태 불변', post.hasCol === pre.hasCol, `${pre.hasCol}→${post.hasCol}`],
    ['created_by is_nullable 불변(YES)', post.isNullable === pre.isNullable && post.isNullable === 'YES', `${pre.isNullable}→${post.isNullable}`],
    ['collision 트리거 여전히 부재', post.trig === 0 && pre.trig === 0, `${pre.trig}→${post.trig}`],
    ['phantom created_by 불변(NULL)', post.phantom[0]?.created_by === null, `${pre.phantom[0]?.created_by}→${post.phantom[0]?.created_by}`],
    ['PMW 20260802160000 무접촉', JSON.stringify(post.pmw) === JSON.stringify(pre.pmw), 'unchanged'],
  ];
  let ok = true;
  for (const [name, pass, detail] of checks) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`); ok = ok && pass; }
  if (!ok) { console.error('\n❌ 무영속 위반 — apply 진입 금지. 중단.'); process.exit(1); }
  console.log('\n[dryrun] 완료 — 4종 무영속 PASS. STEP5(170003) 미적용 상태 재확인.');
  process.exit(0);
}

if (stage === 'apply') {
  // ── GATE: apply-직전 재센서스 ──
  const pre = await census('apply-직전 재센서스 (GATE)');
  // (1) phantom = NULL 1행 정확히
  if (pre.phantom.length !== 1 || pre.phantom[0].created_by !== null) {
    // 멱등 재진입 허용: 이미 마킹돼 있으면 통과(아래 apply 가 no-op)
    if (!(pre.phantom.length === 1 && pre.phantom[0].created_by === MARKER)) {
      console.error(`\n❌ GATE FAIL: phantom ${PHANTOM} 상태 이상 — NULL 1행(또는 이미 ${MARKER}) 기대. 중단.`); process.exit(1);
    }
    console.log(`  (멱등) phantom 이미 ${MARKER} — apply 는 no-op 예상.`);
  }
  // (2) PMW OOB 무접촉 경계 — 어떤 상태든 러너는 건드리지 않음(그냥 로깅)
  console.log(`  경계 확인: PMW ${PMW_OOB} 는 본 러너 write 대상 아님(DA iy3f 소관).`);
  // (3) STEP5 절대 미적용 — is_nullable 이 이미 NO 면 STEP5 가 이미 적용됐다는 뜻 → 본 러너 범위 밖, 경보
  if (pre.isNullable !== 'YES') {
    console.error(`\n❌ GATE FAIL: created_by is_nullable=${pre.isNullable} ≠ YES — STEP5 가 이미 적용된 상태. 본 §5.5 러너 스코프 밖. 중단.`); process.exit(1);
  }
  console.log(`\n✅ GATE PASS: phantom NULL 보존 · is_nullable=YES(STEP5 미적용) · PMW 무접촉. apply 진입.`);

  // ── apply: 170002 → forward-doc (순서·STEP5 부재) ──
  for (const [f, tag] of [[M2, 'STEP5.5A 170002 phantom oob-reconcile(정직마커 ADDITIVE)'], [FWD, 'STEP5.5B forward-doc(DOC-ONLY no-op)']]) {
    console.log(`\n──── APPLY ${tag}\n       (${f}) ────`);
    const sql = fs.readFileSync(f, 'utf8');
    try { await q(sql); console.log('  ✅ 적용 완료(파일 내장 BEGIN/COMMIT 원자 실행 + abort 가드 통과)'); }
    catch (e) { console.error('  ❌ 적용 실패(트랜잭션 자동 롤백):', e.message); process.exit(1); }
  }

  // ── post-apply introspection ──
  const post = await census('post-apply 실측');
  const selfRec = await q(`SELECT version, created_by, (content_checksum IS NOT NULL) ck_set FROM supabase_migrations.schema_migrations WHERE version='20260802170002'`);
  console.log('\n──── post-apply 판정 ────');
  const c1 = post.phantom.length === 1 && post.phantom[0].created_by === MARKER;
  const c2 = post.nullc === 0;
  const c3 = post.isNullable === 'YES';               // STEP5 미적용 필수
  const c4 = post.trig === 0;                          // STEP5 트리거 미생성 필수
  const c5 = selfRec.length === 1 && selfRec[0].created_by && selfRec[0].created_by.startsWith('dev-foot:') && selfRec[0].ck_set;
  const c6 = post.pmw.length === 1 && post.pmw[0].is_null === false;  // PMW 여전히 reconciled(무접촉)
  console.log(`  ① phantom ${PHANTOM} created_by='${MARKER}'      : ${c1 ? 'PASS' : `FAIL(${post.phantom[0]?.created_by})`}`);
  console.log(`  ② created_by NULL = 0 (clean)                          : ${c2 ? 'PASS' : `FAIL(NULL=${post.nullc}: ${post.nullRows.map(r=>r.version).join(',')})`}`);
  console.log(`  ③ created_by is_nullable = YES (STEP5 미적용 확인)      : ${c3 ? 'PASS' : `FAIL(${post.isNullable})`}`);
  console.log(`  ④ collision-guard 트리거 부재 (STEP5 미적용 확인)       : ${c4 ? 'PASS' : 'FAIL(트리거 존재!)'}`);
  console.log(`  ⑤ 170002 self-record stamp(created_by+checksum)        : ${c5 ? 'PASS' : 'FAIL'}`);
  console.log(`  ⑥ PMW ${PMW_OOB} 무접촉(reconciled 유지)         : ${c6 ? 'PASS' : 'FAIL'}`);
  if (selfRec.length) console.log(`       170002  created_by=${selfRec[0].created_by}  checksum_set=${selfRec[0].ck_set}`);
  const allPass = c1 && c2 && c3 && c4 && c5 && c6;
  console.log(`\n[apply] ${allPass ? '✅ ALL PASS — §5.5(A+B) 물리 apply 성공. STEP5 는 미적용 상태 유지(DA iy3f 대기).' : '❌ 판정 실패 — supervisor 보고 필요.'}`);
  process.exit(allPass ? 0 : 1);
}

console.error('usage: node <script> census|dryrun|apply');
process.exit(2);
