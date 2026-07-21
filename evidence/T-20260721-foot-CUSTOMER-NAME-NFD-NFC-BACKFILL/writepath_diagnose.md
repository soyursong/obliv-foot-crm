# T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — 상류 write-path DIAGNOSE (approved-state, gate_hold 준수)

> gate_hold: approved 상태에서 dev-foot 는 (a)census (b)DA CONSULT (c)write-path 진단까지만.
> 실제 UPDATE·상류 정규화 **배포**는 DA CONSULT-REPLY(GO) + planner gate_hold 해제 후에만.
> 본 문서 = (c) write-path 진단 산출물. 코드 mutation 0.

## 1. census 요약 (읽기 근거: scripts/…_census.out.txt / _freeze.json)
- 전수 NFD 대상 = **정확히 3건** (seed 외 추가 0). 지문 `char_length(name) <> char_length(normalize(name,NFC))`.
  - b734f069 F-4818 백민석 / f137fe98 F-4903 강승은 / 0fc0752c F-4920 천승환
  - 전부 `is_simulation=false` / `clinic=74967aea(jongno)` / `visit_route=TM`.
- 이름검색 실패 재현: raw `LIKE '%강승은%'` = 0건 → 백필 후 `normalize(NFC) LIKE` = 1건.
- 파생 사본: `reservations.customer_name` NFD 3건, `check_ins.customer_name` NFD 1건 (스코프는 DA CONSULT 에서 확정 — 본 티켓 1차 대상 = `customers.name`).

## 2. write-path 특정 (visit_route=TM → 도파민 TM 인입 경로)
3건 전부 `visit_route=TM` → 유입 = **도파민 push TM 예약 인입**. 경로 2단:

### (제1벡터) Edge Function `reservation-ingest-from-dopamine/index.ts`
- L256: `customer.name required` — 도파민 push payload 의 `customer.name` 을 그대로 수신.
- L511: `p_customer_name: name` — payload name 을 **정규화 없이** RPC 인자로 전달.
- L626+: 신규-고객 INSERT 경로(첫 예약=첫 customers row 생성). 여기서도 `normalize(…,NFC)` **미적용**.
- L528: `admin.rpc('upsert_reservation_from_source', rpcArgs)`.

### (제2벡터) RPC `upsert_reservation_from_source` (foot DB, 20260713150000 canon)
- L165–166: `INSERT INTO public.customers (clinic_id, name, phone, visit_type) VALUES (v_clinic_id, p_customer_name, …)`
  → **신규 고객 INSERT 시 `p_customer_name` 을 raw(정규화 없음) 로 적재** = NFD 그대로 착지 = 진원(첫 row 생성).
- L174: ON CONFLICT `name = COALESCE(NULLIF(btrim(customers.name),''), NULLIF(btrim(EXCLUDED.name),''), …)` — never-downgrade(T-20260713). 기존 non-empty 는 no-touch(정정 방향과 정합).
- L189: `reservations.customer_name = p_customer_name` raw → **reservations 파생 사본도 NFD** (census 3건 설명).

## 3. 진원(origin) 판정 — cross-domain 분기 (AC-4)
- **NFD 의 실 발생지 = 도파민 push payload `customer.name`** (cue_cards 단일 name 필드가 NFD 로 인입).
  foot 측 EF/RPC 는 이를 정규화 없이 통과시켜 착지시킬 뿐(=재유입 통로).
- 따라서:
  - **(AC-2, foot 책임)** foot ingest 경계(EF `reservation-ingest-from-dopamine` + RPC `upsert_reservation_from_source` 의 customers/reservations INSERT)에서 `name := normalize(btrim(name),'NFC')` 로 **정규화 가드** 추가 → 재유입 0. **ADDITIVE**(값 표기 정규화, 상태전이/never-downgrade 규칙 불변).
  - **(AC-4, cross-domain — 본 티켓 미수정)** 진짜 진원인 **도파민 push 측 name NFC 정규화**는 foot 도메인 밖 → 본 티켓에서 dopamine 코드 **수정 금지**. 진단 근거 첨부하여 planner 에 보고 → planner 가 dopamine 도메인 별건(cross_crm_data_contract phone/name 정규화 계약) 승격.

## 4. 게이트 상태 (approved-state 완료분)
- [x] (a) DIAGNOSE-FIRST 전수 census (정확 3건, seed 초과 0, 분포·검색실패·파생사본 확인) — `_census.out.txt` / `_freeze.json`
- [x] (b) 백필 계약 준비(gated, 미적용): freeze PK IN-list + still-NFD 이중가드 + affected abort + rollback(hex 원값) + dryrun(No-Persistence Protocol)
- [x] (c) 상류 write-path 진단(본 문서) — foot ingest 경계 가드 지점 확정 + 진원=dopamine 판정
- [ ] DA CONSULT-REPLY(GO) — **대기**. GO + planner gate_hold 해제 전 UPDATE/가드배포 금지.
- [ ] supervisor DB-gate + MIG-GATE 4필드 + dry-run 무영속 evidence — GO 후.

## 5. 제안(DA CONSULT 결정 대상)
1. 백필 대상 = `customers.name` freeze 3 PK (확정). GO 시점 census 재확인 count 로 `v_expected` 교체.
2. 파생 사본 스코프: `reservations.customer_name`(3) / `check_ins.customer_name`(1) 를 본건 fold vs 별 stage — DA 판단.
3. foot ingest 가드(AC-2) 착지 layer: RPC INSERT 2곳 + EF 신규 INSERT 경로. (never-downgrade 규칙 불변, normalize 는 값 표기만.)
4. dopamine 진원 정규화(AC-4) = 별건 승격 여부.
