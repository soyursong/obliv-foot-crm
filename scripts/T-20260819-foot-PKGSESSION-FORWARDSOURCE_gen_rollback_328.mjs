/**
 * T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
 * ── folded328 rollback VALUES 생성기 (write0 to prod · 로컬 파일 생성만) ──
 *
 * apply 직전 census(apply_instant_census_328.mjs) 가 박제한 full-328 pre-image JSON 을 읽어
 * rollback.sql 의 << INJECT PRE-IMAGE VALUES HERE >> 블록을 채운다.
 * 손으로 편집 금지(divergence 방지). prod 접속 없음(순수 파일 변환).
 *
 * 사용: node scripts/..._gen_rollback_328.mjs
 *   in : db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE_gb-preimage-full328.json
 *   out: supabase/migrations/20260724130000_foot_pkgsession_link_backfill.folded328.rollback.filled.sql
 */
import { readFileSync, writeFileSync } from 'node:fs';
const REPO = '/Users/domas/GitHub/obliv-foot-crm';
const PRE = `${REPO}/db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE_gb-preimage-full328.json`;
const TPL = `${REPO}/supabase/migrations/20260724130000_foot_pkgsession_link_backfill.folded328.rollback.sql`;
const OUT = `${REPO}/supabase/migrations/20260724130000_foot_pkgsession_link_backfill.folded328.rollback.filled.sql`;

const pre = JSON.parse(readFileSync(PRE, 'utf8'));
const rows = pre.rows || [];
if (rows.length !== 328) throw new Error(`pre-image 행수 ${rows.length} != 328 — full-328 만 허용(delta-merge 금지)`);

// 전건 prev_psid=NULL ∧ prev_flag=false 계약 재확인(생성 단계에서도 fail-closed)
const bad = rows.filter(r => r.is_package_session === true || r.package_session_id !== null);
if (bad.length) throw new Error(`pre-image 계약 위반 ${bad.length}행 (prev_flag=true 또는 prev_psid NOT NULL) — clobber 위험`);

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const values = rows.map(r => {
  if (!uuidRe.test(r.cis_id)) throw new Error(`cis_id 형식 오류: ${r.cis_id}`);
  const psid = r.package_session_id === null ? 'NULL' : (()=>{ if(!uuidRe.test(r.package_session_id)) throw new Error(`psid 형식 오류: ${r.package_session_id}`); return `'${r.package_session_id}'`; })();
  const flag = r.is_package_session === true ? 'true' : 'false';
  return `  ('${r.cis_id}', ${psid}, ${flag})`;
}).join(',\n');

const insertBlock = `INSERT INTO _bf_preimage_328 (cis_id, prev_psid, prev_flag) VALUES\n${values} ;`;

const tpl = readFileSync(TPL, 'utf8');
const marker = '-- << INJECT PRE-IMAGE VALUES HERE >> (gen_rollback_328.mjs 가 채움 · 328행)';
if (!tpl.includes(marker)) throw new Error('rollback 템플릿에 주입 마커 부재');
const filled = tpl.replace(
  /-- << INJECT PRE-IMAGE VALUES HERE >>[\s\S]*?--   \.\.\. \(328행\) ;/,
  `${marker}\n${insertBlock}`
);
writeFileSync(OUT, filled);
console.log(`OK — rollback filled (${rows.length}행) → ${OUT}`);
