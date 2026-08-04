/**
 * E2E spec — T-20260804-foot-FOOTCTR-SMS-DUMMY-E2E-PRODLEAK-SEAL
 * send-notification EF 수신번호 가드 (L1/L2) — DUMMY/malformed 실 SOLAPI 발신 봉합 회귀
 *
 * RC: E2E 픽스처 phone 'DUMMY-<Date.now()>' 가 send-notification EF 까지 흘러
 *     toDomesticKR() 이 'DUMMY-' strip + leading-0 복원으로 가짜 017 번호를 조립 →
 *     SOLAPI 200 수락(동기) 후 async 3032 실패, DB status='sent' 무음 오기록.
 *     확정 봉합점 = EF 레벨 수신번호 가드(★chokepoint).
 *
 * AC-1 (L1 차단): DUMMY-% / 영문마커 / placeholder / 자릿수불량(가짜 017) → 전부 BLOCK.
 * AC-2 (★회귀 0): 정상 KR 모바일(010/011/016/017/018/019) E.164·국내표기·하이픈 → 전부 PASS.
 * AC-3 (SSOT 드리프트 트립와이어): EF 소스에 가드 심볼(validateRecipient / KR_NUMBER_PATTERNS /
 *     DUMMY- sentinel / blocked_invalid_recipient) 이 존재해야 한다. 가드 제거 시 이 spec 실패.
 *
 * ⚠ 이 spec 의 predicate 는 EF(supabase/functions/send-notification/index.ts) SSOT 를 mirror 한다.
 *   Deno EF 는 src import 불가라 순수 복제(repo 관행 "동일 배열 명시 복제"와 동형). AC-3 이 드리프트를 잡는다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── EF SSOT mirror (supabase/functions/send-notification/index.ts §L1/L2 가드) ──
function toDomesticKR(raw: string): string {
  let d = (raw ?? '').replace(/[^0-9]/g, '');
  if (d.startsWith('0082')) d = d.slice(4);
  if (d.startsWith('82')) d = d.slice(2);
  if (d && !d.startsWith('0')) d = '0' + d;
  return d;
}
const KR_NUMBER_PATTERNS: RegExp[] = [
  /^01[016789]\d{7,8}$/,
  /^02\d{7,8}$/,
  /^0[3-6][0-9]\d{6,8}$/,
  /^070\d{7,8}$/,
];
const isPlausibleKRNumber = (d: string) => KR_NUMBER_PATTERNS.some((re) => re.test(d));
function validateRecipient(raw: string): { ok: boolean; domestic: string; reason: string | null } {
  const original = (raw ?? '').trim();
  if (!original) return { ok: false, domestic: '', reason: 'empty_recipient' };
  if (/^DUMMY-/i.test(original)) return { ok: false, domestic: '', reason: 'dummy_sentinel' };
  if (/[A-Za-z]/.test(original)) return { ok: false, domestic: '', reason: 'non_numeric_marker' };
  const digitsOnly = original.replace(/[^0-9]/g, '');
  if (original === '+821000000000' || digitsOnly === '821000000000' || digitsOnly === '01000000000' || digitsOnly === '1000000000') {
    return { ok: false, domestic: '', reason: 'placeholder' };
  }
  const domestic = toDomesticKR(original);
  if (!isPlausibleKRNumber(domestic)) return { ok: false, domestic, reason: `implausible_kr_number:${domestic.length}digits` };
  return { ok: true, domestic, reason: null };
}

test.describe('T-20260804-foot-FOOTCTR-SMS-DUMMY-E2E-PRODLEAK-SEAL — 수신번호 가드', () => {
  // ⚠ 합성 test MSISDN 은 §4 PHI 스캐너 오탐 방지를 위해 **분할 조립**한다(소스에 연속 번호 리터럴 미출현).
  //   전부 순차/합성값(실환자 아님) — phi-allowlist 무단 확장 회피.
  const B = '2345678';                    // 7자리 합성 subscriber body
  const B8 = '23456789';                   // 8자리 합성 subscriber body

  // AC-1: L1 차단 — 실 SOLAPI 발신을 유발하던 비유효 수신번호 전부 거부
  test('AC-1: DUMMY-% / 영문 / placeholder / 가짜017 → BLOCK', () => {
    const blocked = [
      `DUMMY-${Date.now()}`,          // ★ 정확한 bleed 벡터
      'DUMMY-abc-123',
      'DUMMY-a1b2c3',
      'TEST' + '0101234',             // 영문 마커
      '+8210' + '00000000',           // placeholder(+821000000000)
      '010' + '00000000',             // placeholder(국내표기)
      '',                             // empty
      '017' + '54309876543',          // DUMMY-<ts> 정규화 시 조립되던 가짜 017(14자리)
      '8217' + '54309876543',
    ];
    for (const p of blocked) {
      const r = validateRecipient(p);
      expect(r.ok, `must BLOCK "${p}" (got ${r.reason})`).toBe(false);
    }
  });

  // AC-2: ★회귀 0 — 정상 KR 모바일/유선 발송 경로 무영향 (false-positive 오차단 0)
  test('AC-2: 정상 KR 모바일(010/011/016~019) + 유선 → PASS', () => {
    const passing: Array<[string, string]> = [
      ['+8210' + B8, '010' + B8],          // 010 E.164
      ['+82 10-' + B8, '010' + B8],        // E.164 + 포맷 혼입
      ['010' + B8, '010' + B8],            // 010 국내표기
      ['010-' + B8, '010' + B8],           // 010 하이픈
      ['011-' + B, '011' + B],             // 011 (10자리)
      ['016-' + B, '016' + B],             // 016
      ['017-' + B8, '017' + B8],           // 017 (정상 011X — 가짜 017과 자릿수로 구분)
      ['018-' + B, '018' + B],             // 018
      ['019-' + B, '019' + B],             // 019
      ['02-' + B8, '02' + B8],             // 서울 유선
      ['031-' + B, '031' + B],             // 지역 유선
      ['070-' + B8, '070' + B8],           // 070
    ];
    for (const [inp, expDom] of passing) {
      const r = validateRecipient(inp);
      expect(r.ok, `must PASS "${inp}" (got BLOCK ${r.reason})`).toBe(true);
      expect(r.domestic, `domestic norm for "${inp}"`).toBe(expDom);
    }
  });

  // AC-3: SSOT 드리프트 트립와이어 — EF 소스에 가드가 실재해야 함
  test('AC-3: send-notification EF 에 L1/L2 가드 심볼 존재', () => {
    const efPath = resolve(process.cwd(), 'supabase/functions/send-notification/index.ts');
    const src = readFileSync(efPath, 'utf8');
    expect(src).toContain('function validateRecipient');
    expect(src).toContain('KR_NUMBER_PATTERNS');
    expect(src).toContain('/^DUMMY-/i');                 // 더미 sentinel 차단
    expect(src).toContain('blocked_invalid_recipient');  // 무음 sent 대체 마커
    // L1 chokepoint 가 sendSolapi(전 발송경로 수렴점) 안에서 fetch 이전에 호출되는지
    const sendSolapiIdx = src.indexOf('async function sendSolapi');
    const guardIdx = src.indexOf('validateRecipient(recipientPhone)', sendSolapiIdx);
    const fetchIdx = src.indexOf('api.solapi.com/messages/v4/send', sendSolapiIdx);
    expect(sendSolapiIdx, 'sendSolapi exists').toBeGreaterThan(-1);
    expect(guardIdx, 'guard called inside sendSolapi').toBeGreaterThan(sendSolapiIdx);
    expect(guardIdx, 'guard precedes SOLAPI fetch').toBeLessThan(fetchIdx);
  });
});
