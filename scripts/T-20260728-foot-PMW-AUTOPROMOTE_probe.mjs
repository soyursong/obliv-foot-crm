/**
 * T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX — PROBE (READ-ONLY, prod write 0)
 *
 * 목적: 자동승격 배치(promote_reconciled_payment_waiting)가 "지금 실행되면" 승격할 대상셋 +
 *   행별 business일 앵커(completed_at 예정값)를 무write 투영 → supervisor DB-gate evidence.
 *
 * 술어(migration 함수와 동형): status='payment_waiting' ∩ checkin일<today(KST) ∩
 *   reconciled payment 보유(reconciled_at NOT NULL ∩ payment_type='payment' ∩ amount>0).
 * 앵커: reconciled payment 의 MAX(accounting_date), NULL 폴백 = created_at(KST)일. never now().
 *
 * 실행:  node scripts/T-20260728-foot-PMW-AUTOPROMOTE_probe.mjs
 *   → db-gate/T-20260728-foot-PMW-AUTOPROMOTE_probe_evidence.json 기록.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

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
if (!URL || !SRK) { console.error('❌ missing URL/SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const KST = 'Asia/Seoul';
const todayKST = new Date(new Date().toLocaleString('en-US', { timeZone: KST }));
const todayStr = `${todayKST.getFullYear()}-${String(todayKST.getMonth() + 1).padStart(2, '0')}-${String(todayKST.getDate()).padStart(2, '0')}`;

function kstDate(iso) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: KST }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  console.log(`\n=== PMW-AUTOPROMOTE PROBE (READ-ONLY) — today(KST)=${todayStr} ===`);

  // payment_waiting 전량 → JS 에서 forward-only + reconciled 술어 적용(무write).
  const { data: cis, error } = await db
    .from('check_ins')
    .select('id,clinic_id,status,checked_in_at,completed_at')
    .eq('status', 'payment_waiting');
  if (error) { console.error('❌ check_ins 조회 실패:', error.message); process.exit(1); }

  const targets = [];
  let liveExcluded = 0, noReconciled = 0;
  for (const ci of cis) {
    if (kstDate(ci.checked_in_at) >= todayStr) { liveExcluded++; continue; }   // forward-only

    const { data: pays, error: pErr } = await db
      .from('payments')
      .select('accounting_date,created_at,reconciled_at,payment_type,amount')
      .eq('check_in_id', ci.id);
    if (pErr) { console.error('❌ payments 조회 실패:', pErr.message); process.exit(1); }

    const reconciled = (pays || []).filter(
      (p) => p.reconciled_at !== null && p.payment_type === 'payment' && p.amount > 0,
    );
    if (reconciled.length === 0) { noReconciled++; continue; }

    // 앵커 = MAX(accounting_date ?? created_at KST일)
    const anchorDate = reconciled
      .map((p) => p.accounting_date ?? kstDate(p.created_at))
      .sort()
      .pop();
    targets.push({
      check_in_id: ci.id,
      clinic_id: ci.clinic_id,
      checkin_date_kst: kstDate(ci.checked_in_at),
      completed_at_projected: `${anchorDate}T00:00:00+09:00`,  // 회계귀속일 자정 KST
      reconciled_payments: reconciled.length,
    });
  }

  console.log(`  payment_waiting 총: ${cis.length}`);
  console.log(`  당일 live 제외(forward-only): ${liveExcluded}`);
  console.log(`  reconciled payment 없음(정체 정당): ${noReconciled}`);
  console.log(`  ▶ 승격 대상(reconciled ∩ <today): ${targets.length}`);
  for (const t of targets) {
    console.log(`     ${t.check_in_id.slice(0, 8)}  checkin=${t.checkin_date_kst}  → completed_at=${t.completed_at_projected}`);
  }

  const evidence = {
    mode: 'probe-readonly',
    ticket: 'T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX',
    da_reply: 'MSG-20260802-100839-h7jo',
    generated_at: new Date().toISOString(),
    today_kst: todayStr,
    payment_waiting_total: cis.length,
    live_excluded_forward_only: liveExcluded,
    no_reconciled_legit_stuck: noReconciled,
    promotion_targets: targets.length,
    targets,
    invariants: {
      write_once: 'Step A WHERE status=payment_waiting',
      anchor_business_date_never_now: 'MAX(accounting_date ?? created_at KST)',
      payment_read_only: true,
      forward_only: 'checkin KST date < today',
      two_step_trigger_unchanged: true,
    },
  };
  fs.mkdirSync('db-gate', { recursive: true });
  fs.writeFileSync('db-gate/T-20260728-foot-PMW-AUTOPROMOTE_probe_evidence.json', JSON.stringify(evidence, null, 2));
  console.log('\n📄 probe evidence → db-gate/T-20260728-foot-PMW-AUTOPROMOTE_probe_evidence.json');
  console.log('   (write 0 — supervisor DB-gate 후 migration apply → cron 자동 배치)');
}

main().catch((e) => { console.error(e); process.exit(1); });
