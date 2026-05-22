---
id: T-20260522-foot-CHECKIN-CONSENT-REMOVE
domain: foot
status: deploy-ready
deploy_ready: true
commit: ba07250
db_change: false
build: OK
e2e_spec: N/A (FE dead code removal, no UI trigger existed)
summary: "CheckInDetailSheet 체크리스트/동의서 dead code 제거 — PenChart 이관 완료로 버튼 없이 남은 모달·상태변수·임포트 전체 삭제"
---

## T-20260522-foot-CHECKIN-CONSENT-REMOVE

**1번차트(CheckInDetailSheet) 체크리스트 / 동의서 섹션 제거**

### 배경
- PenChart에 환불/비급여동의서 이관 완료 (PENCHART-REFUND-FORM deployed)
- PenChartTab에서 개인정보+체크리스트 2종 이미 제거 (PENCHART-CHECKLIST-REMOVE deployed)
- T-20260522-foot-CHART1-TRIM AC-2에서 트리거 버튼 제거 완료
- CheckInDetailSheet에 모달 컴포넌트·상태변수·임포트가 dead code로 잔존

### 변경 내용

**imports (lines 32-35 제거)**
- `import { PreChecklist }` 제거
- `import { ChecklistForm }` 제거
- `import { ConsentForm }` 제거

**state variables (lines 581-584 제거)**
- `const [checklistOpen, setChecklistOpen]` 제거
- `const [tabletChecklistOpen, setTabletChecklistOpen]` 제거
- `const [tabletConsentOpen, setTabletConsentOpen]` 제거

**customerMode 모달 블록 제거**
- `{/* 태블릿 양식 모달 */} <ChecklistForm .../>` 제거
- `<ConsentForm .../>` (customerMode) 제거

**checkIn mode 모달 블록 제거**
- `<PreChecklist checkIn={checkIn} .../>` 제거
- `{checkIn.customer_id && <> <ChecklistForm .../> <ConsentForm .../> </>}` 블록 전체 제거

### 수용 기준
- AC-1: ✅ 1번차트에서 "체크리스트 / 동의서" 섹션 전체 비노출 (이전 티켓에서 버튼 제거, 이번에 dead code 완전 정리)
- AC-2: ✅ 인접 섹션(패키지 잔여회차, 공간배정 등) 레이아웃·기능 무영향
- AC-3: ✅ 빌드 성공 (✓ built in 3.22s)

### 리스크: GO (0/5)
- FE-only, DB 변경 없음
- dead code 제거만 — 런타임 동작 변화 없음
