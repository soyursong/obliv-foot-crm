/**
 * T-20260629-foot-SMS-TEMPLATE-NEWDRAFT-ADD
 * 문자 발송 모달 "템플릿 선택" 드롭다운에 "새로 작성하기" 옵션 추가 — 선택 시 빈 본문 편집기로 즉석 작성·발송.
 *
 * 구현: BLANK_DRAFT_ID('__new_draft__') sentinel 옵션 추가 → handleSelect 에서 빈 본문 진입.
 *       기존 솔라피 발송 경로(send-notification manual_send) 재사용, 원본 템플릿 목록 불변.
 *
 * NO-DDL: notification_templates 무변경(가상 옵션은 DB 미적재). 1회성 자유 작성만 추가.
 *
 * 검증(소스 권위):
 *  AC-1(옵션 노출): 드롭다운에 "새로 작성하기" 옵션 존재.
 *  AC-2(빈 본문): 선택 시 setBody('') 로 빈 편집기 진입.
 *  AC-3(회귀): 기존 T01~T04 템플릿 선택→renderTemplate 채움, 발송 body.trim() 경로 불변.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve('src/components/SendSmsDialog.tsx'), 'utf-8');

test.describe('S1: "새로 작성하기" 옵션 노출 (AC-1)', () => {
  test('S1-1: BLANK_DRAFT_ID sentinel 정의 + 드롭다운 옵션 존재', () => {
    expect(SRC, 'BLANK_DRAFT_ID sentinel 정의 누락').toContain("const BLANK_DRAFT_ID = '__new_draft__'");
    expect(SRC, '드롭다운 옵션 누락').toContain('<option value={BLANK_DRAFT_ID}>+ 새로 작성하기</option>');
  });

  test('S1-2: 기존 placeholder 옵션 보존(회귀 가드)', () => {
    expect(SRC).toContain('<option value="">— 템플릿을 선택하세요 —</option>');
  });
});

test.describe('S2: 빈 본문 편집기 진입 (AC-2)', () => {
  test('S2-1: handleSelect 가 BLANK_DRAFT_ID 선택 시 빈 본문으로 진입', () => {
    expect(SRC, '빈 본문 진입 분기 누락').toContain('if (id === BLANK_DRAFT_ID)');
    // 빈 본문 + 즉석 첨부 없으면 이미지 정리 후 조기 반환
    expect(SRC).toMatch(/if \(id === BLANK_DRAFT_ID\) \{\s*setBody\(''\);/);
  });

  test('S2-2: 본문 편집기 노출 조건(selectedId !== "")이 blank 도 포함', () => {
    // '__new_draft__' !== '' 이므로 본문 textarea 가 노출됨 — 조건 자체는 그대로 사용
    expect(SRC).toContain("selectedId !== '' && (");
    expect(SRC).toContain('data-testid="sms-body-textarea"');
  });
});

test.describe('S3: 회귀 가드 (AC-3) — 기존 템플릿/발송 경로 불변', () => {
  test('S3-1: 일반 템플릿 선택은 renderTemplate 로 본문 채움(불변)', () => {
    expect(SRC).toContain('const tmpl = templates.find((t) => t.id === id);');
    expect(SRC).toContain('if (tmpl) setBody(renderTemplate(tmpl.body, vars));');
  });

  test('S3-2: 발송은 body.trim() + manual_send 경로 그대로(blank 도 동일 경로)', () => {
    expect(SRC).toContain("_action: 'manual_send'");
    expect(SRC).toContain('body: body.trim(),');
  });

  test('S3-3: 발송 가능 조건은 본문 비어있지 않을 때만(blank 빈 발송 차단)', () => {
    expect(SRC).toContain("body.trim().length > 0 && selectedId !== ''");
  });
});
