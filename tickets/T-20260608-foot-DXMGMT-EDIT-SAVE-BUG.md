---
id: T-20260608-foot-DXMGMT-EDIT-SAVE-BUG
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260608-foot-DXMGMT-EDIT-SAVE-BUG.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-08
deadline: 2026-06-10
reporter: 문지은 대표원장 (C0ATE5P6JTH)
commit: 507568e
---

# T-20260608-foot-DXMGMT-EDIT-SAVE-BUG — 상병명 수정/신규등록 저장실패 복구

현장(문지은 대표원장): "상병명관리에서 상병명 수정하면 상병명 자리에 폴더명이 들어가서 DB 에러나고 저장 안 됨".

## AC-0 — 근본원인 (dev DB 실측 2026-06-08, 추정 아님)

`services.diagnosis_folder` 컬럼이 DB에 **미적용** 상태.
- read(`useDiagnoses`): `42703 column services.diagnosis_folder does not exist` → **폴백 보유** → 목록은 정상 로드(전부 미분류 표시).
- write(`useUpsertDx`): `PGRST204 Could not find the 'diagnosis_folder' column ... in the schema cache` → **폴백 없음** → UPDATE/INSERT payload에 항상 `diagnosis_folder` 포함 → **수정·신규등록 저장 전부 실패**.
- 사용자가 본 "상병명 자리에 폴더명/DB에러" = 컬럼 부재 토스트(`...diagnosis_folder...`)의 인지. **name/diagnosis_folder payload 매핑 자체는 정상** (컬럼 부재가 진짜 원인).

## AC-1 — 코드 정합 복원 (구현 완료)

- `useUpsertDx`를 read와 동일하게 **deploy-tolerant** 화: 컬럼 부재(42703/PGRST204/message에 `diagnosis_folder`) 시 폴더 컬럼 제외 1회 재시도 → 저장 무결 보장.
- `name=상병명 / diagnosis_folder=폴더값(or null)` 컬럼 정합은 insert·update **동일 payload·동일 `run()` 폴백**으로 유지.
- 폴더값 보존 활성화는 마이그 적용 후 자동(forward-compatible).

## AC-2 — 회귀 없음

- read 폴백 보존(42703) · 폴더 인라인 rename 보존 · 신규등록(insert) 동일 폴백 공유.
- e2e spec 6종(정적 소스 가드) 통과.

## 후속 — supervisor SQL 게이트 (별도 FOLLOWUP)

본 코드 픽스는 "저장 실패"를 막지만, 폴더값을 실제로 보존하려면 마이그가 DB에 적용돼야 함:
- `20260606160000_diagnosis_folder_and_favorites.sql` (TEXT 컬럼 + 즐겨찾기)
- `20260607200000_diagnosis_folders_fk.sql` (폴더 트리 + FK)

→ supervisor 게이트로 dev/prod 적용 요청(FOLLOWUP 발행). 적용 전까지는 상병 항목 저장은 정상이되 폴더 분류는 dormant.
