// T-20260820-foot-OPINIONDOC-DOCTORFIELD-LAYOUT-FIX — AC-2 실렌더 evidence
//   소견서(diag_opinion) 하단 서명표 '의 사 성 명'(진료의) 칸을, 서로 다른 이름 길이 2케이스로
//   실제 렌더 → 직인(도장) X좌표 + 이름 슬롯 좌표를 측정해 "텍스트만 바뀌고 위치/정렬 불변"을 실증.
//   OLD(종전 inline flow) 와 NEW(본 fix, flex 2슬롯) 를 나란히 대조한다.
//
//   실행: node evidence/OPINIONDOC-DOCTORFIELD-LAYOUT-FIX/render.mjs
//   산출: 콘솔 측정표 + old-*.png / new-*.png 스크린샷 + result.json
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 실제 템플릿 파일에서 DIAG_OPINION_HTML 의 하단 서명표(colgroup 고정 + 진료의 셀)를 그대로 반영한
// 최소 재현 마크업. 셀 폭(col4=35%)·seal 52px·flex 슬롯 규격은 htmlFormTemplates.ts 와 동일.
const SEAL = '<img id="seal" src="data:image/svg+xml;base64,' +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><circle cx="26" cy="26" r="24" fill="none" stroke="red" stroke-width="2"/><text x="26" y="31" font-size="10" text-anchor="middle" fill="red">인</text></svg>').toString('base64') +
  '" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" />';

const COMMON = `<style>
  * { box-sizing: border-box; margin:0; padding:0; }
  body { font-family:'Malgun Gothic',sans-serif; padding:16px; background:#fff; }
  table { width:190mm; border-collapse:collapse; table-layout:fixed; }
  td { border:1px solid #000; padding:3px 5px; vertical-align:middle; font-size:9pt; }
  td[style*="background:#f8f8f8"] { white-space:nowrap; font-size:8.5pt; text-align:center; }
  h3 { margin:12px 0 4px; font-size:12px; }
</style>`;

// 종전(OLD): inline flow — 이름+nbsp+직인
function oldCell(name) {
  return `<td id="valcell"><span id="name">${name}</span>&nbsp;&nbsp;${SEAL.replace('id="seal"','id="seal"')}</td>`;
}
// 신규(NEW, 본 fix): flex 2슬롯 — 이름(flex:1 중앙) + 직인(flex 0 0 56px 우측 고정)
function newCell(name) {
  return `<td id="valcell" style="vertical-align:middle;"><div style="display:flex; align-items:center; width:100%;"><span id="name" style="flex:1 1 auto; text-align:center; white-space:nowrap; overflow:hidden;">${name}</span><span style="flex:0 0 56px; text-align:center;">${SEAL}</span></div></td>`;
}

function page(cellFn, name) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">${COMMON}</head><body>
    <table><colgroup><col style="width:15%"/><col style="width:35%"/><col style="width:15%"/><col style="width:35%"/></colgroup><tbody>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">면 허 번 호</td>
        <td>제&nbsp;145617&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:center; white-space:nowrap;">의 사 성 명</td>
        ${cellFn(name)}
      </tr>
    </tbody></table>
  </body></html>`;
}

const CASES = [
  { key: 'short', name: '문지은' },        // 3자
  { key: 'long',  name: '황보라영선우' },  // 6자 (긴 이름)
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 300 }, deviceScaleFactor: 2 });

async function measure(variant, cellFn) {
  const out = {};
  for (const c of CASES) {
    const p = await ctx.newPage();
    await p.setContent(page(cellFn, c.name), { waitUntil: 'networkidle' });
    const valBox = await p.locator('#valcell').boundingBox();
    const sealBox = await p.locator('#seal').boundingBox();
    const nameBox = await p.locator('#name').boundingBox();
    out[c.key] = {
      name: c.name,
      valcell_left: +valBox.x.toFixed(2), valcell_width: +valBox.width.toFixed(2),
      seal_left: +sealBox.x.toFixed(2), seal_top: +sealBox.y.toFixed(2),
      name_left: +nameBox.x.toFixed(2), name_width: +nameBox.width.toFixed(2),
    };
    await p.screenshot({ path: join(__dirname, `${variant}-${c.key}.png`) });
    await p.close();
  }
  return out;
}

const oldRes = await measure('old', oldCell);
const newRes = await measure('new', newCell);
await browser.close();

function delta(res, field) { return +(Math.abs(res.short[field] - res.long[field])).toFixed(2); }

const report = {
  ticket: 'T-20260820-foot-OPINIONDOC-DOCTORFIELD-LAYOUT-FIX',
  metric: '진료의(의사 성명) 칸 — 직인 X좌표 / 이름 슬롯 좌표가 이름 길이에 불변인가',
  old: { ...oldRes, seal_left_delta: delta(oldRes, 'seal_left'), name_left_delta: delta(oldRes, 'name_left') },
  new: { ...newRes, seal_left_delta: delta(newRes, 'seal_left'), name_left_delta: delta(newRes, 'name_left') },
};
report.verdict_new_seal_stable = report.new.seal_left_delta === 0;
report.verdict_new_name_slot_stable = report.new.name_left_delta === 0;

writeFileSync(join(__dirname, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('\n[OLD inline] seal X 이동량(짧은↔긴 이름):', report.old.seal_left_delta, 'px  → 이름 길수록 직인 밀림');
console.log('[NEW flex ] seal X 이동량(짧은↔긴 이름):', report.new.seal_left_delta, 'px  → 0 이면 위치 고정(AC-1/AC-2 PASS)');
