/**
 * T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY — provenance DDL 원장 forward-doc (mig version collision FIX)
 *
 * FIX-REQUEST (supervisor MSG-20260718-060550-h8t3, NO_GO: mig_version_collision):
 *   커밋 d7abc5a1 의 provenance DDL 파일 버전 20260716140000 이 origin/main
 *   20260716140000_foot_dopamine_reschedule_emit 와 충돌. DDL 파일 rename → 20260716140100
 *   (DML 20260716140500 보다 앞 정렬 유지). 그에 맞춰 원장(schema_migrations)도 정합 기록.
 *
 * ── 무접촉 원칙 (fix step2) ──
 *   PROD 데이터 재적용/롤백 금지. provenance 4컬럼·official row·custom deprecate·folder-move 는
 *   이미 정확 적용·supervisor 검증 완료. 본 스크립트는 DDL 을 재실행하지 않고(recordLedger 경유)
 *   원장에 20260716140100 = rxset_hira_provenance_columns 만 idempotent forward-doc 한다.
 *   prod 실재 = provenance 4컬럼 존재(사전 probe 확인) → 원장이 이 실재를 정합 반영.
 *
 * 사용:
 *   node scripts/T-...MAP-APPLY_ledger_forwarddoc.mjs           # dry-run (pre-check만, 기본)
 *   node scripts/T-...MAP-APPLY_ledger_forwarddoc.mjs --apply   # 원장 forward-doc + post-check
 *
 * author: dev-foot / 2026-07-18
 */
import { query, recordLedger, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260716140100';
const NAME = 'rxset_hira_provenance_columns';
const COLLISION_VER = '20260716140000'; // dopamine 이 점유 (건드리지 않음)
const DML_VER = '20260716140500';       // 이미 정상 등재 (유지)
const PROV_COLS = ['hira_verified_at', 'hira_match_basis', 'hira_mapped_to_code_id', 'hira_verified_by'];

async function probe(label) {
  const led = await ledgerVersions();
  const rows = await query(`SELECT version, name FROM supabase_migrations.schema_migrations
    WHERE version IN ('${COLLISION_VER}','${VERSION}','${DML_VER}') ORDER BY version;`);
  const cols = await query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='prescription_codes'
      AND column_name IN (${PROV_COLS.map((c) => `'${c}'`).join(',')}) ORDER BY column_name;`);
  console.log(`\n== ${label} 원장/실재 ==`);
  console.log('원장행수:', led.size);
  for (const r of rows) console.log(`  ledger ${r.version} = ${r.name}`);
  console.log('  target', VERSION, '=>', led.has(VERSION) ? 'PRESENT' : 'ABSENT');
  console.log('  prod provenance 컬럼:', cols.map((c) => c.column_name).join(', '), `(count=${cols.length})`);
  return { led, rows, colCount: cols.length };
}

console.log(`── RXSET provenance 원장 forward-doc (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);

const pre = await probe('PRE');

// 안전 가드: prod 실재(4컬럼) 확인 + 충돌슬롯이 dopamine 소유인지 재확인
if (pre.colCount !== 4) {
  console.error(`\nABORT: prod provenance 컬럼 ${pre.colCount}/4 — prod 실재 불일치. forward-doc 중단.`);
  process.exit(1);
}
const collisionRow = pre.rows.find((r) => r.version === COLLISION_VER);
if (!collisionRow || collisionRow.name !== 'foot_dopamine_reschedule_emit') {
  console.error(`\nABORT: 충돌슬롯 ${COLLISION_VER} 소유자 예상(foot_dopamine_reschedule_emit) 불일치 → ${collisionRow?.name}. 중단.`);
  process.exit(1);
}

if (!APPLY) {
  const plan = await recordLedger({ version: VERSION, name: NAME, createdBy: 'T-20260716-RXSET-FLUNACOEM-MAP-APPLY-mig-collision-fix', dryRun: true });
  console.log('\n[dry-run] --apply 미지정 → 원장 write 없음. 계획 SQL:\n' + plan.sql);
  process.exit(0);
}

// 원장 forward-doc (idempotent, ON CONFLICT DO NOTHING). DDL 재실행 없음.
const r = await recordLedger({ version: VERSION, name: NAME, createdBy: 'T-20260716-RXSET-FLUNACOEM-MAP-APPLY-mig-collision-fix', dryRun: false });
console.log(`\n✓ 원장 forward-doc: ${r.version} = ${r.name}`);

const post = await probe('POST');
const ok = post.led.has(VERSION) && post.colCount === 4
  && post.rows.find((x) => x.version === DML_VER)?.name === 'rxset_flunacoem_map_apply'
  && post.rows.find((x) => x.version === COLLISION_VER)?.name === 'foot_dopamine_reschedule_emit';
console.log(`\nPOSTCHECK RESULT: ${ok ? 'PASS — 원장 20260716140100 등재, DML 140500 유지, dopamine 140000 무접촉, prod 4컬럼 실재' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
