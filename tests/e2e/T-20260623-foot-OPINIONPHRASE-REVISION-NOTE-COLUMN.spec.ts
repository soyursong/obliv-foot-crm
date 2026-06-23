/**
 * E2E spec — T-20260623-foot-OPINIONPHRASE-REVISION-NOTE-COLUMN (문지은 대표원장, 풋센터)
 *
 * 요청: 소견서 상용구 관리에서 '수정기록'을 내용(phrase) 끝에 붙이지 말고 별도 칼럼/필드로 분리.
 *   → option 에 revisionNote(ADDITIVE jsonb) + 평면 테이블 '수정기록' 칼럼 + 다이얼로그 입력칸(선택).
 *   DB 무변경 — form_templates(opinion_doc).field_map.sections[].options[].revisionNote 신규 키(DDL 0).
 *
 * AC-1 데이터 모델: OpinionOption.revisionNote?(ADDITIVE) — 기존 option(필드 없음) 빈값 안전 렌더 + read 보존.
 * AC-2 평면 테이블: thead = 서류종류 | 명칭 | 내용 | 수정기록 | 액션. 내용(phrase)과 분리 표시.
 * AC-3 다이얼로그: 수정기록 입력칸 추가(선택 입력 — 명칭/내용만 필수).
 * AC-4 GUARD: 편집 권한 게이트(canEditClinicMgmt) 보존 + 소비처(OpinionDocTab)에 revisionNote 미노출/미삽입.
 * AC-5 자동 split 금지: 기존 phrase 끝 수정기록 자동 파싱/분리 안 함(오절단 위험) — 빈 revisionNote 로 시작.
 *
 * 본 spec = 소스 구조 불변식(데이터·로그인 비의존 회귀) + parser 보존 단위테스트(AC-1) + 권한 헬퍼 회귀(AC-4).
 *   실제 브라우저 렌더(칼럼/다이얼로그/권한)는 권한자 계정으로 라이브 확인(단계별 브라우저 테스트 의무).
 *
 * 실행: npx playwright test T-20260623-foot-OPINIONPHRASE-REVISION-NOTE-COLUMN.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canEditClinicMgmt } from '../../src/lib/permissions';
import { parseOpinionSections } from '../../src/components/doctor/OpinionDocTab';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION_TAB = 'src/components/admin/OpinionPhrasesTab.tsx';
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';

// ── 시나리오 1: 데이터 모델 — revisionNote ADDITIVE + read 보존 (AC-1, AC-5) ──────
test.describe('REVISION-NOTE-COLUMN — 시나리오 1: 데이터 모델(AC-1/AC-5)', () => {
  const doc = read(OPINION_DOC);

  test('AC-1: OpinionOption 에 revisionNote? ADDITIVE 필드 선언', () => {
    expect(doc).toContain('revisionNote?: string');
  });

  test('AC-1: parseOpinionSections 가 revisionNote 를 read 시 보존(round-trip 유실 방지)', () => {
    // 신규 키가 있는 option → 보존
    const withNote = parseOpinionSections({
      sections: [
        {
          title: '금기증',
          options: [
            { key: 'k1', label: '경구약 O', phrase: '복용 가능합니다.', revisionNote: '2026-06-23 신규 등록' },
          ],
        },
      ],
    });
    expect(withNote).toHaveLength(1);
    expect(withNote[0].options[0].revisionNote).toBe('2026-06-23 신규 등록');
    expect(withNote[0].options[0].phrase).toBe('복용 가능합니다.'); // 내용은 순수 phrase 만
  });

  test('AC-1: 기존 option(revisionNote 없음)은 undefined 로 안전 파싱(backward-compat)', () => {
    const legacy = parseOpinionSections({
      sections: [{ title: '진단서', options: [{ key: 'k2', label: '의료진', phrase: '진료하였습니다.' }] }],
    });
    expect(legacy).toHaveLength(1);
    expect(legacy[0].options[0].revisionNote).toBeUndefined();
    expect(legacy[0].options[0].phrase).toBe('진료하였습니다.');
  });

  test('AC-5: 자동 split 금지 — phrase 끝 수기 메모를 파싱/분리하지 않음(원문 유지)', () => {
    // phrase 안에 수정기록처럼 보이는 문자열이 있어도 코드가 잘라내지 않는다.
    const noSplit = parseOpinionSections({
      sections: [
        {
          title: '금기증',
          options: [{ key: 'k3', label: '당뇨', phrase: '당뇨 확인. (수정기록: 6/20 문구 수정)' }],
        },
      ],
    });
    expect(noSplit[0].options[0].phrase).toBe('당뇨 확인. (수정기록: 6/20 문구 수정)');
    expect(noSplit[0].options[0].revisionNote).toBeUndefined(); // 빈 값으로 시작 — 자동 이전 없음
  });
});

// ── 시나리오 2: 평면 테이블 '수정기록' 칼럼 (AC-2) ───────────────────────────────
test.describe('REVISION-NOTE-COLUMN — 시나리오 2: 테이블 칼럼(AC-2)', () => {
  const ot = read(OPINION_TAB);

  test('AC-2: thead = 서류종류 | 명칭 | 내용 | 수정기록 | 액션', () => {
    expect(ot).toContain('>수정기록</th>');
    // 기존 칼럼 라벨 유지(회귀 0)
    expect(ot).toContain('>서류 종류</th>');
    expect(ot).toContain('>명칭</th>');
    expect(ot).toContain('>내용</th>');
  });

  test('AC-2: 수정기록 셀 = option.revisionNote, 내용(phrase)과 분리 + 없으면 — 표시', () => {
    expect(ot).toContain('data-testid="opinion-phrase-row-revision-note"');
    expect(ot).toContain('opt.revisionNote');
    // 내용 셀(phrase)은 그대로 유지 — 분리됨
    expect(ot).toContain('data-testid="opinion-phrase-row-phrase"');
  });
});

// ── 시나리오 3: 다이얼로그 수정기록 입력칸(선택 입력) (AC-3) ──────────────────────
test.describe('REVISION-NOTE-COLUMN — 시나리오 3: 다이얼로그 입력칸(AC-3)', () => {
  const ot = read(OPINION_TAB);

  test('AC-3: 다이얼로그에 수정기록 입력칸 추가', () => {
    expect(ot).toContain('data-testid="opinion-phrase-revision-note-input"');
    expect(ot).toContain('수정기록');
  });

  test('AC-3: 수정기록은 선택 입력 — 명칭/내용만 필수(handleSubmit 검증)', () => {
    // 명칭/내용은 비면 toast.error 로 차단, 수정기록은 검증 없이 통과.
    expect(ot).toContain("if (!label.trim()) return toast.error('명칭을 입력해주세요.')");
    expect(ot).toContain("if (!phrase.trim()) return toast.error('내용을 입력해주세요.')");
    // 수정기록 필수 검증이 없어야 한다(선택 입력).
    expect(ot).not.toContain('수정기록을 입력해주세요');
    // onSubmit 에 revisionNote(trim) 전달
    expect(ot).toContain('onSubmit(section, label.trim(), phrase.trim(), revisionNote.trim())');
  });

  test('AC-3: 저장 시 revisionNote 를 option 에 분리 기록(추가/수정 경로)', () => {
    // 추가
    expect(ot).toContain('next[targetIdx].options.push({ key, label, phrase, revisionNote })');
    // 제자리 수정
    expect(ot).toContain('next[sectionIdx].options[optIdx] = { ...cur, label, phrase, revisionNote }');
    // 서류종류 이동 수정
    expect(ot).toContain('next[targetIdx].options.push({ ...cur, label, phrase, revisionNote })');
  });

  test('AC-3: edit 모드 시 현재 revisionNote 가 다이얼로그 initial 로 주입', () => {
    expect(ot).toContain('revisionNote: draft[phraseDialog.sectionIdx]?.options[phraseDialog.optIdx]?.revisionNote');
  });
});

// ── 시나리오 4(회귀): 권한 게이트 + 소비처 미노출 (AC-4 GUARD) ──────────────────
test.describe('REVISION-NOTE-COLUMN — 시나리오 4(회귀): GUARD(AC-4)', () => {
  const ot = read(OPINION_TAB);
  const doc = read(OPINION_DOC);

  test('AC-4: 편집 게이트 = canEditClinicMgmt 보존(추가/수정/삭제 + 입력칸 게이팅)', () => {
    expect(ot).toContain('const canEdit = canEditClinicMgmt(profile)');
    expect(ot).toContain('{canEdit && (');
    // 다이얼로그(수정기록 입력 포함)는 canEdit 게이트된 버튼(추가/수정)으로만 진입.
    expect(ot).toContain('data-testid="opinion-phrase-add"');
    expect(ot).toContain('data-testid="opinion-phrase-row-edit"');
  });

  test('AC-4: 권한자/비권한자 분기 보존(EDIT-DIRECTOR-ONLY)', () => {
    expect(canEditClinicMgmt({ role: 'director', has_ops_authority: false })).toBe(true);
    expect(canEditClinicMgmt({ role: 'admin', has_ops_authority: false })).toBe(true);
    expect(canEditClinicMgmt({ role: 'manager', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt({ role: 'coordinator', has_ops_authority: false })).toBe(false);
    expect(canEditClinicMgmt(null)).toBe(false);
  });

  test('AC-4: 권한 없는 사용자 — 수정기록 칼럼은 읽기만(셀은 canEdit 무관 렌더, 액션만 canEdit)', () => {
    // 수정기록 셀(td)은 canEdit 조건 밖(항상 렌더 = 읽기). 액션 컬럼만 canEdit 게이팅.
    const noteCellIdx = ot.indexOf('data-testid="opinion-phrase-row-revision-note"');
    const actionCellIdx = ot.indexOf('opinion-phrase-row-edit');
    expect(noteCellIdx).toBeGreaterThan(-1);
    // 수정기록 셀이 액션 셀(canEdit)보다 앞 — 별도 칼럼, 게이트 무관.
    expect(noteCellIdx).toBeLessThan(actionCellIdx);
  });

  test('AC-4: 소비처(OpinionDocTab 소견서 작성)에 revisionNote 미노출/미삽입 — phrase 만 삽입', () => {
    // 소견서 작성 화면은 phrase 만 본문에 삽입. revisionNote 는 타입/파서 보존부에만 존재(메타).
    expect(doc).toContain('opt.phrase'); // 삽입 소스 = phrase
    // revisionNote 참조는 타입 선언 + 파서 보존부(parseOpinionSections)에만 — 렌더/삽입 JSX 에는 없음.
    // 옵션 버튼 렌더부(opinion-opt) 이후 = revisionNote 미참조(소비처 무노출/미삽입).
    const renderSection = doc.slice(doc.indexOf('opinion-opt-'));
    expect(renderSection).not.toContain('revisionNote');
  });

  test('AC-4: DB 무손실 — sections jsonb 편집만(신규 컬럼/테이블/CHECK 없음)', () => {
    expect(ot).toContain('const nextFieldMap = { ...baseFieldMap, sections }');
    expect(ot).toContain('.update({ field_map: nextFieldMap })');
  });
});

// ── 시나리오 5(라이브 렌더): 인증 계정으로 실제 화면 확인 (단계별 브라우저 테스트 의무) ──
//   desktop-chrome(authenticated storageState) 단독 실행. 테스트 계정 권한 없으면 skip.
test.describe('REVISION-NOTE-COLUMN — 시나리오 5(라이브): 실브라우저 렌더', () => {
  test('수정기록 칼럼 + 다이얼로그 입력칸이 실제 렌더된다', async ({ page }) => {
    await page.goto('/admin/clinic-management?tab=opinion_phrases');
    // 탭 콘텐츠(소견서 상용구) 렌더 대기 — 권한 없으면 탭 자체 미노출 → skip.
    const tab = page.getByTestId('opinion-phrases-tab');
    const visible = await tab.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '테스트 계정에 소견서 상용구 편집 권한 없음(admin/manager only) — 라이브 렌더 skip.');
      return;
    }
    // AC-2: 테이블 헤더에 '수정기록' 칼럼.
    await expect(page.locator('thead', { hasText: '수정기록' }).first()).toBeVisible();
    // AC-3: 추가 다이얼로그에 수정기록 입력칸(권한자만 추가 버튼 노출).
    const addBtn = page.getByTestId('opinion-phrase-add');
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await expect(page.getByTestId('opinion-phrase-dialog')).toBeVisible();
      await expect(page.getByTestId('opinion-phrase-revision-note-input')).toBeVisible();
      // GUARD: 명칭/내용 입력칸도 그대로(회귀 0).
      await expect(page.getByTestId('opinion-phrase-label-input')).toBeVisible();
      await expect(page.getByTestId('opinion-phrase-phrase-input')).toBeVisible();
    }
  });
});
