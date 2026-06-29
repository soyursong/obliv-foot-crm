/**
 * E2E Spec — T-20260629-foot-BILLDETAIL-RRN-ADD
 *
 * 진료비 세부산정내역(bill_detail) 상단 환자 기본정보 영역에 주민등록번호(RRN) 컬럼 추가.
 *
 * 배경(김주연 총괄, B안 확정):
 *   부모 T-20260629-foot-DOCPRINT-RRN-OMIT-RECUR 에서 NHIS 표준상 bill_detail 은 RRN 미표기가
 *   정상(dev-foot 진단)이나, 총괄이 A(미표기)/B(표기) 중 B 를 명시 결정(policy_superseded).
 *   → bill_detail 환자정보표에 '주민등록번호' 라벨 + {{patient_rrn}} 셀 추가.
 *
 * 핵심: 신규 복호 경로·RPC 를 만들지 않는다. 타 11종 양식이 쓰는 동일 {{patient_rrn}} 바인딩 컨텍스트
 *   (loadAutoBindContext → rrn_decrypt RPC[6역할 PHI 게이트 + phi_access_log audit] → buildAutoBindValues)
 *   를 그대로 재사용. 본 spec 은 그 바인딩·렌더 경로(buildAutoBindValues → bindHtmlTemplate)를
 *   순수 단위로 단언한다(실서버 불필요 — PHI 게이트/audit 은 rrn_decrypt RPC 가 DB 레벨에서 강제).
 *
 * AC:
 *  - AC-1: bill_detail 템플릿 헤더에 '주민등록번호' 라벨 + {{patient_rrn}} 셀이 존재한다.
 *  - AC-2: 동일 {{patient_rrn}} 바인딩 컨텍스트(buildAutoBindValues) 가 customer.rrn → patient_rrn
 *          (하이픈 포맷, 마스킹 없음)으로 매핑하고, 바인딩 후 출력물에 RRN 이 표기된다.
 *  - AC-4: 주민번호 미등록(customer.rrn=null) → RRN 칸 빈칸(에러 없이) 정상.
 *  - AC-5(회귀): bill_detail 항목 테이블 헤더/타 양식의 {{patient_rrn}} 바인딩에 영향 0.
 *
 * 실행: npx playwright test T-20260629-foot-BILLDETAIL-RRN-ADD.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

// buildAutoBindValues 가 실제로 읽는 필드만 채운 최소 CheckIn(나머지는 미사용).
const checkIn = {
  customer_id: 'bd814f22',
  customer_name: '박민석',
  customer_phone: '01012345678',
  checked_in_at: '2026-06-29T01:00:00.000Z',
} as unknown as CheckIn;

test.describe('bill_detail 주민등록번호 컬럼 추가 (B안, {{patient_rrn}} 컨텍스트 재사용)', () => {
  test('AC-1: 템플릿 헤더에 주민등록번호 라벨 + {{patient_rrn}} 셀 존재', () => {
    const tpl = getHtmlTemplate('bill_detail');
    expect(tpl).not.toBeNull();
    expect(tpl!).toContain('주민등록번호');
    // 환자정보표 본문에 {{patient_rrn}} 플레이스홀더 주입됨(타 11종과 동일 바인딩 키)
    expect(tpl!).toContain('{{patient_rrn}}');
  });

  test('AC-2: 동일 바인딩 컨텍스트 → customer.rrn 하이픈 포맷 + 출력물 표기', () => {
    // rrn_decrypt RPC 가 복호한 평문(13자리)을 ctx.customer.rrn 으로 전달하는 형상 재현
    const values = buildAutoBindValues({
      checkIn,
      customer: { name: '박민석', phone: '01012345678', rrn: '9005151234567' },
    });

    // 신규 복호 경로 없음 — 기존 patient_rrn 키로 매핑(formatRrn 하이픈 삽입, 마스킹 없음)
    expect(values.patient_rrn).toBe('900515-1234567');

    const tpl = getHtmlTemplate('bill_detail')!;
    const html = bindHtmlTemplate(tpl, values);
    expect(html).toContain('900515-1234567');
    // 플레이스홀더가 잔존하지 않고 치환됨
    expect(html).not.toContain('{{patient_rrn}}');
  });

  test('AC-4: 주민번호 미등록(rrn=null) → RRN 칸 빈칸, 에러 없음', () => {
    const values = buildAutoBindValues({
      checkIn,
      customer: { name: '박민석', phone: '01012345678', rrn: null },
    });
    expect(values.patient_rrn).toBe('');

    const tpl = getHtmlTemplate('bill_detail')!;
    // 바인딩이 throw 없이 완료되고, 플레이스홀더는 빈 문자열로 치환
    const html = bindHtmlTemplate(tpl, values);
    expect(html).not.toContain('{{patient_rrn}}');
    // 환자성명은 그대로 표기(다른 셀 무회귀)
    expect(html).toContain('박민석');
  });

  test('AC-5(회귀): bill_detail 항목 테이블 헤더 + 환자정보 기존 컬럼 무회귀', () => {
    const tpl = getHtmlTemplate('bill_detail')!;
    // 환자정보표 기존 컬럼 유지
    for (const label of ['환자등록번호', '환자성명', '진료기간', '병실', '환자구분', '비고']) {
      expect(tpl).toContain(label);
    }
    // 항목 테이블 핵심 헤더 유지(레이아웃 무회귀)
    for (const label of ['항목', '명칭', '금액', '총액', '급여', '비급여']) {
      expect(tpl).toContain(label);
    }
  });

  test('AC-5(회귀): 타 양식의 {{patient_rrn}} 바인딩 무회귀', () => {
    // 동일 바인딩 키를 쓰는 대표 타 양식들에 {{patient_rrn}} 가 그대로 존재
    for (const key of ['payment_cert', 'diagnosis', 'diag_opinion_v2']) {
      const tpl = getHtmlTemplate(key);
      expect(tpl, `${key} 템플릿 존재`).not.toBeNull();
      expect(tpl!, `${key} {{patient_rrn}} 유지`).toContain('{{patient_rrn}}');
    }
  });
});
