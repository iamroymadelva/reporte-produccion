-- Fase F4a / T077: se elimina save_frequent_catalog_value. La UI y la ruta de "valores frecuentes" ya se quitaron
-- en la Phase 2 (T110): el operario no crea catálogos y los managers los administran desde Administración.
drop function if exists public.save_frequent_catalog_value(text, text);
