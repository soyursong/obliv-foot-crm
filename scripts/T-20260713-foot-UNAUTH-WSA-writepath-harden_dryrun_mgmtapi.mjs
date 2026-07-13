/**
 * T-20260713-foot-UNAUTH WS-A — self_checkin_with_reservation_link WRITE-path 하드닝 DRY-RUN
 *   (Management API 경로 — 원격 pooler DB_PASSWORD 부재 환경용 동등 실행체)
 *
 * 목적: prod 실제 스키마에 마이그레이션 구문을 무영속(no-persistence)으로 적용 확증.
 *   - 시크릿: SUPABASE_ACCESS_TOKEN(sbp_…, Management API) 만 사용. pooler DB 비밀번호 불요.
 *   - 무영속 3중 안전:
 *       (0) baseline: 현 prod 함수정의 캡처.
 *       (1) canary : BEGIN; COMMENT …='__DRYRUN_CANARY__'; ROLLBACK; → 이 엔드포인트에서
 *                    ROLLBACK 이 실제로 되돌리는지 무해한 가역변경으로 선증명. 잔존 시 즉시 ABORT
 *                    (실 DDL 미실행) — sentinel-bypass hazard(엔드포인트 autocommit) 사전 차단.
 *       (2) apply  : BEGIN; <txn-control strip 한 마이그레이션>; ROLLBACK;  (적용 성공/실패 포착)
 *       (3) post-probe: 함수정의 재캡처 → baseline 과 동일(무변경)해야 무영속 확증.
 *   - 행위 회귀 5테스트(①~⑤)는 시크릿0 로컬 faithful-schema stub 담당:
 *       bash scripts/T-20260713-foot-UNAUTH-WSA_5test_local.sh
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260713-foot-UNAUTH-WSA-writepath-harden_dryrun_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const FN  = 'self_checkin_with_reservation_link';
const FINGERPRINT = 'unlinked_masking_hold';               // WS-A 지문 (신 정의에만 존재)
const CANARY = '__DRYRUN_CANARY_T20260713_WSA__';

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
const defOf = async () => {
  const rows = await q(`SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='${FN}' LIMIT 1`);
  return rows[0]?.def || '';
};

// txn-control strip — 러너/스텁과 동일 규칙 (내장 BEGIN;/COMMIT; 만 제거, plpgsql 블록 BEGIN 은 세미콜론 없어 보존)
const rawMig = fs.readFileSync('supabase/migrations/20260713120000_selfcheckin_writepath_harden_masked_reject.sql', 'utf8');
const mig = rawMig.split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

let ok = true;
try {
  console.log(`✅ Management API 연결(${REF}) — DRY-RUN, 무영속\n`);

  // (0) baseline
  const baseline = await defOf();
  const baselineHasFp = baseline.includes(FINGERPRINT);
  console.log(`── (0) baseline: 함수 존재=${!!baseline} · WS-A지문 이미존재=${baselineHasFp}`);

  // (1) canary — ROLLBACK 실효성 선증명 (무해 가역변경)
  await q(`BEGIN;\nCOMMENT ON FUNCTION public.${FN}(UUID, JSONB, DATE) IS '${CANARY}';\nROLLBACK;`);
  const afterCanary = await q(`SELECT obj_description(p.oid) AS c
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='${FN}' LIMIT 1`);
  const canaryPersisted = (afterCanary[0]?.c || '') === CANARY;
  console.log(`── (1) canary: ROLLBACK 후 카나리 잔존? ${canaryPersisted ? '❌ 잔존(엔드포인트 autocommit — ABORT)' : '✅ 미잔존(ROLLBACK 실효 확인)'}`);
  if (canaryPersisted) { throw new Error('CANARY_PERSISTED — 이 엔드포인트는 ROLLBACK 무영속 보장 실패. 실 DDL 미실행하고 중단.'); }

  // (2) apply — 무영속 적용
  await q(`BEGIN;\n${mig}\nROLLBACK;`);
  console.log('── (2) apply: 마이그레이션 구문(함수 CREATE OR REPLACE + GRANT + COMMENT) prod 스키마 적용(트랜잭션 내) OK');
} catch (e) {
  ok = false;
  console.error('❌ DRY-RUN 실패:', e.message);
} finally {
  // (3) post-probe — 무영속 확증: 사후 함수정의가 WS-A 지문을 포함하지 않아야(= 롤백 후 원복) 정상
  const post = await defOf();
  const postHasFp = post.includes(FINGERPRINT);
  console.log(`── (3) post-probe: 사후 WS-A지문(${FINGERPRINT}) 존재=${postHasFp}`);
  console.log(`── post-probe 판정: WS-A 지문 prod 영속? ${postHasFp ? '❌ PERSISTED(사고)' : '✅ 무영속(정상)'} ──`);
  process.exit(ok && !postHasFp ? 0 : 1);
}
