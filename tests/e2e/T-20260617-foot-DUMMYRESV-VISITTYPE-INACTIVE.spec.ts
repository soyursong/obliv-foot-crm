/**
 * E2E spec — T-20260617-foot-DUMMYRESV-VISITTYPE-INACTIVE
 * 더미 예약 생성 시 reservation.visit_type 을 고객(customers.visit_type) SSOT 에서 파생.
 *
 * 버그: phone UNIQUE 로 재사용된 returning 고객에 입력 item 기본값('new')이 박혀
 *       reservation.visit_type='new' + 미체크인 → 초진 비활성 Box 로 들어가는 분기 오작동.
 * 수정: resolveVisitType() 이 기존 고객이 있으면 그 visit_type 을 권위로 삼아
 *       reservation.visit_type === customers.visit_type 불변식을 강제한다.
 *
 * 본 spec 은 DB/브라우저 불필요한 순수 함수 불변식 검증.
 *
 * AC-1: 기존 returning 고객 → item 이 'new' 여도 resolved='returning'.
 * AC-2: 기존 new 고객 → item 이 'returning' 이어도 resolved='new'.
 * AC-3: 기존 고객 없음 → item.visitType 그대로 사용(신규 더미 경로).
 * AC-4: 기존 고객 visit_type 이 비정상/누락 → item.visitType 으로 폴백.
 * AC-5: 보정된 item 으로 빌드한 reservation.visit_type === customer.visit_type (불변식).
 */
import { test, expect } from '@playwright/test';
import {
  normalizeDummyItem,
  resolveVisitType,
  buildCustomerRow,
  buildReservationRow,
  // @ts-expect-error — JS 모듈(.mjs) 타입 선언 없음, 런타임 import 정상
} from '../../scripts/lib/dummy_factory.mjs';

const CLINIC = '00000000-0000-0000-0000-000000000001';
const newItem = normalizeDummyItem({
  name: '힐러1', phone: '+821000004101', visitType: 'new', date: '2026-06-17', time: '14:30',
});

test.describe('T-20260617 DUMMYRESV-VISITTYPE-INACTIVE — visit_type SSOT 파생', () => {
  test('AC-1: 기존 returning 고객이면 item=new 여도 returning 으로 보정', () => {
    expect(resolveVisitType(newItem, { visit_type: 'returning' })).toBe('returning');
  });

  test('AC-2: 기존 new 고객이면 item=returning 이어도 new 로 보정', () => {
    const retItem = normalizeDummyItem({ ...newItem, visitType: 'returning' });
    expect(resolveVisitType(retItem, { visit_type: 'new' })).toBe('new');
  });

  test('AC-3: 기존 고객 없으면(신규) item.visitType 그대로', () => {
    expect(resolveVisitType(newItem, null)).toBe('new');
    expect(resolveVisitType(newItem, undefined)).toBe('new');
    const retItem = normalizeDummyItem({ ...newItem, visitType: 'returning' });
    expect(resolveVisitType(retItem, null)).toBe('returning');
  });

  test('AC-4: 기존 고객 visit_type 비정상/누락 시 item 으로 폴백', () => {
    expect(resolveVisitType(newItem, { visit_type: null })).toBe('new');
    expect(resolveVisitType(newItem, { visit_type: 'bogus' })).toBe('new');
    expect(resolveVisitType(newItem, {})).toBe('new');
  });

  test('AC-5: 보정 후 reservation.visit_type === customer.visit_type (불변식)', () => {
    // 재사용된 returning 고객 시나리오: item 은 new 로 들어왔지만 SSOT 정렬되어야 함
    const resolved = resolveVisitType(newItem, { visit_type: 'returning' });
    const aligned = { ...newItem, visitType: resolved };
    const cust = buildCustomerRow(aligned, CLINIC);
    const resv = buildReservationRow(aligned, CLINIC, 'cust-healer1');
    expect(cust.visit_type).toBe('returning');
    expect(resv.visit_type).toBe('returning');
    expect(resv.visit_type).toBe(cust.visit_type);
  });
});
