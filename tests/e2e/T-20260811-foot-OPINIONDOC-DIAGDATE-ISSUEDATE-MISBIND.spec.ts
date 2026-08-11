/**
 * T-20260811-foot-OPINIONDOC-DIAGDATE-ISSUEDATE-MISBIND (P1, scalp2 canonical 미러)
 *
 * RC: 소견서(diag_opinion)·진단서(diagnosis) 양식의 '진단일' 셀이 {{issue_date}}(=today)로
 *     오바인딩돼 항상 '오늘'로 오출력 → 보험사 제출건 반려. 신규 전용 토큰 {{diagnosis_date}} 배선.
 *
 * 검증(순수 렌더러 = LOGIC-LOCK L-006 재사용):
 *  · AC-1/2: diag_opinion·diagnosis 진단일 셀 = 앵커 방문일(발행일=오늘과 별개 축).
 *  · AC-5:   발행일 셀 = 오늘 유지(불변식② 무회귀 — issue_date 축 무접촉).
 *  · AC-4:   공란 폴백 체인 — diagnosisDate → autoValues.diagnosis_date → visit_date → issueDate.
 *            어느 경로에서도(레거시 autoValues 미주입 포함) 진단일 셀 공란 0.
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { renderOpinionDocHtml } from '../../src/lib/printOpinionDoc';

const FORMS = ['diag_opinion', 'diagnosis'] as const;

function cell(html: string, label: string): string {
  const re = new RegExp(`${label}[\\s\\S]*?<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`);
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

test.describe('OPINIONDOC 진단일 ≠ 발행일 (diagnosis_date 전용 토큰)', () => {
  test('AC-1/2/5: 템플릿 진단일 셀이 {{diagnosis_date}} 로 분리 렌더 · 발행일은 무접촉', () => {
    const DIAG = '2026-08-01';
    const ISSUE = '2026-08-11';
    for (const f of FORMS) {
      const tpl = getHtmlTemplate(f);
      expect(tpl, `${f} 템플릿 존재`).toBeTruthy();
      const html = bindHtmlTemplate(tpl!, { diagnosis_date: DIAG, issue_date: ISSUE });
      expect(cell(html, '진 단 일'), `${f} 진단일=방문일`).toBe(DIAG);
      expect(cell(html, '발 행 일'), `${f} 발행일=오늘(AC-5 무회귀)`).toContain(ISSUE);
      expect(cell(html, '진 단 일')).not.toBe(cell(html, '발 행 일'));
    }
  });

  test('AC-1/2: renderOpinionDocHtml — diagnosisDate 스냅샷 우선 렌더', () => {
    for (const f of FORMS) {
      const r = renderOpinionDocHtml({
        body: '소견 본문', formKey: f, issueDate: '2026-08-11',
        diagnosisDate: '2026-08-01',
        autoValues: { visit_date: '2026-07-20', diagnosis_date: '2026-07-20', issue_date: '2026-08-11' },
      });
      expect(r).not.toBeNull();
      expect(cell(r!.html, '진 단 일'), `${f} 스냅샷(2026-08-01) 우선`).toBe('2026-08-01');
      expect(cell(r!.html, '발 행 일')).toContain('2026-08-11');
    }
  });

  test('AC-4: 폴백 체인 — 스냅샷 null → autoValues.diagnosis_date', () => {
    const r = renderOpinionDocHtml({
      body: 'x', formKey: 'diag_opinion', issueDate: '2026-08-11',
      diagnosisDate: null,
      autoValues: { diagnosis_date: '2026-08-05', visit_date: '2026-08-03', issue_date: '2026-08-11' },
    });
    expect(cell(r!.html, '진 단 일')).toBe('2026-08-05');
  });

  test('AC-4: 폴백 체인 — diagnosis_date 부재 → autoValues.visit_date', () => {
    const r = renderOpinionDocHtml({
      body: 'x', formKey: 'diag_opinion', issueDate: '2026-08-11',
      autoValues: { visit_date: '2026-08-03', issue_date: '2026-08-11' },
    });
    expect(cell(r!.html, '진 단 일')).toBe('2026-08-03');
  });

  test('AC-4: 폴백 체인 — autoValues 전무(레거시 재출력) → issueDate (진단일 공란 0)', () => {
    const r = renderOpinionDocHtml({
      body: 'x', formKey: 'diagnosis', issueDate: '2026-08-11',
    });
    const c = cell(r!.html, '진 단 일');
    expect(c).toBe('2026-08-11');
    expect(c).not.toBe('');
  });
});
