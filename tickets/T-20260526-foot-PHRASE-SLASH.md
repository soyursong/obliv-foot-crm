---
id: T-20260526-foot-PHRASE-SLASH
title: "상용구 슬래시 단축어 자동완성 (//)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
created: 2026-05-26
deadline: 2026-05-31
assignee: dev-foot
db_change: true
build_passed: true
spec_file: tests/e2e/T-20260526-foot-PHRASE-SLASH.spec.ts
spec_added: true
deploy_ready_at: "2026-05-27T16:00:00+09:00"
qa_result: pending
qa_fail_phase: ""
qa_fail_reason: ""
qa_fail_detail: ""
qa_checked_at: ""
fix_detail: "FIX-REQUEST(MSG-20260527-155220-2u35): 현장 클릭 시나리오 섹션 추가. MedicalChartPanel/DoctorTreatmentPanel // 흐름 + E2E 매핑 명시."
---

## 요약
텍스트 입력 중 `//풋재` 같이 단축어 타이핑 시 상용구 자동완성 기능.
기존 드롭다운 선택 방식과 병행.

## AC
- [x] AC-1: phrase_templates.shortcut_key UNIQUE 제약 추가 (migration + rollback)
- [x] AC-2: `//` 입력 시 자동완성 드롭다운 (shortcut_key prefix 매칭, 실시간)
- [x] AC-3: 선택 시 `//단축어` → 상용구 문구로 텍스트 대체
- [x] AC-4: PhrasesTab 단축어 입력 필드 추가 + 중복 경고
- [x] AC-5: MedicalChartPanel(임상경과) + DoctorTreatmentPanel(진료메모·서류) 적용
- [x] AC-6: 기존 드롭다운(상용구 버튼) 방식 유지
- [x] AC-7: npm run build 에러 0

## 현장 클릭 시나리오

### A. MedicalChartPanel — 임상경과 `//` 단축어

**사전 조건**: 관리자 > 상용구 탭에서 `shortcut_key`가 설정된 상용구 1개 이상 존재 (`phrase_type='medical_chart'`)

**단계**:

| # | 액션 | 기대 결과 |
|---|------|-----------|
| 1 | 고객 목록(`/customers`)에서 고객 클릭 → 2번차트 탭 클릭 | MedicalChartPanel 패널 열림 |
| 2 | 임상경과 textarea 클릭 (`data-testid="medical-chart-clinical"`) | 커서 진입, placeholder "임상경과를 입력하세요 예: //통증감소" 표시 |
| 3 | `//족통` 타이핑 | `handleClinicalChange()` 호출 → regex `/\/\/([^\s/]*)$/` 매칭 → `phraseQuery='족통'` 설정 |
| 4 | 드롭다운 자동 표시 (`data-testid="phrase-autocomplete-popover"`) | 최대 8개 항목, 각 항목: Badge(`//shortcut_key`) + 상용구명 + 내용 미리보기 노출 |
| 5 | 목록에서 "족통감소" 항목 클릭 | `insertPhrase()` 호출 → `//족통` 패턴이 `phrase.content`로 즉시 대체 |
| 6 | 팝오버 닫힘 확인 | `phrasePopoverVisible=false`, textarea 포커스 자동 복귀 |

**검증 포인트 (AC-2, AC-3)**:
- `[data-testid="phrase-autocomplete-popover"]` `.isVisible()` → `true` (AC-2)
- `clinicalTextarea.inputValue()` 결과에 `//` 미포함 (AC-3)
- `filteredPhrases` 수: shortcut_key prefix 매칭 우선 + name 포함 검색 병행, 최대 8개 슬라이스

---

### B. DoctorTreatmentPanel — 진료메모 `//` 단축어

**사전 조건**: 진료 권한 보유 계정, 해당 방문 `check_ins` 레코드 존재, `phrase_type='pen_chart'` 상용구 존재

**단계**:

| # | 액션 | 기대 결과 |
|---|------|-----------|
| 1 | 진료 대기 칸반에서 고객 선택 → DoctorTreatmentPanel 열림 | `data-testid="doctor-treatment-panel"` 표시 |
| 2 | **차팅** 탭 클릭 (`data-testid="doctor-tab-charting"`) | 진료메모 textarea 노출 |
| 3 | 진료메모 textarea 클릭 (`data-testid="doctor-note-textarea"`) | 커서 진입, placeholder "초진/재진/체험 내원... (//단축어 자동완성)" 표시 |
| 4 | `//발통` 타이핑 | `handleNoteChange()` → regex 매칭 → `noteSlashQuery='발통'`, `noteSlashVisible=true` |
| 5 | 팝오버 표시 (`data-testid="note-slash-popover"`) | `noteFilteredPhrases` 최대 8개 항목 노출 |
| 6 | 항목 클릭 | `insertSlashPhrase(p, 'note')` → `//발통` 패턴 → `phrase.content` 대체, 팝오버 닫힘 |

**검증 포인트**:
- `[data-testid="note-slash-popover"]` `.isVisible()` → `true`
- `doctor-note-textarea` 값에 `//` 미포함

---

### C. DoctorTreatmentPanel — 서류 `//` 단축어

**단계**:

| # | 액션 | 기대 결과 |
|---|------|-----------|
| 1 | **서류** 탭 클릭 (`data-testid="doctor-tab-document"`) | 서류 textarea 노출 |
| 2 | 서류 내용 textarea 클릭 (`data-testid="doc-content-textarea"`) | 커서 진입, placeholder "서류 내용... (//단축어 자동완성)" 표시 |
| 3 | `//서류단축어` 타이핑 | `handleDocChange()` → regex 매칭 → `docSlashQuery`, `docSlashVisible=true` |
| 4 | 팝오버 표시 (`data-testid="doc-slash-popover"`) | `docFilteredPhrases` 최대 8개 항목 노출 |
| 5 | 항목 클릭 | `insertSlashPhrase(p, 'doc')` → 텍스트 대체, `docSlashVisible=false` |

---

### E2E spec ↔ 시나리오 매핑

| AC | spec 테스트명 | 대응 시나리오 단계 |
|----|--------------|-----------------|
| AC-2 | `AC-2: 임상경과 textarea에 // 입력 시 자동완성 드롭다운 표시` | A 단계 2-4 |
| AC-3 | `AC-3: 자동완성 항목 선택 시 //query → 상용구 내용으로 대체` | A 단계 5-6 |
| AC-4 | `AC-4: 관리자 상용구 탭에 단축어(shortcut_key) 입력 필드 존재` | 사전 조건 설정 화면 |
| AC-4b | `AC-4b: 이미 사용 중인 단축어 입력 시 중복 경고 표시` | 사전 조건 — 중복 방지 |
| AC-5 | `AC-5: DoctorTreatmentPanel // 트리거 적용 확인 (코드 존재 검증)` | B 단계 3-6 / C 단계 2-5 |
| AC-6 | `AC-6: 기존 상용구 버튼 클릭 방식 유지 (2번차트 상용구 탭)` | 기존 우측 패널 방식 비회귀 |
| AC-7 | `AC-7: 앱 빌드 결과물 정상 로딩 (white-screen 없음)` | 빌드 회귀 체크 |

---

### 공통 닫힘 조건
- `onBlur` → `setTimeout(() => setPhrasePopoverVisible(false), 200)` (200ms 딜레이로 클릭 이벤트 먼저 처리)
- ESC 키 또는 textarea 외부 클릭 시 팝오버 닫힘
- `phrase_templates` 데이터 없거나 `shortcut_key` 미설정 시 팝오버 미표시 (정상 동작)

## DB 변경
- phrase_templates.shortcut_key: 기존 일반 인덱스 → UNIQUE 인덱스로 교체 (NULL 허용)
- 마이그레이션: 20260526150000_phrase_shortcut_unique.sql
- 롤백: 20260526150000_phrase_shortcut_unique.rollback.sql

## 참조
- 관련: T-20260519-foot-MEDCHART-REVAMP (shortcut_key 컬럼 최초 추가)
- 기존: MedicalChartPanel.tsx에 `#` 트리거 구현 → `//`로 전환
