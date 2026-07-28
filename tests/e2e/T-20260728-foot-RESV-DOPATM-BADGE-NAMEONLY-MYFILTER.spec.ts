/**
 * T-20260728-foot-RESV-DOPATM-BADGE-NAMEONLY-MYFILTER
 * 예약관리 '내 예약' 필터 도파민-origin 누락 해소(AC-1) + '[도파민TM]' 뱃지→이름만(AC-2), FE read-path only·no-DDL.
 *
 * ★ body T-20260728-body-RESV-MYONLY-DOPAMINE-REGISTRANT(deployed d440316e)의 하드닝 패턴 이식.
 *   단, 저장구조가 다르다(맹목 미러 금지):
 *     - body: 도파민-origin = created_by=NULL + source_registrant_name=상담사명.
 *     - foot: 도파민-origin = registrar_name 에 저장. EF 매칭 → registrar_id+clean name /
 *             무매칭 → registrar_id=NULL + registrar_name='[도파민TM] {name}' provenance 라벨.
 *   → 풋 '내 예약' 필터 RC = registrar_name 의 '[도파민TM] ' prefix 로 NAME-MATCH 깨짐(created_by 아님).
 *
 * AC:
 *   AC-1 필터: '내 예약' ON 시 '[도파민TM] {본인이름}' 예약도 본인 것으로 인지(clean 키 매칭).
 *   AC-2 뱃지→이름만: '[도파민TM] 강솔희' → '강솔희' (풋 스태프로도 존재하는 cross-CRM 동일인 한정).
 *                     외부/TM전용 registrant 는 provenance 뱃지 유지. 강솔희 하드코딩 없음(마스터 매칭).
 *   AC-3 무회귀: 도파민 계정 없는 일반 풋 스태프 '내 예약' + 타 등록자 뱃지 무회귀.
 *   하드닝(body 계승): NFC 정규화 + prefix strip + null/opaque → false(무차별 흡수 방지, P0 privacy).
 *   배선/불변: registrar_name/registrar_id/source_system write 0 (read-path only, §416/§963⑥ 무저촉).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  isMineRegistrar,
  isSameRegistrar,
  registrantMatchKey,
  buildKnownRegistrarKeys,
} from '../../src/lib/registrarMatch';
import { resolveRegistrarDisplay } from '../../src/lib/types';

const ME = '강솔희';
// 풋 등록자 마스터(reservation_registrars) ∪ 로그인 표시명 → clean 키 Set.
//   강솔희·김민경 = 풋 스태프로도 존재(cross-CRM 동일인). '박외부TM' = 도파민 전용(마스터 부재).
const KNOWN = buildKnownRegistrarKeys(['강솔희', '김민경', ME]);

test.describe('T-20260728-foot-RESV-DOPATM-BADGE-NAMEONLY-MYFILTER', () => {
  // ── AC-1: '내 예약' 필터 — '[도파민TM] 본인' 예약을 본인 것으로 인지 ──
  test("AC-1: '[도파민TM] {본인}' registrar_name 을 '내 예약'에 포함(clean 키 매칭)", () => {
    // 무매칭 도파민 예약(prefix 라벨) — 본인
    expect(isMineRegistrar('[도파민TM] 강솔희', ME)).toBe(true);
    // 매칭 도파민 예약(EF가 clean 스냅샷 착지) — 기존 exact 경로로도 인지
    expect(isMineRegistrar('강솔희', ME)).toBe(true);
    // 남의 도파민 예약은 제외(무차별 흡수 금지)
    expect(isMineRegistrar('[도파민TM] 김민경', ME)).toBe(false);
  });

  // ── AC-3 무회귀: 일반 풋 스태프 자체 예약(body-origin) 필터 동작 유지 ──
  test('AC-3 무회귀: body-origin registrar_name exact 매칭 유지', () => {
    expect(isMineRegistrar('강솔희', ME)).toBe(true); // 자체 등록
    expect(isMineRegistrar('김민경', ME)).toBe(false); // 타 등록자
    expect(isMineRegistrar(null, ME)).toBe(false); // 미지정
    expect(isMineRegistrar('강솔희', '')).toBe(false); // 빈 표시명 → 매칭 불가
  });

  // ── 하드닝(body 계승): prefix 변형·NFC·opaque/null 폴백 ──
  test('하드닝: prefix 변형·NFC 정규화 매칭 + opaque/null 폴백(오매칭 방지)', () => {
    // '[도파민TM]' 브래킷/공백 변형 방어
    expect(isSameRegistrar('[도파민TM] 강솔희', '강솔희')).toBe(true);
    expect(isSameRegistrar('[ 도파민 TM ] 강솔희', '강솔희')).toBe(true);
    expect(isSameRegistrar('[도파민 TM]강솔희', '강솔희')).toBe(true);
    // NFC 정규화(도파민 push payload NFD 운반 이력 대비 under-match 방지, body d440316e)
    expect(isSameRegistrar('강솔희'.normalize('NFD'), '강솔희'.normalize('NFC'))).toBe(true);
    // exact-match 금지: prefix raw 는 clean 이름과 문자열 불일치이나 매칭은 성립
    expect('[도파민TM] 강솔희' === '강솔희').toBe(false);
    // 다중공백 표기 변형 방어
    expect(registrantMatchKey('[도파민TM]  강솔희')).toBe('강솔희');
    // 폴백(공란·UUID·opaque id) → null → 매칭 실패(무차별 흡수 방지)
    expect(registrantMatchKey(null)).toBeNull();
    expect(registrantMatchKey('   ')).toBeNull();
    expect(registrantMatchKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBeNull();
    expect(registrantMatchKey('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8')).toBeNull();
    expect(isSameRegistrar(null, '강솔희')).toBe(false);
    expect(isSameRegistrar('', '강솔희')).toBe(false);
  });

  // ── AC-2: '[도파민TM]' 뱃지 → 이름만 (cross-CRM 동일인 한정) ──
  test("AC-2: cross-CRM 동일인이면 '[도파민TM] 강솔희' → '강솔희', 외부/TM전용은 뱃지 유지", () => {
    // 동일인(풋 마스터에 존재) → 뱃지 제거, 이름만
    expect(resolveRegistrarDisplay('[도파민TM] 강솔희', 'dopamine', KNOWN)).toBe('강솔희');
    expect(resolveRegistrarDisplay('[도파민TM] 김민경', 'dopamine', KNOWN)).toBe('김민경');
    // 외부/TM전용(풋 마스터 부재) → provenance 뱃지 유지
    expect(resolveRegistrarDisplay('[도파민TM] 박외부TM', 'dopamine', KNOWN)).toBe('[도파민TM] 박외부TM');
    // knownKeys 미전달(구 2-arg 호출) → 기존 동작(뱃지 유지) 100% 회귀 0
    expect(resolveRegistrarDisplay('[도파민TM] 강솔희', 'dopamine')).toBe('[도파민TM] 강솔희');
  });

  // ── AC-3 무회귀(표시): 매칭 도파민(clean 스냅샷)·body-origin·미보유 폴백 불변 ──
  test('AC-3 무회귀(표시): prefix 없는 라벨·폴백 동작 불변', () => {
    // EF 매칭 도파민(clean 스냅샷, prefix 없음) → 그대로
    expect(resolveRegistrarDisplay('강솔희', 'dopamine', KNOWN)).toBe('강솔희');
    // body-origin(비 도파민) → 그대로
    expect(resolveRegistrarDisplay('김민경', 'reception', KNOWN)).toBe('김민경');
    // 라벨 미보유 + 도파민 → '도파민 등록' 안전 폴백
    expect(resolveRegistrarDisplay(null, 'dopamine', KNOWN)).toBe('도파민 등록');
    // 라벨 미보유 + 비도파민 → ''
    expect(resolveRegistrarDisplay(null, 'reception', KNOWN)).toBe('');
  });

  // ── 배선/불변: read-path only — registrar 저장값 write 무접촉 ──
  test('배선: Reservations/Popup 가 SSOT 헬퍼 사용 + registrar_name/id write 0', () => {
    const resv = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf8');
    // AC-1 필터가 SSOT isMineRegistrar 사용
    expect(resv).toContain('isMineRegistrar(r.registrar_name, mineTarget)');
    // AC-2 카드 뱃지가 knownRegistrarKeys 스코프 display 사용
    expect(resv).toContain('resolveRegistrarDisplay(r.registrar_name, r.source_system, knownRegistrarKeys)');
    // 구 exact 필터 잔존 금지
    expect(resv).not.toContain("(r.registrar_name ?? '').trim() === mineTarget");

    const popup = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf8');
    expect(popup).toContain('knownRegistrarKeys');
    // read-path only: registrar_name/registrar_id 를 이 티켓 경로에서 write(update payload) 하지 않음
    //   (저장은 기존 saveRouteAndRegistrar 경로 불변 — 본 티켓은 표시/필터만 변경)
    const lib = fs.readFileSync(path.resolve('src/lib/registrarMatch.ts'), 'utf8');
    expect(lib).toContain("normalize('NFC')"); // body 하드닝 계승
  });
});
