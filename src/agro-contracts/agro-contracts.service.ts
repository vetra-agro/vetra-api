// ── agro-contracts.service.ts ──────────────────────────────────
import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { SupabaseProvider } from "../database/supabase.provider";

@Injectable()
export class AgroContractsService {
  constructor(private supabase: SupabaseProvider) {}
  private get db() { return this.supabase.getAdminClient(); }

  async findAll(tenantId: string, filters: {
    status?: string; seasonId?: string; partnerId?: string; farmId?: string;
  }) {
    let q = this.db.from("agro_input_contracts_summary")
      .select("*").eq("tenant_id", tenantId)
      .order("valid_until");
    if (filters.status)    q = q.eq("status",     filters.status);
    if (filters.seasonId)  q = q.eq("season_id",  filters.seasonId);
    if (filters.partnerId) q = q.eq("partner_id", filters.partnerId);
    if (filters.farmId)    q = q.eq("farm_id",    filters.farmId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async findOne(id: string, tenantId?: string) {
    let q = this.db.from("agro_input_contracts_summary").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) throw new NotFoundException("Contrato não encontrado");

    const { data: items } = await this.db
      .from("agro_input_contract_items").select("*")
      .eq("contract_id", id).order("input_category");

    const { data: deliveries } = await this.db
      .from("agro_input_deliveries").select("*")
      .eq("contract_id", id).order("delivery_date", { ascending: false });

    return { ...data, items: items ?? [], deliveries: deliveries ?? [] };
  }

  async create(dto: any, userId?: string) {
    const { data, error } = await this.db.from("agro_input_contracts").insert({
      tenant_id:       dto.tenantId,
      farm_id:         dto.farmId,
      season_id:       dto.seasonId,
      partner_id:      dto.partnerId,
      contract_number: dto.contractNumber,
      title:           dto.title,
      description:     dto.description,
      status:          "draft",
      currency:        dto.currency        ?? "BRL",
      price_indexer:   dto.priceIndexer,
      reference_rate:  dto.referenceRate,
      payment_terms:   dto.paymentTerms,
      payment_type:    dto.paymentType     ?? "term",
      barter_crop:     dto.barterCrop,
      barter_qty_sc:   dto.barterQtySc,
      barter_price_sc: dto.barterPriceSc,
      signed_at:       dto.signedAt,
      valid_from:      dto.validFrom,
      valid_until:     dto.validUntil,
      delivery_start:  dto.deliveryStart,
      delivery_end:    dto.deliveryEnd,
      delivery_address:dto.deliveryAddress,
      delivery_parcels:dto.deliveryParcels ?? 1,
      freight_type:    dto.freightType     ?? "cif",
      includes_taxes:  dto.includesTaxes   ?? true,
      penalty_clause:  dto.penaltyClause,
      warranty_months: dto.warrantyMonths,
      notes:           dto.notes,
      tags:            dto.tags            ?? [],
      created_by:      userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Insere itens se fornecidos
    if (dto.items?.length > 0) {
      const items = dto.items.map((i: any) => ({
        contract_id:      data.id,
        tenant_id:        dto.tenantId,
        input_category:   i.inputCategory  ?? "other",
        product_name:     i.productName,
        active_ingredient:i.activeIngredient,
        brand:            i.brand,
        sku:              i.sku,
        registration_nr:  i.registrationNr,
        unit:             i.unit           ?? "L",
        quantity:         i.quantity,
        unit_price:       i.unitPrice,
        area_ha:          i.areaHa,
        dose_per_ha:      i.dosePerHa,
        application_date: i.applicationDate,
        notes:            i.notes,
      }));
      await this.db.from("agro_input_contract_items").insert(items);
    }

    return this.findOne(data.id, dto.tenantId);
  }

  async update(id: string, dto: any, tenantId?: string) {
    await this.findOne(id, tenantId);
    const updates: Record<string, any> = {};
    const map: Record<string, string> = {
      title:"title", description:"description", status:"status",
      validFrom:"valid_from", validUntil:"valid_until",
      paymentTerms:"payment_terms", paymentType:"payment_type",
      deliveryStart:"delivery_start", deliveryEnd:"delivery_end",
      freightType:"freight_type", penaltyClause:"penalty_clause",
      warrantyMonths:"warranty_months", notes:"notes", tags:"tags",
      barterCrop:"barter_crop", barterQtySc:"barter_qty_sc",
      barterPriceSc:"barter_price_sc", priceIndexer:"price_indexer",
    };
    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) updates[col] = dto[k];
    }
    const { data, error } = await this.db.from("agro_input_contracts")
      .update(updates).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async addItem(contractId: string, dto: any, tenantId: string) {
    const { data, error } = await this.db.from("agro_input_contract_items").insert({
      contract_id:      contractId,
      tenant_id:        tenantId,
      input_category:   dto.inputCategory  ?? "other",
      product_name:     dto.productName,
      active_ingredient:dto.activeIngredient,
      brand:            dto.brand,
      sku:              dto.sku,
      registration_nr:  dto.registrationNr,
      unit:             dto.unit           ?? "L",
      quantity:         dto.quantity,
      unit_price:       dto.unitPrice,
      area_ha:          dto.areaHa,
      dose_per_ha:      dto.dosePerHa,
      application_date: dto.applicationDate,
      notes:            dto.notes,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async removeItem(itemId: string) {
    const { error } = await this.db.from("agro_input_contract_items").delete().eq("id", itemId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async registerDelivery(dto: {
    contractId: string; contractItemId?: string; tenantId: string;
    deliveryDate: string; qtyDelivered: number; unit?: string;
    nfNumber?: string; nfValue?: number; receivedBy?: string; notes?: string;
  }) {
    const { data, error } = await this.db.from("agro_input_deliveries").insert({
      contract_id:      dto.contractId,
      contract_item_id: dto.contractItemId,
      tenant_id:        dto.tenantId,
      delivery_date:    dto.deliveryDate,
      qty_delivered:    dto.qtyDelivered,
      unit:             dto.unit,
      nf_number:        dto.nfNumber,
      nf_value:         dto.nfValue,
      received_by:      dto.receivedBy,
      notes:            dto.notes,
    }).select().single();
    if (error) throw new BadRequestException(error.message);

    // Verifica se contrato está totalmente entregue
    const contract = await this.findOne(dto.contractId, dto.tenantId);
    const allDelivered = (contract.items ?? []).every(
      (i: any) => +i.qty_pending <= 0.001
    );
    if (allDelivered) {
      await this.db.from("agro_input_contracts")
        .update({ status: "complete" }).eq("id", dto.contractId);
    } else if ((contract.total_delivered ?? 0) > 0) {
      await this.db.from("agro_input_contracts")
        .update({ status: "partial" }).eq("id", dto.contractId);
    }

    return data;
  }

  async activate(id: string) {
    const { data, error } = await this.db.from("agro_input_contracts")
      .update({ status: "active" }).eq("id", id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getStats(tenantId: string) {
    const { data } = await this.db.from("agro_input_contracts")
      .select("status, total_amount, total_delivered, valid_until, payment_type")
      .eq("tenant_id", tenantId);
    const all     = data ?? [];
    const active  = all.filter((c: any) => ["active","partial"].includes(c.status));
    const today   = new Date().toISOString().split("T")[0];
    const in30    = new Date(Date.now() + 30*86400000).toISOString().split("T")[0];
    return {
      total:            all.length,
      active:           active.length,
      total_value:      active.reduce((s: number, c: any) => s + (+c.total_amount || 0), 0),
      total_delivered:  active.reduce((s: number, c: any) => s + (+c.total_delivered || 0), 0),
      barter_count:     all.filter((c: any) => c.payment_type === "barter").length,
      expiring_soon:    all.filter((c: any) =>
        c.status === "active" && c.valid_until >= today && c.valid_until <= in30).length,
    };
  }
}

// ── agro-contracts.controller.ts ───────────────────────────────
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

// Controller inline para manter arquivo único
export function createAgroContractsController(service: AgroContractsService) {
  // ver arquivo separado abaixo
}
