# T-20260719-foot-WALKIN-CUSTOMERS-PERMISSION-DENIED — 진단 리포트 (dev-foot, read-only)

**결론 한줄:** 배포된 워크인(anon) 셀프접수는 **obliv-foot-crm 이 아니라 별도 레포 `foot-checkin`**(foot-checkin.pages.dev)이 서빙한다.
공유 DB의 SECURITY DEFINER RPC 권한경로는 **정상(42501 미재현)**. obliv-foot-crm 측 코드/DB 변경 불요 · DA CONSULT 불요.
실 수정 대상(있다면)은 **foot-checkin** — dev-foot(obliv-foot-crm) 쓰기 스코프 밖. planner 재라우팅 필요.

날짜: 2026-07-19 · 작성: agent-fdd-dev-foot · 성격: read-only 진단(코드/DB 변경 0, DB write 는 전부 BEGIN…ROLLBACK)

---

## 1. 요청 vs 실제 — 레포 라우팅 divergence (핵심)

| 항목 | 티켓 전제 | 실측 |
|------|-----------|------|
| 워크인 접수 화면 소유 | obliv-foot-crm `SelfCheckIn.tsx` | **`main` 에 SelfCheckIn.tsx 부재** (`git cat-file`=NO FILE) |
| 배포 정본 | obliv-foot-crm.pages.dev | 배포 커밋 f0ee2916 = **origin/main** — `/checkin/:slug` → **foot-checkin.pages.dev 301 redirect** (App.tsx §T-20260602-CHECKIN-STALE-COPY-CONSOLIDATE AC2) |
| 실제 anon 셀프접수 앱 | — | **repo `soyursong/foot-checkin`** (로컬 `~/GitHub/foot-checkin`, HEAD 0674075) |

- obliv-foot-crm 의 `feat/anon-rls-phase2b-cutover` 브랜치에는 아직 `SelfCheckIn.tsx` 사본이 남아있으나(내가 처음 조사한 파일), 이는 **main 에서 CONSOLIDATE 로 제거된 stale 사본** — 미배포. 여기 대한 어떤 수정도 현장에 도달하지 않음.
- 필드 문구 `"고객 등록 실패: permission denied for table customers"` 의 `고객 등록 실패:` 접두어는 **foot-checkin 에 없음**(foot-checkin=`접수 실패: `/`오류가 발생했습니다: `). 이 접두어는 obliv stale 사본(line 1331)에만 존재 → 리포터의 의역 or 현장 태블릿이 stale/preview obliv 빌드를 열었을 가능성.

## 2. 공유 DB 권한경로 — 정상 (branch (b) 부정)

read-only introspection + rolled-back anon 재현 (probe 1~4):

- `fn_selfcheckin_upsert_customer_resolve_v3`: **SECURITY DEFINER, owner=postgres, anon EXECUTE=✓**, `created_by` 스탬프 반영(20260719 createdby-canon 마이그 prod 착지 확인). 오버로드 1건.
- `customers`: owner=postgres, RLS enabled(force=off). postgres = INSERT/UPDATE 보유 + `rolbypassrls=true`. anon = SELECT-only(ANONSWEEP 정상 반영).
- **anon 세션으로 v3 직접 호출(ROLLBACK) → customers 권한층 통과. 42501 미재현.** 실패는 데이터 제약뿐:
  - invalid phone → `23514 customers_phone_e164_chk`
  - dup phone → `23505 idx_customers_clinic_phone`
- `self_checkin_with_reservation_link`(foot-checkin 접수생성 RPC): SECURITY DEFINER, owner=postgres, anon EXECUTE=✓. 내부 customers INSERT/UPDATE + check_ins INSERT 보유.

→ SECDEF 경로의 customers write 권한은 **현재 건강**. anon 직접 table write 회수(ANONSWEEP)는 설계 의도대로 유지 — **복원 시 보안 회귀**. 따라서 grant 복원/ DA CONSULT **불요**, `db_change=false`.

## 3. 발견된 latent 이슈 (foot-checkin 소유 — 참고)

- **`fn_selfcheckin_find_customer` anon EXECUTE = FALSE** (ANONSWEEP 회수). foot-checkin `SelfCheckIn.tsx:1704` 가 anon 으로 이 RPC 호출 → 42501(function). **단 try/catch(1709)로 삼켜져 non-fatal**(고객 미연결로 진행). 접수 자체는 막지 않으나, 검증예약 기존고객 자동연결이 조용히 실패 중일 수 있음 → foot-checkin 소유자 확인 권장.
- foot-checkin `SelfCheckIn.tsx:1730` 직접 anon `customers.update()` 잔존 — ANONSWEEP 하 42501(silent, 에러체크 없음). 검증예약 기존고객 동의/주소 갱신이 무영속일 수 있음 → foot-checkin 소유자 확인 권장.

## 4. RC 가설 (증거 정합순)

1. **transient 42501 during out-of-band createdby-canon 마이그(20260719120000) apply(~13:54)** — v3 `CREATE OR REPLACE`(또는 DROP+CREATE) 순간 catalog/권한 창에서 anon 호출이 순간 42501. 마이그 정착 후 self-recovered(현재 probe 정상). 필드 14:57 발생 시각과 근접.
2. (부차) 현장 태블릿이 stale/preview obliv 빌드(=`고객 등록 실패:` 문구 보유, resolve_v3 실패를 fatal 로 throw)를 연 상태에서 위 transient 창에 걸림.

## 5. 권고

- [obliv-foot-crm/DA] **DB grant 변경·DA CONSULT 불요.** DB 권한경로 정상, ANONSWEEP 유지가 정답.
- [planner] **이 P0 의 실 수정 대상은 `foot-checkin` 레포** — obliv-foot-crm(dev-foot) 스코프 밖. foot-checkin 소유자에게 재라우팅.
  - foot-checkin 측 권고: (a) anon RPC 실패에 대한 짧은 backoff 재시도 + raw SQL 오류 비노출(재시도 안내), (b) `fn_selfcheckin_find_customer` anon EXECUTE 회수건 재검토(RPC 경유 설계 전제 정합), (c) line 1730 직접 anon customers.update 를 SECDEF RPC 로 이관.
- [현장] 태블릿 접속 URL 이 **foot-checkin.pages.dev/jongno-foot** canonical 인지 확인(stale obliv/preview 북마크 배제).

## 6. 증거 스크립트 (read-only / ROLLBACK-only)

- `scripts/T-20260719-foot-WALKIN-CUSTOMERS-PERMISSION-DENIED_probe.mjs` — v3 definer/owner/grant + customers grant/owner/RLS + 실효권한
- `_probe2.mjs` — created_by 컬럼·트리거 + anon v3 라이브 재현(ROLLBACK)
- `_probe3.mjs` — v3 오버로드 전수 + valid E164 end-to-end 재현(ROLLBACK)
- `_probe4.mjs` — self_checkin_with_reservation_link/find_customer 권한 + 배포경로 재현(ROLLBACK)

전 스크립트 무영속(BEGIN…ROLLBACK / SELECT introspection). prod 데이터 변경 0.
