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

describeAuthenticatedFlow('Phytosanitary Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let phytoId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de phytosanitary',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Phyto E2E Farm ${uniqueSuffix}`,
        state: 'PR',
        city: 'Cascavel',
        totalAreaHa: 300,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  it('should create a phytosanitary application and list with filters', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/phytosanitary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        appliedAt: new Date().toISOString(),
        method: 'ground_boom',
        areaHa: 50,
        volumeHaL: 150,
        operatorName: `Operador E2E ${uniqueSuffix}`,
        products: [
          { name: 'Herbicida E2E', dose: 2.5, unit: 'L/ha' },
        ],
        conditionOk: true,
        notes: `Aplicação criada via e2e ${uniqueSuffix}`,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    phytoId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/phytosanitary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toBeDefined();
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();
    expect(
      (listResponse.body.data as Array<{ id?: string }>).some(
        (p) => p.id === phytoId,
      ),
    ).toBe(true);
  });

  it('should get phytosanitary details and update it', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/phytosanitary/${phytoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(phytoId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/phytosanitary/${phytoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        efficacyPct: 92,
        efficacyNotes: 'Boa eficácia observada via e2e',
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(phytoId);
  });

  it('should filter applications by date range', async () => {
    const dateFrom = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const dateTo = new Date().toISOString().split('T')[0];

    const filteredResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/phytosanitary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId, dateFrom, dateTo });

    expect(filteredResponse.status).toBe(200);
    expect(Array.isArray(filteredResponse.body.data)).toBe(true);
  });

  it('should return phytosanitary stats for farm', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/phytosanitary/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ farmId, tenantId });

    expect(statsResponse.status).toBe(200);
  });

  it('should delete a phytosanitary application', async () => {
    const deleteResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/farm/phytosanitary/${phytoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(deleteResponse.status);

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/phytosanitary/${phytoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(404);
  });

  it('should reject requests without authentication', async () => {
    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/phytosanitary`)
      .query({ tenantId });

    expect(listResponse.status).toBe(401);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/phytosanitary`)
      .send({ tenantId, farmId, appliedAt: new Date().toISOString() });

    expect(createResponse.status).toBe(401);
  });
});
