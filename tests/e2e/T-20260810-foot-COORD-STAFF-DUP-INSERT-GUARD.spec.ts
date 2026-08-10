/**
 * T-20260810-foot-COORD-STAFF-DUP-INSERT-GUARD — 활성 coordinator 중복 등록 forward-guard 술어 검증
 *
 * 부모: T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP (강다연·이진석 2중 표시 소급 정정).
 * 본건: 재발원(동일 identity active coordinator 중복 staff INSERT) forward 차단.
 * DA SSOT: agents/docs/da_replies/da_decision_foot_registrar_dup_staff_identity_dedup_20260810.md §3/§4.
 *
 * canonical 다축 술어: within-clinic + (phone[강한 축] 또는 legal_name[강한 축]).
 *   · foot staff census(2026-08-10 prod): legal_name 컬럼 부재 · phone 100% null(폼 미캡처) → 강한 축 = phone.
 *   · name = 약한 축(display) → 하드 차단 금지(동명이인 오차단 방지) → WARN 만.
 *
 * mechanism = app-level(순수 코드) → db_change=false (census 기반 강등, AC-2 provision).
 *   호출부(Staff.tsx CreateStaffDialog)가 같은 clinic_id · role='coordinator' · active=true 로 스코프한 뒤
 *   evaluateCoordinatorDup 로 판정. 이 spec 은 그 술어의 순수 로직 검증(page/auth/server 불요).
 *
 * AC-3 검증축:
 *   (A) 가드 트립 재현 — 같은 clinic 동일 identity active coordinator 재등록 → block/warn.
 *   (B) 정당 INSERT 무회귀 — 재입사(비활성)·진성 동명이인(다른 phone)·2지점 seed(다른 clinic) false-block 금지.
 *   (C) 8쌍 2지점 seed carve — 다른 clinic_id 동명 = 정당 multi-tenant → 발화 금지.
 */
import { test, expect } from '@playwright/test';
import { evaluateCoordinatorDup, type CoordIdentity } from '../../src/lib/coordinatorDupGuard';

// 호출부는 항상 "같은 clinic_id 의 활성 coordinator" 만 existingActiveCoords 로 전달한다(스코프 완료 전제).
// 따라서 이 spec 의 existing 배열 = within-clinic·active·coordinator 로 이미 필터된 집합.

test.describe('coordinator dup guard — canonical 다축 술어', () => {
  // ── (A) 가드 트립 재현 ──────────────────────────────────────────
  test('A1: 동명(약한 축) 활성 coordinator 존재 → WARN (하드 차단 아님)', () => {
    const existing: CoordIdentity[] = [{ id: 'existing-1', name: '강다연', phone: null }];
    const v = evaluateCoordinatorDup({ name: '강다연', phone: null }, existing);
    expect(v.kind).toBe('warn');
    if (v.kind === 'warn') {
      expect(v.axis).toBe('name'); // name-string 은 차단 아닌 경고 축
      expect(v.match.id).toBe('existing-1');
    }
  });

  test('A2: NFC/NFD·공백 정규화 후 동명 매칭 → WARN', () => {
    // 조합형(NFD) vs 완성형(NFC) 한글 + 앞뒤 공백 → 같은 사람으로 매칭.
    const existing: CoordIdentity[] = [{ id: 'e2', name: '강다연'.normalize('NFD'), phone: null }];
    const v = evaluateCoordinatorDup({ name: '  강다연  '.normalize('NFC'), phone: null }, existing);
    expect(v.kind).toBe('warn');
  });

  test('A3: 강한 축(phone) 일치 → 하드 BLOCK', () => {
    const existing: CoordIdentity[] = [{ id: 'e3', name: '강다연', phone: '5550001111' }];
    // 동명이 아니어도(오타 등) phone 일치면 진성 재등록 → 하드 차단.
    const v = evaluateCoordinatorDup({ name: '강다현', phone: '5550001111' }, existing);
    expect(v.kind).toBe('block');
    if (v.kind === 'block') expect(v.axis).toBe('phone');
  });

  // ── (B) 정당 INSERT 무회귀 ──────────────────────────────────────
  test('B1: 재입사(비활성 레코드) → 호출부가 active 만 전달 → 매칭 대상 없음 → clear', () => {
    // 비활성 레코드는 existingActiveCoords 에 포함되지 않음(호출부 .eq(active,true)).
    const existingActiveOnly: CoordIdentity[] = []; // 과거 강다연은 active=false → 여기 없음
    const v = evaluateCoordinatorDup({ name: '강다연', phone: null }, existingActiveOnly);
    expect(v.kind).toBe('clear');
  });

  test('B2: 진성 동명이인(같은 이름·다른 phone) → phone 상이 → WARN(오버라이드 가능), 하드 차단 아님', () => {
    const existing: CoordIdentity[] = [{ id: 'e-b2', name: '이진석', phone: '5550002222' }];
    const v = evaluateCoordinatorDup({ name: '이진석', phone: '5550003333' }, existing);
    // phone 이 다르므로 강한 축 BLOCK 아님. 이름만 같으니 WARN → 관리자 오버라이드로 등록 가능(false-block 0).
    expect(v.kind).toBe('warn');
    if (v.kind === 'warn') expect(v.axis).toBe('name');
  });

  test('B2b: 동명이인이고 폼에 phone 미입력(둘 다 null) → WARN(오버라이드 가능)', () => {
    const existing: CoordIdentity[] = [{ id: 'e-b2b', name: '이진석', phone: null }];
    const v = evaluateCoordinatorDup({ name: '이진석', phone: null }, existing);
    expect(v.kind).toBe('warn'); // 하드 차단 아님 → 오버라이드로 등록 가능
  });

  test('B3: 2지점 seed(다른 clinic_id) → 호출부가 within-clinic 스코프 → 비교대상 없음 → clear', () => {
    // 다른 clinic 의 동명 coordinator 는 existingActiveCoords(within-clinic) 에 애초에 없음.
    const withinClinicActive: CoordIdentity[] = []; // 송도점 김민경은 종로점 스코프에 미포함
    const v = evaluateCoordinatorDup({ name: '김민경', phone: null }, withinClinicActive);
    expect(v.kind).toBe('clear');
  });

  // ── (C) 8쌍 carve (cross-clinic 동명 multi-tenant) ──────────────
  test('C1: 8쌍 carve — cross-clinic 동명은 within-clinic 스코프에서 배제되어 발화 0', () => {
    const CARVE = ['김민경', '김지혜', '박민석', '장예지', '김효신', '문해민', '이수빈', '진운선'];
    for (const nm of CARVE) {
      // 종로점 등록 시 송도점 동명은 within-clinic existing 에 없음 → clear.
      expect(evaluateCoordinatorDup({ name: nm, phone: null }, []).kind).toBe('clear');
    }
  });

  // ── (D) 기타 무회귀 ────────────────────────────────────────────
  test('D1: 완전 신규(동명·동phone 없음) → clear', () => {
    const existing: CoordIdentity[] = [{ id: 'x', name: '박코디', phone: '5550004444' }];
    expect(evaluateCoordinatorDup({ name: '신규코디', phone: null }, existing).kind).toBe('clear');
  });

  test('D2: 자기 자신(id 동일)은 매칭 제외 (idempotent 재판정 안전)', () => {
    const existing: CoordIdentity[] = [{ id: 'self', name: '강다연', phone: '5550001111' }];
    expect(evaluateCoordinatorDup({ id: 'self', name: '강다연', phone: '5550001111' }, existing).kind).toBe('clear');
  });
});
