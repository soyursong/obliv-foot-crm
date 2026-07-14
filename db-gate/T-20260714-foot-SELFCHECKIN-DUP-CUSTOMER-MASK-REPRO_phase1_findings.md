# T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 1 재현·포렌식 (READ-ONLY)

> READ-ONLY prod 검증 (Management API). UPDATE/DELETE/INSERT **0**.
> PHI 위생(§4): 실명/전체번호 미기재 — 8자 PK·length·tail 4자리만.
> 실행: dev-foot / 2026-07-14 09:37 (KST).
> 스크립트: `scripts/T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO_phase1{,b}.mjs`
> 상위: 현장 재보고 MSG-20260714-093008-tlrn (김주연 총괄) · 첨부 F0BGXAVFXH9

---

## ★ 결론 요약

| 항목 | 결과 |
|---|---|
| **현장 재보고 확증** | ✅ 참 — 셀프접수 시 masked customer 신규 + 차트 2개 + 통합시간표 중복 **재현** |
| **WRITEPATH-FORENSIC "소스 닫힘" 전제** | ❌ **반증(INVALIDATED)** — 07-14 **09:27:45** 신규 masked customer 생성(=01:15 clean 선언 이후) |
| **실제 근본원인 (2차 벡터)** | self_checkin 이 아니라 **미가드 anon upsert RPC**(`fn_selfcheckin_upsert_customer[_resolve_v2/v3]`)가 마스킹 customer row 를 INSERT. self_checkin 은 그 masked row 에 `customer_id` 로 정상 link(denorm=raw=마스킹값). |
| WS-A 가드 상태 | ✅ prod live (지문 present) — **그러나 8경로 중 self_checkin 1개만 가드 → 우회됨** |
| ANON-WRITEPATH-MASK-GUARD-DEFENSE(P2, non-blocking) 전제 | ❌ **반증** — "미가드 7경로는 키오스크 미호출·비활성벡터" 가정이 틀림. 그 중 하나가 **본 사고 활성 벡터**. → **P1 승격 + 본 티켓의 실질 fix** |
| Phase 2 fix 게이트 | db_change=true → **DA CONSULT 1차게이트 미충족** (CONSULT-REPLY 부재) → deploy-ready 불가 |
| 기존 오염행·중복행 정정 | BACKFILL(T-20260713…CONTAM-BACKFILL) 소관 — 본 티켓은 소스 차단(가드 확장) |

---

## 1. 재현 타임라인 — 동일인(phone tail 7754, name 총○○트 len5) 이중 생성

| 시각(KST) | 이벤트 | row | name | phone | 경로 |
|---|---|---|---|---|---|
| 09:27:08 | customer 생성 **RAW**(정상) | cust `e8ed0df6` | 총○○트(비마스킹) | 12자리(raw) | (정상 등록) |
| 09:27:~ | reservation 생성(→후에 checked_in) | resv `eecc8d6b` | 비마스킹 | 12자리 | cust e8ed0df6 연결, 10:00 |
| **09:27:45** | customer 생성 **MASKED**(오염) | cust `b1b5f6f7` | 총**트(`*` 포함) | **4자리 7754** | **미가드 upsert RPC** |
| 09:27:46 | check_in via self_checkin | ci `e8a11dc3` | denorm masked | 4자리 | `self_checkin`, `customer_id=b1b5f6f7`, resv_null |
| 09:30:59 | check_in(정상 예약경로) | ci `e52b0cd7` | 비마스킹 | 12자리 | (self_checkin 아님), cust e8ed0df6, resv 연결 |

→ 동일 1인 = **customer row 2개**(raw e8ed0df6 + masked b1b5f6f7) + **check_in 2개**
   = 대시보드 마스킹 표시(증상1) + 통합시간표/차트 중복(증상2). **현장 보고 정확 일치.**

- Q1(중복쌍): 두 row 모두 name len5, 첫자 `총`/끝자 `트` 동일, phone tail 7754 동일, visit_type new → **동일인 확정**.
- Q2(dup phone): canonical phone 기준 dedup 그룹 **0건** — masked row 는 phone 이 4자리(7754)라 canonical(≥8자리) 비교에서 raw(12자리)와 **매칭 불가** → **그래서 신규 row 로 갈라짐**(중복 생성의 기전).

---

## 2. 왜 WS-A 가드가 이 오염을 못 막았나 (2차 벡터 확정)

WS-A 가드(`self_checkin_with_reservation_link`, 20260713120000)는 branch 순서:
```
IF reservation_id → resolve customers(raw)
ELSIF customer_id → 그 raw 사용(존재확인만, 신규 INSERT 없음)
ELSIF masking_seen → 가드 발화(INSERT 거부·denorm '미확인'·customer_id NULL)
ELSIF phone_canon → 워크인 복합키 매칭/INSERT
```
- 관측 ci `e8a11dc3` 는 `customer_id=b1b5f6f7`(non-null·valid) + denorm masked(sentinel '미확인' 아님).
- 이는 가드 발화 path(→'미확인'+customer_id NULL)도, 워크인 INSERT path(→masking_seen=false 필요)도 **아님**.
- 유일 정합 해석: 키오스크가 **self_checkin 호출 前 별도 anon upsert RPC 로 masked customer(b1b5f6f7)를 이미 생성**(09:27:45) → 그 `customer_id` 를 self_checkin 에 전달 → 가드는 `ELSIF customer_id` branch 로 **정상 link**(denorm=customers 의 raw=이미 masked 값). = **가드가 막을 수 없는 지점**(masked row 는 상류에서 이미 만들어짐).

### 미가드 anon customers-INSERT 경로 (Q3, prod 실측)
| 함수 | anon_exec | 마스킹 가드 |
|---|---|---|
| self_checkin_with_reservation_link | ✓ | ✅ 유일 보유 |
| **fn_selfcheckin_upsert_customer** | ✓ | ❌ |
| **fn_selfcheckin_upsert_customer_resolve_v2** | ✓ | ❌ |
| **fn_selfcheckin_upsert_customer_resolve_v3** | ✓ | ❌ |
| self_checkin_create | ✓ | ❌ |
| upsert_reservation_from_source | ✓ | ❌ |
| fn_dashboard_reissue_health_q_token | ✓ | ❌ |

→ 키오스크(foot-checkin.pages.dev, 별도 레포)가 `fn_selfcheckin_today_reservations`(서버측 마스킹, 20260711120000)로 읽은 마스킹 name/phone 을 raw 로 착오·주입 → **미가드 upsert RPC** 로 masked customer INSERT. WS-A 가 self_checkin 을 잠갔어도 상류 upsert 가 열려 있어 우회.

---

## 3. FORENSIC 반증 근거 (REOPEN 트리거)

- WRITEPATH-MASK-SOURCE-FORENSIC(done)은 "소스 닫힘·07-14 01:15 기준 8h+ clean" 을 **behavioral post-probe(self_checkin 단일 함수 직접 투입)** 로 실증했으나, 그 probe 는 **customer_id 미전달 케이스만** 테스트 → 가드 발화 확인. **upsert RPC → customer_id 전달 → self_checkin link** 체인(=실제 키오스크 경로)은 미검증.
- 결과: masked customer 신규 유입이 **01:15 이후에도 지속**(b1b5f6f7 @ 09:27:45). masked/sentinel check_ins 도 01:15 이후 1건(e8a11dc3).
- ⇒ **소스 미차단 확정.** WRITEPATH-FORENSIC 의 "단일 벡터·소스 닫힘" 결론은 **2차 벡터(미가드 upsert)를 놓친 부분 결론**. → planner 에 **REOPEN 판단 FOLLOWUP**.

---

## 4. Phase 2 (fix) 권고 — DA CONSULT 1차게이트 선행 필요

- fix = **미가드 anon customer-INSERT 경로(특히 `fn_selfcheckin_upsert_customer[_resolve_v2/v3]`)에 WS-A 동형 마스킹-reject 가드 + resolve-to-existing 확장.** 마스킹 지문(name `*` / phone digits 1~7)이면 신규 masked row INSERT 거부, phone canonical 로 기존 raw customer resolve.
- **주의(phone 필드 사각)**: WS-A 의 phone-mask 판정은 `payload->>'phone'` 만 검사 — `phone_e164` 로 masked 값이 오면 사각. 가드 확장 시 `phone`·`phone_e164` **양쪽** 검사 필요.
- 이는 **정확히 `T-20260714-foot-ANON-WRITEPATH-MASK-GUARD-DEFENSE`(approved, 현재 P2 non-blocking)의 scope** = 본 재보고로 그 티켓이 **활성 벡터·P1 승격** 대상임이 증명됨. 두 티켓을 하나의 fix 로 수렴 권고.
- **게이트**: db_change=true·write-path 함수 변경·PII 마스터 → **DA CONSULT 1차게이트**(개별 경로 가드 vs 공통 helper 승격 패턴 판정 = DA 소관). CONSULT-REPLY **부재** → 본 dev-foot 세션은 Phase 2 migration apply·deploy-ready **금지**(§S2.4 데이터 정책 자문 게이트 + rc_first). 
- 회귀 0 요건: 정상 셀프접수(신규환자) write 통과 유지 + 마스킹 false-positive 0 + phone 매칭 false-merge 0.

## 5. 기존 오염행 정정
- b1b5f6f7(masked dup) + e8a11dc3(masked ci) 등 신규 오염행 정정·재앵커는 **BACKFILL(T-20260713…CONTAM-BACKFILL) / 별건 소관.** 단 BACKFILL 대상셋이 **07-14 신규 유입분(b1b5f6f7 등) 포함하도록 freeze 재산출 필요**(소스 미차단 기간 연장 → 대상 확대).

*mutation/deploy-ready 미실행. 본 게이트 = READ-ONLY 포렌식 전용. Phase 2 는 DA CONSULT + FORENSIC REOPEN 판단(planner) 후.*
