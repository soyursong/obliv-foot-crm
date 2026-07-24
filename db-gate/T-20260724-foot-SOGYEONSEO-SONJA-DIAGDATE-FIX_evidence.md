# T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX — 조사 evidence & 판정

- 요청: 김주연 총괄 (via responder) — 손정아 F-4673 신규발행 소견서 진단일 2026-07-24 → **2026-07-22** 정정 ("이번꺼만")
- 조사: dev-foot, 2026-07-24 · **READ-ONLY (prod write 0)**
- 대상 고객: 손정아, `customer_id=4f85924b-07c5-4586-a783-68cdae6ce5f2`, chart `F-4673`, jongno-foot

## 1. 스코프 고정 (count 기준 일괄 금지 준수)

소견서(opinion_doc, `field_data.final_text` 보유) 발행본은 **정확히 2건**:

| id | status | created_at (UTC) | published_at (KST) | final_text 내 진단일 |
|----|--------|------------------|--------------------|--------------------|
| **34998176-13cc-4f80-bd8c-4a6bb8096382** ★최신 | **published** | 2026-07-24T04:08:53 | 2026-07-24T13:08:53 | **2026년 07월 24일** |
| eb47d3d8-08cd-4920-9f06-ac1f5d6cedd7 | published | 2026-07-23T11:45:22 | 2026-07-23T20:45:22 | 2026년 07월 23일 |

→ `F-4673 + created_at 최신` = **34998176…** (신규발행 소견서). 진단일이 07-24로 박제됨.

## 2. 결정적 판정 — id-scope UPDATE **물리적·법적 불가**

1. **별도 `diagnosis_date` 필드 없음.** 소견서 진단일은 `field_data.final_text` **산문**에 박제됨
   ("상기환자는 … **2026년 07월 24일**에 내원하였고 …"). jsonb_set 으로 찍을 스칼라 필드가 없음.
2. **대상 행 status = `published` = 의무기록.**
3. **`form_submissions_published_immutable_guard` 트리거(의료법 제22조)** — migration
   `20260616160000_opinion_doc_form_stack.sql` SECTION 1(C1, CRITICAL). `OLD.status='published'` 이면
   BEFORE UPDATE OR DELETE 에서 RAISE. **RLS 우회 경로(service_role 포함) 이중방어** 명시.
   → dev 가 service_role 로 시도해도 차단. `field_data`/`final_text` 정정 **불가**.
   에러 문구 자체가 정책: *"발행된 의무기록(소견서·검사결과지)은 수정·삭제할 수 없습니다 — 정정은 신규 발행으로만 가능합니다."*

**결론: 요청된 "이번꺼만 진단일 UPDATE"는 draft 분기가 아니라 published 분기 → 의료법 append-only 재확인됨 → dev 범위 내 데이터 UPDATE 처리 불가.**

## 3. 합법 정정 경로 (append-only)

- **문지은 대표원장이 CRM에서 소견서를 신규 발행** — 발행 시 **날짜란에 2026-07-22 를 직접 입력**.
  (신규발행본 `field_data.supersedes_id` = 34998176… 로 이전본 대체. RPC `publish_opinion_doc` = 진료의 전속.)

## 4. 재발 근본원인 (왜 새로 발행해도 07-24 로 나왔나)

- `src/components/doctor/OpinionDocTab.tsx:804` — `setDocDate(initialDate || todaySeoulISODate())`.
  소견서 날짜(`[날짜]` 치환 소스 `docDate`)의 **기본값 = 실장 요청일(request_date) 또는 오늘(KST)**.
- 손정아 케이스: 실 **내원일 = 2026-07-22**(계산서/영수증/처방전 `visit_date` 는 07-22 로 정상),
  그러나 소견서 날짜 기본값이 요청일/오늘(07-24)로 prefill → 원장이 그대로 발행 시 07-24 로 박제.
- **코드 수정 후보**: 소견서 날짜 기본값을 그 내원의 `visit_date`(치료테이블/내원일)로 seed.
  단, **OpinionDocTab = 진료관리/의료문서 authoring → §11 medical_confirm_gate 대상.
  문원장 컨펌(confirm_status: confirmed) 선행 전까지 dev 착수 금지.** planner 게이트 필요.

## 5. 산출물 (READ-ONLY)

- `scripts/T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX_inspect.mjs` — 전수 조회
- `scripts/T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX_evidence.mjs` — before-state 스냅샷
- prod write: **0건** (SELECT only)
