/**
 * T-20260810-xcrm-REMINDER-TARGET-RESERVED-FORKDRIFT-CENSUS — READ-ONLY census
 * DA cross-fork sweep 후속. scalp2 확정 결함(리마인더 대상선정 confirmed-only → reserved 예약 전건 스킵)이
 * foot 원본(진원) notify_reminders_batch 에서 ACTIVE 인지 coherent-absence 인지 판정.
 *
 * ★진원: foot 20260527100000_messaging_s2_ops_data.sql SECTION 5 line 299 (status='confirmed' 단독)
 * READ-ONLY. prod 무변경. SELECT/introspection only. 절대 apply/수정 금지.
 *
 * AC-1: prod notify_reminders_batch 실 본문(pg_get_functiondef) 대상 status 술어 확인.
 * AC-2: reservations.status 분포 — reserved 건수 > 0 인가 (reserved-착지 인입 발현조건).
 * AC-3: 판정 — AC-1 confirmed-only AND AC-2 reserved>0 → ACTIVE. 하나라도 부정 → coherent-absence.
 */
import fs from 'fs';
import crypto from 'crypto';

const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

const out = { ticket: 'T-20260810-xcrm-REMINDER-TARGET-RESERVED-FORKDRIFT-CENSUS', crm: 'obliv-foot-crm', ref: REF };

// ── AC-1: prod 함수 실 본문 술어 ──────────────────────────────
const fnRows = await q(`SELECT p.oid::text AS oid, pg_get_functiondef(p.oid) AS def, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='notify_reminders_batch'`);
out.AC1 = { fn_exists: fnRows.length > 0, overloads: fnRows.length };
if (fnRows.length) {
  const defs = fnRows.map(r => {
    const def = r.def;
    // SQL 라인주석(-- …) 제거 후 술어 판정 — 주석 내 'reserved' 오탐 차단
    const codeOnly = def.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    // 대상 status 술어 추출 (r.status = '...' 형태 모두, code-only 기준)
    const statusPreds = [...codeOnly.matchAll(/r\.status\s*(=|IN|<>|!=)\s*('[^']*'|\([^)]*\))/gi)].map(m => (m[1] + ' ' + m[2]).trim());
    const hasReserved = /r\.status[^\n]*reserved/i.test(codeOnly);
    const hasConfirmed = /r\.status[^\n]*'confirmed'/i.test(codeOnly);
    return {
      args: r.args,
      md5: crypto.createHash('md5').update(def).digest('hex'),
      status_predicates_code_only: statusPreds,
      predicate_mentions_reserved: hasReserved,
      predicate_mentions_confirmed: hasConfirmed,
      def_len: def.length,
    };
  });
  out.AC1.definitions = defs;
  out.AC1.confirmed_only = defs.every(d => d.predicate_mentions_confirmed && !d.predicate_mentions_reserved);
}

// ── AC-2: reservations.status 분포 (reserved-착지 발현조건) ────
const dist = await q(`SELECT status, count(*)::int AS cnt FROM public.reservations GROUP BY status ORDER BY cnt DESC`);
const total = dist.reduce((a, r) => a + r.cnt, 0);
const reservedRow = dist.find(r => r.status === 'reserved');
out.AC2 = {
  status_distribution: dist,
  total_reservations: total,
  reserved_count: reservedRow ? reservedRow.cnt : 0,
  reserved_present: !!(reservedRow && reservedRow.cnt > 0),
};

// AC-2 보강: reservations.status CHECK constraint 실측 (reserved 값 허용 자체가 가능한가)
const chk = await q(`SELECT conname, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='reservations' AND c.contype='c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%'`);
out.AC2.status_check_constraints = chk;
out.AC2.check_allows_reserved = chk.some(c => /reserved/i.test(c.def));

// ── AC-3: 판정 ────────────────────────────────────────────────
const ac1 = out.AC1.confirmed_only === true;
const ac2 = out.AC2.reserved_present === true;
out.AC3 = {
  ac1_confirmed_only: ac1,
  ac2_reserved_gt0: ac2,
  verdict: (ac1 && ac2) ? 'ACTIVE' : 'coherent-absence',
  rationale: (ac1 && ac2)
    ? 'confirmed-only 술어 AND reserved 예약 실재 → 리마인더 silent 스킵 잠복(ACTIVE)'
    : `무해: ${!ac1 ? 'AC-1 술어가 confirmed-only 아님' : ''}${(!ac1 && !ac2) ? ' + ' : ''}${!ac2 ? 'AC-2 reserved 착지 인입 0건(발현조건 부재)' : ''}`.trim(),
};

console.log(JSON.stringify(out, null, 2));
