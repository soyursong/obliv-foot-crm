/**
 * T-20260617 batch16 — 적용 후 검증 (READ-ONLY). supervisor 가 PROD apply 후 실행.
 * 기대 종단상태: 신규 official 13 / 대상 custom 16 deprecate / 폴더에 대상 custom 참조 0 / 폴더에 official 13(각 1회) / 무접촉 3 유지.
 * *** SELECT 만. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OFFICIALS, CUSTOMS, CLAIM } from './T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_batch16_mapping.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const env = Object.fromEntries(
  readFileSync(join(REPO, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FOLDER = 'ed3ae609-a2db-4871-ac41-cbe2ddb653e6';
let fail = 0;
const ok = (b, m) => { console.log(`  ${b ? '✅' : '❌'} ${m}`); if (!b) fail++; };

async function main() {
  console.log('# batch16 적용 후 검증 (READ-ONLY) — ' + new Date().toISOString());

  const newClaims = OFFICIALS.map(CLAIM);
  const { data: offs } = await sb.from('prescription_codes').select('id,claim_code,name_ko,code_source,insurance_status').in('claim_code', newClaims);
  const offRows = (offs ?? []).filter((r) => r.code_source === 'official');
  ok(offRows.length === 13, `신규 official 13건 존재 (실제 ${offRows.length})`);
  ok(offRows.every((r) => r.insurance_status === null), '신규 official insurance_status 전건 NULL (급여여부 미확정, 오청구 방지)');

  const legacies = CUSTOMS.map((c) => c.legacy);
  const { data: cust } = await sb.from('prescription_codes').select('id,claim_code,code_source,hira_mapped_to_code_id').in('claim_code', legacies);
  const custRows = (cust ?? []).filter((r) => r.code_source === 'custom');
  ok(custRows.length === 16, `대상 custom 16건 존속(hard-delete 안 됨, 실제 ${custRows.length})`);
  ok(custRows.every((r) => r.hira_mapped_to_code_id !== null), '대상 custom 16건 전부 deprecate(hira_mapped_to_code_id NOT NULL)');
  ok(custRows.every((r) => /^LEGACY-/.test(r.claim_code)), '대상 custom claim_code 여전히 LEGACY- (in-place 교체 안 됨)');

  // 폴더 상태
  const { data: folders } = await sb.from('prescription_code_folders').select('prescription_code_id').eq('folder_id', FOLDER);
  const inFolder = new Set((folders ?? []).map((r) => r.prescription_code_id));
  const custInFolder = custRows.filter((r) => inFolder.has(r.id)).length;
  ok(custInFolder === 0, `폴더에 대상 custom(자체) 참조 0 (배지 제거, 실제 ${custInFolder})`);
  const offInFolder = offRows.filter((r) => inFolder.has(r.id)).length;
  ok(offInFolder === 13, `폴더에 신규 official 13건 노출 (실제 ${offInFolder})`);
  // dedup: official 당 폴더 membership 정확히 1
  const folderCntByOff = {};
  for (const r of folders ?? []) folderCntByOff[r.prescription_code_id] = (folderCntByOff[r.prescription_code_id] ?? 0) + 1;
  const dupOff = offRows.filter((r) => (folderCntByOff[r.id] ?? 0) > 1);
  ok(dupOff.length === 0, `dedup: official 중복 folder membership 0 (실제 ${dupOff.length})`);

  // 무접촉 3종
  const { data: allCustom } = await sb.from('prescription_codes').select('claim_code,hira_mapped_to_code_id').eq('code_source', 'custom');
  const untouched = (allCustom ?? []).filter((r) => !legacies.includes(r.claim_code));
  const daewoong = untouched.find((r) => r.claim_code === 'LEGACY-12d7730e32e8');
  const ogument = untouched.find((r) => r.claim_code === 'LEGACY-f859925fdba2');
  ok(!!daewoong && daewoong.hira_mapped_to_code_id === null, '대웅푸루나졸(LEGACY-12d7730e32e8) 무접촉(deprecate 안 됨)');
  ok(!!ogument && ogument.hira_mapped_to_code_id === null, '오구멘토(LEGACY-f859925fdba2) 무접촉(BLOCKER 제외)');

  console.log('\n' + (fail === 0 ? '## ✅ 적용 후 검증 전건 PASS' : `## ❌ ${fail}건 FAIL`));
  process.exit(fail === 0 ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
