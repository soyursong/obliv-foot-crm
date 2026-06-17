/**
 * T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — Step1+Step2 선행 감사 (READ-ONLY, NO WRITE)
 *
 * 목적:
 *  Step1 (식별):
 *   (1) prescription_codes 의 code_source 분포 — '자체' 배지 = code_source='custom' 모집단 확정
 *   (2) custom 19종 전체 컬럼 덤프(name_ko / claim_code / classification / ingredient_code /
 *       manufacturer / code_type / standard_drug_code / prescription_code_id 등 존재 컬럼 전부)
 *   (3) 처방세트(prescription_sets.items) 에 실제 등록된 custom code id 와 대조 → 화면 노출 모집단 일치 확인
 *   (4) BUNDLE-MERGE folder='약' 단독약 세트 모집단과 19종 동일 여부 대조
 *  Step2 (HIRA 대조 — 내부 prescription_codes official 모집단 기준):
 *   (5) 각 custom 약을 official(code_source='official') 약과 매칭:
 *        A. ingredient_code exact (주성분코드 일치) = 자동(고신뢰)
 *        B. name_ko normalized exact = 자동(이름 완전일치)
 *        C. name_ko 부분포함(후보 다수) = 수동 매핑 필요
 *        D. 후보 0 = 매칭 불가(외부 HIRA 소스 필요 가능)
 *   → 매핑표(약이름 / 현 custom코드 / 후보 HIRA코드 / 분류) 산출
 *
 * *** SELECT 만 수행. 어떤 write 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 이름 정규화: 공백/괄호/제형단위 노이즈 제거 후 비교 (보수적 — 과매칭 방지 위해 원문도 병기)
const norm = (s) =>
  (s == null ? '' : String(s))
    .toLowerCase()
    .replace(/[\s()[\]{}.,/·∙・]/g, '')
    .replace(/(정|캡슐|캅셀|시럽|주|연고|크림|패치|산|환|액|밀리그람|mg|밀리그램|g|ml|㎎|㎖)/g, '')
    .trim();

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — Step1+2 감사 (READ-ONLY)');
  console.log('실행시각:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── code_source 분포 ──
  const { data: all, error: e1 } = await sb
    .from('prescription_codes')
    .select('*');
  if (e1) {
    console.error('LOAD prescription_codes ERROR:', e1.message);
    process.exit(1);
  }
  const dist = {};
  for (const r of all) {
    const k = r.code_source == null ? '∅(NULL)' : r.code_source;
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log('[1] prescription_codes code_source 분포 (total=' + all.length + ')');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(16)} : ${v}`);
  }
  console.log('');

  // 존재 컬럼 목록(첫 행 키)
  const cols = all.length ? Object.keys(all[0]) : [];
  console.log('[1b] prescription_codes 컬럼: ' + cols.join(', '));
  console.log('    (standard_drug_code 존재? ' + cols.includes('standard_drug_code') + ' / prescription_code_id 존재? ' + cols.includes('prescription_code_id') + ')\n');

  const custom = all.filter((r) => r.code_source === 'custom');
  const official = all.filter((r) => r.code_source === 'official');
  console.log(`[2] '자체'(custom) 모집단 = ${custom.length}종  (기대=19)  / official 모집단 = ${official.length}\n`);

  // 처방세트 등록 약 대조
  const { data: sets } = await sb.from('prescription_sets').select('id,name,items,folder');
  const registeredIds = new Set();
  const singleDrugFolder = []; // folder='약' 단독약 세트
  for (const s of sets ?? []) {
    const items = Array.isArray(s.items) ? s.items : [];
    for (const it of items) if (it?.prescription_code_id != null) registeredIds.add(`${it.prescription_code_id}`);
    if (items.length === 1 && s.folder === '약') singleDrugFolder.push(s);
  }
  const customRegistered = custom.filter((c) => registeredIds.has(`${c.id}`));
  console.log(`[3] 처방세트 items 에 등록된 custom = ${customRegistered.length} / ${custom.length}`);
  console.log(`    (화면 노출 모집단 = 처방세트 등록분. 미등록 custom 은 화면 미표시)\n`);
  console.log(`[4] BUNDLE-MERGE folder='약' 단독약 세트 = ${singleDrugFolder.length}건 (19종 동일여부 대조용)\n`);

  // official 인덱스 구축
  const byIngredient = new Map();
  const byName = new Map();
  for (const o of official) {
    if (o.ingredient_code) {
      const arr = byIngredient.get(o.ingredient_code) || [];
      arr.push(o);
      byIngredient.set(o.ingredient_code, arr);
    }
    const nk = norm(o.name_ko);
    if (nk) {
      const arr = byName.get(nk) || [];
      arr.push(o);
      byName.set(nk, arr);
    }
  }

  // ── Step2 매핑표 ──
  console.log('═══ [5] HIRA(내부 official) 매핑표 ═══');
  console.log('분류: A=주성분코드일치(자동) B=이름완전일치(자동) C=후보다수(수동) D=후보0(불가)\n');
  const result = { A: [], B: [], C: [], D: [] };
  for (const c of custom) {
    let cls, cands = [];
    // A. ingredient_code exact
    if (c.ingredient_code && byIngredient.has(c.ingredient_code)) {
      cls = 'A';
      cands = byIngredient.get(c.ingredient_code);
    } else {
      const nk = norm(c.name_ko);
      const exact = byName.get(nk) || [];
      if (exact.length >= 1) {
        cls = 'B';
        cands = exact;
      } else {
        // C. 부분 포함 검색
        const partial = official.filter((o) => {
          const on = norm(o.name_ko);
          return nk && on && (on.includes(nk) || nk.includes(on));
        });
        if (partial.length >= 1) {
          cls = 'C';
          cands = partial.slice(0, 5);
        } else {
          cls = 'D';
          cands = [];
        }
      }
    }
    result[cls].push({ c, cands });
  }

  for (const cls of ['A', 'B', 'C', 'D']) {
    const label = { A: '자동(주성분코드)', B: '자동(이름완전일치)', C: '수동(후보다수)', D: '불가(후보0)' }[cls];
    console.log(`\n── [${cls}] ${label} : ${result[cls].length}종 ──`);
    result[cls].forEach(({ c, cands }, i) => {
      const reg = registeredIds.has(`${c.id}`) ? '★등록' : '·미등록';
      console.log(`  ${i + 1}. "${c.name_ko}" (id=${c.id}, claim=${c.claim_code ?? '-'}, ingr=${c.ingredient_code ?? '-'}, ${reg})`);
      cands.forEach((o) => {
        console.log(`       → HIRA후보: "${o.name_ko}" (id=${o.id}, claim=${o.claim_code ?? '-'}, ingr=${o.ingredient_code ?? '-'}, mfr=${o.manufacturer ?? '-'})`);
      });
    });
  }

  console.log('\n═══ 요약 ═══');
  console.log(`  custom(자체) 총 ${custom.length}종`);
  console.log(`  A 자동(주성분) ${result.A.length} / B 자동(이름) ${result.B.length} / C 수동 ${result.C.length} / D 불가 ${result.D.length}`);
  const autoTotal = result.A.length + result.B.length;
  console.log(`  → 자동확정 후보 = ${autoTotal}종 / 수동 = ${result.C.length}종 / 불가 = ${result.D.length}종`);
  console.log(`  결정포인트#1(HIRA소스): official 모집단 ${official.length}건 내부 보유 → ` +
    (result.D.length === 0 ? '전량 내부 매칭 가능(외부 불요)' : `${result.D.length}종 내부 매칭 불가 → 외부 HIRA 소스 필요여부 보고`));
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
