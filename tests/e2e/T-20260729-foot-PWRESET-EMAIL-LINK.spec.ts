/**
 * E2E / contract spec — T-20260729-foot-PWRESET-EMAIL-LINK-BLOCKED-DANGEROUS (P1)
 *
 * 배경: 비번재설정 메일의 '비밀번호 재설정'이 클릭 불가 단순 텍스트로 렌더(현장 스샷 F0BLA8KREFM).
 * 진단: H2(anchor 미포함)=DISCONFIRMED — 원본 recovery template 도 이미 anchor 보유.
 *        실 증상 RC = 수신측 클라이언트 text/plain 렌더 / 링크 flatten.
 * 방어: recovery template 하드닝 — (1) anchor 버튼 유지 + (2) 원본 URL 가시 fallback + (3) Korean.
 *
 * 이 spec 은 prod(rxlomoozakkjesdqjtvd) recovery template 불변식을 회귀 가드한다:
 *   [G1] {{ .ConfirmationURL }} 이 <a href> anchor 로 감싸져 있다 (클릭 가능 링크).
 *   [G2] {{ .ConfirmationURL }} 이 '눈에 보이는 텍스트'로도 노출된다 (flatten/text-only 클라이언트 복사용).
 *   [G3] 제목/본문이 Korean.
 *
 * FE 렌더가 아닌 Supabase Auth 메일러 config 검증이라 Playwright request 컨텍스트로 Management API 조회.
 * SUPABASE_ACCESS_TOKEN 미설정 환경(로컬/CI 시크릿 부재)에서는 skip (config-gated).
 */
import { test, expect, request } from '@playwright/test';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

test.describe('T-20260729 PWRESET-EMAIL-LINK — recovery template 불변식', () => {
  test.skip(!TOKEN, 'SUPABASE_ACCESS_TOKEN 미설정 — Management API config 검증 skip');

  test('recovery 메일 template: anchor + 가시 URL fallback + Korean', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'obliv-foot-crm-e2e/1.0' },
    });
    expect(res.status(), 'Management API GET auth config').toBe(200);
    const cfg = await res.json();
    const content: string = cfg.mailer_templates_recovery_content ?? '';
    const subject: string = cfg.mailer_subjects_recovery ?? '';

    // [G1] anchor 로 감싼 클릭 가능 링크
    expect(content, 'G1 anchor <a href="{{ .ConfirmationURL }}">').toContain('<a href="{{ .ConfirmationURL }}"');
    // [G2] 원본 URL 가시 fallback (라벨 == URL) — text/plain·flatten 클라이언트 복사용
    expect(content, 'G2 visible URL fallback >{{ .ConfirmationURL }}</a>').toContain('>{{ .ConfirmationURL }}</a>');
    // [G3] Korean 로컬라이즈
    expect(content, 'G3 본문 Korean').toContain('비밀번호 재설정');
    expect(subject, 'G3 제목 Korean').toContain('비밀번호 재설정');

    await ctx.dispose();
  });
});
