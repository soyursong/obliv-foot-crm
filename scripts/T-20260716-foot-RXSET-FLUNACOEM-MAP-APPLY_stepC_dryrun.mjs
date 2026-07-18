/**
 * T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY — Step C dry-run COUNT + 스냅샷 (READ-ONLY, NO WRITE)
 *
 * §C 게이트: 적용 전 dry-run COUNT(기대 = 1행 reference-move) + 적용 전 스냅샷.
 *   - 대상 custom 이 1건 초과면 abort 신호(EXPECT 불일치) → supervisor 적용 금지.
 *   - 신규 official claim_code(HIRA-201403310) 충돌 0 확인.
 *   - 나머지 자체약 18종 무접촉(폴더 참조 유지) 확인.
 *   - 스냅샷(custom row + 폴더 membership + 18종 목록)을 db-gate/*_snapshot.json 으로 저장(롤백 근거).
 *
 * *** SELECT 만. 어떤 write 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const env = Object.fromEntries(
  readFileSync(join(REPO, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const LEGACY = 'LEGACY-015b55130567';
const NEW_CLAIM = 'HIRA-201403310';
const log = [];
const out = (s) => { console.log(s); log.push(s); };

async function main() {
  out('# T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY — Step C dry-run (READ-ONLY)');
  out(`- prod: rxlomoozakkjesdqjtvd | ${new Date().toISOString()}`);
  out('');

  // 1) 대상 custom count (기대=1)
  const { data: target } = await sb.from('prescription_codes').select('*')
    .eq('claim_code', LEGACY).eq('code_source', 'custom');
  const targetCnt = target?.length ?? 0;

  // 2) 신규 official claim_code 충돌 (기대=0)
  const { data: conflict } = await sb.from('prescription_codes').select('id').eq('claim_code', NEW_CLAIM);
  const conflictCnt = conflict?.length ?? 0;

  // 3) 폴더 membership (기대=1)
  const customId = target?.[0]?.id ?? null;
  const { data: folder } = customId
    ? await sb.from('prescription_code_folders').select('*').eq('prescription_code_id', customId)
    : { data: [] };
  const folderCnt = folder?.length ?? 0;

  // 4) 나머지 자체약(custom) 목록 + 폴더참조 — 무접촉 확인 (기대 custom 총 19, 그 외 18 유지)
  const { data: allCustom } = await sb.from('prescription_codes').select('id,name_ko,claim_code').eq('code_source', 'custom');
  const otherCustom = (allCustom ?? []).filter((r) => r.claim_code !== LEGACY);
  const { data: allFolders } = await sb.from('prescription_code_folders').select('prescription_code_id');
  const folderSet = new Set((allFolders ?? []).map((r) => r.prescription_code_id));
  const otherCustomInFolder = otherCustom.filter((r) => folderSet.has(r.id)).length;

  const EXPECT = {
    target_custom: 1,             // 대상 custom = 1건
    claim_conflict: 0,            // HIRA-201403310 충돌 0
    folder_move: 1,               // reference-move 폴더행 = 1
    total_custom: 19,             // 자체약 총 19종(부모 모집단)
    other_custom_untouched: 18,   // 나머지 18종 무접촉
  };
  const ACTUAL = {
    target_custom: targetCnt,
    claim_conflict: conflictCnt,
    folder_move: folderCnt,
    total_custom: allCustom?.length ?? 0,
    other_custom_untouched: otherCustom.length,
    other_custom_in_folder: otherCustomInFolder,
  };

  out('## dry-run COUNT');
  out('```');
  out('EXPECT: ' + JSON.stringify(EXPECT));
  out('ACTUAL: ' + JSON.stringify(ACTUAL));
  out('```');

  const pass =
    ACTUAL.target_custom === EXPECT.target_custom &&
    ACTUAL.claim_conflict === EXPECT.claim_conflict &&
    ACTUAL.folder_move === EXPECT.folder_move &&
    ACTUAL.total_custom === EXPECT.total_custom &&
    ACTUAL.other_custom_untouched === EXPECT.other_custom_untouched;

  out('');
  out(`## 게이트 판정: ${pass ? 'PASS ✅ (적용 GO 조건 충족 — 단, supervisor DML 게이트 필수)' : 'FAIL ❌ (EXPECT 불일치 → 적용 금지·abort)'}`);
  if (ACTUAL.target_custom > 1) out('  ⚠ 대상 1건 초과 — 오확산 위험, 즉시 abort.');

  // 5) 스냅샷 저장(롤백 근거)
  const snapshot = {
    ticket: 'T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY',
    captured_at: new Date().toISOString(),
    case: 'Case2 (official 미등재 → 신규 official ADDITIVE + reference-move + custom deprecate)',
    custom_row_before: target?.[0] ?? null,
    folder_membership_before: folder?.[0] ?? null,
    new_official_claim_code: NEW_CLAIM,
    expect: EXPECT,
    actual: ACTUAL,
    gate_pass: pass,
    other_custom_18: otherCustom.map((r) => ({ name_ko: r.name_ko, claim_code: r.claim_code })),
  };
  const snapPath = join(REPO, 'db-gate', 'T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY_snapshot.json');
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2) + '\n');
  out('');
  out('📄 snapshot → ' + snapPath);

  const evidPath = join(REPO, 'db-gate', 'T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY_dryrun_evidence.md');
  writeFileSync(evidPath, log.join('\n') + '\n');
  console.log('📄 evidence → ' + evidPath);

  process.exit(pass ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
