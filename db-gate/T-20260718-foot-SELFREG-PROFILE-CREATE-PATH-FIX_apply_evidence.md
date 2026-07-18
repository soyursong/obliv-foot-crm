# T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — apply evidence (POST-APPLY 실측)
ref=rxlomoozakkjesdqjtvd · mig=20260718220000_foot_selfreg_handle_new_user_canon · verified_at=2026-07-18 21:08:00 KST
adopted=B(auth.users 트리거) · women 동형 승계 · 벤더잔차 canon 재정의(CREATE OR REPLACE, 비파괴).

## [POST-APPLY] handle_new_user canon 실측
  · SECURITY DEFINER : true  (true 기대)
  · owner            : postgres  (postgres 기대)
  · search_path cfg  : ["search_path=\"\""]  (empty 기대, public 잔차 제거)
  · anon EXECUTE     : false  (false 기대 — AC3 게이트: surface 증가 0)
  · authenticated EX : true  (정보성·비게이트 — role-default 경유 잔존, trigger-return 함수 직접호출 불가라 무해, women parity)
  · canon COMMENT    : present ✅
  · on_auth_user_created 트리거 count : 1  (1 기대)
  ⇒ canon 검증 = ✅ PASS

## [LEDGER] schema_migrations 3자 대조
  · 파일선언 : 20260718220000/foot_selfreg_handle_new_user_canon
  · 원장등재 : [{"version":"20260718220000","name":"foot_selfreg_handle_new_user_canon"}]
  · prod 실재 : canon=true
  · clean = ✅

## [SMOKE] signup 전수 스모크 (auth.users INSERT → user_profiles canon, SAVEPOINT 롤백 무영속)
  · [화이트리스트 coordinator 유지] ✅ (role=coordinator·approved=false·clinic=jongno-foot 검증 후 롤백)
  · [admin 자기선언 → staff 강등] ✅ (role=staff·approved=false·clinic=jongno-foot 검증 후 롤백)
  · [director 자기선언 → staff 강등] ✅ (role=staff·approved=false·clinic=jongno-foot 검증 후 롤백)
  · [role 누락 → staff] ✅ (role=staff·approved=false·clinic=jongno-foot 검증 후 롤백)

## [POSTCHECK 요약] applied_at=2026-07-18 21:08:01 KST
  · canon(SECDEF/owner=postgres/search_path=''/anon-exec=false/trigger=1/COMMENT) = true
  · ledger clean = true
  · signup 전수 스모크(4케이스: 화이트리스트 유지·admin/director 강등·no-role→staff, 전부 approved=false·clinic 파생) = true
  · anon table-write 재노출 0 · anon EXECUTE 증가 0 (BEFORE anon-exec=false → POST anon-exec=false 유지)
  · 벤더잔차 제거: search_path public→'' · 최초유저 admin+approved 자동승격 백도어 제거 · owner=postgres 명시

판정: ✅ ALL PASS — supervisor DDL-diff DB-GATE 요청 준비 완료
