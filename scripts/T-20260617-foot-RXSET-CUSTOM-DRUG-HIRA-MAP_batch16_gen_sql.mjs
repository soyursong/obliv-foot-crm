/**
 * T-20260617 batch16 — apply.sql + rollback.sql 결정론 생성기 (16종 손전사 오류 방지)
 * 매핑 SSOT = _batch16_mapping.mjs. 실행: node scripts/..._batch16_gen_sql.mjs
 * 산출: supabase/migrations/20260718160000_rxset_custom_drug_hira_map_batch16_apply.sql (+ .rollback.sql)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OFFICIALS, CUSTOMS, CLAIM } from './T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_batch16_mapping.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = join(__dirname, '..', 'supabase', 'migrations');
const FOLDER = 'ed3ae609-a2db-4871-ac41-cbe2ddb653e6'; // DrugFolderTree 약폴더(§10)
const MATCH = { BARTOBEN:'L1_EXACT', HANMIUREA:'L1_EXACT', CEFACLEAR:'L2_BRAND', STILLEN:'L2_BRAND', LOXOPOFEN:'L2_BRAND', TERMIZOL:'L1_EXACT', BETABATE:'L1_EXACT', HITRI:'L1_EXACT', ESROBAN:'L1_EXACT', JUBLIA:'L1_EXACT', RIDOMEX:'L1_EXACT', LUMAZOL:'L1_EXACT', DRROBAN:'L2_BRAND' };
const officialByKey = Object.fromEntries(OFFICIALS.map((o) => [o.key, o]));
const customsByKey = {};
for (const c of CUSTOMS) (customsByKey[c.official] ??= []).push(c);
for (const k in customsByKey) customsByKey[k].sort((a, b) => a.n - b.n); // 최저 n = primary

const sqlLit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ── APPLY ────────────────────────────────────────────────────────────────────
const A = [];
A.push(`-- T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — batch16 apply (#3~#18, 16 custom → 13 official)`);
A.push(`-- 부모 §19 apply GO(2026-07-18). reference-canonical(§8 (b)) — Case2 전건(official 미등재→신규 official ADDITIVE + reference-move + custom deprecate).`);
A.push(`-- 범위 = 16종만. #1 플루나코엠(T-20260716 旣적용)·#2 대웅(분리 DELETE 티켓)·#19 오구멘토(BLOCKER: 확정명 오구멘틴375mg=master 취소 discontinued) 미접촉.`);
A.push(`-- claim_code = HIRA-{품목기준코드9}(§14 DA: 비급여/EDI미확정 prefix, bare 표준코드 NO_GO). insurance_status=NULL(급여여부 미확정→hira_insurance_sync 배치 소관, 오청구 방지).`);
A.push(`-- 코드 전건 2026-07-16 심평원 master 재검증(active·이름일치). dedup 3쌍(BARTOBEN #3/#10·HANMIUREA #4/#9·JUBLIA #14/#16): official 1개 수렴, secondary custom 폴더 membership 삭제(중복 방지)+deprecate.`);
A.push(`-- 가드(§8 NO_GO): (a)claim_code in-place 교체 금지 (b)custom hard-delete 금지 → provenance supersede 링크로 deprecate 표현. 대상 불일치·claim 충돌 시 RAISE→txn abort(무영속).`);
A.push(`-- 선행 DDL: provenance 4컬럼 = 20260716140100_rxset_hira_provenance_columns.sql (旣 PROD). 본 마이그는 DML only.`);
A.push('');
A.push('BEGIN;');
A.push('');

for (const o of OFFICIALS) {
  const cs = customsByKey[o.key];
  const primary = cs[0];
  const secondary = cs.slice(1);
  const claim = CLAIM(o);
  const dedupNote = cs.length > 1 ? `/dedup:${cs.map((c) => '#' + c.n).join(',')}` : '';
  const basis = `std9:${o.pumok}/std13:${o.std13}/namematch:${MATCH[o.key]}/master재검증2026-07-18(active)${dedupNote}/T-20260617 batch16`;
  A.push(`-- ── ${o.key} ${claim} ← ${cs.map((c) => '#' + c.n + ' ' + c.name_ko).join(' | ')} ──`);
  A.push(`DO $$`);
  A.push(`DECLARE`);
  A.push(`  v_off uuid := gen_random_uuid();`);
  cs.forEach((c) => A.push(`  v_c${c.n} uuid;`));
  A.push(`  v_conf int; v_fold int;`);
  A.push(`BEGIN`);
  cs.forEach((c) => A.push(`  SELECT id INTO v_c${c.n} FROM prescription_codes WHERE claim_code=${sqlLit(c.legacy)} AND code_source='custom';`));
  A.push(`  IF ${cs.map((c) => `v_c${c.n} IS NULL`).join(' OR ')} THEN RAISE EXCEPTION '${o.key} ABORT: custom 미식별 (${cs.map((c) => '%').join(',')})', ${cs.map((c) => `v_c${c.n}`).join(', ')}; END IF;`);
  A.push(`  SELECT count(*) INTO v_conf FROM prescription_codes WHERE claim_code=${sqlLit(claim)};`);
  A.push(`  IF v_conf<>0 THEN RAISE EXCEPTION '${o.key} ABORT: ${claim} 충돌 %건 — Case1 강등 검토', v_conf; END IF;`);
  A.push(`  -- 신규 official ADDITIVE (primary custom #${primary.n} 미러 + official 표준)`);
  A.push(`  INSERT INTO prescription_codes (`);
  A.push(`    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,`);
  A.push(`    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,`);
  A.push(`    insurance_status, insurance_status_source, description, service_id,`);
  A.push(`    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by)`);
  A.push(`  SELECT v_off, ${sqlLit(claim)}, ${sqlLit(o.name_ko)}, 'official', '국산보험등재약',`);
  A.push(`    classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose, price_krw,`);
  A.push(`    NULL, NULL, description, service_id,`);
  A.push(`    now(), ${sqlLit(basis)}, NULL, NULL`);
  A.push(`  FROM prescription_codes WHERE id = v_c${primary.n};`);
  A.push(`  -- folder reference-move: primary #${primary.n} → official`);
  A.push(`  SELECT count(*) INTO v_fold FROM prescription_code_folders WHERE prescription_code_id=v_c${primary.n};`);
  A.push(`  IF v_fold<>1 THEN RAISE EXCEPTION '${o.key} ABORT: #${primary.n} 폴더 %건(기대1)', v_fold; END IF;`);
  A.push(`  UPDATE prescription_code_folders SET prescription_code_id=v_off WHERE prescription_code_id=v_c${primary.n};`);
  secondary.forEach((c) => {
    A.push(`  -- dedup: secondary #${c.n} 폴더 membership 삭제(official 이미 폴더 내 → 중복 방지)`);
    A.push(`  DELETE FROM prescription_code_folders WHERE prescription_code_id=v_c${c.n};`);
  });
  A.push(`  -- custom deprecate 전건(hard-delete·claim_code 교체 금지)`);
  cs.forEach((c) => {
    const role = c === primary ? (cs.length > 1 ? 'dedup-primary' : 'single') : 'dedup-secondary(folder삭제)';
    A.push(`  UPDATE prescription_codes SET hira_verified_at=now(), hira_mapped_to_code_id=v_off,`);
    A.push(`    hira_match_basis='DEPRECATED→official:'||v_off::text||${sqlLit(` | std9:${o.pumok}/${role}/T-20260617 batch16`)} WHERE id=v_c${c.n};`);
  });
  A.push(`  RAISE NOTICE '${o.key} OK: official % (${claim}) ← ${cs.map((c) => '#' + c.n).join(',')}', v_off;`);
  A.push(`END $$;`);
  A.push('');
}

// 사후 검증 (같은 txn)
A.push(`-- ── 사후 검증 (같은 txn) ──`);
A.push(`DO $$`);
A.push(`DECLARE v_badge_left int; v_new_off int; v_dep int;`);
A.push(`BEGIN`);
A.push(`  -- 폴더에 남은 대상 custom(자체) 참조 = 0`);
A.push(`  SELECT count(*) INTO v_badge_left FROM prescription_code_folders f`);
A.push(`    JOIN prescription_codes c ON c.id=f.prescription_code_id`);
A.push(`    WHERE c.code_source='custom' AND c.claim_code IN (${CUSTOMS.map((c) => sqlLit(c.legacy)).join(',')});`);
A.push(`  IF v_badge_left<>0 THEN RAISE EXCEPTION 'batch16 verify FAILED: 폴더에 대상 custom 참조 %건 잔존(기대0)', v_badge_left; END IF;`);
A.push(`  -- 신규 official 13건 존재`);
A.push(`  SELECT count(*) INTO v_new_off FROM prescription_codes WHERE code_source='official' AND claim_code IN (${OFFICIALS.map((o) => sqlLit(CLAIM(o))).join(',')});`);
A.push(`  IF v_new_off<>13 THEN RAISE EXCEPTION 'batch16 verify FAILED: 신규 official %건(기대13)', v_new_off; END IF;`);
A.push(`  -- 대상 custom 16건 전부 deprecate(hira_mapped_to_code_id NOT NULL)`);
A.push(`  SELECT count(*) INTO v_dep FROM prescription_codes WHERE code_source='custom' AND hira_mapped_to_code_id IS NOT NULL AND claim_code IN (${CUSTOMS.map((c) => sqlLit(c.legacy)).join(',')});`);
A.push(`  IF v_dep<>16 THEN RAISE EXCEPTION 'batch16 verify FAILED: deprecated custom %건(기대16)', v_dep; END IF;`);
A.push(`  RAISE NOTICE 'batch16 verify OK: 자체 폴더참조 0 / 신규 official 13 / deprecated custom 16';`);
A.push(`END $$;`);
A.push('');
A.push('COMMIT;');
A.push('');

// ── ROLLBACK ─────────────────────────────────────────────────────────────────
const R = [];
R.push(`-- ROLLBACK — T-20260617 batch16 apply (20260718160000_rxset_custom_drug_hira_map_batch16_apply.sql)`);
R.push(`-- 원복: 폴더참조 official→primary custom, secondary custom 폴더 membership 재삽입, custom deprecate(provenance) 해제, 신규 official 13 제거.`);
R.push(`-- ⚠ 적용 직후 원복 전제. 스냅샷 = db-gate/T-20260617-batch16_stepA_snapshot.json. 원복 후 = 적용 전(16종 '자체' 배지 복귀).`);
R.push('');
R.push('BEGIN;');
R.push('');
for (const o of OFFICIALS) {
  const cs = customsByKey[o.key];
  const primary = cs[0];
  const secondary = cs.slice(1);
  const claim = CLAIM(o);
  R.push(`-- ── ${o.key} ${claim} 원복 ──`);
  R.push(`DO $$`);
  R.push(`DECLARE v_off uuid;`);
  cs.forEach((c) => R.push(`  v_c${c.n} uuid;`));
  R.push(`BEGIN`);
  R.push(`  SELECT id INTO v_off FROM prescription_codes WHERE claim_code=${sqlLit(claim)} AND code_source='official';`);
  cs.forEach((c) => R.push(`  SELECT id INTO v_c${c.n} FROM prescription_codes WHERE claim_code=${sqlLit(c.legacy)} AND code_source='custom';`));
  R.push(`  IF v_c${primary.n} IS NULL THEN RAISE EXCEPTION '${o.key} rollback ABORT: primary custom(${primary.legacy}) 부재'; END IF;`);
  R.push(`  -- 1) 폴더참조 원복: official → primary custom`);
  R.push(`  IF v_off IS NOT NULL THEN UPDATE prescription_code_folders SET prescription_code_id=v_c${primary.n} WHERE prescription_code_id=v_off; END IF;`);
  secondary.forEach((c) => {
    R.push(`  -- 2) secondary #${c.n} 폴더 membership 재삽입(삭제 원복, sort_order=0)`);
    R.push(`  INSERT INTO prescription_code_folders (prescription_code_id, folder_id, sort_order)`);
    R.push(`    SELECT v_c${c.n}, ${sqlLit(FOLDER)}, 0 WHERE NOT EXISTS (SELECT 1 FROM prescription_code_folders WHERE prescription_code_id=v_c${c.n} AND folder_id=${sqlLit(FOLDER)});`);
  });
  R.push(`  -- 3) custom deprecate(provenance) 해제`);
  cs.forEach((c) => R.push(`  UPDATE prescription_codes SET hira_verified_at=NULL, hira_mapped_to_code_id=NULL, hira_match_basis=NULL, hira_verified_by=NULL WHERE id=v_c${c.n};`));
  R.push(`  -- 4) 신규 official 제거(ADDITIVE 원복)`);
  R.push(`  IF v_off IS NOT NULL THEN DELETE FROM prescription_codes WHERE id=v_off; END IF;`);
  R.push(`  RAISE NOTICE '${o.key} rollback OK';`);
  R.push(`END $$;`);
  R.push('');
}
R.push('COMMIT;');
R.push('');

const applyPath = join(MIG, '20260718160000_rxset_custom_drug_hira_map_batch16_apply.sql');
const rbPath = join(MIG, '20260718160000_rxset_custom_drug_hira_map_batch16_apply.rollback.sql');
writeFileSync(applyPath, A.join('\n'));
writeFileSync(rbPath, R.join('\n'));
console.log('✅ generated:');
console.log('  ' + applyPath);
console.log('  ' + rbPath);
console.log(`  officials=${OFFICIALS.length} customs=${CUSTOMS.length} dedup pairs=${Object.values(customsByKey).filter((v) => v.length > 1).length}`);
