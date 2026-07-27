# T-20260727-foot-SRCREGNAME-TMPREFIX-STRIP-BACKFILL — AC0 DIAGNOSE-FIRST 결과

- 실행: 2026-07-27, dev-foot
- 성격: **read-only 진단** (SELECT only, NO write / NO DDL / 데이터 무변경)
- DB: prod rxlomoozakkjesdqjtvd (VITE_SUPABASE_URL, service_role)
- 스크립트: `scripts/T-20260727-foot-SRCREGNAME-TMPREFIX-STRIP-BACKFILL_diag.mjs`

## 판정: 실 UPDATE 게이트 STOP → planner FOLLOWUP (speculative 발번 금지)

티켓이 가정한 **foot 미러(`도파민 TM : ` prefix 오염 레거시행)가 foot에 실재하지 않음.** 대상셋(freeze) = **0 rows**.

---

## AC0-1 저장위치 확정

| 위치 | prefix('도파민 TM :') 오염 | 강솔희 포함 | 비고 |
|------|--------------------------|------------|------|
| (a) `reservations.registrar_name` | **0 건** (source 무관, 전각/반각 콜론·공백 변형 포함) | 3 건 | 값 = `[도파민TM] 강솔희` (콜론 prefix 아님) |
| (b) `staff.name` (총 77) | 0 건 | 0 건 | STOP-class 오염 없음 |
| (b) `reservation_registrars.name` (총 16, TM 마스터) | 0 건 | 0 건 | 마스터 미오염 |

- `reservations.registrar_name` NOT NULL 총 733건 중 `/^\s*도파민\s*TM\s*[:：]\s*/i` 매칭 = **0건**.
- `source_system='dopamine' ∩ prefix` 지문 교집합 대상셋 = **0건**.

## AC0-1 강솔희 실 저장값 (reporter 첨부 F0BL3NFJ7FE 대조 필요)

강솔희 3건 모두:
```
src=dopamine  registrar_id=NULL  created_by=NULL  registrar_name="[도파민TM] 강솔희"
```
- 저장값은 `[도파민TM] 강솔희` — **대괄호 provenance 라벨**이지 `도파민 TM : ` 콜론 prefix가 아님.
- 두 문자열은 **별개**: `[도파민TM] {name}` 은 foot ingest EF 가 마스터 무매칭 시 부여하는 §416 provenance fallback 라벨(T-20260630-foot-INGEST-REGISTRAR-CREATEDBY). 티켓 HARD scope regex(콜론 필수)에 미매칭.
- `[도파민TM]` 라벨 fallback 행 = 전체 11건 (본 티켓 대상 아님).

## AC0-3 forward-durability

- foot ingest EF(`reservation-ingest-from-dopamine`)는 emit `registrar_name` 을 **concat 하지 않음**. 로직:
  - 마스터(reservation_registrars, group='TM', clinic, active) name 매칭 → `registrar_id` + 마스터 스냅샷.
  - 무매칭/조회에러 → `registrar_id=NULL` + `[도파민TM] {trim(emit_name)}` provenance 라벨.
- 강솔희 착지값이 `[도파민TM] 강솔희`(라벨 안쪽 이름 clean) → **도파민 emit 이 이미 clean `강솔희` 를 운반 중**. 만약 emit 이 `도파민 TM : 강솔희` 였다면 착지값은 `[도파민TM] 도파민 TM : 강솔희` 여야 함(실측 아님).
- 표시 헬퍼 `resolveRegistrarDisplay`(src/lib/types.ts) 는 registrar_name 을 **verbatim** 반환 — 렌더 계층 `도파민 TM : ` prefix 장식 부재. `도파민 TM :`(콜론) 리터럴은 src/ 전역 부재.

## HARD INVARIANT

- 대상셋 후보 중 `created_by != NULL` = **0건** (§416/§963⑤ NULL HARD INVARIANT 유지).

---

## dev-foot 조치

1. **실 UPDATE 미실행** — 대상셋 freeze = 0 rows. 티켓 HARD scope(`도파민 TM :` prefix) 에 해당하는 foot 행 없음. dry-run/rows-affected/confirm 게이트 진입 불가(정정 대상 부재).
2. `[도파민TM] 강솔희` 라벨을 임의 strip **하지 않음** — 이는 별개 RC(§416 provenance fallback)로 티켓 scope 밖. speculative 정정 금지.
3. planner FOLLOWUP 발행 — 아래 2개 확인 견인:
   - Q1: reporter(진운선 파트장) 첨부 F0BL3NFJ7FE 의 "현재 저장값 `도파민 TM : 강솔희`" 이 foot `[도파민TM] 강솔희` 라벨의 전사(轉寫)인가, 아니면 도파민(tm-flow) 측 화면/다른 컬럼의 표시값인가?
   - Q2: 만약 reporter 요구가 `[도파민TM]` 대괄호 라벨 자체 제거라면 → §416 provenance 라벨 정책 재검토 필요한 **신규 scope**(별도 티켓 + DA consult). 본 백필 티켓으로 처리 불가.
