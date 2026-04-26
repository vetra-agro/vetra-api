import { Injectable } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

export interface IntegrationStatus {
  key:         string;
  name:        string;
  description: string;
  category:    string;
  enabled:     boolean;
  configured:  boolean;   // tem chave/url preenchida
  status:      "ok" | "error" | "unconfigured" | "disabled";
  statusMsg?:  string;
  docsUrl?:    string;
  fields:      IntegrationField[];
}

export interface IntegrationField {
  key:         string;
  label:       string;
  type:        string;
  value?:      string;
  placeholder? :string;
  required:    boolean;
  helpText?:   string;
}

// Catálogo estático de integrações disponíveis
const INTEGRATIONS_CATALOG = [
  {
    key:         "maps",
    name:        "Mapas",
    description: "Tiles de mapas para visualização de fazendas e talhões",
    category:    "Geoespacial",
    docsUrl:     "https://docs.maptiler.com/",
    fields: [
      { key:"int_maps_provider", label:"Provedor",   type:"select",   required:true,
        placeholder:"Selecione o provedor",
        helpText:"MapTiler oferece 100k requisições/mês grátis" },
      { key:"int_maps_key",      label:"Chave API",  type:"secret",   required:true,
        placeholder:"Chave de autenticação do provedor de mapas" },
    ],
  },
  {
    key:         "weather",
    name:        "Previsão do tempo",
    description: "Dados meteorológicos e previsão para as fazendas",
    category:    "Clima",
    docsUrl:     "https://openweathermap.org/api",
    fields: [
      { key:"int_weather_key", label:"Chave OpenWeatherMap", type:"secret", required:true,
        placeholder:"Obtenha em openweathermap.org/api" },
    ],
  },
  {
    key:         "satellite",
    name:        "Imagens de satélite (NDVI)",
    description: "Índice de vegetação por satélite via Sentinel Hub",
    category:    "Geoespacial",
    docsUrl:     "https://www.sentinel-hub.com/",
    fields: [
      { key:"int_sentinel_key", label:"Chave Sentinel Hub", type:"secret", required:true,
        placeholder:"Chave de API do Sentinel Hub" },
    ],
  },
  {
    key:         "bi",
    name:        "BI e Analytics",
    description: "Ferramenta de Business Intelligence embarcada",
    category:    "Análise",
    docsUrl:     "https://superset.apache.org/",
    fields: [
      { key:"int_bi_tool", label:"Ferramenta", type:"select",   required:true,
        placeholder:"Selecione a ferramenta de BI" },
      { key:"int_bi_url",  label:"URL base",   type:"url",      required:true,
        placeholder:"https://bi.suaempresa.com" },
    ],
  },
  {
    key:         "storage",
    name:        "Armazenamento de arquivos",
    description: "Provedor para upload de documentos, fotos e laudos",
    category:    "Infraestrutura",
    docsUrl:     "https://supabase.com/docs/guides/storage",
    fields: [
      { key:"int_storage_provider", label:"Provedor", type:"select", required:true,
        placeholder:"Selecione o provedor de storage" },
    ],
  },
];

@Injectable()
export class IntegrationsService {
  constructor(private supabase: SupabaseProvider) {}

  private get db() { return this.supabase.getAdminClient(); }

  // ── Busca todas as integrações com valores do settings ───────────────────
  async getAll(tenantId: string): Promise<IntegrationStatus[]> {
    // Busca settings do grupo integrations
    const { data: settings } = await this.db
      .from("settings")
      .select("tenant_id, key, value, default_value, options")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .in("group_name", ["integrations"]);

    const settingsMap = new Map<string, any>();
    for (const s of (settings ?? [])) {
      // tenant override tem prioridade sobre default
      if (!settingsMap.has(s.key) || s.tenant_id === tenantId) {
        settingsMap.set(s.key, s);
      }
    }

    return INTEGRATIONS_CATALOG.map((intg) => {
      const fields: IntegrationField[] = intg.fields.map((f) => {
        const setting = settingsMap.get(f.key);
        const options = setting?.options
          ? (typeof setting.options === "string" ? JSON.parse(setting.options) : setting.options)
          : undefined;
        return {
          ...f,
          value:   setting?.value ?? setting?.default_value ?? "",
          options,
        };
      });

      const requiredFields = fields.filter((f) => f.required);
      const configured = requiredFields.every((f) => f.value && f.value.length > 0);
      const enabled = configured; // habilitado = configurado (pode customizar)

      return {
        key:         intg.key,
        name:        intg.name,
        description: intg.description,
        category:    intg.category,
        docsUrl:     intg.docsUrl,
        enabled,
        configured,
        status:      !configured ? "unconfigured" : "ok",
        statusMsg:   !configured ? "Configure os campos obrigatórios" : "Integração configurada",
        fields,
      };
    });
  }

  // ── Salvar campos de uma integração ──────────────────────────────────────
  async saveIntegration(
    tenantId: string,
    integrationKey: string,
    values: Record<string, string>,
    userId?: string,
  ) {
    const catalog = INTEGRATIONS_CATALOG.find((i) => i.key === integrationKey);
    if (!catalog) throw new Error("Integração não encontrada");

    const rows = catalog.fields
      .filter((f) => values[f.key] !== undefined)
      .map((f) => ({
        tenant_id:  tenantId,
        key:        f.key,
        group_name: "integrations",
        label:      f.label,
        type:       f.type,
        value:      values[f.key],
        updated_by: userId,
      }));

    const { error } = await this.db
      .from("settings")
      .upsert(rows, { onConflict: "tenant_id,key" });

    if (error) throw new Error(error.message);
    return { saved: rows.length };
  }

  // ── Testar conexão de uma integração ─────────────────────────────────────
  async testIntegration(tenantId: string, integrationKey: string) {
    const integrations = await this.getAll(tenantId);
    const intg = integrations.find((i) => i.key === integrationKey);

    if (!intg) return { success: false, message: "Integração não encontrada" };
    if (!intg.configured) return { success: false, message: "Integração não configurada" };

    // Testes reais por tipo
    try {
      switch (integrationKey) {
        case "maps": {
          const keyField = intg.fields.find((f) => f.key === "int_maps_key");
          const provField = intg.fields.find((f) => f.key === "int_maps_provider");
          if (provField?.value === "maptiler" && keyField?.value) {
            const res = await fetch(
              `https://api.maptiler.com/maps/streets/style.json?key=${keyField.value}`,
              { method: "HEAD" }
            );
            return {
              success: res.ok,
              message: res.ok ? "MapTiler conectado com sucesso" : `Erro ${res.status} — verifique a chave API`,
            };
          }
          return { success: true, message: "Configuração de mapas salva" };
        }

        case "weather": {
          const keyField = intg.fields.find((f) => f.key === "int_weather_key");
          if (keyField?.value) {
            const res = await fetch(
              `https://api.openweathermap.org/data/2.5/weather?q=Brasilia&appid=${keyField.value}`
            );
            const data = await res.json();
            return {
              success: res.ok,
              message: res.ok
                ? `OpenWeatherMap conectado — ${data.name ?? "OK"}`
                : `Erro: ${data.message ?? "Chave inválida"}`,
            };
          }
          return { success: false, message: "Chave não configurada" };
        }

        case "bi": {
          const urlField = intg.fields.find((f) => f.key === "int_bi_url");
          if (urlField?.value) {
            try {
              const res = await fetch(`${urlField.value}/health`, {
                signal: AbortSignal.timeout(5000),
              });
              return {
                success: res.ok || res.status === 401,
                message: res.ok ? "BI acessível" : `Status ${res.status} — verifique a URL`,
              };
            } catch {
              return { success: false, message: "Não foi possível conectar à URL do BI" };
            }
          }
          return { success: false, message: "URL não configurada" };
        }

        default:
          return { success: true, message: "Configuração salva — teste manual necessário" };
      }
    } catch (e: any) {
      return { success: false, message: e.message ?? "Erro ao testar integração" };
    }
  }
}
