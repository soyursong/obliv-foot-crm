# T-20260630-foot-STAFF-USERID-BACKFILL-ATTRIB — 옵션 택일 결정 + 중복 정합 기록

> dev-foot 결정 기록 (2026-07-01). DA CONSULT GO 조건2 후속 트래킹.
> **결론: 옵션(a) 채택 — 단, 실행 트랙은 형제 티켓 `T-20260630-foot-STAFF-AUTH-LINK-BACKFILL`(deploy-ready, supervisor DB 게이트 대기)가 이미 소유·수행. 본 ATTRIB 티켓은 독립 DB/코드 변경 없음.** 옵션(b)는 기술적 부적합 + 불필요 스키마 표면 → 기각.

## 1. 배경

parent `T-20260630-foot-PENCHART-HEALTHQ-CODY-LINKPERM`에서 `fn_health_q_create_token` **인가 게이트**는 정규신원(`is_approved_user()`+clinic)으로 이동. 그러나 `created_by` attribution 은 여전히 `staff.id` 기준(`v_staff_id = staff WHERE user_id=auth.uid()`)이라, staff.user_id 미연결 발급자는 `created_by` NULL 공백. 본 티켓은 그 발급자 audit(created_by) 공백 해소 트래킹.

## 2. 핵심 기술 사실 (택일의 근거)

### `created_by` 는 `staff.id` FK — auth.uid() 직접 저장 불가
`health_q_tokens.created_by UUID REFERENCES staff(id) ON DELETE SET NULL` (20260529000000_health_q_mobile.sql L29).
- `auth.uid()` = **auth 신원 = staff.user_id** 값이지 **staff.id 가 아님**. FK 불일치 → `created_by`에 auth.uid() 저장 불가.
- 함수 본체(REGRESS4 20260629143000 / LINKPERM 20260630181500 동일): `SELECT id INTO v_staff_id FROM staff WHERE user_id=auth.uid()` → 미연결 staff 는 매칭 0행 → `v_staff_id=NULL` → `created_by=NULL`.
- 즉 attribution 회복의 유일 경로 = **staff.user_id 링크 회복(옵션 a)**. 링크되면 함수가 v_staff_id 를 정상 해석 → created_by 자동 적재.

## 3. 옵션 택일

### 옵션(a) staff.user_id 링크 backfill — **채택 (root-fix)**
미연결 staff↔user_profiles 링크 시 `fn_health_q_create_token`뿐 아니라 staff.user_id 의존 전 경로(SELECT 정책 등)가 함께 수혜. DA 권고 우선안.

- **실행 소유 = 형제 티켓 `T-20260630-foot-STAFF-AUTH-LINK-BACKFILL`** (status: deploy-ready → supervisor DB 게이트 집행 대기).
  - DA CONSULT ✅ 부분-GO (MSG-20260701-034334-qxef): 'bulk backfill' → **감독형 신원 정합(supervised identity reconciliation)**, 결정적 2-factor OR 권위 현장확인.
  - AC-3 현장확인 ✅ 김주연 총괄 (2026-07-01, ts 1782859741.988249, "맞아").
  - 확정 매핑 **targeted 단건 2건**: 박민석(active coordinator, `fd54a977…`→`dad7dc00…`) / 문지은(대표원장 director, `b46abc6d…`→`d343769a…`).
  - `_apply.sql`/`_rollback.sql`/`_postverify.mjs` 구비, precheck+dryrun ALL PASS. **prod write 0 — supervisor DB 게이트가 apply 집행**.
- **본 ATTRIB 티켓은 이 DB write 를 중복 실행하지 않음** (PHI-attribution 중복 write 금지). AUTH-LINK-BACKFILL apply COMMIT 시점에 ATTRIB AC-1 이 동시 충족됨.

### 옵션(b) auth.uid() 보조 캡처 — **기각**
1. **기술 부적합**: created_by=FK(staff.id)라 auth.uid() 저장 불가. '보조 캡처'는 사실상 **신규 audit 컬럼**(`created_by_auth_uid` 등) 추가를 요구 → §S2.4 데이터 정책 자문 게이트(data-architect CONSULT) 선행 대상. 함수-only ADDITIVE 아님.
2. **불필요 표면**: DA 는 AUTH-LINK-BACKFILL CONSULT 에서 NONPERSON(장비/테스트/플레이스홀더)·OCCUPIED·NO_MATCH 의 `created_by` NULL = **expected-NULL(설계상 정상, 결함 아님)** 로 확정. 실인물 미연결은 (a)로 링크됨(박민석/문지은). 즉 (a) 적용 후 '실인물인데 미연결이라 audit 공백'인 잔여 발급자 = 0 → (b) 신규 컬럼의 순편익 0.
→ 신규 스키마 표면 추가는 정당화 불가. (a)로 근본 해소되므로 (b) 미채택.

## 4. "미연결 coordinator 5명" 전제 정정

AUTH-LINK-BACKFILL dry-run(prod read-only 실측) 결과 티켓 전제 무효:
- 실측: staff 총 67 / 미연결 44 (전 역할). '7'은 **user_profiles** coordinator 수(staff 아님) — 두 테이블 혼동.
- 미연결 44 분류: NONPERSON 30 / NO_MATCH 6 / OCCUPIED 4 / NAME_ONLY 4. 실인물 확정 backfill = **2건뿐**(박민석·문지은). 나머지 = carve-out(NULL 유지, 설계상 정상 or 별트랙 ROSTER-DEDUP).

## 5. AC 매핑

- **AC-1** (created_by NULL 공백 해소): 옵션(a)로 해소. AUTH-LINK-BACKFILL apply(supervisor 게이트) COMMIT 시 실인물 2건 created_by 적재 회복. 잔여 NULL = expected-NULL(NONPERSON/OCCUPIED/NO_MATCH) = DA 확정 by-design → 공백 아님. ✅ (실행 트랙 = 형제 티켓)
- **AC-2** (기존 연결 coordinator 무회귀): AUTH-LINK-BACKFILL 은 `user_id IS NULL` 삼중 WHERE 가드 → 연결자 무변경. carve-out 42건 미변경 dry-run 검증. ✅
- **AC-3** (오매핑 0): (a) 채택, 추정 매핑 0 — 김주연 총괄 권위 현장확인 증거 건별 기록. (b) 미채택(토큰 본체 무접촉). ✅
- **AC-4** (parent LINKPERM 영향 0): 본 결정 = 독립 트래킹, parent blocker 아님. DB write 0(중복 금지). ✅

## 6. 권고 (planner)

본 ATTRIB 티켓은 `T-20260630-foot-STAFF-AUTH-LINK-BACKFILL`(option a 실행체, deploy-ready)에 **covered-by** 관계. 독립 산출물 없음(중복 DB write 금지). → planner lifecycle 상 **AUTH-LINK-BACKFILL 로 fold / covered-by close** 권고. 옵션(b)는 기각(신규 컬럼 = §S2.4 게이트 + 순편익 0). non-blocking P2, parent 독립 유지.
