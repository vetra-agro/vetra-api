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

describeAuthenticatedFlow('Seasons Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let seasonId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de seasons',
      );
    }

    tenantId = resolvedTenantId;
  });

  it('should create farm and create/list season', async () => {
    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Season E2E Farm ${uniqueSuffix}`,
        state: 'MT',
        city: 'Sorriso',
        totalAreaHa: 220,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;

    const createSeasonResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/seasons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        name: `Safra Soja ${uniqueSuffix}`,
        crop: 'soja',
        type: 'summer',
        status: 'planning',
        totalAreaHa: 150,
      });

    expectSuccessStatus(createSeasonResponse.status);
    expect(createSeasonResponse.body.id).toBeDefined();
    expect(createSeasonResponse.body.farm_id).toBe(farmId);
    seasonId = createSeasonResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/seasons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (season) => season.id === seasonId,
      ),
    ).toBe(true);
  });

  it('should get details, update, change status and return stats', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/seasons/${seasonId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(seasonId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/seasons/${seasonId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        notes: 'Atualizado via seasons e2e',
        expectedYieldScHa: 67,
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(seasonId);
    expect(updateResponse.body.notes).toBe('Atualizado via seasons e2e');

    const statusResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/seasons/${seasonId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ status: 'planting' });

    expectSuccessStatus(statusResponse.status);
    expect(statusResponse.body.status).toBe('planting');

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/seasons/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total).toBeDefined();
    expect(statsResponse.body.active).toBeDefined();
    expect(statsResponse.body.by_crop).toBeDefined();
  });

  afterAll(async () => {
    if (seasonId) {
      await request(app.getHttpServer())
        .delete(`${baseUrl}/farm/seasons/${seasonId}`)
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
