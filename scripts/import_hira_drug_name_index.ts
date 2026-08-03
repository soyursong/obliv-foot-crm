/**
 * T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 — HIRA 명칭 인덱스 코퍼스 멱등 적재 스크립트.
 * DA CONSULT-REPLY: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (GO / Option A / ADDITIVE).
 *   SSOT = da_decision_foot_rxset_hira_name_index_ac8_20260803.md
 *
 * 소스(DA §3): source A = data.go.kr 15067462(품목기준코드9 namespace, 단일 canonical 소스).
 *   ★T-20260617 자산(13-entry 큐레이션 매핑)만으론 인덱스 불가 → 더 넓은 fresh 코퍼스가 필요하되
 *     반드시 동일 canonical 소스에서(코드 일관성 불변식). 다른 벤더/마스터 금지.
 *
 * 안전(DA §4):
 *   · 멱등: upsert(onConflict=item_std_code, ignoreDuplicates=true) = INSERT ... ON CONFLICT DO NOTHING.
 *           재실행 = no-op. 부분적재 후 재실행도 안전(남은 것만 채움).
 *   · rows-affected assert: 최종 테이블 행수 >= 적격 소스행수(부분적재 abort). 불일치 시 비정상 종료.
 *   · greenfield: 기존 행 mutation 0(ON CONFLICT DO NOTHING) → Data-Correction Backfill SOP 봉투 아님.
 *   · 롤백 = DROP TABLE(별도 rollback.sql). FK 무 → orphan 무.
 *
 * ★정규화 권위 = src/lib/hiraDrugNameIndex.ts(buildHiraDrugNameIndexRow/normalizeHiraDrugName).
 *   조회 질의도 동일 함수를 써야 write/read 정합(그래서 .ts + tsx 로 실행해 공용 util 을 직접 import).
 *
 * 사용:
 *   npx tsx scripts/import_hira_drug_name_index.ts --source <source_A.csv> [--dry-run]
 *   --dry-run : 파싱·검증·카운트만(write 0). MIG-GATE 사전점검용.
 *   기본      : upsert(멱등) + rows-affected assert.
 *
 * ⚠️ prod 적재는 supervisor MIG-GATE 하에서만(DA §5). dev DB 는 dev-foot 자율 가능.
 *    이 스크립트는 write 경로 = service_role(RLS 우회) — .env.local SUPABASE_SERVICE_ROLE_KEY 필요.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { buildHiraDrugNameIndexRow, type HiraDrugNameIndexRow } from '../src/lib/hiraDrugNameIndex';

const SOURCE_REF = 'data.go.kr:15067462';

// source A CSV 헤더 후보(벤더 헤더 변형 흡수). 좌=표준 필드, 우=CSV 헤더 후보들.
const HEADER_CANDIDATES: Record<'item_std_code' | 'name_ko' | 'ingredient_code' | 'ingredient_name', string[]> = {
  item_std_code: ['품목기준코드', '품목일련번호', '품목기준일련번호', 'ITEM_SEQ', 'item_std_code'],
  name_ko: ['제품명', '품목명', '한글명칭', 'ITEM_NAME', 'name_ko'],
  ingredient_code: ['주성분코드', '성분코드', 'MAIN_INGR_CODE', 'ingredient_code'],
  ingredient_name: ['주성분명', '성분명', 'MAIN_INGR_NAME', 'ingredient_name'],
};

/** 최소 CSV 파서 — 따옴표 필드/이스케이프("") 처리. 대용량은 라인 단위 스트림 권장(여긴 단순화). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function resolveColIndex(header: string[], candidates: string[]): number {
  const norm = header.map((h) => h.trim().replace(/\s+/g, '').toLowerCase());
  for (const cand of candidates) {
    const idx = norm.indexOf(cand.replace(/\s+/g, '').toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sourcePath = getArg('--source');
  const dryRun = process.argv.includes('--dry-run');
  if (!sourcePath) {
    console.error('❌ --source <source_A.csv> 필요(data.go.kr 15067462 다운로드 CSV).');
    process.exit(2);
  }

  console.log('═══ HIRA 명칭 인덱스 코퍼스 적재 ═══');
  console.log(`소스: ${sourcePath} (source_ref=${SOURCE_REF}) · 모드=${dryRun ? 'DRY-RUN(write 0)' : 'UPSERT(멱등)'}`);

  const raw = readFileSync(sourcePath, 'utf8');
  const grid = parseCsv(raw);
  if (grid.length < 2) { console.error('❌ CSV 행 부족(헤더+데이터 필요).'); process.exit(1); }

  const header = grid[0];
  const idx = {
    item_std_code: resolveColIndex(header, HEADER_CANDIDATES.item_std_code),
    name_ko: resolveColIndex(header, HEADER_CANDIDATES.name_ko),
    ingredient_code: resolveColIndex(header, HEADER_CANDIDATES.ingredient_code),
    ingredient_name: resolveColIndex(header, HEADER_CANDIDATES.ingredient_name),
  };
  if (idx.item_std_code < 0 || idx.name_ko < 0) {
    console.error(`❌ 필수 컬럼 매핑 실패 — 헤더: ${JSON.stringify(header)}`);
    console.error(`   필요: 품목기준코드→${idx.item_std_code}, 제품명→${idx.name_ko}`);
    process.exit(1);
  }
  console.log(`컬럼 매핑: ${JSON.stringify(idx)}`);

  // 적격 행 빌드(정규화 권위 = 공용 util). 부적격(코드/명칭 부재) skip. item_std_code 중복은 파일 내 dedup.
  const seen = new Set<string>();
  const rows: HiraDrugNameIndexRow[] = [];
  let skipped = 0;
  let dupInFile = 0;
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    const built = buildHiraDrugNameIndexRow(
      {
        item_std_code: line[idx.item_std_code],
        name_ko: line[idx.name_ko],
        ingredient_code: idx.ingredient_code >= 0 ? line[idx.ingredient_code] : null,
        ingredient_name: idx.ingredient_name >= 0 ? line[idx.ingredient_name] : null,
      },
      SOURCE_REF,
    );
    if (!built) { skipped++; continue; }
    if (seen.has(built.item_std_code)) { dupInFile++; continue; }
    seen.add(built.item_std_code);
    rows.push(built);
  }
  const eligible = rows.length;
  console.log(`파싱: 데이터행 ${grid.length - 1} · 적격 ${eligible} · skip(부적격) ${skipped} · 파일내 중복 ${dupInFile}`);

  if (dryRun) {
    console.log('✅ DRY-RUN 완료 — write 0. 샘플 3행:');
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    return;
  }

  const env = Object.fromEntries(
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 멱등 upsert(ON CONFLICT DO NOTHING) — 청크 분할(대용량 안전).
  const CHUNK = 1000;
  let attempted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb
      .from('hira_drug_name_index')
      .upsert(chunk, { onConflict: 'item_std_code', ignoreDuplicates: true });
    if (error) { console.error(`❌ upsert 실패(청크 ${i}): ${error.message}`); process.exit(1); }
    attempted += chunk.length;
    console.log(`  적재 진행: ${attempted}/${rows.length}`);
  }

  // rows-affected assert(DA §4): 최종 테이블 행수 >= 적격 소스행수(부분적재 abort).
  const { count, error: cErr } = await sb
    .from('hira_drug_name_index')
    .select('*', { count: 'exact', head: true });
  if (cErr) { console.error(`❌ count 검증 실패: ${cErr.message}`); process.exit(1); }
  console.log(`검증: 테이블 행수 ${count} · 적격 소스행수 ${eligible}`);
  if ((count ?? 0) < eligible) {
    console.error(`❌ ASSERT FAIL — 부분적재(테이블 ${count} < 적격 ${eligible}). abort.`);
    process.exit(1);
  }
  console.log('✅ 적재 완료 — 멱등·rows-affected assert 통과.');
}

main().catch((e) => { console.error(e); process.exit(1); });
