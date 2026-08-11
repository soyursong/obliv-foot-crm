/**
 * T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — 상병(KCD) 청구 연결: 스태프 캡처면 영속 검증
 *
 * 배경: insurance_claim_diagnoses=0건. foot 은 급여 상병(KCD) 캡처면 부재 →
 *   의사 진료차트(§11 medical_confirm_gate) 없이도 방문단위 상병을 포착할
 *   스태프 캡처 컬럼 check_ins.kcd_code 를 신설(body 20260515000010 패턴 이식, ADDITIVE).
 *
 * 이 spec 은 FE KcdDiagnosisField 의 실 write path
 *   (src/components/insurance/KcdDiagnosisField.tsx L117:
 *      supabase.from('check_ins').update({ kcd_code: nextCode }).eq('id', checkInId))
 * 를 service_role 로 그대로 재현해 **write→check_ins.kcd_code 영속 1회**(supervisor
 * post-verify item 4)를 결정적으로 검증한다. page/auth 불필요 — FIXTURE-SELFID 동형.
 *
 * ★ 진짜 로그인-클릭 렌더/저장 UX 는 supervisor 라이브 QA(§2.10 라이브 번들 재대조) 위임.
 *   본 spec 은 데이터-영속 계약(컬럼 실재 + write round-trip + clear + 발명금지 가드)을 고정.
 *
 * 검증:
 *  AC-1: seed 된 check_in 에 kcd_code 를 쓰면 그 값이 그대로 영속(read-back 일치).
 *  AC-2: kcd_code=null 로 다시 쓰면 결핍(미입력) 상태로 되돌아간다(FE '상병 결핍' 표식 대상).
 *  AC-3: 발명 금지 계약 — FE 가 저장 직전 통과시키는 isKnownKcdCode 가드가
 *        정적 KCD 번들의 실 코드(M72.2 족저근막염)는 허용, 임의 문자열은 거부.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupAll, seedCheckIn } from '../fixtures';
import { isKnownKcdCode, loadKcdBundle } from '../../src/lib/kcd/kcdSearch';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

// 정적 KCD 번들에서 실재가 보장되는 대표 코드(족저근막염). 번들 로드 후 실검증으로 대체됨.
const KNOWN_KCD = 'M72.2';

test.describe('T-20260810-foot-INS-CLAIM-DIAGLINK — check_ins.kcd_code 스태프 캡처 영속', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    if (dbReady) await cleanupAll();
  });

  test('AC-1: FE write path(.update kcd_code) → check_ins.kcd_code 영속 1회', async () => {
    const handle = await seedCheckIn({ visit_type: 'new', status: 'registered' });

    // FE KcdDiagnosisField 의 실 write 재현
    const { error: upErr } = await sb!
      .from('check_ins')
      .update({ kcd_code: KNOWN_KCD })
      .eq('id', handle.id);
    expect(upErr, `kcd_code write 실패: ${upErr?.message}`).toBeNull();

    const { data, error } = await sb!
      .from('check_ins')
      .select('kcd_code')
      .eq('id', handle.id)
      .single();
    expect(error).toBeNull();
    expect((data as { kcd_code: string | null }).kcd_code).toBe(KNOWN_KCD);
  });

  test('AC-2: kcd_code=null 재write → 상병 결핍(미입력) 상태 복귀', async () => {
    const handle = await seedCheckIn({ visit_type: 'returning', status: 'registered' });

    await sb!.from('check_ins').update({ kcd_code: KNOWN_KCD }).eq('id', handle.id);
    // KcdDiagnosisField 의 clear 경로(nextCode=null)
    const { error: clrErr } = await sb!
      .from('check_ins')
      .update({ kcd_code: null })
      .eq('id', handle.id);
    expect(clrErr).toBeNull();

    const { data } = await sb!
      .from('check_ins')
      .select('kcd_code')
      .eq('id', handle.id)
      .single();
    expect((data as { kcd_code: string | null }).kcd_code).toBeNull();
  });

  test('AC-3: 발명 금지 — 정적 번들 실코드 허용 / 임의문자열 거부(FE 저장 직전 가드)', async () => {
    await loadKcdBundle();
    // 대표 급여 상병은 번들에 실재 → 저장 허용 경로
    expect(isKnownKcdCode(KNOWN_KCD)).toBe(true);
    // 발명/자유입력 코드는 거부 → check_ins.kcd_code 로 절대 착지 금지
    expect(isKnownKcdCode('ZZZ-INVENTED-999')).toBe(false);
    expect(isKnownKcdCode('')).toBe(false);
  });
});
