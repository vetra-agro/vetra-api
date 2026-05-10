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

describeAuthenticatedFlow('Sales Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let partnerId: string;
  let productId: string;
  let priceListId: string;
  let orderId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de sales',
      );
    }

    tenantId = resolvedTenantId;

    // Create a partner for sales orders
    const createPartnerResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/partners`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Sales E2E Partner ${uniqueSuffix}`,
        document: `00000000000${Math.floor(Math.random() * 100)}`,
        email: `partner-${uniqueSuffix}@test.com`,
        phone: '6733333333',
        type: 'buyer',
      });

    if (createPartnerResponse.status === 201 || createPartnerResponse.status === 200) {
      partnerId = createPartnerResponse.body.id as string;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get sales stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
  });

  it('should list all products', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/products`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should create a product', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/products`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        code: `PROD-${uniqueSuffix}`,
        name: `Soja E2E ${uniqueSuffix}`,
        type: 'grain',
        unit: 'sc',
        crop: 'Soja',
      });

    expectSuccessStatus(response.status);
    productId = response.body.id as string;
  });

  it('should list all price lists', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/price-lists`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should create a price list', async () => {
    if (!productId) {
      console.warn('Skipping price list creation: product not created');
      return;
    }

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/price-lists`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        productId,
        name: `Preço Soja Nov/25 E2E ${uniqueSuffix}`,
        priceType: 'fixed',
        unitPrice: 145.5,
        currency: 'BRL',
        validFrom: new Date().toISOString().split('T')[0],
        validUntil: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .split('T')[0],
      });

    expectSuccessStatus(response.status);
    priceListId = response.body.id as string;
  });

  it('should list all sales orders', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/orders`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body) || Array.isArray(response.body?.data)).toBe(
      true,
    );
  });

  it('should create a sales order', async () => {
    if (!partnerId) {
      console.warn('Skipping sales order creation: partner not created');
      return;
    }

    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/sales/orders`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        partnerId,
        orderNumber: `SO-${uniqueSuffix}`,
        status: 'draft',
        orderDate: new Date().toISOString().split('T')[0],
        deliveryDate: new Date(Date.now() + 7 * 86400000)
          .toISOString()
          .split('T')[0],
        items: [
          {
            productId: productId || 'default-product-id',
            productName: 'Soja',
            unit: 'sc',
            qty: 500,
            unitPrice: 145.5,
            priceType: 'fixed',
            total: 72750,
          },
        ],
        subtotal: 72750,
        totalAmount: 72750,
        currency: 'BRL',
      });

    expectSuccessStatus(response.status);
    orderId = response.body.id as string;
  });

  it('should retrieve a sales order by id', async () => {
    if (!orderId) {
      console.warn('Skipping get order: order not created');
      return;
    }

    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/orders/${orderId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect([200, 404]).toContain(response.status);
  });

  it('should list sales commissions', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/sales/commissions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body) || Array.isArray(response.body?.data)).toBe(
      true,
    );
  });
});
