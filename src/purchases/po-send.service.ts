/**
 * Vetra — PO Send Service
 * Localização: vetra-api/src/purchases/po-send.service.ts
 *
 * Orquestra:
 * 1. Busca dados completos do pedido
 * 2. Gera PDF do PO
 * 3. Faz upload do PDF para Supabase Storage
 * 4. Envia via WhatsApp para o telefone do parceiro
 * 5. Atualiza status do pedido para "sent" + tracking WhatsApp
 */

import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";
import { WhatsAppProvider } from "../common/whatsapp/whatsapp.provider";
import { POPdfGenerator, POData } from "./po-pdf.generator";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class POSendService {
  constructor(
    private supabase:   SupabaseProvider,
    private whatsapp:   WhatsAppProvider,
    private pdfGen:     POPdfGenerator,
    private config:     ConfigService,
  ) {}

  private get db() { return this.supabase.getAdminClient(); }

  async sendPO(orderId: string, tenantId: string, options?: {
    phoneOverride?: string;  // sobrescreve telefone do parceiro (útil para teste)
  }): Promise<{
    success:       boolean;
    pdfUrl:        string;
    whatsappSent:  boolean;
    whatsappId?:   string;
    phone?:        string;
    message:       string;
  }> {

    // ── 1. Busca pedido completo ──────────────────────────────────────────
    const { data: order, error } = await this.db
      .from("purchase_orders_summary")
      .select("*")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !order) throw new NotFoundException("Pedido não encontrado");

    if (!["approved", "draft"].includes(order.status)) {
      throw new BadRequestException(
        `Pedido está com status "${order.status}". Somente pedidos aprovados podem ser enviados.`
      );
    }

    // Valida telefone
    const phone = options?.phoneOverride ?? order.partner_phone;
    if (!phone) {
      throw new BadRequestException(
        `O fornecedor "${order.partner_name}" não tem telefone/WhatsApp cadastrado. ` +
        `Acesse Administração → Parceiros e adicione o número.`
      );
    }

    // ── 2. Monta dados do PO ──────────────────────────────────────────────
    const { data: tenant } = await this.db
      .from("tenants").select("name").eq("id", tenantId).single();

    const poData: POData = {
      orderNumber:      order.order_number ?? `PO-${orderId.slice(0, 8).toUpperCase()}`,
      orderDate:        order.order_date,
      expectedDelivery: order.expected_delivery,
      companyName:      tenant?.name ?? "Fazenda",
      farmName:         order.farm_name,
      seasonName:       order.season_name,
      partnerName:      order.partner_name,
      partnerDocument:  order.partner_document,
      partnerPhone:     phone,
      partnerEmail:     order.partner_email,
      paymentTerms:     order.payment_terms,
      deliveryAddress:  order.delivery_address,
      items:            (order.items ?? []).map((i: any) => ({
        product:    i.product,
        unit:       i.unit,
        qty:        +i.qty        || 0,
        unit_price: +i.unit_price || 0,
        total:      (+i.qty || 0) * (+i.unit_price || 0),
      })),
      subtotal:    +order.subtotal     || 0,
      discount:    +order.discount     || 0,
      freight:     +order.freight      || 0,
      taxes:       +order.taxes        || 0,
      totalAmount: +order.total_amount || 0,
      notes:       order.notes,
    };

    // ── 3. Gera PDF ───────────────────────────────────────────────────────
    const pdfBuffer = await this.pdfGen.generatePDF(poData);
    const fileName  = `po-${orderId}-${Date.now()}.pdf`;

    // ── 4. Upload para Supabase Storage ───────────────────────────────────
    let pdfUrl = "";
    try {
      const { data: upload, error: uploadErr } = await this.db.storage
        .from("purchase-orders")
        .upload(fileName, pdfBuffer, {
          contentType: "application/pdf",
          upsert:      true,
        });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = this.db.storage
        .from("purchase-orders")
        .getPublicUrl(fileName);

      pdfUrl = urlData?.publicUrl ?? "";
    } catch (uploadErr: any) {
      // TODO: Criar o bucket "purchase-orders" no Supabase Storage com acesso público
      // Se o bucket não existir, continua sem URL do PDF
      pdfUrl = `[PDF não disponível — crie o bucket "purchase-orders" no Supabase Storage]`;
    }

    // ── 5. Envia via WhatsApp ─────────────────────────────────────────────
    const fmtR$ = (v: number) =>
      `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

    const wpResult = await this.whatsapp.sendPurchaseOrder(phone, {
      supplierName: order.partner_name,
      orderNumber:  poData.orderNumber,
      totalAmount:  fmtR$(poData.totalAmount),
      companyName:  poData.companyName,
      pdfUrl:       pdfUrl || "Em breve disponível",
    });

    // ── 6. Atualiza pedido ────────────────────────────────────────────────
    await this.db.from("purchase_orders").update({
      status:              "sent",
      whatsapp_sent_at:    new Date().toISOString(),
      whatsapp_status:     wpResult.success ? "sent" : "failed",
      whatsapp_message_id: wpResult.messageId ?? null,
      po_pdf_url:          pdfUrl || null,
    }).eq("id", orderId);

    return {
      success:      true,
      pdfUrl,
      whatsappSent: wpResult.success,
      whatsappId:   wpResult.messageId,
      phone,
      message:      wpResult.success
        ? `PO enviado via WhatsApp para ${phone}`
        : `PDF gerado mas envio WhatsApp falhou: ${wpResult.error}`,
    };
  }

  /**
   * Webhook da Meta — atualiza o status do WhatsApp no pedido.
   * Quando o fornecedor lê a mensagem → status = "read" → pedido = "sent" confirmado.
   */
  async processWebhook(payload: any): Promise<void> {
    const status = this.whatsapp.parseWebhookStatus(payload);
    if (!status) return;

    // Encontra o pedido pelo messageId
    const { data: order } = await this.db
      .from("purchase_orders")
      .select("id")
      .eq("whatsapp_message_id", status.messageId)
      .maybeSingle();

    if (!order) return;

    await this.db.from("purchase_orders").update({
      whatsapp_status: status.status,
    }).eq("id", order.id);
  }

  /**
   * Retorna o HTML do PO para preview no browser (sem gerar PDF).
   */
  async previewHTML(orderId: string, tenantId: string): Promise<string> {
    const result = await this.sendPO(orderId, tenantId, { phoneOverride: "PREVIEW" });
    // Re-busca os dados para gerar o HTML
    const { data: order } = await this.db
      .from("purchase_orders_summary").select("*")
      .eq("id", orderId).single();
    const { data: tenant } = await this.db
      .from("tenants").select("name").eq("id", tenantId).single();

    const poData: POData = {
      orderNumber:      order?.order_number ?? orderId.slice(0, 8).toUpperCase(),
      orderDate:        order?.order_date,
      expectedDelivery: order?.expected_delivery,
      companyName:      tenant?.name ?? "Fazenda",
      farmName:         order?.farm_name,
      partnerName:      order?.partner_name,
      partnerPhone:     order?.partner_phone,
      paymentTerms:     order?.payment_terms,
      items:            (order?.items ?? []).map((i: any) => ({
        product:    i.product, unit: i.unit,
        qty:        +i.qty || 0, unit_price: +i.unit_price || 0,
        total:      (+i.qty || 0) * (+i.unit_price || 0),
      })),
      subtotal:    +order?.subtotal     || 0,
      discount:    +order?.discount     || 0,
      freight:     +order?.freight      || 0,
      taxes:       +order?.taxes        || 0,
      totalAmount: +order?.total_amount || 0,
      notes:       order?.notes,
    };

    return this.pdfGen.generateHTML(poData);
  }
}
