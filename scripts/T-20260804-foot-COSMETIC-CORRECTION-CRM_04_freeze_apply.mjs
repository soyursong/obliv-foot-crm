/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP 4: 4-PK soft-void FREEZE apply
 *   DA-20260805-foot-COSMETIC-VOID-SEMANTIC (gate CLOSED) · SSOT §ADDENDUM-CENSUS-COMPLETE C6-2.
 *
 * ★ 이 스크립트는 정확히 4 PK 만 soft-void 한다 (blanket/name/amount UPDATE 금지 — 명시 PK VALUES only).
 * ★ default = No-Persistence dry-run (DO..RAISE sentinel..ROLLBACK + post-probe 무영속 재확인).
 *   실 apply(`--apply`) = 게이트 3중 선결 후에만:
 *     (1) check_in_services.voided_at 컬럼 ADD 완료(20260805110000 migration, supervisor DDL-diff)
 *     (2) 현장/총괄 4-PK non-genuine business-fact confirm + manual-use 질의(display-only 확정 or 박민지 light sign-off)
 *     (3) supervisor dry-run(exact-count 4) + FE co-deploy(MIG-GATE)
 *
 * SOP 준수: Cross-CRM Data-Correction Backfill SOP — per-row PK freeze / dry-run diff / 판정근거 스냅샷 /
 *           rows-affected 검증(DID-IT-PERSIST) / 롤백대칭.
 *
 * 실행: node scripts/..._04_freeze_apply.mjs            (dry-run·무영속)
 *       node scripts/..._04_freeze_apply.mjs --apply    (실 apply — 3중 게이트 통과 후에만)
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');
const APPLY = process.argv.includes('--apply');
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const J = (x) => JSON.stringify(x, null, 2);

// ── FREEZE SET — 정확히 4 PK (VERIFYGATE_EVIDENCE 확정, net cash-in 0 = 전량 비진성) ──
const VOID_BY = 'T-20260804-foot-COSMETIC-CORRECTION-CRM';
const FREEZE = [
  { tag: '#1a', line_id: 'b81521e2-3e4f-4d41-8c63-971d78f08482', cust: '김민경 F-0177', svc: '안티펑거스500ml', amt: 287000, reason: 'non-genuine: 방문 payment 0 (총괄:테스트)' },
  { tag: '#1b', line_id: 'aaec854c-31e2-4071-b2d8-535cfed6c55d', cust: '김민경 F-0177', svc: '풋샴푸200ml',   amt: 42000,  reason: 'non-genuine: net-0 phantom pay+refund pair (총괄:테스트)' },
  { tag: '#2b', line_id: '81682cf7-317a-4e55-98c5-eeafdda0d605', cust: '오렌지족 F-4628', svc: '풋샴푸200ml',   amt: 42000,  reason: 'non-genuine: net-0 phantom pay+refund pair (총괄:테스트)' },
  { tag: '#4',  line_id: '31ea7f5e-fad9-406f-9d50-5bf116b51d23', cust: '정가언 F-4981',  svc: 'CTB',          amt: 15000,  reason: 'non-genuine: 고객 pay_total 0 전기간 (총괄:명단에없음/오귀속)' },
];
const IDS = FREEZE.map((f) => `'${f.line_id}'`).join(',');

async function main() {
  console.log(`════════ STEP4 ${APPLY ? '★APPLY (실 영속)' : 'DRY-RUN (무영속)'} — 4-PK soft-void freeze ════════`);

  // 0) 컬럼 존재 가드 — 미배포 시 즉시 ABORT (migration 20260805110000 선행 필수)
  const col = await runSQL(`
    select count(*)::int n from information_schema.columns
    where table_schema='public' and table_name='check_in_services' and column_name='voided_at';`);
  if (col[0].n !== 1) {
    console.log('⚠ ABORT: check_in_services.voided_at 컬럼 부재 → migration 20260805110000 선행 필요(supervisor DDL-diff).');
    return;
  }

  // 1) FREEZE 지문 재검증 (apply 직전 baseline 대조) — 4행·voided_at 전건 NULL 확인
  const baseline = await runSQL(`
    select cis.id line_id, cis.price, cis.service_name, cis.voided_at,
           cu.chart_number, cu.name cust_name
    from check_in_services cis join check_ins ci on ci.id=cis.check_in_id join customers cu on cu.id=ci.customer_id
    where cis.id in (${IDS}) order by cu.chart_number;`);
  console.log('baseline:', J(baseline));
  if (baseline.length !== 4) {
    console.log(`⚠ ABORT: freeze 지문 불일치(기대 4행, 실측 ${baseline.length}행).`);
    return;
  }
  const alreadyVoided = baseline.filter((r) => r.voided_at != null);
  if (alreadyVoided.length > 0) {
    console.log(`⚠ NOTE: 이미 voided 된 라인 ${alreadyVoided.length}건(멱등 재실행). UPDATE 는 voided_at IS NULL 만 대상.`);
  }

  // 2) UPDATE — 정확히 4 PK, per-row reason. voided_at IS NULL 가드(멱등·이중void 방지).
  const cases = FREEZE.map((f) =>
    `when '${f.line_id}' then '${f.reason.replace(/'/g, "''")}'`).join('\n        ');
  const updateSQL = `
    update check_in_services
      set voided_at = now(),
          voided_by = '${VOID_BY}',
          voided_reason = case id
        ${cases}
        end
      where id in (${IDS}) and voided_at is null;`;

  if (!APPLY) {
    // No-Persistence: DO 블록 안에서 UPDATE 후 rows-affected 확인, SENTINEL RAISE 로 강제 ROLLBACK.
    const dry = await runSQL(`
      do $$
      declare n int;
      begin
        update check_in_services
          set voided_at = now(), voided_by = '${VOID_BY}'
          where id in (${IDS}) and voided_at is null;
        get diagnostics n = row_count;
        raise notice 'DRYRUN rows_affected=%', n;
        raise exception 'SENTINEL_ROLLBACK (no-persistence dry-run, rows=%)', n;
      end $$;`).catch((e) => ({ sentinel: String(e.message || e) }));
    console.log('dry-run(무영속):', J(dry));
    // post-probe: 무영속 재확인
    const post = await runSQL(`select count(*)::int voided_now from check_in_services where id in (${IDS}) and voided_at is not null;`);
    console.log('post-probe voided_now(무영속 기대: baseline 과 동일):', J(post));
    console.log('\n→ dry-run 완료. 실 apply 는 --apply + 3중 게이트(컬럼ADD·현장confirm·supervisor) 선결.');
    return;
  }

  // ── APPLY 경로 ──
  const res = await runSQL(updateSQL);
  console.log('UPDATE result:', J(res));
  // rows-affected 검증(DID-IT-PERSIST) — 4건(또는 멱등 재실행 시 잔여) 이외면 경보
  const after = await runSQL(`select count(*)::int voided from check_in_services where id in (${IDS}) and voided_at is not null;`);
  console.log('post-apply voided count(기대 4):', J(after));
  if (after[0].voided !== 4) console.log(`⚠ 검증실패: voided=${after[0].voided} ≠ 4. supervisor 확인 요망.`);
  else console.log('✓ 4-PK soft-void 영속 확인.');
}
main().catch((e) => { console.error(e); process.exit(1); });
