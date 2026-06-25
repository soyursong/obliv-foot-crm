/**
 * E2E spec — T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE
 *
 * 소견서/진단서 문서 내 리터럴 `\n`(백슬래시+n 2글자)·`&lt;`(HTML 엔티티)가
 * 줄바꿈/꺾쇠로 처리되지 않고 문자열 그대로 출력되던 버그 (문지은 대표원장 보고).
 *
 *   AC-2(필수): bindHtmlTemplate 바인딩 직전 정규화 — 리터럴 개행→실제 개행,
 *               기존 HTML 엔티티 디코드 후 단일 인코딩(이중 `&amp;` 방지).
 *               composeOpinionDoc(editor SSOT 주입)도 동일 정규화.
 *
 * 검증 로직은 순수 함수(normalizePhraseText / bindHtmlTemplate / composeOpinionDoc)로 동작 —
 * 데이터/로그인 비의존. AC-0 근거: `<`/`&lt;` 출처가 작성창 수기입력·field_data이므로
 * bindHtmlTemplate 단일 게이트 방어가 `<` 증상 해소의 필수 조건.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePhraseText, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { composeOpinionDoc } from '../../src/lib/opinionDocCompose';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ── 시나리오 1: 리터럴 `\n` → 실제 개행 → <br> 렌더 ──
test('시나리오1: 리터럴 \\n(2글자)이 실제 개행으로 정규화되어 <br>로 렌더', () => {
  // 정규화 단계: 리터럴 \n → 실제 개행(0x0A)
  expect(normalizePhraseText('내원하심.\\n환자는')).toBe('내원하심.\n환자는');
  expect(normalizePhraseText('a\\r\\nb')).toBe('a\nb');
  expect(normalizePhraseText('a\\tb')).toBe('a\tb');

  // 바인딩 전체: {{body}} 에 리터럴 \n 주입 → <br> 로 렌더 (문자열 `\n` 0건)
  const html = bindHtmlTemplate('<p>{{body}}</p>', { body: '내원하심.\\n환자는' });
  expect(html).toBe('<p>내원하심.<br>환자는</p>');
  expect(html.includes('\\n')).toBe(false);
});

// ── 시나리오 2: `&lt;` 엔티티 이중인코딩 방지 → `<` 정상 표시 ──
test('시나리오2: 저장된 &lt; 엔티티가 이중인코딩 없이 단일 인코딩되어 `<`로 표시', () => {
  // 디코드 후 단일 인코딩: `&lt;` → `<` → escape → `&lt;` (브라우저에 `<` 표시)
  const html = bindHtmlTemplate('<p>{{body}}</p>', { body: '수치 &lt;5 이하' });
  expect(html).toBe('<p>수치 &lt;5 이하</p>');
  // 이중인코딩 `&amp;lt;` 가 절대 나오지 않음
  expect(html.includes('&amp;lt;')).toBe(false);

  // raw `<` 수기입력도 단일 인코딩(XSS 방지 유지)
  const raw = bindHtmlTemplate('<p>{{body}}</p>', { body: '수치 <5 이하' });
  expect(raw).toBe('<p>수치 &lt;5 이하</p>');
  expect(raw.includes('&amp;lt;')).toBe(false);
});

// ── 시나리오 3: 멱등성 — 정상 텍스트/`R&D` 등은 변형 없이 단일 인코딩 ──
test('시나리오3: 일반 텍스트 멱등 — R&D 등 정당한 & 는 단일 인코딩 유지', () => {
  // 정규화는 일반 텍스트를 건드리지 않음
  expect(normalizePhraseText('R&D 검사')).toBe('R&D 검사');
  expect(normalizePhraseText('정상 텍스트')).toBe('정상 텍스트');

  // 바인딩: R&D → R&amp;D (브라우저에 R&D 표시), 이중인코딩 없음
  const html = bindHtmlTemplate('<p>{{body}}</p>', { body: 'R&D 검사' });
  expect(html).toBe('<p>R&amp;D 검사</p>');
  expect(html.includes('&amp;amp;')).toBe(false);

  // 멱등: 정규화를 두 번 적용해도 동일 결과
  const once = normalizePhraseText('수치 &lt;5\\n비고');
  expect(normalizePhraseText(once)).toBe(once);
});

// ── 시나리오 4: _html 접미사 키는 정규화/이스케이프 생략(내부 HTML 보존) ──
test('시나리오4: _html 접미사 키는 raw HTML 그대로(정규화/이스케이프 미적용)', () => {
  const html = bindHtmlTemplate('<table>{{items_html}}</table>', {
    items_html: '<tr><td>항목 &amp; 비고</td></tr>',
  });
  expect(html).toBe('<table><tr><td>항목 &amp; 비고</td></tr></table>');
});

// ── 시나리오 5: composeOpinionDoc(editor SSOT)도 리터럴 개행 정규화 ──
test('시나리오5: composeOpinionDoc 출력(editor 본문)에 리터럴 \\n 0건', () => {
  const sections = [
    {
      title: '진단서',
      options: [{ key: 'd1', label: '진단1', phrase: '환자는 내원하심.\\n경과 양호.' }],
    },
  ];
  const out = composeOpinionDoc({ sections, selectedKeys: ['d1'] });
  expect(out.includes('\\n')).toBe(false);
  expect(out).toContain('내원하심.\n경과 양호.');
});

// ── 가드: 구현이 제자리에 존재(회귀 방지) ──
test('가드: bindHtmlTemplate가 normalizePhraseText를 경유한다', () => {
  const lib = read('src/lib/htmlFormTemplates.ts');
  expect(lib).toContain('export function normalizePhraseText');
  expect(lib).toContain('return normalizePhraseText(val)');
  const compose = read('src/lib/opinionDocCompose.ts');
  expect(compose).toContain('return normalizePhraseText(text)');
});
