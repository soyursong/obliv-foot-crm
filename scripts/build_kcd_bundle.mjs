/**
 * build_kcd_bundle.mjs — HIRA/KOICD 상병마스터(CSV/XLSX) → FE 정적 번들(kcdData.ts) 변환기
 *
 * Ticket: T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN
 *   AC-0 = (A) 정적 FE 번들 확정(DB 무변경). 이 스크립트는 그 (A) 위에서
 *   PROVISIONAL 큐레이션 ~80건을 → 공식 상병마스터 전수로 **drop-in 교체**하기 위한 변환기.
 *
 * ⚠️ 준비(prep) 전용 / drop-in은 GO 게이트:
 *   - 기본 동작 = **DRY**. 결과를 scripts/out/kcdData.generated.ts 로만 쓴다(src 무변경).
 *   - 실제 교체(src/lib/kcd/kcdData.ts 덮어쓰기)는 `--emit-src` 플래그가 있을 때만.
 *     → human_pending ①(데이터 원천: KCD-8 고정 vs KCD-9 in-force + AC-2 스코프) 회신 수령 후에만 사용.
 *   - 신규 npm 의존성 0: CSV는 hand-rolled 파서, XLSX는 기존 `xlsx` 의존성만 사용.
 *
 * 사용:
 *   # 1) 파이프라인 자가검증(인자 없이) — 인라인 샘플로 dry 변환, out/ 에 산출
 *   node scripts/build_kcd_bundle.mjs --self-test
 *
 *   # 2) DRY 변환(실제 HIRA 파일, src 무변경) — 통계만 확인
 *   node scripts/build_kcd_bundle.mjs --in path/to/상병마스터.csv --edition KCD-8 --source "통계청 KOICD"
 *
 *   # 3) GO 후 실제 drop-in (src 덮어쓰기 + provisional 해제)
 *   node scripts/build_kcd_bundle.mjs --in path/to/상병마스터.csv --edition KCD-8 \
 *        --source "통계청 KOICD" --date 20260612 --emit-src
 *
 * 옵션:
 *   --in <path>          입력 파일 (.csv | .xlsx). 미지정 시 --self-test 강제.
 *   --edition <str>      KCD 차수 스탬프 (예: KCD-8 | KCD-9). human_pending ① 결정 후 기입.
 *   --source <str>       출처 표기 (버전 스탬프/메타). 기본 'official'.
 *   --date <yyyymmdd>    데이터 기준일 스탬프. 기본 오늘.
 *   --code-col <name>    코드 컬럼 헤더명 강제 (기본 자동탐지: 상병기호/상병코드/code...).
 *   --name-col <name>    한글명 컬럼 헤더명 강제 (기본 자동탐지: 한글명/상병명/한글상병명...).
 *   --inforce-col <name> 사용여부/적용 컬럼 헤더명 (KCD-9 in-force 필터용, 있을 때만).
 *   --in-force-only      inforce-col 값이 사용중('Y'/'1'/true/'사용')인 행만 채택.
 *   --emit-src           ★GO 게이트★ src/lib/kcd/kcdData.ts 를 실제로 덮어쓴다(provisional 해제).
 *   --self-test          입력 없이 인라인 샘플 CSV로 파이프라인 검증.
 *
 * 컬럼 매핑(자동탐지 우선순위, 대소문자/공백 무시):
 *   code : 상병기호 > 상병코드 > KCD코드 > code > 코드
 *   name : 한글명 > 한글상병명 > 상병명 > 한글명칭 > name > 명칭
 *
 * 코드 표기: dotted 정본 유지(M72.2). dotless(M722)는 FE kcdSearch 정규화가 검색·동치비교 흡수.
 *   → 입력이 dotless(점 없음)인 경우에도 그대로 dotted 칸에 보존하지 않고 **원문 보존**한다
 *     (HIRA 마스터는 통상 dotted 제공). 형식검증은 KCD8_RE(완화판)로 한다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');
const SRC_PATH = path.join(ROOT, 'src', 'lib', 'kcd', 'kcdData.ts');

// DIAG-CODE-VALIDATION 과 동일 형식 규칙(완화판) — dotless 3~4자리 + dotted subdivided 수용.
const KCD8_RE = /^[A-Z][0-9]{2,4}(\.[0-9]{1,4})?$/;

const normalizeServiceCode = (raw) => String(raw ?? '').trim().toUpperCase();
const dotlessKey = (raw) => normalizeServiceCode(raw).replace(/\./g, '');

// --------------------------------------------------------------------------
// args
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { source: 'official', flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case '--emit-src': a.flags.add('emit-src'); break;
      case '--self-test': a.flags.add('self-test'); break;
      case '--in-force-only': a.flags.add('in-force-only'); break;
      case '--in': a.in = argv[++i]; break;
      case '--edition': a.edition = argv[++i]; break;
      case '--source': a.source = argv[++i]; break;
      case '--date': a.date = argv[++i]; break;
      case '--code-col': a.codeCol = argv[++i]; break;
      case '--name-col': a.nameCol = argv[++i]; break;
      case '--inforce-col': a.inforceCol = argv[++i]; break;
      default:
        if (t.startsWith('--')) console.warn(`[warn] 알 수 없는 옵션 무시: ${t}`);
    }
  }
  return a;
}

// --------------------------------------------------------------------------
// CSV 파서 (RFC4180-ish, 의존성 0): 인용필드/내장 콤마·개행/이스케이프("") 처리 + BOM strip
// --------------------------------------------------------------------------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip, handle on \n */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

// --------------------------------------------------------------------------
// 입력 로드 → [{header...}] 객체 배열
// --------------------------------------------------------------------------
async function loadRows(inPath) {
  const ext = path.extname(inPath).toLowerCase();
  if (ext === '.csv') {
    const buf = fs.readFileSync(inPath);
    // CP949/EUC-KR 감지: UTF-8 디코드 후 치환문자(�) 다량이면 경고.
    let text = buf.toString('utf8');
    if ((text.match(/�/g) || []).length > 10) {
      console.warn('[warn] UTF-8 디코드 실패 흔적 다수 — CP949/EUC-KR 인코딩으로 보임.');
      console.warn('       먼저 변환하세요:  iconv -f CP949 -t UTF-8 입력.csv > 입력.utf8.csv');
    }
    const grid = parseCsv(text);
    if (grid.length < 2) throw new Error('CSV 행이 부족합니다(헤더+데이터 필요).');
    const header = grid[0].map((h) => h.trim());
    return grid.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  }
  if (ext === '.xlsx' || ext === '.xls') {
    // 기존 의존성 xlsx 사용(신규 의존성 0).
    const XLSX = (await import('xlsx')).default;
    const wb = XLSX.readFile(inPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  }
  throw new Error(`지원하지 않는 확장자: ${ext} (.csv | .xlsx)`);
}

// --------------------------------------------------------------------------
// 컬럼 자동탐지
// --------------------------------------------------------------------------
function pickColumn(headers, forced, candidates, label) {
  const norm = (s) => String(s).replace(/\s/g, '').toLowerCase();
  if (forced) {
    const hit = headers.find((h) => norm(h) === norm(forced));
    if (!hit) throw new Error(`--${label}-col '${forced}' 헤더를 찾지 못함. 가능: ${headers.join(', ')}`);
    return hit;
  }
  for (const c of candidates) {
    const hit = headers.find((h) => norm(h) === norm(c));
    if (hit) return hit;
  }
  throw new Error(`${label} 컬럼 자동탐지 실패. --${label}-col 로 지정하세요. 헤더: ${headers.join(', ')}`);
}

// --------------------------------------------------------------------------
// 변환 코어
// --------------------------------------------------------------------------
function transform(records, a) {
  const headers = Object.keys(records[0] ?? {});
  if (headers.length === 0) throw new Error('레코드가 비어 있습니다.');
  const codeCol = pickColumn(headers, a.codeCol, ['상병기호', '상병코드', 'KCD코드', 'code', '코드'], 'code');
  const nameCol = pickColumn(headers, a.nameCol, ['한글명', '한글상병명', '상병명', '한글명칭', 'name', '명칭'], 'name');
  const inforceCol = a.inforceCol
    ? pickColumn(headers, a.inforceCol, [a.inforceCol], 'inforce')
    : null;

  const stats = { read: records.length, kept: 0, droppedInvalid: 0, droppedEmpty: 0, droppedInactive: 0, deduped: 0 };
  const seen = new Map(); // dotlessKey → entry (선등록 우선, kcdSearch.loadKcdBundle 과 동일 규칙)
  const out = [];

  for (const r of records) {
    const rawCode = String(r[codeCol] ?? '').trim();
    const name = String(r[nameCol] ?? '').trim();
    if (!rawCode || !name) { stats.droppedEmpty++; continue; }

    if (inforceCol && a.flags.has('in-force-only')) {
      const v = String(r[inforceCol] ?? '').trim().toLowerCase();
      const active = ['y', '1', 'true', '사용', '사용중', '유효', 'o'].includes(v);
      if (!active) { stats.droppedInactive++; continue; }
    }

    const code = normalizeServiceCode(rawCode); // 대문자/trim. dotted 정본 유지.
    if (!KCD8_RE.test(code)) { stats.droppedInvalid++; continue; }

    const key = dotlessKey(code);
    if (seen.has(key)) { stats.deduped++; continue; }
    const entry = { code, name };
    seen.set(key, entry);
    out.push(entry);
  }
  stats.kept = out.length;
  // 코드순 정렬(번들 가독성/diff 안정성). 검색 랭킹은 런타임이 재정렬하므로 무관.
  out.sort((x, y) => x.code.localeCompare(y.code));
  return { entries: out, stats, codeCol, nameCol, inforceCol };
}

// --------------------------------------------------------------------------
// kcdData.ts 직렬화
// --------------------------------------------------------------------------
function renderModule(entries, a, provisional) {
  const date = a.date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const edition = a.edition || 'KCD-8';
  const editionTag = edition.replace(/[^A-Za-z0-9]/g, '');
  const sourceTag = String(a.source).replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 24) || 'official';
  const version = `${editionTag}-${sourceTag}-${date}${provisional ? '-provisional' : ''}`;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const lines = entries.map((e) => `  { code: '${esc(e.code)}', name: '${esc(e.name)}' },`).join('\n');

  return `// kcdData — ${edition}(한국표준질병·사인분류) 내장 데이터셋 (정적 asset 번들).
// Ticket: T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN  (AC-0 = (A) 정적 번들 확정, DB 무변경)
//
// ⚠️ 이 파일은 scripts/build_kcd_bundle.mjs 로 자동 생성됨. 직접 편집 금지.
//   생성 출처: ${esc(a.source)} / edition=${edition} / date=${date}
//   ${provisional ? 'PROVISIONAL — 공식 전수 미반영(또는 GO 전 dry 산출).' : '확정 번들(drop-in 적용).'}
//
//   이 모듈은 kcdSearch.ts 에서 **dynamic import()** 로만 로드된다(코드 스플릿).
//   데이터 = { code: ${edition} 코드(dotted 정본), name: 한글 상병명 }.
//   dotless(M722) 검색·동치비교는 kcdSearch 정규화가 흡수.

export interface KcdEntry {
  /** ${edition} 코드 (dotted 정본, 예: M72.2). 대문자. */
  code: string;
  /** 한글 상병명. */
  name: string;
}

/** 번들 데이터셋 버전 스탬프 (어느 시점/출처 데이터인지 추적). */
export const KCD_BUNDLE_VERSION = '${version}';

/** 데이터셋 출처 메타. */
export const KCD_BUNDLE_META = {
  version: KCD_BUNDLE_VERSION,
  provisional: ${provisional},
  source: '${esc(a.source)}',
  edition: '${edition}',
  count_note: '${entries.length}건 (${provisional ? 'provisional/dry' : 'official drop-in'})',
} as const;

export const KCD_DATASET: KcdEntry[] = [
${lines}
];
`;
}

// --------------------------------------------------------------------------
// 인라인 self-test 샘플 (CP949 이슈/실파일 없이 파이프라인 검증)
// --------------------------------------------------------------------------
const SELF_TEST_CSV = `상병기호,한글명,사용여부
M72.2,발바닥근막섬유종증(족저근막염),Y
M722,발바닥근막섬유종증 중복표기(dotless),Y
M76.6,아킬레스힘줄염,Y
L60.0,내향성 손발톱(내성발톱),Y
한글코드,잘못된코드행,Y
,빈코드행,Y
S93.401,발목의 외측인대 염좌 및 긴장,N
`;

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
async function main() {
  const a = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let records;
  let provisional;
  if (a.flags.has('self-test') || !a.in) {
    if (!a.in) console.log('[info] --in 미지정 → self-test 모드(인라인 샘플)로 실행합니다.');
    records = parseCsv(SELF_TEST_CSV).slice(1).reduce((acc, _r, i, arr) => acc, null) ?? null;
    // 위 reduce는 no-op; 헤더 매핑은 loadRows 경로와 동일하게 재구성
    const grid = parseCsv(SELF_TEST_CSV);
    const header = grid[0].map((h) => h.trim());
    records = grid.slice(1).map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? '').trim()])));
    provisional = true; // self-test는 항상 provisional
    a.edition = a.edition || 'KCD-8';
    a.source = a.source === 'official' ? 'self-test sample' : a.source;
    if (a.flags.has('in-force-only')) a.inforceCol = a.inforceCol || '사용여부';
  } else {
    records = await loadRows(a.in);
    // emit-src(=GO drop-in) 일 때만 provisional 해제. dry는 항상 provisional 스탬프.
    provisional = !a.flags.has('emit-src');
  }

  const { entries, stats, codeCol, nameCol, inforceCol } = transform(records, a);

  console.log('\n=== build_kcd_bundle 결과 ===');
  console.log(`입력 컬럼: code='${codeCol}' name='${nameCol}'${inforceCol ? ` inforce='${inforceCol}'` : ''}`);
  console.log(`읽음 ${stats.read} → 채택 ${stats.kept}`);
  console.log(`  드롭: 빈값 ${stats.droppedEmpty} / 형식위반 ${stats.droppedInvalid} / 비활성 ${stats.droppedInactive} / 중복 ${stats.deduped}`);
  console.log(`provisional=${provisional} edition=${a.edition} source='${a.source}'`);

  const moduleText = renderModule(entries, a, provisional);

  // 통계 JSON 항상 out/ 에 기록(추적용)
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const statsPath = path.join(OUT_DIR, `kcd_bundle_stats_${stamp}.json`);
  fs.writeFileSync(statsPath, JSON.stringify({ stats, codeCol, nameCol, inforceCol, edition: a.edition, source: a.source, provisional, sample: entries.slice(0, 5) }, null, 2));

  if (a.flags.has('emit-src')) {
    // ★GO 게이트★ — human_pending ① 회신 후에만 도달해야 함.
    fs.writeFileSync(SRC_PATH, moduleText);
    console.log(`\n[EMIT-SRC] ✅ src 덮어씀: ${path.relative(ROOT, SRC_PATH)}`);
    console.log('   → 후속: npm run typecheck && npm run build → E2E(LOCKDOWN spec) → deploy-ready 전환');
  } else {
    const dryPath = path.join(OUT_DIR, 'kcdData.generated.ts');
    fs.writeFileSync(dryPath, moduleText);
    console.log(`\n[DRY] 📄 산출(미적용): ${path.relative(ROOT, dryPath)}`);
    console.log('   → src 무변경. GO(human_pending ① 회신) 후 --emit-src 로 실제 교체.');
  }
  console.log(`[stats] ${path.relative(ROOT, statsPath)}\n`);
}

main().catch((e) => { console.error('[error]', e.message); process.exit(1); });
