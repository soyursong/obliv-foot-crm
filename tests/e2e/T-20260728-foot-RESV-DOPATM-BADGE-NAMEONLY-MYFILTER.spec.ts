/**
 * T-20260728-foot-RESV-DOPATM-BADGE-NAMEONLY-MYFILTER
 * 예약관리 '내 예약' 필터 도파민-origin 누락 해소(AC-1) + '[도파민TM]' 인라인 라벨→이름만(AC-2), FE read-path only·no-DDL.
 *
 * ★ Part1 진단(확정): 강솔희 3건 = reservations.registrar_name='[도파민TM] 강솔희', registrar_id=NULL, created_by=NULL.
 *   "뱃지"는 별도 FE 컴포넌트가 아니라 registrar_name 안의 §416 fallback provenance 저장 라벨(경로 ii).
 *
 * ★ DA CONSULT-REPLY (DA-20260728-foot-RESV-DOPATM-BADGE-NAMEONLY) = Option A′ 조건부 GO.
 *   dev 원안 Option A(clean 이름을 풋 registrar 마스터에 이름-매칭해 strip) = REJECT
 *     — read-side 이름-재해소(§963⑩(b) 이름-버전) + 동명이인 false-resolve hazard.
 *   채택 A′ (5-AC HARD):
 *     ① display-only — 저장값(registrar_name/registrar_id/source_system) write 0, DB verbatim 존치.
 *     ② strip = 리터럴 '[도파민TM] ' prefix 결정적 제거 + source_system='dopamine' 구조 게이트(마스터 대조 금지).
 *     ③ provenance relocate·非삭제 — 비-인라인 뱃지(resolveRegistrarProvenance, source_system 파생).
 *     ④ §963⑩ HARD INVARIANT — strip 이름·뱃지 = grouping/filter/attribution/incentive 입력 불가(순수 render).
 *     ⑤ 동명이인 무의존 — 리터럴+구조 게이트 → 이름 비교 부재 → hazard 소거.
 *
 * ★ AC-1 (내예약만 isMineRegistrar) = §416-무접촉 아님 → DA §963⑫ 5-AC 바인딩 하 GO-inert:
 *     ①origin-gate(source_system='dopamine' 파티션 한정) ②정규화 SSOT 재사용 ③null/UUID/opaque false-폴백
 *     ④display-scoping 전용·비승격 ⑤보드 non-RLS 전제(예약관리 격자=clinic_id+date, 동명이인=bounded mis-attribution).
 *
 * AC:
 *   AC-1 필터: '내 예약' ON 시 '[도파민TM] {본인}' 예약도 본인 것으로 인지(dopamine 파티션 한정 clean 키 매칭).
 *   AC-2 라벨→이름만: source_system='dopamine' + '[도파민TM]' prefix → 이름만 + 비-인라인 provenance 뱃지(강솔희 하드코딩 없음, 동명이인 무의존).
 *   AC-3 무회귀: 도파민 계정 없는 일반 풋 스태프 '내 예약' + 비-dopamine 등록자 표시 무회귀.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  isMineRegistrar,
  isSameRegistrar,
  registrantMatchKey,
} from '../../src/lib/registrarMatch';
import { resolveRegistrarDisplay, resolveRegistrarProvenance } from '../../src/lib/types';

const ME = '강솔희';

test.describe('T-20260728-foot-RESV-DOPATM-BADGE-NAMEONLY-MYFILTER', () => {
  // ── AC-1: '내 예약' 필터 — dopamine 파티션 한정 '[도파민TM] 본인' 예약 인지 (origin-gate) ──
  test("AC-1: dopamine-origin '[도파민TM] {본인}' 예약을 '내 예약'에 포함(clean 키 매칭)", () => {
    // 무매칭 도파민 예약(prefix 라벨) — 본인 (source_system='dopamine' origin-gate 통과)
    expect(isMineRegistrar('[도파민TM] 강솔희', ME, 'dopamine')).toBe(true);
    // 매칭 도파민 예약(EF가 clean 스냅샷 착지) — 기존 exact 경로로도 인지
    expect(isMineRegistrar('강솔희', ME, 'dopamine')).toBe(true);
    // 남의 도파민 예약은 제외(무차별 흡수 금지)
    expect(isMineRegistrar('[도파민TM] 김민경', ME, 'dopamine')).toBe(false);
  });

  // ── AC-1 origin-gate: 경로2(prefix-strip)는 source_system='dopamine' 한정 (§963⑫ ①) ──
  test('AC-1 origin-gate: 비-dopamine 행은 경로2 미진입 → exact 경로만(회귀 0)', () => {
    // native 행(exact 매칭)은 origin 무관 항상 인지
    expect(isMineRegistrar('강솔희', ME, 'reception')).toBe(true);
    // prefix 라벨인데 source_system≠dopamine = anomaly → 경로2 미진입 → false (구조 게이트)
    expect(isMineRegistrar('[도파민TM] 강솔희', ME, 'reception')).toBe(false);
    // source_system 미전달(구 2-arg 호환) → 경로2 origin-gate로 false, exact 만 유효
    expect(isMineRegistrar('[도파민TM] 강솔희', ME)).toBe(false);
    expect(isMineRegistrar('강솔희', ME)).toBe(true);
  });

  // ── AC-3 무회귀: 일반 풋 스태프 자체 예약(native) 필터 동작 유지 ──
  test('AC-3 무회귀: native registrar_name exact 매칭 유지', () => {
    expect(isMineRegistrar('강솔희', ME, 'reception')).toBe(true); // 자체 등록
    expect(isMineRegistrar('김민경', ME, 'reception')).toBe(false); // 타 등록자
    expect(isMineRegistrar(null, ME, 'dopamine')).toBe(false); // 미지정
    expect(isMineRegistrar('강솔희', '', 'dopamine')).toBe(false); // 빈 표시명 → 매칭 불가
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

  // ── AC-2 (A′): source_system='dopamine' + '[도파민TM]' prefix → 이름만 (동명이인 무의존, 마스터 대조 없음) ──
  test("AC-2 A′: dopamine-origin '[도파민TM] {name}' → clean 이름만 (마스터 조회 없이 결정적 strip)", () => {
    // 동일인이든 아니든 dopamine-origin prefix 는 결정적 strip (이름 비교 부재 = 동명이인 hazard 소거)
    expect(resolveRegistrarDisplay('[도파민TM] 강솔희', 'dopamine')).toBe('강솔희');
    expect(resolveRegistrarDisplay('[도파민TM] 김민경', 'dopamine')).toBe('김민경');
    expect(resolveRegistrarDisplay('[도파민TM] 박외부TM', 'dopamine')).toBe('박외부TM');
    // strip 은 마스터/로그인명 인자를 받지 않는다(이름-매칭 footgun 소거) — 3-arg 시그니처 부재
    expect(resolveRegistrarDisplay.length).toBe(2);
  });

  // ── AC-2 (A′) ② 구조 게이트: prefix 있는데 source_system≠dopamine = anomaly → strip 안 함(원문 유지) ──
  test('AC-2 A′ anomaly: source_system≠dopamine 인데 prefix 잔존 → strip 억제(원문 라벨 유지)', () => {
    expect(resolveRegistrarDisplay('[도파민TM] 강솔희', 'reception')).toBe('[도파민TM] 강솔희');
    expect(resolveRegistrarDisplay('[도파민TM] 강솔희', null)).toBe('[도파민TM] 강솔희');
  });

  // ── AC-2 (A′) ③ provenance relocate: 뱃지는 source_system 파생(문자열 prefix 탐지 아님, 非삭제) ──
  test('AC-2 A′ provenance: dopamine-origin 은 비-인라인 뱃지 신호 유지(pure 삭제 아님)', () => {
    // dopamine → 뱃지 표시 신호(source_system 구조 discriminant)
    expect(resolveRegistrarProvenance('dopamine')).toBe('dopamine');
    // 비-dopamine → 뱃지 없음
    expect(resolveRegistrarProvenance('reception')).toBeNull();
    expect(resolveRegistrarProvenance(null)).toBeNull();
    // 라벨을 strip 해도(이름만) 뱃지 신호는 동일 source_system 에서 유지 = 신호 소실 아닌 relocate
    expect(resolveRegistrarDisplay('[도파민TM] 강솔희', 'dopamine')).toBe('강솔희');
    expect(resolveRegistrarProvenance('dopamine')).toBe('dopamine');
  });

  // ── AC-3 무회귀(표시): 매칭 도파민(clean 스냅샷)·native·미보유 폴백 불변 ──
  test('AC-3 무회귀(표시): prefix 없는 라벨·폴백 동작 불변', () => {
    // EF 매칭 도파민(clean 스냅샷, prefix 없음) → 그대로
    expect(resolveRegistrarDisplay('강솔희', 'dopamine')).toBe('강솔희');
    // native(비 도파민) → 그대로
    expect(resolveRegistrarDisplay('김민경', 'reception')).toBe('김민경');
    // 라벨 미보유 + 도파민 → '도파민 등록' 안전 폴백
    expect(resolveRegistrarDisplay(null, 'dopamine')).toBe('도파민 등록');
    // 라벨 미보유 + 비도파민 → ''
    expect(resolveRegistrarDisplay(null, 'reception')).toBe('');
  });

  // ── 배선/불변: read-path only + A′ mechanism(마스터-매칭 부재) 소스 검증 ──
  test('배선: SSOT 헬퍼 A′ 사용 + registrar 저장값 write 0 + 마스터-매칭 잔존 금지', () => {
    const resv = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf8');
    // AC-1 필터가 SSOT isMineRegistrar 사용 (origin-gate: source_system 인자 전달)
    expect(resv).toContain('isMineRegistrar(r.registrar_name, mineTarget, r.source_system)');
    // AC-2 뱃지가 A′ 2-arg display + source_system 파생 provenance 뱃지 사용
    expect(resv).toContain('resolveRegistrarDisplay(r.registrar_name, r.source_system)');
    expect(resv).toContain('resolveRegistrarProvenance(r.source_system)');
    expect(resv).toContain('registrar-provenance-');
    // REJECT 된 마스터-매칭(옵션 A) 잔존 금지
    expect(resv).not.toContain('knownRegistrarKeys');
    expect(resv).not.toContain('buildKnownRegistrarKeys');
    // 구 exact 필터 잔존 금지
    expect(resv).not.toContain("(r.registrar_name ?? '').trim() === mineTarget");

    const popup = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf8');
    // 팝업도 A′ 2-arg display 로 정정, 마스터-매칭 잔존 금지
    expect(popup).toContain('resolveRegistrarDisplay(reservation.registrar_name, reservation.source_system)');
    expect(popup).not.toContain('knownRegistrarKeys');

    // A′ ② 마스터 대조 금지: types.ts resolveRegistrarDisplay 가 Set 인자를 받지 않음
    const types = fs.readFileSync(path.resolve('src/lib/types.ts'), 'utf8');
    expect(types).toContain("(sourceSystem ?? '').trim() === 'dopamine' && DOPAMINE_TM_PREFIX_RE.test(name)");
    expect(types).not.toContain('knownRegistrarKeys');

    const lib = fs.readFileSync(path.resolve('src/lib/registrarMatch.ts'), 'utf8');
    expect(lib).toContain("normalize('NFC')"); // body 하드닝 계승
    expect(lib).toContain("(sourceSystem ?? '').trim() !== 'dopamine'"); // AC-1 origin-gate
    expect(lib).not.toContain('buildKnownRegistrarKeys'); // REJECT 옵션 A 보조 제거
  });
});
