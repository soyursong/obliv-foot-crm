---
id: T-20260523-foot-PENCHART-INSURANCE
title: "[보험차트] 양식 명칭 변경 + 자동채움 위치 정정"
domain: foot
priority: P2
status: deployed
deploy-ready: true
build-ok: true
db-change: true
spec-added: true
spec-exempt: false
rollback-sql: "UPDATE form_templates SET name_ko = '펜차트 양식' WHERE form_key = 'pen_chart';"
commit_sha: "5798b62"
created: 2026-05-23 23:00
completed: 2026-05-24
deadline: 2026-05-27
assignee: dev-foot
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
source_msg: MSG-20260523-230107-n5ht
related_tickets:
  - T-20260523-foot-PENCHART-FORM-AUTOFILL
  - T-20260522-foot-PENCHART-HIRES-FORM
risk_verdict: GO
---

# T-20260523-foot-PENCHART-INSURANCE — [보험차트] 명칭 변경 + 자동채움 위치 정정

## 배경

INFO MSG-20260523-230107-n5ht (김주연 총괄 스펙 정정):
펜차트 양식(pen_chart)은 보험 청구 목적으로 사용 → 명칭을 '[보험차트]'로 변경.
자동채움 좌표를 양식 상단 빨간 박스 위치(Obliv 로고 우측)로 정정.

## 변경 내역

### 1. 명칭 변경 (AC-3, AC-4)

- `BUILTIN_PEN_CHART_TEMPLATE.name_ko`: `'펜차트 양식'` → `'[보험차트]'`
- 양식 선택 패널: 하드코딩 제거 → 동적 `(penChartTemplate ?? BUILTIN_PEN_CHART_TEMPLATE).name_ko`
- DB seed `20260517000060`: `name_ko '[보험차트]'` 갱신
- DB migration `20260524000001_pen_chart_rename_insurance.sql`: 기존 레코드 UPDATE

### 2. 자동채움 위치 정정 (AC-1, AC-2)

- `PENCHART_AUTOFILL_POS` 좌표: x=165/420 → x=285(로고 우측·담당의 좌측 중앙 박스)
- 성함(상단): `{ key: 'name', x: 285, y: 23 }`
- 주민번호(하단): `{ key: 'rrn', x: 285, y: 44 }` — 전체 표시(마스킹 없음, AC-8)
- 커밋 4e27447(명칭+위치) + 5798b62(AC-8 주민번호 마스킹 제거)

### 3. 주민번호 전체 표시 (AC-8 — T-20260523-foot-PENCHART-FORM-AUTOFILL 연동)

- 김주연 총괄 현장 결정(2026-05-24): A안(전체 표시) 확정 — 보험차트 용도
- `rrnFull` 상태 추가 (rrn_decrypt 복호화값 전체 포맷)
- PenChartTab `customerRrn={rrnFull ?? undefined}` 전달

## AC 체크

- [x] AC-1: [보험차트] 열 때 빨간 박스 위치에 고객 성함 자동 표시
- [x] AC-2: 동일 위치에 주민번호 자동 표시 (전체, 마스킹 없음)
- [x] AC-3: 양식 선택 패널 명칭 [보험차트]
- [x] AC-4: 양식 헤더 명칭 [보험차트]
- [x] AC-5: 자동 채움 (수동 입력 불필요)
- [x] AC-6: 발건강 질문지·환불동의서 무영향
- [x] AC-7: 빌드+E2E 회귀 없음
- [x] AC-8: 주민번호 전체 표시(마스킹 제거)

## DB 변경

- `20260524000001_pen_chart_rename_insurance.sql`: `form_templates` UPDATE (`pen_chart` → `[보험차트]`)
- Rollback: `UPDATE form_templates SET name_ko = '펜차트 양식' WHERE form_key = 'pen_chart'`

## E2E spec

`tests/e2e/T-20260523-foot-PENCHART-INSURANCE.spec.ts` — AC-1~7 8개 검증

## 빌드

`npm run build` ✓ 빌드 OK

## 배포 이력

- 2026-05-24 00:46 KST — commit 4e27447 (명칭+위치 정정) main push
- 2026-05-24 10:53 KST — commit 5798b62 (AC-8 주민번호 마스킹 제거) main push
- 2026-05-24 — supervisor QA PASS + deployed (T-20260523-foot-PENCHART-FORM-AUTOFILL 배포 스트림 포함)
- 2026-05-26 — FIX-REQUEST(MSG-20260526-081019-xz3a): spec/구현 불일치 수정
  - 원인: 2026-05-24 현장 요청(김주연 총괄: "성함+주민번호 한 줄, 폰트 축소")으로
    구현이 `PENCHART_AUTOFILL_POS` 세로 스택 → `drawPenChartAutofillInline` 1줄 inline으로 변경됐으나
    spec이 추적 안 된 상태
  - 수정: spec AC-1/AC-2·AC-5를 `drawPenChartAutofillInline` 기반으로 재작성
  - commit 342da1d — 빌드 3.56s OK, DB변경 없음
