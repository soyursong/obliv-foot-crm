# T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE — AC-0/AC-1 evidence (DB게이트용)

> 상태: **의료 confirm 게이트 대기 + supervisor DB게이트 대기** (AC-1 apply 미실행, AC-2 FE 미수정)
> 영역: 진료관리(소견서/진단서) → §11 medical_confirm_gate 대상. 티켓 frontmatter 게이트 필드 부재 → planner FOLLOWUP `medical_confirm_pending` 발행함.

## AC-0 트리아지 (READ-ONLY, 확정)
스크립트: `scripts/...PHRASE-LITERAL-ESCAPE_ac0_scan.mjs` (form_templates 전수 29 template 스캔)

| 항목 | 결과 |
|------|------|
| 영향 template | **1개 = `opinion_doc` (소견서, id=c51efeba-f484-4dd9-9a61-e495dfe6e8d0)** |
| 리터럴 `\n`(backslash+n 2글자) 포함 phrase 노드 | **10건** (sections[0].options[1,2] + sections[1].options[0,2,4,5,13,14,15,22]) |
| HTML 엔티티(`&lt;`/`&gt;`/`&amp;`/`&quot;`) 포함 노드 | **0건** (전체 form_templates) |
| raw `<` 포함 노드 | **0건** (전체 form_templates) |

### RC 재확인 (dev, 코드근거)
- `bindHtmlTemplate` (src/lib/htmlFormTemplates.ts:1923-1935, LOGIC-LOCK L-006) = 전 양식 단일 바인딩 게이트
  - `.replace(/&/g,'&amp;')` → 저장된 `&lt;`가 있으면 `&amp;lt;`로 이중인코딩 → 브라우저에 `&lt;` 그대로
  - `.replace(/\n/g,'<br>')` → **실제 개행(0x0A)만** 매칭. 리터럴 `\n`(2글자)는 미매칭 → 문자열 그대로 출력
- 출력 경로: DocumentPrintPanel.tsx:2687-2711 `getHtmlTemplate→bindHtmlTemplate→dangerouslySetInnerHTML`
- 합성 경로: src/lib/opinionDocCompose.ts `composeOpinionDoc`가 phrase를 editor 본문(SSOT)으로 주입 → 리터럴 `\n` 그대로 전달됨

### ⚠️ 중요 발견 — `<`/`&lt;` 증상은 form_templates phrase에 **없음**
- 문지은 대표원장 보고의 `<` 리터럴 증상은 form_templates에 entity/raw `<` 0건이므로 **phrase 데이터 정정(AC-1)만으로 해소되지 않음**.
- `<`/`&lt;` 출처 후보: (a) 원장 작성창 수기입력 텍스트 (b) 발행본 form_submissions.field_data 저장 내용. 모두 **bindHtmlTemplate 단일 게이트를 통과**.
- ⟹ **AC-2 (FE 이중인코딩 방어)는 "권장"이 아니라 `<` 증상 해소의 필수 조건**. AC-2가 모든 surface(작성/발행/재발행)의 리터럴 `\n`·엔티티를 render 시점에 정규화하므로 근본·범용 차단.

## AC-1 데이터 정정 dry-run (미적용)
스크립트: `scripts/...PHRASE-LITERAL-ESCAPE_ac1_dryrun.mjs` (READ-ONLY, 적용 안 함)
- 교정 규칙: 리터럴 `\n`→실제 개행, (방어적) `&lt;`→`<` 등 — form_templates엔 엔티티 0건이라 실질 변경=리터럴 `\n`→개행 10건
- before/after diff 전량 확인 완료 (예: sections[1].options[2] `내원하심.\n환자는` → `내원하심.`+개행+`환자는`)
- 생성물:
  - apply: `scripts/...PHRASE-LITERAL-ESCAPE_ac1_apply.sql` (BEGIN/COMMIT, `UPDATE form_templates SET field_map=...::jsonb WHERE id='c51efeba...'` 1행, 리터럴 backslash-n 잔존 0 검증)
  - rollback: `scripts/...PHRASE-LITERAL-ESCAPE_ac1_rollback.sql` (현행 field_map 원문 복원 1행)
- DDL **0** (신규 컬럼/테이블/enum 없음) → data-architect CONSULT 불요
- 범위: opinion_doc 1행만 UPDATE. 저장경로 미접촉(UUID-EMPTYSTRING-SAVEFAIL 회귀 안전).

## 게이트 통과 후 실행 순서 (예정)
1. (의료 confirm 게이트 confirmed + supervisor DB게이트 GO 후) AC-1 apply 스크립트로 apply.sql 실행 → 영속 검증
2. AC-2 `bindHtmlTemplate` 정규화 추가 (리터럴 `\n`→개행, 엔티티 디코드 후 단일 인코딩)
3. AC-3 build + E2E spec + 현장확인(갤탭) → deploy-ready
