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

describeAuthenticatedFlow('Agro Sales Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let partnerId: string;
  let contractId: string;
  let pricingId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de agro-sales',
      );
    }

    tenantId = resolvedTenantId;

    const createPartnerResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/partners`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Agro Sales E2E Partner ${uniqueSuffix}`,
        document: `00000000000${Math.floor(Math.random() * 100)}`,
        email: `agro-sales-partner-${uniqueSuffix}@test.com`,
        phone: '6733333333',
        type: 'buyer',
      });

    expectSuccessStatus(createPartnerResponse.status);
    partnerId = createPartnerResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get agro sales stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/agro/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
  });

  it('should list contracts, pricings and volume summaries', async () => {
    const [contractsResponse, pricingsResponse, volumesResponse, timelineResponse] =
      await Promise.all([
        request(app.getHttpServer())
          .get(`${baseUrl}/sales/agro/contracts`)
          .set('Authorization', `Bearer ${accessToken}`)
          .query({ tenantId }),
        request(app.getHttpServer())
          .get(`${baseUrl}/sales/agro/pricings`)
          .set('Authorization', `Bearer ${accessToken}`)
          .query({ tenantId }),
        request(app.getHttpServer())
          .get(`${baseUrl}/sales/agro/volumes`)
          .set('Authorization', `Bearer ${accessToken}`)
          .query({ tenantId }),
        request(app.getHttpServer())
          .get(`${baseUrl}/sales/agro/volumes/timeline`)
          .set('Authorization', `Bearer ${accessToken}`)
          .query({ tenantId }),
      ]);

    expect(contractsResponse.status).toBe(200);
    expect(Array.isArray(contractsResponse.body)).toBe(true);

    expect(pricingsResponse.status).toBe(200);
    expect(Array.isArray(pricingsResponse.body)).toBe(true);

    expect(volumesResponse.status).toBe(200);
    expect(Array.isArray(volumesResponse.body)).toBe(true);

    expect(timelineResponse.status).toBe(200);
    expect(Array.isArray(timelineResponse.body)).toBe(true);
  });

  it('should create contract and register a delivery', async () => {
    const createContractResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/agro/contracts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        partnerId,
        contractNumber: `ASC-${uniqueSuffix}`,
        contractType: 'forward',
        crop: 'Soja',
        unit: 'sc',
        qtyContracted: 300,
        priceType: 'fixed',
        unitPrice: 135.75,
        currency: 'BRL',
        deliveryStart: new Date().toISOString().split('T')[0],
        deliveryEnd: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .split('T')[0],
        notes: 'Contrato criado via e2e',
      });

    expectSuccessStatus(createContractResponse.status);
    expect(createContractResponse.body.id).toBeDefined();
    contractId = createContractResponse.body.id as string;

    const deliveryResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/agro/contracts/${contractId}/deliveries`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        deliveryDate: new Date().toISOString().split('T')[0],
        qtyDelivered: 100,
        unitPrice: 136.1,
        nfNumber: `NF-${uniqueSuffix}`,
      });

    expectSuccessStatus(deliveryResponse.status);
    expect(deliveryResponse.body.id).toBeDefined();
  });

  it('should update contract status', async () => {
    const response = await request(app.getHttpServer())
      .put(`${baseUrl}/sales/agro/contracts/${contractId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        status: 'active',
      });

    expectSuccessStatus(response.status);
    expect(response.body.id).toBe(contractId);
  });

  it('should create pricing and add pricing order', async () => {
    const createPricingResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/agro/pricings`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        contractId,
        crop: 'Soja',
        totalQty: 200,
        unit: 'sc',
        indexBase: 'CBOT',
        basis: 2.1,
        basisUnit: 'R$/sc',
        currency: 'USD',
        fixDeadline: new Date(Date.now() + 15 * 86400000)
          .toISOString()
          .split('T')[0],
        seasonRef: 'NOV26',
      });

    expectSuccessStatus(createPricingResponse.status);
    expect(createPricingResponse.body.id).toBeDefined();
    pricingId = createPricingResponse.body.id as string;

    const orderResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/agro/pricings/${pricingId}/orders`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        fixedAt: new Date().toISOString().split('T')[0],
        qty: 120,
        price: 11.25,
        priceBrl: 132.5,
        exchangeRate: 5.2,
        broker: 'Broker E2E',
      });

    expectSuccessStatus(orderResponse.status);
    expect(orderResponse.body.id).toBeDefined();
  });
});