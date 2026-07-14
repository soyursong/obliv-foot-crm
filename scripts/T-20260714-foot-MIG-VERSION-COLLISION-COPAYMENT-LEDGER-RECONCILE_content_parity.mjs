/**
 * T-20260714-foot-MIG-VERSION-COLLISION-COPAYMENT-LEDGER-RECONCILE
 *   §3 content-parity 재현 (Case C2 게이트) — READ-ONLY.
 *
 * DA CONSULT-REPLY(MSG-...zf16 회신, verdict=GO 조건부) §3 요구:
 *   (A) pg_get_functiondef 전문 대조 → v1.3 마이그 파일 body byte-identical.
 *   (B) 돈-불변식 실측(구조 단정): hira_unit_value NULL→BLOCK / 89.4 fallback 로직부재
 *       / 노인외래 4구간 / COMMENT v1.3.
 *   (C) 89.4 has_894 오탐 반증: 프로덕션 정의 내 "89.4" 출현이 전부 주석(제거 사실 기술)임을
 *       byte 위치로 입증 → 실제 COALESCE(...,89.4) 계산로직 부재.
 *
 * 원장 write 없음 / DDL 무변경 / db push 없음 (dev-foot 코드 lane 준수).
 * forward-doc 원장 1행 write 는 supervisor exec lane 전속 (DA §1-1 method 정정).
 * author: dev-foot / 2026-07-14
 */
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
const MIG = 'supabase/migrations/20260714120500_calc_copayment_hira_governed_elderly_tiers.sql';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// ── 함수 body 추출 유틸: 첫 dollar-quote($$ 또는 $tag$) 사이 본문만. ──
function extractBody(text) {
  const m = text.match(/AS (\$[A-Za-z0-9_]*\$)/);
  if (!m) return null;
  const tag = m[1];
  const start = text.indexOf(tag, m.index) + tag.length;
  const end = text.indexOf(tag, start);
  return text.slice(start, end);
}
// 개행 정규화만(CRLF→LF, 트레일링 공백 무시 X — byte 엄밀). dollar-tag 차이는 body 외부라 무영향.
const norm = (s) => s.replace(/\r\n/g, '\n');

const out = { ticket: 'T-20260714-foot-MIG-VERSION-COLLISION-COPAYMENT-LEDGER-RECONCILE', gate: 'C2 content-parity' };

// (1) prod 함수 정의 전문 + COMMENT(별도 메타, functiondef 미포함) + oid.
const def = await q(`
  SELECT p.oid::text AS oid,
         pg_get_functiondef(p.oid)            AS functiondef,
         obj_description(p.oid, 'pg_proc')     AS fn_comment
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname='public' AND p.proname='calc_copayment';
`);
const prodDef = def[0].functiondef;
const prodComment = def[0].fn_comment || '';

// (2) 마이그 파일 body vs prod body byte 대조.
const migText = readFileSync(MIG, 'utf8');
const migBody = norm(extractBody(migText));
const prodBody = norm(extractBody(prodDef));
out.body_byte_identical = migBody === prodBody;
out.body_len = { mig: migBody.length, prod: prodBody.length };
if (!out.body_byte_identical) {
  // 첫 diff 위치 리포트 (디버그용, PASS 시 미출력).
  let i = 0; const n = Math.min(migBody.length, prodBody.length);
  while (i < n && migBody[i] === prodBody[i]) i++;
  out.first_diff = { at: i, mig: JSON.stringify(migBody.slice(i, i + 60)), prod: JSON.stringify(prodBody.slice(i, i + 60)) };
}

// (3) 89.4 오탐 반증: prod 정의 내 "89.4" 모든 출현이 주석줄(--) 안인지.
const occ894 = [];
prodDef.split('\n').forEach((line, idx) => {
  if (line.includes('89.4')) {
    const codePart = line.split('--')[0];              // 주석 앞부분(=실코드)
    occ894.push({ line: idx + 1, in_comment_only: !codePart.includes('89.4'), text: line.trim() });
  }
});
out.has_894_string = occ894.length > 0;
out.occ_894 = occ894;
out.rebuttal_894_fallback_absent = occ894.length > 0 && occ894.every((o) => o.in_comment_only);
// 실제 fallback 로직 지문 부재 확증 (COALESCE(...,89.4) / , 89.4) 패턴).
out.no_coalesce_894_logic = !/COALESCE\([^)]*89\.4/.test(prodDef) && !/,\s*89\.4\s*\)/.test(prodDef);

// (4) 돈-불변식 구조 단정.
out.invariants = {
  hira_unit_value_null_block:
    /v_clinic\.hira_unit_value IS NULL/.test(prodDef) &&
    /RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true;/.test(prodDef),
  elderly_4tier:
    /v_base <= 15000/.test(prodDef) && /v_base <= 20000/.test(prodDef) &&
    /v_base <= 25000/.test(prodDef) &&
    (prodDef.match(/v_base <= (15000|20000|25000)/g) || []).length === 3,   // 3 경계 + ELSE = 4구간
  elderly_flat_1500: /LEAST\(1500, v_base\)/.test(prodDef),
  comment_v13: /v1\.3/.test(prodComment),
};
out.fn_comment = prodComment;

// (5) 원장 정합 재확인(context) — copayment version 원장 부재 = forward-doc 필요(supervisor write 대상).
out.ledger_120500_present = (await q(`
  SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='20260714120500';
`)).length > 0;
out.ledger_120000_squatter = (await q(`
  SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='20260714120000';
`))[0] || null;

// ── 종합 PASS 판정 ──
out.PASS =
  out.body_byte_identical &&
  out.rebuttal_894_fallback_absent &&
  out.no_coalesce_894_logic &&
  out.invariants.hira_unit_value_null_block &&
  out.invariants.elderly_4tier &&
  out.invariants.elderly_flat_1500 &&
  out.invariants.comment_v13;

console.log(JSON.stringify(out, null, 2));
