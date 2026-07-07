/**
 * T-20260602-foot-SELFCHECKIN-DUP-INDEX — check_ins dedupe 집행 + partial UNIQUE index
 *
 * CEO 행별 confirm 스탬프(2026-07-07T16:39:40+0900, MSG-20260707-163441-ohqd):
 *   질문1(QA 가명 76건) = 일괄정리 OK → status='cancelled' 논리삭제.
 *   질문2(김민경 3건, +821043160981) = 유지(별개방문, 시각역전 근거) → drop 안 함.
 *
 * ⛔ 실행 결과는 idempotent + 가드형이다. index 는 활성중복 0 일 때만 생성.
 *   Step1: CEO 확인 q1 76건 status='cancelled' 논리삭제(DELETE 금지, 내방기록 보존).
 *          — 34일 경과 후 후속 cleanup 티켓들이 이미 물리삭제 → 실제 영향 0 (NO-OP, 무해).
 *   Step2: 재조사 — (clinic_id, customer_id, KST-day) status<>cancelled 활성중복 COUNT.
 *   Step3: 0 이면 idx_checkins_walkin_daily partial UNIQUE 적용. 아니면 ABORT(exit 2) + 잔존 덤프.
 *
 * ★ 구조적 가드: 김민경 3건(customer 83ab4fe1)은 전부 동일 KST-day(2026-06-02) 활성이다.
 *   partial index 키 = (clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date).
 *   → 3건 전부 keep 하면 동일 키 3중복 → CREATE UNIQUE INDEX 즉시 23505 실패.
 *   "별개방문"이라도 인덱스는 달력일(day) 단위라 동일일자면 충돌. CEO 유지 결정과 index 생성은 상충.
 *   본 applier 는 그 상충을 강제로 뭉개지 않고 정직하게 ABORT 하고 planner 로 되돌린다.
 *
 * 실행: SUPABASE_ACCESS_TOKEN (Management API) 사용. .env.local 자동 로드.
 *   node scripts/apply_20260602200010_checkins_dedupe_and_unique_index.mjs
 * 산출: scripts/out/checkins_dedupe_execution_report.md
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const REF = 'rxlomoozakkjesdqjtvd';

function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(__dirname, '..', f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

const TOKEN = envFromLocal('SUPABASE_ACCESS_TOKEN');
if (!TOKEN) { console.error('❌ missing SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

// ── CEO 질문1 confirm: QA 가명 76 drop-target (김민경 3건 제외) ──────────────
const CANCEL_IDS = [
  "23b18544-9bca-4d30-a1ea-00e51f13419b",
  "660e6302-78a6-49c0-b8af-854819a3252c",
  "1a3e6007-464d-4737-a113-ddb2858655d4",
  "4853089f-83f4-48b5-a2f8-422c5d4e1b1e",
  "24109dd8-e487-42e3-8815-407a691ac85c",
  "bb4150da-b50a-4f3e-bdf2-62ca23035d85",
  "0b5c5f01-3712-498f-9155-9eeab5dbc7fe",
  "1cd44ff6-5c83-42b7-ad2a-7b8deb5707ba",
  "61d33721-7f43-439b-a042-ea35f3e89aac",
  "4a38d701-c13a-4130-87e4-d64ced7a43af",
  "28eb1609-72a2-4c16-9195-1a9059a3760a",
  "c8fb85bb-d09b-449e-b894-e02ca0094012",
  "c44b669d-0fea-45e8-b818-fb766396bd36",
  "7bd7edc9-1720-4bc0-8d01-4c089a4d69c9",
  "42602561-bcda-4fb9-8c95-37f0c8d57d7d",
  "de7f4547-5da5-4bc3-83a4-5e58e8474dd5",
  "74f369ac-f75a-434d-bcd6-d003df119a7b",
  "79cca613-a011-4517-a6d4-4763628a1bde",
  "7257754c-b70d-4110-b5b5-4b28c398a52f",
  "cdc3227a-5016-4d3a-8911-80109151527d",
  "eb40d617-9c4b-441e-9294-7e3ba0804088",
  "c87943ac-207b-4099-a4be-e3f4dac2115d",
  "444d3a1d-da82-4d70-9ad2-d3e0d9d805c6",
  "7835a710-4953-4c5c-986b-5b0fd2b0ddf6",
  "b6afcfc5-a662-48b3-a664-89b1eee31413",
  "15c229f1-6b81-4889-9226-a9decf26d3ac",
  "8fbbf46f-1a78-4fc3-9cdc-6e673908c113",
  "845ee6c1-6b85-4786-ba5d-6ed7613f2946",
  "78e66c63-61dd-413b-bc2f-6264712adec1",
  "e36bd2ba-0a1c-4a2f-ac30-ca8481da58db",
  "92e43650-80b1-4d98-9f02-42c8f22ed3d8",
  "581ab82b-2cfd-4e95-b6bc-4a6d21a54abb",
  "6d63710c-b743-43aa-834b-73682837d3fa",
  "808fdf6b-b332-4c6c-abeb-4abcfbe253bc",
  "1348f48c-9776-4449-9365-6c55adbe556e",
  "ab5541ed-d692-4fd2-bf98-169eaa9aaeec",
  "7c043391-0708-4b20-9c3a-a9f8e693ec51",
  "dd5e5211-faf0-4e33-b484-d536621e07ac",
  "9fd4d8c5-5b7f-4148-a19f-48a2b4169d08",
  "b6184a63-2d17-4def-b867-1daf997cdcba",
  "9706e291-ed40-427c-8261-bbf084fa9ec7",
  "dd04926a-c1d5-4b48-ae45-ee358bcb6f49",
  "3acaa92e-f633-4900-b3ce-dbe18546b5eb",
  "809c88d8-788e-4542-8ecf-eb9fd4c16002",
  "2b14d652-003a-477f-901f-502c94e6e3ba",
  "0cd14833-a2a1-4c0a-a74b-1fe8c5b4a7da",
  "e9aa3bf0-43a8-428c-948c-7e0c207b5d75",
  "7c2b1e78-b90a-437b-8561-6e59fb6c982a",
  "b3b1b233-db51-45a6-9a32-1983e98466b1",
  "d09a526a-bae1-4a36-8827-9974de947d47",
  "9efa4c66-233a-41d4-a383-d49d61fb10c4",
  "b6735b62-edc5-4f1e-be1b-537379d65234",
  "367ad164-6cdd-4a4e-977f-07c00c8cdedb",
  "93e65097-3d12-47b5-b3a3-d9782d0225a2",
  "7e194a51-53a0-4af9-a6cc-8c6228b5226a",
  "48b3f10f-aa22-46cc-a127-da74b2c3e01a",
  "d5c1c78b-5801-4775-a693-92757a19d6cf",
  "da0631a8-bd73-4da4-ae22-5303fc83f448",
  "e052a361-85bf-484b-b968-9d9199a3f32f",
  "ac564354-8b94-485f-a7cd-34baebe18dc3",
  "4bcb512e-2d67-400e-bae0-3a7c7bc4e084",
  "a0a0426b-0337-4463-a6a5-73e9147177b0",
  "832f0bfb-67d1-47d8-84eb-7fc650f05b6a",
  "9ee5887b-806d-4879-9616-1c33a9144539",
  "a451e182-12c3-442d-9b18-615781444f5e",
  "04460969-b494-4a10-9de8-8a6a5a79904a",
  "432cdd59-0254-43bb-b8c1-597322e4be23",
  "170984db-dde5-49f0-822d-8bfe23c4e98a",
  "5f263bb5-6ec3-4a09-ad3d-83948b8682fa",
  "e0edccab-a28f-44ab-8c26-97b22c330d91",
  "fabb8eac-60d5-4977-87cc-7a01cb185799",
  "7fb42615-21bf-4387-9fa6-175b6381c1a7",
  "73eb2eca-8f94-431c-ada6-23a0cbb80699",
  "5036e988-998c-4022-bd78-97f99767c934",
  "36530484-c33a-4ac7-ac2b-452d56175821",
  "7533a0e2-f107-4eb1-863b-dea57dfb2cfb",
];

// ★ 절대 취소 금지 — CEO 질문2 "유지" 결정 (김민경 3건).
const NEVER_CANCEL_IDS = [
  "207bf234-8851-4a38-8c56-c0191bea96b8", // 김민경 done
  "6425a5c8-8fb7-46d6-a762-93d9922eeb48", // 김민경 done
  "d404c423-d638-4652-bf8c-daff068a361f", // 김민경 payment_waiting
];

const CANCEL_REASON =
  'dedupe: same-day duplicate QA cleanup (T-20260602-foot-SELFCHECKIN-DUP-INDEX, CEO confirm MSG-20260707-163441-ohqd)';

const log = [];
const out = (s) => { console.log(s); log.push(s); };

function sqlArray(ids) {
  return "ARRAY[" + ids.map((x) => `'${x}'`).join(",") + "]::uuid[]";
}

function writeReport(state) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md =
    `# check_ins dedupe 집행 결과 — T-20260602-foot-SELFCHECKIN-DUP-INDEX\n\n` +
    `상태: **${state}**\n` +
    `실행: dev-foot / Supabase Management API (prod ${REF}) / CEO confirm MSG-20260707-163441-ohqd\n\n` +
    "```\n" + log.join("\n") + "\n```\n";
  fs.writeFileSync(join(OUT_DIR, "checkins_dedupe_execution_report.md"), md);
}

// 안전망: CANCEL 목록에 KEEP id 혼입 금지
for (const k of NEVER_CANCEL_IDS) {
  if (CANCEL_IDS.includes(k)) {
    console.error(`❌ 치명: KEEP id ${k} 가 CANCEL 목록에 포함됨`);
    process.exit(1);
  }
}

(async () => {
  out(`🚀 T-20260602-foot-SELFCHECKIN-DUP-INDEX check_ins dedupe 집행`);
  out(`   CANCEL 후보(질문1): ${CANCEL_IDS.length}건 / NEVER_CANCEL(질문2 김민경): ${NEVER_CANCEL_IDS.length}건`);

  // ── Step0: 사전 조회 ──────────────────────────────────────────────────
  const pre = await q(
    `SELECT count(*)::int AS existing,
            count(*) FILTER (WHERE status <> 'cancelled')::int AS active
       FROM public.check_ins WHERE id = ANY(${sqlArray(CANCEL_IDS)});`
  );
  out(`\n[Step0] 질문1 대상 현존: ${pre[0].existing}건 (active ${pre[0].active}건)`);
  if (pre[0].existing === 0) {
    out(`   ℹ️ 질문1 76건은 이미 물리삭제됨(후속 cleanup 티켓). 논리삭제는 NO-OP(무해).`);
  }

  // ── Step1: 논리삭제 UPDATE (idempotent) ──────────────────────────────
  out(`\n[Step1] 질문1 대상 status='cancelled' 논리삭제 (DELETE 아님)`);
  // NB: check_ins 테이블에는 updated_at/cancelled_at/cancel_reason 컬럼이 없다 → status 만 갱신.
  const upd = await q(
    `UPDATE public.check_ins
        SET status = 'cancelled'
      WHERE id = ANY(${sqlArray(CANCEL_IDS)})
        AND status <> 'cancelled'
      RETURNING id;`
  );
  out(`   ✅ UPDATE 영향 row: ${upd.length}건`);

  // ── Step1.5: 김민경 3건 무결(활성 유지) 확인 ─────────────────────────
  const keep = await q(
    `SELECT id, status FROM public.check_ins WHERE id = ANY(${sqlArray(NEVER_CANCEL_IDS)});`
  );
  out(`\n[Step1.5] 김민경 3건 무결 확인: ${keep.length}/${NEVER_CANCEL_IDS.length}건`);
  for (const k of keep) out(`   KEEP ${k.id} status=${k.status}`);
  if (keep.some((k) => k.status === "cancelled")) {
    out(`   ❌ 치명: 김민경 KEEP 대상이 cancelled 됨 — 중단`);
    writeReport("FATAL_KEEP_CANCELLED");
    process.exit(1);
  }

  // ── Step2: 재조사 — 활성 중복 그룹 ───────────────────────────────────
  out(`\n[Step2] 재조사 — (clinic_id, customer_id, KST-day) 활성 중복 그룹`);
  const dup = await q(`
    SELECT count(*)::int AS dup_groups,
           COALESCE(sum(excess),0)::int AS excess_rows FROM (
      SELECT count(*) - 1 AS excess
      FROM public.check_ins
      WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
      GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
      HAVING count(*) > 1
    ) g;`);
  const { dup_groups, excess_rows } = dup[0];
  out(`   활성 중복 그룹: ${dup_groups} / index 차단 excess rows: ${excess_rows}`);

  if (dup_groups !== 0) {
    const residual = await q(`
      WITH dg AS (
        SELECT clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day
        FROM public.check_ins
        WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
        GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
        HAVING count(*) > 1)
      SELECT ci.customer_name, ci.customer_phone,
             (ci.created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
             count(*)::int AS n
      FROM public.check_ins ci
      JOIN dg ON dg.clinic_id=ci.clinic_id AND dg.customer_id=ci.customer_id
             AND dg.kst_day=(ci.created_at AT TIME ZONE 'Asia/Seoul')::date
      WHERE ci.status NOT IN ('cancelled')
      GROUP BY ci.customer_name, ci.customer_phone, (ci.created_at AT TIME ZONE 'Asia/Seoul')::date
      ORDER BY kst_day DESC;`);
    out(`   ⛔ 잔존 활성중복 → index 적용 보류(ABORT). 잔존 그룹:`);
    for (const r of residual) {
      out(`      [${r.kst_day}] ${r.customer_name} ${r.customer_phone ?? "-"} — ${r.n}건`);
    }
    out(`\n   ⚠️ 원인: 김민경 3건(동일 KST-day 2026-06-02) CEO "유지" + 미확인 테스트 그룹.`);
    out(`      partial index 는 day 단위라 김민경 3건 keep 시 동일 키 3중복 → 23505.`);
    out(`      → planner/CEO 재결정 필요. index 미적용으로 정직하게 종료.`);
    writeReport("ABORT_ACTIVE_DUP_REMAIN");
    process.exitCode = 2;
    return;
  }

  // ── Step3: index 적용 (활성중복 0 일 때만) ───────────────────────────
  out(`\n[Step3] 활성 중복 0 — idx_checkins_walkin_daily partial UNIQUE 적용`);
  const INDEX_SQL = fs.readFileSync(
    join(__dirname, "../supabase/migrations/20260602200010_checkins_walkin_daily_unique.sql"),
    "utf8"
  );
  await q(INDEX_SQL);
  const idx = await q(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename='check_ins' AND indexname='idx_checkins_walkin_daily';`);
  if (idx.length < 1) throw new Error("index 검증 실패 — pg_indexes 미존재");
  out(`   ✅ index 존재 확인: ${idx[0].indexname}`);
  out(`      def: ${idx[0].indexdef}`);
  out(`\n🏁 집행 완료 — DB 게이트 종결. 부모 GUARD db_applied=true 전환 가능.`);
  writeReport("DONE_INDEX_CREATED");
})().catch((e) => {
  out(`❌ 치명: ${e.message}`);
  writeReport("FATAL");
  process.exitCode = 1;
});
