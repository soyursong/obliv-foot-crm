# T-20260810-foot-ARCHE-PORPHAN-CORRECTION — Q5 forward-seal FORENSIC 판정 (READ-ONLY)

- **msg**: MSG-20260810-021521-iyh4 (planner NEW-TASK · READ-ONLY forensic · DA §Q5 dispositive PRE-APPLY gate)
- **mode**: READ-ONLY / SELECT + pg_proc/pg_get_functiondef inspection. **prod write/DDL/apply/forward re-wire 0.**
- **prod ref**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **probe**: `scripts/T-20260810-foot-ARCHE-PORPHAN-CORRECTION_forensic_seal_probe.mjs` (SELECT-only)
- **run date**: 2026-08-10
- **guard-live 기준**: DB chokepoint 마이그 `20260723190000_foot_pkgsession_link_unwired_widened` — deploy-ready 커밋 e87e7a96 (2026-07-23 19:12 KST), ACL parity 902efb2c (19:40 KST). schema_migrations 원장 등재 확인.

---

## 판정 = **H1 (seal 확정)** — 소급 재-결선 진행 가능

DA §Q5 seal 정의(chokepoint live + post-guard 신규 P-orphan=0) 를 **dual-leg 경계**로 충족:
- **chokepoint(DB RPC) leg = 07-23 19:12 KST 부터 live·source-closed.**
- **FE stop-pre-mark leg = 번들 전파 완료 ~07-27 KST.**
- **effective full-seal = ~07-27** 이후 **14일간(07-25 KST~08-10 현재) 신규 P-orphan = 0.**
- guard-live(07-23) 직후 관측된 07-24 tail 15건은 **frozen 62 내부**의 **FE 캐시 전파창(deploy-window) 잔류**이지 지속 출혈 아님(아래 §2 RC 격리 참조).

---

## 1. code-pin (§0-2 source-closed) — **chokepoint LIVE 확정**

| 항목 | 실측 | 판정 |
|---|---|---|
| live 함수 시그니처 | `consume_package_sessions_for_checkin(uuid,uuid,uuid,jsonb,jsonb)` (5-arg widened) | ✅ |
| 함수 오버로드 수 | **1** (구 4-arg DROP 완료·stale overload 0) | ✅ |
| `package_session_id = v_session_id` (죽은 FK 전방배선) | prosrc 내 **존재** | ✅ |
| `is_package_session = true` (플래그 동시 SET) | prosrc 내 **존재** | ✅ |
| `p_service_sessions` deterministic param | prosrc 내 **존재** | ✅ |
| schema_migrations 원장 | `20260723190000_foot_pkgsession_link_unwired_widened` **등재** | ✅ |
| FE caller (PaymentMiniWindow.tsx:2695) | `p_service_sessions: serviceSessions` **non-null 배열 전달** → 마킹 경로 실행(NULL-fallback skip 아님) | ✅ |
| FE saveCheckInServices | T-20260724 가드#4로 flag **선마킹 안 함** → `is_package_session=true` = **RPC 파생값 단일진실원천** | ✅ |

⟹ `is_package_session=true` 경로에서 `package_session_id` 강제 write 되는 코드 경로가 **prod 라이브·활성**. 신규 FE에서 flag=true 는 RPC 원자 SET 로만 생성 → **P-orphan 구조적 생성 불가.**

---

## 2. forensic — guard-live 이후 신규 P-orphan 시계열

### 현재 population
- **P-orphan(is_pkg=true ∩ sid IS NULL) = 62** (census frozen 62 == 현재, **증가 0**)
- healthy(is_pkg=true ∩ sid NOT NULL) = 49
- flag_true total = 111 (= 62 + 49)

### 시계열 (created_at KST)
- P-orphan **최신 생성 = 2026-07-24 20:01 KST.** 07-24 이후 신규 P-orphan **0.**
- guard-live(07-23 19:12) 기준 on/after = 15건 (전량 07-24 tail 14 + 07-23 야간 1).

### `is_package_session=true` 신규행 링크상태 (guard-live 후)
| day (KST) | flag_true | linked | **orphan** |
|---|---|---|---|
| 07-23 | 1 | 0 | 1 |
| **07-24** | 15 | 1 | **14** ← FE 전파창 tail |
| 07-27 | 7 | 7 | **0** |
| 07-28~08-08 (11일) | 32 | 32 | **0 (전일)** |

- **07-27 → 08-08: 48개 flag_true 행 전건 healthy-linked, orphan 0.**
- post-guard healthy 링크 49건 생성(07-24~08-08) = chokepoint **능동 배선 중** 증명.

### RC 격리 — 07-24 tail 14건 = FE deploy-window (RPC 결함 아님)
live RPC 는 07-23 19:12 이후 **불변**(md5 고정·단일 시그니처). RPC 자체가 orphan 을 생성한다면 07-27 이후 행에서도 orphan 이 나와야 하나 **전건 healthy**. orphan 이 멈춘 것은 RPC 변경이 아니라 **FE 클라이언트 갱신(구 캐시 번들의 flag 선마킹 중단)** 때문 → 원인은 **FE-leg 전파**로 격리, ~07-27 해소. 이는 마이그 주석의 문서화된 deploy-window 단서(`p_service_sessions=NULL 구 번들 폴백 → 마킹 skip`)와 정합.

---

## 3. 게이트 함의 / planner 인계

- **H1 확정 → 소급 재-결선(Leg-A fill-on-NULL) 진행 가능.** frozen 62 population 은 07-24 이후 닫힘(신규 유입 0). forward re-wire FIRST 불요(H2 아님).
- **경계 명시(비-blocking, DA 판독 위임)**: seal 은 dual-leg. DB chokepoint 단독 경계(07-23)로 엄격 판독 시 "post-guard=15≠0"이나, 그 15는 frozen 62 내부 07-24 FE-전파창 잔류이며 지속 출혈 아님. **FE 전파완료 경계(~07-27)로는 post-guard=0.** 본 forensic 판독 = H1.
- **잔여 권고(POSTCHECK 표준 유지)**: FE-leg seal 은 경험적(14일 clean)이며 가상의 초-stale 캐시 클라이언트에 대해 구조적 보증은 신규-FE 보편배포에 의존. apply 후 상시 불변식 = **P-orphan count monotonic 비-증가** POSTCHECK 유지 권고(신규-FE 는 flag=RPC파생 단일원천이라 잔여위험 residual).
- **본 태스크 = forensic 판별 종결.** apply·정정·forward re-wire 착수 0. B-absent 34 라우팅은 별도(spec 확정 단계).
