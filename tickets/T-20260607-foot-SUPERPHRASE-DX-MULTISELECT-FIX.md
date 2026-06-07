---
id: T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-07
reporter: 문지은 대표원장 (C0ATE5P6JTH / U0ALGAAAJAV)
---

# T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX — 진료차트 진단명 다중·주부지정 + // 단축어 회귀 수정

## 증상 (문지은 대표원장)
SUPER-PHRASE-DIAGNOSIS-AUTOCOMPLETE(deployed) 의 아래 3 AC 가 현장에서 동작하지 않음(P1 회귀).
- (a) 주/부상병 지정이 없다.
- (b) 진단명을 여러 개(중복 포함) 못 고른다 — 항목을 클릭하면 직전 선택이 사라짐(대체).
- (c) 임상경과 '//' 단축어 자동완성.

## 근본 원인
- **AC-1/AC-2**: `DiagnosisFolderPicker.select()` 가 `onChange(fmtDx(row))` 로 **값을 대체**(단일 선택).
  → 다중·중복·주부 구분 불가.
- **AC-3**: `MedicalChartPanel.handleClinicalChange` 의 `//query` 캡처 + `filteredPhrases`/`filteredSuperPhrases`
  게이트는 정상(d0c3a21 배포). 본 티켓에선 회귀 잠금(spec 정본)으로 보존.

## 수정 (AC)
- **AC-1 주/부상병 지정**: 선택 순서 기반 — 줄 순서 = 주/부 순서(index 0 = 주상병). 칩의 `[주상병]`
  버튼으로 부상병을 맨 앞으로 승격(나머지 상대순서 보존). 칩에 주(teal)/부(gray) 배지 표기.
- **AC-2 진단명 다중(중복) 선택**: 항목 클릭 = 대체 대신 **누적(append, 중복 허용)**. 패널 미닫힘(연속 추가).
  칩에서 개별 삭제(X) + 전체 삭제. 저장값 = `medical_charts.diagnosis`(text) 무스키마변경 — 줄바꿈(\n) 직렬화.
  (applySuperPhrase 의 기존 `\n` 누적 포맷과 호환)
- **AC-3 // 단축어**: handleClinicalChange 정규식/필터 회귀 잠금(spec 미러). 빈 query=단축어보유 상용구+슈퍼상용구
  전체 노출, query 부분일치, 공백/토큰종료 시 닫힘, 0건이면 빈 안내(열림 자체 동작).

> 불러오기 명칭(처방세트/묶음처방 등) 분리 = PROCMENU-RX-UNIFY 확정 후 별도(본 티켓 범위 외).

## 변경 파일
- `src/components/medical/DiagnosisFolderPicker.tsx` — 다중·주부지정 리워크 + 순수 헬퍼 export
  (parseDxEntries/serializeDxEntries/addDxEntry/removeDxEntry/makeDxPrimary/isDxPrimary)
- `tests/e2e/T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX.spec.ts` — 17 spec

## 현장 클릭 시나리오 (실사용자 동선)

### 시나리오 1: 진단명 다중·중복 선택 (AC-2)
1. 로그인 → 환자 차트 → 진료차트 작성(편집 모드) → 진단명 picker 열기
2. 폴더 펼침 → 상병A 클릭 → 칩 1건(주) 생성, **패널 유지**
3. 상병B 클릭 → 칩 2건(주 A / 부 B)
4. 상병A 재클릭 → 칩 3건(중복 허용) — 직전 선택이 사라지지 않아야 함(회귀 차단)
5. 부 칩의 X → 해당 항목만 삭제(나머지 순서 보존)

### 시나리오 2: 주/부상병 지정 (AC-1)
1. 칩 2건(주 A / 부 B) 상태
2. 부 B 칩의 `[주상병]` 클릭 → B 가 맨 앞으로 승격(주 B / 부 A)
3. 저장 → 재진입 시 줄 순서(주/부) 보존
4. 레거시 단일 상병(마커 없는 기존 차트) → 1건·주상병으로 표시(크래시 없음)

### 시나리오 3: 임상경과 // 단축어 (AC-3)
1. 임상경과 textarea 에 `//` 입력 → 팝오버 열림(단축어 보유 상용구 + 슈퍼상용구 노출)
2. `//ok` → shortcut_key 접두 일치 상용구만, `//족저` → 슈퍼상용구 이름/진단 부분일치
3. 슈퍼상용구 선택 → 진단명·임상경과·처방 일괄 라우팅(// 토큰 제거)
4. 공백 입력 시 팝오버 닫힘
