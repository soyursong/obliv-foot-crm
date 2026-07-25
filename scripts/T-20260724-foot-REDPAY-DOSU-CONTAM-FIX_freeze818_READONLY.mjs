// T-20260724-foot-REDPAY-DOSU-CONTAM-FIX — 818행 child-first freeze-set 캡처 + 게이트-0/5조건 evidence
//   ★READ-ONLY. SELECT 만. prod 무변경(0 write, DELETE/DDL 무실행). supervisor forensic816 계승·확장.
//
//   목적:
//     (CEO조건3) freeze-set = raw 2 parent id + recon_log 816 child id 를 판정시점 고정 → 파일로 동결.
//     (CEO조건1) archive 대상 행수 산출(816+2=818) — apply 러너 순소실0 대조 기준.
//     (CEO조건5) 원장 무접점: recon_log 816 payment_id NOT NULL=0 재확인(forensic816 계승).
//     (게이트-0)  실 leak 경로: raw 2 parent 의 source/created_at/ingest marker 실측.
//   ref rxlomoozakkjesdqjtvd (foot prod). runner 는 evidence 파일을 stdout+파일로 남긴다.
import { query } from './lib/foot_migration_ledger.mjs';

const P1 = process.env.RAW_P1 || null; // 필요시 full id override
const P2 = process.env.RAW_P2 || null;
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

// 도수 오염 raw parent 지문 (STALE mig 와 동일 SSOT). truncated 판정id 60667463…7014c / f5ca6ec5…09b0 와 대조.
const PARENT_WHERE =
  `approval_no = '62071914' AND (raw_payload->'merchant'->>'id') = '1777276003' ` +
  `AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe'`;

const rows = async (sql) => {
  const r = await query(sql);
  return Array.isArray(r) ? r : [];
};
const scalar = async (sql) => {
  const r = await rows(sql);
  const o = r[0] || {};
  return o[Object.keys(o)[0]];
};

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };

say('════════════════════════════════════════════════════════════');
say(`[READ-ONLY] REDPAY-DOSU-CONTAM-FIX — 818 child-first freeze/forensic (${nowKst()})`);
say('  ref rxlomoozakkjesdqjtvd · SELECT-only · 0 write · DELETE/DDL 무실행');
say('════════════════════════════════════════════════════════════\n');

// ── (1) raw parent 실측 (게이트-0 + freeze parent) ──
say('── (1) raw parent (도수 오염 원본) 실측 ──');
const parents = await rows(
  `SELECT id, approval_no, (raw_payload->'merchant'->>'id') AS merchant_id, ` +
  `       (raw_payload->>'_mode') AS mode, source, created_at, received_at ` +
  `FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE} ORDER BY created_at;`,
).catch(async () => {
  // source/received_at 컬럼 부재 대비 폴백
  return rows(
    `SELECT id, approval_no, (raw_payload->'merchant'->>'id') AS merchant_id, ` +
    `       (raw_payload->>'_mode') AS mode, created_at ` +
    `FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE} ORDER BY created_at;`,
  );
});
say(`  parent 카운트 = ${parents.length} (기대=2)`);
parents.forEach((p) => say(`   · ${JSON.stringify(p)}`));
const parentIds = parents.map((p) => p.id);
if (P1 && P2 && !(parentIds.includes(P1) && parentIds.includes(P2))) {
  say(`  ⚠ 판정id override(${P1},${P2}) 와 지문 실측 불일치 — 대상 드리프트 점검 필요`);
}

// ── (2) recon_log child (818 중 816) freeze 캡처 ──
say('\n── (2) recon_log child freeze 캡처 ──');
const parentInList = parentIds.length
  ? parentIds.map((x) => `'${x}'`).join(',')
  : `SELECT id FROM public.redpay_raw_transactions WHERE ${PARENT_WHERE}`;
const childScope = parentIds.length
  ? `raw_transaction_id IN (${parentInList})`
  : `raw_transaction_id IN (${parentInList})`;

const childCnt = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log WHERE ${childScope};`,
);
say(`  child(recon_log) 카운트 = ${childCnt} (기대=816)`);

// ── (3) CEO조건5 — 원장(payment) 무접점 재확인 ──
say('\n── (3) 원장 무접점 (payment_id NOT NULL = 0 기대) ──');
const childPayNotNull = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE ${childScope} AND payment_id IS NOT NULL;`,
);
say(`  recon_log.payment_id NOT NULL = ${childPayNotNull} (기대=0 · forensic816 계승)`);

// ── (4) forensic 불변식 재확인 ──
say('\n── (4) forensic 불변식 (external_trxid 단일 / center=body / event_type) ──');
const trxids = await rows(
  `SELECT external_trxid, count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE ${childScope} GROUP BY external_trxid ORDER BY n DESC;`,
);
say(`  distinct external_trxid: ${JSON.stringify(trxids)}`);
const centers = await rows(
  `SELECT center, count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE ${childScope} GROUP BY center ORDER BY n DESC;`,
).catch(() => []);
say(`  center 분포: ${JSON.stringify(centers)}`);
const evts = await rows(
  `SELECT event_type, count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE ${childScope} GROUP BY event_type ORDER BY n DESC;`,
);
say(`  event_type 분포: ${JSON.stringify(evts)}`);

// ── (5) child scope 순도 — parent 외 raw 참조 / 타 trxid 혼입 0 ──
say('\n── (5) scope 순도 (타 external_trxid 혼입 = 0 기대) ──');
const impure = await scalar(
  `SELECT count(*)::int AS n FROM public.payment_reconciliation_log ` +
  `WHERE ${childScope} AND external_trxid IS DISTINCT FROM '0723C8124555';`,
);
say(`  0723C8124555 외 trxid child = ${impure} (기대=0)`);

// ── (6) freeze-set 파일 동결 (판정시점 id 목록) ──
say('\n── (6) freeze-set id 동결 ──');
const childIds = await rows(`SELECT id FROM public.payment_reconciliation_log WHERE ${childScope} ORDER BY id;`);
const freeze = {
  captured_at: nowKst(),
  proj_ref: 'rxlomoozakkjesdqjtvd',
  parent_where: PARENT_WHERE,
  raw_parent_ids: parentIds,
  raw_parent_count: parents.length,
  recon_log_child_ids: childIds.map((r) => r.id),
  recon_log_child_count: childCnt,
  total_818: parents.length + childCnt,
  invariants: {
    child_payment_id_not_null: childPayNotNull,
    external_trxid_groups: trxids,
    center_dist: centers,
    event_type_dist: evts,
    impure_trxid_count: impure,
  },
};

say(`\n  총 대상 = ${freeze.total_818} 행 (raw ${parents.length} + recon_log ${childCnt}) — 기대 818`);
const verdict =
  parents.length === 2 && childCnt === 816 && childPayNotNull === 0 && impure === 0
    ? 'PASS (818=816+2, 원장 무접점, scope 순수)'
    : 'REVIEW — 실측이 기대(818/816/2/0/0)와 불일치, supervisor 보고';
say(`  VERDICT: ${verdict}`);

// evidence 파일
const { writeFileSync } = await import('node:fs');
const base = 'scripts/T-20260724-foot-REDPAY-DOSU-CONTAM-FIX';
writeFileSync(`${base}_freeze818_EVIDENCE.txt`, out.join('\n') + '\n');
writeFileSync(`${base}_freeze818_FREEZESET.json`, JSON.stringify(freeze, null, 2) + '\n');
say(`\n  evidence → ${base}_freeze818_EVIDENCE.txt`);
say(`  freeze-set → ${base}_freeze818_FREEZESET.json`);
