/**
 * T-20260423-foot-RX-CODE-SEED (2) 엑셀 → seed SQL 변환
 *
 * 입력: src/assets/forms/foot-service/표준처방코드.xlsx
 * 출력: supabase/migrations/20260424000001_prescription_codes_seed.sql
 *
 * 사용:
 *   npx tsx scripts/import_prescription_codes.ts
 *
 * 엑셀 컬럼 매핑 (2026-04-24 dev-foot 파싱 확인):
 *   청구코드            → claim_code     (PK)
 *   한글명칭            → name_ko
 *   코드구분            → code_type
 *   처방코드분류        → classification
 *   제약회사명칭        → manufacturer
 *   퇴장방지여부        → anti_dropout   (Y/N → boolean)
 *   상대가치점수        → relative_value
 *   주성분단축코드      → ingredient_code
 *   저함량코드여부      → low_dose       (Y/N → boolean)
 *
 * price_krw / code_source 는 import 대상 아님 (확장 마이그레이션에서 DEFAULT 'official').
 */
// xlsx 는 ESM 상에서 default export 가 네임스페이스를 제공. tsx/esm 호환을 위해 default import 사용.
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const XLSX_PATH = path.join(__dirname, '..', 'src', 'assets', 'forms', 'foot-service', '표준처방코드.xlsx');
const OUT_PATH = path.join(__dirname, '..', 'supabase', 'migrations', '20260424000001_prescription_codes_seed.sql');

interface Row {
  claim_code: string;
  name_ko: string;
  code_type: string;
  classification: string;
  manufacturer: string | null;
  anti_dropout: boolean;
  relative_value: string;
  ingredient_code: string | null;
  low_dose: boolean;
}

const HEADERS = [
  '청구코드', '한글명칭', '코드구분', '처방코드분류',
  '제약회사명칭', '퇴장방지여부', '상대가치점수', '주성분단축코드', '저함량코드여부',
] as const;

function sqlEscape(v: string | null): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${v.replace(/'/g, "''")}'`;
}

function ynToBool(v: unknown): boolean {
  return String(v ?? '').trim().toUpperCase() === 'Y';
}

function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1, defval: null });
  const headerRow = raw[0] as unknown as string[];

  const idx: Record<string, number> = {};
  for (const h of HEADERS) {
    const i = headerRow.indexOf(h);
    if (i < 0) throw new Error(`헤더 누락: ${h}`);
    idx[h] = i;
  }

  // dedup: 동일 INSERT 내 같은 claim_code 가 두 번 등장하면 ON CONFLICT DO UPDATE
  // 가 동일 row 두 번 영향 → SQLSTATE 21000. xlsx 원본에 중복 행이 있으면 마지막 값 유지.
  // (T-20260423-foot-RX-CODE-SEED MSG-20260426-0210_RX_SEED_DUP_FIX)
  const byCode = new Map<string, Row>();
  let dupCount = 0;
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as unknown as unknown[];
    if (!r || !r[idx['청구코드']]) continue;
    const claim_code = String(r[idx['청구코드']]).trim();
    const row: Row = {
      claim_code,
      name_ko: String(r[idx['한글명칭']] ?? '').trim(),
      code_type: String(r[idx['코드구분']] ?? '국산보험등재약').trim(),
      classification: String(r[idx['처방코드분류']] ?? '내복약').trim(),
      manufacturer: r[idx['제약회사명칭']] ? String(r[idx['제약회사명칭']]).trim() : null,
      anti_dropout: ynToBool(r[idx['퇴장방지여부']]),
      relative_value: String(r[idx['상대가치점수']] ?? '0').trim(),
      ingredient_code: r[idx['주성분단축코드']] ? String(r[idx['주성분단축코드']]).trim() : null,
      low_dose: ynToBool(r[idx['저함량코드여부']]),
    };
    if (byCode.has(claim_code)) dupCount++;
    byCode.set(claim_code, row); // 마지막 값 유지
  }
  const rows: Row[] = [...byCode.values()];
  if (dupCount > 0) {
    console.warn(`⚠ xlsx 원본에 중복 claim_code ${dupCount}건 — 마지막 값으로 dedup.`);
  }

  const header = [
    '-- T-20260423-foot-RX-CODE-SEED (3) prescription_codes 시드',
    '-- 자동 생성: scripts/import_prescription_codes.ts',
    `-- 원본: src/assets/forms/foot-service/표준처방코드.xlsx (${rows.length} rows)`,
    '-- 재실행 안전: ON CONFLICT (claim_code) DO UPDATE',
    '',
  ].join('\n');

  const values = rows.map((r) => (
    `  (${[
      sqlEscape(r.claim_code),
      sqlEscape(r.name_ko),
      sqlEscape(r.code_type),
      sqlEscape(r.classification),
      sqlEscape(r.manufacturer),
      r.anti_dropout ? 'TRUE' : 'FALSE',
      r.relative_value || '0',
      sqlEscape(r.ingredient_code),
      r.low_dose ? 'TRUE' : 'FALSE',
    ].join(', ')})`
  )).join(',\n');

  const sql = [
    header,
    'INSERT INTO prescription_codes',
    '  (claim_code, name_ko, code_type, classification, manufacturer, anti_dropout, relative_value, ingredient_code, low_dose)',
    'VALUES',
    values,
    'ON CONFLICT (claim_code) DO UPDATE SET',
    '  name_ko         = EXCLUDED.name_ko,',
    '  code_type       = EXCLUDED.code_type,',
    '  classification  = EXCLUDED.classification,',
    '  manufacturer    = EXCLUDED.manufacturer,',
    '  anti_dropout    = EXCLUDED.anti_dropout,',
    '  relative_value  = EXCLUDED.relative_value,',
    '  ingredient_code = EXCLUDED.ingredient_code,',
    '  low_dose        = EXCLUDED.low_dose;',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_PATH, sql, 'utf8');
  console.log(`✔ ${rows.length} rows → ${path.relative(process.cwd(), OUT_PATH)}`);
}

main();
