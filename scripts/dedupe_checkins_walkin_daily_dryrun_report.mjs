/**
 * T-20260602-foot-SELFCHECKIN-DUP-INDEX — dedupe DRY-RUN 분류 리포트 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. 어떤 row 도 변경/삭제하지 않는다.
 *    GO_WARN 게이트 선행조사: (clinic_id, customer_id, KST-day) status<>cancelled
 *    활성 중복 그룹/row 를 상세 산출 + (가명 QA / 실명 의심) 자동 분류 + keep/drop 후보.
 *
 * 산출: stdout JSON + scripts/out/dedupe_dryrun_report.md
 * 실행: node scripts/dedupe_checkins_walkin_daily_dryrun_report.mjs
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

// 과일/식물 가명 패턴 (5/29 QA 집중 투입 데이터)
const FRUIT_RE = /(망고스틴|람부탄|잭프루트|올리브|망고|두리안|파파야|구아바|리치|용과|패션후르츠|패션프루츠|코코넛|파인애플|키위|블루베리|라즈베리|크랜베리|체리|살구|자몽|레몬|라임|오렌지|귤|복숭아|자두|매실|모과|석류|무화과|대추|밤|호두|아몬드|피스타치오|캐슈|아보카도|토마토|딸기|수박|참외|멜론|포도|배|사과|감|바나나|테스트|test|QA|샘플|샘플환자|홍길동|김철수|이영희|아무개)/i;

// KST 최근 N일 (오늘 포함) 경계
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

  // [1] 위반 그룹 요약
  const { rows: groups } = await client.query(`
    SELECT clinic_id, customer_id,
           (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
           count(*) AS active_checkins
    FROM public.check_ins
    WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
    GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
    HAVING count(*) > 1
    ORDER BY active_checkins DESC, kst_day DESC;
  `);

  // [2] 위반 그룹의 모든 row 상세
  const { rows: detail } = await client.query(`
    WITH dup_groups AS (
      SELECT clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day
      FROM public.check_ins
      WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
      GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
      HAVING count(*) > 1
    )
    SELECT ci.id, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone,
           ci.status, ci.queue_number, ci.reservation_id, ci.created_at,
           (ci.created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
           (ci.created_at = max(ci.created_at) OVER (
              PARTITION BY ci.clinic_id, ci.customer_id, (ci.created_at AT TIME ZONE 'Asia/Seoul')::date
            )) AS is_latest_in_group,
           (regexp_replace(COALESCE(ci.customer_phone,''),'[^0-9]','','g') ~ '(9999|0000|1111|99990|99060)') AS looks_test_phone
    FROM public.check_ins ci
    JOIN dup_groups g
      ON g.clinic_id = ci.clinic_id AND g.customer_id = ci.customer_id
     AND g.kst_day = (ci.created_at AT TIME ZONE 'Asia/Seoul')::date
    WHERE ci.status NOT IN ('cancelled')
    ORDER BY ci.clinic_id, ci.customer_id, kst_day, ci.created_at;
  `);

  // status 분포 (진행도 정렬 근거)
  const { rows: statusDist } = await client.query(`
    SELECT status, count(*) AS n FROM public.check_ins
    WHERE status NOT IN ('cancelled') GROUP BY status ORDER BY n DESC;
  `);

  await client.end();

  // ── 진행도 순위 (높을수록 보존 우선) — 풋 신규/재진 동선 반영 ──
  //   신규: registered→exam_waiting→consult_waiting→consultation→payment_waiting→treatment_waiting→laser→done
  //   재진: registered→treatment_waiting→preconditioning→laser→done
  const STATUS_RANK = {
    done: 100, completed: 100,
    laser: 90,
    preconditioning: 80,
    treatment_waiting: 70,
    payment_waiting: 60,
    healer_waiting: 55,
    consultation: 50,
    consult_waiting: 40,
    exam_waiting: 20,
    registered: 10, receiving: 8, pending: 5,
  };
  const rank = (s) => (STATUS_RANK[s] ?? 35);

  // ── 그룹 단위로 묶고 분류 ──
  const groupMap = new Map();
  for (const r of detail) {
    const key = `${r.clinic_id}|${r.customer_id}|${r.kst_day}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(r);
  }

  const report = [];
  let qaGroups = 0, realGroups = 0, totalDrop = 0;
  for (const [key, rows] of groupMap) {
    // keep 후보: 진행도 max → 동률 시 created_at 최신
    const sorted = [...rows].sort((a, b) => {
      const rk = rank(b.status) - rank(a.status);
      if (rk !== 0) return rk;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    const keep = sorted[0];
    const drops = sorted.slice(1);

    // 분류: 그룹 내 모든 row 가 (과일가명 OR 테스트전화) 면 QA일괄정리, 아니면 행별confirm필요
    const names = rows.map((r) => r.customer_name || '');
    const allQa = rows.every(
      (r) => FRUIT_RE.test(r.customer_name || '') || r.looks_test_phone,
    );
    const kstDay = rows[0].kst_day instanceof Date
      ? rows[0].kst_day.toISOString().slice(0, 10)
      : String(rows[0].kst_day).slice(0, 10);
    const recentDays = daysAgoKST(kstDay);
    const classification = allQa ? 'QA일괄정리' : '행별confirm필요';
    if (allQa) qaGroups++; else realGroups++;
    totalDrop += drops.length;

    report.push({
      key, kst_day: kstDay, recent_days: recentDays, classification,
      clinic_id: rows[0].clinic_id, customer_id: rows[0].customer_id,
      names: [...new Set(names)],
      total_rows: rows.length,
      keep: { id: keep.id, status: keep.status, created_at: keep.created_at, queue: keep.queue_number, reservation_id: keep.reservation_id },
      drop: drops.map((d) => ({ id: d.id, status: d.status, created_at: d.created_at, queue: d.queue_number, reservation_id: d.reservation_id, name: d.customer_name, phone: d.customer_phone, looks_test_phone: d.looks_test_phone })),
    });
  }

  report.sort((a, b) => {
    // 실명 의심 + 최근건 먼저
    if (a.classification !== b.classification) return a.classification === '행별confirm필요' ? -1 : 1;
    return a.recent_days - b.recent_days;
  });

  // ── 출력 ──
  mkdirSync(OUT_DIR, { recursive: true });
  const summary = {
    generated_at: new Date().toISOString(),
    total_violation_groups: groupMap.size,
    total_rows: detail.length,
    total_drop_candidates: totalDrop,
    qa_groups: qaGroups,
    real_suspect_groups: realGroups,
    status_distribution: statusDist,
  };
  writeFileSync(join(OUT_DIR, 'dedupe_dryrun_report.json'), JSON.stringify({ summary, report }, null, 2));

  // markdown
  let md = `# dedupe DRY-RUN 분류 리포트 — T-20260602-foot-SELFCHECKIN-DUP-INDEX\n\n`;
  md += `생성: ${summary.generated_at} · READ-ONLY (무변경)\n\n`;
  md += `## 요약\n`;
  md += `- 활성 중복 그룹: **${summary.total_violation_groups}**\n`;
  md += `- 총 row: **${summary.total_rows}**\n`;
  md += `- drop(삭제) 후보: **${summary.total_drop_candidates}** (그룹당 활성 1건 keep, 나머지 drop)\n`;
  md += `- QA일괄정리 그룹: **${qaGroups}** · 행별confirm필요 그룹: **${realGroups}**\n\n`;
  md += `> keep 원칙: 워크플로 진행도 max → 동률 시 created_at 최신. drop 정리 방식: status='cancelled' 논리삭제(가드/인덱스 카운트 제외).\n\n`;

  md += `## A. 행별 confirm 필요 (실명 의심) — ${realGroups}그룹\n\n`;
  for (const g of report.filter((r) => r.classification === '행별confirm필요')) {
    md += `### [${g.kst_day} · D-${g.recent_days}] ${g.names.join(', ')} (customer_id=${g.customer_id}, clinic=${g.clinic_id}) — ${g.total_rows}건\n`;
    md += `- ✅ KEEP id=\`${g.keep.id}\` status=${g.keep.status} created=${new Date(g.keep.created_at).toISOString()} queue=${g.keep.queue ?? '-'}\n`;
    for (const d of g.drop) {
      md += `- ❌ DROP id=\`${d.id}\` status=${d.status} created=${new Date(d.created_at).toISOString()} queue=${d.queue ?? '-'} phone=${d.phone ?? '-'}${d.looks_test_phone ? ' (test-phone)' : ''}\n`;
    }
    md += `\n`;
  }

  md += `## B. QA 일괄정리 (가명/테스트) — ${qaGroups}그룹\n\n`;
  for (const g of report.filter((r) => r.classification === 'QA일괄정리')) {
    md += `### [${g.kst_day} · D-${g.recent_days}] ${g.names.join(', ')} (customer_id=${g.customer_id}) — ${g.total_rows}건 → keep \`${g.keep.id}\`(${g.keep.status}), drop ${g.drop.length}건 [${g.drop.map((d) => d.id).join(', ')}]\n`;
  }

  writeFileSync(join(OUT_DIR, 'dedupe_dryrun_report.md'), md);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n📄 리포트: scripts/out/dedupe_dryrun_report.md (+ .json)`);
})().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
