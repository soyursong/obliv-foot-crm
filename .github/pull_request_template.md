<!--
  obliv-foot-crm PR 템플릿
  T-20260725-foot-PERMISSION-PARITY-PLAYBOOK STEP2② — 권한 변경 server-first 증빙 체크박스.
-->

## 요약
<!-- 무엇을, 왜 바꿨는지 1~3줄 -->

## 권한(role/RLS/권한 컬럼) 변경 여부
- [ ] 이 PR 은 권한(role-set / RLS 정책 / 권한 컬럼)을 **건드리지 않는다** (아래 체크리스트 생략 가능)

### 권한을 변경한다면 (INV-2 server-first 필수)
- [ ] **권한 확대는 RLS 먼저 랜딩·확인 후 FE** — FE 만 먼저 열지 않았다(lock-out-in-disguise 금지).
- [ ] 동반 RLS/권한 마이그가 `.DDL_DIFF_HOLD` 로 **방치되지 않았다** (`scripts/check-perm-migration-hold.sh` 통과 — HOLD 로 둘 경우 LEDGER 등재 + 추적 티켓 명시).
- [ ] **RLS 선적용·확인 증빙** 첨부(적용 로그 / dry-run / prod 실측 rows-affected 등):
      <!-- 증빙 링크·요약 -->
- [ ] FE role-set ⟷ RLS/EF role-set **패리티**를 유지했다(`npm run test:perm-parity` GREEN).
- [ ] 신규 인라인 `role === '...'` 추가 없음 — SSOT predicate(`src/lib/permissions.ts`) 사용(`scripts/check-inline-role-ratchet.sh` 통과).
- [ ] 신규 role 추가 시 `UserRole` 닫힌 유니온에 명시 추가(INV-4).
- [ ] 신규 컬럼·테이블·enum 은 data-architect **CONSULT** + supervisor **DDL-diff** 게이트 선행.

## 테스트
<!-- 빌드/tsc/spec 결과 -->
