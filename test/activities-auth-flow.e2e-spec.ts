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

describeAuthenticatedFlow('Activities Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let activityId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de activities',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Activities E2E Farm ${uniqueSuffix}`,
        state: 'MT',
        city: 'Sorriso',
        totalAreaHa: 200,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  it('should create activity and list activities with filters', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        type: 'planting',
        startedAt: '2025-01-15T08:00:00.000Z',
        name: `Plantio E2E ${uniqueSuffix}`,
        areaHa: 50,
        status: 'done',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    activityId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toBeDefined();
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();
    expect(listResponse.body.meta.total).toBeDefined();
  });

  it('should get activity details and update it', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/activities/${activityId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(activityId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/activities/${activityId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        notes: 'Atualizado via e2e',
        areaHa: 60,
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(activityId);
  });

  it('should return farm activity stats', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/activities/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ farmId, tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total).toBeDefined();
    expect(statsResponse.body.total_area_ha).toBeDefined();
    expect(statsResponse.body.total_cost).toBeDefined();
    expect(statsResponse.body.total_hours).toBeDefined();
  });

  afterAll(async () => {
    if (activityId) {
      await request(app.getHttpServer())
        .delete(`${baseUrl}/farm/activities/${activityId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ tenantId });
    }

    if (farmId) {
      await request(app.getHttpServer())
        .delete(`${baseUrl}/farm/farms/${farmId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ tenantId });
    }

    await app.close();
  });
});
