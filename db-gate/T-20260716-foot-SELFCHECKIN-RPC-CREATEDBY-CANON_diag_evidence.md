# T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — REOPENED DIAG + FIX evidence

**dev-foot / 2026-07-19 · READ-ONLY DIAG → ADDITIVE FIX (supervisor 게이트 대기)**

## 1. 근인 확정 (prod introspection, READ-ONLY, mgmt api @ rxlomoozakkjesdqjtvd)

셀프체크인 new-visit 실호출 경로를 런타임 추적한 결과, **CANON 이 스탬프한 함수 ≠ 키오스크 실호출 함수**.

### 1.1 실호출 경로 (런타임 추적)
- 키오스크 = 별도 레포 **foot-checkin** (`foot-checkin.pages.dev`, obliv 의 native SelfCheckIn 은 06-02 제거됨).
- `foot-checkin/src/pages/SelfCheckIn.tsx` L1748: 워크인/직접입력 raw 동선(=신규 초진 정상경로)은
  **`fn_selfcheckin_upsert_customer_resolve_v3`** 를 호출(T-20260628 ANON-KIOSK-CUTOVER 로 일원화).
  → 이 함수의 `'created'` 분기 INSERT 가 신규 customers row 생성 주체.
- 이어 `self_checkin_with_reservation_link` 호출은 customer_id 를 이미 v3 가 해소해 전달 → 신규 INSERT 미발화
  (단, v3 resolveErr 시 customerId=null → link RPC 의 genuine-new INSERT 가 2차 landing 벡터).

### 1.2 prod 함수별 customers INSERT created_by 스탬프 실측
| 함수 | INSERT created_by 스탬프 | live path |
|------|------|------|
| `self_checkin_with_reservation_link(uuid,jsonb,date)` | **NO ✗** | 2차(폴백) |
| `fn_selfcheckin_upsert_customer` (base/v1) | YES ✓ | 미사용 |
| `fn_selfcheckin_upsert_customer_resolve_v2` | YES ✓ | 미사용(구경로) |
| **`fn_selfcheckin_upsert_customer_resolve_v3`** | **NO ✗** | **★실호출** |
| `self_checkin_create(text,text,text)` | YES ✓ | dead(레거시, 키오스크 미호출) |

### 1.3 실저장값 대조
- `customers` 최근 30일: total=450, **created_by NOT NULL=0**, `='self_checkin'`=0.

### 1.4 지문 판정
- **(a) 실호출이 스탬프 없는 함수 = 확정 근인.** CANON stamp 는 base(v1)+v2 에만 적용, **v3(=live path) 누락**.
- **(c) OOB divergence = 동반 근인.** base/v2 의 stamp 는 **git migration 어디에도 없음**(20260714 의 유일한
  created_by 는 `self_checkin_create` 블록). = base/v2 는 prod 에 OOB 적용됨 → "introspection 함수 실재
  (self_checkin_create/base/v2) ≠ 스탬프 실동작(live=v3 unstamped)".
- **(b) INSERT 후 UPDATE NULL 덮음 = 반증.** v3·link 의 `UPDATE customers SET …` 에 created_by 부재
  (스크립트 assert: UPDATE SET 에 created_by leak 0). 덮어쓰기 아님.

## 2. 수정 (ADDITIVE, INSERT-only, prod-verbatim canon-forward)
`20260719120000_selfcheckin_v3_reservlink_createdby_stamp.sql`
- `fn_selfcheckin_upsert_customer_resolve_v3` — `'created'` 분기 INSERT 에 `created_by='self_checkin'` 가산.
- `self_checkin_with_reservation_link` — genuine-new(`v_match_count=0`) INSERT 에 `created_by='self_checkin'` 가산.
- **UPDATE(linked/기존고객) 경로 무변경** — new-write-only(旣 NULL 덮어쓰기 금지 계약 준수).
- 스키마/컬럼/enum/시그니처/GRANT 무변경. `customers.created_by` 컬럼 旣존재. base(prod pg_get_functiondef 2026-07-19 verbatim).

## 3. 검증
- **prod 무영속 dry-run**: BEGIN…ROLLBACK 통과 + post-probe 무영속 확인(prod 정의 여전히 ABSENT). ✓
- **dev-isolation 기능검증**(`kcdqtyivtqcjmcrdjkqi`, `scripts/..._verify_dev.mjs`): 6/6 PASS
  - resolve_v3 new INSERT → `created_by='self_checkin'` ✓
  - reservation_link genuine-new walk-in → `created_by='self_checkin'` ✓
  - resolve_v3 linked(기존고객, legacy NULL) → created_by **미변경**(UPDATE 무클로버) ✓
- **build**: `npm run build` ✓

## 4. 게이트 / 배포
- read-only DIAG = 착수게이트 불요.
- ADDITIVE 함수 DDL → **supervisor DDL-diff + MIG-GATE** 만(부모 Q5 DA-cleared 계승, 신규 데이터정책 자문 불요).
- 적용 미실행(운영 DB 스키마 변경 = supervisor 사전승인). apply 스크립트: `scripts/..._apply.mjs --apply`
  → DDL-ATOMIC applied_at evidence(`db-gate/..._applied_evidence.json`) 자동 생성.
- **Phase2 백필 freeze 전제(T-20260719-foot-RRN-ENC-DESK-CONSENT-GATE 결정 B)**: 본 fix 배포 후에야
  신규 self_checkin row 가 스탬프 실동작 → freeze 대상셋(created_by='self_checkin' 확정 가능) 성립.
