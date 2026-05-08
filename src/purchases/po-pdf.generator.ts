/**
 * Vetra — Gerador de PDF do Purchase Order
 * Localização: vetra-api/src/purchases/po-pdf.generator.ts
 *
 * Gera o PDF usando HTML + Puppeteer (ou jsPDF como fallback).
 * Em produção no Render free tier use a abordagem HTML string
 * que é uploadada como arquivo e servida via Supabase Storage.
 *
 * Dependência: npm install puppeteer-core @sparticuz/chromium
 * (puppeteer-core é menor que puppeteer completo — importante no Render)
 */

import { Injectable, Logger } from "@nestjs/common";

export interface POData {
  orderNumber:    string;
  orderDate:      string;
  expectedDelivery?: string;
  companyName:    string;
  companyAddress?: string;
  partnerName:    string;
  partnerDocument?: string;
  partnerPhone?:  string;
  partnerEmail?:  string;
  farmName?:      string;
  seasonName?:    string;
  paymentTerms?:  string;
  deliveryAddress?: string;
  items: {
    product:    string;
    unit:       string;
    qty:        number;
    unit_price: number;
    total:      number;
  }[];
  subtotal:    number;
  discount?:   number;
  freight?:    number;
  taxes?:      number;
  totalAmount: number;
  notes?:      string;
}

@Injectable()
export class POPdfGenerator {
  private readonly logger = new Logger(POPdfGenerator.name);

  /**
   * Gera o HTML do PO — pode ser usado para preview no browser
   * ou convertido para PDF via Puppeteer/wkhtmltopdf
   */
  generateHTML(po: POData): string {
    const fmtR$ = (v?: number) =>
      v != null ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";
    const fmtDate = (d?: string) =>
      d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

    const rows = po.items.map(i => `
      <tr>
        <td>${i.product}</td>
        <td class="center">${i.qty}</td>
        <td class="center">${i.unit}</td>
        <td class="right">${fmtR$(i.unit_price)}</td>
        <td class="right">${fmtR$(i.total)}</td>
      </tr>
    `).join("");

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size:12px; color:#1a1a2e; padding:40px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:24px; border-bottom:2px solid #16a34a; }
    .logo { font-size:28px; font-weight:900; color:#16a34a; letter-spacing:-1px; }
    .logo span { color:#1a1a2e; }
    .po-title { text-align:right; }
    .po-title h1 { font-size:20px; font-weight:700; color:#1a1a2e; }
    .po-title .number { font-size:14px; color:#6b7280; margin-top:4px; }
    .po-title .date { font-size:11px; color:#9ca3af; margin-top:2px; }
    .parties { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:24px; }
    .party { background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:16px; }
    .party h3 { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; }
    .party p { font-size:12px; color:#374151; line-height:1.6; }
    .party .name { font-weight:700; font-size:13px; color:#111827; }
    .section { margin-bottom:24px; }
    .section h3 { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#1a1a2e; color:#fff; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; padding:10px 12px; }
    td { padding:10px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; }
    tr:last-child td { border-bottom:none; }
    tr:nth-child(even) td { background:#f9fafb; }
    .center { text-align:center; }
    .right { text-align:right; }
    .totals { margin-top:16px; display:flex; justify-content:flex-end; }
    .totals-box { width:280px; }
    .totals-row { display:flex; justify-content:space-between; padding:6px 0; font-size:12px; color:#6b7280; }
    .totals-row.total { border-top:2px solid #16a34a; margin-top:8px; padding-top:12px; font-size:15px; font-weight:700; color:#111827; }
    .conditions { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
    .condition { }
    .condition label { font-size:10px; font-weight:600; color:#9ca3af; text-transform:uppercase; display:block; margin-bottom:4px; }
    .condition p { font-size:12px; color:#374151; }
    .notes { background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:16px; margin-top:24px; }
    .notes label { font-size:10px; font-weight:600; color:#92400e; text-transform:uppercase; display:block; margin-bottom:6px; }
    .notes p { font-size:12px; color:#78350f; }
    .footer { margin-top:40px; padding-top:20px; border-top:1px solid #e5e7eb; text-align:center; font-size:10px; color:#9ca3af; }
    .status-badge { display:inline-block; background:#dcfce7; color:#16a34a; font-size:10px; font-weight:700; padding:3px 10px; border-radius:20px; text-transform:uppercase; letter-spacing:0.5px; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div class="logo">V<span>etra</span></div>
      <p style="font-size:10px;color:#9ca3af;margin-top:4px;">Sistema de Gestão Agro</p>
      ${po.companyName ? `<p style="font-size:11px;font-weight:600;color:#374151;margin-top:8px;">${po.companyName}</p>` : ""}
      ${po.farmName    ? `<p style="font-size:10px;color:#6b7280;">${po.farmName}</p>` : ""}
    </div>
    <div class="po-title">
      <span class="status-badge">Purchase Order</span>
      <h1 style="margin-top:8px;">${po.orderNumber}</h1>
      <p class="number">${po.seasonName ? `Safra: ${po.seasonName}` : ""}</p>
      <p class="date">Emitido em ${fmtDate(po.orderDate)}</p>
      ${po.expectedDelivery ? `<p class="date">Entrega prevista: ${fmtDate(po.expectedDelivery)}</p>` : ""}
    </div>
  </div>

  <!-- Partes -->
  <div class="parties">
    <div class="party">
      <h3>Comprador</h3>
      <p class="name">${po.companyName}</p>
      ${po.companyAddress ? `<p>${po.companyAddress}</p>` : ""}
    </div>
    <div class="party">
      <h3>Fornecedor</h3>
      <p class="name">${po.partnerName}</p>
      ${po.partnerDocument ? `<p>CNPJ/CPF: ${po.partnerDocument}</p>` : ""}
      ${po.partnerPhone    ? `<p>Tel: ${po.partnerPhone}</p>` : ""}
      ${po.partnerEmail    ? `<p>${po.partnerEmail}</p>` : ""}
    </div>
  </div>

  <!-- Condições -->
  <div class="conditions">
    ${po.paymentTerms ? `
    <div class="condition">
      <label>Condições de pagamento</label>
      <p>${po.paymentTerms}</p>
    </div>` : ""}
    ${po.deliveryAddress ? `
    <div class="condition">
      <label>Endereço de entrega</label>
      <p>${po.deliveryAddress}</p>
    </div>` : ""}
  </div>

  <!-- Itens -->
  <div class="section">
    <h3>Itens do Pedido</h3>
    <table>
      <thead>
        <tr>
          <th style="text-align:left;">Produto / Descrição</th>
          <th class="center">Qtd.</th>
          <th class="center">Un.</th>
          <th class="right">Preço unit.</th>
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <!-- Totais -->
  <div class="totals">
    <div class="totals-box">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${fmtR$(po.subtotal)}</span>
      </div>
      ${(po.discount ?? 0) > 0 ? `<div class="totals-row"><span>(-) Desconto</span><span>${fmtR$(po.discount)}</span></div>` : ""}
      ${(po.freight  ?? 0) > 0 ? `<div class="totals-row"><span>(+) Frete</span><span>${fmtR$(po.freight)}</span></div>` : ""}
      ${(po.taxes    ?? 0) > 0 ? `<div class="totals-row"><span>(+) Impostos</span><span>${fmtR$(po.taxes)}</span></div>` : ""}
      <div class="totals-row total">
        <span>Total do Pedido</span>
        <span>${fmtR$(po.totalAmount)}</span>
      </div>
    </div>
  </div>

  ${po.notes ? `
  <div class="notes">
    <label>Observações</label>
    <p>${po.notes}</p>
  </div>` : ""}

  <div class="footer">
    <p>Documento gerado automaticamente pelo Vetra · ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}</p>
    <p style="margin-top:4px;">Este documento é válido somente com a assinatura digital ou confirmação pelo fornecedor.</p>
  </div>

</body>
</html>`;
  }

  /**
   * Converte o HTML para PDF via Puppeteer.
   *
   * TODO: Em produção no Render, instale:
   *   npm install puppeteer-core @sparticuz/chromium
   * e adicione a variável de ambiente:
   *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
   *
   * Por ora retorna o HTML como Buffer para não bloquear o PoC.
   */
  async generatePDF(po: POData): Promise<Buffer> {
    const html = this.generateHTML(po);

    // ── TODO: Descomentar quando Puppeteer estiver instalado ──────────────
    // const chromium = await import("@sparticuz/chromium");
    // const puppeteer = await import("puppeteer-core");
    // const browser = await puppeteer.launch({
    //   args:           chromium.default.args,
    //   executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    //                   ?? await chromium.default.executablePath(),
    //   headless:       true,
    // });
    // const page = await browser.newPage();
    // await page.setContent(html, { waitUntil: "networkidle0" });
    // const pdf = await page.pdf({ format:"A4", printBackground:true, margin:{top:"10mm",bottom:"10mm",left:"10mm",right:"10mm"} });
    // await browser.close();
    // return Buffer.from(pdf);
    // ─────────────────────────────────────────────────────────────────────

    // Fallback: retorna o HTML como buffer (pode ser baixado como .html)
    this.logger.warn("[TODO] Puppeteer não configurado — retornando HTML como fallback");
    return Buffer.from(html, "utf-8");
  }
}
