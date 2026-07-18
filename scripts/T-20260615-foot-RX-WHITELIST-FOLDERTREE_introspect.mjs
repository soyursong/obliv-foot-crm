#!/usr/bin/env node
/**
 * T-20260615-foot-RX-WHITELIST-FOLDERTREE — prod introspection (READ-ONLY).
 * 목적(스코프 노트 2): overlay FK 타깃 확정
 *   - prescription_codes.id 타입(PK) / code 컬럼 존재·타입
 *   - prescription_code_folders 실 스키마 (매핑 grain)
 *   - prescription_folders 실 스키마
 *   - prescription_code_allowlist 사전 부재 확인(신규 ADDITIVE 전제)
 *   - prescription_sets.items grain 참고(묶음처방 arm)
 * 무영속: 전부 SELECT introspection.
 */
import { q } from './dryrun_lib.mjs';

const out = {};
const cols = (t) => `
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='${t}'
  ORDER BY ordinal_position;`;

async function main() {
  out.prescription_codes_cols = await q(cols('prescription_codes'));
  out.prescription_codes_pk = await q(`
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid='public.prescription_codes'::regclass AND i.indisprimary;`);
  out.prescription_code_folders_cols = await q(cols('prescription_code_folders'));
  out.prescription_folders_cols = await q(cols('prescription_folders'));
  out.prescription_sets_cols = await q(cols('prescription_sets'));

  // allowlist 사전 부재
  out.allowlist_exists = await q(`SELECT to_regclass('public.prescription_code_allowlist') AS reg;`);

  // 카탈로그 규모 (499 EDI 코드 참고)
  out.rx_codes_count = await q(`SELECT count(*) AS n FROM prescription_codes;`);
  out.rx_code_folders_count = await q(`SELECT count(*) AS n FROM prescription_code_folders;`);

  // clinic_slug 표준값 참고 (다른 테이블 실측)
  out.clinic_slug_samples = await q(`
    SELECT DISTINCT clinic_slug FROM prescription_folders WHERE clinic_slug IS NOT NULL LIMIT 5;`).catch(() => 'no clinic_slug col on prescription_folders');

  // 묶음처방 items grain: prescription_code_id 채워진 비율 (services 스왑 후 null 화 확인)
  out.bundle_items_probe = await q(`
    SELECT
      count(*) AS total_sets,
      count(*) FILTER (WHERE items IS NOT NULL AND jsonb_array_length(items) > 0) AS nonempty_sets
    FROM prescription_sets;`);
  out.bundle_item_codeid_fill = await q(`
    SELECT
      count(*) AS total_items,
      count(*) FILTER (WHERE (it->>'prescription_code_id') IS NOT NULL AND (it->>'prescription_code_id') <> '') AS with_code_id
    FROM prescription_sets s, jsonb_array_elements(COALESCE(s.items,'[]'::jsonb)) it;`);

  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
