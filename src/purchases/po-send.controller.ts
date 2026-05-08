import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { POSendService } from "./po-send.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("purchases") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("purchases/orders")
export class POSendController {
  constructor(private readonly poSendService: POSendService) {}

  /**
   * Envia o PO ao fornecedor via WhatsApp.
   * Gera PDF, faz upload no Storage e envia a mensagem.
   */
  @Post(":id/send")
  @ApiOperation({ summary: "Enviar PO ao fornecedor via WhatsApp" })
  async sendPO(
    @Param("id")           orderId:  string,
    @Query("tenantId")     tenantId: string,
    @Body("phoneOverride") phoneOverride?: string,
  ) {
    return this.poSendService.sendPO(orderId, tenantId, { phoneOverride });
  }

  /**
   * Preview do PO em HTML — abre no browser para conferência antes de enviar.
   */
  @Get(":id/preview")
  @ApiOperation({ summary: "Preview HTML do PO (para conferência)" })
  async previewPO(
    @Param("id")       orderId:  string,
    @Query("tenantId") tenantId: string,
    @Res()             res:      Response,
  ) {
    const html = await this.poSendService.previewHTML(orderId, tenantId);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  }
}

@ApiTags("webhooks")
@Controller("purchases/whatsapp")
export class WhatsAppWebhookController {
  constructor(private readonly poSendService: POSendService) {}

  /**
   * Verificação do webhook pela Meta (GET com hub.challenge)
   * Configura nas variáveis de ambiente: WHATSAPP_WEBHOOK_TOKEN
   */
  @Get("webhook")
  verifyWebhook(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = process.env.WHATSAPP_WEBHOOK_TOKEN ?? "vetra-webhook";
    if (mode === "subscribe" && token === expectedToken) {
      res.send(challenge);
    } else {
      res.status(403).send("Forbidden");
    }
  }

  /**
   * Recebe status updates da Meta (sent, delivered, read, failed)
   */
  @Post("webhook")
  @HttpCode(200)
  async receiveWebhook(@Body() payload: any) {
    await this.poSendService.processWebhook(payload);
    return { status: "ok" };
  }
}
