-- ============================================================
-- Vetra — Histórico de dados meteorológicos por fazenda
-- Armazena snapshots das leituras para correlação agronômica
-- ============================================================

CREATE TABLE weather_readings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id         UUID NOT NULL REFERENCES farms(id)   ON DELETE CASCADE,

  -- Momento da leitura
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          VARCHAR(50) DEFAULT 'openweathermap', -- fonte dos dados

  -- Condições atuais
  temp_c          NUMERIC(5,2),         -- temperatura (°C)
  feels_like_c    NUMERIC(5,2),         -- sensação térmica (°C)
  temp_min_c      NUMERIC(5,2),         -- mín do dia
  temp_max_c      NUMERIC(5,2),         -- máx do dia
  humidity_pct    NUMERIC(5,1),         -- umidade relativa (%)
  pressure_hpa    NUMERIC(7,2),         -- pressão atmosférica (hPa)
  wind_speed_kmh  NUMERIC(6,2),         -- velocidade do vento (km/h)
  wind_dir_deg    NUMERIC(5,1),         -- direção do vento (graus)
  wind_gust_kmh   NUMERIC(6,2),         -- rajadas (km/h)
  clouds_pct      NUMERIC(5,1),         -- cobertura de nuvens (%)
  visibility_m    INTEGER,              -- visibilidade (metros)
  uv_index        NUMERIC(4,1),         -- índice UV
  dew_point_c     NUMERIC(5,2),         -- ponto de orvalho (°C)

  -- Precipitação
  rain_1h_mm      NUMERIC(6,2),         -- chuva última hora (mm)
  rain_24h_mm     NUMERIC(7,2),         -- chuva últimas 24h (mm)
  snow_1h_mm      NUMERIC(6,2),         -- neve última hora

  -- Condição geral
  condition_id    INTEGER,              -- código OWM (800=céu limpo, etc)
  condition_main  VARCHAR(50),          -- "Clear","Clouds","Rain","Thunderstorm"
  condition_desc  VARCHAR(200),         -- descrição em PT
  condition_icon  VARCHAR(10),          -- código do ícone OWM

  -- Nascer/pôr do sol
  sunrise_at      TIMESTAMPTZ,
  sunset_at       TIMESTAMPTZ,

  -- Dados brutos (para reprocessamento futuro)
  raw_data        JSONB,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX weather_farm_idx    ON weather_readings (farm_id, read_at DESC);
CREATE INDEX weather_tenant_idx  ON weather_readings (tenant_id);
CREATE INDEX weather_date_idx    ON weather_readings (read_at DESC);

-- RLS
ALTER TABLE weather_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY weather_tenant_isolation ON weather_readings
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- View: última leitura por fazenda
CREATE VIEW farm_weather_current AS
SELECT DISTINCT ON (farm_id)
  *
FROM weather_readings
ORDER BY farm_id, read_at DESC;
