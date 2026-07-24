---
id: T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX
domain: foot
type: data-correction
priority: P0
status: escalated-to-field
db_change: false
code_change: false
medical_confirm_gate: required
data_consult: n/a (no schema change, no bulk UPDATE, read-only diagnosis)
target: 손정아 / F-4673 / 소견서(opinion_doc) 진단일 → 2026-07-22
owner: dev-foot
created: 2026-07-24
---

# 손정아(F-4673) 소견서 진단일 정정 — 진단·에스컬레이션

## 요청 (planner PUSH, P0)
- 대상: 손정아 / 차트 F-4673 / 소견서 진단일 → **2026-07-22**
- 스코프: 정확히 F-4673 단일. count/조건 일괄 UPDATE 금지, id·차트번호 scope 고정.
- 진단 포인트: form_submissions status(draft/published) 확인
  - published → 의료법 append-only. **직접 DB 정정 금지**. 원장 CRM 신규 발행 필요 여부를 현장에 확인.
  - draft → field_data 진단일 직접 정정 후 재발행.

## 진단 결과 (read-only, service_role)
- 고객 확정: `customers.id=4f85924b-07c5-4586-a783-68cdae6ce5f2`, chart_number=F-4673 (단일 매칭, phone-scope 단일 확인 — 값은 PHI로 미기록).
- 소견서 템플릿: `form_templates.id=c51efeba-f484-4dd9-9a61-e495dfe6e8d0`, form_key=`opinion_doc`, name_ko=소견서.
  - 진단일은 개별 필드가 아니라 `field_data.final_text`의 `[날짜]` placeholder("YYYY년 MM월 DD일에 내원하였고 …")로 렌더된다.
- F-4673 소견서(opinion_doc) 레코드 = **2건, 모두 status=published**:

| id | status | created | 진단일(final_text 임베드) |
|----|--------|---------|----------------------------|
| eb47d3d8-08cd-4920-9f06-ac1f5d6cedd7 | **published** | 2026-07-23 11:45Z | 2026년 07월 23일 |
| 34998176-13cc-4f80-bd8c-4a6bb8096382 (최신) | **published** | 2026-07-24 04:08Z | 2026년 07월 24일 |

- **draft 소견서 없음.** 동일 template_id를 공유하는 나머지 레코드(draft/printed/voided)는 doc_kind 없음·final_text 없는 인쇄 로그성 레코드 → 소견서 아님, 대상 아님.

### before / after (evidence)
- before: 소견서 진단일 07-23(eb47d3d8), 07-24(34998176)
- 요청 after: 2026-07-22
- **after 적용 없음** — 아래 사유로 직접 DB 정정 미실행.
- 원본 스냅샷: `scripts/T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX_PRE.json`

## 판정 — 직접 DB 정정 미실행 (published 경로)
두 소견서 모두 `status=published` = 원장 발행본. 의료법 append-only + planner 프로토콜(published→직접 정정 금지) + §11 진료관리 medical gate 3중 근거로 **field_data 직접 UPDATE 하지 않음.**
정정 경로 = 문지은 원장이 CRM에서 진단일 2026-07-22로 **소견서 신규 발행**. → 현장 총괄 확인 필요.

## 액션
- responder MQ TICKET-UPDATE(relay_to_slack) 로 현장(총괄 김주연, thread 1784877894.599289)에 진단결과+신규발행 확인 요청 전달.
- 현장이 "신규 발행" 확정 시: 원장 발행 → 완료 확인. (dev-foot는 published 문서 직접 미수정)
