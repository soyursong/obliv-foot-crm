/**
 * T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE — PHASE 1 DIAGNOSTIC PROBE (READ-ONLY, prod write 0)
 *
 * 목적 (AC1·AC2): class-B(coverage-gap orphan) per-row 근본원인 진단표.
 *   class-B 정의 = payment 행 有(payment_type='payment') ∩ reconciled_at IS NULL(미대사)
 *                  ∩ 결제 age 가 reconcile 매칭풀 lookback(14d)를 초과 → 사실상 영구 미reconcile.
 *   (class-A 31건 = payments 0행 무수납 = 별건 T-20260802-foot-PMW-NOPAY-CHECKIN-TRIAGE.)
 *
 * ── coverage gap 근본원인(코드 grounding) ─────────────────────────────
 *   reconcile 폴러(redpay-reconcile EF, 5분 cron)의 CRM payments 매칭풀 조회는
 *   supabase/functions/redpay-reconcile/index.ts L671~704 에서 3개 풀 모두
 *       .is('reconciled_at', null).is('external_trxid', null)
 *       .gte('created_at', since14d)              ← since14d = now - 14*24h
 *   로 술어가 고정된다. 즉 created_at 이 now-14d 보다 오래된(aged-out) 미대사 payment 는
 *   매칭풀에 영구히 진입하지 못한다 — aged-out 재시도/백필 경로 부재.
 *   → 결제가 14일 안에 매칭 안 되면(예: 웹훅 raw 지연/누락, 승인번호·TID 미입력,
 *      비-card method, external_status≠Y 등) 그 후로는 폴러가 절대 다시 집지 않음 = 영구 orphan.
 *   ★ 이 진단은 승격 술어(reconciled_at NOT NULL, FORWARDFIX)를 손대지 않는다.
 *     masking 금지: reconcile 못한 결제를 settled 광의로 승격해 증상만 지우지 않는다.
 *     목표 = "왜 14~64일이 지나도 reconcile 이 안 되는가" 를 코드/데이터로 특정.
 *
 * 산출: per-row evidence
 *   payment id / pg_provider / payment_type / method / amount / accounting_date
 *   / created_at(+KST일·경과일) / reconciled_at(null) / external_trxid·approval_no·tid null-state
 *   / check_in(status=payment_waiting?) 링크 / 폴러 배제사유(exclusion_reason) 코드 grounding.
 *
 * exclusion_reason 분류(폴러 술어 대비):
 *   - aged_out_14d      : created_at < now-14d → 매칭풀 lookback 초과(dominant, coverage gap 본체)
 *   - within14d_no_pool_key : 14d 이내지만 (method≠card) ∧ approval_no NULL ∧ tid NULL → 어떤 풀에도 미진입
 *   - within14d_awaiting_raw : 14d 이내 + 풀 진입 가능 but 웹훅 raw 未착 → 아직 정상 대기(gap 아님)
 *
 * ⛔ 절대 가드: 오직 SELECT. UPDATE/INSERT/DELETE 0. prod write 0.
 *   reconcile 상태 강제 write 우회 금지(payments read-only 계승). 정정은 Phase2 파이프 보정으로.
 *
 * 실행:  node scripts/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_phase1_probe.mjs
 *   → db-gate/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_phase1_evidence.json
 *   → db-gate/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_phase1_evidence.md
 *
 * 근거: 티켓 frontmatter risk_reason (GO_WARN)
 *       supabase/functions/redpay-reconcile/index.ts L671-704 (매칭풀 술어 SSOT)
 *       da_consult_reply_foot_pmw_reconcile_autopromote_forwardfix (LITERAL reconciled_at NOT NULL)
 *       DA REAFFIRM MSG-20260802-110350-7yit (settled 재해석 반려)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// --- env ---
function envFromLocal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  }
  return null;
}
const URL = envFromLocal('VITE_SUPABASE_URL');
const SRK = envFromLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const DAY_MS = 24 * 3600 * 1000;
const KST_MS = 9 * 3600 * 1000;
const LOOKBACK_DAYS = 14; // redpay-reconcile index.ts since14d
function kstDate(ts) { return ts ? new Date(new Date(ts).getTime() + KST_MS).toISOString().slice(0, 10) : null; }
function ageDays(ts, nowMs) { return ts ? Math.floor((nowMs - new Date(ts).getTime()) / DAY_MS) : null; }
const log = (...a) => console.log(...a);

async function tableColumns(table) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return { error: error.message, cols: null };
  return { error: null, cols: data && data[0] ? Object.keys(data[0]) : [] };
}

async function main() {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const since14d = new Date(nowMs - LOOKBACK_DAYS * DAY_MS).toISOString();
  log(`\n=== RECONCILE-COVERAGEGAP-ROOTCAUSE PHASE1 PROBE (READ-ONLY, write 0) ===`);
  log(`  now=${now}  since14d(cutoff)=${since14d}`);

  const payCols = await tableColumns('payments');
  if (payCols.error) { console.error('❌ payments introspection:', payCols.error); process.exit(1); }
  const cols = payCols.cols ?? [];
  const HAS = (c) => cols.includes(c);
  const PROVIDER_COL = ['pg_provider', 'provider', 'payment_provider'].find(HAS) ?? null;
  log(`  payments cols(${cols.length}) provider-col=${PROVIDER_COL ?? '(none)'}`);

  // ── [1] orphan 전수: payment_type='payment' ∩ reconciled_at IS NULL ──
  //   (매출성 결제 중 미대사. 폴러가 왜 이들을 못 집는가를 per-row 규명.)
  const sel = ['id', 'clinic_id', 'amount', 'method', 'payment_type', 'created_at',
    'external_trxid', 'external_approval_no', 'external_tid', 'reconciled_at',
    HAS('accounting_date') ? 'accounting_date' : null,
    HAS('check_in_id') ? 'check_in_id' : null,
    HAS('customer_id') ? 'customer_id' : null,
    HAS('status') ? 'status' : null,
    PROVIDER_COL,
  ].filter(Boolean).join(',');

  const { data: orphans, error: oErr } = await db
    .from('payments')
    .select(sel)
    .eq('payment_type', 'payment')
    .is('reconciled_at', null)
    .order('created_at', { ascending: true });
  if (oErr) { console.error('❌ orphan query:', oErr.message); process.exit(1); }
  log(`  미대사 payment(payment_type='payment' ∩ reconciled_at NULL) 총: ${orphans.length}`);

  // ── [2] check_in status 링크(payment_waiting 여부 = class-B stuck tail) ──
  const ciIds = [...new Set(orphans.map((p) => p.check_in_id).filter(Boolean))];
  const ciStatus = new Map();
  for (let i = 0; i < ciIds.length; i += 100) {
    const chunk = ciIds.slice(i, i + 100);
    // §4.3 UUID-PK-only: customer_name/phone(PHI) 미조회 — status·visit_type(비-PHI)만.
    const { data: cis } = await db.from('check_ins').select('id,status,checked_in_at,visit_type').in('id', chunk);
    for (const ci of cis ?? []) ciStatus.set(ci.id, ci);
  }

  // ── [3] per-row 폴러 배제사유 규명 ──
  function exclusionReason(p) {
    const aged = new Date(p.created_at).getTime() < new Date(since14d).getTime();
    if (aged) return 'aged_out_14d'; // dominant: 매칭풀 lookback 초과 → 영구 orphan
    const cardPool = p.method === 'card'; // pool1 진입키
    const approvalPool = p.external_approval_no != null; // pool2 진입키(Tier0)
    const tidPool = p.external_tid != null; // pool3 진입키(Tier0)
    if (!cardPool && !approvalPool && !tidPool) return 'within14d_no_pool_key';
    return 'within14d_awaiting_raw'; // 정상 대기(웹훅 raw 착탄 전) — gap 아님
  }

  const rows = orphans.map((p) => {
    const ci = p.check_in_id ? ciStatus.get(p.check_in_id) : null;
    return {
      payment_id: p.id,
      pg_provider: PROVIDER_COL ? p[PROVIDER_COL] : '(no-col)',
      payment_type: p.payment_type,
      method: p.method,
      amount: p.amount,
      accounting_date: p.accounting_date ?? null,
      created_at: p.created_at,
      created_kst: kstDate(p.created_at),
      created_age_days: ageDays(p.created_at, nowMs),
      reconciled_at: p.reconciled_at,
      external_trxid: p.external_trxid ?? null,
      external_approval_no: p.external_approval_no ?? null,
      external_tid: p.external_tid ?? null,
      check_in_id: p.check_in_id ?? null,
      check_in_status: ci?.status ?? null,
      visit_type: ci?.visit_type ?? null,
      is_payment_waiting_stuck: ci?.status === 'payment_waiting',
      exclusion_reason: exclusionReason(p),
      permanent_orphan: ageDays(p.created_at, nowMs) > LOOKBACK_DAYS, // >14d = 폴러 재진입 불가
    };
  });

  // ── [4] class-B (payment_waiting stuck ∩ aged_out) 서브셋 = 본 트랙 대상 ──
  const classB = rows.filter((r) => r.is_payment_waiting_stuck && r.permanent_orphan);
  const agedAll = rows.filter((r) => r.permanent_orphan);

  const byReason = rows.reduce((m, r) => { m[r.exclusion_reason] = (m[r.exclusion_reason] || 0) + 1; return m; }, {});

  const out = {
    ticket: 'T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE',
    phase: 'phase1-rootcause-diagnosis-readonly',
    generated_at: now,
    write_count: 0,
    poller_predicate_ssot: 'supabase/functions/redpay-reconcile/index.ts L671-704',
    lookback_days: LOOKBACK_DAYS,
    since14d_cutoff: since14d,
    coverage_gap_1liner:
      "reconcile 매칭풀이 created_at >= now-14d 만 조회 → 14일 내 미매칭 결제는 aged-out 후 매칭풀 영구 이탈(재시도/백필 경로 부재) = 영구 미reconcile.",
    masking_guard:
      "승격 술어(reconciled_at NOT NULL) 무접점. settled 광의 재해석으로 masking 금지(DA REAFFIRM 7yit 계승). 목표=파이프가 reconcile 하게.",
    definitions: {
      orphan: "payment_type='payment' ∩ reconciled_at IS NULL",
      class_B: "orphan ∩ 링크 check_in.status='payment_waiting' ∩ created_age > 14d(permanent)",
      exclusion_reason: {
        aged_out_14d: 'created_at < now-14d → 매칭풀 lookback 초과(coverage gap 본체)',
        within14d_no_pool_key: '14d 이내지만 method≠card ∧ approval_no NULL ∧ tid NULL → 어떤 풀에도 미진입',
        within14d_awaiting_raw: '14d 이내 + 풀 진입 가능, 웹훅 raw 대기(정상)',
      },
    },
    counts: {
      orphan_total: rows.length,
      permanent_orphan_aged: agedAll.length,
      class_B_payment_waiting_stuck: classB.length,
      by_exclusion_reason: byReason,
    },
    class_B_rows: classB,
    permanent_orphan_rows: agedAll,
    // all_orphan_rows(178 within-14d 포함) per-row dump 은 미포함 —
    //   within-14d 는 정상대기/미aged(진단상 비필수), 집계는 counts.by_exclusion_reason 로 보존.
    //   (UUID hex tail 이 phone 정규식과 우연 충돌하는 PHI-scan false-positive 회피 겸 focus 축소)
    note_all_orphan: `within-14d orphan ${rows.length - agedAll.length}건은 per-row 미덤프(집계만). aged/class-B 만 per-row 보존.`,
  };

  fs.mkdirSync('db-gate', { recursive: true });
  const base = 'db-gate/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_phase1_evidence';
  fs.writeFileSync(`${base}.json`, JSON.stringify(out, null, 2));

  // ── md 표 ──
  const md = [];
  md.push(`# RECONCILE coverage-gap orphan — Phase1 근본원인 진단 (READ-ONLY, write 0)`);
  md.push('');
  md.push(`- generated: ${now}`);
  md.push(`- 폴러 술어 SSOT: \`${out.poller_predicate_ssot}\``);
  md.push(`- lookback: ${LOOKBACK_DAYS}d (cutoff ${since14d})`);
  md.push('');
  md.push(`## coverage gap 원인 (1줄)`);
  md.push(`> ${out.coverage_gap_1liner}`);
  md.push('');
  md.push(`## 카운트`);
  md.push(`- orphan(미대사 payment) 총: **${rows.length}**`);
  md.push(`- 영구 orphan(age>14d): **${agedAll.length}**`);
  md.push(`- class-B(payment_waiting stuck ∩ 영구): **${classB.length}**`);
  md.push(`- 배제사유별: ${JSON.stringify(byReason)}`);
  md.push('');
  md.push(`## class-B per-row (payment_waiting stuck ∩ 영구 orphan)`);
  md.push('');
  md.push(`| payment_id | provider | method | amount | acct_date | created(KST) | age(d) | trxid/appr/tid | ci.status | 배제사유 |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of classB) {
    const keys = `${r.external_trxid ? 'T' : '-'}/${r.external_approval_no ? 'A' : '-'}/${r.external_tid ? 'D' : '-'}`;
    md.push(`| ${r.payment_id} | ${r.pg_provider} | ${r.method} | ${r.amount} | ${r.accounting_date ?? '-'} | ${r.created_kst} | ${r.created_age_days} | ${keys} | ${r.check_in_status} | ${r.exclusion_reason} |`);
  }
  md.push('');
  md.push(`## 영구 orphan 전수 (aged>14d, class-B 외 포함)`);
  md.push(`| payment_id | provider | method | amount | created(KST) | age(d) | ci.status | 배제사유 |`);
  md.push(`|---|---|---|---|---|---|---|---|`);
  for (const r of agedAll) {
    md.push(`| ${r.payment_id} | ${r.pg_provider} | ${r.method} | ${r.amount} | ${r.created_kst} | ${r.created_age_days} | ${r.check_in_status ?? '-'} | ${r.exclusion_reason} |`);
  }
  md.push('');
  md.push(`> ⛔ write 0. 정정은 Phase2 파이프 보정(supervisor gate). 승격 술어 무접점(masking 0).`);
  fs.writeFileSync(`${base}.md`, md.join('\n'));

  log(`\n  ✅ evidence:`);
  log(`     ${base}.json`);
  log(`     ${base}.md`);
  log(`  counts: orphan=${rows.length} aged=${agedAll.length} classB=${classB.length} byReason=${JSON.stringify(byReason)}`);
  log(`  write_count=0 (READ-ONLY)`);
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
