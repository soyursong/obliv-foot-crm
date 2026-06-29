/**
 * T-20260610-foot-RESV-DUPGUARD-SAMEDAY — reservations dedupe DRY-RUN (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. 어떤 row 도 변경/삭제하지 않는다.
 *    STEP1 그라운딩 게이트(AC-0 #3) + idx_reservations_customer_daily UNIQUE index
 *    생성 전 GO_WARN 게이트 선행조사.
 *
 * 선행 정본: scripts/dedupe_checkins_walkin_daily_dryrun_report.mjs (SELFCHECKIN-DUP-GUARD)
 * 분기 해석 (a): reservations 당일 1건 강제 — (clinic_id, customer_id, reservation_date)
 *               status NOT IN ('cancelled') 활성 중복 그룹 산출.
 *
 * 산출: stdout JSON + scripts/out/resv_dedupe_dryrun_report.md
 * 실행: node scripts/dedupe_reservations_customer_daily_dryrun.mjs
 */
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

// 과일/식물 가명 패턴 (QA 데이터 식별)
const FRUIT_RE = /(망고스틴|람부탄|잭프루트|올리브|망고|두리안|파파야|구아바|리치|용과|패션후르츠|패션프루츠|코코넛|파인애플|키위|블루베리|라즈베리|크랜베리|체리|살구|자몽|레몬|라임|오렌지|귤|복숭아|자두|매실|모과|석류|무화과|대추|밤|호두|아몬드|피스타치오|캐슈|아보카도|토마토|딸기|수박|참외|멜론|포도|배|사과|감|바나나|테스트|test|QA|샘플|샘플환자|홍길동|김철수|이영희|아무개)/i;

function kstToday() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}
function daysAgoKST(dateStr) {
  const today = new Date(kstToday() + 'T00:00:00Z');
  const d = new Date(dateStr + 'T00:00:00Z');
  return Math.round((today - d) / (24 * 3600 * 1000));
}

(async () => {
  await client.connect();

  // [1] 위반 그룹 요약: (clinic_id, customer_id, reservation_date) 활성 중복
  //     customer_id 있는 예약만 — index 가 customer_id NOT NULL partial 이므로 동일 스코프.
  const { rows: groups } = await client.query(`
    SELECT clinic_id, customer_id, reservation_date,
           count(*) AS active_resv
    FROM public.reservations
    WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
    GROUP BY clinic_id, customer_id, reservation_date
    HAVING count(*) > 1
    ORDER BY active_resv DESC, reservation_date DESC;
  `);

  // [2] 위반 그룹의 모든 row 상세
  const { rows: detail } = await client.query(`
    WITH dup_groups AS (
      SELECT clinic_id, customer_id, reservation_date
      FROM public.reservations
      WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
      GROUP BY clinic_id, customer_id, reservation_date
      HAVING count(*) > 1
    )
    SELECT r.id, r.clinic_id, r.customer_id, r.customer_name, r.customer_phone,
           r.status, r.reservation_date, r.reservation_time, r.visit_type, r.created_at,
           (r.created_at = max(r.created_at) OVER (
              PARTITION BY r.clinic_id, r.customer_id, r.reservation_date
            )) AS is_latest_in_group,
           (regexp_replace(COALESCE(r.customer_phone,''),'[^0-9]','','g') ~ '(9999|0000|1111|99990|99060)') AS looks_test_phone
    FROM public.reservations r
    JOIN dup_groups g
      ON g.clinic_id = r.clinic_id AND g.customer_id = r.customer_id
     AND g.reservation_date = r.reservation_date
    WHERE r.status NOT IN ('cancelled')
    ORDER BY r.clinic_id, r.customer_id, r.reservation_date, r.created_at;
  `);

  // [3] phone-only(customer_id NULL) 중복도 참고용으로 별도 집계 (index 미커버 — FE/RPC 가드만 방어)
  const { rows: phoneDup } = await client.query(`
    SELECT clinic_id,
           regexp_replace(COALESCE(customer_phone,''),'[^0-9]','','g') AS phone_digits,
           reservation_date, count(*) AS n
    FROM public.reservations
    WHERE status NOT IN ('cancelled')
      AND customer_id IS NULL
      AND length(regexp_replace(COALESCE(customer_phone,''),'[^0-9]','','g')) >= 10
    GROUP BY clinic_id, phone_digits, reservation_date
    HAVING count(*) > 1
    ORDER BY n DESC;
  `);

  await client.end();

  const groupMap = new Map();
  for (const r of detail) {
    const key = `${r.clinic_id}|${r.customer_id}|${r.reservation_date}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(r);
  }

  const report = [];
  let qaGroups = 0, realGroups = 0, totalDrop = 0;
  for (const [key, rows] of groupMap) {
    // keep 후보: created_at 최신 (예약은 status 진행도가 단순 → 최신 유지)
    const sorted = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const keep = sorted[0];
    const drops = sorted.slice(1);
    const names = rows.map((r) => r.customer_name || '');
    const allQa = rows.every((r) => FRUIT_RE.test(r.customer_name || '') || r.looks_test_phone);
    const rdate = rows[0].reservation_date instanceof Date
      ? rows[0].reservation_date.toISOString().slice(0, 10)
      : String(rows[0].reservation_date).slice(0, 10);
    const recentDays = daysAgoKST(rdate);
    if (allQa) qaGroups++; else realGroups++;
    totalDrop += drops.length;
    report.push({
      key, reservation_date: rdate, recent_days: recentDays,
      classification: allQa ? 'QA일괄정리' : '행별confirm필요',
      clinic_id: rows[0].clinic_id, customer_id: rows[0].customer_id,
      names: [...new Set(names)], total_rows: rows.length,
      keep: { id: keep.id, status: keep.status, time: keep.reservation_time, created_at: keep.created_at },
      drop: drops.map((d) => ({ id: d.id, status: d.status, time: d.reservation_time, created_at: d.created_at, name: d.customer_name, phone: d.customer_phone, looks_test_phone: d.looks_test_phone })),
    });
  }
  report.sort((a, b) => {
    if (a.classification !== b.classification) return a.classification === '행별confirm필요' ? -1 : 1;
    return a.recent_days - b.recent_days;
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const summary = {
    generated_at: new Date().toISOString(),
    total_violation_groups: groupMap.size,
    total_rows: detail.length,
    total_drop_candidates: totalDrop,
    qa_groups: qaGroups,
    real_suspect_groups: realGroups,
    phone_only_dup_groups: phoneDup.length,
  };
  writeFileSync(join(OUT_DIR, 'resv_dedupe_dryrun_report.json'), JSON.stringify({ summary, report, phoneDup }, null, 2));

  let md = `# reservations dedupe DRY-RUN — T-20260610-foot-RESV-DUPGUARD-SAMEDAY\n\n`;
  md += `생성: ${summary.generated_at} · READ-ONLY (무변경)\n\n`;
  md += `## 요약 (GO_WARN 게이트 판정 자료)\n`;
  md += `- customer_id 활성 중복 그룹: **${summary.total_violation_groups}** ← idx_reservations_customer_daily 생성을 막는 그룹 수\n`;
  md += `- 총 row: **${summary.total_rows}** · drop 후보: **${summary.total_drop_candidates}**\n`;
  md += `- QA일괄정리: **${qaGroups}** · 행별confirm필요: **${realGroups}**\n`;
  md += `- phone-only(customer_id NULL) 중복 그룹: **${summary.phone_only_dup_groups}** (index 미커버 — FE/RPC 가드만 방어)\n\n`;
  md += summary.total_violation_groups === 0
    ? `> ✅ 활성 중복 0건 → UNIQUE index 즉시 생성 가능 (GO).\n\n`
    : `> ⛔ 활성 중복 ${summary.total_violation_groups}건 → index 생성 시 23505 실패. dedupe + 사람확인 선행 필수 (GO_WARN hold).\n\n`;

  md += `## A. 행별 confirm 필요 (실명 의심) — ${realGroups}그룹\n\n`;
  for (const g of report.filter((r) => r.classification === '행별confirm필요')) {
    md += `### [${g.reservation_date} · D-${g.recent_days}] ${g.names.join(', ')} (customer_id=${g.customer_id}, clinic=${g.clinic_id}) — ${g.total_rows}건\n`;
    md += `- ✅ KEEP id=\`${g.keep.id}\` status=${g.keep.status} time=${g.keep.time} created=${new Date(g.keep.created_at).toISOString()}\n`;
    for (const d of g.drop) md += `- ❌ DROP id=\`${d.id}\` status=${d.status} time=${d.time} phone=${d.phone ?? '-'}${d.looks_test_phone ? ' (test-phone)' : ''}\n`;
    md += `\n`;
  }
  md += `## B. QA 일괄정리 (가명/테스트) — ${qaGroups}그룹\n\n`;
  for (const g of report.filter((r) => r.classification === 'QA일괄정리')) {
    md += `### [${g.reservation_date} · D-${g.recent_days}] ${g.names.join(', ')} — ${g.total_rows}건 → keep \`${g.keep.id}\`, drop ${g.drop.length}건 [${g.drop.map((d) => d.id).join(', ')}]\n`;
  }
  writeFileSync(join(OUT_DIR, 'resv_dedupe_dryrun_report.md'), md);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n📄 리포트: scripts/out/resv_dedupe_dryrun_report.md (+ .json)`);
})().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
