/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED
 * 치료테이블에서 진료의(담당 의사) 지정 후 서류 출력 시 그 의사 정보가 서류에 미반영(연동 끊김).
 *
 * RC (진단 결과, 저장 O · 렌더 전달 X):
 *   치료테이블 '진료의' 선택은 check_ins.treating_doctor_id(=clinic_doctors.id)에 저장되나
 *   (TreatingDoctorSelect → 진료콜 명단·진료환자이력 공용 write), 서류 렌더 경로
 *   (loadAutoBindContext / DocumentPrintPanel)는 이 필드를 전혀 읽지 않고 duty_roster/fallback
 *   director로만 진료의를 결정 → 지정 의사가 서류에 안 나옴(처음부터 결선 누락, 100% 재현).
 * 수정: loadAutoBindContext가 check_ins.treating_doctor_id를 읽어 진료의(이름+면허/직인)를 결정
 *   (우선순위: 명시 override > 치료테이블 지정 진료의 > duty_roster > fallback). DocumentPrintPanel
 *   드롭다운 기본 선택도 지정 진료의로. loadTreatingDoctorName 헬퍼 신설.
 *
 * 검증 전략: DB/auth 없이 (1) buildAutoBindValues 순수 함수의 진료의 바인딩 계약 + (2) 실제 브라우저
 *   HTML 렌더(page.setContent)로 "현장이 보는 출력물"에 진료의 이름이 실제로 찍히는지 확인.
 *   (treating_doctor_id → doctor 결정 로직은 loadAutoBindContext 내부 DB 조회 — 여기서는 결정된
 *    doctor가 출력에 도달하는 '렌더 전달' 축을 검증. 결선 축은 코드 + 진단으로 확인.)
 *
 * AC-1: 진료의 지정 후 서류 출력 시 그 진료의 이름(+ 면허/직인 정보)이 정확히 표시된다.
 * AC-2: 진료의 미지정 시 서류 출력(공란/기본값)은 회귀 없이 유지된다(에러 없음).
 * AC-3: RC 명시 + 서류 렌더 스택 공유 티켓(RRN-OMIT)에 회귀 없음(patient_rrn 바인딩 불변).
 *
 * 관련 락: L-006 (DOC-PRINT-UNIFY) — bindHtmlTemplate 단일 경로 유지(무변경).
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

/** 최소 CheckIn (buildAutoBindValues가 읽는 필드만) */
const baseCheckIn = (): CheckIn => ({
  id: 'ci-test-0001',
  clinic_id: 'clinic-test',
  customer_id: 'cust-0001',
  customer_name: '홍길동',
  customer_phone: '01012345678',
  checked_in_at: '2026-07-13T09:00:00+09:00',
} as unknown as CheckIn);

/** 템플릿을 바인딩해 한 페이지로 렌더 후 본문 텍스트 반환 */
async function renderBound(
  page: import('@playwright/test').Page,
  formKey: string,
  values: Record<string, string>,
): Promise<string> {
  const tpl = getHtmlTemplate(formKey);
  expect(tpl, `${formKey} 템플릿 존재`).toBeTruthy();
  const html = bindHtmlTemplate(tpl as string, values);
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  return (await page.locator('body').innerText()).replace(/ /g, ' ');
}

test.describe('T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED — 지정 진료의 서류 반영', () => {
  // ── AC-1: 결정된 진료의(ctx.doctor)가 모든 진료의 플레이스홀더로 흐른다 ──
  test('AC-1: buildAutoBindValues가 진료의를 doctor_name·referring_doctor에 바인딩한다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은', // ← 치료테이블 지정 진료의가 loadAutoBindContext에서 여기로 결정됨
    });
    expect(v.doctor_name).toBe('문지은');
    // 진료의뢰서 등 다른 진료의 플레이스홀더에도 동일 반영
    expect(v.referring_doctor).toBe('문지은');
  });

  // ── AC-1: 지정 진료의의 상세(면허번호·전문의번호·직인)도 서류에 흐른다 ──
  test('AC-1: 지정 진료의의 clinic_doctors 상세(면허/직인)가 바인딩된다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은',
      clinicDoctor: {
        name: '문지은',
        license_no: '제12345호',
        specialist_no: '제999호',
        seal_image_url: 'https://example.test/seal.png',
      },
    });
    expect(v.doctor_name).toBe('문지은');
    expect(v.doctor_license_no).toBe('제12345호');
    expect(v.doctor_specialist_no).toBe('제999호');
    // 직인: seal_image_url 있으면 img 태그로 렌더(텍스트 (인) fallback 아님)
    expect(v.doctor_seal_html).toContain('https://example.test/seal.png');
    expect(v.doctor_seal_html).toContain('<img');
  });

  // ── AC-1 (렌더): 진단서 출력물에 지정 진료의 이름이 실제로 찍힌다 ──
  test('AC-1: 진단서 출력물에 지정 진료의 이름이 렌더된다', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은',
    });
    const body = await renderBound(page, 'diagnosis', v);
    expect(body).toContain('문지은');
  });

  // ── AC-2: 진료의 미지정 시 공란 — 에러/이상 문자열 없음(회귀 방지) ──
  test('AC-2: 진료의 미지정(null) 시 doctor_name 공란·크래시 없음', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: null, // 미지정 → 공란(기존 동작 유지)
    });
    expect(v.doctor_name).toBe('');
    expect(v.referring_doctor).toBe('');
    // 미지정이어도 직인은 SEAL-NULL-FALLBACK(로컬자산/(인)) 유지 — 렌더 크래시 없음
    const body = await renderBound(page, 'diagnosis', v);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });

  // ── AC-3: 서류 렌더 스택 공유(RRN-OMIT) 무회귀 — patient_rrn 바인딩 불변 ──
  test('AC-3: 진료의 결선 수정이 RRN 바인딩(공유 렌더 스택)에 회귀를 유발하지 않는다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678', rrn: '9005151234567' },
      doctor: '문지은',
    });
    // 진료의 반영과 무관하게 주민번호 바인딩(하이픈 삽입)은 그대로
    expect(v.patient_rrn).toBe('900515-1234567');
    expect(v.rrn_front).toBe('900515');
    expect(v.rrn_back).toBe('1234567');
    // 진료의도 함께 정상
    expect(v.doctor_name).toBe('문지은');
  });

  // ── AC-8 (2차 신고 yy98): 진료비 세부산정내역 "대표자"란에 지정 진료의명 렌더(공란 아님) ──
  test('AC-8: 진료비 세부산정내역(bill_detail) "대표자"란에 지정 진료의명이 찍힌다', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '한동훈', // 치료테이블 지정 진료의 → loadAutoBindContext에서 결정
    });
    const body = await renderBound(page, 'bill_detail', v);
    // "대 표 자" 라벨 인접에 진료의명이 실제로 출력(공란 회귀 아님)
    expect(body).toContain('대 표 자');
    expect(body).toContain('한동훈');
  });

  // ── AC-9 (2차 신고 yy98): 진료비 계산서·영수증 "진료의사"란에 지정 진료의명 렌더(공란 아님) ──
  test('AC-9: 진료비 계산서·영수증(bill_receipt) "진료의사"란에 지정 진료의명이 찍힌다', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '김상은',
    });
    const body = await renderBound(page, 'bill_receipt', v);
    expect(body).toContain('진료의사');
    expect(body).toContain('김상은');
  });

  // ── AC-10 (2차 신고 yy98): "공란" RC — doctor_name 바인딩이 두 서식 필드에 실제 도달 ──
  //   preselect(loadAutoBindContext)로 결정된 doctor_name이 {{doctor_name}} 플레이스홀더로
  //   흐르며, 두 서식 모두 별도 필드바인딩 누락 없이 동일 값을 소비함을 검증.
  test('AC-10: 두 서식({{doctor_name}}) 바인딩 일치 — preselect 값이 공란 없이 도달', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '김윤기',
    });
    for (const key of ['bill_detail', 'bill_receipt']) {
      const body = await renderBound(page, key, v);
      expect(body, `${key}에 진료의명`).toContain('김윤기');
    }
    // 미지정 시 두 서식 모두 공란·크래시 없음(회귀 폴백)
    const empty = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: null,
    });
    for (const key of ['bill_detail', 'bill_receipt']) {
      const body = await renderBound(page, key, empty);
      expect(body).not.toContain('undefined');
      expect(body).not.toContain('null');
    }
  });

  // ── AC-5 (도장): 지정 진료의의 도장(seal_image_url)이 {{doctor_seal_html}}로 흐르고 서류에 렌더 ──
  test('AC-5: 지정 진료의 도장이 서류(bill_detail/bill_receipt/diagnosis)에 img로 렌더된다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '한동훈',
      clinicDoctor: {
        name: '한동훈',
        license_no: '제10001호',
        specialist_no: null,
        seal_image_url: 'https://example.test/seal-hdh.png', // 한동훈 1:1 매핑 도장(signed URL 자리)
      },
    });
    // 결정된 진료의의 도장만 흐름(오매핑 0) — 이름·도장 동일 원장에서 파생
    expect(v.doctor_seal_html).toContain('https://example.test/seal-hdh.png');
    for (const key of ['bill_detail', 'bill_receipt', 'diagnosis']) {
      const tpl = getHtmlTemplate(key) as string;
      const html = bindHtmlTemplate(tpl, v);
      expect(html, `${key}에 도장 img`).toContain('https://example.test/seal-hdh.png');
    }
  });

  // ── AC-6 (도장): 진료의 미지정 시 특정 원장 도장 미출력(엉뚱한 원장 도장 금지) ──
  test('AC-6: 진료의 미지정 시 특정 원장 storage seal이 출력되지 않는다(폴백만)', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: null, // 미지정 → clinicDoctor 없음 → 특정 원장 도장 없음
    });
    // 특정 원장 storage seal(seals/ path·signed URL)이 아님 — SEAL-NULL-FALLBACK(로컬자산/(인))만 허용
    expect(v.doctor_seal_html).not.toContain('/seals/');
    expect(v.doctor_seal_html).not.toContain('supabase.co/storage');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REOPEN (field-soak FAIL) — 현장 지배 경로: 치료테이블 미지정 + 복수 근무일
  //   RC(라이브 재현): 결제창(PATH-4)은 override 미전달(undefined)이라 진료의 선택 UI가 없다.
  //   지정 진료의 없음(174건 중 8건만 지정) + 복수 근무(당일 3명)면 doctorName=null로 떨어져
  //   세부산정내역서 '대표자'·계산서·영수증 '진료의사'가 공란 발행되고(❶), 도장도 대표원장 seal_null
  //   폴백으로 붉은 인장이 안 찍혔다(❂). 수정: 자동 경로에서 요양기관 대표(is_default clinic_doctor
  //   = 대표원장)로 이름·직인을 항상 채운다. 표기 이름↔도장 동일 원장 1:1(오매핑 0).
  //   ⚠ loadAutoBindContext의 duty>1 분기는 DB 의존 — 아래는 "대표원장으로 결정된 후 두 서식에
  //   이름·도장이 도달하는" 렌더 전달 축 계약. 결선(duty>1→대표원장) 축은 코드 + 라이브렌더 실측으로 확인.
  // ══════════════════════════════════════════════════════════════════════════
  test('REOPEN AC-R1: 대표원장 폴백 시 두 서식(대표자/진료의사) 이름 비공란 + 대표원장 도장', () => {
    const REP_SEAL = 'https://rxlomoozakkjesdqjtvd.supabase.co/storage/v1/object/sign/documents/seals/x/mje.png';
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '김지윤', phone: '01099998888' },
      doctor: '문지은', // 자동 경로 폴백으로 결정된 대표원장
      clinicDoctor: {
        name: '문지은',
        license_no: '제20001호',
        specialist_no: null,
        seal_image_url: REP_SEAL, // 대표원장 1:1 매핑 도장(signed URL 자리)
      },
    });
    // ❶ 이름 비공란
    expect(v.doctor_name).toBe('문지은');
    // ❂ 대표원장 도장 img (표기 이름과 동일 원장 — 오매핑 0)
    expect(v.doctor_seal_html).toContain(REP_SEAL);
    // 두 서식 모두 대표자/진료의사 자리에 이름 + 도장 렌더
    for (const key of ['bill_detail', 'bill_receipt']) {
      const html = bindHtmlTemplate(getHtmlTemplate(key) as string, v);
      expect(html, `${key} 이름 비공란`).toContain('문지은');
      expect(html, `${key} 도장 img`).toContain(REP_SEAL);
    }
  });

  // 회귀: 지정 진료의가 있으면 대표원장 폴백이 아니라 지정 진료의가 유지(무영향)
  test('REOPEN AC-R2: 지정 진료의가 있으면 폴백 없이 지정 진료의 유지', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '엄경은', phone: '01011112222' },
      doctor: '한동훈',
      clinicDoctor: { name: '한동훈', license_no: '제10001호', specialist_no: null, seal_image_url: 'https://x/hdh.png' },
    });
    expect(v.doctor_name).toBe('한동훈');
    expect(v.doctor_seal_html).toContain('https://x/hdh.png');
  });
});
