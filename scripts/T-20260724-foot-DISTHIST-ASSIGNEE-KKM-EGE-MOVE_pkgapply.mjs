/**
 * T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE — AC9 잔존 정정 APPLY
 * packages.consultant_id 강경민 → NULL (pkg aa11252f, 김종민, 단일행)
 * 분기근거: AC8 probe = (b) NULL revert (결정적 링크 check_ins.package_id=pkg AND consultant_id=엄경은 = 0건).
 * DA-20260724-foot-PKG-CONSULTANT-ID-KKM-RESIDUE. ADDITIVE·no-DDL.
 * data_correction_backfill_sop: freeze(원값스냅샷) + 명시PK + 역UPDATE 롤백 + rows-affected==1 (cross_crm_write_rowcheck_standard).
 *
 * 기본 = DRY-RUN(write 0). 실적용은 `node ... --apply`.
 */
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const KKM = '6ab26d9f-fd10-4042-9fd7-076f277be5d4'; // 강경민 (원값, 제거 대상)
const EGE = 'b311593d-9e46-4ac8-9424-6b0fa1689a06'; // 엄경은 (참조)
const PKG_ID = 'aa11252f-bfc9-4b76-ba5c-ba9f821785b5'; // 명시 PK (probe 확정)
const KIMJONGMIN_CUST = '9669f2c4-a490-41f8-885b-dc89ca54b46b';
const TARGET = null; // (b) NULL revert

console.log(`=== MODE: ${APPLY ? '★ APPLY (write)' : 'DRY-RUN (write 0)'} ===`);

// STEP 1: freeze 재검증 — 명시 PK 단일행, 현재 consultant_id === 강경민 확인
const { data: cur, error: curErr } = await supabase.from('packages')
  .select('id, customer_id, consultant_id, status').eq('id', PKG_ID);
if (curErr) { console.log('freeze SELECT err:', curErr.message); process.exit(1); }
if (!cur || cur.length !== 1) { console.log(`★ ABORT: pkg 매칭 ${cur?.length ?? 0}건 ≠ 1`); process.exit(1); }
const pkg = cur[0];
console.log('[freeze] pkg:', pkg.id, 'customer:', pkg.customer_id, 'consultant_id:', pkg.consultant_id, 'status:', pkg.status);

if (pkg.customer_id !== KIMJONGMIN_CUST) { console.log('★ ABORT: customer_id 불일치(김종민 아님)'); process.exit(1); }
if (pkg.consultant_id !== KKM) {
  if (pkg.consultant_id === TARGET) { console.log('✓ 이미 NULL — 멱등 no-op. 정정 불필요.'); process.exit(0); }
  console.log(`★ ABORT: 현재 consultant_id(${pkg.consultant_id}) ≠ 강경민(freeze 기대값). 예상치 못한 상태 — planner FOLLOWUP.`);
  process.exit(1);
}

const FREEZE = { pkg_id: PKG_ID, customer_id: pkg.customer_id, from_consultant_id: KKM, from_name: '강경민', to_consultant_id: TARGET, to_name: 'NULL(revert)', status: pkg.status };
console.log('[freeze snapshot]', JSON.stringify(FREEZE));

// 역 UPDATE 롤백 SQL (freeze 원값 강경민 복원)
const ROLLBACK_SQL = `-- ROLLBACK: packages.consultant_id NULL → 강경민 복원 (freeze 원값)\nUPDATE packages SET consultant_id = '${KKM}', updated_at = now() WHERE id = '${PKG_ID}' AND consultant_id IS NULL;`;
console.log('\n[rollback SQL]\n' + ROLLBACK_SQL);

if (!APPLY) {
  console.log('\n=== DRY-RUN: 아래 UPDATE 를 수행할 예정 (write 0) ===');
  console.log(`UPDATE packages SET consultant_id = NULL WHERE id = '${PKG_ID}' AND consultant_id = '${KKM}';  -- 기대 rows-affected=1`);
  console.log('실적용: node scripts/T-20260724-foot-DISTHIST-ASSIGNEE-KKM-EGE-MOVE_pkgapply.mjs --apply');
  process.exit(0);
}

// STEP 2: 단일행 명시-PK UPDATE (멱등 guard: consultant_id = 강경민 일 때만)
const { data: updated, error: updErr } = await supabase.from('packages')
  .update({ consultant_id: TARGET })
  .eq('id', PKG_ID).eq('consultant_id', KKM)
  .select('id, consultant_id');
if (updErr) { console.log('★ UPDATE err:', updErr.message); process.exit(1); }

// STEP 3: rows-affected == 1 검증 (cross_crm_write_rowcheck_standard, 0-row+error=null 성공오인 금지)
const rowsAffected = (updated ?? []).length;
console.log(`\n[rowcheck] rows-affected = ${rowsAffected} (기대 1)`);
if (rowsAffected !== 1) { console.log('★ ABORT: rows-affected ≠ 1 — write 실패/silent 0-row 의심'); process.exit(1); }

// STEP 4: POSTCHECK — 재SELECT, consultant_id IS NULL 확증
const { data: post } = await supabase.from('packages')
  .select('id, consultant_id').eq('id', PKG_ID);
const postVal = post?.[0]?.consultant_id;
console.log('[postcheck] consultant_id =', postVal === null ? 'NULL ✓' : postVal + ' ★불일치');
if (postVal !== null) { console.log('★ POSTCHECK FAIL'); process.exit(1); }

console.log('\n✓ 정정 완료: packages.consultant_id 강경민 → NULL (pkg aa11252f, 김종민 F-4568). 단일행. 원장 무접점.');
