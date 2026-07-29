// T-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT — AC-2 커버리지 확장 (center='body')
// ══════════════════════════════════════════════════════════════════════════
// 지시: planner FOLLOWUP MSG-20260729-165546-jho2 / 티켓 §[PLANNER-RESOLUTION] ★AC-2 커버리지 확장.
//   直전 AC-2 는 foot 430 raw(center='foot' merchant band) 스코프였고 8자형 0.
//   그러나 총괄 6,770 송도/8자형 승인·취소 공유 trxid = center='body' 행(같은 물리테이블).
//   AC-3 composite 가 이 행들도 처리(center 무관 全 행) → AC-2 probe 를 center='body' 로 확장:
//     (a) 8자형 dup 지문 존재  (b) undercount/false-merge 현행 위험  (c) Plan B 직수집 활성화 노출 경로.
//   AC-4 regression fixture 가 실제 songdo body 데이터를 반영하도록 실측 근거 확보.
// 스코프: mutation 0. SELECT only. write/DDL 없음. repo=foot 유지, 확장은 center 필터 범위만.
// 인증컨텍스트: service_role (RLS bypass, 진단 완전성) — cross-CRM 진단 인증컨텍스트 표준 준수.
// PHI 위생: 산출물엔 trxid(비-PHI 거래식별자)/status/amount/count/시각만. 환자 식별정보 제외.
// ══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('missing env'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// centerForRawRow 미러 (supabase/functions/redpay-reconcile/scope-filter.ts) — 값 표준 canonical {'foot','body'}
const FOOT_MERCHANT_SET = new Set([
  '1777285001','1777285002','1777285003','1777285004','1777285005','1777285006','1777285007','1777285008',
  '1777288001','1777288003','1777288004','1777288005','1777288006','1777288008',
  '1777289001','1777289002','1777289003','1777289004','1777289005','1777289006','1777289007','1777289008',
  '1777289009','1777289010','1777289011','1777289012','1777289013',
]);
const BODY_MERCHANT_SET = new Set([
  '1777274001',
  '1777275001','1777275002','1777275003','1777275004','1777275005','1777275006','1777275007','1777275008',
  '1777276001','1777276002','1777276003','1777276004','1777276005',
]);
const merchantIdOf = (rp) => {
  const m = rp?.merchant?.id ?? rp?.data?.merchant_id ?? rp?.merchant_id;
  return m != null && `${m}`.trim() !== '' ? `${m}`.trim() : null;
};
const centerForRawRow = (r) => {
  const mid = merchantIdOf(r?.raw_payload);
  if (mid && BODY_MERCHANT_SET.has(mid)) return 'body';
  if (mid && FOOT_MERCHANT_SET.has(mid)) return 'foot';
  return 'unclassified'; // 폴백은 EF에선 'foot' 이나 감사에선 별도 표면화
};
const trxLen = (t) => (t == null ? 'null' : (String(t).startsWith('K') ? `K+${String(t).length - 1}` : `${String(t).length}`));

async function countExact(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: '0-0', Prefer: 'count=exact' } });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  return { ok: true, range: res.headers.get('content-range') };
}
async function pageAll(path) {
  const out = []; let from = 0; const PAGE = 1000;
  for (;;) {
    const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + PAGE - 1}`, Prefer: 'count=exact' } });
    if (!res.ok) { console.error('fetch fail', path, res.status, await res.text()); process.exit(1); }
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

(async () => {
  console.log('══ AC-2 커버리지 확장 — center=body (READ-ONLY, mutation 0) ══');

  // ── (0) payment_reconciliation_log 존재/center 분포 실측 (테이블명 정합 확인) ──────
  console.log('\n── (0) payment_reconciliation_log 존재·center 분포 ──');
  const prlTotal = await countExact('payment_reconciliation_log?select=id');
  console.log('  payment_reconciliation_log total content-range:', prlTotal.ok ? prlTotal.range : `ERR ${prlTotal.status} ${prlTotal.body?.slice(0,120)}`);
  if (prlTotal.ok) {
    for (const c of ['foot', 'body']) {
      const r = await countExact(`payment_reconciliation_log?select=id&center=eq.${c}`);
      console.log(`  center=${c}:`, r.ok ? r.range : `ERR ${r.status}`);
    }
    const rNull = await countExact('payment_reconciliation_log?select=id&center=is.null');
    console.log('  center IS NULL:', rNull.ok ? rNull.range : `ERR ${rNull.status}`);
  }

  // ── raw 전건 로드 → centerForRawRow 로 스코핑 ─────────────────────────────────
  const raw = await pageAll('redpay_raw_transactions?select=id,external_trxid,external_status,amount,approved_at,tid,root_trxid,matched_payment_id,raw_payload');
  const byCenter = { foot: [], body: [], unclassified: [] };
  for (const r of raw) byCenter[centerForRawRow(r)].push(r);
  console.log('\n── redpay_raw_transactions center 파생 분포 ──');
  console.log('  total raw:', raw.length, '| foot:', byCenter.foot.length, '| body:', byCenter.body.length, '| unclassified:', byCenter.unclassified.length);

  // ── (a)(b) center=body raw 지문: trxid dup / 8자형 승인·취소 공유 / composite collision ──
  for (const center of ['body', 'unclassified']) {
    const rows = byCenter[center];
    if (!rows.length) { console.log(`\n── (a)(b) center=${center}: 0행 (해당 없음) ──`); continue; }
    const byTrxid = new Map(), byLen = {}, byComposite = new Map();
    for (const r of rows) {
      const t = r.external_trxid;
      byLen[trxLen(t)] = (byLen[trxLen(t)] ?? 0) + 1;
      if (t != null) {
        const arr = byTrxid.get(t) ?? []; arr.push(r); byTrxid.set(t, arr);
        const ck = `${t}|${r.external_status}|${r.amount}`;
        const carr = byComposite.get(ck) ?? []; carr.push(r); byComposite.set(ck, carr);
      }
    }
    const trxDup = [...byTrxid.entries()].filter(([, a]) => a.length >= 2);
    const compDup = [...byComposite.entries()].filter(([, a]) => a.length >= 2);
    // 8자형 승인/취소 공유: 길이8 & status Y/N(or X/M) 혼재
    const eightShared = trxDup.filter(([t, a]) => {
      const st = new Set(a.map((r) => r.external_status));
      return String(t).length === 8 && st.has('Y') && (st.has('N') || st.has('X') || st.has('M'));
    });
    // 승인/취소 공유(길이 무관) — 8자에 국한 안 된 넓은 지문
    const anyLenShared = trxDup.filter(([, a]) => {
      const st = new Set(a.map((r) => r.external_status));
      return st.has('Y') && (st.has('N') || st.has('X') || st.has('M'));
    });
    console.log(`\n── (a)(b) center=${center} raw 지문 (n=${rows.length}) ──`);
    console.log('  trxLen 분포:', JSON.stringify(byLen));
    console.log('  trxid dup(동일trxid≥2):', trxDup.length, trxDup.length ? '→ ' + trxDup.slice(0, 12).map(([t, a]) => `${t}×${a.length}`).join(', ') : '');
    console.log('  ★8자형 승인/취소 공유 trxid:', eightShared.length,
      eightShared.length ? '→ ' + eightShared.slice(0, 8).map(([t, a]) => `${t}×${a.length}[${a.map((r) => `${r.external_status}${r.amount>=0?'+':''}${r.amount}`).join('/')}]`).join(' ; ') : '');
    console.log('  승인/취소 공유(길이무관):', anyLenShared.length,
      anyLenShared.length ? '→ ' + anyLenShared.slice(0, 8).map(([t, a]) => `len${String(t).length} ${t}×${a.length}`).join(', ') : '');
    console.log('  ★composite(trxid|status|amount) collision(≥2):', compDup.length,
      compDup.length ? '→ ' + compDup.slice(0, 8).map(([k, a]) => `${k}×${a.length}`).join(' ; ') : '(none = 3키 충분)');
    // false-merge 현행 위험: dup trxid 인데 서로 다른 matched_payment_id 로 이미 링크되었거나 한쪽만 링크된 경우
    const linkAnom = trxDup.filter(([, a]) => {
      const linked = a.filter((r) => r.matched_payment_id != null);
      const distinctPay = new Set(a.map((r) => r.matched_payment_id).filter(Boolean));
      return linked.length > 0 && (distinctPay.size > 1 || linked.length !== a.length);
    });
    console.log('  현행 false-merge/부분링크 위험(dup trxid 내 matched_payment_id 불일치·부분):', linkAnom.length,
      linkAnom.length ? '→ ' + linkAnom.slice(0, 6).map(([t]) => t).join(', ') : '(none)');
  }

  // ── (a')(b') ★핵심: 총괄 6,770 송도/8자형 census 는 raw 가 아니라 LEDGER 에 존재 ──────
  //   payment_reconciliation_log center='body' = 20,950 행 = 실 body 모집단(raw 27 아님).
  //   ledger 컬럼: external_trxid / external_amount(부호) / event_type / match_rule / payment_id.
  //   승인/취소 판정 = external_amount 부호(+승인/−취소) + event_type. status 컬럼 없음.
  if (prlTotal.ok) {
    console.log('\n── (a\')(b\') ★ payment_reconciliation_log WHERE center=body 지문 (실 body 모집단) ──');
    const led = await pageAll('payment_reconciliation_log?select=external_trxid,external_amount,event_type,match_rule,payment_id,raw_transaction_id&center=eq.body');
    console.log('  로드 ledger body 행:', led.length);
    const byLen = {}, byTrxid = new Map(), byComposite = new Map(), byEvent = {}, byRule = {};
    for (const r of led) {
      const t = r.external_trxid;
      byLen[trxLen(t)] = (byLen[trxLen(t)] ?? 0) + 1;
      byEvent[r.event_type ?? 'null'] = (byEvent[r.event_type ?? 'null'] ?? 0) + 1;
      byRule[r.match_rule ?? 'null'] = (byRule[r.match_rule ?? 'null'] ?? 0) + 1;
      if (t != null) {
        const a = byTrxid.get(t) ?? []; a.push(r); byTrxid.set(t, a);
        const sign = (r.external_amount ?? 0) >= 0 ? 'pos' : 'neg';
        const ck = `${t}|${sign}|${r.external_amount}`;
        const c = byComposite.get(ck) ?? []; c.push(r); byComposite.set(ck, c);
      }
    }
    const trxDup = [...byTrxid.entries()].filter(([, a]) => a.length >= 2);
    const compDup = [...byComposite.entries()].filter(([, a]) => a.length >= 2);
    // 8자형(0725C8257089 = 12자 prefix 형식과 별개, 순수 8자 trxid) 승인/취소 공유
    const eightShared = trxDup.filter(([t, a]) => {
      const signs = new Set(a.map((r) => (r.external_amount ?? 0) >= 0 ? 'pos' : 'neg'));
      return String(t).length === 8 && signs.has('pos') && signs.has('neg');
    });
    // 승인/취소 공유 (길이 무관) — 넓은 지문
    const anyShared = trxDup.filter(([, a]) => {
      const signs = new Set(a.map((r) => (r.external_amount ?? 0) >= 0 ? 'pos' : 'neg'));
      return signs.has('pos') && signs.has('neg');
    });
    console.log('  trxLen 분포:', JSON.stringify(byLen));
    console.log('  event_type 분포:', JSON.stringify(byEvent));
    console.log('  match_rule 분포:', JSON.stringify(byRule));
    console.log('  trxid dup(동일trxid≥2):', trxDup.length,
      trxDup.length ? '→ ' + trxDup.slice(0, 10).map(([t, a]) => `len${String(t).length} ${t}×${a.length}`).join(', ') : '');
    console.log('  ★8자형 승인/취소(±) 공유 trxid:', eightShared.length,
      eightShared.length ? '→ ' + eightShared.slice(0, 8).map(([t, a]) => `${t}×${a.length}[${a.map((r) => r.external_amount).join('/')}]`).join(' ; ') : '');
    console.log('  ★승인/취소(±) 공유 trxid(길이무관):', anyShared.length,
      anyShared.length ? '→ ' + anyShared.slice(0, 10).map(([t, a]) => `len${String(t).length} ${t}×${a.length}[${a.map((r) => r.external_amount).join('/')}]`).join(' ; ') : '');
    console.log('  ★composite(trxid|부호|amount) collision(≥2):', compDup.length,
      compDup.length ? '→ ' + compDup.slice(0, 8).map(([k, a]) => `${k}×${a.length}(rules:${[...new Set(a.map(r=>r.match_rule))].join(',')})`).join(' ; ') : '(none = composite 충분)');
    // undercount/false-merge 현행 위험: 같은 trxid dup 이 서로 다른 payment_id 로 링크(false-merge) 또는 부분링크
    const linkAnom = trxDup.filter(([, a]) => {
      const linked = a.filter((r) => r.payment_id != null);
      const distinctPay = new Set(a.map((r) => r.payment_id).filter(Boolean));
      return linked.length > 0 && (distinctPay.size > 1 || linked.length !== a.length);
    });
    console.log('  현행 false-merge/부분링크(dup trxid 내 payment_id 불일치·부분):', linkAnom.length,
      linkAnom.length ? '→ ' + linkAnom.slice(0, 8).map(([t, a]) => `${t}(pays:${[...new Set(a.map(r=>r.payment_id))].filter(Boolean).length})`).join(', ') : '(none)');
  }

  // ── (c) Plan B 직수집 활성화 노출 경로 — payments.external_trxid populated (body 스코프 근사) ──
  // payments 에 center 컬럼 없음 → external_trxid populated & unmatched 전건 카운트(활성화 시 Tier0 매칭풀 진입 후보).
  console.log('\n── (c) Plan B 직수집 노출: payments.external_trxid populated ──');
  const pNotNull = await countExact('payments?select=id&external_trxid=not.is.null');
  const pUnmatched = await countExact('payments?select=id&external_trxid=not.is.null&reconciled_at=is.null');
  console.log('  external_trxid NOT null:', pNotNull.ok ? pNotNull.range : `ERR`);
  console.log('  external_trxid NOT null ∧ reconciled_at IS null (Tier0 매칭풀 진입 RISK):', pUnmatched.ok ? pUnmatched.range : `ERR`, ' (0 이면 現 inert)');

  console.log('\n══ 완료. AC-3(하드닝)은 DA GO 후 착수 — 본 probe 는 read-only 감사 확장분. ══');
})().catch((e) => { console.error(e); process.exit(1); });
