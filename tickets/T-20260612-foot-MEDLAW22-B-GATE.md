---
id: T-20260612-foot-MEDLAW22-B-GATE
title: "[의료법 제22조] 급여(보험) 방문 진료기록 미작성 시 수납/완료 하드차단"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: PENDING
created: 2026-06-13
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260613-171705-48i7
decision_msg: MSG-20260613-171308-kdvj
risk_verdict: GO_WARN
---

## 결정 (문지은 대표원장 2026-06-13, MSG-20260613-171308-kdvj)

의료법 제22조 진료기록 작성 강제 게이트.
- **강도 = 하드차단(완전차단)**: 진료기록 없으면 수납/완료 진행 불가. 사유 입력 우회 없음.
- **범위 = 급여(보험)차트 한정**: 방문 내 급여코드 1개↑ 포함 → 게이트. 비급여만 → 미적용(기존 플로우).

## §2 AC (정본)

- **AC-1 급여 방문 하드차단**: 미작성이면 수납/완료 불가, 기록(+서명) 있으면 정상 진행.
- **AC-2 비급여 면제**: 비급여만 방문은 진료기록 무관 기존 플로우 정상 완료(게이트 노출 X).
- **AC-3 ★급여/비급여 판정 정확성**: 방문 내 급여코드 1개↑ 여부로 분기.
- **AC-4 레거시 면제**: 게이트 도입 전 미작성 누적 급여 건 일괄차단 금지.

## §3 판정 소스 확인 결과 (AC-3 — dev 확인 게이트 해소)

**판정 로직 위치·기준 = 기존 footBilling SSOT 재사용 (신규 스키마 불요).**

- 1차(방문 급여 여부) = `check_in_services`(방문 치료항목, 결제창에서 직원이 선택·저장한 시술/수가)
  + `getTaxClass(svc, insuranceGrade)` (`src/lib/footBilling.ts`, 4경로 공유 SSOT).
  - `getTaxClass` 규칙: (건보 유효등급 ∈ COVERED_GRADES ∧ `hira_code` 보유) ∨ `is_insurance_covered=true` → '급여'.
    그 외 vat_type 기준 비급여(과세)/비급여(면세).
  - **결제 미니창에서 직원이 보는 분류와 1:1 동일 로직** → 오판정(비급여→급여 과차단) 구조적 방지(AC-3).
  - 미보장 등급(foreigner 등) + hira_code 만으로는 급여로 과분류하지 않음(단위검증 고정).
- 2차(기록 존재) = `medical_charts` (customer_id + clinic_id + visit_date) ∧ `signing_doctor_id NOT NULL`.
  - 발톱 진료기록(SIGN-AUDIT) 기구현 → 서명 진료의 컬럼 즉시 정확.
  - 내원일 = 체크인 KST 날짜(`seoulISODate(checked_in_at)`), fallback 오늘(서울).
- **과차단 방지(안전 방향)**: 고객 미연결 / 항목 미기록 / 조회오류 시 비차단(blocked:false).
  본질 차단은 "급여 판정 ∧ 조회성공 ∧ 서명기록 0건"일 때만.

## §4 E2E 시나리오 ↔ spec

`tests/e2e/T-20260612-foot-MEDLAW22-B-GATE.spec.ts` (17 TC, 전건 PASS):
1. (A) AC-3 판정 정확성 — getTaxClass SSOT 단위검증 4TC (급여 분기/비급여 면제/과차단 방지).
2. (B) 게이트 lib 정책 6TC — 2단 검사·서명조건·내원일 매칭·과차단방지·하드차단(우회인자 부재).
3. (C) 3경로 배선 4TC — PaymentMiniWindow.handleSettle(+버튼비활성/배너)·Dashboard 완료드래그·PaymentDialog payment_waiting→done.
4. (D) 회귀 2TC — 비급여 무변경·범위(급여한정) derm/body 전파금지.

## §5 구현 (commit PENDING)

- 신규 `src/lib/medicalRecordGate.ts` — `evaluateMedicalRecordGate()` 2단 게이트 SSOT.
- `PaymentMiniWindow.tsx` — handleSettle 하드 enforcement + saved 후 평가 effect + [수납] 버튼 비활성 + 차단 배너.
- `Dashboard.tsx` — 칸반 완료('done') 드래그 우회경로 게이트(낙관 업데이트 전 abort).
- `PaymentDialog.tsx` — payment_waiting→done 방어적 게이트.

## §6 가드 준수

- db_change=false (하드차단 확정 → 사유컬럼 불요). 기존 테이블만 read. 신규 컬럼/테이블/enum 0 → data-architect CONSULT 불요.
- 비급여 경로 무변경(isCovered=false 즉시 통과). 발톱 수납/Dashboard 다티켓 동선 회귀 없음(경로 spec PASS).
- 범위(급여한정)는 foot 현장 결정 — derm/body B-GATE 전파 금지(주석·spec 고정).

## §7 잔여 메모

- COPAY-MINI-BUG spec 5TC 실패는 **사전 stale**(T-20260608 getTaxClass→footBilling 추출 후 inline 단언 잔재) — 본 티켓 무관, 별도 정리 대상.
