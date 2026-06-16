/**
 * T-20260616-foot-E2E-PROD-WRITE-ISOLATION (P1) — RC#0 재발방지
 *
 * 배경(RC#0): E2E 가 dev=prod 단일 Supabase 에 service_role 로 직접 write 한다. 개별 spec 은
 *   try/finally·afterAll 로 cleanup 하지만 테스트가 timeout/crash/abort 로 죽으면 그 hook 이
 *   실행되지 않아 [QA-FIXTURE] row(특히 customers)가 PROD 에 잔존했다.
 *   특히 seedCheckIn 이 customer INSERT 후 check_in INSERT 전 중단되면 check_ins 경유 cleanup
 *   으로는 안 잡히는 orphan customer 가 누적됐다.
 *
 * 차단(AC c): cleanupAll() 을 customer 마커/이름접두 직접 스윕으로 강화 + globalSetup/Teardown
 *   안전망(성공/실패 무관 전수 스윕)을 도입했다.
 *
 * 이 스펙은 page/auth 불필요 — service_role 로 DB 를 직접 검증하므로 `unit` 프로젝트로 실행.
 *
 * 검증:
 *  AC-1 orphan customer(memo=MARKER, check_in 없음) → cleanupAll 이 삭제(잔존 0)
 *  AC-2 정상 시드(customer+check_in+package) → 개별 cleanup 미호출(=실패 모사)이어도 cleanupAll 이 전수 삭제
 *  AC-3 마커 누락 + 이름접두(qa-fixture-*) customer → 이름접두 2차 키로 삭제
 *  AC-4 안전 불변식: 비-픽스처(마커X·접두X) customer 는 cleanupAll 후 보존
 *  AC-5 인프라 배선: globalSetup/Teardown 파일 존재 + config 배선 + cleanupAll import
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanupAll, CLINIC_ID, MARKER } from '../fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

test.describe('T-20260616-foot-E2E-PROD-WRITE-ISOLATION — RC#0 픽스처 누적 차단', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    // 본 스펙이 만든 잔여까지 최종 청소
    if (dbReady) await cleanupAll();
  });

  test('AC-1: orphan customer(memo=MARKER, check_in 없음)를 cleanupAll 이 삭제한다', async () => {
    const ts = Date.now();
    // seedCheckIn 의 "customer INSERT 후 crash" 상황을 직접 모사 — check_in 없이 customer 만 생성
    const { data, error } = await sb!
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-fixture-orphan-${ts}`, phone: `010${String(ts).slice(-8)}`, visit_type: 'new', memo: MARKER })
      .select('id')
      .single();
    expect(error, '시드 INSERT 실패').toBeNull();
    const orphanId = data!.id as string;

    // 사전: 존재
    const { data: before } = await sb!.from('customers').select('id').eq('id', orphanId);
    expect(before?.length, '시드 직후 orphan customer 존재해야').toBe(1);

    // 스윕
    await cleanupAll();

    // 사후: 0건
    const { data: after } = await sb!.from('customers').select('id').eq('id', orphanId);
    expect(after?.length ?? 0, 'cleanupAll 후 orphan customer 잔존 0이어야 (RC#0 차단)').toBe(0);
  });

  test('AC-2: 정상 시드(customer+check_in+package) — 개별 cleanup 미호출이어도 cleanupAll 전수 삭제', async () => {
    const ts = Date.now();
    const phone = `010${String(ts + 1).slice(-8)}`;
    const name = `qa-fixture-full-${ts}`;
    const { data: c } = await sb!
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'new', memo: MARKER })
      .select('id')
      .single();
    const customerId = c!.id as string;
    const { data: ck } = await sb!
      .from('check_ins')
      .insert({ clinic_id: CLINIC_ID, customer_id: customerId, customer_name: name, customer_phone: phone, visit_type: 'new', status: 'registered', queue_number: 900000 + Math.floor(Math.random() * 100000), checked_in_at: new Date().toISOString(), notes: MARKER })
      .select('id')
      .single();
    const checkInId = ck!.id as string;
    const { data: pkg } = await sb!
      .from('packages')
      .insert({ clinic_id: CLINIC_ID, customer_id: customerId, package_name: '패키지1 (12회)', package_type: 'preset_12', total_sessions: 12, total_amount: 3600000, paid_amount: 3600000, status: 'active' })
      .select('id')
      .single();
    const packageId = pkg!.id as string;

    // 개별 cleanup() 을 일부러 호출하지 않음 = 테스트 실패/crash 모사
    await cleanupAll();

    const { data: cAfter } = await sb!.from('customers').select('id').eq('id', customerId);
    const { data: ckAfter } = await sb!.from('check_ins').select('id').eq('id', checkInId);
    const { data: pkgAfter } = await sb!.from('packages').select('id').eq('id', packageId);
    expect(cAfter?.length ?? 0, 'customer 잔존 0').toBe(0);
    expect(ckAfter?.length ?? 0, 'check_in 잔존 0').toBe(0);
    expect(pkgAfter?.length ?? 0, 'package 잔존 0').toBe(0);
  });

  test('AC-3: 마커 누락 + 이름접두(qa-fixture-*) customer 도 이름접두 2차 키로 삭제', async () => {
    const ts = Date.now();
    // memo 마커 없이(=마커 누락 회귀 모사) 이름만 픽스처 접두
    const { data } = await sb!
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-fixture-nomark-${ts}`, phone: `010${String(ts + 2).slice(-8)}`, visit_type: 'new' })
      .select('id')
      .single();
    const id = data!.id as string;

    await cleanupAll();

    const { data: after } = await sb!.from('customers').select('id').eq('id', id);
    expect(after?.length ?? 0, '이름접두 픽스처 customer 잔존 0').toBe(0);
  });

  test('AC-4: 안전 불변식 — 비-픽스처(마커X·접두X) customer 는 cleanupAll 후 보존', async () => {
    const ts = Date.now();
    // 실데이터 모사: QA 마커도, qa- 접두도 없는 이름
    const realName = `정상고객보존${ts}`;
    const { data } = await sb!
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: realName, phone: `010${String(ts + 3).slice(-8)}`, visit_type: 'new', memo: '실데이터-비픽스처' })
      .select('id')
      .single();
    const id = data!.id as string;
    try {
      await cleanupAll();
      const { data: after } = await sb!.from('customers').select('id').eq('id', id);
      expect(after?.length ?? 0, '비-픽스처 실데이터는 cleanupAll 이 절대 삭제하면 안 됨').toBe(1);
    } finally {
      // 본 테스트가 만든 모사 row 직접 정리 (cleanupAll 대상이 아니므로)
      await sb!.from('customers').delete().eq('id', id);
    }
  });

  test('AC-5: 인프라 배선 — globalSetup/Teardown 파일 + config 배선 + cleanupAll import', () => {
    const setupPath = path.join(__dirname, '..', 'global-setup.ts');
    const teardownPath = path.join(__dirname, '..', 'global-teardown.ts');
    expect(fs.existsSync(setupPath), 'global-setup.ts 존재').toBe(true);
    expect(fs.existsSync(teardownPath), 'global-teardown.ts 존재').toBe(true);

    const teardownSrc = fs.readFileSync(teardownPath, 'utf-8');
    expect(teardownSrc).toContain('cleanupAll');

    const configSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'playwright.config.ts'), 'utf-8');
    expect(configSrc, 'config 에 globalSetup 배선').toContain('globalSetup');
    expect(configSrc, 'config 에 globalTeardown 배선').toContain('globalTeardown');
  });
});
