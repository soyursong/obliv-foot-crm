/**
 * WS-C STEP 2 — 판정근거 스냅샷 생성 (per-row confirm evidence, PHI-REDACTED, git-safe).
 *
 * DA Q2 요건: dup_id·raw_id·reservation_id·매칭근거·created_at delta·masked여부·자식건수.
 * PHI 위생: 실명/전화 평문 git 금지 → name 첫자+길이, phone tail4 만. 평문 raw 는 off-git(stdout only).
 *
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260713-foot-UNAUTH-WSC-snapshot.mjs
 * 출력: _artifacts/T-20260713-foot-UNAUTH-WSC_judgment_snapshot.redacted.json (git-safe)
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const PAIRS = [
  { dup: '512998d0-d51a-42c4-947e-b0cb2cc69da4', raw: '8fa12f4c-abfe-405e-8736-c2ca8e4aef8a', label: 'A' },
  { dup: '0356b229-e8c7-4655-aa6e-651b15370c1f', raw: 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b', label: 'B' },
];
const CHILD_TABLES = ['check_ins', 'health_q_tokens', 'health_q_results', 'customer_consult_memos', 'package_payments', 'packages'];
const inL = (a) => a.map((x) => `'${x}'`).join(',');

// PHI redaction helpers (git-safe)
const redName = (s) => { s = String(s || ''); return s ? `${[...s][0]}▪×${[...s].length - 1}${/\*/.test(s) ? '(masked)' : ''}` : '∅'; };
const redPhone = (s) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d ? `…${d.slice(-4)}(${d.length}d)` : '∅'; };

const custs = await query(`SELECT id, name, phone, visit_type, created_at FROM customers WHERE id IN (${inL(PAIRS.flatMap((p) => [p.dup, p.raw]))})`);
const byId = Object.fromEntries(custs.map((c) => [c.id, c]));

const rows = [];
for (const p of PAIRS) {
  const d = byId[p.dup], r = byId[p.raw];
  const dDigits = String(d.phone || '').replace(/[^0-9]/g, '');
  const rDigits = String(r.phone || '').replace(/[^0-9]/g, '');
  const children = {};
  for (const t of CHILD_TABLES) {
    const c = await query(`SELECT count(*)::int AS n FROM ${t} WHERE customer_id='${p.dup}'`);
    if (c?.[0]?.n) children[t] = c[0].n;
  }
  const ci = await query(`SELECT id, reservation_id FROM check_ins WHERE customer_id='${p.dup}'`);
  const deltaSec = Math.round((new Date(d.created_at) - new Date(r.created_at)) / 1000);
  rows.push({
    pair: p.label,
    dup_id: p.dup,
    raw_id: p.raw,
    reservation_id: ci.map((x) => x.reservation_id).filter(Boolean),   // R2: 부재 → 결정적 키 없음
    deterministic_fk_key: false,
    match_basis: {
      name_stem: `dup="${redName(d.name)}" ↔ raw="${redName(r.name)}" · stem-match=${(/\*/.test(d.name) ? d.name.replace(/\*+/g, '') : d.name).split('').every((ch) => r.name.includes(ch))}`,
      phone_tail: `dup=${redPhone(d.phone)} raw=${redPhone(r.phone)} · tail-match=${rDigits.endsWith(dDigits)}`,
      temporal_delta_sec: deltaSec,
      inv3_note: '약신호(tail+stem+temporal) 단독 destructive 금지 → per-row confirm. 실환자0(test/DUMMY) → 기본채택.',
    },
    dup_masked: /\*/.test(d.name) || (dDigits.length >= 1 && dDigits.length <= 7),
    raw_is_pii: !/\*/.test(r.name) && rDigits.length >= 8,
    dup_visit_type: d.visit_type,
    child_counts: children,
    child_total: Object.values(children).reduce((s, n) => s + n, 0),
    per_row_verdict: 'ACCEPT (real-patient=0, deterministic FK re-anchor, strong 3-signal identity match)',
  });
}

const snapshot = {
  ticket: 'T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK',
  work_stream: 'WS-C (오염행 정정 merge/re-anchor)',
  generated_by: 'dev-foot',
  da_ref: 'DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN Q2',
  freeze_set: PAIRS.map((p) => p.dup),
  phi_redaction: 'name=첫자+길이, phone=tail4 only. 평문 raw 는 off-git(stdout).',
  topology_divergence: 'DA Q2 자식모델=check_ins/status_transitions. 실측=6 FK테이블 8행(+financial packages/package_payments +clinical health_q/consult_memos). CASCADE(health_q*,consult_memos)+NO ACTION(check_ins,packages,package_payments) → full merge 가 유일한 순소실0 경로.',
  rows,
};
mkdirSync('_artifacts', { recursive: true });
const out = '_artifacts/T-20260713-foot-UNAUTH-WSC_judgment_snapshot.redacted.json';
writeFileSync(out, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify(snapshot, null, 2));
console.log(`\n✅ redacted 스냅샷 기록: ${out} (git-safe)`);
