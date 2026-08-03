/**
 * T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP — 백스톱 인프라 불변식 락 (unit)
 *
 * 성격: 백엔드 폴러 launchd 스케줄 백스톱(EF/인프라). CRM 화면 무변경(e2e_spec_exempt: ef_only).
 *   → 브라우저/auth/server 불요, 순수 정적-소스 가드로 인프라 회귀를 상시 차단한다.
 *
 * 잠그는 불변식:
 *   ① 신규 daily_full plist 실재 + POLL_MODE=daily_full env override (AC-1).
 *   ② WorkingDirectory = 폴러 전용 checkout(DEDICATED-CHECKOUT) + self-heal FF (AC-4, stale hazard 회귀 차단).
 *   ③ 저빈도 스케줄(StartCalendarInterval) + RunAtLoad=false + KeepAlive 미설정 (AC-3 부하 안전).
 *   ④ 증분 폴러 upsert 멱등키 = external_trxid,external_status,amount + merge-duplicates (AC-1/AC-3 이중INSERT 0).
 *   ⑤ redpay_raw_transactions UNIQUE(external_trxid,external_status,amount) 제약 소스 실재 (구조 증명).
 *   ⑥ daily_full 은 last_daily_to 만 갱신(증분 heartbeat last_incremental_to 비-clobber).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ESM 스코프(__dirname 없음). playwright 는 repo 루트(config 위치)에서 구동 → cwd = repo 루트.
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const DAILYFULL_PLIST = 'scripts/launchd/com.obliv.foot.redpay-macstudio-poller-dailyfull.plist';
const INCR_PLIST = 'scripts/launchd/com.obliv.foot.redpay-macstudio-poller.plist';
const POLLER = 'scripts/redpay_macstudio_poller.mjs';
const RAW_MIG = 'supabase/migrations/20260607190000_pay_recon_port.sql';
const DEDICATED_CHECKOUT = '/Users/domas/GitHub/obliv-foot-crm-redpay-poller';

test.describe('REDPAY daily_full 재스윕 백스톱 — 인프라 불변식', () => {
  test('① 신규 plist 실재 + POLL_MODE=daily_full override (AC-1)', () => {
    const p = read(DAILYFULL_PLIST);
    expect(p).toContain('<string>com.obliv.foot.redpay-macstudio-poller-dailyfull</string>');
    // EnvironmentVariables 로 daily_full 강제
    expect(p).toMatch(/<key>REDPAY_POLL_MODE<\/key>\s*<string>daily_full<\/string>/);
    // 동일 폴러 스크립트 재사용(코드 무분기)
    expect(p).toContain('node scripts/redpay_macstudio_poller.mjs');
  });

  test('② WorkingDirectory=전용 checkout + self-heal FF (AC-4, stale hazard 차단)', () => {
    const p = read(DAILYFULL_PLIST);
    expect(p).toContain(`<key>WorkingDirectory</key>\n    <string>${DEDICATED_CHECKOUT}</string>`);
    // 매 실행 origin/main self-heal — dev 피처 브랜치 stale 불가
    expect(p).toContain('git fetch origin main');
    expect(p).toContain('git reset --hard --quiet origin/main');
    // dev 피처 체크아웃 경로를 WorkingDirectory 로 쓰면 안 됨(정확 stale 회귀 차단)
    expect(p).not.toMatch(/<key>WorkingDirectory<\/key>\s*<string>\/Users\/domas\/GitHub\/obliv-foot-crm<\/string>/);
  });

  test('③ 저빈도 스케줄 + RunAtLoad=false + KeepAlive 미설정 (AC-3 부하 안전)', () => {
    const p = read(DAILYFULL_PLIST);
    // 스케줄 시각 지정(StartCalendarInterval) — 상시 StartInterval 폭주 아님
    expect(p).toContain('<key>StartCalendarInterval</key>');
    expect(p).not.toContain('<key>StartInterval</key>');
    // 등록 즉시 전수조회로 API 안 침 + 크래시 재기동 루프 없음
    expect(p).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
    expect(p).not.toContain('<key>KeepAlive</key>');
    // 전용 로그 분리(silent-miss 표면화 경로)
    expect(p).toContain('redpay_macstudio_poller_dailyfull.out');
    expect(p).toContain('redpay_macstudio_poller_dailyfull.err');
  });

  test('④ 폴러 upsert 멱등키 = on_conflict 3튜플 + merge-duplicates (이중 INSERT 0)', () => {
    const src = read(POLLER);
    expect(src).toContain('on_conflict=external_trxid,external_status,amount');
    expect(src).toContain('resolution=merge-duplicates');
  });

  test('⑤ redpay_raw_transactions UNIQUE 제약 소스 실재 (구조 증명)', () => {
    const mig = read(RAW_MIG);
    expect(mig).toMatch(/CONSTRAINT\s+redpay_raw_trx_unique\s+UNIQUE\s*\(\s*external_trxid\s*,\s*external_status\s*,\s*amount\s*\)/);
  });

  test('⑥ daily_full 은 last_daily_to 만 갱신 — 증분 heartbeat 비-clobber', () => {
    const src = read(POLLER);
    // incremental 분기에서만 last_incremental_to 세팅, else 는 last_daily_to
    expect(src).toMatch(/mode === "incremental"[\s\S]{0,200}last_incremental_to = nowIso/);
    expect(src).toMatch(/else\s*\{[\s\S]{0,120}row\.last_daily_to = nowIso/);
  });

  test('⑦ 증분 plist 는 불변(백스톱은 추가만) — daily_full override 없음', () => {
    const incr = read(INCR_PLIST);
    // 증분 인스턴스는 daily_full 을 강제하지 않아야 함(1차 증분 동작 유지)
    expect(incr).not.toMatch(/<key>REDPAY_POLL_MODE<\/key>\s*<string>daily_full<\/string>/);
    expect(incr).toContain('<key>StartInterval</key><integer>300</integer>');
  });
});
