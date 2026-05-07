import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';

const e2eUserEmail = process.env.E2E_USER_EMAIL;
const e2eUserPassword = process.env.E2E_USER_PASSWORD;

const runAuthenticatedFlow = Boolean(e2eUserEmail) && Boolean(e2eUserPassword);

const describeAuthenticatedFlow = runAuthenticatedFlow
  ? describe
  : describe.skip;

function expectSuccessStatus(status: number) {
  expect([200, 201]).toContain(status);
}

describeAuthenticatedFlow('Purchases Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let requestId: string;
  let quoteId: string;
  let orderId: string;
  let contractId: string;
  let deliveryId: string;

  const baseUrl = '/api/v1';
  const uniqueSuffix = Date.now().toString();

  const signIn = async (email: string, password: string) => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/sign-in`)
      .send({ email, password });

    expectSuccessStatus(response.status);
    expect(response.body.accessToken).toBeDefined();

    return response.body as {
      accessToken: string;
      tenantId?: string | null;
    };
  };

  const resolveTenantId = async (
    authToken: string,
    fallbackTenantId?: string | null,
  ) => {
    if (fallbackTenantId) return fallbackTenantId;

    const tenantsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/tenants`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(tenantsResponse.status).toBe(200);
    expect(Array.isArray(tenantsResponse.body)).toBe(true);

    const firstTenant = (
      tenantsResponse.body as Array<{ tenant_id?: string }>
    )[0];
    return firstTenant?.tenant_id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();

    const signInResponse = await signIn(e2eUserEmail!, e2eUserPassword!);
    accessToken = signInResponse.accessToken;

    const resolvedTenantId = await resolveTenantId(
      accessToken,
      signInResponse.tenantId,
    );

    if (!resolvedTenantId) {
      throw new Error(
        'Nenhum tenant disponível para execução do fluxo e2e de purchases',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Purchases E2E Farm ${uniqueSuffix}`,
        state: 'MS',
        city: 'Dourados',
        totalAreaHa: 400,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get purchases stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
  });

  it('should create and list purchase requests', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/purchases/requests`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        title: `Requisição E2E ${uniqueSuffix}`,
        description: 'Requisição criada via e2e',
        urgency: 'normal',
        neededBy: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        items: [
          {
            product: 'Herbicida E2E',
            qty: 10,
            unit: 'L',
            estimated_unit_price: 50,
          },
        ],
        tags: ['e2e'],
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    requestId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/requests`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (r) => r.id === requestId,
      ),
    ).toBe(true);
  });

  it('should update a purchase request', async () => {
    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/purchases/requests/${requestId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: `Requisição E2E Atualizada ${uniqueSuffix}`,
        urgency: 'high',
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(requestId);
  });

  it('should create and list purchase quotes', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/purchases/quotes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        requestId,
        title: `Cotação E2E ${uniqueSuffix}`,
        deadline: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
        items: [
          {
            product: 'Herbicida E2E',
            qty: 10,
            unit: 'L',
          },
        ],
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    quoteId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/quotes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (q) => q.id === quoteId,
      ),
    ).toBe(true);
  });

  it('should add a quote response and get comparison', async () => {
    const responseBody = await request(app.getHttpServer())
      .post(`${baseUrl}/purchases/quotes/response`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        quoteId,
        tenantId,
        partnerName: `Fornecedor E2E ${uniqueSuffix}`,
        totalAmount: 500,
        deliveryDays: 5,
        paymentTerms: '30 dias',
        items: [
          {
            product: 'Herbicida E2E',
            qty: 10,
            unit: 'L',
            unit_price: 50,
            total: 500,
          },
        ],
      });

    expectSuccessStatus(responseBody.status);

    const comparisonResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/quotes/${quoteId}/comparison`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(comparisonResponse.status).toBe(200);
  });

  it('should create, list and update purchase orders', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/purchases/orders`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        title: `Pedido E2E ${uniqueSuffix}`,
        supplierName: `Fornecedor E2E ${uniqueSuffix}`,
        items: [
          {
            product: 'Herbicida E2E',
            qty: 10,
            unit: 'L',
            unit_price: 50,
            total: 500,
          },
        ],
        totalAmount: 500,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    orderId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/orders`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data ?? listResponse.body).toBeDefined();

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/purchases/orders/${orderId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: `Pedido E2E Atualizado ${uniqueSuffix}`,
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(orderId);
  });

  it('should submit an order for approval and get pending approvals', async () => {
    const submitResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/purchases/orders/${orderId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(submitResponse.status);

    const pendingResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/approvals/pending`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(pendingResponse.status).toBe(200);
    expect(Array.isArray(pendingResponse.body)).toBe(true);
  });

  it('should create, list and update contracts', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/purchases/contracts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        title: `Contrato E2E ${uniqueSuffix}`,
        supplierName: `Fornecedor E2E ${uniqueSuffix}`,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
        totalAmount: 5000,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    contractId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/contracts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (c) => c.id === contractId,
      ),
    ).toBe(true);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/purchases/contracts/${contractId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: `Contrato E2E Atualizado ${uniqueSuffix}`,
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(contractId);
  });

  it('should create, list and receive deliveries', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/purchases/deliveries`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        orderId,
        supplierName: `Fornecedor E2E ${uniqueSuffix}`,
        scheduledDate: new Date().toISOString().split('T')[0],
        items: [
          {
            product: 'Herbicida E2E',
            qty: 10,
            unit: 'L',
          },
        ],
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    deliveryId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/purchases/deliveries`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (d) => d.id === deliveryId,
      ),
    ).toBe(true);

    const receiveResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/purchases/deliveries/${deliveryId}/receive`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        receivedAt: new Date().toISOString(),
        notes: 'Entrega recebida via e2e',
      });

    expectSuccessStatus(receiveResponse.status);
  });
});
