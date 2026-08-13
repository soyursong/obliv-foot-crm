import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  CBAND_REPRINT_REQUIRED_BODY_FIELDS,
  buildReceiptContent,
  buildReprintMsg,
  type ReceiptData,
} from '../../src/lib/cband/receiptReprint';

/**
 * T-20260813-foot-RECEIPT-REPRINT-TERMINAL1-LABEL-REMOVE
 *   부모 T-20260813-foot-PAYHIST-RECEIPT-REPRINT-TERMINAL1(deployed·field-soak) field-soak 정정.
 * ────────────────────────────────────────────────────────────────────────────
 * AC1: 영수증 재출력 버튼 라벨 `영수증 출력 (1번 단말기)` → `영수증 출력`.
 *   '1번 단말기' = 현장 표현 오해(선택지 ①번을 단말기 번호로 오독)에서 온 잘못된 개념.
 *   단말기에 "1번" 개념 자체가 없음 → 문구 완전 제거(툴팁/안내문/코드 문구 포함).
 * AC2: 재출력 명령이 특정 단말기번호/TID 에 하드코딩·라우팅되어 있지 않음(terminal-agnostic).
 *   벤더 XP 전표출력 body 필드 = DEVICE_TYPE/CAT_PORT/CAT_BAUDRATE/P_ECSPOS_CMD1 → TID 필드 부재.
 *   원거래 TID 는 '인쇄 내용'(표시)에만 실릴 뿐 라우팅 키가 아니다.
 * AC3: 이미 승인된 결제의 재발행(reprint) — 재결제/중복승인 유발 절대 금지(금전 무이동).
 */

const BUTTON_SRC = readFileSync(
  path.resolve(__dirname, '../../src/components/CbandPayInfoButton.tsx'),
  'utf-8',
);
const REPRINT_LIB_SRC = readFileSync(
  path.resolve(__dirname, '../../src/lib/cband/receiptReprint.ts'),
  'utf-8',
);

// ── AC1: 버튼 라벨에서 '(1번 단말기)' 완전 제거, `영수증 출력` 렌더 ──────────────
test('AC1 — 재출력 버튼 라벨은 `영수증 출력`(‘(1번 단말기)’ 부재)', () => {
  // 잘못된 개념 문구가 소스 어디에도 없어야 함(라벨·툴팁·안내문·주석 포함).
  expect(BUTTON_SRC).not.toContain('1번 단말기');
  expect(REPRINT_LIB_SRC).not.toContain('1번 단말기');
  // 실제 버튼 라벨 JSX 가 `영수증 출력` 로 렌더(‘영수증 출력 (…)’ 잔재 없음).
  expect(BUTTON_SRC).toContain('<Printer className="h-4 w-4" /> 영수증 출력</>');
  expect(BUTTON_SRC).not.toMatch(/영수증 출력\s*\(/);
});

// ── AC2: terminal-agnostic — 재출력 전문에 TID 라우팅 필드 없음 ───────────────
test('AC2 — 전표출력 body 는 프린터 4필드뿐, TID 라우팅 필드 부재(terminal-agnostic)', () => {
  const data: ReceiptData = {
    tranType: '0210', authNo: '30001234', amount: 150000, halbu: '03',
    cardNoMasked: '55318440****364*', cardName: '신한카드',
    tranDate: '260813', tranTime: '143005',
    tid: '1234567890', merno: '778899', msgTrace: '235112000001',
  };
  const content = buildReceiptContent(data);
  const { body } = buildReprintMsg({ content, catPort: 3 });

  // 필수 body 필드 = 프린터 4필드 전부, 그 외 없음(거래/TID 라우팅 필드 0).
  expect(Object.keys(body).sort()).toEqual([...CBAND_REPRINT_REQUIRED_BODY_FIELDS].sort());
  expect(body).not.toHaveProperty('TID');
  expect(body).not.toHaveProperty('CAT_TID');
  // 라우팅은 CAT_PORT(이 PC 로컬 시리얼) — 특정 단말기 번호 하드코딩 아님.
  expect(body.CAT_PORT).toBe('03');            // 입력 catPort=3 를 그대로 반영(하드코딩 상수 아님)
  const { body: body9 } = buildReprintMsg({ content, catPort: 9 });
  expect(body9.CAT_PORT).toBe('09');           // 입력에 따라 달라짐 = 하드코딩 라우팅 없음
});

// ── AC2 보강: 원거래 TID 는 '인쇄 내용'(표시)에만 실린다(라우팅 키 아님) ──────────
test('AC2 — 원거래 TID 는 인쇄 내용(표시)에만 실림, 라우팅 키 아님', () => {
  const data: ReceiptData = {
    tranType: '0210', authNo: '30001234', amount: 150000,
    tid: '1234567890', msgTrace: '235112000001',
  };
  const content = buildReceiptContent(data);
  const { body } = buildReprintMsg({ content, catPort: 3 });
  // TID 는 인쇄 내용(P_ECSPOS_CMD1)에만 존재.
  expect(body.P_ECSPOS_CMD1).toContain('1234567890');
  // 봉투(header/body 라우팅) 어디에도 TID 라우팅 필드로 실리지 않음.
  const { message } = buildReprintMsg({ content, catPort: 3 });
  const parsed = JSON.parse(message);
  expect(parsed.body).not.toHaveProperty('TID');
});

// ── AC3(불변식): 재발행은 금전 무이동 — 결제/승인/취소 요청필드 부재 ──────────────
test('AC3 — 재출력 전문에 결제/승인/취소 요청필드 부재(재결제·중복승인 불가)', () => {
  const data: ReceiptData = {
    tranType: '0210', authNo: '30001234', amount: 150000, msgTrace: '235112000001',
  };
  const content = buildReceiptContent(data);
  const { body } = buildReprintMsg({ content, catPort: 3 });
  expect(body).not.toHaveProperty('TRANTYPE');
  expect(body).not.toHaveProperty('TAMT');
  expect(body).not.toHaveProperty('ORI_AUTHNO');
  expect(body).not.toHaveProperty('CAT_TERMINAL_RECEIPT');
});
