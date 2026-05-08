/**
 * Vetra — WhatsApp Provider
 * Localização: vetra-api/src/common/whatsapp/whatsapp.provider.ts
 *
 * Integração com Meta WhatsApp Business Cloud API
 *
 * ─── COMO ATIVAR ────────────────────────────────────────────────────────────
 * 1. Acesse https://developers.facebook.com e crie um App do tipo "Business"
 * 2. Adicione o produto "WhatsApp" ao app
 * 3. Em WhatsApp > Getting Started, copie:
 *    - Phone Number ID (WHATSAPP_PHONE_NUMBER_ID)
 *    - Temporary Access Token ou gere um permanente via System User
 *      (WHATSAPP_ACCESS_TOKEN)
 * 4. Crie um template de mensagem chamado "purchase_order" no painel Meta
 *    (Business Manager > WhatsApp > Message Templates)
 *    Exemplo de template aprovado:
 *      "Olá {{1}}, o Pedido de Compra {{2}} no valor de {{3}} foi enviado
 *       pela {{4}}. O PDF do pedido está disponível em: {{5}}"
 * 5. Configure o webhook para receber status updates:
 *    URL: https://sua-api.render.com/purchases/whatsapp/webhook
 *    Verify token: qualquer string secreta (WHATSAPP_WEBHOOK_TOKEN)
 * 6. Adicione as variáveis de ambiente no Render:
 *    WHATSAPP_PHONE_NUMBER_ID=
 *    WHATSAPP_ACCESS_TOKEN=
 *    WHATSAPP_WEBHOOK_TOKEN=
 *    WHATSAPP_TEMPLATE_NAME=purchase_order
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface WhatsAppSendResult {
  success:    boolean;
  messageId?: string;
  error?:     string;
}

@Injectable()
export class WhatsAppProvider {
  private readonly logger = new Logger(WhatsAppProvider.name);

  constructor(private config: ConfigService) {}

  private get phoneNumberId(): string | undefined {
    return this.config.get<string>("WHATSAPP_PHONE_NUMBER_ID");
  }

  private get accessToken(): string | undefined {
    return this.config.get<string>("WHATSAPP_ACCESS_TOKEN");
  }

  private get templateName(): string {
    return this.config.get<string>("WHATSAPP_TEMPLATE_NAME") ?? "purchase_order";
  }

  get isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken);
  }

  /**
   * Normaliza número de telefone para formato E.164 sem o "+"
   * Ex: "(11) 99999-9999" → "5511999999999"
   * Ex: "+55 11 99999-9999" → "5511999999999"
   */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    // Adiciona DDI 55 se não tiver
    if (digits.startsWith("55") && digits.length >= 12) return digits;
    if (digits.length === 11 || digits.length === 10) return `55${digits}`;
    return digits;
  }

  /**
   * Envia o PO via WhatsApp usando um template aprovado pela Meta.
   *
   * @param to          Número do destinatário (qualquer formato)
   * @param params      Parâmetros do template na ordem definida no painel Meta
   * @param pdfUrl      URL pública do PDF do PO (incluída no template)
   */
  async sendPurchaseOrder(
    to:     string,
    params: {
      supplierName:  string;   // {{1}} nome do fornecedor
      orderNumber:   string;   // {{2}} número do pedido
      totalAmount:   string;   // {{3}} valor formatado
      companyName:   string;   // {{4}} nome da empresa/fazenda
      pdfUrl:        string;   // {{5}} link para o PDF
    }
  ): Promise<WhatsAppSendResult> {

    // ── TODO: REMOVER ESTE BLOCO QUANDO A CONTA META ESTIVER CONFIGURADA ──
    if (!this.isConfigured) {
      this.logger.warn(
        `[TODO] WhatsApp não configurado. ` +
        `Seria enviado para ${to}: PO ${params.orderNumber} ` +
        `(${params.totalAmount}) via template "${this.templateName}". ` +
        `Configure WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN no Render.`
      );
      // Simula sucesso em desenvolvimento para não bloquear o fluxo
      return {
        success:   true,
        messageId: `TODO_${Date.now()}`,
      };
    }
    // ──────────────────────────────────────────────────────────────────────

    const phone = this.normalizePhone(to);
    const url   = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;

    const body = {
      messaging_product: "whatsapp",
      to:                phone,
      type:              "template",
      template: {
        name:     this.templateName,
        language: { code: "pt_BR" },
        components: [
          {
            type:       "body",
            parameters: [
              { type:"text", text: params.supplierName },
              { type:"text", text: params.orderNumber  },
              { type:"text", text: params.totalAmount  },
              { type:"text", text: params.companyName  },
              { type:"text", text: params.pdfUrl       },
            ],
          },
        ],
      },
    };

    try {
      const response = await fetch(url, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        this.logger.error(`WhatsApp API error: ${JSON.stringify(data)}`);
        return {
          success: false,
          error:   data?.error?.message ?? `HTTP ${response.status}`,
        };
      }

      const messageId = data?.messages?.[0]?.id;
      this.logger.log(`WhatsApp PO enviado para ${phone}. MessageId: ${messageId}`);
      return { success: true, messageId };

    } catch (err: any) {
      this.logger.error(`WhatsApp fetch error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Processa webhook de status da Meta.
   * Status possíveis: sent, delivered, read, failed
   */
  parseWebhookStatus(payload: any): {
    messageId: string;
    status:    "sent" | "delivered" | "read" | "failed";
    phone:     string;
  } | null {
    try {
      const entry   = payload?.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      const status  = changes?.statuses?.[0];
      if (!status) return null;
      return {
        messageId: status.id,
        status:    status.status,
        phone:     status.recipient_id,
      };
    } catch {
      return null;
    }
  }
}
