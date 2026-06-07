/**
 * T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX — AC1 dry-run 인벤토리 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. 어떤 UPDATE/DELETE/ALTER 도 실행하지 않는다.
 *    supervisor DB 게이트(AC4) GO 전까지 정비 SQL 금지. 본 스크립트는 인벤토리 산출만.
 *
 * 3집합 산출:
 *   ① NULL 고아 check_in (customer_id IS NULL) — 차트/결제/패키지/서비스 연결 유무 포함
 *   ② 동일 customer_id + 동일 KST 방문일 + visit_type='new' 2건+ 그룹
 *   ③ 각 그룹/row 정본·오류 판정 근거 (차트연결·결제연결·서비스연결·생성시각·진행도)
 *
 * 가드: 더미/테스트명(초진환자N·신규·테스트·김팔번 등)은 범위 외 → looks_dummy 플래그만, 정비대상 제외
 *
 * 산출: stdout JSON + scripts/out/T-20260607-CHECKIN-DUP-NULL_ac1_inventory.md (+.json)
 * 실행: node scripts/T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX_ac1_inventory.mjs
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
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

// 더미/테스트명 패턴 — 범위 외 (가드#4). 정비대상 제외하되 인벤토리에는 카운트.
const DUMMY_RE = /(초진환자\d*|재진환자\d*|신규환자\d*|^신규$|테스트|test|QA|샘플|김팔번|홍길동|김철수|이영희|아무개|망고스틴|람부탄|잭프루트|올리브|망고|두리안|파파야|구아바|리치|용과|패션|코코넛|파인애플|키위|블루베리|라즈베리|크랜베리|자몽|환자\d+|더미|dummy|sample)/i;
const TEST_PHONE_RE = /(9999|0000|1111|99990|99060|12345678|00000000)/;

const STATUS_RANK = {
  done: 100, completed: 100, laser: 90, preconditioning: 80,
  treatment_waiting: 70, payment_waiting: 60, healer_waiting: 55,
  consultation: 50, consult_waiting: 40, examination: 30,
  checklist: 25, exam_waiting: 20, registered: 10, receiving: 8, pending: 5,
};
const rank = (s) => (STATUS_RANK[s] ?? 35);

function kstToday() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}
function daysAgoKST(dateStr) {
  const today = new Date(kstToday() + 'T00:00:00Z');
  const d = new Date(dateStr + 'T00:00:00Z');
  return Math.round((today - d) / (24 * 3600 * 1000));
}
const toDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

(async () => {
  await client.connect();

  // 연결지표 공통 CTE — payment / package_session / check_in_service / medical_chart
  // medical_charts 는 (customer_id, visit_date) 로 연결 (check_in_id 없음)
  const LINK_SELECT = `
    EXISTS (SELECT 1 FROM payments p WHERE p.check_in_id = ci.id) AS has_payment,
    (SELECT count(*) FROM payments p WHERE p.check_in_id = ci.id) AS n_payment,
    EXISTS (SELECT 1 FROM package_sessions ps WHERE ps.check_in_id = ci.id) AS has_pkg_session,
    EXISTS (SELECT 1 FROM check_in_services cs WHERE cs.check_in_id = ci.id) AS has_service,
    (SELECT count(*) FROM check_in_services cs WHERE cs.check_in_id = ci.id) AS n_service,
    CASE WHEN ci.customer_id IS NULL THEN false
         ELSE EXISTS (
           SELECT 1 FROM medical_charts mc
           WHERE mc.customer_id = ci.customer_id
             AND mc.visit_date = (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
         ) END AS has_chart
  `;

  // ── ① NULL 고아 check_in (전체 history, status 무관) ──
  const { rows: orphans } = await client.query(`
    SELECT ci.id, ci.clinic_id, ci.customer_name, ci.customer_phone, ci.visit_type,
           ci.status, ci.queue_number, ci.reservation_id, ci.package_id,
           ci.checked_in_at, ci.created_at,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
           ${LINK_SELECT}
    FROM check_ins ci
    WHERE ci.customer_id IS NULL
    ORDER BY ci.checked_in_at DESC NULLS LAST, ci.created_at DESC;
  `);

  // ── ② 동일 customer_id + 동일 KST 방문일 + visit_type='new' 2건+ 그룹 ──
  const { rows: dupGroups } = await client.query(`
    SELECT ci.customer_id,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
           count(*) AS n_new,
           array_agg(DISTINCT ci.customer_name) AS names
    FROM check_ins ci
    WHERE ci.customer_id IS NOT NULL AND ci.visit_type = 'new'
    GROUP BY ci.customer_id, (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
    HAVING count(*) > 1
    ORDER BY n_new DESC, kst_day DESC;
  `);

  // ── ②-detail: 위 그룹의 모든 'new' row 상세 + 연결지표 ──
  const { rows: dupDetail } = await client.query(`
    WITH g AS (
      SELECT ci.customer_id, (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day
      FROM check_ins ci
      WHERE ci.customer_id IS NOT NULL AND ci.visit_type = 'new'
      GROUP BY ci.customer_id, (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
      HAVING count(*) > 1
    )
    SELECT ci.id, ci.clinic_id, ci.customer_id, ci.customer_name, ci.customer_phone,
           ci.visit_type, ci.status, ci.queue_number, ci.reservation_id, ci.package_id,
           ci.checked_in_at, ci.created_at,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
           ${LINK_SELECT}
    FROM check_ins ci
    JOIN g ON g.customer_id = ci.customer_id
          AND g.kst_day = (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
    WHERE ci.visit_type = 'new'
    ORDER BY ci.customer_id, kst_day, ci.created_at;
  `);

  // 참고용 전체 카운트
  const { rows: totals } = await client.query(`
    SELECT
      (SELECT count(*) FROM check_ins) AS total_checkins,
      (SELECT count(*) FROM check_ins WHERE customer_id IS NULL) AS null_orphans,
      (SELECT count(*) FROM check_ins WHERE visit_type='new') AS new_checkins;
  `);

  await client.end();

  const isDummy = (name, phone) =>
    DUMMY_RE.test(name || '') || TEST_PHONE_RE.test((phone || '').replace(/[^0-9]/g, ''));

  // ── ① 고아 분류 ──
  const orphanRows = orphans.map((r) => {
    const hasActivity = r.has_payment || r.has_pkg_session || r.has_service;
    return {
      id: r.id,
      kst_day: toDay(r.kst_day),
      name: r.customer_name,
      phone: r.customer_phone,
      visit_type: r.visit_type,
      status: r.status,
      reservation_id: r.reservation_id,
      package_id: r.package_id,
      has_payment: r.has_payment, n_payment: Number(r.n_payment),
      has_pkg_session: r.has_pkg_session,
      has_service: r.has_service, n_service: Number(r.n_service),
      created_at: r.created_at,
      looks_dummy: isDummy(r.customer_name, r.customer_phone),
      // 판정: 활동 연결 있으면 보존검토(고객 매핑 필요) / 없으면 안전삭제 후보 / 더미면 범위외
      verdict: isDummy(r.customer_name, r.customer_phone)
        ? '범위외(더미/테스트)'
        : hasActivity
          ? '보존검토(고객매핑 필요·차트/결제/서비스 연결有)'
          : '고아삭제후보(연결無)',
    };
  });

  // ── ② 그룹별 정본/오류 판정 ──
  const groupMap = new Map();
  for (const r of dupDetail) {
    const key = `${r.customer_id}|${toDay(r.kst_day)}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(r);
  }

  const dupReport = [];
  for (const [key, rows] of groupMap) {
    const [customer_id, kst_day] = key.split('|');
    const allDummy = rows.every((r) => isDummy(r.customer_name, r.customer_phone));
    // 정본(keep) 점수: 차트(+8) > 결제(+4) > 서비스(+2) > 진행도 > 최초 생성(선점)
    const scored = rows.map((r) => ({
      r,
      score:
        (r.has_chart ? 8 : 0) +
        (r.has_payment ? 4 : 0) +
        (r.has_service ? 2 : 0) +
        rank(r.status) / 100,
    }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 동점이면 먼저 생성된 row 를 정본으로 (운영자 선점)
      return new Date(a.r.created_at) - new Date(b.r.created_at);
    });
    const keep = scored[0].r;
    const errs = scored.slice(1).map((s) => s.r);

    // 오류후보가 전부 '연결 없음'이면 운영자오류중복(자동), 일부라도 연결 있으면 모호→planner
    const errsAllEmpty = errs.every(
      (e) => !e.has_chart && !e.has_payment && !e.has_pkg_session && !e.has_service,
    );
    const classification = allDummy
      ? '범위외(더미/테스트)'
      : errsAllEmpty
        ? '운영자오류중복(오류건 연결無 → 정비후보)'
        : '모호(오류건에도 연결有 → planner 확인 필요·문지은 대표원장)';

    dupReport.push({
      key, customer_id, kst_day, recent_days: daysAgoKST(kst_day),
      classification,
      names: [...new Set(rows.map((r) => r.customer_name))],
      n_rows: rows.length,
      keep: pick(keep),
      err: errs.map(pick),
    });
  }
  dupReport.sort((a, b) => {
    const order = (c) => (c.startsWith('모호') ? 0 : c.startsWith('운영자') ? 1 : 2);
    const d = order(a.classification) - order(b.classification);
    return d !== 0 ? d : a.recent_days - b.recent_days;
  });

  function pick(r) {
    return {
      id: r.id, status: r.status, visit_type: r.visit_type,
      created_at: r.created_at, checked_in_at: r.checked_in_at,
      queue: r.queue_number, reservation_id: r.reservation_id, package_id: r.package_id,
      has_chart: r.has_chart, has_payment: r.has_payment, n_payment: Number(r.n_payment),
      has_pkg_session: r.has_pkg_session, has_service: r.has_service, n_service: Number(r.n_service),
      phone: r.customer_phone,
    };
  }

  // ── 요약 ──
  const orphanReal = orphanRows.filter((r) => !r.looks_dummy);
  const orphanSafe = orphanReal.filter((r) => r.verdict.startsWith('고아삭제후보'));
  const orphanKeep = orphanReal.filter((r) => r.verdict.startsWith('보존검토'));
  const dupReal = dupReport.filter((g) => !g.classification.startsWith('범위외'));
  const dupAuto = dupReport.filter((g) => g.classification.startsWith('운영자'));
  const dupAmbig = dupReport.filter((g) => g.classification.startsWith('모호'));

  const summary = {
    generated_at: new Date().toISOString(),
    READ_ONLY: true,
    totals: totals[0],
    orphans: {
      total: orphanRows.length,
      dummy_outofscope: orphanRows.length - orphanReal.length,
      real: orphanReal.length,
      safe_delete_candidate: orphanSafe.length,
      keep_review_mapping_needed: orphanKeep.length,
    },
    dup_new_groups: {
      total: dupReport.length,
      dummy_outofscope: dupReport.length - dupReal.length,
      operator_dup_auto: dupAuto.length,
      ambiguous_planner: dupAmbig.length,
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'T-20260607-CHECKIN-DUP-NULL_ac1_inventory.json'),
    JSON.stringify({ summary, orphanRows, dupReport }, null, 2),
  );

  // ── markdown ──
  let md = `# AC1 dry-run 인벤토리 — T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX\n\n`;
  md += `생성: ${summary.generated_at} · **READ-ONLY (무변경)** · KST 방문일=checked_in_at AT TIME ZONE 'Asia/Seoul'\n\n`;
  md += `## 요약\n`;
  md += `- 전체 check_ins: ${summary.totals.total_checkins} / NULL 고아: ${summary.totals.null_orphans} / visit_type=new: ${summary.totals.new_checkins}\n`;
  md += `- **① NULL 고아**: 총 ${summary.orphans.total} (더미 ${summary.orphans.dummy_outofscope} 제외 → 실 ${summary.orphans.real})\n`;
  md += `    - 고아삭제후보(연결無): **${summary.orphans.safe_delete_candidate}** · 보존검토(연결有·매핑필요): **${summary.orphans.keep_review_mapping_needed}**\n`;
  md += `- **② new 중복그룹**: 총 ${summary.dup_new_groups.total} (더미 ${summary.dup_new_groups.dummy_outofscope} 제외)\n`;
  md += `    - 운영자오류중복(자동정비후보): **${summary.dup_new_groups.operator_dup_auto}** · 모호(planner 확인): **${summary.dup_new_groups.ambiguous_planner}**\n\n`;
  md += `> 판정근거: 정본(keep) = 차트(+8) > 결제(+4) > 서비스(+2) > 진행도 > 최초생성 선점. 오류건 전부 연결無이면 자동정비후보, 일부라도 연결有면 모호→planner.\n\n`;

  md += `## ① NULL customer_id 고아 (실명/실데이터, 더미 제외)\n\n`;
  if (orphanReal.length === 0) md += `_해당 없음_\n\n`;
  for (const r of orphanReal) {
    md += `- [${r.kst_day} D-${daysAgoKST(r.kst_day)}] \`${r.id}\` **${r.name ?? '(무명)'}** ${r.phone ?? '-'} · vt=${r.visit_type} status=${r.status}\n`;
    md += `    - 결제:${r.has_payment ? `있음(${r.n_payment})` : '없음'} 패키지회차:${r.has_pkg_session ? '있음' : '없음'} 서비스:${r.has_service ? `있음(${r.n_service})` : '없음'} resv:${r.reservation_id ? 'O' : '-'} pkg:${r.package_id ? 'O' : '-'}\n`;
    md += `    - **판정: ${r.verdict}** (created ${new Date(r.created_at).toISOString()})\n`;
  }
  md += `\n### ①-더미/테스트 고아 (범위외 — 건드리지 않음): ${orphanRows.length - orphanReal.length}건\n`;
  md += orphanRows.filter((r) => r.looks_dummy).map((r) => `\`${r.id}\` ${r.name}`).join(', ') + '\n\n';

  md += `## ② 동일 customer_id + 동일 KST일 + new 2건+ 그룹\n\n`;
  md += `### A. 모호 (오류건에도 연결有 → planner/문지은 대표원장 확인) — ${dupAmbig.length}그룹\n\n`;
  for (const g of dupAmbig) md += renderGroup(g);
  md += `### B. 운영자오류중복 (오류건 연결無 → 정비후보) — ${dupAuto.length}그룹\n\n`;
  for (const g of dupAuto) md += renderGroup(g);
  const dupDummy = dupReport.filter((g) => g.classification.startsWith('범위외'));
  md += `### C. 범위외 (더미/테스트) — ${dupDummy.length}그룹\n`;
  md += dupDummy.map((g) => `${g.names.join('/')}(${g.kst_day})`).join(', ') + '\n\n';

  function renderGroup(g) {
    let s = `#### [${g.kst_day} D-${g.recent_days}] ${g.names.join(', ')} (customer_id=${g.customer_id}) — ${g.n_rows}건\n`;
    s += `- ✅ KEEP \`${g.keep.id}\` status=${g.keep.status} 차트:${g.keep.has_chart ? 'O' : '-'} 결제:${g.keep.has_payment ? `O(${g.keep.n_payment})` : '-'} 서비스:${g.keep.has_service ? 'O' : '-'} created=${new Date(g.keep.created_at).toISOString()}\n`;
    for (const e of g.err) {
      s += `- ❌ ERR \`${e.id}\` status=${e.status} 차트:${e.has_chart ? 'O' : '-'} 결제:${e.has_payment ? `O(${e.n_payment})` : '-'} 서비스:${e.has_service ? 'O' : '-'} 패키지:${e.has_pkg_session ? 'O' : '-'} created=${new Date(e.created_at).toISOString()}\n`;
    }
    return s + '\n';
  }

  writeFileSync(join(OUT_DIR, 'T-20260607-CHECKIN-DUP-NULL_ac1_inventory.md'), md);

  console.log(JSON.stringify(summary, null, 2));
  console.log('\n📄 scripts/out/T-20260607-CHECKIN-DUP-NULL_ac1_inventory.md (+ .json)');
})().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
