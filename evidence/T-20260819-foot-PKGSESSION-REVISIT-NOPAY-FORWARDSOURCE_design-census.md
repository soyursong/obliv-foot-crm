# T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE — Phase2 design/census (READ-ONLY, write0/DDL0)

**leg**: dev-foot design/census READ-ONLY (gate-무관 진행). apply(server RPC/function/trigger DDL) = supervisor 물리 GO-token 선행.
**verdict endorse**: DA Q2 = (A) single server-side choke = CANONICAL. 본 census = (A) 배선 가능성 확증.
**날짜**: 2026-08-19 · author: dev-foot

---

## ① 5경로 single-choke 배선 가능성 (census 확정)

`package_sessions('used')` 를 쓰는 **소비 write locus 전수** (grep `.from('package_sessions')` + RPC):

| # | locus | 파일:line | write 방식 | CIS flag∧FK co-set | check_ins.package_id |
|---|-------|-----------|-----------|--------------------|----------------------|
| 1 | C2-PKG-TICKET (saveUseSession) | CustomerChartPage.tsx:4605 | client 直 `.insert()` | **NO** | YES(linkCheckInPackage) |
| 2 | C22-PKG-DEDUCT (saveC22Deduct) | CustomerChartPage.tsx:5573 | client 直 `.insert()` | **NO** | YES |
| 3 | C22-DUP-ADD (handleDupAddSession) | CustomerChartPage.tsx:5638 | client 直 `.insert()` | **NO** | YES |
| 4 | C22-HEALER (handleHealerDeduct) | CustomerChartPage.tsx:5794 | client 直 `.insert()` | **NO** | YES |
| 5 | SessionUseInSheetDialog | CheckInDetailSheet.tsx:2701 | client 直 `.insert()` | **NO** | NO |
| 6 | Packages dialog | Packages.tsx:2075 | client 直 `.insert()` | **NO** | NO |
| 7 | autoDeductSession → deduct_session_atomic | session.ts:4 / Dashboard.tsx:5921,6327 | server RPC | **NO** (RPC가 CIS 미접촉) | (RPC 밖) |
| 8 | **consume_package_sessions_for_checkin** | PaymentMiniWindow.tsx:2779 | server RPC (widened) | **YES** (유일 co-set) | (RPC 밖) |

**핵심 진단**: CIS flag∧FK co-set 은 **오직 locus#8** 만 수행. locus#1~7 (재진 no-payment 레이저소비 포함)은 회차만 소진하고 CIS 미마킹 = **forward-source 7개**. Phase1 실측(post-fix 303/95.9%, performed_by+unit_price 지배)과 정합 — 지배원인 = CustomerChartPage 直insert(#2~4).

**single-choke 배선 가능성 = 가능**. 현행 client 直insert 6곳(#1~6)은 모두 `supabase.from('package_sessions').insert({...})` 단일 패턴 → **하나의 server RPC 호출로 대체 가능**. RPC 내부에서 (i) package_sessions INSERT (ii) 대응 CIS(flag∧FK) co-set 을 atomic 수행. line 32 doctrine(RPC 밖 client-side CIS UPDATE 금지) 준수 = 새 RPC 내부에서만 CIS UPDATE.

**단서(신호 확대 필요)**: client 直insert 는 RPC(#8)가 안 받는 rich 필드를 씀 — `performed_by`(치료사), `session_date`, `session_number`(nextSessionNumberFor), `treatment_started_at/ended_at`(dwell), `surcharge`/`surcharge_memo`. canonical primitive 는 **이 필드 superset 을 받는 시그니처**로 확장돼야 대체 가능. (C1: 클라 deterministic service_id/session 페어링 유지 = 서버 fuzzy 금지 원칙 계승.)

---

## ② consume ↔ deduct 수렴 형태

- **consume_package_sessions_for_checkin** (20260723190000): SECURITY DEFINER. p_counts(type→qty) 소진 + p_service_sessions(JSONB) 로 CIS co-set(§128-150). 멱등 = 동일 check_in 동일 type 'used' count 차감(§76-82). CIS 마킹 idempotent = `WHERE package_session_id IS NULL`(§136), FIFO `created_at ASC`(§142). **CIS co-set 로직 이미 존재 = 재사용 자산.**
- **deduct_session_atomic** (20260420000013): SECURITY DEFINER. p_check_in_id/p_package_id 2-arg. package_sessions 1건 INSERT(§next_num). **CIS 완전 미접촉**. 중복가드 = (package_id,check_in_id) 존재 시 skip. session_type 은 서버 잔여기반 자동파생(fuzzy) = C1-축과 상충(service_id 정보 0).

**수렴 형태 권고 (dev-foot)**: **CIS-marking sub-routine 공유형** (완전 함수합병보다 저위험).
- consume 의 §123-150 co-set 블록을 `_mark_cis_for_session(p_check_in_id, v_session_id, v_type, p_service_sessions)` 내부 헬퍼로 추출.
- 신규 canonical primitive `consume_one_session(p_check_in_id, p_package_id|p_counts, p_service_sessions, +rich fields)` 가 (i)package_sessions INSERT 직후 (ii)헬퍼 호출로 CIS co-set.
- deduct_session_atomic·client 直insert 6곳 → 모두 이 primitive 로 라우팅. single-writer(AC-SW) = CIS write 는 primitive 단일 진입.
- 대안(함수 완전합병)은 deduct 의 2-arg caller(Dashboard done-transition)·consume 의 p_counts 그레인 차이로 시그니처 충돌 → sub-routine 공유가 drift 최소.

---

## ③ choke matched-derivation determinism / idempotent / double-link-0

canonical matched-derivation = 현행 widened RPC §128-150 이 이미 codify (backfill.sql 'matched' CTE 와 동형·부모 T-20260724 소관):
- **determinism**: CIS 매칭 = `check_in_id = p_check_in_id AND package_session_id IS NULL AND service_id ∈ (p_service_sessions where session_type=v_type)` → `ORDER BY created_at ASC, id ASC LIMIT 1`. tie-break `id ASC` 로 완전 결정적.
- **idempotent**: `WHERE package_session_id IS NULL` = 이미 링크된 CIS 재마킹 배제. 회차 소진도 멱등(동일 check_in 'used' count 선차감 §76-82). 재실행 = no-op.
- **double-link-0**: 1 package_session INSERT ↔ 1 CIS UPDATE(LIMIT 1). FK co-set 시 flag=true 동시(§130-131) → orphan(flag=true∩FK-null) 신규생성 0. P-floor 불변식(§686-690) 준수.
- **shortfall 안전**: v_pkg_id IS NULL(잔여없음) → EXIT, CIS 미마킹(§109-112) = phantom already_paid 방지.
- **client 直insert 이관 시 유의**: #2~4(CustomerChartPage)는 settle-time 이 아닌 chart 차감이라 대응 CIS 행이 없을 수 있음. 이 경우 matched-derivation 은 "대응 CIS 부재 → 마킹 skip(회차만 소진)" 로 fail-safe(현 widened p_service_sessions=NULL 폴백과 동일 semantics). = orphan fabricate 안 함 = P-floor 안전.

---

## ④ (C) trigger backstop 채택 검토 (backstop-only, (A) 대체 아님)

DA Q2(C) = CONDITIONAL-SECONDARY backstop only. census 후 별건·비-blocking.
- **형태**: `AFTER INSERT ON package_sessions WHEN (NEW.status='used' AND NEW.check_in_id IS NOT NULL)` → 대응 CIS co-set.
- **determinism**: matched-derivation 을 trigger 안에서 재현해야 함 — 단 trigger 는 service_id 페어링(p_service_sessions) 을 **못 받음** → session_type 기반 fuzzy 매칭 강제 = C1 위반 리스크. → **(A) 대비 열위**. (A)가 채택되면 (C) 불요.
- **순서/clobber**: trigger 가 CIS 를 마킹해도 이후 saveCheckInServices DELETE+reinsert 가 clobber → C3 보존(PaymentMiniWindow §2340-2402 FIFO 스냅샷)과 중복/경합. trigger 단독은 C3 clobber 미해결.
- **권고**: (A) single-choke 우선. (C)는 (A) 미도달 소비경로(예: 외부 SQL 直insert) 대비 backstop 으로만 별건 검토. 본 티켓 스코프에선 **(A) 단독 권고, (C) 보류**.

---

## ⑤ 매출 read-consumer going-forward 영향

CIS flag(is_package_session=true) read-consumer 2곳 (write 아님·going-forward 판독만):
- **⑨ footBilling.alreadyPaid** (footBilling.ts:1610-1626): `check_in_services.price WHERE is_package_session=true` 합 = 방문 환자부담 기납부분. forward-fix 로 재진 no-payment 소비가 flag=true 되면 → alreadyPaid 정확 반영(현 0 → 정상값) = ⑩ due_amount=max(0,⑧−⑨) 정확화. **direction-safe**(현 미마킹=alreadyPaid 과소→미납 과대 표기 → 정확 수렴).
- **Closing 매출제외** (Closing.tsx:632,700): `if (row.is_package_session===true) continue` = 패키지 차감분 매출 이중계상 제외. forward-fix 로 재진 no-payment 소비가 flag=true 되면 → Closing 당일매출에서 정확 제외(현재 미마킹분은 매출 over-count). **316 backfill 과 동일 방향**(truth-restoration = over-count→정확 exclusion).

**going-forward semantics 변화**: fix 착지 시점부터 재진 no-payment 소비건이 (a)⑨ alreadyPaid 에 잡히고 (b)Closing 매출에서 제외됨 = **매출-인접**. retro 아님(forward-only). → planner 경유 **dev-sales going-forward awareness + FM3 통지**(316 동형) 필요 = 착지 게이트 예약 (본 design leg 에선 premature·미발행).

---

## 결론 (FOLLOWUP → planner → supervisor MIG-GATE)

1. **(A) single server-side choke 배선 = 가능·권고**. client 直insert 6곳 + deduct_session_atomic → 단일 canonical consumption primitive(consume↔deduct = CIS-marking sub-routine 공유형 수렴)로 라우팅. CIS co-set = server RPC 내부 단일-writer(AC-SW), line 32 준수.
2. **primitive 시그니처 확장 필요**: performed_by/session_date/session_number/treatment dwell/surcharge superset + p_service_sessions(deterministic C1) 수용.
3. **matched-derivation** = 현 widened §128-150 재사용(determinism/idempotent/double-link-0/P-floor co-set 이미 충족·backfill 'matched' CTE 동형).
4. **(C) trigger = 보류**(backstop-only, C1 fuzzy 리스크·C3 clobber 미해결).
5. **매출-인접** = dev-sales/FM3 통지는 착지 게이트 예약(planner 경유).
6. **apply = db_change=true·DDL 有** → supervisor DB-GATE GO-token + MIG-GATE + C19(consume/deduct 계약자산 body-drift) + §15-5-10 caller-tier seal + A12 md5 re-seal **선행**. GO-token 前 prod DDL 선집행 금지. 본 leg = write0/DDL0 완결.
