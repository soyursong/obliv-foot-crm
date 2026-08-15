/**
 * T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT — 물리 apply 배치 [STEP7′ → STEP8 belt → STEP5]
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * 인가 = supervisor DB-GATE-REPLY MSG-20260816-015602-hbo7 (GO-token 발행):
 *   · nonce        = 47c9437cf489a3a3
 *   · content-bind = commit 376ae8ff9779c48fba9eb17391674fa876afb63b (branch feat/T-20260802-…)
 *   · scope        = [STEP7′(20260810125000) → STEP8 belt(20260810130000) → STEP5(20260802170003)] 단일세션 연속
 *   · drift 방어 option(a) 승인 · apply_before_go 불변(본 토큰 후에만).
 *
 * 실행 조건(GO-token):
 *   ① apply-직전 재센서스 freeze=28 재확인. count≠28 시 마이그 내장 freeze-abort(fail-closed) → 전체 롤백.
 *   ② 순서 = STEP7′ → STEP8 belt → STEP5. STEP5 SET NOT NULL 은 belt 착지 + census NULL=0 재확인 후에만.
 *   ③ negtest 동반 = AC4/AC5 + AC8 (No-Persistence).
 *   ④ post-apply introspection report-back.
 *
 * ⚠ 자작 러너 raw-exec 금지 벡터 ≠ 본 러너: 본 러너는 GO-token 후 gated·census-gated·순서엄수 집행이며,
 *   census 우회·강제 apply 없음(각 마이그 내장 freeze-abort/pre-check 가 fail-closed belt).
 *
 * 실행:
 *   node scripts/..._step785_batch_apply_mgmtapi.mjs census    # 읽기전용 사전센서스(freeze=28 확인)
 *   node scripts/..._step785_batch_apply_mgmtapi.mjs apply     # 재센서스 GATE → STEP7′→STEP8→(NULL=0 GATE)→STEP5 → post-apply
 *   node scripts/..._step785_batch_apply_mgmtapi.mjs negtest   # AC4/AC5 + AC8 (post-apply, No-Persistence)
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const PHANTOM = '20260724200000';
const MARKER = 'oob-unreconciled';
const FREEZE_EXPECTED = 28;

const V_STEP7 = '20260810125000';
const V_STEP8 = '20260810130000';
const V_STEP5 = '20260802170003';
const SELF_RECORDS = [V_STEP7, V_STEP8, V_STEP5];

const F_STEP7 = 'supabase/migrations/20260810125000_foot_schema_migrations_createdby_classa_rebackfill_step7.sql';
const F_STEP8 = 'supabase/migrations/20260810130000_foot_schema_migrations_createdby_applypath_belt_step8.sql';
const F_STEP5 = 'supabase/migrations/20260802170003_foot_schema_migrations_notnull_collision_failclosed.sql';
// ★belt-aware: 원 negtest 의 AC4(actor-less REJECT)는 STEP8 belt 착지 전 저작분으로 belt-present 세계와 모순
//   (belt 가 actor-less 를 cli-apply:* 로 stamp → non-NULL 착지 = 설계목적). 원 AC4 의 참 invariant 는
//   AC4′(belt stamp NULL 물리불가, 본 파일) + AC8-4b(belt 제거 시 NOT NULL REJECT, load-bearing)로 분해 실증.
const NEG_AC45 = 'supabase/migrations/20260802170003_foot_schema_migrations_notnull_collision_failclosed.negtest.beltaware.sql';
const NEG_AC8  = 'supabase/migrations/20260810130000_foot_schema_migrations_createdby_applypath_belt_step8.negtest.sql';

const readEnv = (f, k) => { if (!fs.existsSync(f)) return null; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(new RegExp('^' + k + '=(.*)$')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } return null; };
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || readEnv('.env.local', 'SUPABASE_ACCESS_TOKEN');
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

async function census(label) {
  console.log(`\n════════ CENSUS: ${label} ════════`);
  const total = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations`))[0].c;
  const nullc = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE created_by IS NULL`))[0].c;
  const nullRows = await q(`SELECT version FROM supabase_migrations.schema_migrations WHERE created_by IS NULL ORDER BY version`);
  // freeze-set(class-a) = NULL AND version <> phantom (STEP7 술어와 동일)
  const freezeCnt = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE created_by IS NULL AND version <> '${PHANTOM}'`))[0].c;
  const isNullable = (await q(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='created_by'`))[0].is_nullable;
  const trigBelt = (await q(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='trg_foot_schema_migrations_createdby_belt' AND NOT tgisinternal`))[0].c;
  const trigColl = (await q(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='trg_foot_schema_migrations_collision_guard' AND NOT tgisinternal`))[0].c;
  const phantom = await q(`SELECT version, created_by FROM supabase_migrations.schema_migrations WHERE version='${PHANTOM}'`);
  const selfRecs = await q(`SELECT version, created_by, (content_checksum IS NOT NULL) ck_set FROM supabase_migrations.schema_migrations WHERE version IN ('${V_STEP7}','${V_STEP8}','${V_STEP5}') ORDER BY version`);
  // dummy negtest 잔존물 검출(무영속 검증용)
  const dummy = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations WHERE version LIKE '2999%'`))[0].c;

  const phCb = phantom.length ? (phantom[0].created_by === null ? 'NULL' : phantom[0].created_by) : '(부재!)';
  console.log(`  총 행                    : ${total}   / NON-NULL: ${total - nullc}`);
  console.log(`  created_by NULL          : ${nullc}   (freeze-set class-a[NULL∧≠phantom] = ${freezeCnt}, 기대 ${FREEZE_EXPECTED})`);
  console.log(`  NULL 행 목록             : ${nullRows.map(r => r.version).join(', ') || '(없음)'}`);
  console.log(`  is_nullable              : ${isNullable}`);
  console.log(`  belt 트리거              : ${trigBelt ? '존재' : '부재'}   / collision 트리거: ${trigColl ? '존재' : '부재'}`);
  console.log(`  phantom ${PHANTOM} : created_by=${phCb}`);
  console.log(`  self-records(7/8/5)      : ${selfRecs.length ? selfRecs.map(r => `${r.version}=${r.created_by}[ck:${r.ck_set?'SET':'NULL'}]`).join(' | ') : '(미점유)'}`);
  console.log(`  2999* dummy(negtest 잔존) : ${dummy}   (기대 0)`);
  return { total, nullc, nullRows, freezeCnt, isNullable, trigBelt, trigColl, phantom, phCb, selfRecs, dummy };
}

async function applyFile(f, tag) {
  console.log(`\n──── APPLY ${tag}\n       (${f}) ────`);
  const sql = fs.readFileSync(f, 'utf8');
  try { await q(sql); console.log('  ✅ 적용 완료(파일 내장 BEGIN/COMMIT 원자 실행 + 내장 freeze-abort/pre-check 가드 통과)'); }
  catch (e) { console.error('  ❌ 적용 실패(트랜잭션 자동 롤백·fail-closed):', e.message); process.exit(1); }
}

const stage = process.argv[2];

if (stage === 'census') {
  const c = await census('사전 (read-only)');
  console.log(`\n[census] freeze-set class-a = ${c.freezeCnt} (기대 ${FREEZE_EXPECTED}) → ${c.freezeCnt === FREEZE_EXPECTED ? '✅ 일치(apply GATE 통과 예상)' : '⚠ 불일치 — drift. apply 시 마이그 내장 freeze-abort 로 전체 롤백(fail-closed). supervisor 보고 필요.'}`);
  process.exit(0);
}

if (stage === 'apply') {
  console.log('════════════════════════════════════════════════════════════');
  console.log('GO-token nonce=47c9437cf489a3a3 · commit-bind=376ae8ff · scope=[STEP7′→STEP8→STEP5] 단일세션');
  console.log('════════════════════════════════════════════════════════════');

  // ── GATE 0: apply-직전 재센서스(조건①) ──
  const pre = await census('apply-직전 재센서스 (GATE·조건①)');
  const gates = [
    [`freeze-set class-a = ${FREEZE_EXPECTED}`, pre.freezeCnt === FREEZE_EXPECTED, `${pre.freezeCnt}`],
    ['is_nullable = YES (STEP5 미적용)', pre.isNullable === 'YES', pre.isNullable],
    ['belt 트리거 부재 (STEP8 미적용)', pre.trigBelt === 0, `${pre.trigBelt}`],
    ['collision 트리거 부재 (STEP5 미적용)', pre.trigColl === 0, `${pre.trigColl}`],
    [`phantom ${PHANTOM} = oob-unreconciled 보존`, pre.phantom.length === 1 && pre.phantom[0].created_by === MARKER, pre.phCb],
    ['self-records(7/8/5) 미점유', pre.selfRecs.length === 0, `${pre.selfRecs.length}행 점유`],
    ['2999* dummy 부재', pre.dummy === 0, `${pre.dummy}`],
  ];
  let ok = true;
  console.log('\n──── GATE 판정 ────');
  for (const [n, pass, d] of gates) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${n}  (${d})`); ok = ok && pass; }
  if (!ok) {
    console.error('\n❌ apply-직전 GATE FAIL — drift/상태이상. 강제 apply 금지(fail-closed). supervisor 보고 필요.');
    console.error('   (freeze≠28 이면: 마이그 내장 freeze-abort 로 자동 전체 롤백 예정이나, 사전 GATE 에서 차단.)');
    process.exit(1);
  }
  console.log('\n✅ apply-직전 GATE PASS(조건①) — 단일세션 연속 apply 진입.');

  // ── STEP7′ (125000) ──
  await applyFile(F_STEP7, 'STEP7′ 20260810125000 class-a 재backfill(freeze=28 내장검증·ADDITIVE)');
  const p7 = await census('STEP7′ 직후');
  if (p7.nullc !== 0) { console.error(`\n❌ STEP7′ 후 NULL=${p7.nullc}≠0 — 예상 밖. 중단.`); process.exit(1); }
  if (!(p7.selfRecs.find(r => r.version === V_STEP7))) { console.error(`\n❌ STEP7′ self-record ${V_STEP7} 미착지. 중단.`); process.exit(1); }
  console.log('  → STEP7′ OK: NULL=0(28행 backfill) + self-record 125000 착지.');

  // ── STEP8 belt (130000) ──
  await applyFile(F_STEP8, 'STEP8 belt 20260810130000 apply-path stamp 트리거(ADDITIVE)');
  const p8 = await census('STEP8 직후');
  if (p8.trigBelt !== 1) { console.error(`\n❌ STEP8 후 belt 트리거 count=${p8.trigBelt}≠1. 중단.`); process.exit(1); }
  if (!(p8.selfRecs.find(r => r.version === V_STEP8))) { console.error(`\n❌ STEP8 self-record ${V_STEP8} 미착지. 중단.`); process.exit(1); }
  console.log('  → STEP8 OK: belt 트리거 활성 + self-record 130000 착지.');

  // ── GATE(조건②): STEP5 SET NOT NULL 은 belt 착지 + census NULL=0 재확인 후에만 ──
  console.log('\n──── STEP5 진입 GATE(조건②): belt 착지 ∧ NULL=0 재확인 ────');
  if (!(p8.trigBelt === 1 && p8.nullc === 0)) {
    console.error(`  ❌ GATE FAIL: belt=${p8.trigBelt}(기대1) NULL=${p8.nullc}(기대0). STEP5 진입 금지. 중단.`);
    process.exit(1);
  }
  console.log('  ✅ GATE PASS: belt 활성 ∧ NULL=0 — STEP5 진입.');

  // ── STEP5 (170003) NOT NULL + collision guard ──
  await applyFile(F_STEP5, 'STEP5 20260802170003 NOT NULL + collision fail-closed(B1+B5)');

  // ── post-apply introspection(조건④) ──
  const post = await census('post-apply 실측 (조건④)');
  const selfOk = SELF_RECORDS.every(v => {
    const r = post.selfRecs.find(x => x.version === v);
    return r && r.created_by && r.created_by.startsWith('dev-foot:') && r.ck_set;
  });
  const results = [
    ['created_by NULL = 0', post.nullc === 0, `${post.nullc}`],
    ['is_nullable = NO (STEP5 적용)', post.isNullable === 'NO', post.isNullable],
    ['belt 트리거 존재', post.trigBelt === 1, `${post.trigBelt}`],
    ['collision 트리거 존재 (2종 공존)', post.trigColl === 1, `${post.trigColl}`],
    [`phantom ${PHANTOM} = oob-unreconciled 무접촉 보존`, post.phantom.length === 1 && post.phantom[0].created_by === MARKER, post.phCb],
    ['self-record 3행 created_by=dev-foot:* ∧ checksum SET', selfOk, post.selfRecs.map(r=>`${r.version}[${r.ck_set?'ck':'-'}]`).join(',')],
    [`순소실0(total ${pre.total}→${pre.total + 3})`, post.total === pre.total + 3, `${pre.total}→${post.total}`],
  ];
  let allPass = true;
  console.log('\n──── post-apply 판정(조건④ report-back 항목) ────');
  for (const [n, pass, d] of results) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${n}  (${d})`); allPass = allPass && pass; }
  console.log(`\n[apply] ${allPass ? '✅ ALL PASS — 물리 apply 배치 성공. negtest(node ... negtest) 진행 → supervisor report-back.' : '❌ 판정 실패 — supervisor 보고 필요.'}`);
  process.exit(allPass ? 0 : 1);
}

if (stage === 'negtest') {
  const pre = await census('negtest 직전 baseline');
  for (const [tag, f] of [['AC4/AC5 (170003 NOT NULL + collision)', NEG_AC45], ['AC8 (STEP8 belt 통합)', NEG_AC8]]) {
    console.log(`\n──── NEGTEST ${tag}\n       (${f}) ────`);
    const sql = fs.readFileSync(f, 'utf8');
    try {
      await q(sql);
      console.log('  ✅ PASS: BEGIN..ROLLBACK 완주(어떤 assert 도 EXCEPTION 미발생 = 전 AC PASS). 무영속.');
    } catch (e) {
      console.error('  ❌ FAIL: negtest 중 assert EXCEPTION 발생(=AC 위반) 또는 실행오류:', e.message);
      process.exit(1);
    }
  }
  // ── No-Persistence post-probe ──
  const post = await census('negtest 직후 post-probe (무영속 검증)');
  const checks = [
    ['총 행 불변', post.total === pre.total, `${pre.total}→${post.total}`],
    ['NULL 불변(0)', post.nullc === pre.nullc && post.nullc === 0, `${pre.nullc}→${post.nullc}`],
    ['belt 트리거 불변(존재)', post.trigBelt === 1 && pre.trigBelt === 1, `${pre.trigBelt}→${post.trigBelt}`],
    ['collision 트리거 불변(존재)', post.trigColl === 1 && pre.trigColl === 1, `${pre.trigColl}→${post.trigColl}`],
    ['is_nullable 불변(NO)', post.isNullable === 'NO' && pre.isNullable === 'NO', `${pre.isNullable}→${post.isNullable}`],
    ['2999* dummy 무영속(0)', post.dummy === 0, `${pre.dummy}→${post.dummy}`],
  ];
  let ok = true;
  console.log('\n──── No-Persistence 검증 ────');
  for (const [n, pass, d] of checks) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${n}  (${d})`); ok = ok && pass; }
  console.log(`\n[negtest] ${ok ? '✅ AC4/AC5 + AC8 ALL PASS + 무영속 확인.' : '❌ 무영속 위반/판정 실패 — supervisor 보고 필요.'}`);
  process.exit(ok ? 0 : 1);
}

console.error('usage: node <script> census|apply|negtest');
process.exit(2);
