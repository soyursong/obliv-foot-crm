/**
 * T-20260616-foot-RXSET-BUNDLE-MIGRATE-PURGE — DRY-RUN (READ-ONLY, NO WRITE/DELETE)
 *
 * 옵션B (문지은 대표원장 재요청, 옵션A folder='약' 그룹핑 폐기):
 *   처방세트(prescription_sets) → 처방세트 카탈로그(prescription_codes) + 폴더트리로 이관 후
 *   prescription_sets 테이블 전체 DELETE(완전 삭제).
 *
 * ⚠️ 이 스크립트는 SELECT 만 한다. 어떤 write/DELETE 도 하지 않는다.
 *    apply 패키지(마이그/DELETE/rollback/FE)는 게이트 통과 후 별도 NEW-TASK.
 *
 * 감사 항목(planner FOLLOWUP 보고용):
 *   1. prescription_sets 총 세트 수 + items 펼친 총 약품 수
 *   2. items[] prescription_code_id 有(매칭가능) vs null(자유텍스트, 신규생성 후보) 분포
 *   3. null 약품 이름이 prescription_codes 에 동일/유사 존재 여부 → 매칭가능 vs 신규생성필요 추정
 *   4. 이관 후 prescription_code_folders 배정 대상(기존폴더 vs '이관약' 신규폴더)
 *   5. quick_rx_buttons.prescription_set_id 참조 건수 — DELETE 시 CASCADE 삭제될 빠른처방 버튼 수 (★핵심)
 *
 * 실행: node scripts/T-20260616-foot-RXSET-BUNDLE-MIGRATE-PURGE_dryrun.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const env = Object.fromEntries(
  readFileSync(join(REPO, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MIGRATE_FOLDER_NAME = '이관약';
const arr = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => (s == null ? '' : String(s).trim().replace(/\s+/g, ' '));
// 유사매칭(공백·괄호·용량표기 제거 후 비교) — null 약품 매칭 추정 보조
const loose = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[()[\]{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/\d+(\.\d+)?(mg|mcg|g|ml|정|캡슐|tab|cap)?/gi, '');

const log = [];
const out = (s) => { console.log(s); log.push(s); };

(async () => {
  out('═══════════════════════════════════════════════════════════════');
  out('T-20260616-foot-RXSET-BUNDLE-MIGRATE-PURGE — DRY-RUN (READ-ONLY)');
  out('옵션B: 처방세트 이관 + prescription_sets 완전삭제 영향범위 감사');
  out('실행시각: ' + new Date().toISOString());
  out('prod: rxlomoozakkjesdqjtvd');
  out('═══════════════════════════════════════════════════════════════');
  out('');

  // ── 소스 로드 ───────────────────────────────────────────────────
  const { data: sets, error: e1 } = await sb
    .from('prescription_sets')
    .select('id, name, items, folder, is_active')
    .order('name');
  if (e1) throw new Error('prescription_sets load: ' + e1.message);

  const { data: codes, error: e2 } = await sb
    .from('prescription_codes')
    .select('id, claim_code, name_ko, classification');
  if (e2) throw new Error('prescription_codes load: ' + e2.message);

  const { data: codeFolders, error: e3 } = await sb
    .from('prescription_code_folders')
    .select('prescription_code_id, folder_id');
  if (e3) throw new Error('prescription_code_folders load: ' + e3.message);

  const { data: folders, error: e4 } = await sb
    .from('prescription_folders')
    .select('id, name, parent_id');
  if (e4) throw new Error('prescription_folders load: ' + e4.message);

  const { data: qrb, error: e5 } = await sb
    .from('quick_rx_buttons')
    .select('id, name, prescription_set_id, is_active, clinic_id');
  if (e5) throw new Error('quick_rx_buttons load: ' + e5.message);

  // 인덱스
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const codesByName = new Map(); // norm(name_ko) -> [codes]
  const codesByLoose = new Map(); // loose(name_ko) -> [codes]
  for (const c of codes) {
    const k = norm(c.name_ko);
    if (!codesByName.has(k)) codesByName.set(k, []);
    codesByName.get(k).push(c);
    const lk = loose(c.name_ko);
    if (lk) {
      if (!codesByLoose.has(lk)) codesByLoose.set(lk, []);
      codesByLoose.get(lk).push(c);
    }
  }
  const assignedCodeIds = new Set(codeFolders.map((cf) => cf.prescription_code_id));
  const migrateFolder = folders.find((f) => norm(f.name) === MIGRATE_FOLDER_NAME);
  const setById = new Map(sets.map((s) => [s.id, s]));

  out('[0] 소스 현황');
  out(`    prescription_sets         = ${sets.length}`);
  out(`    prescription_codes        = ${codes.length}`);
  out(`    prescription_folders      = ${folders.length}`);
  out(`    prescription_code_folders = ${codeFolders.length} (이미 폴더배정된 약)`);
  out(`    quick_rx_buttons          = ${qrb.length}`);
  out(`    '${MIGRATE_FOLDER_NAME}' 폴더 존재 = ${migrateFolder ? `예 (id=${migrateFolder.id})` : '아니오 → apply시 신규생성'}`);
  out('');

  // ════════════════════════════════════════════════════════════════
  // [감사1] 세트 수 + items 펼친 총 약품 수
  // ════════════════════════════════════════════════════════════════
  let totalItems = 0;
  let singleItem = 0;
  let multiItem = 0;
  for (const s of sets) {
    const n = arr(s.items).length;
    totalItems += n;
    if (n === 1) singleItem++;
    else if (n > 1) multiItem++;
  }
  out('[감사1] 세트/약품 총량');
  out(`    총 세트 수            = ${sets.length}`);
  out(`    items 펼친 총 약품 수 = ${totalItems}`);
  out(`    └ 단일약 세트(items=1) = ${singleItem}`);
  out(`    └ 다종약 세트(items>1) = ${multiItem}`);
  out(`    └ 빈 세트(items=0)     = ${sets.length - singleItem - multiItem}`);
  out('');

  // ════════════════════════════════════════════════════════════════
  // [감사2] items[] code_id 有 vs null 분포 (raw item 기준)
  // ════════════════════════════════════════════════════════════════
  let itemHasCid = 0;
  let itemNullCid = 0;
  let itemEmptyName = 0;
  for (const s of sets) {
    for (const it of arr(s.items)) {
      if (!norm(it.name)) itemEmptyName++;
      if (it.prescription_code_id) itemHasCid++;
      else itemNullCid++;
    }
  }
  out('[감사2] items[] prescription_code_id 분포 (raw 원소 기준)');
  out(`    code_id 有 (기존 매칭가능)        = ${itemHasCid}`);
  out(`    code_id null (자유텍스트, 신규후보) = ${itemNullCid}`);
  out(`    └ 그중 약 이름 빈값               = ${itemEmptyName}`);
  out('');

  // ── distinct 약 수집 (cid 우선, 없으면 name 키) ─────────────────
  const drugs = new Map();
  for (const s of sets) {
    for (const it of arr(s.items)) {
      const cid = it.prescription_code_id || null;
      const nm = norm(it.name);
      const key = cid ? `cid:${cid}` : `name:${nm}`;
      if (!drugs.has(key)) drugs.set(key, { cid, name: nm, fromSets: new Set(), hasCid: !!cid });
      drugs.get(key).fromSets.add(s.name);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // [감사3] null 약품 이름 ↔ prescription_codes 매칭 추정 (distinct 기준)
  // ════════════════════════════════════════════════════════════════
  const plan = [];
  for (const [, d] of drugs) {
    let resolvedCodeId = null;
    let status, note = '', matchType = '';

    if (d.hasCid) {
      const c = codeById.get(d.cid);
      if (c) { resolvedCodeId = c.id; status = 'LINKED'; matchType = 'cid'; note = `code_id 직접연결 (name_ko="${c.name_ko}")`; }
      else {
        status = 'DANGLING_CID'; note = `cid=${d.cid} 가 카탈로그에 없음 → name 폴백`;
        const cands = codesByName.get(d.name) || [];
        if (cands.length === 1) { resolvedCodeId = cands[0].id; status = 'NAME_MATCH(fallback)'; matchType = 'exact'; }
        else if (cands.length > 1) { resolvedCodeId = cands[0].id; status = 'NAME_AMBIGUOUS(fallback)'; matchType = 'exact-multi'; note += ` / 동명 ${cands.length}`; }
        else {
          const lc = codesByLoose.get(loose(d.name)) || [];
          if (lc.length >= 1) { resolvedCodeId = lc[0].id; status = 'LOOSE_MATCH(fallback)'; matchType = 'loose'; note += ` / 유사매칭 ${lc.length}(${lc[0].claim_code})`; }
          else { status = 'NEW_NEEDED(fallback)'; matchType = 'none'; note += ' / 매칭0 → 신규'; }
        }
      }
    } else if (!d.name) {
      status = 'EMPTY_NAME'; matchType = 'skip'; note = '약 이름 빈값 → 스킵';
    } else {
      const cands = codesByName.get(d.name) || [];
      if (cands.length === 1) { resolvedCodeId = cands[0].id; status = 'NAME_MATCH'; matchType = 'exact'; note = `정확일치 (${cands[0].claim_code})`; }
      else if (cands.length > 1) { resolvedCodeId = cands[0].id; status = 'NAME_AMBIGUOUS'; matchType = 'exact-multi'; note = `동명 ${cands.length} → 첫후보(${cands[0].claim_code})`; }
      else {
        const lc = codesByLoose.get(loose(d.name)) || [];
        if (lc.length >= 1) { resolvedCodeId = lc[0].id; status = 'LOOSE_MATCH'; matchType = 'loose'; note = `유사매칭 ${lc.length}건 (${lc[0].claim_code} "${lc[0].name_ko}") → 게이트 검토`; }
        else { status = 'NEW_NEEDED'; matchType = 'none'; note = '동일/유사 매칭0 → 신규 prescription_codes 생성 (claim=RXMIG-*)'; }
      }
    }

    // 폴더 배정 판단
    let folderAction;
    if (resolvedCodeId && assignedCodeIds.has(resolvedCodeId)) folderAction = 'SKIP(이미배정)';
    else if (status === 'EMPTY_NAME') folderAction = 'SKIP(빈이름)';
    else folderAction = `ASSIGN→'${MIGRATE_FOLDER_NAME}'`;

    plan.push({ name: d.name || '(빈값)', resolvedCodeId, status, matchType, folderAction, note, fromSets: [...d.fromSets] });
  }

  const cntStatus = {};
  for (const p of plan) cntStatus[p.status] = (cntStatus[p.status] || 0) + 1;
  const exactMatch = plan.filter((p) => p.matchType === 'exact' || p.matchType === 'exact-multi');
  const looseMatch = plan.filter((p) => p.matchType === 'loose');
  const newNeeded = plan.filter((p) => p.status.startsWith('NEW_NEEDED'));
  const ambiguous = plan.filter((p) => p.status.includes('AMBIGUOUS'));

  out('[감사3] distinct 약 매칭 추정');
  out(`    distinct 약(cid/이름 기준) = ${drugs.size}`);
  for (const [k, v] of Object.entries(cntStatus).sort((a, b) => b[1] - a[1])) out(`    ${k.padEnd(26)} : ${v}`);
  out('');
  out(`    ⇒ 매칭가능(기존 code 재사용) = ${drugs.size - newNeeded.length}`);
  out(`       └ cid 직접연결            = ${plan.filter((p) => p.matchType === 'cid').length}`);
  out(`       └ 이름 정확일치           = ${exactMatch.length}`);
  out(`       └ 유사일치(게이트검토)    = ${looseMatch.length}`);
  out(`    ⇒ 신규생성 필요              = ${newNeeded.length}`);
  out('');
  if (newNeeded.length) {
    out('    [신규생성 대상 약 목록]');
    newNeeded.forEach((p, i) => out(`      ${i + 1}. "${p.name}"  ← 세트:[${p.fromSets.join(', ')}]`));
    out('');
  }
  if (looseMatch.length) {
    out('    [유사매칭 — 게이트 수동검토 권장]');
    looseMatch.forEach((p, i) => out(`      ${i + 1}. "${p.name}"  ${p.note}`));
    out('');
  }

  // ════════════════════════════════════════════════════════════════
  // [감사4] 이관 후 prescription_code_folders 배정 대상
  // ════════════════════════════════════════════════════════════════
  const toAssign = plan.filter((p) => p.folderAction.startsWith('ASSIGN'));
  const toSkipAssigned = plan.filter((p) => p.folderAction === 'SKIP(이미배정)');
  out('[감사4] prescription_code_folders 배정 대상');
  out(`    이미 기존폴더 배정됨(무접촉)    = ${toSkipAssigned.length}`);
  out(`    '${MIGRATE_FOLDER_NAME}' 신규폴더 배정 대상 = ${toAssign.length}`);
  out(`    '${MIGRATE_FOLDER_NAME}' 폴더 신규생성 여부  = ${migrateFolder ? '불요(이미존재)' : '필요(1건)'}`);
  out('');

  // ════════════════════════════════════════════════════════════════
  // [감사5] ★ quick_rx_buttons.prescription_set_id CASCADE 영향
  // ════════════════════════════════════════════════════════════════
  const qrbWithSet = qrb.filter((b) => b.prescription_set_id != null);
  const qrbNullSet = qrb.filter((b) => b.prescription_set_id == null);
  const qrbActive = qrbWithSet.filter((b) => b.is_active);
  const qrbDangling = qrbWithSet.filter((b) => !setById.has(b.prescription_set_id));
  // 어느 세트들이 버튼에 참조되는가
  const referencedSetIds = new Set(qrbWithSet.map((b) => b.prescription_set_id));

  out('[감사5] ★ quick_rx_buttons CASCADE 삭제 영향 (prescription_sets DELETE 시)');
  out(`    quick_rx_buttons 총 행                  = ${qrb.length}`);
  out(`    prescription_set_id 참조 있음           = ${qrbWithSet.length}  ← DELETE 시 전부 CASCADE 삭제`);
  out(`    └ 그중 활성(is_active=true)             = ${qrbActive.length}  ← 현장 화면 노출 버튼`);
  out(`    prescription_set_id null (참조없음)     = ${qrbNullSet.length}`);
  out(`    이미 dangling(세트 부재)                = ${qrbDangling.length}`);
  out(`    참조되는 distinct 세트 수               = ${referencedSetIds.size} / ${sets.length}`);
  out('');
  if (qrbWithSet.length) {
    out('    [CASCADE 삭제될 빠른처방 버튼 목록]');
    qrbWithSet
      .sort((a, b) => Number(b.is_active) - Number(a.is_active))
      .forEach((b, i) => {
        const s = setById.get(b.prescription_set_id);
        out(`      ${String(i + 1).padStart(2)}. "${b.name}" [${b.is_active ? '활성' : '비활성'}] → set#${b.prescription_set_id} ${s ? `"${s.name}"` : '(세트부재·dangling)'}`);
      });
    out('');
  }
  out('    ⚠️ 옵션B는 prescription_sets 를 DELETE → 위 버튼이 FK CASCADE 로 동반 삭제됨.');
  out('       현장 빠른처방 버튼 보존 필요 시: (a) DELETE 전 버튼 재배선(다른 모델로) 또는');
  out('       (b) 버튼 기능 자체 폐기 결정 → reporter confirm + CEO 파괴게이트 핵심 수치.');
  out('');

  // ════════════════════════════════════════════════════════════════
  // 게이트 요약
  // ════════════════════════════════════════════════════════════════
  out('═══════════════════════════════════════════════════════════════');
  out('게이트 판단 입력 요약 (reporter confirm + CEO 파괴게이트):');
  out(`  · 삭제될 prescription_sets 행            : ${sets.length}`);
  out(`  · 펼친 약품(items 원소)                  : ${totalItems}`);
  out(`  · 이관 시 신규 prescription_codes INSERT : ${newNeeded.length}`);
  out(`  · prescription_code_folders 배정 INSERT  : ${toAssign.length} ('${MIGRATE_FOLDER_NAME}' 폴더)`);
  out(`  · '${MIGRATE_FOLDER_NAME}' 폴더 신규생성       : ${migrateFolder ? 0 : 1}건`);
  out(`  · ★ CASCADE 삭제 quick_rx_buttons        : ${qrbWithSet.length} (활성 ${qrbActive.length})`);
  out(`  · 유사매칭 게이트검토 약                 : ${looseMatch.length}`);
  out(`  · 동명 모호 약                           : ${ambiguous.length}`);
  out('═══════════════════════════════════════════════════════════════');

  // evidence
  const dir = join(REPO, 'db-gate');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'T-20260616-foot-RXSET-BUNDLE-MIGRATE-PURGE_dryrun.md');
  writeFileSync(f, '```\n' + log.join('\n') + '\n```\n', 'utf8');
  console.log(`\n📄 evidence → ${f}`);

  const counts = {
    sets: sets.length,
    total_items: totalItems,
    single_item_sets: singleItem,
    multi_item_sets: multiItem,
    item_has_cid: itemHasCid,
    item_null_cid: itemNullCid,
    distinct_drugs: drugs.size,
    matchable: drugs.size - newNeeded.length,
    new_codes_needed: newNeeded.length,
    loose_match: looseMatch.length,
    ambiguous: ambiguous.length,
    folder_assign: toAssign.length,
    migrate_folder_exists: !!migrateFolder,
    qrb_total: qrb.length,
    qrb_cascade_delete: qrbWithSet.length,
    qrb_cascade_active: qrbActive.length,
    qrb_referenced_sets: referencedSetIds.size,
  };
  writeFileSync(join(dir, 'T-20260616-foot-RXSET-BUNDLE-MIGRATE-PURGE_dryrun.json'), JSON.stringify(counts, null, 2));
  console.log('EXPECT=' + JSON.stringify(counts));
})().catch((e) => {
  console.error('❌ DRY-RUN 실패:', e.message);
  process.exit(1);
});
