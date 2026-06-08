/**
 * T-20260609-foot-HIRA-INSURANCE-BATCH Phase2 — HIRA 약제급여목록 → prescription_codes 급여상태 배치 동기화
 *
 * STEP1 조사(2026-06-09): 약제급여목록 정본은 ★Open API 아님 → 복지부 고시 별표1 월간 .xlsx 수동 다운로드.
 *   본 배치는 "수동 다운로드한 xlsx 파일"을 입력으로 받아 동기화한다(완전 무인 API sync 아님).
 *   주기 운영: 월 1회(고시 개정 시) 운영자가 xlsx 다운로드 → 본 스크립트 dry-run → 검토 → --apply --confirm.
 *
 * 매핑 키(AC2): xlsx 청구코드(제품코드/EDI코드) ↔ prescription_codes.claim_code (NOT NULL UNIQUE).
 * 우선순위(AC3): insurance_status_source='manual' + 값 있음 → 수동 override 보존(skip). --force-overwrite-manual 로만 덮음.
 * 사람확인 게이트(AC2): --apply 는 반드시 --confirm 동반(없으면 거부). 대량 upsert 전 dry-run 리포트 검토 전제.
 * 안전동작(AC4): 실패 시 트랜잭션 롤백 → 기존 insurance_status 무변경(게이트 last-known 유지). 실행은 insurance_sync_runs 에 기록.
 *
 * 실행:
 *   node scripts/hira_insurance_sync.mjs --file ./약제급여목록_202606.xlsx --period 2026-06 --dry-run
 *   node scripts/hira_insurance_sync.mjs --file ./약제급여목록_202606.xlsx --period 2026-06 --apply --confirm --by 홍길동
 *   옵션: --code-col "청구코드"  --status-col "급여구분"  --sheet 0  --force-overwrite-manual
 *
 * ⚠️ 병합 로직은 src/lib/hiraInsurance.ts 가 canonical(FE/빌드검증/공유). 아래 JS 포트는 그 미러(동일 규칙).
 */
import pg from 'pg';
import fs from 'fs';
import XLSX from 'xlsx';
const { Client } = pg;

// ── args ────────────────────────────────────────────────────────────────────
function argVal(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const FILE = argVal('--file');
const PERIOD = argVal('--period');
const SHEET_IDX = Number(argVal('--sheet', '0'));
const CODE_COL = argVal('--code-col');     // 명시 안 하면 자동 탐지
const STATUS_COL = argVal('--status-col'); // 명시 안 하면 자동 탐지(없으면 전부 covered)
const RUN_BY = argVal('--by', 'cli');
const FORCE_MANUAL = process.argv.includes('--force-overwrite-manual');
const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry_run'
           : null;
const CONFIRM = process.argv.includes('--confirm');

if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }
if (!FILE) { console.error('❌ --file <xlsx 경로> 필요'); process.exit(1); }
if (!fs.existsSync(FILE)) { console.error(`❌ 파일 없음: ${FILE}`); process.exit(1); }
if (MODE === 'apply' && !CONFIRM) {
  console.error('🚫 --apply 는 사람확인 게이트(--confirm) 필요. 먼저 --dry-run 으로 변경 규모를 검토하세요.');
  process.exit(1);
}

// ── 순수 병합 로직 (src/lib/hiraInsurance.ts 미러) ─────────────────────────────
function normalizeHiraStatus(raw) {
  const s = String(raw ?? '').replace(/\s/g, '').trim();
  if (s === '') return 'covered';
  if (/(비급여|전액본인|100\/100|100분의100)/.test(s)) return 'non_covered';
  if (/(급여삭제|삭제|등재취소|경과조치종료|등재말소|말소)/.test(s)) return 'deleted';
  if (/(급여기준변경|기준변경|사용범위변경|적응증변경)/.test(s)) return 'criteria_changed';
  if (/(급여|등재|정상|유지)/.test(s)) return 'covered';
  return null;
}
function resolveInsuranceMerge(existing, hiraStatus, forceOverwriteManual) {
  if (hiraStatus === null) return { action: 'skip_invalid', nextStatus: null };
  const curStatus = (existing.insurance_status ?? '').trim() || null;
  const curSource = (existing.insurance_status_source ?? '').trim() || null;
  if (curSource === 'manual' && curStatus !== null && !forceOverwriteManual) {
    return { action: 'skip_manual', nextStatus: null };
  }
  if (curStatus === hiraStatus) return { action: 'noop', nextStatus: hiraStatus };
  return { action: 'update', nextStatus: hiraStatus };
}

// ── column auto-detect ────────────────────────────────────────────────────────
const CODE_COL_CANDIDATES = ['청구코드', '제품코드', 'EDI코드', 'edi코드', '보험코드', '약품코드'];
const STATUS_COL_CANDIDATES = ['급여구분', '구분', '급여여부', '비고', '상태'];
function findCol(header, explicit, candidates) {
  if (explicit) {
    const i = header.indexOf(explicit);
    if (i < 0) throw new Error(`지정한 컬럼 '${explicit}' 가 헤더에 없음. 헤더: ${header.join(', ')}`);
    return i;
  }
  for (const c of candidates) {
    const i = header.findIndex((h) => String(h ?? '').replace(/\s/g, '') === c.replace(/\s/g, ''));
    if (i >= 0) return i;
  }
  return -1;
}

// ── DB ────────────────────────────────────────────────────────────────────────
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }
const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

let runId = null;

async function logRunStart() {
  const { rows } = await client.query(
    `INSERT INTO insurance_sync_runs (source, source_file, source_period, mode, status, run_by)
     VALUES ('hira', $1, $2, $3, 'running', $4) RETURNING id;`,
    [FILE.split('/').pop(), PERIOD, MODE, RUN_BY],
  );
  runId = rows[0].id;
}
async function logRunFinish(status, tally, errorMessage = null) {
  if (!runId) return;
  await client.query(
    `UPDATE insurance_sync_runs
       SET status=$2, total_rows=$3, matched=$4, updated=$5, skipped_manual=$6,
           skipped_nochange=$7, unmatched=$8, error_message=$9, finished_at=now()
     WHERE id=$1;`,
    [runId, status, tally.total_rows, tally.matched, tally.updated,
     tally.skipped_manual, tally.skipped_nochange, tally.unmatched, errorMessage],
  );
}

try {
  // 1) parse xlsx
  console.log(`📄 파일 파싱: ${FILE}`);
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[SHEET_IDX]];
  if (!ws) throw new Error(`시트 인덱스 ${SHEET_IDX} 없음 (시트: ${wb.SheetNames.join(', ')})`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = (raw[0] ?? []).map((h) => String(h ?? '').trim());
  const codeIdx = findCol(header, CODE_COL, CODE_COL_CANDIDATES);
  if (codeIdx < 0) throw new Error(`청구코드 컬럼 자동탐지 실패. --code-col 로 지정. 헤더: ${header.join(', ')}`);
  const statusIdx = findCol(header, STATUS_COL, STATUS_COL_CANDIDATES); // -1 허용 → 전부 covered
  console.log(`  코드 컬럼: '${header[codeIdx]}'(${codeIdx})  급여구분 컬럼: ${statusIdx >= 0 ? `'${header[statusIdx]}'(${statusIdx})` : '없음 → 전부 covered 간주'}`);

  // 파일 행 → {claim_code, hiraStatus}
  const parsed = new Map(); // claim_code → hiraStatus (마지막값 유지)
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r[codeIdx] == null || String(r[codeIdx]).trim() === '') continue;
    const code = String(r[codeIdx]).trim();
    const statusRaw = statusIdx >= 0 ? r[statusIdx] : '';
    parsed.set(code, normalizeHiraStatus(statusRaw));
  }
  const tally = { total_rows: parsed.size, matched: 0, updated: 0, skipped_manual: 0, skipped_nochange: 0, unmatched: 0 };
  console.log(`  파싱 약품 row: ${tally.total_rows}`);

  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE}${FORCE_MANUAL ? ', force-overwrite-manual' : ''})`);
  await logRunStart();

  // 2) 기존 prescription_codes 매칭 조회 (claim_code IN ...)
  const codes = [...parsed.keys()];
  const existingMap = new Map();
  const CHUNK = 1000;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const slice = codes.slice(i, i + CHUNK);
    const { rows } = await client.query(
      `SELECT claim_code, insurance_status, insurance_status_source
         FROM prescription_codes WHERE claim_code = ANY($1::text[]);`,
      [slice],
    );
    for (const row of rows) existingMap.set(row.claim_code, row);
  }

  // 3) 병합 결정 + 갱신 대상 수집
  const updates = []; // {claim_code, nextStatus}
  const samples = [];
  for (const [code, hiraStatus] of parsed) {
    const existing = existingMap.get(code);
    if (!existing) { tally.unmatched += 1; continue; }
    tally.matched += 1;
    const d = resolveInsuranceMerge(existing, hiraStatus, FORCE_MANUAL);
    if (d.action === 'update') {
      tally.updated += 1;
      updates.push({ claim_code: code, nextStatus: d.nextStatus });
      if (samples.length < 20) samples.push(`${code}: ${existing.insurance_status ?? '미설정'} → ${d.nextStatus}`);
    } else if (d.action === 'skip_manual') tally.skipped_manual += 1;
    else tally.skipped_nochange += 1; // noop / skip_invalid
  }

  // 4) 리포트
  console.log('\n── 동기화 리포트 ──');
  console.table({
    파싱행: tally.total_rows, 매칭: tally.matched, 미매칭: tally.unmatched,
    갱신대상: tally.updated, 수동보존: tally.skipped_manual, 변경없음: tally.skipped_nochange,
  });
  if (samples.length) {
    console.log(`\n변경 예시(최대 20):\n  ${samples.join('\n  ')}`);
  }

  if (MODE === 'dry_run') {
    await logRunFinish('success', tally);
    console.log(`\n🟡 dry-run 종료 (변경 없음). 실제 적용: --apply --confirm  [run ${runId}]`);
    await client.end();
    process.exit(0);
  }

  // 5) apply — 트랜잭션 upsert(source='hira')
  console.log(`\n── APPLY: ${updates.length}건 갱신 (source='hira') ──`);
  await client.query('BEGIN');
  for (const u of updates) {
    await client.query(
      `UPDATE prescription_codes
         SET insurance_status=$2, insurance_status_updated_at=now(), insurance_status_source='hira'
       WHERE claim_code=$1;`,
      [u.claim_code, u.nextStatus],
    );
  }
  await client.query('COMMIT');
  console.log('✅ COMMIT 완료');
  await logRunFinish('success', tally);

  await client.end();
  console.log(`\n🟢 done. [run ${runId}]`);
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  // 실패도 기록(AC4) — 단, DB 연결 후에만 가능
  try { await logRunFinish('failed', { total_rows: 0, matched: 0, updated: 0, skipped_manual: 0, skipped_nochange: 0, unmatched: 0 }, e.message); } catch {}
  await client.end().catch(() => {});
  process.exit(1);
}
