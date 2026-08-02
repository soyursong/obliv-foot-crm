/**
 * T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT — STEP2~4 PROD APPLY (Management API 변형)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * supervisor DB-GATE GO(MSG-20260802-130629-gcb1) 하에서만 실행. 검증커밋 52cc4f91.
 * 6/28 머신 이관 후 prod DB_PASSWORD 미보유 → Supabase Management API(/database/query,
 * SUPABASE_ACCESS_TOKEN)로 apply(전송계층만 pg→mgmt 교체, 로직 1:1). ANON-PHI-2B mgmtapi precedent 동치.
 *
 * apply 대상 = 170000(discriminator ADDITIVE) → 170001(freeze+backfill) 2개만.
 *   170002(phantom reconcile A+B)·170003(STEP5 NOT NULL) = 별도 게이트 BLOCKED, 본 러너 미적용.
 *
 * 물리 apply 필수조건(supervisor):
 *   1. prod dry-run 선행(.dryrun.sql 2종 BEGIN..ROLLBACK) → freeze=178 실측 + post-probe 무영속 확인.
 *   2. apply 순서 170000 → 170001 (170001 self-record 가 content_checksum 참조 → 170000 선행 필수).
 *   3. apply-직전 재센서스 freeze=178 재확인(불일치 시 진입중단·재판정). 마이그 abort 가드=belt.
 *   4. post-apply introspection: content_checksum 전행 NON-NULL / created_by NULL=1(phantom만) /
 *      class-a 178=legacy-unattributed / self-record 2행 stamp.
 *
 * 실행:
 *   node scripts/..._step234_prod_apply_mgmtapi.mjs census   # 읽기전용 사전센서스
 *   node scripts/..._step234_prod_apply_mgmtapi.mjs dryrun   # dry-run 2종 + 무영속 post-probe
 *   node scripts/..._step234_prod_apply_mgmtapi.mjs apply    # 재센서스 게이트 + up.sql apply + post-apply
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const PHANTOM = '20260724200000';
const EXPECTED_FREEZE = 178;
const M0 = 'supabase/migrations/20260802170000_foot_schema_migrations_discriminator_additive.sql';
const M1 = 'supabase/migrations/20260802170001_foot_schema_migrations_createdby_classa_backfill.sql';
const D0 = 'supabase/migrations/20260802170000_foot_schema_migrations_discriminator_additive.dryrun.sql';
const D1 = 'supabase/migrations/20260802170001_foot_schema_migrations_createdby_classa_backfill.dryrun.sql';

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

// ── 원장 introspection(읽기전용, service-role/mgmt 컨텍스트 명시) ──
async function census(label) {
  console.log(`\n════════ CENSUS: ${label} ════════`);
  const total = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations`))[0].c;
  const nullc = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE created_by IS NULL`))[0].c;
  const nonnull = total - nullc;
  const hasCol = (await q(`SELECT count(*)::int c FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='content_checksum'`))[0].c === 1;
  const phantom = await q(`SELECT version, created_by FROM supabase_migrations.schema_migrations WHERE version='${PHANTOM}'`);
  const maxv = (await q(`SELECT coalesce(max(version),'(none)') v FROM supabase_migrations.schema_migrations`))[0].v;
  const pre170000 = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE version='20260802170000'`))[0].c;
  const pre170001 = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE version='20260802170001'`))[0].c;
  // freeze class-a 술어 = created_by IS NULL AND version<>phantom AND version<'20260802170000'
  const freeze = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE created_by IS NULL AND version<>'${PHANTOM}' AND version<'20260802170000'`))[0].c;
  const legacy = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE created_by='legacy-unattributed'`))[0].c;
  let ckNull = null;
  if (hasCol) ckNull = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE content_checksum IS NULL`))[0].c;

  console.log(`  총 행                  : ${total}`);
  console.log(`  created_by NULL        : ${nullc}   / NON-NULL: ${nonnull}`);
  console.log(`  content_checksum 컬럼  : ${hasCol ? '존재' : '부재'}${hasCol ? `  (NULL 행=${ckNull})` : ''}`);
  console.log(`  phantom ${PHANTOM} : ${phantom.length ? `존재(created_by=${phantom[0].created_by === null ? 'NULL' : phantom[0].created_by})` : '부재!'}`);
  console.log(`  max version            : ${maxv}`);
  console.log(`  170000 선재 / 170001 선재 : ${pre170000} / ${pre170001}`);
  console.log(`  legacy-unattributed 카운트 : ${legacy}`);
  console.log(`  ★ freeze class-a 실측  : ${freeze}  (기대 ${EXPECTED_FREEZE})`);
  return { total, nullc, nonnull, hasCol, ckNull, phantom, maxv, pre170000, pre170001, freeze, legacy };
}

const stage = process.argv[2];

if (stage === 'census') {
  await census('사전 (read-only)');
  console.log('\n[census] 완료 — 읽기전용, 변경 없음.');
  process.exit(0);
}

if (stage === 'dryrun') {
  const pre = await census('dry-run 직전 baseline');
  for (const [f, tag] of [[D0, 'STEP3 170000 discriminator'], [D1, 'STEP2+4 170001 backfill']]) {
    console.log(`\n──── DRY-RUN ${tag} (${f}) ────`);
    const sql = fs.readFileSync(f, 'utf8');
    try { await q(sql); console.log('  ✅ dry-run 통과(BEGIN..ROLLBACK 무영속, 에러 없음)'); }
    catch (e) { console.error('  ❌ dry-run 실패:', e.message); process.exit(1); }
  }
  const post = await census('dry-run 직후 post-probe (무영속 검증)');
  console.log('\n──── 무영속(no-persistence) 검증 ────');
  const okCol = post.hasCol === false;
  const okNull = post.nullc === pre.nullc;
  const okTotal = post.total === pre.total;
  console.log(`  content_checksum 컬럼 여전히 부재 : ${okCol ? 'PASS' : 'FAIL(컬럼 영속됨!)'}`);
  console.log(`  created_by NULL 불변 (${pre.nullc}→${post.nullc}) : ${okNull ? 'PASS' : 'FAIL'}`);
  console.log(`  총 행 불변 (${pre.total}→${post.total})        : ${okTotal ? 'PASS' : 'FAIL'}`);
  if (!(okCol && okNull && okTotal)) { console.error('\n❌ 무영속 위반 — apply 진입 금지. 중단.'); process.exit(1); }
  console.log(`\n[dryrun] 완료 — 무영속 PASS. freeze 실측=${post.freeze}(기대 ${EXPECTED_FREEZE}).`);
  process.exit(0);
}

if (stage === 'apply') {
  // ── 조건3: apply-직전 재센서스 freeze=178 재확인 게이트 ──
  const pre = await census('apply-직전 재센서스 (GATE)');
  if (pre.freeze !== EXPECTED_FREEZE) {
    console.error(`\n❌ GATE FAIL: freeze class-a=${pre.freeze} ≠ 기대 ${EXPECTED_FREEZE} — 센서스 이후 원장 변동. 진입 중단·supervisor 재판정 필요.`);
    process.exit(1);
  }
  if (pre.phantom.length !== 1 || pre.phantom[0].created_by !== null) {
    console.error(`\n❌ GATE FAIL: phantom ${PHANTOM} 상태 이상 — created_by NULL 1행 기대. 중단.`);
    process.exit(1);
  }
  console.log(`\n✅ GATE PASS: freeze=${pre.freeze} · phantom NULL 보존. apply 진입.`);

  // ── 조건2: 170000 → 170001 순서 apply ──
  for (const [f, tag] of [[M0, 'STEP3 170000 discriminator ADDITIVE'], [M1, 'STEP2+4 170001 freeze+backfill']]) {
    console.log(`\n──── APPLY ${tag} (${f}) ────`);
    const sql = fs.readFileSync(f, 'utf8');
    try { await q(sql); console.log('  ✅ 적용 완료(파일 내장 BEGIN/COMMIT 원자 실행 + abort 가드 통과)'); }
    catch (e) { console.error('  ❌ 적용 실패(트랜잭션 자동 롤백):', e.message); process.exit(1); }
  }

  // ── 조건4: post-apply introspection 실측 ──
  const post = await census('post-apply 실측');
  console.log('\n──── post-apply 판정(supervisor 조건4) ────');
  const selfRec = await q(`SELECT version, created_by, (content_checksum IS NOT NULL) ck_set FROM supabase_migrations.schema_migrations WHERE version IN ('20260802170000','20260802170001') ORDER BY version`);
  const c1 = post.hasCol && post.ckNull === 0;
  const c2 = post.nullc === 1 && post.phantom.length === 1 && post.phantom[0].created_by === null;
  const c3 = post.legacy === EXPECTED_FREEZE;
  const c4 = selfRec.length === 2 && selfRec.every(r => r.created_by && r.created_by.startsWith('dev-foot:') && r.ck_set);
  console.log(`  ① content_checksum 전행 NON-NULL (NULL=${post.ckNull})          : ${c1 ? 'PASS' : 'FAIL'}`);
  console.log(`  ② created_by NULL=1 (phantom ${PHANTOM}만)              : ${c2 ? 'PASS' : `FAIL(NULL=${post.nullc})`}`);
  console.log(`  ③ class-a ${EXPECTED_FREEZE} = legacy-unattributed (실측=${post.legacy})       : ${c3 ? 'PASS' : 'FAIL'}`);
  console.log(`  ④ self-record 2행 stamp                                    : ${c4 ? 'PASS' : 'FAIL'}`);
  for (const r of selfRec) console.log(`       ${r.version}  created_by=${r.created_by}  checksum_set=${r.ck_set}`);
  const allPass = c1 && c2 && c3 && c4;
  console.log(`\n[apply] ${allPass ? '✅ ALL PASS — STEP2~4 물리 apply 성공.' : '❌ 판정 실패 — supervisor 보고 필요.'}`);
  process.exit(allPass ? 0 : 1);
}

console.error('usage: node <script> census|dryrun|apply');
process.exit(2);
