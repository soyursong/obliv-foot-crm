/**
 * T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT — STEP6 18행 2-class 재센서스 [READ-ONLY]
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 인가 = planner NEW-TASK MSG-20260810-104328-ihkj (DA CONSULT-REPLY 92d3 재-scoped 시퀀스 ①).
 * 목적 = 08-10 fresh prod created_by NULL 재센서스 → 2-class 분류 + 20260606160000(6월행) provenance 규명.
 * ★READ-ONLY: SELECT/introspection 전용. write/DDL 코드경로 부재(fail-safe).
 *
 * class 판정 (DA 봉투):
 *   class-a = named·14자리·정상 마이그(파일 대응 存 or CLI 미기록 legacy) → STEP7 재backfill 대상(ADDITIVE)
 *   class-b = naked phantom(statements NULL + 파일 부재 + 자작러너 stomp 시그니처) → blanket 금지·개별 reconcile
 *
 * 실행: node scripts/..._step6_recensus_readonly.mjs
 */
import fs from 'fs';
import { execSync } from 'child_process';

const REF = 'rxlomoozakkjesdqjtvd';
const readEnv = (f, k) => { if (!fs.existsSync(f)) return null; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(new RegExp('^' + k + '=(.*)$')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } return null; };
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || readEnv('.env.local', 'SUPABASE_ACCESS_TOKEN');
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미설정'); process.exit(2); }

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (r.status !== 200 && r.status !== 201) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

// working tree + 전 git history 에 해당 version prefix 마이그 파일 존재하는지 (커밋대조)
function fileEvidence(version) {
  let wt = [];
  try { wt = fs.readdirSync('supabase/migrations').filter(f => f.startsWith(version) && f.endsWith('.sql') && !/rollback|dryrun|negtest/.test(f)); } catch {}
  let git = '';
  try { git = execSync(`git log --all --oneline --name-only -- 'supabase/migrations/${version}*' 2>/dev/null | head -20`, { encoding: 'utf8' }).trim(); } catch {}
  return { workingTree: wt, gitHistory: git };
}

(async () => {
  console.log('════════ STEP6 재센서스 (READ-ONLY, fresh prod ' + REF + ') ════════');
  const total = (await q(`SELECT count(*)::int c FROM supabase_migrations.schema_migrations`))[0].c;
  const isNullable = (await q(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='created_by'`))[0].is_nullable;
  const hasCkCol = (await q(`SELECT count(*)::int c FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='content_checksum'`))[0].c === 1;
  const trig = (await q(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='trg_foot_schema_migrations_collision_guard' AND NOT tgisinternal`))[0].c;

  // NULL 행 전체 지문
  const rows = await q(`
    SELECT version,
           name,
           (statements IS NULL) stmt_null,
           coalesce(array_length(statements,1),0) stmt_len,
           ${hasCkCol ? 'content_checksum' : 'NULL::text content_checksum'},
           length(version) vlen,
           (version ~ '^[0-9]{14}$') v14
    FROM supabase_migrations.schema_migrations
    WHERE created_by IS NULL
    ORDER BY version`);

  console.log(`\n총 행: ${total}  |  created_by NULL: ${rows.length}  |  NON-NULL: ${total - rows.length}`);
  console.log(`created_by is_nullable: ${isNullable} (STEP5 미적용 기대=YES) | content_checksum 컬럼: ${hasCkCol ? '존재' : '부재'} | collision-guard 트리거: ${trig ? '존재' : '부재'}`);

  let classA = 0, classB = 0;
  const detail = [];
  console.log('\n──────── NULL 행별 2-class 판정 ────────');
  for (const r of rows) {
    const ev = fileEvidence(r.version);
    const hasFile = ev.workingTree.length > 0;
    const hasGit = ev.gitHistory.length > 0;
    // class-b(naked phantom) = 파일 부재(wt+git 둘 다) AND statements NULL AND name 공란
    const nameEmpty = !r.name || r.name.trim() === '';
    const nakedPhantom = !hasFile && !hasGit && r.stmt_null && nameEmpty;
    const klass = nakedPhantom ? 'B(naked phantom)' : 'A(legacy/named)';
    if (nakedPhantom) classB++; else classA++;
    const month = r.version.slice(0, 6);
    detail.push({ version: r.version, month, name: r.name, v14: r.v14, stmt_null: r.stmt_null, stmt_len: r.stmt_len, checksum: r.content_checksum, hasFile, hasGit, klass });
    console.log(`  ${r.version} [${klass}] v14=${r.v14} stmt_null=${r.stmt_null}(len=${r.stmt_len}) name=${JSON.stringify(r.name)} file=${hasFile?'WT✓':'✗'}/${hasGit?'git✓':'✗'} ck=${r.content_checksum===null?'NULL':'SET'}`);
  }
  console.log(`\n2-class 카운트: class-a=${classA}  class-b=${classB}  (합계 ${rows.length})`);

  // 월별 분포
  const byMonth = {};
  for (const d of detail) byMonth[d.month] = (byMonth[d.month] || 0) + 1;
  console.log('월별 분포:', JSON.stringify(byMonth));

  // ★20260606160000(6월 회귀행) 집중 규명
  console.log('\n──────── ⚠ 20260606160000 (6월 회귀 의심행) 집중 규명 ────────');
  const june = detail.find(d => d.version === '20260606160000');
  if (!june) {
    console.log('  prod NULL 집합에 20260606160000 부재 (created_by 이미 SET 이거나 원장 부재)');
    const j = await q(`SELECT version, created_by, name, (statements IS NULL) stmt_null FROM supabase_migrations.schema_migrations WHERE version='20260606160000'`);
    console.log('  원장 실재:', JSON.stringify(j));
  } else {
    console.log('  판정:', june.klass);
    console.log('  name:', JSON.stringify(june.name), '| stmt_null:', june.stmt_null, '| v14:', june.v14, '| checksum:', june.checksum);
    const ev = fileEvidence('20260606160000');
    console.log('  working tree 파일:', JSON.stringify(ev.workingTree));
    console.log('  git history:\n' + (ev.gitHistory ? ev.gitHistory.split('\n').map(l => '    ' + l).join('\n') : '    (전 브랜치 대응 파일 無)'));
  }

  // 인접 6월 마이그 존재 여부(정상 6월 마이그 사이 phantom 인지 판별)
  console.log('\n──────── 6월(202606) 원장행 맥락 ────────');
  const juneRows = await q(`SELECT version, (created_by IS NULL) is_null, name FROM supabase_migrations.schema_migrations WHERE version LIKE '202606%' ORDER BY version`);
  console.log(`  6월 원장행 ${juneRows.length}개: ` + juneRows.map(r => `${r.version}${r.is_null?'(NULL)':''}`).join(', '));

  console.log('\n════════ 재센서스 완료 (무write 확인) ════════');
})();
