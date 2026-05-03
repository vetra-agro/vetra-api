-- ============================================================
-- Vetra — View de histórico por safra e área
-- Sem novas tabelas — consolida dados existentes
-- ============================================================

-- Vista: histórico consolidado por safra
CREATE OR REPLACE VIEW season_history AS
SELECT
  s.id                    AS season_id,
  s.tenant_id,
  s.farm_id,
  s.name                  AS season_name,
  s.code                  AS season_code,
  s.crop,
  s.variety,
  s.type                  AS season_type,
  s.status,
  s.planting_start,
  s.harvest_end,
  s.total_area_ha,
  s.planted_area_ha,
  s.harvested_area_ha,
  s.expected_yield_sc_ha,
  s.actual_yield_sc_ha,
  s.actual_production_sc,
  s.unit,
  s.expected_cost_ha,
  s.actual_cost_ha,
  s.price_per_unit,
  s.actual_revenue,
  s.rainfall_mm,
  s.avg_temp_c,
  s.field_ids,
  -- Fazenda
  f.name                  AS farm_name,
  f.state                 AS farm_state,
  f.city                  AS farm_city,
  -- Contagem de atividades na safra
  (SELECT COUNT(*) FROM activities a
   WHERE a.season_id = s.id)          AS activity_count,
  -- Área total trabalhada em atividades
  (SELECT COALESCE(SUM(a.area_ha),0) FROM activities a
   WHERE a.season_id = s.id)          AS activity_area_ha,
  -- Custo total de atividades
  (SELECT COALESCE(SUM(a.total_cost),0) FROM activities a
   WHERE a.season_id = s.id)          AS activity_cost,
  -- Pulverizações na safra
  (SELECT COUNT(*) FROM phytosanitary_applications pa
   WHERE pa.season_id = s.id)         AS spray_count,
  -- Custo de fitossanitários
  (SELECT COALESCE(SUM(pa.total_cost),0) FROM phytosanitary_applications pa
   WHERE pa.season_id = s.id)         AS spray_cost,
  -- Combustível consumido na safra
  (SELECT COALESCE(SUM(fs.quantity_l),0) FROM fuel_supplies fs
   WHERE fs.season_id = s.id)         AS fuel_qty_l,
  (SELECT COALESCE(SUM(fs.total_cost),0) FROM fuel_supplies fs
   WHERE fs.season_id = s.id)         AS fuel_cost,
  -- Custo total consolidado (atividades + fitossanitários + combustível + custo/ha manual)
  COALESCE(
    (SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id), 0
  ) +
  COALESCE(
    (SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0
  ) +
  COALESCE(
    (SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0
  ) +
  COALESCE(s.actual_cost_ha * s.planted_area_ha, 0)  AS total_cost_consolidated,
  -- Margem bruta estimada
  CASE
    WHEN s.actual_yield_sc_ha IS NOT NULL
     AND s.price_per_unit     IS NOT NULL
     AND s.planted_area_ha    IS NOT NULL
    THEN ROUND(
      (s.actual_yield_sc_ha * s.price_per_unit * s.planted_area_ha)
      - COALESCE(s.actual_cost_ha * s.planted_area_ha, 0), 2
    )
    ELSE NULL
  END AS gross_margin
FROM seasons s
JOIN farms f ON f.id = s.farm_id;

-- Vista: histórico por talhão (agrega todas as safras que passaram pelo talhão)
CREATE OR REPLACE VIEW field_history AS
SELECT
  fi.id          AS field_id,
  fi.farm_id,
  fi.tenant_id,
  fi.name        AS field_name,
  fi.code        AS field_code,
  fi.area_ha,
  fi.color,
  -- Safras que incluem este talhão
  (SELECT COUNT(DISTINCT s.id)
   FROM seasons s
   WHERE fi.id = ANY(s.field_ids))              AS season_count,
  -- Culturas já plantadas neste talhão
  (SELECT ARRAY_AGG(DISTINCT s.crop)
   FROM seasons s
   WHERE fi.id = ANY(s.field_ids))              AS crops_history,
  -- Produtividade média histórica
  (SELECT ROUND(AVG(s.actual_yield_sc_ha), 2)
   FROM seasons s
   WHERE fi.id = ANY(s.field_ids)
     AND s.actual_yield_sc_ha IS NOT NULL)       AS avg_yield_sc_ha,
  -- Melhor produtividade
  (SELECT MAX(s.actual_yield_sc_ha)
   FROM seasons s
   WHERE fi.id = ANY(s.field_ids))              AS best_yield_sc_ha,
  -- Atividades no talhão (de qualquer safra)
  (SELECT COUNT(*)
   FROM activities a
   WHERE fi.id = ANY(a.field_ids))              AS total_activities,
  -- Pulverizações no talhão
  (SELECT COUNT(*)
   FROM phytosanitary_applications pa
   WHERE fi.id = ANY(pa.field_ids))             AS total_sprays,
  -- Última safra no talhão
  (SELECT s.name
   FROM seasons s
   WHERE fi.id = ANY(s.field_ids)
   ORDER BY s.planting_start DESC NULLS LAST
   LIMIT 1)                                     AS last_season_name,
  (SELECT s.crop
   FROM seasons s
   WHERE fi.id = ANY(s.field_ids)
   ORDER BY s.planting_start DESC NULLS LAST
   LIMIT 1)                                     AS last_crop
FROM fields fi;
