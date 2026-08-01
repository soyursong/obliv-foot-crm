# PAYVIEWER 유령 브랜치 정리 — 아카이브 evidence

- **Ticket**: T-20260801-foot-PAYVIEWER-BRANCH-CLEANUP (parent: T-20260801-foot-POSTMERGE-BILLING-BRANCH-RECONCILE ④)
- **Date**: 2026-08-01
- **By**: dev-foot
- **성격**: 순수 git 정리 (기능 재작업 아님). CHOI 계정은 이미 정상작동(자가가입 비번 로그인 성공).

## 정본 (보존 — 삭제 대상 아님)

- `origin/ops/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI` @ `e654d8569a1bd9209b77cdbef89421e5266a5f0e`
  - RECONCILE.md 보유: `scripts/_evidence/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI_RECONCILE.md`
  - PAYVIEWER src 변경(DocumentPrintPanel/PaymentMiniWindow/footBilling 등) + reconcile/inventory 스크립트 전부 이 브랜치에 존재.

## 삭제된 유령 브랜치 (아래 고유 파일만 여기 아카이브 후 ref 삭제)

| 삭제 ref | SHA | 여기 아카이브된 고유 파일 |
|---|---|---|
| `origin/chore/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI` | `45f5e0368ad0e89e5c3ddc9bf4b0e9851ec8a321` | `..._approve.mjs` (167 L) |
| `origin/foot/T-20260721-PAYVIEWER-ACCOUNT-CHOI` | `85aab27a1838125f2535b6a454fe09e80bcb2c0c` | `..._create.mjs` (194 L), `..._before.json` (16 L), `..._rollback.sql` (6 L) |

## 미머지 고유 src 없음 — 재확인 근거 (step 2 gate)

- `git diff origin/main...origin/chore/…` = **`_approve.mjs` 1개뿐** (src 변경 0건). chore/의 src 트리는 stale(main 대비 뒤처짐)일 뿐 고유 미머지 작업 아님.
- `git diff origin/ops/…...origin/foot/… -- src/ tests/` = **빈 diff** (foot/의 src·tests는 정본 ops/와 동일). 고유 src 손실 없음.
- 따라서 삭제로 소실되는 고유 src 없음 → abort 조건 미해당. 이관 대상 = ops 스크립트 4개(본 폴더).

원본 basename 보존, 내용 무수정 그대로 이관.
