---
id: T-20260522-foot-ROCKLIST-CHECK
domain: foot
priority: P1
status: deploy-ready
hotfix: false
created: 2026-05-22 13:50
deadline: 2026-05-24
assignee: dev-foot
reporter: null
slack_channel: C0ATE5P6JTH
db_change: false
e2e_spec_exempt_reason: db_only
risk_verdict: GO
risk_reason: "데이터 조회·비교 리포트 전용. DB/코드 변경 없음. 0/5."
source_msg: MSG-20260522-141049-hqso
promoted: P2→P1 (2026-05-22 14:10 현장 최우선 지시)
deadline_shortened: 5/26→5/24
---

# T-20260522-foot-ROCKLIST-CHECK — 락 리스트 스크린샷 대비 누락 검증 리포트

## 요청 원문
> 락 리스트 스크린샷 양식 참고해서 보고해줘 누락있는지 두세번 체크해서

## 첨부 파일
- **IMG_8032.png** (F0B5E5FURKP): 락 리스트 스크린샷 — Slack 파일, 로컬 다운로드 완료
  - 다운로드 경로: `~/file_inbox/20260522/142220_F0B5E5FURKP_IMG_8032.png`

---

## 스크린샷 확인 결과 (IMG_8032.png 양식)

스크린샷은 슬랙 #project-doai-crm-봇창 채널 스레드 화면으로, 아래 내용을 담고 있음:

### ① 락 리스트 보고 양식 (확정)
```
L-{번호} {제목}
  - {상세 설명}
  - 파일: {파일명}
  - 코드 주석: // LOGIC-LOCK: L-{번호}
  - 잠금일: {날짜} | {배포상태} | {현장확인}
```

### ② 락 요청 = 최우선 등록 원칙
- 락 요청 시 다른 작업보다 먼저 등록

### ③ 당시 기준 "현재 락 리스트 (3건)"
- L-001 셀프 접수 화면 고객정보 노출 금지 상세 표시 (화면에 보임):
  - 파일: SelfCheckIn.tsx
  - 코드 주석: `// LOGIC-LOCK: L-001`
  - 잠금일: 5/15 | 배포완료 (commit 0b03425) | 현장확인 완료 ✅

---

## 교차 검증 결과

### 검증 대상
- **기준**: IMG_8032.png 양식 (필수 5필드: 번호/제목, 상세설명, 파일, 코드주석, 잠금일/배포상태/현장확인)
- **비교 대상**: `LOGIC-LOCK-REGISTRY.md` (현재 상태: L-001~L-004 + Override O-001~O-003)
- **코드 검증**: `src/**/*.tsx`, `src/**/*.ts` 내 LOGIC-LOCK 주석 전수 조사

---

### 1차 전수 비교

| L-코드 | 레지스트리 상태 | 코드 주석 | 불일치 여부 |
|--------|--------------|----------|------------|
| L-001 | ACTIVE · deployed | `SelfCheckIn.tsx` 4곳 ✅ | 일치 |
| L-002 | ACTIVE · deployed | `AdminLayout`, `Dashboard`, `Customers`, `CustomerChartPage`, `CalendarNoticePanel` 5곳 ✅ | 일치 |
| L-003 | **BLOCKED** (원문 잘림) | 10개 파일에 "차트 수정사항 CRM 전체 고객 동일 적용" 주석 ❌ | **불일치 CRITICAL** |
| L-004 | ACTIVE · deployed | `// LOGIC-LOCK: L-004` 코드 주석 **없음** ❌ | **불일치 HIGH** |

| O-코드 | 레지스트리 상태 | 코드 주석 | 불일치 여부 |
|--------|--------------|----------|------------|
| O-001 | ACTIVE | `copayCalc.ts` ✅ | 일치 |
| O-002 | ACTIVE | `PaymentMiniWindow.tsx` ✅ | 일치 |
| O-003 | ACTIVE | `Reservations.tsx` ✅ | 일치 |
| O-004 | **레지스트리 누락** ❌ | `Packages.tsx:1391` "패키지 수기 금액 조정" | **누락 CRITICAL** |

---

### 2차 재검증 (git log 기반)

commit 추적으로 L-코드별 배포 이력 재확인:

| L-코드 | 배포 commit | 잠금일 | 레지스트리 잠금일 필드 |
|--------|-----------|--------|-------------------|
| L-001 | `0b03425` (2026-05-15) | 5/15 | **없음** ← 양식 불일치 |
| L-002 | `c811917` (2026-05-19) | 5/19 | **없음** ← 양식 불일치 |
| L-003 | `f65842d` (2026-05-19) 코드 삽입 | 5/19 | BLOCKED → **내용 불일치** |
| L-004 | `27c971d` (2026-05-19) | 5/19 | **없음** ← 양식 불일치 |

L-003 추가 확인:
- commit `f65842d`: "chore: LOGIC-LOCK L-003 주석 차트 관련 전체 파일 삽입" (2026-05-19)
- 10개 파일에 동일한 규칙 적용: MedicalChartPanel, AdminLayout, CustomerChartSheet, PenChartTab, Chart2InsuranceCalcPanel, chartContext, chartSheetContext, medicalChartContext, Dashboard, CustomerChartPage

O-004 추가 확인:
- commit `3427358` (2026-05-22): "OVERRIDE-RULE: Packages O-002→O-004 중복 수정"
- `Packages.tsx:1391` → `// OVERRIDE-RULE: O-004 — 패키지 수기 금액 조정 (price_override)`
- LOGIC-LOCK-REGISTRY.md Override 테이블에 O-004 행 **없음**

---

### 3차 최종 확인

코드 내 LOGIC-LOCK 주석 전체 분포 (`src/` 내):
- L-003: 10건
- L-002: 5건
- L-001: 4건
- L-004: **0건** ← 코드 주석 완전 부재

OVERRIDE-RULE 주석 전체:
- O-001: 1건 (`copayCalc.ts`) ✅
- O-002: 1건 (`PaymentMiniWindow.tsx`) ✅
- O-003: 1건 (`Reservations.tsx`) ✅
- O-004: 1건 (`Packages.tsx`) ← **레지스트리 누락**

---

## 누락/불일치 항목 종합 (5건)

| # | 유형 | 내용 | 심각도 | 기존 티켓 |
|---|------|------|--------|----------|
| M-1 | 내용 불일치 | L-003: 코드 10개 파일에 활성 규칙 존재, 레지스트리 BLOCKED | CRITICAL | T-20260522-foot-LOCK-L003-REGISTRY-UPDATE (approved, P2) |
| M-2 | 레지스트리 누락 | O-004: `Packages.tsx`에 코드 주석, 레지스트리 O-004 행 없음 | CRITICAL | 미티켓화 |
| M-3 | 코드 주석 누락 | L-004: 레지스트리 ACTIVE이나 소스 파일에 `// LOGIC-LOCK: L-004` 없음 | HIGH | 미티켓화 |
| M-4 | 양식 필드 누락 | `잠금일: {날짜} \| {배포상태} \| {현장확인}` — L-001~L-004 모두 없음 | MEDIUM | T-20260522-foot-LOCK-L003-REGISTRY-UPDATE (AC-4: L-003만 처리) |
| M-5 | LOCK-REVIEW 오기 | T-20260522-foot-LOCK-REVIEW AC-2 표에서 L-002→CHART-UNIFORM-LOCK 등 L-코드 매핑 오류 | LOW | T-20260522-foot-LOCK-REVIEW (내부 수정 필요) |

---

## 처리 권고

### 즉시 처리 필요 (미티켓화)

1. **O-004 레지스트리 등록**: LOGIC-LOCK-REGISTRY.md Override 테이블에 O-004 행 추가
   - O-004 | ACTIVE | `src/pages/Packages.tsx` | `price_override` — 패키지 수기 금액 조정 | 없음 | 2026-05-22

2. **L-004 코드 주석 삽입**: chart-access-lock.json 보호 관련 파일들에 `// LOGIC-LOCK: L-004` 주석 추가

### 이미 티켓화 처리 중

3. **L-003 레지스트리 갱신**: T-20260522-foot-LOCK-L003-REGISTRY-UPDATE (approved, P2)

4. **전체 잠금일 필드 갱신**: 동 티켓 AC-4 부분 처리 (L-003만) → L-001/L-002/L-004도 추가 필요

---

## AC 완료 체크

- [x] **AC-1**: IMG_8032.png 다운로드 및 양식 구조 확인
- [x] **AC-2**: CRM 코드/레지스트리 대조 완료
- [x] **AC-3**: 3회 교차 검증 완료 (전수비교→git log→코드분포)
- [x] **AC-4**: 리포트 작성 + planner FOLLOWUP 발행

---

*리포트 작성: dev-foot · 2026-05-22 · 검증 방법: git log + grep + img download*
