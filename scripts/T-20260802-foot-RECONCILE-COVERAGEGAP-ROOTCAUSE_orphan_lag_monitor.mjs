/**
 * T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE — 관측성 모니터 (READ-ONLY, write 0) — AC4
 *
 * 목적: reconcile lag > N일 초과 orphan 건수를 age 버킷별로 산출 → 재발 조기탐지 지표.
 *   FORWARDFIX GO조건6(관측성)과 정합. 경보 임계 = lag > 14d(매칭풀 lookback) orphan 건수.
 *
 * 지표:
 *   orphan = payment_type='payment' ∩ reconciled_at IS NULL
 *   age 버킷: 0-7d / 8-14d(정상 대기창) / 15-30d / 31-60d / 60d+ (aged-out = 영구 orphan)
 *   method 분해: card(B1 후보) vs non-card(cash/transfer, B2 구조적 미대사)
 *   ALARM: aged-out(>14d) orphan 건수. 임계 초과 시 exit code 1(경보 wiring 훅용).
 *
 * ⛔ 오직 SELECT. write 0. 경보 발송(cron/Slack post)은 write-path → supervisor gate 후.
 * 실행: node scripts/T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE_orphan_lag_monitor.mjs [alarm_threshold]
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function env(key) {
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
const URL = env('VITE_SUPABASE_URL'), SRK = env('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !SRK) { console.error('❌ missing supabase creds'); process.exit(2); }
const db = createClient(URL, SRK, { auth: { persistSession: false } });

const DAY_MS = 86400000;
const LOOKBACK_DAYS = 14; // redpay-reconcile since14d = 경보 임계
const ALARM_THRESHOLD = Number(process.argv[2] ?? 0); // aged-out 건수 임계(초과 시 exit 1)

function bucket(age) {
  if (age <= 7) return '0-7d';
  if (age <= 14) return '8-14d';
  if (age <= 30) return '15-30d';
  if (age <= 60) return '31-60d';
  return '60d+';
}

async function main() {
  const nowMs = Date.now();
  const { data, error } = await db
    .from('payments')
    .select('id,method,amount,created_at,reconciled_at')
    .eq('payment_type', 'payment')
    .is('reconciled_at', null);
  if (error) { console.error('❌ query:', error.message); process.exit(2); }

  const buckets = {};
  let agedOut = 0, agedCard = 0, agedNonCard = 0;
  for (const p of data) {
    const age = Math.floor((nowMs - new Date(p.created_at).getTime()) / DAY_MS);
    const b = bucket(age);
    buckets[b] = buckets[b] || { total: 0, card: 0, non_card: 0 };
    buckets[b].total++;
    const isCard = p.method === 'card';
    if (isCard) buckets[b].card++; else buckets[b].non_card++;
    if (age > LOOKBACK_DAYS) { agedOut++; isCard ? agedCard++ : agedNonCard++; }
  }

  const report = {
    ticket: 'T-20260802-foot-RECONCILE-COVERAGEGAP-ROOTCAUSE',
    metric: 'reconcile-orphan-lag',
    generated_at: new Date(nowMs).toISOString(),
    lookback_days: LOOKBACK_DAYS,
    orphan_total: data.length,
    by_age_bucket: buckets,
    aged_out_gt14d: { total: agedOut, card_B1: agedCard, non_card_B2: agedNonCard },
    alarm_threshold: ALARM_THRESHOLD,
    alarm_triggered: agedOut > ALARM_THRESHOLD,
    write_count: 0,
  };
  console.log(JSON.stringify(report, null, 2));
  console.error(
    `[orphan-lag] total=${data.length} aged>14d=${agedOut} (card_B1=${agedCard} non_card_B2=${agedNonCard})` +
    (report.alarm_triggered ? `  🚨 ALARM(> ${ALARM_THRESHOLD})` : '')
  );
  process.exit(report.alarm_triggered ? 1 : 0);
}
main().catch((e) => { console.error('❌', e); process.exit(2); });
