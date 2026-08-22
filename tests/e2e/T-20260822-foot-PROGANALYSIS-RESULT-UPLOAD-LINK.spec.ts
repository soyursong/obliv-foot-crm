/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK
 *
 * 진료대시보드>경과분석 탭 [결과 업로드] — 결과 이미지/ZIP 업로드 → 파일명 파싱 → 예약(appointment) 1:1 링킹.
 *   파일명 계약(SSOT, 6-토큰): 경과분석_{이름}_{차트숫자}_예정_{N}회차_{YYMMDD}.png
 *   매칭 키 = 차트번호 + 회차(N) + 날짜 3조합 → progress_analysis_slips.reservation_id(=appointment_id) 1:1.
 *   이름·날짜 추측연결 절대 금지(fail-closed). 실패(파싱오류/불일치/중복) = '원장 확인 대기' 보류.
 *
 * 대상(순수 함수) — auth/page/server 미사용 → playwright.config 'unit' 프로젝트:
 *   src/lib/progressResultFilename.ts   : parseProgressResultFilename / buildProgressResultFilename / hasEmoji
 *   src/lib/progressResultApptMatch.ts  : resolveApptMatch / slipMatchKey
 *
 * AC ↔ 현장 시나리오:
 *   시나리오1(정상 링킹): 계약 파일명 → 파싱 성공 + 슬립 정확히 1건 → matched(reservation_id).
 *   시나리오2(ZIP 일부실패): 성공/파싱실패/날짜불일치(no_match) 혼재 → 성공만 matched, 나머지 보류.
 *   시나리오3(엣지·계약위반): 이모지=즉시실패 / 한 글자 틀림=파싱실패 / 중복키=duplicate 보류(덮어쓰기 안 함).
 *
 * AC-5(노쇼 소프트삭제)·ZIP 바이너리 해제·실기기 드래그앤드롭/토스트 = supervisor 갤탭 field-soak(browser_verify) + §6 마이그(DB gate).
 */
import { test, expect } from '@playwright/test';
import {
  parseProgressResultFilename,
  buildProgressResultFilename,
  hasEmoji,
} from '../../src/lib/progressResultFilename';
import {
  resolveApptMatch,
  slipMatchKey,
  type SlipLite,
} from '../../src/lib/progressResultApptMatch';

const RES_A = 'aaaa1111-2222-3333-4444-555555555555';

function slip(over: Partial<SlipLite> & { reservation_id: string }): SlipLite {
  return {
    id: `slip-${over.reservation_id}`,
    reservation_id: over.reservation_id,
    customer_id: over.customer_id ?? `cust-${over.reservation_id}`,
    chart_no: over.chart_no ?? '1234',
    state: over.state ?? 'pending_extract',
    hasActiveImage: over.hasActiveImage ?? false,
  };
}

test.describe('AC-2/AC-6 파일명 계약 파싱(6-토큰 strict)', () => {
  test('시나리오1: 계약 파일명 정상 파싱', () => {
    const p = parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_260822.png');
    expect(p.ok).toBe(true);
    expect(p.chartNo).toBe('1234');
    expect(p.sessionOrdinal).toBe(6);
    expect(p.visitDate).toBe('2026-08-22');
    expect(p.patientName).toBe('홍길동');
    expect(p.ext).toBe('png');
  });

  test('build ↔ parse 라운드트립(SSOT 일관성)', () => {
    const name = buildProgressResultFilename({
      patientName: '김발톱', chartNo: '5678', sessionOrdinal: 12, visitDate: '2026-12-03',
    });
    expect(name).toBe('경과분석_김발톱_5678_예정_12회차_261203.png');
    const p = parseProgressResultFilename(name);
    expect(p.ok).toBe(true);
    expect(p.chartNo).toBe('5678');
    expect(p.sessionOrdinal).toBe(12);
    expect(p.visitDate).toBe('2026-12-03');
  });

  test('AC-6: 이모지 포함 = 즉시 실패', () => {
    expect(hasEmoji('경과분석_홍길동_1234_예정_6회차_260822😀.png')).toBe(true);
    const p = parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_260822😀.png');
    expect(p.ok).toBe(false);
    expect(p.reason).toContain('이모지');
  });

  test('AC-6: 한 글자라도 다르면 실패 — 회차 표기 누락', () => {
    // '6회' (회차 아님) → 파싱 실패.
    const p = parseProgressResultFilename('경과분석_홍길동_1234_예정_6회_260822.png');
    expect(p.ok).toBe(false);
  });

  test('AC-6: 머리말 오타 = 실패', () => {
    expect(parseProgressResultFilename('경과분석지_홍길동_1234_예정_6회차_260822.png').ok).toBe(false);
    expect(parseProgressResultFilename('경과분석_홍길동_1234_예약_6회차_260822.png').ok).toBe(false); // 예정→예약
  });

  test('AC-6: 토큰 수 불일치(언더스코어 과부족) = 실패', () => {
    expect(parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차.png').ok).toBe(false); // 5토큰
    expect(parseProgressResultFilename('경과분석_홍_길동_1234_예정_6회차_260822.png').ok).toBe(false); // 이름 언더스코어→7토큰
  });

  test('AC-6: 날짜 불량(YYMMDD 아님/존재불가일) = 실패', () => {
    expect(parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_2608.png').ok).toBe(false);
    expect(parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_260231.png').ok).toBe(false); // 2/31
  });

  test('허용 확장자만(png/jpg/jpeg/webp)', () => {
    expect(parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_260822.jpg').ok).toBe(true);
    expect(parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_260822.pdf').ok).toBe(false);
  });
});

test.describe('AC-2/AC-3 예약 1:1 링킹 결정트리(fail-closed)', () => {
  const parsedA = parseProgressResultFilename('경과분석_홍길동_1234_예정_6회차_260822.png');
  const keyA = slipMatchKey('1234', 6, '2026-08-22');

  test('시나리오1: 슬립 정확히 1건 + 미연결 → matched(reservation_id)', () => {
    const map = new Map<string, SlipLite[]>([[keyA, [slip({ reservation_id: RES_A })]]]);
    const r = resolveApptMatch(parsedA, map);
    expect(r.status).toBe('matched');
    expect(r.reservationId).toBe(RES_A);
  });

  test('AC-3: 슬립 0건 → no_match 보류(추측연결 금지)', () => {
    const r = resolveApptMatch(parsedA, new Map());
    expect(r.status).toBe('no_match');
    expect(r.reservationId).toBeNull();
  });

  test('AC-3: 후보 2건↑ → ambiguous 보류(mis-bind 방지)', () => {
    const map = new Map<string, SlipLite[]>([
      [keyA, [slip({ reservation_id: RES_A }), slip({ reservation_id: 'bbbb2222-2222-3333-4444-555555555555' })]],
    ]);
    expect(resolveApptMatch(parsedA, map).status).toBe('ambiguous');
  });

  test('시나리오3: 중복(이미 활성 이미지) → duplicate 보류(덮어쓰기 안 함)', () => {
    const map = new Map<string, SlipLite[]>([[keyA, [slip({ reservation_id: RES_A, hasActiveImage: true })]]]);
    const r = resolveApptMatch(parsedA, map);
    expect(r.status).toBe('duplicate');
  });

  test('시나리오3: 슬립 확정(confirmed) → duplicate 보류', () => {
    const map = new Map<string, SlipLite[]>([[keyA, [slip({ reservation_id: RES_A, state: 'confirmed' })]]]);
    expect(resolveApptMatch(parsedA, map).status).toBe('duplicate');
  });

  test('AC-2: 날짜 불일치(다른 날 슬립) → no_match(같은 차트·회차라도 날짜 안 맞으면 연결 안 함)', () => {
    const otherKey = slipMatchKey('1234', 6, '2026-08-21'); // 하루 차이
    const map = new Map<string, SlipLite[]>([[otherKey, [slip({ reservation_id: RES_A })]]]);
    expect(resolveApptMatch(parsedA, map).status).toBe('no_match');
  });

  test('AC-3: 파싱 실패 파일 → parse_fail 보류', () => {
    const bad = parseProgressResultFilename('경과분석_홍길동_1234_예정_6회_260822.png');
    expect(resolveApptMatch(bad, new Map()).status).toBe('parse_fail');
  });
});
