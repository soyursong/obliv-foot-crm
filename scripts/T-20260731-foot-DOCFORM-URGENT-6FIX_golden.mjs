// T-20260731-foot-DOCFORM-URGENT-6FIX 골든 스냅샷 대조 (READ-ONLY, DB 무접점)
// baseline(기본 origin/main) vs 현재(htmlFormTemplates.ts) 18종 서류 raw 템플릿 diff.
// 사용: node scripts/T-20260731-foot-DOCFORM-URGENT-6FIX_golden.mjs [baseline-ref]
import esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASELINE = process.argv[2] || 'origin/main';
const ORIGIN_TMP = 'src/lib/_htmlFormTemplates.origin.ts';
// 상대 import(./formTemplates)가 풀리도록 src/lib/ 에 baseline 스냅샷을 임시 생성.
fs.writeFileSync(ORIGIN_TMP, execSync(`git show ${BASELINE}:src/lib/htmlFormTemplates.ts`));
process.on('exit', () => { try { fs.unlinkSync(ORIGIN_TMP); } catch {} });

const KEYS = [
  'koh_result','diagnosis','treat_confirm','treat_confirm_code','treat_confirm_nocode',
  'visit_confirm','diag_opinion','bill_detail','payment_cert','referral_letter',
  'medical_record_request','diag_opinion_v2','rx_standard','bill_receipt',
  'bill_receipt_new','ins_claim_form','first_visit_mgmt_record',
];

async function render(entry) {
  const out = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node',
    loader: { '.png': 'text', '.jpg': 'text', '.jpeg': 'text', '.svg': 'text', '.webp': 'text' },
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const res = {};
  for (const k of KEYS) res[k] = mod.getHtmlTemplate(k);
  return res;
}

const before = await render('src/lib/_htmlFormTemplates.origin.ts');
const after = await render('src/lib/htmlFormTemplates.ts');

let changed = 0, same = 0;
for (const k of KEYS) {
  if (before[k] === after[k]) { same++; console.log(`  =  ${k}  (비트 동일)`); continue; }
  changed++;
  // 차이 라인 요약
  const b = (before[k] || '').split('\n'), a = (after[k] || '').split('\n');
  const bSet = new Set(b), aSet = new Set(a);
  const added = a.filter(l => !bSet.has(l));
  const removed = b.filter(l => !aSet.has(l));
  console.log(`  ≠  ${k}  (+${added.length} / -${removed.length} 라인)`);
}
console.log(`\n총 ${KEYS.length}종 | 변경 ${changed} | 비트동일 ${same}`);
