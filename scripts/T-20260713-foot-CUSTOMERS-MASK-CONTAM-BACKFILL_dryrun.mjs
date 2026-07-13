/**
 * T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — 백필 dry-run (READ-ONLY)
 *
 * 게이트 순서(planner MSG-20260714-011724 / DA CONSULT-REPLY GO 조건부):
 *   (a) DA light re-confirm  ← 별도 mq (병행)
 *   (b) dry-run READ-ONLY    ← 본 스크립트
 *   (c) per-row confirm      (d) supervisor 최종게이트
 *   ★ GO 재확인 前 mutation/deploy-ready 금지. 본 스크립트는 SELECT-only(무영속).
 *
 * DA 정정규칙(DA-20260713-...-BACKFILL):
 *   - 옵션 D(relink+archive). 옵션 R(rename-in-place) 기각.
 *   - 6건 raw 1:1 = §0-1 class A 미러재링크(전 FK 자식 raw로 re-anchor → dup master archive-first 제거).
 *   - 1건 02594dfa(tail 0000, raw 후보 ≥2) = §2-F per-row 보류, INV-3 fail-closed(auto-merge 금지).
 *   - 복구 소스 1순위 = check_in.reservation_id → reservations.customer_id(raw) 결정키.
 *     phone tail4/name-stem/temporal = 보강신호(검증용)만.
 *   - §2-0 손열거 금지: pg_constraint 기계열거로 전 FK(32개) 산출 후 전량 re-anchor.
 *   - §2-3-b 순서 불변식: (1) 전 FK 자식 raw로 FK-only UPDATE → (2) dup master 전 FK 0건 재검증(잔존 시 abort) → (3) archive-first 제거.
 *
 * ★★★ READ-ONLY. SELECT + pg_get_constraintdef 만. UPDATE/DELETE/INSERT 0. ★★★
 * PHI 위생(§4): 실명/전체번호 미출력. name=마스킹형/길이, phone=tail4, id=8자.
 * author: dev-foot / 2026-07-14 · Management API (SUPABASE_ACCESS_TOKEN)
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  try { TOKEN = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch {}
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function q(sql, retry = 4) {
  for (let i = 0; i < retry; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
    await sleep(180); // throttle 회피
    return JSON.parse(t);
  }
  throw new Error('429 재시도 초과');
}
const s8 = (x) => (x == null ? null : String(x).slice(0, 8));
const CLINIC = '74967aea';           // foot clinic (prefix)
// tz 정확비교: WS-A 실발효 window END(phase1 재산출) = ~18:04. 마스킹함수 배포(147b3417)=07-11.
const WIN_START = "2026-07-11 00:00:00+09";
const WIN_END   = "2026-07-13 18:04:46+09";  // 마지막 masked customer 02594dfa @18:04:45 포함

async function main() {
  console.log('=== T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — 백필 dry-run (READ-ONLY) ===');
  console.log(`window(KST, tz정확): ${WIN_START} ~ ${WIN_END}\n`);

  // ────────────────────────────────────────────────────────────────
  // 0) 대상셋 freeze 재확인 (tz timestamptz 정확비교) — 마스킹 customers
  // ────────────────────────────────────────────────────────────────
  console.log('── [0] 대상셋 freeze 재확인 (masked customers, tz정확) ──');
  const phantoms = await q(`
    SELECT c.id, c.clinic_id, length(c.name) AS name_len, (c.name ~ '\\*') AS name_masked,
           right(regexp_replace(c.phone,'[^0-9]','','g'),4) AS phone_tail,
           length(regexp_replace(c.phone,'[^0-9]','','g')) AS phone_digits,
           (c.phone ~ '\\*') AS phone_star,
           c.created_at, c.updated_at,
           (c.created_at AT TIME ZONE 'Asia/Seoul') AS created_kst
    FROM customers c
    WHERE left(c.clinic_id::text,8) = '${CLINIC}'
      AND ( c.name ~ '\\*'
            OR (length(regexp_replace(c.phone,'[^0-9]','','g')) BETWEEN 1 AND 7)
            OR c.phone ~ '\\*' )
    ORDER BY c.created_at;
  `);
  console.table(phantoms.map(p => ({
    id: s8(p.id), name: p.name_masked ? '<MASKED*>' : `<len${p.name_len}>`, name_masked: p.name_masked,
    phone_tail: p.phone_tail, phone_digits: p.phone_digits, phone_star: p.phone_star,
    created_kst: p.created_kst, in_window: p.created_at >= '2026-07-10T15:00:00' && p.created_at <= '2026-07-13T09:04:46',
  })));
  console.log(`  → masked customers 총 ${phantoms.length}건 (freeze 기대치 7)\n`);

  // ────────────────────────────────────────────────────────────────
  // 1) §2-0 기계 FK 열거 — customers 참조 전 FK (pg_constraint)
  // ────────────────────────────────────────────────────────────────
  console.log('── [1] §2-0 기계 FK 열거 (pg_constraint, contype=f → customers) ──');
  const fks = await q(`
    SELECT con.conname,
           cl.relname AS child_table,
           att.attname AS child_col,
           con.confdeltype AS on_delete
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pcl ON pcl.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype='f' AND pcl.relname='customers' AND ns.nspname='public'
    ORDER BY cl.relname, att.attname;
  `);
  const delMap = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
  console.log(`  FK 제약 ${fks.length}개 / 자식 테이블 ${new Set(fks.map(f => f.child_table)).size}개`);
  const cascadeFks = fks.filter(f => f.on_delete === 'c');
  console.log(`  CASCADE FK: ${cascadeFks.length}개 → ${cascadeFks.map(f => f.child_table + '.' + f.child_col).join(', ')}`);

  const idList = phantoms.map(p => `'${p.id}'`).join(',');

  // 각 FK 자식건수 — 1 FK당 1쿼리(GROUP BY)로 phantom별 분해까지 동시 산출 (429 회피)
  console.log('\n── phantom 집합의 실제 자식 (FK별, n>0) ──');
  const childRows = [];
  const perPhantom = {};          // phantom_id → 이동 자식 총건수
  phantoms.forEach(p => { perPhantom[p.id] = 0; });
  for (const f of fks) {
    const rc = await q(`SELECT ${f.child_col}::text AS cid, count(*)::int AS n FROM ${f.child_table} WHERE ${f.child_col} IN (${idList}) GROUP BY ${f.child_col};`);
    const n = rc.reduce((s, r) => s + r.n, 0);
    rc.forEach(r => { if (perPhantom[r.cid] != null) perPhantom[r.cid] += r.n; });
    if (n > 0) childRows.push({ fk: `${f.child_table}.${f.child_col}`, n, on_delete: delMap[f.on_delete] || f.on_delete });
  }
  console.table(childRows.sort((a, b) => b.n - a.n));
  const totalChildren = childRows.reduce((s, r) => s + r.n, 0);
  const cascadeAtRisk = childRows.filter(r => r.on_delete === 'CASCADE').reduce((s, r) => s + r.n, 0);
  console.log(`  총 자식행: ${totalChildren} · CASCADE(순소실 위험, re-anchor로 구제): ${cascadeAtRisk}`);

  // ────────────────────────────────────────────────────────────────
  // 2) 복구 소스 해소 (per-phantom) — reservation_id 결정키 우선 + phone/clinic 보강
  // ────────────────────────────────────────────────────────────────
  console.log('\n── [2] per-phantom 복구소스 해소 (reservation_id 결정키 > phone tail4 보강) ──');
  const resolutions = [];
  for (const p of phantoms) {
    // (1순위) 이 phantom 의 check_ins 중 reservation_id → reservations.customer_id(non-masked)
    const resvPath = await q(`
      SELECT DISTINCT r.customer_id AS raw_id, rc.name ~ '\\*' AS raw_masked
      FROM check_ins ci
      JOIN reservations r ON r.id = ci.reservation_id
      JOIN customers rc ON rc.id = r.customer_id
      WHERE ci.customer_id = '${p.id}' AND ci.reservation_id IS NOT NULL
        AND r.customer_id IS NOT NULL AND r.customer_id <> '${p.id}';
    `);
    // (보강) 동일 clinic + phone tail4 일치 + non-masked raw customer. name-stem/temporal 보강신호 동봉(검증용).
    let phoneCands = [];
    if (p.phone_tail && p.phone_tail.length === 4 && p.phone_tail !== '0000') {
      phoneCands = await q(`
        SELECT o.id AS raw_id, o.name ~ '\\*' AS o_masked,
               left(regexp_replace(o.name,'[[:space:]]','','g'),1) AS name_first,
               right(regexp_replace(o.name,'[[:space:]]','','g'),1) AS name_last,
               abs(extract(epoch FROM (o.created_at - '${p.created_at}'::timestamptz)))::int AS created_gap_s
        FROM customers o
        WHERE o.id <> '${p.id}' AND o.clinic_id = '${p.clinic_id}'
          AND NOT (o.name ~ '\\*')
          AND length(regexp_replace(o.phone,'[^0-9]','','g')) >= 8
          AND right(regexp_replace(o.phone,'[^0-9]','','g'),4) = '${p.phone_tail}';
      `);
    }
    const resvIds = [...new Set(resvPath.map(r => r.raw_id).filter(Boolean))];
    const phoneIds = [...new Set(phoneCands.map(r => r.raw_id).filter(Boolean))];
    // 결정: reservation_id 경로가 정확히 1이면 결정적. 없으면 phone 보강이 정확히 1로 수렴 시 채택.
    let decisionSource, rawId, status;
    if (resvIds.length === 1) { decisionSource = 'reservation_id(결정키)'; rawId = resvIds[0]; status = 'RESOLVABLE'; }
    else if (resvIds.length === 0 && phoneIds.length === 1) { decisionSource = 'phone_tail4+clinic(보강 단일수렴)'; rawId = phoneIds[0]; status = 'RESOLVABLE'; }
    else if (resvIds.length >= 2 || phoneIds.length >= 2) { decisionSource = `AMBIGUOUS(resv=${resvIds.length},phone=${phoneIds.length})`; status = 'HOLD_PERROW'; }
    else { decisionSource = 'NO_CANDIDATE'; status = 'HOLD_PERROW'; }
    // 보강신호 스냅샷 (단일 후보일 때)
    const cand = phoneCands.find(c => c.raw_id === rawId);
    const nameStemHint = cand ? `${cand.name_first}·${cand.name_last}` : null;
    const gapS = cand ? cand.created_gap_s : null;
    resolutions.push({ id: s8(p.id), phone_tail: p.phone_tail, resv_cands: resvIds.length, phone_cands: phoneIds.length,
      raw_id: s8(rawId), name_stem: nameStemHint, created_gap_s: gapS, decision: decisionSource, status });
  }
  console.table(resolutions);
  console.log('  ⚠ reservation_id 결정키 = 전 phantom 0건 (self_checkin이 resv_id NULL로 생성 — 포렌식 확증). → 복구는 phone_tail4+clinic 단일수렴 + name-stem/temporal 보강에 의존. DA Q2가 "결정키 아님"으로 분류한 신호이므로 per-row confirm에서 사람 최종판정 필수(§2-F 준용).');
  const resolvable = resolutions.filter(r => r.status === 'RESOLVABLE');
  const holds = resolutions.filter(r => r.status === 'HOLD_PERROW');
  console.log(`  → RESOLVABLE: ${resolvable.length}건 · HOLD(per-row): ${holds.length}건 [${holds.map(h => h.id).join(',')}]`);

  // ────────────────────────────────────────────────────────────────
  // 3) 재앵커 시뮬레이션 (SELECT-only) — §2-3-b 순서 불변식 검증
  // ────────────────────────────────────────────────────────────────
  console.log('\n── [3] 재앵커 시뮬레이션 (무영속, §2-3-b 불변식) ──');
  for (const r of resolvable) {
    const pid = phantoms.find(p => s8(p.id) === r.id).id;
    const moves = perPhantom[pid];   // [1]에서 GROUP BY로 이미 산출 (재쿼리 없음)
    // raw target 검증: 존재·non-masked·distinct
    const rawFull = resolutions.find(x => x.id === r.id).raw_id;
    const rawChk = await q(`
      SELECT count(*)::int AS exists_cnt,
             bool_or(name ~ '\\*') AS raw_masked
      FROM customers WHERE left(id::text,8) = '${rawFull}';
    `);
    // denorm check_ins 마스킹 잔존 (재앵커 후 raw 값으로 refresh 필요분)
    const denorm = await q(`
      SELECT count(*)::int AS n FROM check_ins
      WHERE customer_id = '${pid}' AND (customer_name ~ '\\*' OR customer_name = '미확인'
            OR length(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7);
    `);
    console.log(`  [${r.id} → raw ${rawFull}] 이동 자식=${moves} · raw존재=${rawChk[0].exists_cnt} · raw_masked=${rawChk[0].raw_masked} · check_ins denorm 마스킹잔존=${denorm[0].n}`);
    console.log(`     §2-3-b: (1) 전 ${fks.length}FK 자식 raw로 FK-only UPDATE(${moves}행) → (2) phantom 자식 0건 재검증 → (3) archive-first 제거. abort조건=재검증 잔존>0.`);
  }

  // HOLD (02594dfa) per-row 판정근거
  console.log('\n── HOLD (§2-F per-row, INV-3 fail-closed) ──');
  for (const h of holds) {
    const pid = phantoms.find(p => s8(p.id) === h.id).id;
    const meta = await q(`
      SELECT (name ~ '\\*') AS name_masked, length(name) AS name_len,
             right(regexp_replace(phone,'[^0-9]','','g'),4) AS ptail,
             (created_at AT TIME ZONE 'Asia/Seoul') AS created_kst
      FROM customers WHERE id = '${pid}';
    `);
    console.log(`  [${h.id}] resv_cands=${h.resv_cands} phone_cands=${h.phone_cands} · tail=${meta[0].ptail} name_len=${meta[0].name_len} name_masked=${meta[0].name_masked} created_kst=${meta[0].created_kst}`);
    console.log(`     → INV-3 fail-closed(≥2 or 0 후보) → auto-merge 금지, per-row 사람 confirm 필수. test/DUMMY 근거 스냅샷 동봉 후 판정.`);
  }

  // ────────────────────────────────────────────────────────────────
  // 4) 요약 (DA re-confirm / per-row confirm 동봉)
  // ────────────────────────────────────────────────────────────────
  console.log('\n=== DRY-RUN 요약 ===');
  const summary = {
    window_kst: { start: WIN_START, end: WIN_END },
    masked_customers_total: phantoms.length,
    fk_constraints: fks.length,
    fk_child_tables: new Set(fks.map(f => f.child_table)).size,
    cascade_fk_count: cascadeFks.length,
    phantom_children_total: totalChildren,
    cascade_children_at_risk: cascadeAtRisk,
    resolvable: resolvable.length,
    hold_perrow: holds.length,
    hold_ids: holds.map(h => h.id),
    resolvable_ids: resolvable.map(r => r.id),
    mutation_executed: 0,
    persistence: 'NONE (SELECT-only)',
  };
  console.log('DRYRUN_RESULT:', JSON.stringify(summary, null, 2));
  console.log('\n⚠ READ-ONLY dry-run. 실 정정은 DA GO 재확인 + per-row confirm + supervisor 최종게이트 후에만.');
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
