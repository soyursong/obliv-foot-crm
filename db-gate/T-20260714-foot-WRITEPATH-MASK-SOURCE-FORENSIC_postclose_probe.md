# T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC — POST-CLOSE 검증 (READ-ONLY, mutation 0)

**작성**: dev-foot / 2026-07-14 (planner 2h-PUSH MSG-20260714-235756-6nsg 대응)
**프로브**: `scripts/T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC_postclose_probe.mjs` (READ-ONLY, Management API)
**기준선**: REPRO Phase2 소스차단 apply = **2026-07-14 10:32:40 KST** (=01:32:40 UTC), commit 4cdbf8cc/e05de9cc

---

## 결론 요약 (planner PUSH 3문항 회신)

| 질문 | 답 |
|------|-----|
| write-path 열거 진척 | **완료** — customers INSERT/UPDATE 하는 anon 함수 11개 열거. REPRO 가드 4개 / **미가드 7개** |
| apply 영속 확증 | **확증** — post-probe: helper `_fn_is_masked_pii` n=1 + 4 RPC 전부 가드 지문 present |
| (i) 무영속 / (ii) 2차벡터 | **(i) 아님(영속 확증). (ii) 확정·확장** — REPRO는 11개 중 4개(upsert-family INSERT)만 가드. 나머지 미가드 경로로 유입 지속 |
| 소스 닫힘? | **❌ 미차단** — apply 8h 후(18:34 KST) 신규 masked row 1건 생성 |

---

## 1) 가드 영속 확증 (= apply 무영속 hazard 반증)

```
helper _fn_is_masked_pii n=1  (순수 predicate, anon EXECUTE)
✅ fn_selfcheckin_upsert_customer            guard_present=true
✅ fn_selfcheckin_upsert_customer_resolve_v2 guard_present=true
✅ fn_selfcheckin_upsert_customer_resolve_v3 guard_present=true
✅ self_checkin_create                        guard_present=true
```
→ REPRO 4-RPC 가드는 prod에 **영속·실재**. 가설 (i) apply 무영속 = **반증**.

## 2) 소스 미차단 확증 (핵심 반증)

apply(10:32 KST) **이후** 생성된 masked row = **정확히 1건** (customers + check_ins 각 1):

```
customers  e3216e83-3037-4921-9e26-76cd14b92b1e
  name="접****1" phone="7887" chart_number=F-4759
  created_at=2026-07-14 09:34:14 UTC = 18:34 KST   ← apply(01:32 UTC) +8h
  updated_at=2026-07-14 11:31:31 UTC = 20:31 KST
check_ins  d648b809-8293-49a0-905a-1114719d789a
  customer_name="접****1"  reservation_id=NULL  created_by=NULL(anon)
  created_at=2026-07-14 09:34:15 UTC (customer +0.5s)  status=done
```

- **INSERT 시점 마스킹 확정**(later-UPDATE 아님): check_in `completed_at`=11:31:31 UTC = customer `updated_at`과 동일 → 20:31 KST 갱신은 **체크인 완료(status→done)** 이지 name 재마스킹 아님. name은 18:34 생성 순간 이미 `접****1`.
- guard predicate 판정: `_fn_is_masked_pii('접****1','7887')` = **true** → 가드 경로였다면 22023 reject 되었어야 함. 통과했다 = **미가드 경로 유입**.
- 시그니처(reservation_id NULL + check_ins denorm 마스킹 + created_by NULL + phone 4자리) = 기존 phantom과 동일 계열.

## 3) write-path 전수 열거 (customers INSERT/UPDATE, anon-exec)

| 함수 | INS | UPD | REPRO가드 | WS-A hold | 상태 |
|------|-----|-----|-----------|-----------|------|
| fn_selfcheckin_upsert_customer | ✔ | ✔ | 🛡 | – | 가드 |
| fn_selfcheckin_upsert_customer_resolve_v2 | ✔ | ✔ | 🛡 | – | 가드 |
| fn_selfcheckin_upsert_customer_resolve_v3 | ✔ | ✔ | 🛡 | – | 가드 |
| self_checkin_create | ✔ | ✔ | 🛡 | – | 가드 |
| **self_checkin_with_reservation_link** | ✔ | ✔ | ✗ | ✔(hold) | **미가드**(REPRO helper 부재) |
| **fn_dashboard_reissue_health_q_token** | ✔ | ✔ | ✗ | ✗ | **미가드 INSERT** |
| **upsert_reservation_from_source** | ✔ | – | ✗ | ✗ | **미가드 INSERT** |
| fn_complete_prescreen_checklist | – | ✔ | ✗ | ✗ | 미가드 UPDATE |
| fn_selfcheckin_rrn_match | – | ✔ | ✗ | ✗ | 미가드 UPDATE |
| fn_selfcheckin_update_personal_info | – | ✔ | ✗ | ✗ | 미가드 UPDATE |
| save_customer_address | – | ✔ | ✗ | ✗ | 미가드 UPDATE |

→ REPRO는 **11개 중 4개(upsert-family)만** 마스킹-reject 가드. **INSERT-capable 미가드 3개**(self_checkin_with_reservation_link / fn_dashboard_reissue_health_q_token / upsert_reservation_from_source) = 신규 masked row 유입 경로.
- `self_checkin_with_reservation_link` 은 WS-A hold 지문 보유하나 REPRO helper 부재 + hold 경로는 customer_id NULL sentinel 생성(linked masked row 미생성) → e3216e83(정상 link)는 이 hold 경로 아님.
- ⇒ **DEFENSE 티켓 전제("미가드 7경로=비활성/키오스크 미호출")가 라이브 데이터로 반증.** REPRO fix가 **불완전**(scope 4/11).

## 판정 & 블로커

- **(i) 반증 / (ii) 확정·확장.** 소스 **여전히 개방** — REPRO 미커버 INSERT 경로로 마스킹 유입 지속(마지막 18:34 KST 07-14).
- **블로커(1줄)**: INSERT-capable 미가드 3경로 중 정확한 벡터 특정 + `_fn_is_masked_pii` 가드 확장 = write-path 함수 CREATE OR REPLACE(db_change=true) → **DA CONSULT 1차게이트 + supervisor DDL-diff 선행**(§S2.4, CONSULT-REPLY 前 apply/deploy-ready 금지).
- **권고**: 소스차단 fix RE-SCOPE — REPRO helper(DA GO 旣확보)를 INSERT-capable 미가드 3경로에 확장(fail-closed reject). 회귀 0(정상 성함 write 통과) 검증. UPDATE-capable 4경로는 2차(정상 write가 masked로 UPDATE할 수 없으므로 후순위).
- **하류**: CONTAM-BACKFILL freeze 대상에 e3216e83 추가(소스 진짜 차단 후).
