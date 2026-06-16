#!/usr/bin/env node
/**
 * T-20260616-foot-ACTIONBTN-MONOTONE-UNIFY
 * action/CTA 필드 teal 버튼만 line-targeted 로 neutral charcoal 치환.
 * selected-state/today/badge/role-chip/segmented-toggle 라인은 제외(의미색·상태표시 = RECOLOR warm 유지).
 */
import fs from 'node:fs';

// file -> 1-based line numbers (CONVERT = 진짜 action/CTA 버튼만)
const TARGETS = {
  'src/components/HealthQResultsPanel.tsx': [314],
  'src/components/doctor/DrugFolderTree.tsx': [147],
  'src/components/doctor/KohReportTab.tsx': [746, 950],
  'src/components/doctor/OpinionDocTab.tsx': [601],
  'src/components/admin/ProgressPlansTab.tsx': [324, 345, 632],
  'src/components/DutyRosterImportDialog.tsx': [438],
  'src/components/MedicalChartPanel.tsx': [1387, 2088, 2288, 2339, 3630, 4223],
  'src/components/AdminLayout.tsx': [70],
  'src/components/medical/DiagnosisFolderPicker.tsx': [607],
  'src/components/CheckInDetailSheet.tsx': [1719],
  'src/pages/Dashboard.tsx': [2900, 2928],
  'src/pages/CustomerChartPage.tsx': [1304, 1351, 1463, 1731, 6274, 6807, 7135, 7251, 7284, 7315, 8900],
  'src/pages/ClinicSettings.tsx': [420, 462],
  'src/pages/Staff.tsx': [896, 1251],
};

// 순서 중요: 구체적(hover/active/file/border) 먼저, 마지막에 bare bg-teal
const RULES = [
  [/hover:bg-teal-700/g, 'hover:bg-neutral-900'],
  [/hover:bg-teal-600/g, 'hover:bg-neutral-900'],
  [/active:bg-teal-800/g, 'active:bg-neutral-900'],
  [/hover:file:bg-teal-700/g, 'hover:file:bg-neutral-900'],
  [/file:bg-teal-600/g, 'file:bg-neutral-800'],
  [/border-teal-(400|500|600)/g, 'border-neutral-700'],
  [/bg-teal-600/g, 'bg-neutral-800'],
  [/bg-teal-500/g, 'bg-neutral-800'],
];

let total = 0;
for (const [file, lines] of Object.entries(TARGETS)) {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  for (const ln of lines) {
    const i = ln - 1;
    const before = src[i];
    if (before === undefined) { console.error(`!! ${file}:${ln} out of range`); continue; }
    let after = before;
    for (const [re, rep] of RULES) after = after.replace(re, rep);
    if (after !== before) {
      src[i] = after;
      total++;
      console.log(`OK ${file}:${ln}`);
    } else {
      console.error(`-- ${file}:${ln} NO teal match -> ${before.trim().slice(0, 70)}`);
    }
  }
  fs.writeFileSync(file, src.join('\n'));
}
console.log(`\n${total} lines converted.`);
