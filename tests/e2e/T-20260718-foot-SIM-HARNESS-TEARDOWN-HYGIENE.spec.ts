/**
 * T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE (P2) — 시뮬/CI 하네스 위생 회귀 가드
 *
 * 배경(포렌식 MSG-20260718-115738-srlx): PROD customers 비-E.164 오염 4건의 근인 =
 *   내부 test/sim/CI 하네스(service_role node, POST customers 10 / DELETE 6 = 4 잔재).
 *   (1) teardown 불완전(마커/이름을 test 가 덮어쓰면 스윕 누락) (2) is_simulation 미세팅
 *   (3) 비-E.164 raw phone 저장. 본 스펙은 fixtures 하네스 위생 3축을 DB 직접 검증한다.
 *
 * page/auth 불필요 — service_role 로 DB 를 직접 검증(unit 프로젝트, page/auth 불요).
 *
 * 검증:
 *  AC-3 registry teardown: seedCheckIn/Package/Reservation 후 개별 cleanup 미호출(=crash 모사)
 *        이어도 cleanupAll 이 전수 삭제(POST=DELETE, 잔존 0).
 *  AC-3 마커 덮어쓰기 내성: memo/notes 마커를 지우고 이름접두도 없는 row 도 레지스트리 정확 id 로 삭제.
 *  AC-2 is_simulation opt-in: {simulation:true} → customers.is_simulation=true, 기본 → false.
 *  AC-5 E.164 seed: seedCheckIn phone 이 +8210XXXXXXXX (Step1 DB CHECK 무파손).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupAll, seedCheckIn, seedPackage, seedReservation } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

test.describe('T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE — 하네스 위생', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    if (dbReady) await cleanupAll();
  });

  // ⚠ AC-5/AC-2 계약 개정: T-20260721-foot-E2E-FIXTURE-SELFID 가 seedCheckIn 자기식별을
  //   재정의(phone DUMMY-% + is_simulation 기본 true). 구 계약(E.164 + 기본 false)은 폐기됨.
  test('AC-5(개정): seedCheckIn phone 이 DUMMY-% (자기식별 + phone_dummy 파생)', async () => {
    const h = await seedCheckIn({ visit_type: 'new' });
    try {
      expect(h.phone, 'seed phone 은 DUMMY-% (SELFID)').toMatch(/^DUMMY-/);
      // 실제 저장값 phone + phone_dummy 트리거 파생 확인
      const { data } = await sb!
        .from('customers')
        .select('phone, phone_dummy')
        .eq('id', h.customerId)
        .single();
      expect(data?.phone as string).toMatch(/^DUMMY-/);
      expect((data as { phone_dummy?: boolean } | null)?.phone_dummy, 'phone_dummy=true(트리거 파생)').toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test('AC-2(개정): is_simulation 기본 true(SELFID), opt-out(false) 도 존중', async () => {
    const defH = await seedCheckIn({ visit_type: 'new' });
    const optOutH = await seedCheckIn({ visit_type: 'new', simulation: false });
    try {
      const { data: def } = await sb!.from('customers').select('is_simulation').eq('id', defH.customerId).single();
      const { data: optOut } = await sb!.from('customers').select('is_simulation').eq('id', optOutH.customerId).single();
      expect(def?.is_simulation, '기본 → is_simulation=true(비실환자 단일 술어)').toBe(true);
      expect(optOut?.is_simulation ?? false, 'simulation:false → false(opt-out 존중)').toBe(false);
    } finally {
      await defH.cleanup();
      await optOutH.cleanup();
    }
  });

  test('AC-3: 개별 cleanup 미호출(crash 모사)이어도 cleanupAll 전수 삭제(POST=DELETE)', async () => {
    const h = await seedCheckIn({ visit_type: 'returning' });
    const pkg = await seedPackage({ customerId: h.customerId });
    const res = await seedReservation({});
    // 개별 cleanup() 을 일부러 호출하지 않음 = timeout/crash 모사

    await cleanupAll();

    const { data: cAfter } = await sb!.from('customers').select('id').eq('id', h.customerId);
    const { data: ckAfter } = await sb!.from('check_ins').select('id').eq('id', h.id);
    const { data: pkgAfter } = await sb!.from('packages').select('id').eq('id', pkg.id);
    const { data: resAfter } = await sb!.from('reservations').select('id').eq('id', res.id);
    expect(cAfter?.length ?? 0, 'customer 잔존 0').toBe(0);
    expect(ckAfter?.length ?? 0, 'check_in 잔존 0').toBe(0);
    expect(pkgAfter?.length ?? 0, 'package 잔존 0').toBe(0);
    expect(resAfter?.length ?? 0, 'reservation 잔존 0').toBe(0);
  });

  test('AC-3: 마커 덮어쓰기 내성 — memo/notes·이름접두 소실돼도 레지스트리 id 로 삭제', async () => {
    // 커스텀 이름(qa- 접두 없음) + 시드 후 memo/notes 마커를 강제 제거 = "마커 스윕 사각" 재현.
    const h = await seedCheckIn({ visit_type: 'new', name: `custommark-${Date.now()}` });
    await sb!.from('customers').update({ memo: null }).eq('id', h.customerId);
    await sb!.from('check_ins').update({ notes: null }).eq('id', h.id);

    // 마커 스윕으로는 못 잡지만, 레지스트리(정확 id)로 잡아야 한다.
    await cleanupAll();

    const { data: cAfter } = await sb!.from('customers').select('id').eq('id', h.customerId);
    const { data: ckAfter } = await sb!.from('check_ins').select('id').eq('id', h.id);
    expect(ckAfter?.length ?? 0, 'check_in 잔존 0(레지스트리 회수)').toBe(0);
    expect(cAfter?.length ?? 0, 'customer 잔존 0(레지스트리 회수) — POST=DELETE 갭 차단').toBe(0);
  });
});
