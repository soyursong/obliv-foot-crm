/**
 * T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — 라이즈드바 per-row probe (READ-ONLY)
 *
 * DA CONSULT-REPLY addendum (MSG-20260714-013056-zbn9) 반영:
 *   - reservation_id 결정키 전건 부재(self_checkin phantom = resv_id NULL) 확증 → 6건 batch→per-row 전량 격상.
 *   - INV-3 정확단일수렴(비협상): ≥2 독립 보강신호가 정확히 1 raw 후보로 수렴해야 채택. ≥2 후보 → HOLD.
 *   - tail4 충돌가드: phone_tail4+clinic 이 non-masked raw master를 정확히 1건 반환해야(≥2 → HOLD).
 *     name-stem·temporal 은 그 단일수렴의 교차확인으로만. 단독 tie-break 승격 금지.
 *   - 약보강행 강등: temporal gap 큰 행(#5 44a6a076 ~11d, #1 0356b229 ~19.7h)은 temporal 무효 →
 *     tail4+clinic+name-stem 만으로 clean single convergence 못 이루면 temporal로 메우지 말고 HOLD 강등.
 *
 * ★★★ READ-ONLY. SELECT + pg_get_constraintdef 만. UPDATE/DELETE/INSERT 0. ★★★
 * PHI 위생(§4): 실명/전체번호 미출력. name-stem은 마스킹 첫/끝글자 일치 boolean만.
 * author: dev-foot / 2026-07-14 · Management API (SUPABASE_ACCESS_TOKEN)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  try { TOKEN = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch {}
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function q(sql, retry = 5) {
  for (let i = 0; i < retry; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const t = await r.text();
    if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
    await sleep(180);
    return JSON.parse(t);
  }
  throw new Error('429 재시도 초과');
}
const s8 = (x) => (x == null ? null : String(x).slice(0, 8));
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// frozen map (apply-prep 과 동일 6 phantom→raw)
const MAP = [
  { phantom: '0356b229-e8c7-4655-aa6e-651b15370c1f', raw: 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b', tail: '9089', n: 1 },
  { phantom: '512998d0-d51a-42c4-947e-b0cb2cc69da4', raw: '8fa12f4c-abfe-405e-8736-c2ca8e4aef8a', tail: '5453', n: 2 },
  { phantom: '67ea1793-05e5-4d4a-b5c1-1ec73486e317', raw: '7ad9e9a4-5e52-418c-acdb-300ee7d30e0b', tail: '0011', n: 3 },
  { phantom: 'bd307dfe-79f0-4fea-86a6-0957cea492cd', raw: 'd916d27b-e1a4-42ea-893e-db9a4fd3a461', tail: '2200', n: 4 },
  { phantom: '44a6a076-ca66-458a-bdc5-e0a3a12c2e67', raw: 'd2ba1e9a-74d2-4866-a7b8-d2282fccc2eb', tail: '1122', n: 5 },
  { phantom: '2dc21d1c-6e9f-4643-a733-dca92252d830', raw: '38e1a858-71fc-4b74-9032-7a95298bb00b', tail: '0101', n: 6 },
];

// 약보강행: temporal gap 이 이 임계 이상이면 temporal 보강력 상실 (DA addendum 명시 2건 + 규율 일반화)
const WEAK_TEMPORAL_GAP_S = 6 * 3600; // 6h 초과 gap → temporal 교차확인 무효 (DA: ~19.7h·~11d 강등 근거)

async function main() {
  console.log('=== 라이즈드바 per-row probe (READ-ONLY) — DA addendum MSG-20260714-013056-zbn9 ===\n');
  const rows = [];

  for (const m of MAP) {
    // phantom 메타 (freeze 재검증 + name masking 형태)
    const pm = (await q(`
      SELECT (name ~ '\\*') AS name_masked, length(name) AS name_len,
             left(regexp_replace(coalesce(name,''),'[[:space:]]','','g'),1) AS name_first,
             right(regexp_replace(coalesce(name,''),'[[:space:]]','','g'),1) AS name_last,
             replace(regexp_replace(coalesce(name,''),'[[:space:]]','','g'),'*','') AS name_visible,
             right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) AS ptail,
             length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) AS pdigits,
             (created_at AT TIME ZONE 'Asia/Seoul') AS created_kst, created_at,
             (lower(coalesce(name,'')) LIKE '%test%' OR lower(coalesce(name,'')) LIKE '%dummy%'
              OR lower(coalesce(name,'')) LIKE '%테스트%' OR coalesce(name,'')='미확인') AS test_hint
      FROM customers WHERE id = '${m.phantom}' AND clinic_id = '${CLINIC}';
    `))[0];
    const freezeOk = !!pm && !!pm.name_masked === true || (pm && (pm.pdigits >= 1 && pm.pdigits <= 7));

    // tail4 충돌가드: 동 clinic·non-masked·8+ digit·tail4 일치 raw 후보 전량 열거
    const cands = await q(`
      SELECT o.id,
             left(regexp_replace(coalesce(o.name,''),'[[:space:]]','','g'),1) AS name_first,
             right(regexp_replace(coalesce(o.name,''),'[[:space:]]','','g'),1) AS name_last,
             regexp_replace(coalesce(o.name,''),'[[:space:]]','','g') AS name_full,
             abs(extract(epoch FROM (o.created_at - '${pm ? pm.created_at : 'now()'}'::timestamptz)))::int AS gap_s,
             (lower(coalesce(o.name,'')) LIKE '%test%' OR lower(coalesce(o.name,'')) LIKE '%dummy%'
              OR lower(coalesce(o.name,'')) LIKE '%테스트%') AS test_hint
      FROM customers o
      WHERE o.clinic_id = '${CLINIC}' AND o.id <> '${m.phantom}'
        AND NOT (o.name ~ '\\*')
        AND length(regexp_replace(coalesce(o.phone,''),'[^0-9]','','g')) >= 8
        AND right(regexp_replace(coalesce(o.phone,''),'[^0-9]','','g'),4) = '${m.tail}';
    `);

    const candCount = cands.length;
    const declaredRaw = cands.find(c => c.id === m.raw);
    // name-stem 교차확인: phantom 의 visible(비마스킹) 글자가 후보 name 에 포함 + 첫글자(성) 일치
    let nameStemMatch = null;
    if (declaredRaw && pm) {
      const visible = (pm.name_visible || '').replace(/[^가-힣a-zA-Z0-9]/g, '');
      const firstOk = pm.name_first && pm.name_first !== '*' && declaredRaw.name_first === pm.name_first;
      const lastOk = pm.name_last && pm.name_last !== '*' && declaredRaw.name_last === pm.name_last;
      const containOk = visible.length > 0 && declaredRaw.name_full.includes(visible);
      nameStemMatch = { first_char_match: !!firstOk, last_char_match: !!lastOk, visible_substr_match: !!containOk,
                        any: !!(firstOk || lastOk || containOk), visible_len: visible.length };
    }

    const gapS = declaredRaw ? declaredRaw.gap_s : null;
    const weakTemporal = gapS != null && gapS > WEAK_TEMPORAL_GAP_S;

    // ── 라이즈드바 분류 ──
    // 1) tail4 충돌가드: candCount 정확히 1 아니면 → HOLD
    // 2) declared raw 가 후보에 없으면 → HOLD (freeze drift)
    // 3) 약보강행: temporal 무효 → name-stem 교차확인 필수. name-stem any=false 면 HOLD 강등.
    // 4) 정상행: tail4+clinic single(1신호) + (temporal OR name-stem)(2번째 신호) 로 ≥2 수렴 → ADOPT.
    let verdict, reason;
    if (!freezeOk) { verdict = 'HOLD'; reason = 'freeze-drift(마스킹 시그니처 소실)'; }
    else if (candCount === 0) { verdict = 'HOLD'; reason = 'tail4+clinic non-masked 후보 0'; }
    else if (candCount >= 2) { verdict = 'HOLD'; reason = `tail4 충돌(non-masked 후보 ${candCount}≥2) → INV-3 fail-closed`; }
    else if (!declaredRaw) { verdict = 'HOLD'; reason = 'declared raw != tail4 단일후보(drift)'; }
    else if (weakTemporal && !(nameStemMatch && nameStemMatch.any)) {
      verdict = 'HOLD'; reason = `약보강행(gap ${(gapS/3600).toFixed(1)}h>${WEAK_TEMPORAL_GAP_S/3600}h → temporal 무효) + name-stem 교차확인 실패 → 강등`;
    } else {
      // ≥2 독립신호 정확단일수렴 확인
      const sigs = [];
      sigs.push('tail4+clinic(단일)');
      if (nameStemMatch && nameStemMatch.any) sigs.push('name-stem');
      if (!weakTemporal && gapS != null) sigs.push(`temporal(${(gapS/3600).toFixed(2)}h)`);
      if (sigs.length >= 2) { verdict = 'ADOPT'; reason = `INV-3 정확단일수렴 (${sigs.join(' + ')})`; }
      else { verdict = 'HOLD'; reason = `보강신호 ${sigs.length}<2 (약보강행 temporal 무효 반영) → HOLD`; }
    }

    rows.push({
      n: m.n, phantom8: s8(m.phantom), raw8: s8(m.raw), tail4: m.tail,
      tail4_clinic_candidate_count: candCount,
      declared_raw_in_candidates: !!declaredRaw,
      name_stem: nameStemMatch,
      temporal_gap_s: gapS, temporal_gap_h: gapS != null ? +(gapS/3600).toFixed(2) : null,
      weak_temporal: weakTemporal,
      phantom_test_hint: pm ? !!pm.test_hint : null,
      raw_test_hint: declaredRaw ? !!declaredRaw.test_hint : null,
      phantom_name_masked: pm ? !!pm.name_masked : null,
      phantom_pdigits: pm ? pm.pdigits : null,
      created_kst: pm ? pm.created_kst : null,
      verdict, reason,
    });
    console.log(`[#${m.n} ${s8(m.phantom)}→${s8(m.raw)}] tail=${m.tail} cand=${candCount} gap=${gapS!=null?(gapS/3600).toFixed(2)+'h':'—'} weakT=${weakTemporal} stem=${nameStemMatch?JSON.stringify(nameStemMatch.any):'—'} → ${verdict} (${reason})`);
  }

  const adopt = rows.filter(r => r.verdict === 'ADOPT');
  const hold = rows.filter(r => r.verdict === 'HOLD');
  console.log(`\n=== 라이즈드바 분류 결과 ===`);
  console.log(`ADOPT(re-anchor): ${adopt.length}건 [${adopt.map(r => '#'+r.n+' '+r.phantom8).join(', ')}]`);
  console.log(`HOLD(per-row 보류): ${hold.length}건 [${hold.map(r => '#'+r.n+' '+r.phantom8+':'+r.reason).join(' | ')}]`);

  // git 워킹 트리 = count/PK8만 (PHI 없음)
  const gitEvidence = {
    ticket: 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL',
    da_reply: 'MSG-20260714-013056-zbn9 (addendum)',
    generated_note: 'READ-ONLY probe. mutation 0. PHI(실명/전화)=off-git only.',
    weak_temporal_gap_threshold_h: WEAK_TEMPORAL_GAP_S / 3600,
    rows: rows.map(r => ({
      n: r.n, phantom8: r.phantom8, raw8: r.raw8, tail4: r.tail4,
      tail4_clinic_candidate_count: r.tail4_clinic_candidate_count,
      name_stem_any_match: r.name_stem ? r.name_stem.any : null,
      temporal_gap_h: r.temporal_gap_h, weak_temporal: r.weak_temporal,
      phantom_test_hint: r.phantom_test_hint, raw_test_hint: r.raw_test_hint,
      verdict: r.verdict, reason: r.reason,
    })),
    adopt_count: adopt.length, hold_count: hold.length,
    adopt_phantoms8: adopt.map(r => r.phantom8),
    hold_phantoms8: hold.map(r => r.phantom8),
    mutation_executed: 0, persistence: 'NONE (SELECT-only)',
  };
  writeFileSync('db-gate/T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL_raisedbar_result.json', JSON.stringify(gitEvidence, null, 2));
  console.log('\n[git] db-gate/..._raisedbar_result.json 기록 (count/PK8만)');

  // off-git per-row confirm 스냅샷 (PHI + human_confirm PENDING)
  const offdir = `${homedir()}/foot-phi-offgit`;
  try { mkdirSync(offdir, { recursive: true }); } catch {}
  const offSnap = {
    ticket: 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL',
    da_reply: 'MSG-20260714-013056-zbn9',
    note: 'off-git PHI 판정근거 스냅샷. per-row 사람 confirm 전 human_confirm=PENDING. auto-merge 금지.',
    rows: rows.map(r => ({
      n: r.n, phantom: MAP[r.n-1].phantom, raw: MAP[r.n-1].raw, tail4: r.tail4,
      tail4_clinic_candidate_count: r.tail4_clinic_candidate_count,
      name_stem: r.name_stem, temporal_gap_s: r.temporal_gap_s, temporal_gap_h: r.temporal_gap_h,
      weak_temporal: r.weak_temporal, phantom_test_hint: r.phantom_test_hint, raw_test_hint: r.raw_test_hint,
      created_kst: r.created_kst, verdict: r.verdict, reason: r.reason,
      human_confirm: 'PENDING',
    })),
    hold_02594dfa: { note: '§2-F per-row 별도 HOLD, 본 배치 제외. tail 0000 후보 6 DUMMY.', human_confirm: 'PENDING' },
  };
  const offpath = `${offdir}/T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL_perrow_confirm.json`;
  writeFileSync(offpath, JSON.stringify(offSnap, null, 2));
  console.log(`[off-git] ${offpath} 기록 (PHI + human_confirm=PENDING)`);
  console.log('\n⚠ READ-ONLY. per-row 사람 confirm + supervisor 최종게이트 前 apply/deploy-ready 금지.');
}
main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
