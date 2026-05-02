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

describeAuthenticatedFlow('Fuel Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let supplyId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de fuel',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Fuel E2E Farm ${uniqueSuffix}`,
        state: 'MS',
        city: 'Dourados',
        totalAreaHa: 400,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  it('should create a fuel tank and list tanks for farm', async () => {
    const createTankResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/fuel/tanks`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        name: `Tanque E2E ${uniqueSuffix}`,
        fuelType: 'diesel',
        capacityL: 10000,
        minLevelL: 500,
        locationDesc: 'Galpão principal',
      });

    expectSuccessStatus(createTankResponse.status);
    expect(createTankResponse.body.id).toBeDefined();

    const tanksResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel/tanks/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(tanksResponse.status).toBe(200);
    expect(Array.isArray(tanksResponse.body)).toBe(true);
  });

  it('should create a fuel supply and list with filters', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/fuel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        quantityL: 500,
        fuelType: 'diesel',
        source: 'supplier',
        suppliedAt: new Date().toISOString(),
        pricePerL: 6.5,
        totalCost: 3250,
        supplierName: `Fornecedor E2E ${uniqueSuffix}`,
        notes: `Abastecimento criado via e2e ${uniqueSuffix}`,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    supplyId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toBeDefined();
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();
    expect(
      (listResponse.body.data as Array<{ id?: string }>).some(
        (s) => s.id === supplyId,
      ),
    ).toBe(true);
  });

  it('should get supply details and update it', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel/${supplyId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(supplyId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/fuel/${supplyId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        notes: 'Atualizado via e2e',
        invoiceNumber: `NF-${uniqueSuffix}`,
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(supplyId);
  });

  it('should filter supplies by fuel type and date range', async () => {
    const dateFrom = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const dateTo = new Date().toISOString().split('T')[0];

    const filteredResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId, fuelType: 'diesel', dateFrom, dateTo });

    expect(filteredResponse.status).toBe(200);
    expect(Array.isArray(filteredResponse.body.data)).toBe(true);
  });

  it('should return fuel stats for farm', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ farmId, tenantId });

    expect(statsResponse.status).toBe(200);
  });

  it('should delete a fuel supply', async () => {
    const deleteResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/farm/fuel/${supplyId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(deleteResponse.status);

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel/${supplyId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(404);
  });

  it('should reject requests without authentication', async () => {
    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fuel`)
      .query({ tenantId });

    expect(listResponse.status).toBe(401);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/fuel`)
      .send({ tenantId, farmId, quantityL: 100 });

    expect(createResponse.status).toBe(401);
  });
});
