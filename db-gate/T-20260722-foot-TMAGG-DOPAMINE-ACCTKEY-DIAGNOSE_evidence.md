# T-20260722-foot-TMAGG-DOPAMINE-ACCTKEY-DIAGNOSE — 진단 evidence (read-only)

**실행**: 2026-07-22 · dev-foot · SELECT-only (write/DDL 0건, AC-D4 충족)
**대상 prod**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
**스크립트**: `scripts/T-20260722-foot-TMAGG-DOPAMINE-ACCTKEY-DIAGNOSE_diag.mjs` (+`_diag2.mjs`)
**raw 로그**: `db-gate/T-20260722-foot-TMAGG-DOPAMINE-ACCTKEY-DIAGNOSE_evidence.txt`

---

## AC-D1 (계정 실재) — ✅ 전제 정정 field-CORRECT (단, 부분적)

`user_profiles` 54건 중 **role='tm' 계정 = 3건, 전부 active**:

| id | name | email | active | clinic |
|----|------|-------|--------|--------|
| ce02d366-…372084 | 진운선 | us.jin@medibuilder.com | true | 74967aea-…30bc8 |
| 210f3715-…a2575a | 이수빈 | sb.lee@medibuilder.com | true | 74967aea-…30bc8 |
| fcfc2064-…d01aff | 김효신 | hs.kim@medibuilder.com | true | 74967aea-…30bc8 |

→ 박민지 팀장님 정정("도파민 상담사도 풋CRM에 TM 역할 계정 있음")은 **이 3명에 대해 사실**.
**단, 전원은 아님**: dopamine 예약 registrar_name 에 `[도파민TM] 박민지`·`[도파민TM] 김수진`
형식으로만 나타나는 2명은 풋 계정 **미보유**(role='tm' 목록에 없음). = "일부 보유, 일부 미보유".

## AC-D2 (created_by 채움 실태) — **case (b) 확정**

source_system='dopamine' 예약 **368건 전부 created_by = NULL** (채움 0건).

- 대조: source_system=∅(수기/비-dopamine) 372건 中 **315건은 created_by 채워짐** → 수기 경로는 stamp 됨, **dopamine push 경로만 미stamp**.
- dopamine 행의 per-name 신호는 오직 `registrar_name`(mutable 스냅샷)에만 존재:
  진운선 123 / 이수빈 121 / 김효신 116 / `[도파민TM] 박민지` 7 / `[도파민TM] 김수진` 1.
- registrar_name 형식 교차: `[도파민TM]`prefix 8건(전부 cb=NULL) vs bare-name 519건(cb채움 147, dopamine분은 NULL).

→ **계정은 있으나(AC-D1) 도파민 push RPC 가 created_by 를 그 tm 계정으로 안 채운다.**
정규키(created_by) 기준으로는 **현재 per-name 분해 불가** — 유일한 per-name 축은 REPOINT 가
의도적으로 벗어난 mutable `registrar_name`. 정규키 per-name 하려면 **emit-side(cross-CRM 도파민
push RPC)에서 created_by=tm 계정 id stamp** 필요. → §963⑩(b)/⑥ (cross-namespace) 재검토 영역.

## AC-D3 (매핑 안전성)

`created_by`(=`user_profiles.id`, UUID FK)→`user_profiles` 는 **로컬 foot 조인만으로 안전**
(email-resolve/counselor_id 타CRM 반입 불요, §963⑩(b)/⑥ 금지클래스 미저촉).
**단 전제 = created_by 가 채워져 있을 때만** — 현재 dopamine 행은 전부 NULL 이라 이 안전경로가
현시점엔 무효. registrar_name 기반 로컬 per-name 은 기술적으로 가능하나 (1)mutable 문자열 축이고
(2)5명 中 3명만 bare-name·2명은 prefix(계정無)로 커버 불균질.

## AC-D4 (구현 금지) — ✅ 준수

SELECT-only. reservations/user_profiles 무변경, TM집계 grouping/필터 로직 무접촉, DDL 0건.

---

## DA 재adjudication 용 요약 (§963⑩(a)/§416)

- §416 firewall 의 **"도파민 상담사=풋 계정 없음"** 전제 → **부분 오류**: 3명은 계정 있음(active tm), 2명은 없음.
- §963⑩(a) 단일버킷 불변식의 **데이터 근거("created_by=NULL")** → **여전히 사실**: dopamine 368건 전부 NULL.
  즉 *canonical-key 축*에서는 단일버킷이 데이터상 강제됨(정규키로 per-name 불가). REPOINT(registrar_name→created_by)
  자체는 되돌릴 필요 없음 — 정정이 건드리는 건 "계정 부재"라는 firewall 논거이지 canonical-key 원칙이 아님.
- per-name 을 정규키로 실현하려면 **선택지**: (A) emit-side 도파민 push RPC 가 created_by=tm 계정 id stamp
  (cross-CRM 변경, §963⑩(b)/⑥ 게이트) / (B) registrar_name bare-name 을 로컬 tm 계정에 매칭해 라벨 분해(mutable
  축 부활 — REPOINT 취지와 상충, 미계정 2명 커버 불가). → **어느 쪽도 DA CONSULT GO 전 구현 금지.**
