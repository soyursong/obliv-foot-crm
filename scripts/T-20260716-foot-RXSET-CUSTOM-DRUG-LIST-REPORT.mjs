/**
 * T-20260716-foot-RXSET-CUSTOM-DRUG-LIST-REPORT — 자체(비공식) 등록약 목록 조회 리포트 (READ-ONLY, NO WRITE)
 *
 * 총괄 김주연 지시(slack C0ATE5P6JTH ts 1780810527.570069):
 *   "됐어 그냥 인증된 공식약 말고 정리해줘"
 *   → 자체약 19종 HIRA 공식매핑 배치 중단(부모 T-20260617 hold) + 잔여 '자체(비공식)' 등록약만
 *     카테고리·이름 순으로 정리해 목록 산출.
 *
 * 판별 정본:
 *   - 자체(비공식) = prescription_codes.code_source = 'custom'
 *     (T-20260607-foot-PROCMENU-RX-UNIFY '자체' 배지 정의 / T-20260615-foot-RXSET-DRUGSOURCE-SVCRX 출처 판별)
 *   - 공식 인증(보험 연결 완료) = code_source = 'official' → 본 목록에서 제외.
 *
 * FLUNACOEM 순서 의존성(진행 노트):
 *   T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY 적용 시, 플루나코엠캡슐 custom row 는
 *   hard-delete 되지 않고 code_source='custom' 유지 + hira_match_basis='DEPRECATED→official:...'
 *   마킹 + 폴더 참조가 신규 official(HIRA-201403310)로 이동됨(배지 소멸).
 *   → 본 리포트는 (a) DEPRECATED 마킹 custom 을 '활성 자체약' 목록에서 제외하고,
 *     (b) 결과에 "FLUNACOEM apply 반영 O/X" 상태를 명시한다.
 *
 * *** SELECT 만 수행. 어떤 write(DML/DDL) 도 하지 않는다. ***
 *   (AC4: write/DDL 발생 시 즉시 중단·보고 — 본 스크립트는 write 경로 자체가 없음.)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
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

const DEPRECATED_PREFIX = 'DEPRECATED→official';
const FLUNACOEM_OFFICIAL_CLAIM = 'HIRA-201403310'; // FLUNACOEM apply 로 생성되는 official row

// 한국어 카테고리·이름 정렬 비교자
const koCmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ko');

async function main() {
  const runAt = new Date().toISOString();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260716-foot-RXSET-CUSTOM-DRUG-LIST-REPORT — 자체(비공식) 등록약 목록 (READ-ONLY)');
  console.log('실행:', runAt);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 전체 prescription_codes 로드 (SELECT only) ──
  const { data: all, error: e1 } = await sb.from('prescription_codes').select('*');
  if (e1) { console.error('LOAD prescription_codes ERROR:', e1.message); process.exit(1); }

  const cols = all.length ? Object.keys(all[0]) : [];
  const hasProvenance = cols.includes('hira_match_basis');

  // ── code_source 분포 ──
  const dist = {};
  for (const r of all) {
    const k = r.code_source == null ? '∅(NULL)' : r.code_source;
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log('[분포] prescription_codes code_source (total=' + all.length + ')');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(16)} : ${v}`);
  }
  console.log('');

  // ── 자체(custom) 모집단 ──
  const customAll = all.filter((r) => r.code_source === 'custom');

  // FLUNACOEM apply(및 여타 deprecate) 판별: hira_match_basis 가 DEPRECATED 마킹이면 폐기된 자체약
  const isDeprecated = (r) =>
    hasProvenance && typeof r.hira_match_basis === 'string' && r.hira_match_basis.startsWith(DEPRECATED_PREFIX);

  const customActive = customAll.filter((r) => !isDeprecated(r));
  const customDeprecated = customAll.filter((r) => isDeprecated(r));

  // ── FLUNACOEM apply 반영 상태 판정 ──
  const flunacoemCustom = customAll.find(
    (r) => typeof r.name_ko === 'string' && r.name_ko.includes('플루나코엠'),
  );
  const flunacoemOfficialExists = all.some(
    (r) => r.code_source === 'official' && r.claim_code === FLUNACOEM_OFFICIAL_CLAIM,
  );
  const flunacoemDeprecated = flunacoemCustom ? isDeprecated(flunacoemCustom) : false;
  // 반영 O = official 생성됨 + custom 이 deprecate 마킹됨(=자체 배지 소멸)
  const flunacoemApplied = flunacoemOfficialExists && flunacoemDeprecated;

  console.log('[FLUNACOEM apply 반영 상태]');
  console.log(`    플루나코엠 custom row 존재 : ${flunacoemCustom ? 'O (' + flunacoemCustom.name_ko + ')' : 'X'}`);
  console.log(`    official(${FLUNACOEM_OFFICIAL_CLAIM}) 생성 : ${flunacoemOfficialExists ? 'O' : 'X'}`);
  console.log(`    custom deprecate 마킹     : ${flunacoemDeprecated ? 'O' : 'X'}`);
  console.log(`    → FLUNACOEM apply 반영     : ${flunacoemApplied ? 'O (플루나코엠은 목록에서 제외됨)' : 'X (미적용 — 플루나코엠이 아래 목록에 포함될 수 있음)'}`);
  console.log('');

  // ── 폴더(카테고리 배지) 멤버십 lookup ──
  const folderByCode = new Map(); // code_id -> [folder names]
  let folderNameById = new Map();
  const { data: folders } = await sb.from('prescription_folders').select('id,name');
  if (folders) folderNameById = new Map(folders.map((f) => [f.id, f.name]));
  const { data: folderLinks } = await sb
    .from('prescription_code_folders')
    .select('prescription_code_id,folder_id');
  for (const link of folderLinks ?? []) {
    const arr = folderByCode.get(link.prescription_code_id) || [];
    arr.push(folderNameById.get(link.folder_id) ?? link.folder_id);
    folderByCode.set(link.prescription_code_id, arr);
  }

  // ── 카테고리 → 이름 순 정렬 (AC2) ──
  //   카테고리 = classification (없으면 '(미분류)'), tiebreak = name_ko
  const catOf = (r) => (r.classification && String(r.classification).trim()) || '(미분류)';
  const sorted = [...customActive].sort((a, b) => koCmp(catOf(a), catOf(b)) || koCmp(a.name_ko, b.name_ko));

  // ── 목록 출력 (AC1: 자체만 / AC2: 카테고리·이름 / AC3: 총건수) ──
  console.log('═══ 자체(비공식) 등록약 목록 — 카테고리 → 이름 순 ═══');
  console.log(`총 ${sorted.length}종 (활성 자체약; deprecate/FLUNACOEM 반영분 ${customDeprecated.length}종 제외)\n`);

  let lastCat = null;
  const listForJson = [];
  sorted.forEach((r, i) => {
    const cat = catOf(r);
    if (cat !== lastCat) { console.log(`\n■ [${cat}]`); lastCat = cat; }
    const folderBadges = folderByCode.get(r.id);
    const created = r.created_at ? String(r.created_at).slice(0, 10) : '-';
    console.log(
      `   ${String(i + 1).padStart(2)}. ${r.name_ko}` +
        `  (청구코드=${r.claim_code ?? '-'}` +
        (r.manufacturer ? ` / 제조=${r.manufacturer}` : '') +
        (folderBadges ? ` / 폴더=${folderBadges.join(',')}` : '') +
        ` / 등록일=${created})`,
    );
    listForJson.push({
      seq: i + 1,
      category: cat,
      name_ko: r.name_ko,
      claim_code: r.claim_code ?? null,
      manufacturer: r.manufacturer ?? null,
      classification: r.classification ?? null,
      code_type: r.code_type ?? null,
      folders: folderByCode.get(r.id) ?? [],
      created_at: r.created_at ?? null,
      id: r.id,
    });
  });

  // ── 카테고리별 소계 ──
  const byCat = {};
  for (const r of sorted) { const c = catOf(r); byCat[c] = (byCat[c] || 0) + 1; }
  console.log('\n═══ 카테고리별 소계 ═══');
  for (const [c, n] of Object.entries(byCat).sort((a, b) => koCmp(a[0], b[0]))) {
    console.log(`    ${c.padEnd(14)} : ${n}종`);
  }

  // ── 제외된 deprecate 자체약(참고) ──
  if (customDeprecated.length) {
    console.log('\n═══ (참고) deprecate/공식 승격된 자체약 — 목록 제외 ═══');
    customDeprecated.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.name_ko} (claim=${r.claim_code ?? '-'}, basis=${String(r.hira_match_basis).slice(0, 60)}…)`);
    });
  }

  console.log('\n═══ 요약 ═══');
  console.log(`  자체(비공식) 활성 등록약 = ${sorted.length}종`);
  console.log(`  FLUNACOEM apply 반영 = ${flunacoemApplied ? 'O' : 'X'}`);
  console.log(`  공식(official) = ${dist['official'] ?? 0}종 (목록 제외)`);
  console.log('═══════════════════════════════════════════════════════════');

  // ── 결과 JSON 산출(responder 전달용, evidence) ──
  const out = {
    ticket: 'T-20260716-foot-RXSET-CUSTOM-DRUG-LIST-REPORT',
    run_at: runAt,
    read_only: true,
    total_custom_active: sorted.length,
    total_custom_deprecated_excluded: customDeprecated.length,
    total_official_excluded: dist['official'] ?? 0,
    flunacoem_apply_reflected: flunacoemApplied,
    flunacoem_detail: {
      custom_row_present: !!flunacoemCustom,
      official_created: flunacoemOfficialExists,
      custom_deprecated: flunacoemDeprecated,
    },
    category_subtotals: byCat,
    drugs: listForJson,
  };
  const outPath = new URL('../evidence/T-20260716-foot-RXSET-CUSTOM-DRUG-LIST-REPORT_result.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('\n결과 JSON 저장:', outPath.pathname);
}

main().catch((e) => { console.error(e); process.exit(1); });
