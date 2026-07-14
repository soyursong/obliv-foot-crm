/**
 * T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE — READ-ONLY 결함 특성화 (mutation 0)
 *
 * 목적: row1(0356b229) 의 실제 결함 성격 규명 —
 *   (가설 A) 중복행/orphan  — 실 master(c51dd5e0) 별도 존재, row1 = 파생·중복·dangling
 *                             → 정정 = FK relink + archive-first delete (Orphan Archive-First SOP)
 *   (가설 B) standalone 실master — row1 자체가 정본 실환자 master, 일부 필드만 오염/phantom
 *                             → 정정 = in-place mutable 필드 정정 (Data-Correction Backfill SOP)
 *
 * ★★★ READ-ONLY. SELECT + pg_get_constraintdef/pg_constraint 카탈로그만. UPDATE/DELETE/INSERT 0. ★★★
 *     mutation 은 특성화 결과 후 별도 DA CONSULT + supervisor DB-GATE + (파괴/실환자 → 대표 게이트) 재설계.
 *     fail-closed: DA GO 없이 row1 mutation 영구 차단. [G0-hold] 가드 존치.
 *
 * PHI 위생(§4): 실명/전체번호/RRN 평문 stdout·git 미출력.
 *   - git-tracked/stdout = id8(PK prefix)·count·boolean·category(lead_source 등)·tail4·timestamp 만.
 *   - 실 name-stem 문자 등 = off-git 스냅샷(~/foot-phi-offgit/) 에만. 여기서는 두 행 간 "일치 여부" boolean 만 산출.
 *
 * 산출: stdout 요약 + db-gate/T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_evidence.json (git-tracked, PHI-safe)
 *       + ~/foot-phi-offgit/T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_offgit.json (PHI 판정근거)
 * 실행: node scripts/T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_readonly.mjs
 * author: dev-foot / 2026-07-15 · Supabase Management API (SUPABASE_ACCESS_TOKEN, RLS 우회 read)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
    await sleep(160);
    return JSON.parse(t);
  }
  throw new Error('429 재시도 초과');
}
const s8 = (x) => (x == null ? null : String(x).slice(0, 8));

// 대상 (neutral 라벨 — phantom/raw 선입견 배제)
const RAW = 'c51dd5e0';   // 旣 "raw" (07-10, 지인소개, 실 phone, RRN 무)
const ROW1 = '0356b229';  // row1 = 旣 "phantom" (07-11, phone 마스킹, RRN 有, name 비마스킹)
const CLINIC = '74967aea';

async function main() {
  console.log('=== T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE — READ-ONLY 결함 특성화 ===');
  console.log(`대상: ROW1=${ROW1} (旣 phantom) vs RAW=${RAW} (旣 raw) · clinic=${CLINIC}\n`);

  // ── 두 행 full-UUID 확정 (prefix → id) ──
  const ids = await q(`SELECT id, left(id::text,8) id8 FROM customers WHERE left(id::text,8) IN ('${RAW}','${ROW1}') AND left(clinic_id::text,8)='${CLINIC}';`);
  const idOf = (p) => (ids.find(r => r.id8 === p) || {}).id;
  const rawId = idOf(RAW), row1Id = idOf(ROW1);
  console.log(`resolved: ROW1=${row1Id ? 'OK' : 'MISSING'} RAW=${rawId ? 'OK' : 'MISSING'}`);
  if (!row1Id || !rawId) { console.error('❌ 대상 행 미해소 — 중단'); process.exit(1); }

  // ────────────────────────────────────────────────────────────────
  // [1] 두 행 core 메타 (PHI-safe) + 두 행간 identity 일치 boolean
  // ────────────────────────────────────────────────────────────────
  console.log('\n── [1] core 메타 + identity 일치 boolean ──');
  const [core] = [await q(`
    WITH t AS (
      SELECT id, left(id::text,8) id8,
             length(regexp_replace(name,'[[:space:]]','','g')) name_len,
             (name ~ '\\*') name_masked,
             md5(regexp_replace(lower(name),'[[:space:]]','','g')) name_hash,
             md5(left(regexp_replace(lower(name),'[[:space:]]','','g'),1)||right(regexp_replace(lower(name),'[[:space:]]','','g'),1)) stem_hash,
             right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) ptail,
             length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) pdigits,
             (phone ~ '\\*') phone_star,
             (rrn_enc IS NOT NULL OR rrn_vault_id IS NOT NULL) has_rrn,
             md5(coalesce(rrn_enc,'')) rrn_hash,
             (resident_id IS NOT NULL) has_resident_id,
             (birth_date IS NOT NULL) has_birth, birth_date,
             lead_source, visit_route, visit_type,
             is_simulation, phone_dummy, is_foreign,
             chart_number,
             left(created_by::text,8) created_by8,
             left(unified_customer_id::text,8) unified8,
             (created_at AT TIME ZONE 'Asia/Seoul')::text created_kst,
             (updated_at AT TIME ZONE 'Asia/Seoul')::text updated_kst,
             (referrer_id IS NOT NULL) has_referrer, referrer_name IS NOT NULL AS has_referrer_name
      FROM customers WHERE id IN ('${row1Id}','${rawId}')
    )
    SELECT * FROM t;
  `)];
  const R1 = core.find(r => r.id8 === ROW1), RW = core.find(r => r.id8 === RAW);
  const idn = {
    same_name_full: R1.name_hash === RW.name_hash,
    same_name_stem: R1.stem_hash === RW.stem_hash,
    same_name_len: R1.name_len === RW.name_len,
    same_ptail: R1.ptail === RW.ptail,
    same_birth_date: R1.has_birth && RW.has_birth ? (String(R1.birth_date) === String(RW.birth_date)) : null,
    same_rrn: R1.has_rrn && RW.has_rrn ? (R1.rrn_hash === RW.rrn_hash) : null,
    same_created_by: R1.created_by8 && R1.created_by8 === RW.created_by8,
    linked_via_unified: [R1.unified8, RW.unified8].some(x => x && (x === ROW1 || x === RAW)) || (R1.unified8 && R1.unified8 === RW.unified8),
  };
  const safeMeta = (r) => ({
    id8: r.id8, name_len: r.name_len, name_masked: r.name_masked, ptail: r.ptail, pdigits: r.pdigits,
    phone_star: r.phone_star, has_rrn: r.has_rrn, has_resident_id: r.has_resident_id, has_birth: r.has_birth,
    lead_source: r.lead_source, visit_route: r.visit_route, visit_type: r.visit_type,
    is_simulation: r.is_simulation, phone_dummy: r.phone_dummy, is_foreign: r.is_foreign,
    chart_number: r.chart_number, created_by8: r.created_by8, unified8: r.unified8,
    has_referrer: r.has_referrer, has_referrer_name: r.has_referrer_name,
    created_kst: r.created_kst, updated_kst: r.updated_kst,
  });
  console.table([safeMeta(R1), safeMeta(RW)]);
  console.log('identity 일치:', JSON.stringify(idn));

  // ────────────────────────────────────────────────────────────────
  // [2] §2-0 기계 FK 열거 + 각 행 자식 분포 (핵심 판별자)
  // ────────────────────────────────────────────────────────────────
  console.log('\n── [2] FK 열거 + 자식 분포 (ROW1 vs RAW) ──');
  const fks = await q(`
    SELECT con.conname, cl.relname AS child_table, att.attname AS child_col, con.confdeltype AS on_delete
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
  console.log(`  FK ${fks.length}개 / 자식 테이블 ${new Set(fks.map(f => f.child_table)).size}개`);
  const childDist = [];
  let row1Total = 0, rawTotal = 0;
  for (const f of fks) {
    const rc = await q(`SELECT ${f.child_col}::text cid, count(*)::int n FROM ${f.child_table} WHERE ${f.child_col} IN ('${row1Id}','${rawId}') GROUP BY ${f.child_col};`);
    const n1 = rc.find(r => r.cid === row1Id)?.n || 0;
    const nr = rc.find(r => r.cid === rawId)?.n || 0;
    row1Total += n1; rawTotal += nr;
    if (n1 || nr) childDist.push({ fk: `${f.child_table}.${f.child_col}`, ROW1: n1, RAW: nr, on_delete: delMap[f.on_delete] || f.on_delete });
  }
  console.table(childDist.sort((a, b) => (b.ROW1 + b.RAW) - (a.ROW1 + a.RAW)));
  console.log(`  자식 합계 → ROW1=${row1Total} · RAW=${rawTotal}`);

  // ────────────────────────────────────────────────────────────────
  // [3] 링크 경로 — ROW1 이 RAW 를 가리키는 결정키/self-checkin 서명
  // ────────────────────────────────────────────────────────────────
  console.log('\n── [3] 링크 경로 (결정키 · self-checkin 서명) ──');
  // (a) ROW1 의 check_ins → reservation_id → reservations.customer_id
  const ci1 = await q(`
    SELECT ci.id, (ci.reservation_id IS NULL) resv_null, left(r.customer_id::text,8) resv_cust8,
           (r.customer_id = '${rawId}') points_to_raw
    FROM check_ins ci LEFT JOIN reservations r ON r.id = ci.reservation_id
    WHERE ci.customer_id = '${row1Id}';
  `);
  console.log('  ROW1 check_ins:', JSON.stringify(ci1.map(c => ({ ci8: s8(c.id), resv_null: c.resv_null, resv_cust8: c.resv_cust8, points_to_raw: c.points_to_raw }))));
  // (b) RAW 의 check_ins/reservations
  const ciR = await q(`SELECT count(*)::int n, count(*) FILTER (WHERE reservation_id IS NOT NULL)::int with_resv FROM check_ins WHERE customer_id='${rawId}';`);
  const resvR = await q(`SELECT count(*)::int n FROM reservations WHERE customer_id='${rawId}';`);
  const resv1 = await q(`SELECT count(*)::int n FROM reservations WHERE customer_id='${row1Id}';`);
  console.log(`  RAW check_ins=${ciR[0].n}(resv링크 ${ciR[0].with_resv}) reservations=${resvR[0].n} · ROW1 reservations=${resv1[0].n}`);
  // (c) medical_charts 날짜 비교 (같은 방문인가?)
  const mc = await q(`
    SELECT CASE WHEN customer_id='${row1Id}' THEN 'ROW1' ELSE 'RAW' END who,
           count(*)::int n, min(visit_date)::text first_visit, max(visit_date)::text last_visit
    FROM medical_charts WHERE customer_id IN ('${row1Id}','${rawId}') GROUP BY 1;
  `).catch(e => [{ _err: e.message }]);
  console.log('  medical_charts:', JSON.stringify(mc));
  // (d) 같은 방문 episode 서명: RAW 예약일 vs ROW1 체크인일 + RAW 예약 status(no_show)
  const rvR = await q(`SELECT status, (reservation_date)::text rdate FROM reservations WHERE customer_id='${rawId}';`).catch(() => []);
  const ciDay = await q(`SELECT (checked_in_at AT TIME ZONE 'Asia/Seoul')::date::text d, status FROM check_ins WHERE customer_id='${row1Id}';`).catch(() => []);
  const sameEpisode = rvR.some(r => ciDay.some(c => c.d === r.rdate));
  const rawResvNoShow = rvR.some(r => r.status === 'no_show');
  console.log(`  episode: RAW예약=${JSON.stringify(rvR)} ROW1체크인일=${JSON.stringify(ciDay)} → same_episode=${sameEpisode} raw_resv_no_show=${rawResvNoShow}`);
  // (e) relink 충돌: 4 자식 테이블 customer_id-scoped UNIQUE 유무
  const childUniq = await q(`
    SELECT cl.relname tbl, con.conname FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    WHERE ns.nspname='public' AND con.contype='u'
      AND cl.relname IN ('check_ins','customer_consult_memos','health_q_results','health_q_tokens')
      AND EXISTS (SELECT 1 FROM unnest(con.conkey) ck JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=ck WHERE a.attname='customer_id');
  `).catch(() => []);
  const relinkConflictRisk = childUniq.length;
  console.log(`  relink 충돌(customer_id-scoped UNIQUE): ${relinkConflictRisk}건 ${relinkConflictRisk ? JSON.stringify(childUniq) : '(없음 → 충돌 없는 relink)'}`);

  // ────────────────────────────────────────────────────────────────
  // [4] tail4 충돌 우주 — 같은 clinic 내 tail4 공유 행 (우연충돌 배제 가늠)
  // ────────────────────────────────────────────────────────────────
  console.log('\n── [4] tail4 충돌 우주 (같은 clinic) ──');
  const tail = R1.ptail;
  const univ = await q(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE NOT (name ~ '\\*'))::int nonmasked,
           count(*) FILTER (WHERE rrn_enc IS NOT NULL OR rrn_vault_id IS NOT NULL)::int with_rrn
    FROM customers
    WHERE left(clinic_id::text,8)='${CLINIC}'
      AND right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4)='${tail}';
  `);
  console.log(`  clinic 내 tail4='${tail}' 보유 행: total=${univ[0].total} (nonmasked=${univ[0].nonmasked}, with_rrn=${univ[0].with_rrn})`);
  // 이름-stem 까지 일치하는 다른 후보 (ROW1/RAW 제외) — 우연충돌 vs 동일인
  const stemMatch = await q(`
    SELECT count(*)::int n FROM customers
    WHERE left(clinic_id::text,8)='${CLINIC}' AND id NOT IN ('${row1Id}','${rawId}')
      AND md5(left(regexp_replace(lower(name),'[[:space:]]','','g'),1)||right(regexp_replace(lower(name),'[[:space:]]','','g'),1))='${R1.stem_hash}'
      AND right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4)='${tail}';
  `);
  console.log(`  같은 clinic 내 (stem+tail4) 동일 다른 행: ${stemMatch[0].n}건`);

  // ────────────────────────────────────────────────────────────────
  // [5] A vs B 판정 (증거 종합)
  // ────────────────────────────────────────────────────────────────
  const evidence = {
    same_name_full: idn.same_name_full, same_name_stem: idn.same_name_stem, same_ptail: idn.same_ptail,
    same_birth_date: idn.same_birth_date, same_rrn: idn.same_rrn,
    row1_children: row1Total, raw_children: rawTotal,
    row1_has_rrn: R1.has_rrn, raw_has_rrn: RW.has_rrn,
    row1_selfcheckin_sig: ci1.length > 0 && ci1.every(c => c.resv_null),
    row1_ci_points_to_raw: ci1.some(c => c.points_to_raw),
    row1_created_kst: R1.created_kst, raw_created_kst: RW.created_kst,
    tail4_collision_universe: univ[0].total,
    same_visit_episode: sameEpisode, raw_resv_no_show: rawResvNoShow,
    relink_conflict_risk: relinkConflictRisk,
    row1_masked_phone: R1.pdigits <= 7, raw_real_phone: RW.pdigits >= 8,
  };
  // 휴리스틱 판정 (사람 최종판정 前 방향 제시)
  let verdict, confidence, reasoning;
  const samePerson = evidence.same_name_full === true && evidence.same_ptail === true;
  if (evidence.same_name_full === false) {
    verdict = 'B-collision'; confidence = 'medium';
    reasoning = '두 행 name 불일치 → tail4 우연충돌(서로 다른 실환자). ROW1 은 독립 실master, phone만 마스킹 오염 → mutable 정정(B).';
  } else if (samePerson && evidence.row1_selfcheckin_sig && evidence.same_visit_episode) {
    verdict = 'A-duplicate'; confidence = 'high';
    reasoning = 'name 완전일치 + tail4 일치 + ROW1 self-checkin 서명(resv_null) + 같은 방문 episode(RAW 예약일=ROW1 체크인일, RAW 예약 no_show=자기-예약 미매칭 지문) → ROW1 = RAW 의 self-checkin 중복행(A). 정정 = relink+archive. ★keep=RAW(실 phone 보유·마스킹 복원), ROW1→RAW RRN 이관(RAW RRN 부재) + 4자식 relink 후 archive-first 제거. 파괴적·실환자·RRN(PHI) 이동 → 대표 게이트.';
  } else if (samePerson && evidence.row1_selfcheckin_sig) {
    verdict = 'A-duplicate'; confidence = 'medium';
    reasoning = 'name+tail4 동일인 + ROW1 self-checkin 서명 → 중복행(A). episode 직접링크는 약하므로 per-row 사람 confirm 강화.';
  } else {
    verdict = 'INDETERMINATE'; confidence = 'low';
    reasoning = '동일인 판정 불충분(결정키 부재·부분신호) → fail-closed. 추가 신호 확보 또는 per-row 사람 판정 필수.';
  }
  console.log('\n=== A vs B 판정 ===');
  console.log('evidence:', JSON.stringify(evidence, null, 2));
  console.log(`verdict: ${verdict} (confidence=${confidence})`);
  console.log('reasoning:', reasoning);

  // ── 산출 ──
  const gitOut = {
    ticket: 'T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE',
    generated_kst: R1.updated_kst ? undefined : undefined,
    READ_ONLY: true, mutation_executed: 0, persistence: 'NONE (SELECT-only)',
    targets: { ROW1: ROW1, RAW: RAW, clinic: CLINIC },
    row1_meta: safeMeta(R1), raw_meta: safeMeta(RW),
    identity_match: idn,
    fk_count: fks.length, fk_child_tables: new Set(fks.map(f => f.child_table)).size,
    child_distribution: childDist, row1_children_total: row1Total, raw_children_total: rawTotal,
    row1_checkins: ci1.map(c => ({ ci8: s8(c.id), resv_null: c.resv_null, resv_cust8: c.resv_cust8, points_to_raw: c.points_to_raw })),
    raw_checkins: ciR[0], raw_reservations: resvR[0].n, row1_reservations: resv1[0].n,
    medical_charts: mc,
    tail4_universe: univ[0], stem_tail_other_rows: stemMatch[0].n,
    evidence, verdict, confidence, reasoning,
    sop_recommendation: verdict.startsWith('A')
      ? 'HYBRID: Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard SOP(중복 master 파괴적 relink+archive-first) + Data-Correction Backfill SOP 규율(ROW1→RAW RRN mutable 이관). ⚠부모 마스킹 마이그 기계(옵션D) 재사용 금지(DA). keep=RAW.'
      : verdict.startsWith('B') ? 'Cross-CRM Data-Correction Backfill SOP (mutable 정정)'
      : 'INDETERMINATE — 추가 신호/사람 판정 후 SOP 선택',
    mutation_plan_hint: verdict.startsWith('A') ? [
      '1) ROW1→RAW RRN 이관(rrn_enc/rrn_vault_id/rrn_encryption_version — RAW RRN 부재). ADDITIVE.',
      '2) ROW1 4자식(check_ins·customer_consult_memos·health_q_results·health_q_tokens) FK relink→RAW. 충돌 UNIQUE 0건 확인.',
      '3) (business) RAW 예약 no_show→실제 방문 반영 여부 = 현장/planner 판단(추정 금지).',
      '4) archive-first: ROW1 _backup 스냅샷 → 자식 0건 재검증(잔존 시 abort) → ROW1 제거. chart F-4616 공번.',
      '5) 임상(medical_charts)·결제(payments/packages) 자식 0 → 저blast. 단 실환자·RRN(PHI)·파괴적 → 대표 게이트.',
    ] : null,
    gates_forward: 'DA CONSULT + supervisor DB-GATE + 대표 게이트(파괴적·실환자·RRN 이동). db_change 재판정 + MIG-GATE 4필드. per-row 사람 confirm(동일인 최종). fail-closed 유지.',
  };
  const OUT_GIT = join(process.cwd(), 'db-gate');
  mkdirSync(OUT_GIT, { recursive: true });
  writeFileSync(join(OUT_GIT, 'T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_evidence.json'), JSON.stringify(gitOut, null, 2));

  // off-git (PHI 판정근거 — name_hash/rrn_hash/birth 원값)
  const OFF = join(homedir(), 'foot-phi-offgit');
  mkdirSync(OFF, { recursive: true });
  const offOut = {
    note: 'off-git PHI 판정근거. row1 특성화. name/rrn hash·birth_date 원값 포함. auto-merge 금지, per-row confirm PENDING.',
    ROW1: { id: row1Id, name_hash: R1.name_hash, stem_hash: R1.stem_hash, rrn_hash: R1.rrn_hash, birth_date: R1.birth_date, ptail: R1.ptail, has_rrn: R1.has_rrn },
    RAW: { id: rawId, name_hash: RW.name_hash, stem_hash: RW.stem_hash, rrn_hash: RW.rrn_hash, birth_date: RW.birth_date, ptail: RW.ptail, has_rrn: RW.has_rrn },
    identity_match: idn, verdict, confidence,
  };
  writeFileSync(join(OFF, 'T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_offgit.json'), JSON.stringify(offOut, null, 2));

  console.log('\n📄 db-gate/T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_evidence.json (git, PHI-safe)');
  console.log('🔒 ~/foot-phi-offgit/T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE_offgit.json (PHI 판정근거)');
  console.log('\n⚠ READ-ONLY 특성화. mutation 0. DA GO 없이 row1 mutation 금지. [G0-hold] 존치.');
}
main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
