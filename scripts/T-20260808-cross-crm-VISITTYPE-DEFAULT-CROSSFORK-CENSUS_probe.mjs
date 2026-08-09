/**
 * T-20260808-cross-crm-VISITTYPE-DEFAULT-CROSSFORK-CENSUS — foot READ-ONLY census probe
 *
 * DA cross-fork systemic flag(MSG-20260808-001738-qfs6): body(=foot 하드포크)에서
 *   reservations.visit_type DEFAULT 'returning' outlier 발견(정상 'new'). foot=ancestor → 상속 개연.
 *   ★ READ-ONLY ONLY. NO DDL / NO UPDATE. information_schema/pg_attrdef prod introspection 만.
 *
 * AC1: foot reservations.visit_type 에 DEFAULT 'returning' 존재? (pg_attrdef/pg_get_expr, 하드코딩 추정 금지)
 * AC3: [DEFAULT LIVE 인 경우만] DEFAULT-landed 행 중 실초진인데 'returning' 기록 건수(READ-ONLY count)
 * AC4: reservations.visit_type CHECK 4type 집합에 'new' 포함 여부
 *   (AC2 = write-path 전수 grep 은 코드 census 로 별도 수행)
 * author: dev-foot / 2026-08-08
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1); }
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
const out = {};

// AC1: column default (authoritative prod introspection via pg_attrdef + pg_get_expr)
out.AC1_column_default = await q(`
  SELECT a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null,
         pg_get_expr(ad.adbin, ad.adrelid) AS column_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.reservations'::regclass
    AND a.attname = 'visit_type' AND NOT a.attisdropped;`);

// AC4: CHECK constraint definitions touching visit_type (does allowed set include 'new'?)
out.AC4_check_constraints = await q(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'public.reservations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%visit_type%';`);

// context: actual distribution of visit_type in prod reservations
out.CTX_visit_type_dist = await q(`
  SELECT visit_type, count(*) AS n
  FROM public.reservations
  GROUP BY visit_type ORDER BY n DESC;`);

// context: total reservations + source_system split (dopamine ingest = bare-INSERT candidate path)
out.CTX_source_split = await q(`
  SELECT source_system, count(*) AS n
  FROM public.reservations
  GROUP BY source_system ORDER BY n DESC;`);

console.log(JSON.stringify(out, null, 2));
