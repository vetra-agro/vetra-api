import { Injectable, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

interface OWMCurrent {
  temp: number; feels_like: number; temp_min: number; temp_max: number;
  humidity: number; pressure: number; visibility?: number; uv?: number;
  dew_point?: number;
}

@Injectable()
export class WeatherService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  // ── Buscar chave da API nas configurações do tenant ──────────────────────
  private async getApiKey(tenantId: string): Promise<string | null> {
    const { data } = await this.db
      .from("settings")
      .select("value, default_value")
      .eq("key", "int_weather_key")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("tenant_id", { nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return data?.value ?? data?.default_value ?? null;
  }

  // ── Buscar coordenadas da fazenda ────────────────────────────────────────
  private async getFarmCoords(farmId: string): Promise<{ lat: number; lon: number; name: string } | null> {
    const { data } = await this.db
      .from("farms")
      .select("latitude, longitude, name, city, state")
      .eq("id", farmId)
      .single();

    if (!data?.latitude || !data?.longitude) {
      // Tentar geocodificar pela cidade
      return null;
    }
    return { lat: data.latitude, lon: data.longitude, name: data.name };
  }

  // ── Condição em português ────────────────────────────────────────────────
  private translateCondition(main: string, desc: string): string {
    const map: Record<string, string> = {
      "clear sky": "Céu limpo", "few clouds": "Poucas nuvens",
      "scattered clouds": "Nuvens dispersas", "broken clouds": "Nublado",
      "overcast clouds": "Muito nublado", "light rain": "Chuva fraca",
      "moderate rain": "Chuva moderada", "heavy intensity rain": "Chuva forte",
      "thunderstorm": "Tempestade", "light thunderstorm": "Trovoada fraca",
      "drizzle": "Garoa", "fog": "Neblina", "mist": "Névoa", "haze": "Névoa seca",
      "snow": "Neve", "sleet": "Granizo",
    };
    return map[desc.toLowerCase()] ?? desc;
  }

  // ── Previsão atual da fazenda (OpenWeatherMap) ───────────────────────────
  async getCurrentWeather(farmId: string, tenantId: string) {
    const apiKey = await this.getApiKey(tenantId);
    if (!apiKey) {
      throw new BadRequestException(
        "Chave da API OpenWeatherMap não configurada. Acesse Integrações > Previsão do tempo."
      );
    }

    const coords = await this.getFarmCoords(farmId);
    if (!coords) {
      throw new BadRequestException(
        "Fazenda sem coordenadas geográficas. Configure latitude e longitude no cadastro da fazenda."
      );
    }

    // Chama a OWM API (One Call 3.0 — gratuita com limite)
    const url = `https://api.openweathermap.org/data/2.5/weather`
      + `?lat=${coords.lat}&lon=${coords.lon}&appid=${apiKey}&units=metric&lang=pt_br`;

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new BadRequestException(`OpenWeatherMap: ${err.message ?? res.status}`);
    }
    const data = await res.json();

    const current = {
      temp_c:         Math.round(data.main.temp * 10) / 10,
      feels_like_c:   Math.round(data.main.feels_like * 10) / 10,
      temp_min_c:     Math.round(data.main.temp_min * 10) / 10,
      temp_max_c:     Math.round(data.main.temp_max * 10) / 10,
      humidity_pct:   data.main.humidity,
      pressure_hpa:   data.main.pressure,
      wind_speed_kmh: Math.round((data.wind?.speed ?? 0) * 3.6 * 10) / 10,
      wind_dir_deg:   data.wind?.deg,
      wind_gust_kmh:  data.wind?.gust ? Math.round(data.wind.gust * 3.6 * 10) / 10 : null,
      clouds_pct:     data.clouds?.all,
      visibility_m:   data.visibility,
      rain_1h_mm:     data.rain?.["1h"],
      condition_id:   data.weather?.[0]?.id,
      condition_main: data.weather?.[0]?.main,
      condition_desc: this.translateCondition(data.weather?.[0]?.main ?? "", data.weather?.[0]?.description ?? ""),
      condition_icon: data.weather?.[0]?.icon,
      sunrise_at:     data.sys?.sunrise ? new Date(data.sys.sunrise * 1000).toISOString() : null,
      sunset_at:      data.sys?.sunset  ? new Date(data.sys.sunset  * 1000).toISOString() : null,
      farm_name:      coords.name,
      lat:            coords.lat,
      lon:            coords.lon,
      read_at:        new Date().toISOString(),
    };

    // Salva no histórico (async, não bloqueia)
    void this.db.from("weather_readings").insert({
      tenant_id:      tenantId,
      farm_id:        farmId,
      ...current,
      raw_data:       data,
    });

    return current;
  }

  // ── Previsão para os próximos 5 dias (OWM forecast) ──────────────────────
  async getForecast(farmId: string, tenantId: string) {
    const apiKey = await this.getApiKey(tenantId);
    if (!apiKey) throw new BadRequestException("Chave API não configurada");

    const coords = await this.getFarmCoords(farmId);
    if (!coords) throw new BadRequestException("Fazenda sem coordenadas");

    const url = `https://api.openweathermap.org/data/2.5/forecast`
      + `?lat=${coords.lat}&lon=${coords.lon}&appid=${apiKey}&units=metric&lang=pt_br&cnt=40`;

    const res = await fetch(url);
    if (!res.ok) throw new BadRequestException("Erro ao buscar previsão");
    const data = await res.json();

    // Agrupa por dia (pega leitura das 12h ou a mais próxima)
    const byDay: Record<string, any[]> = {};
    for (const item of (data.list ?? [])) {
      const day = item.dt_txt.split(" ")[0];
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(item);
    }

    return Object.entries(byDay).slice(0, 7).map(([date, items]) => {
      const noon = items.find((i: any) => i.dt_txt.includes("12:00")) ?? items[0];
      const temps = items.map((i: any) => i.main.temp);
      return {
        date,
        temp_min_c:    Math.round(Math.min(...temps) * 10) / 10,
        temp_max_c:    Math.round(Math.max(...temps) * 10) / 10,
        humidity_pct:  noon.main.humidity,
        wind_speed_kmh:Math.round(noon.wind.speed * 3.6 * 10) / 10,
        rain_mm:       items.reduce((s: number, i: any) => s + (i.rain?.["3h"] ?? 0), 0),
        clouds_pct:    noon.clouds.all,
        condition_main:noon.weather[0].main,
        condition_desc:this.translateCondition(noon.weather[0].main, noon.weather[0].description),
        condition_icon:noon.weather[0].icon,
        pop:           Math.round(Math.max(...items.map((i:any)=>i.pop??0)) * 100), // prob. chuva %
      };
    });
  }

  // ── Histórico de leituras da fazenda ─────────────────────────────────────
  async getHistory(farmId: string, tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await this.db
      .from("weather_readings")
      .select("read_at,temp_c,humidity_pct,rain_1h_mm,wind_speed_kmh,condition_desc")
      .eq("farm_id",   farmId)
      .eq("tenant_id", tenantId)
      .gte("read_at",  since)
      .order("read_at", { ascending: false })
      .limit(500);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Última leitura salva de todas as fazendas ─────────────────────────────
  async getLatestByTenant(tenantId: string) {
    const { data, error } = await this.db
      .from("farm_weather_current")
      .select("farm_id, read_at, temp_c, humidity_pct, condition_desc, condition_icon, rain_1h_mm, wind_speed_kmh")
      .eq("tenant_id", tenantId);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
