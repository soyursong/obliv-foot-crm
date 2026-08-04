/**
 * DRY-RUN (No-Persistence Protocol) — 20260804193000_foot_payments_card_no_masked.sql (AC-5/AC-6)
 * T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY (DA §7)
 *
 * txn-strip(BEGIN/COMMIT 제거) + 단일 트랜잭션에서 DDL 실행 + sentinel RAISE 통째 unwind(무영속) +
 *   POST-PROBE(payments.card_no_masked / 트리거 / 가드함수 부재 실증) + ★가드 동작 실증(masked 통과 / 평문 PAN 차단).
 *
 * ⚠ write/DDL 영속 0. 실행: node supabase/migrations/20260804193000_foot_payments_card_no_masked.dryrun.mjs
 */
import { readFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const SENTINEL = 'DRYRUN_SENTINEL_ROLLBACK_193000';
const strip = (s) => s.split('\n').filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l)).join('\n');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

(async () => {
  const ddl = strip(readFileSync(`${HERE}20260804193000_foot_payments_card_no_masked.sql`, 'utf8'));

  // 1) 문법/의존성 통과 + sentinel unwind(무영속).
  const wrapped = `BEGIN;\n${ddl}\nDO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`;
  const res = await q(wrapped);
  if (!res.body.includes(SENTINEL)) {
    console.error('❌ DRY-RUN FAIL — sentinel 미도달(DDL 오류/조기 COMMIT 의심). 응답:');
    console.error(res.body.slice(0, 1500));
    process.exit(1);
  }
  console.log('✓ 1) DDL 문법 통과 + sentinel 도달 → 무영속 unwind.');

  // 2) POST-PROBE — 컬럼/트리거/가드함수 부재 실증(prod 무접점).
  const probe = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='payments' AND column_name='card_no_masked') AS col,
      (SELECT count(*) FROM information_schema.triggers
        WHERE event_object_schema='public' AND event_object_table='payments'
          AND trigger_name='trg_payments_card_no_masked_pci_guard') AS trg,
      (SELECT count(*) FROM pg_proc WHERE proname='payments_card_no_masked_pci_guard') AS fn;`);
  const row = JSON.parse(probe.body)[0];
  console.log('POST-PROBE(무영속 실증):', JSON.stringify(row));
  if (Number(row.col) !== 0 || Number(row.trg) !== 0 || Number(row.fn) !== 0) {
    console.error('❌ 무영속 위반 — dry-run 이 prod 에 컬럼/트리거/함수를 영속시킴. 즉시 롤백 필요.');
    process.exit(2);
  }
  console.log('✓ 2) 무영속 실증 완료(col=0, trg=0, fn=0) — prod 무접점.');

  // 3) ★가드 동작 실증(무영속 txn 내부·payments FK/NOT-NULL 회피 위해 temp table 에 동일 트리거 부착):
  //    (a) 실카드 마스킹값('55318440****364*') = 통과   (b) 마스킹 마커 없는 16자리 Luhn PAN = check_violation RAISE.
  const guardDdl = strip(readFileSync(`${HERE}20260804193000_foot_payments_card_no_masked.sql`, 'utf8'));
  // (a) 마스킹값 = 통과여야 함(예외 없음 → sentinel 도달).
  const passCase = await q(`BEGIN;
${guardDdl}
CREATE TEMP TABLE _t_guard (card_no_masked text) ON COMMIT DROP;
CREATE TRIGGER _t_guard_trg BEFORE INSERT OR UPDATE OF card_no_masked ON _t_guard
  FOR EACH ROW EXECUTE FUNCTION public.payments_card_no_masked_pci_guard();
INSERT INTO _t_guard(card_no_masked) VALUES ('55318440****364*');
DO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`);
  const passOk = passCase.body.includes(SENTINEL) && !/check_violation|PCI guard/i.test(passCase.body);
  console.log(`✓ 3a) 마스킹값('55318440****364*') 통과 = ${passOk ? 'PASS(예외없음)' : 'FAIL'}`);
  if (!passOk) { console.error(passCase.body.slice(0, 800)); process.exit(3); }

  // (b) 마스킹 마커 없는 16자리 Luhn-valid PAN(4111111111111111) = 차단이어야 함(check_violation, sentinel 도달 전 RAISE).
  const blockCase = await q(`BEGIN;
${guardDdl}
CREATE TEMP TABLE _t_guard (card_no_masked text) ON COMMIT DROP;
CREATE TRIGGER _t_guard_trg BEFORE INSERT OR UPDATE OF card_no_masked ON _t_guard
  FOR EACH ROW EXECUTE FUNCTION public.payments_card_no_masked_pci_guard();
INSERT INTO _t_guard(card_no_masked) VALUES ('4111111111111111');
DO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`);
  const blockOk = /PCI guard: payments\.card_no_masked/i.test(blockCase.body) && !blockCase.body.includes(SENTINEL);
  console.log(`✓ 3b) 평문 PAN(4111111111111111, Luhn-valid·마스킹없음) 차단 = ${blockOk ? 'PASS(check_violation RAISE)' : 'FAIL'}`);
  if (!blockOk) { console.error(blockCase.body.slice(0, 800)); process.exit(4); }

  // (c) ★scalp naive 오차단 회피 실증: AUTHNO(29258831, 8자리)·TID(1047538246, 10자리)·MSG_TRACE(558080127045, 12자리) = 통과.
  const falsePosCase = await q(`BEGIN;
${guardDdl}
CREATE TEMP TABLE _t_guard (card_no_masked text) ON COMMIT DROP;
CREATE TRIGGER _t_guard_trg BEFORE INSERT OR UPDATE OF card_no_masked ON _t_guard
  FOR EACH ROW EXECUTE FUNCTION public.payments_card_no_masked_pci_guard();
INSERT INTO _t_guard(card_no_masked) VALUES ('29258831'),('1047538246'),('558080127045');
DO $$ BEGIN RAISE EXCEPTION '${SENTINEL}'; END $$;`);
  const fpOk = falsePosCase.body.includes(SENTINEL) && !/check_violation|PCI guard/i.test(falsePosCase.body);
  console.log(`✓ 3c) 승인번호/TID/MSG_TRACE 오차단 회피(scalp naive 상속금지) = ${fpOk ? 'PASS(통과)' : 'FAIL'}`);
  if (!fpOk) { console.error(falsePosCase.body.slice(0, 800)); process.exit(5); }

  console.log('\nDRY-RUN PASS — 문법·의존성·무영속(col/trg/fn=0) + 가드 동작(마스킹 통과·평문 PAN 차단·승인번호 오차단 회피) 전부 실증.');
})().catch((e) => { console.error('DRYRUN ERROR:', e.message); process.exit(1); });
