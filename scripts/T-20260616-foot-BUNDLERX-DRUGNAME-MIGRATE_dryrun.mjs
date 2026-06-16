/**
 * T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB — DRY-RUN (READ-ONLY, NO WRITE)
 *
 * 목적(apply 전 필수, supervisor 데이터게이트 입력):
 *   묶음처방(prescription_sets.items[])에 등장하는 "약 이름"을
 *   처방세트 카탈로그(prescription_codes) + 폴더트리(prescription_code_folders)로 이관할 때의 계획을 산출.
 *
 *   "약 이름만" = posology(dosage/route/frequency/days/notes) 이관 제외.
 *                 prescription_codes 항목(=약 1건) ↔ prescription_folders 폴더 매핑(prescription_code_folders)만 생성.
 *
 * 이관 규칙(per distinct drug):
 *   (A) items[].prescription_code_id 있음 → 해당 prescription_codes 항목을 폴더 배정 대상으로.
 *   (B) items[].prescription_code_id = null(자유텍스트) → name(name_ko) 정규화 매칭.
 *         매칭 1건 → 그 code 사용.
 *         매칭 0건 → 신규 prescription_codes 생성 필요 (apply 단계, claim_code='RXMIG-...').
 *         매칭 2건+ → 모호 → 첫 후보 사용(보고에 표기, 게이트에서 검토).
 *   폴더 배정: prescription_code_folders 에 이미 있으면 SKIP(dedup). 없으면 '이관약' 폴더 배정
 *             ('이관약' prescription_folders 없으면 신규 생성).
 *
 * *** 이 스크립트는 SELECT 만 수행. 어떤 write 도 하지 않는다. ***
 *   실행: node scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.mjs
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
// 표시용 정규화: trim + 연속공백 압축 (원형 유지)
const norm = (s) => (s == null ? '' : String(s).trim().replace(/\s+/g, ' '));
// §1-safe 조건2 매칭키: 위 + 대소문자 통일(lower)
const normKey = (s) => norm(s).toLowerCase();

const log = [];
const out = (s) => { console.log(s); log.push(s); };

(async () => {
  out('═══════════════════════════════════════════════════════════════');
  out('T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB — DRY-RUN (READ-ONLY)');
  out('실행시각: ' + new Date().toISOString());
  out('prod: rxlomoozakkjesdqjtvd');
  out('═══════════════════════════════════════════════════════════════');
  out('');

  // ── 1. 소스 로드 ──────────────────────────────────────────────
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

  // 인덱스
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const codesByName = new Map(); // normKey(name_ko) -> [codes]  (§1-safe 조건2: lower 정규화 매칭)
  for (const c of codes) {
    const k = normKey(c.name_ko);
    if (!codesByName.has(k)) codesByName.set(k, []);
    codesByName.get(k).push(c);
  }
  const assignedCodeIds = new Set(codeFolders.map((cf) => cf.prescription_code_id));
  const migrateFolder = folders.find((f) => norm(f.name) === MIGRATE_FOLDER_NAME);

  out('[0] 소스 현황');
  out(`    prescription_sets        = ${sets.length}`);
  out(`    prescription_codes       = ${codes.length}`);
  out(`    prescription_folders     = ${folders.length}`);
  out(`    prescription_code_folders= ${codeFolders.length} (이미 폴더배정된 약)`);
  out(`    '${MIGRATE_FOLDER_NAME}' 폴더 존재 = ${migrateFolder ? `예 (id=${migrateFolder.id})` : '아니오 → apply시 신규생성'}`);
  out('');

  // ── 2. 묶음처방 약 수집 (distinct) ────────────────────────────
  // 키: code_id 있으면 'cid:'+id, 없으면 'name:'+normKey(name)  (§1-safe 조건2)
  // sources: §1-safe 조건4 provenance — 약별 출처(prescription_set_id/name/item idx) 기록
  const drugs = new Map();
  let totalItems = 0;
  for (const s of sets) {
    arr(s.items).forEach((it, idx) => {
      totalItems++;
      const cid = it.prescription_code_id || null;
      const nm = norm(it.name);
      const key = cid ? `cid:${cid}` : `name:${normKey(it.name)}`;
      if (!drugs.has(key)) {
        drugs.set(key, { cid, name: nm, fromSets: new Set(), sources: [], hasCid: !!cid });
      }
      const d = drugs.get(key);
      d.fromSets.add(s.name);
      d.sources.push({ set_id: s.id, set_name: s.name, item_idx: idx });
    });
  }

  out('[1] 묶음처방 약 항목 수집');
  out(`    총 items 원소 = ${totalItems}`);
  out(`    distinct 약   = ${drugs.size}`);
  out('');

  // ── 3. 각 약 매칭/해소 ────────────────────────────────────────
  const plan = []; // { name, resolvedCodeId, status, note, fromSets }
  for (const [, d] of drugs) {
    let resolvedCodeId = null;
    let status, note = '';

    // §1-safe 조건3: 정규화 후 모호(동명 2건+)면 silent 신규생성·auto-pick·fuzzy 병합 금지
    //   → resolvedCodeId=null 유지, status=AMBIGUOUS(unmapped). 신규생성·폴더배정 안 함.
    if (d.hasCid) {
      const c = codeById.get(d.cid);
      if (c) {
        resolvedCodeId = c.id;          // 조건1: 기존 재사용
        status = 'LINKED';
        note = `code_id 직접연결 (name_ko="${c.name_ko}")`;
      } else {
        status = 'DANGLING_CID';
        note = `items.prescription_code_id=${d.cid} 가 prescription_codes 에 없음 → name 으로 폴백`;
        // 폴백: 정규화 이름 매칭
        const cands = codesByName.get(normKey(d.name)) || [];
        if (cands.length === 1) { resolvedCodeId = cands[0].id; status = 'NAME_MATCH(fallback)'; }
        else if (cands.length > 1) { status = 'AMBIGUOUS(fallback,unmapped)'; note += ` / 동명 ${cands.length}건 → 미배정(문지은 확인)`; }
        else { status = 'NEW_NEEDED(fallback)'; note += ' / 이름매칭 0 → 신규생성'; }
      }
    } else {
      if (!d.name) { status = 'EMPTY_NAME'; note = '약 이름 빈값 → 스킵'; }
      else {
        const cands = codesByName.get(normKey(d.name)) || [];
        if (cands.length === 1) { resolvedCodeId = cands[0].id; status = 'NAME_MATCH'; note = `name_ko 정규화 정확일치 (claim=${cands[0].claim_code})`; }
        else if (cands.length > 1) { status = 'AMBIGUOUS(unmapped)'; note = `동명 ${cands.length}건 → 자동해소 금지·미배정 (문지은 대표원장 확인 후 처리)`; }
        else { status = 'NEW_NEEDED'; note = '이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)'; }
      }
    }

    // 폴더 배정 판단
    let folderAction;
    if (status.startsWith('AMBIGUOUS')) {
      folderAction = 'SKIP(모호 unmapped)';     // 조건3: 미배정
    } else if (resolvedCodeId && assignedCodeIds.has(resolvedCodeId)) {
      folderAction = 'SKIP(이미 폴더배정)';
    } else if (status === 'EMPTY_NAME') {
      folderAction = 'SKIP(빈이름)';
    } else {
      folderAction = `ASSIGN→'${MIGRATE_FOLDER_NAME}'`;
    }

    plan.push({
      name: d.name || '(빈값)',
      resolvedCodeId,
      status,
      folderAction,
      note,
      fromSets: [...d.fromSets],
      sources: d.sources,   // §1-safe 조건4 provenance
    });
  }

  // ── 4. 집계 ───────────────────────────────────────────────────
  const cntStatus = {};
  for (const p of plan) cntStatus[p.status] = (cntStatus[p.status] || 0) + 1;

  const newNeeded = plan.filter((p) => p.status.startsWith('NEW_NEEDED'));
  const toAssign = plan.filter((p) => p.folderAction.startsWith('ASSIGN'));
  const toSkip = plan.filter((p) => p.folderAction.startsWith('SKIP'));
  const ambiguous = plan.filter((p) => p.status.includes('AMBIGUOUS'));
  const dangling = plan.filter((p) => p.status === 'DANGLING_CID' || p.status.includes('fallback'));

  out('[2] 약 해소 상태 분포');
  for (const [k, v] of Object.entries(cntStatus).sort((a, b) => b[1] - a[1])) {
    out(`    ${k.padEnd(24)} : ${v}`);
  }
  out('');
  out('[3] apply 영향 요약');
  out(`    신규 prescription_codes 생성 필요 = ${newNeeded.length}`);
  out(`    폴더 배정(prescription_code_folders insert) = ${toAssign.length}`);
  out(`    SKIP(이미 배정/빈이름)            = ${toSkip.length}`);
  out(`    모호(동명 다건)                   = ${ambiguous.length}`);
  out(`    code_id dangling/폴백             = ${dangling.length}`);
  out(`    '${MIGRATE_FOLDER_NAME}' 폴더 신규생성 = ${migrateFolder ? '불요(존재)' : '필요(1건)'}`);
  out('');

  out('[4] 신규 생성 약 목록 (이름매칭 0 → prescription_codes INSERT 대상)');
  if (newNeeded.length === 0) out('    (없음)');
  newNeeded.forEach((p, i) => out(`    ${i + 1}. "${p.name}"  ← 출처세트: [${p.fromSets.join(', ')}]`));
  out('');

  out('[5] 모호(동명 2건+) UNMAPPED — §1-safe 조건3 (자동해소 금지, 문지은 대표원장 확인 대상)');
  if (ambiguous.length === 0) out('    (없음) → 추가 confirm 불요');
  ambiguous.forEach((p, i) => out(`    ${i + 1}. "${p.name}"  ${p.note}`));
  out('');

  out('[6] 전체 이관 계획 (약별)');
  out('    ─────────────────────────────────────────────────────────');
  plan
    .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name))
    .forEach((p, i) => {
      const cid = p.resolvedCodeId ? p.resolvedCodeId.slice(0, 8) : '——none——';
      out(`    ${String(i + 1).padStart(2)}. [${p.status}] "${p.name}"`);
      out(`        code=${cid} | ${p.folderAction} | ${p.note}`);
    });
  out('');

  out('═══════════════════════════════════════════════════════════════');
  out('게이트 판단 입력:');
  out(`  · prescription_codes INSERT  : ${newNeeded.length}건 (claim_code='RXMIG-<seq>')`);
  out(`  · prescription_folders INSERT: ${migrateFolder ? 0 : 1}건 ('${MIGRATE_FOLDER_NAME}')`);
  out(`  · prescription_code_folders INSERT: ${toAssign.length}건`);
  out('  · 묶음처방 탭/데이터/FE: 무변경 (이 마이그는 prescription_sets 를 읽기만 함)');
  out('  · posology(dosage/route/frequency/days/notes): 이관 안 함 (약 이름만)');
  out('═══════════════════════════════════════════════════════════════');

  // evidence
  const dir = join(REPO, 'db-gate');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.md');
  writeFileSync(f, '```\n' + log.join('\n') + '\n```\n', 'utf8');
  console.log(`\n📄 evidence → ${f}`);

  // 머신리더블 카운트 (apply 게이트 EXPECT 고정용)
  const counts = {
    sets: sets.length,
    distinct_drugs: drugs.size,
    new_codes: newNeeded.length,
    folder_assign: toAssign.length,
    skip: toSkip.length,
    ambiguous: ambiguous.length,   // §1-safe 조건3: >0 이면 apply 게이트 fail-closed
    unmapped: ambiguous.length,    // 모호=unmapped (문지은 확인 대상)
    migrate_folder_exists: !!migrateFolder,
  };
  writeFileSync(join(dir, 'T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.json'), JSON.stringify(counts, null, 2));
  console.log('EXPECT=' + JSON.stringify(counts));

  // §1-safe 조건4 provenance 산출물: 약별 출처(prescription_set_id/name/item idx) + 해소경로 (스키마 변경 없이 감사기록)
  const provenance = plan
    .filter((p) => p.status !== 'EMPTY_NAME')
    .map((p) => ({
      drug_name: p.name,
      status: p.status,
      resolved_code_id: p.resolvedCodeId,
      new_claim_code: p.status.startsWith('NEW_NEEDED')
        ? 'RXMIG-(md5 12)'
        : null,
      folder_action: p.folderAction,
      sources: p.sources, // [{set_id, set_name, item_idx}]
    }));
  writeFileSync(
    join(dir, 'T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_provenance.json'),
    JSON.stringify({ generated: new Date().toISOString(), note: '§1-safe 조건4: 이관 약별 출처(prescription_set_id/item idx) — posology 미이관·값 날조 없음', drugs: provenance }, null, 2),
  );
  console.log('📄 provenance → db-gate/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_provenance.json');
})().catch((e) => {
  console.error('❌ DRY-RUN 실패:', e.message);
  process.exit(1);
});
