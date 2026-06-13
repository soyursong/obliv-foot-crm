/**
 * E2E spec — T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE (문지은 대표원장, P1)
 * 진료차트 3개 영역 미니멀 리파인 + 버그 2건.
 *   우측 치료메모 / 좌측 특이사항 / 좌측 진료경과(구 타임라인). 100% FE presentation(저장·데이터 동선 무변경).
 *   본 스펙은 기구현 presentation 검증 컨벤션(소스 정적 검증 + 회귀 가드)을 따른다.
 *
 * AC 매핑:
 *   AC-1 치료메모 항목별 '치료메모' 태그 배지(memo_type) 제거.
 *   AC-2 치료메모 날짜·작성자 → 항목 우측 상단 한 줄.
 *   AC-3 치료메모 테두리/배경 박스 제거 → 좌측 경과처럼 `| 텍스트`(border-l) 미니멀.
 *   AC-4 [버그] 박민석 당일 치료메모 2칸 — 진단=데이터/렌더 중복 아님(별개 메모). byte-identical 방어 dedup.
 *   AC-5 특이사항 펼침=읽기전용(입력창 자동노출 X) + 연필(흑백) 토글로 편집 진입.
 *   AC-6 핀 버튼 제거 → 빨강/파랑 닷으로 글씨색 토글.
 *   AC-7 "진료 경과 타임라인" → "진료경과".
 *   AC-8 진료경과 미리보기 텍스트 클릭 → 펼침/접기 토글.
 *   AC-9 진료의 2회 표시 → 1회(헤더 우측), 닷 왼쪽 여백 최소, 날짜(좌)···진료의(우) 한 줄.
 *   AC-10 [버그] 뷰 모드(읽기전용)에서 폼 헤더 "수정" 라벨 오표시 제거 — 편집 진입 시에만 노출.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// A. 우측 치료메모 — AC-1 / AC-2 / AC-3 / AC-4
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. 치료메모 미니멀', () => {
  test('AC-1 항목별 memo_type 태그 배지 제거', () => {
    const src = PANEL();
    // 구: 항목 안에 memo_type 을 파란 배지(bg-blue-100)로 렌더 → 제거됨.
    expect(src).not.toMatch(/bg-blue-100 rounded[^>]*>\{memo\.memo_type\}/);
    expect(src).not.toContain('{memo.memo_type}');
  });

  test('AC-2 날짜·작성자 우측 상단 한 줄(justify-end) — 본문 위', () => {
    const src = PANEL();
    // treat-memo-item 안: 메타 행(우측정렬) 다음에 본문 <p>. 메타에 날짜+작성자.
    expect(src).toMatch(/treat-memo-item"[\s\S]{0,260}justify-end[\s\S]{0,200}treat-memo-recorder/);
    // 작성자 dom 마커 존재.
    expect(src).toContain('data-testid="treat-memo-recorder"');
  });

  test('AC-3 박스 테두리/배경 제거 → border-l 미니멀(좌측 경과와 동일 계열)', () => {
    const src = PANEL();
    // 구 박스 스타일(rounded border bg-blue-50/40) 부재.
    expect(src).not.toContain('rounded border bg-blue-50/40 border-blue-100');
    // 신: border-l-2 미니멀(className → data-testid 순).
    expect(src).toMatch(/border-l-2 border-blue-300 pl-2 py-0\.5"[\s\S]{0,80}data-testid="treat-memo-item"/);
  });

  test('AC-4 byte-identical 방어 dedup(content+작성자+created_at) — 영속 데이터 무변경', () => {
    const src = PANEL();
    // 진단: 박민석 2건은 content 상이(별개) → 데이터/렌더 중복 아님. 방어적 dedup 만 렌더 단에서.
    expect(src).toMatch(/treat-memo-in-chart-section[\s\S]{0,400}const seen = new Set<string>\(\)/);
    expect(src).toMatch(/uniqMemos = treatMemos\.filter/);
    // DML(삭제) 없음 — 화면 dedup만. (DB delete 호출 부재 가드)
    expect(src).not.toMatch(/customer_treatment_memos[\s\S]{0,80}\.delete\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 좌측 특이사항 — AC-5 / AC-6
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B. 특이사항 편집 게이트 + 컬러 닷', () => {
  test('AC-5 입력창은 specialNoteEditing(연필 클릭)일 때만 노출 — 펼침만으론 안 보임', () => {
    const src = PANEL();
    // 입력창은 editing 게이트 안에. (Input prop 목록이 길어 윈도우 여유 확보)
    expect(src).toMatch(/\{specialNoteEditing && \([\s\S]{0,1500}data-testid="special-note-input"/);
    // 연필 토글 버튼 존재(흑백 Edit2 아이콘).
    expect(src).toContain('data-testid="special-note-edit-toggle"');
    expect(src).toMatch(/special-note-edit-toggle"[\s\S]{0,200}<Edit2/);
  });

  test('AC-6 핀 버튼 제거 → 빨강/파랑 닷(글씨색 토글)', () => {
    const src = PANEL();
    // 핀 토글 흔적 제거 — 실제 핸들러 정의/호출부 부재만 가드(제거 이력 주석의 식별자 언급은 허용).
    expect(src).not.toContain('data-testid="special-note-pin-btn"');
    expect(src).not.toMatch(/toggleSpecialNotePin\s*\(/);
    // 컬러 닷 2종 + 글씨색 클래스(red/blue) 적용.
    expect(src).toContain('data-testid="special-note-dot-red"');
    expect(src).toContain('data-testid="special-note-dot-blue"');
    expect(src).toContain("colorOv === 'red' ? 'text-red-600' : colorOv === 'blue' ? 'text-blue-600'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. 좌측 진료경과 — AC-7 / AC-8 / AC-9
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C. 진료경과', () => {
  test('AC-7 라벨 "진료 경과 타임라인" → "진료경과"', () => {
    const src = PANEL();
    // 구 라벨 텍스트(타임라인 포함) 전체 부재.
    expect(src).not.toContain('진료 경과 타임라인');
    // 신 라벨 = 진료경과 (Stethoscope 헤더 뒤).
    expect(src).toContain('진료경과');
    expect(src).toContain("라벨에서 '타임라인' 단어 제거");
  });

  test('AC-8 미리보기 텍스트 클릭 → 펼침/접기 토글(별도 토글 버튼)', () => {
    const src = PANEL();
    expect(src).toContain('data-testid={`timeline-preview-toggle-${chart.id}`}');
    // 토글 버튼이 toggleExpandChart 호출(onClick → testid 순) + 펼침 시 전체표시(접힘=truncate).
    expect(src).toMatch(/toggleExpandChart\(chart\.id\)[\s\S]{0,260}timeline-preview-toggle/);
    expect(src).toContain("isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'");
  });

  test('AC-9 진료의 1회만(헤더 우측) — 펼침 상세 중복 블록 제거', () => {
    const src = PANEL();
    // 구 펼침 상세 작성자 블록 제거.
    expect(src).not.toContain('data-testid="timeline-expanded-recorder"');
    // 헤더 우측 1회 표기(ml-auto 우측정렬).
    expect(src).toContain('data-testid="timeline-recorder"');
    expect(src).toMatch(/ml-auto[\s\S]{0,140}data-testid="timeline-recorder"/);
    // 닷 컬럼 왼쪽 여백 최소(pl-1.5) — 헤더 select 버튼(className → testid 순).
    expect(src).toMatch(/pl-1\.5 pr-2 pt-2 pb-0\.5[\s\S]{0,120}chart-select-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. 헤더 "수정" 라벨 버그 — AC-10
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D. 폼 헤더 수정 라벨(뷰 모드 버그)', () => {
  test('AC-10 "수정" 라벨은 편집 모드(!isReadOnly)일 때만 — 뷰 모드 미표시', () => {
    const src = PANEL();
    // 구: 저장된 차트면 무조건 "수정" → 제거. 신: !isReadOnly 게이트.
    expect(src).not.toContain("? '[더미]' : '수정'} —");
    expect(src).toMatch(/\? '\[더미\] ' : \(!isReadOnly \? '수정 ' : ''\)/);
    // 폼 타이틀 dom 마커.
    expect(src).toContain('data-testid="medical-chart-form-title"');
  });

  test('AC-10 회귀: editMode 토글/저장 후 읽기전용 복귀 로직 보존', () => {
    const src = PANEL();
    // 저장 성공 후 editMode=false 복귀(연속 실수 차단) 보존.
    expect(src).toContain('setEditMode(false)');
    // isReadOnly 정의 보존.
    expect(src).toContain('const isReadOnly = readOnly || (!!selectedChartId && !editMode)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀 가드 — 저장·데이터 동선 무변경
// ─────────────────────────────────────────────────────────────────────────────
test.describe('회귀 가드', () => {
  test('치료메모/특이사항 데이터 경로(loadData) + 특이사항 추가/정렬 보존', () => {
    const src = PANEL();
    // 치료메모 조회 경로 보존.
    expect(src).toContain("from('customer_treatment_memos')");
    // 특이사항 추가 + 정렬 보존(핀 토글만 제거).
    expect(src).toContain('addSpecialNote');
    expect(src).toContain('sortSpecialNotes');
    // 진료의 NOT NULL 강제(의료법) 무변경.
    expect(src).toContain('formSigningDoctorId');
  });
});
