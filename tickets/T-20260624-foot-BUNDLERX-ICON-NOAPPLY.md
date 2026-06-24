---
id: T-20260624-foot-BUNDLERX-ICON-NOAPPLY
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260624-foot-BUNDLERX-ICON-NOAPPLY.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-24
assignee: dev-foot
reporter: 문지은 대표원장
medical_confirm_gate: required
confirm_status: confirmed
confirm_basis: director 본인 자기요청(신고자=문지은 대표원장) = 의사전용 surface 변경을 해당 의사 본인이 합의. §11.1 충족 (planner MSG-20260624-222725-hlgy).
planner-msg: MSG-20260624-222725-hlgy
scope: part2 (AC-0 FE 방어). part1(RLS director 추가)은 data-architect CONSULT-REPLY GO 수신 후 별도 진행.
---

# T-20260624-foot-BUNDLERX-ICON-NOAPPLY — 묶음처방 아이콘/태그 저장 false-positive 토스트 제거 (part2/AC-0)

## 증상
묶음처방(prescription_sets)에 아이콘·태그를 부여하고 저장하면 "저장됐어요/태그를 저장했어요" 토스트는
뜨지만 실제로는 반영되지 않음. 신고자: 문지은 대표원장(director).

## ★ RC (코드증거 기반)
supabase `.update()` / `.insert()` 는 RLS 정책으로 0행이 필터링돼도 `{ error: null }` 을 반환한다.
기존 hook(`useUpsertSet`, `useUpdateSetTagMeta`)은 `error` 만 검사 → 0행 silent no-op 을 성공으로 간주
→ 거짓 성공 토스트. director 가 `prescription_sets` UPDATE RLS 에 포함되지 않아(아이콘 편집을
admin/manager 만 쓰던 정책) 실제 변경은 0행이었음.

## AC-0 — FE 방어 (RLS 와 독립, part2) ✅
mutation 에 `.select('id')` 를 붙여 영향 행을 회수하고, 0행이면 throw → 실패 토스트.
RLS 권한 추가(part1)와 무관하게, 권한이 없을 때 거짓 성공 대신 명확한 실패 토스트가 뜨게 만든다.
이것만으로도 false-positive 토스트 제거 = 운영 신뢰성 즉시 회복(part2 단독 deploy-ready).

- `PrescriptionSetsTab.useUpsertSet` UPDATE/INSERT → `.select('id')` + `!data || data.length===0` throw
- `PrescriptionSetsTab.useUpdateSetTagMeta` UPDATE → `.select('id')` + 0행 throw
- `DiagnosisSetsTab.useUpsertSet` UPDATE → 동형 가드(sibling 일관성)

## 게이트
- medical_confirm_gate: **confirmed** (director 본인 자기요청, §11.1 충족 — planner 판정).
- DB 변경 없음(`db-change: false`) → data-architect CONSULT 비해당 / supervisor DDL-diff 무대상.
- part1(RLS director 추가)은 별개 — data-architect CONSULT-REPLY(MSG-20260624-222714-ftae) GO 수신 후 착수.

## 검증
- build OK (vite 4.54s, tsc 0).
- E2E 신규 6 PASS (unit project, 소스 정적 가드 — auth 불요).

## 잔여 (part1, 본 티켓 외)
- prescription_sets / diagnosis_sets UPDATE·INSERT RLS 에 director role additive 추가.
- sibling 진료관리 테이블 RBAC 일관성 점검(DA 회신 포함 요청됨).

## part3 — planner #1(필터)·#3b(IconRenderer) 가설 검증 (MSG-20260624-215254-z70x)
planner NEW-TASK 의 1순위 가설(아이콘만 넣고 색 미지정 → BundleRxTagBar L56 필터에서 제외 → "적용 안됨")을
코드증거로 검증한 결과 **현 코드에서는 발생하지 않음** → 필터 완화/정책 변경 불필요. 근거:

- **#1 필터 가설 배제**: 저장 레이어(`useUpsertSet` L178, `useUpdateSetTagMeta` L230)가
  `tag_color: hasTag ? (form.tag_color || DEFAULT_RX_TAG_COLOR) : null` — 아이콘 OR 라벨이 있으면
  (`hasTag`) 색 미선택이라도 **DEFAULT_RX_TAG_COLOR('slate') 를 강제**한다(T-20260617 OVERHAUL 에서 정착,
  당시 icon-only hide_name 태그 색 null 회귀를 이미 수정). 즉 planner 정책분기 (b)안(아이콘 추가 시 기본색
  부여)이 이미 구현돼 있어, 색 null 인 icon-only 행이 생성되지 않음 → 필터에서 제외되는 케이스 없음.
- **#3b IconRenderer 미인식 배제**: `DRUG_ICON_OPTIONS = ICON_OPTIONS.filter(drug)` 부분집합이고
  `IconRenderer` 는 superset `ICON_OPTIONS` 를 검색 + 미지값 `Pill` 폴백 → picker 로 고른 모든 아이콘이 렌더됨.
  저장 picker(PrescriptionSetsTab)와 진료화면 칩(BundleRxTagBar)이 동일 IconRenderer SSOT 사용.
- **실제 RC = 저장 미persist(#3a)** = part1(director RLS)+part2(FE 0행 throw) 로 이미 해소.

→ 정책분기 보고 불필요(현 (b)안 유지가 정답), 필터/렌더 코드 변경 0. 회귀가드 spec 4건 신설(총 10 PASS).
build OK(vite 4.59s, tsc 0). db-change 없음.
