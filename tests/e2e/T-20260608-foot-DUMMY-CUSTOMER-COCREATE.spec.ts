/**
 * E2E spec — T-20260608-foot-DUMMY-CUSTOMER-COCREATE
 * 더미 예약 생성 단일 강제 지점(dummy_factory) 불변식 검증.
 *
 * 사고: 6/3·6/8 ad-hoc 더미가 reservations 만 만들고 customers 동시생성을 깜빡 →
 *       customer_id=NULL 적재 → 차트 미열림 + 정리 누락(orphan).
 * 재발방지: factory 게이트가 customer_id 없는 예약 생성을 구조적으로 차단한다.
 *
 * 본 spec 은 DB/브라우저 불필요한 순수 함수 불변식 검증 (게이트·dedup·NULL 가드).
 *
 * AC-1: buildReservationRow 는 customer_id 없으면 throw (게이트).
 * AC-2: customer_id 있으면 정상 행 생성 + is_simulation 마킹은 customer 측에 존재.
 * AC-3: assertNoNullCustomerLink 는 NULL 1건이라도 있으면 throw.
 * AC-4: 동일 phone 다건 예약은 customer 1건 공유(dedupeByPhone).
 * AC-5: 필수값(name/phone/date/time) 누락 시 normalizeDummyItem throw.
 */
import { test, expect } from '@playwright/test';
import {
  normalizeDummyItem,
  dedupeByPhone,
  buildCustomerRow,
  buildReservationRow,
  assertNoNullCustomerLink,
  // @ts-expect-error — JS 모듈(.mjs) 타입 선언 없음, 런타임 import 정상
} from '../../scripts/lib/dummy_factory.mjs';

const CLINIC = '00000000-0000-0000-0000-000000000001';
const base = { name: '사과', phone: '+821000003001', visitType: 'new', date: '2026-06-09', time: '11:00' };

test.describe('T-20260608 DUMMY-CUSTOMER-COCREATE — factory 불변식', () => {
  test('AC-1: customer_id 없으면 예약 행 생성 차단(게이트 throw)', () => {
    const item = normalizeDummyItem(base);
    expect(() => buildReservationRow(item, CLINIC, null)).toThrow(/GATE/);
    expect(() => buildReservationRow(item, CLINIC, undefined)).toThrow(/GATE/);
    expect(() => buildReservationRow(item, CLINIC, '')).toThrow(/GATE/);
  });

  test('AC-2: customer_id 있으면 정상 + customer 측 is_simulation=true', () => {
    const item = normalizeDummyItem(base);
    const cid = 'cust-123';
    const resv = buildReservationRow(item, CLINIC, cid);
    expect(resv.customer_id).toBe(cid);
    expect(resv.customer_name).toBe('사과');
    expect(resv.clinic_id).toBe(CLINIC);

    const cust = buildCustomerRow(item, CLINIC);
    expect(cust.is_simulation).toBe(true);
    expect(cust.phone).toBe('+821000003001');
    expect(cust.visit_type).toBe('new');
  });

  test('AC-3: assertNoNullCustomerLink — NULL 1건이라도 있으면 throw', () => {
    const ok = [{ customer_id: 'a', customer_name: 'x' }, { customer_id: 'b', customer_name: 'y' }];
    expect(assertNoNullCustomerLink(ok)).toBe(2);
    const bad = [{ customer_id: 'a', customer_name: 'x' }, { customer_id: null, customer_name: 'y' }];
    expect(() => assertNoNullCustomerLink(bad)).toThrow(/INVARIANT VIOLATION/);
  });

  test('AC-4: 동일 phone 다건은 customer 1건 공유(dedup)', () => {
    const items = [
      { ...base, time: '11:00' },
      { ...base, time: '14:00' }, // 같은 phone, 다른 슬롯
      { name: '딸기', phone: '+821000003002', visitType: 'new', date: '2026-06-09', time: '11:30' },
    ];
    const { uniquePhones, itemsByPhone } = dedupeByPhone(items);
    expect(uniquePhones.length).toBe(2);
    expect(itemsByPhone.get('+821000003001').length).toBe(2);
    expect(itemsByPhone.get('+821000003002').length).toBe(1);
  });

  test('AC-5: 필수값 누락 시 normalizeDummyItem throw', () => {
    expect(() => normalizeDummyItem({ ...base, name: '' })).toThrow(/name/);
    expect(() => normalizeDummyItem({ ...base, phone: '' })).toThrow(/phone/);
    expect(() => normalizeDummyItem({ ...base, date: null })).toThrow(/date/);
    expect(() => normalizeDummyItem({ ...base, time: null })).toThrow(/time/);
    expect(() => normalizeDummyItem({ ...base, visitType: 'bogus' })).toThrow(/visit_type/);
  });
});
