-- T-20260525-foot-FEE-SET-TEMPLATE AC-3
-- fee_set_templates 기본 시드 3건
-- 종로 풋센터 (clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8)
--
-- 1. 초진/무좀  : 초진진찰료(AA154) + 프리컨디셔닝(PC) + 가열성진균증레이저(SZ035-35) + 균검사(D620300HZ)
-- 2. 초진/내성  : 초진진찰료(AA154) + 원인제거(원인제거) + 포돌로게(BC1300MB08)
-- 3. 재진/내성  : 재진진찰료(AA254) + 단순처치1일(M0111) + 원인제거(원인제거) + 포돌로게(BC1300MB08)
--
-- rollback: 20260525020000_fee_set_templates_seed.down.sql

DO $$
DECLARE
  v_clinic_id       UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_choejin_id      UUID;
  v_precond_id      UUID;
  v_laser_hot_id    UUID;
  v_koh_id          UUID;
  v_woninjegeo_id   UUID;
  v_podologe_id     UUID;
  v_reijin_id       UUID;
  v_dansuchyeo_id   UUID;
  v_items           JSONB;
BEGIN
  -- 서비스 ID 조회 (service_code 기준)
  SELECT id INTO v_choejin_id    FROM services WHERE clinic_id = v_clinic_id AND service_code = 'AA154'        LIMIT 1;
  SELECT id INTO v_precond_id    FROM services WHERE clinic_id = v_clinic_id AND service_code = 'FC011'        LIMIT 1; -- 프리컨디셔닝 (현장 실제 code)
  SELECT id INTO v_laser_hot_id  FROM services WHERE clinic_id = v_clinic_id AND service_code = 'SZ035-35'    LIMIT 1;
  SELECT id INTO v_koh_id        FROM services WHERE clinic_id = v_clinic_id AND service_code = 'D620300HZ'   LIMIT 1;
  SELECT id INTO v_woninjegeo_id FROM services WHERE clinic_id = v_clinic_id AND service_code = '원인제거'     LIMIT 1;
  SELECT id INTO v_podologe_id   FROM services WHERE clinic_id = v_clinic_id AND service_code = 'BC1300MB08'  LIMIT 1;
  SELECT id INTO v_reijin_id     FROM services WHERE clinic_id = v_clinic_id AND service_code = 'AA254'       LIMIT 1;
  SELECT id INTO v_dansuchyeo_id FROM services WHERE clinic_id = v_clinic_id AND service_code = 'M0111'       LIMIT 1;

  RAISE NOTICE 'service IDs — choejin:% precond:% laser_hot:% koh:% woninjegeo:% podologe:% reijin:% dansuchyeo:%',
    v_choejin_id, v_precond_id, v_laser_hot_id, v_koh_id,
    v_woninjegeo_id, v_podologe_id, v_reijin_id, v_dansuchyeo_id;

  -- ── 1. 초진/무좀 ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM fee_set_templates
    WHERE clinic_id = v_clinic_id AND set_name = '초진/무좀' AND is_active = true
  ) THEN
    IF v_choejin_id IS NOT NULL AND v_precond_id IS NOT NULL THEN
      -- 기본 2개 항목
      v_items := jsonb_build_array(
        jsonb_build_object('service_id', v_choejin_id::text, 'sort_order', 1),
        jsonb_build_object('service_id', v_precond_id::text, 'sort_order', 2)
      );
      -- 레이저 추가 (있는 경우)
      IF v_laser_hot_id IS NOT NULL THEN
        v_items := v_items || jsonb_build_array(
          jsonb_build_object('service_id', v_laser_hot_id::text, 'sort_order', 3)
        );
      END IF;
      -- 균검사 추가 (있는 경우)
      IF v_koh_id IS NOT NULL THEN
        v_items := v_items || jsonb_build_array(
          jsonb_build_object('service_id', v_koh_id::text, 'sort_order', 4)
        );
      END IF;

      INSERT INTO fee_set_templates (clinic_id, set_name, items, is_active, sort_order)
      VALUES (v_clinic_id, '초진/무좀', v_items, true, 1);
      RAISE NOTICE '✅ 초진/무좀 시드 삽입 완료 (items: %)', jsonb_array_length(v_items);
    ELSE
      RAISE WARNING '⚠️  초진/무좀 시드 스킵 — 필수 서비스 미존재 (choejin:%, precond:%)', v_choejin_id, v_precond_id;
    END IF;
  ELSE
    RAISE NOTICE 'ℹ️  초진/무좀 이미 존재 — 스킵';
  END IF;

  -- ── 2. 초진/내성 ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM fee_set_templates
    WHERE clinic_id = v_clinic_id AND set_name = '초진/내성' AND is_active = true
  ) THEN
    IF v_choejin_id IS NOT NULL AND v_woninjegeo_id IS NOT NULL AND v_podologe_id IS NOT NULL THEN
      INSERT INTO fee_set_templates (clinic_id, set_name, items, is_active, sort_order)
      VALUES (
        v_clinic_id,
        '초진/내성',
        jsonb_build_array(
          jsonb_build_object('service_id', v_choejin_id::text,    'sort_order', 1),
          jsonb_build_object('service_id', v_woninjegeo_id::text, 'sort_order', 2),
          jsonb_build_object('service_id', v_podologe_id::text,   'sort_order', 3)
        ),
        true,
        2
      );
      RAISE NOTICE '✅ 초진/내성 시드 삽입 완료';
    ELSE
      RAISE WARNING '⚠️  초진/내성 시드 스킵 — 필수 서비스 미존재 (choejin:%, woninjegeo:%, podologe:%)',
        v_choejin_id, v_woninjegeo_id, v_podologe_id;
    END IF;
  ELSE
    RAISE NOTICE 'ℹ️  초진/내성 이미 존재 — 스킵';
  END IF;

  -- ── 3. 재진/내성 ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM fee_set_templates
    WHERE clinic_id = v_clinic_id AND set_name = '재진/내성' AND is_active = true
  ) THEN
    IF v_reijin_id IS NOT NULL AND v_woninjegeo_id IS NOT NULL AND v_podologe_id IS NOT NULL THEN
      -- 재진 + 단순처치(있으면) + 원인제거 + 포돌로게
      v_items := jsonb_build_array(
        jsonb_build_object('service_id', v_reijin_id::text, 'sort_order', 1)
      );
      IF v_dansuchyeo_id IS NOT NULL THEN
        v_items := v_items || jsonb_build_array(
          jsonb_build_object('service_id', v_dansuchyeo_id::text, 'sort_order', 2)
        );
      END IF;
      v_items := v_items || jsonb_build_array(
        jsonb_build_object('service_id', v_woninjegeo_id::text, 'sort_order', 3),
        jsonb_build_object('service_id', v_podologe_id::text,   'sort_order', 4)
      );

      INSERT INTO fee_set_templates (clinic_id, set_name, items, is_active, sort_order)
      VALUES (v_clinic_id, '재진/내성', v_items, true, 3);
      RAISE NOTICE '✅ 재진/내성 시드 삽입 완료 (items: %)', jsonb_array_length(v_items);
    ELSE
      RAISE WARNING '⚠️  재진/내성 시드 스킵 — 필수 서비스 미존재 (reijin:%, woninjegeo:%, podologe:%)',
        v_reijin_id, v_woninjegeo_id, v_podologe_id;
    END IF;
  ELSE
    RAISE NOTICE 'ℹ️  재진/내성 이미 존재 — 스킵';
  END IF;

  RAISE NOTICE '✅ fee_set_templates 시드 완료';
END $$;
