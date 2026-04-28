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

describeAuthenticatedFlow('Farms Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de farms',
      );
    }

    tenantId = resolvedTenantId;
  });

  it('should create farm and list farms with filters', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `E2E Farm ${uniqueSuffix}`,
        state: 'SP',
        city: 'Ribeirao Preto',
        totalAreaHa: 180,
        usefulAreaHa: 120,
        biome: 'cerrado',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    farmId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, search: uniqueSuffix });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (farm) => farm.id === farmId,
      ),
    ).toBe(true);
  });

  it('should get farm details, update, change status and return stats', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/farms/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(farmId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/farms/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        city: 'Sertaozinho',
        notes: 'Atualizado via e2e',
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(farmId);
    expect(updateResponse.body.city).toBe('Sertaozinho');

    const statusResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/farms/${farmId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ status: 'inactive' });

    expectSuccessStatus(statusResponse.status);
    expect(statusResponse.body.status).toBe('inactive');

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/farms/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total).toBeDefined();
    expect(statsResponse.body.active).toBeDefined();
    expect(statsResponse.body.inactive).toBeDefined();
  });

  it('should accept tenantId in update payload without changing farm tenant', async () => {
    // First, reactivate the farm for this test
    await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/farms/${farmId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ status: 'active' });

    // Update with tenantId in payload (matching curl case from bug report)
    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/farms/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        tenantId,
        name: 'Farm with tenantId in payload',
        notes: 'Test payload includes tenantId',
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(farmId);
    expect(updateResponse.body.name).toBe('Farm with tenantId in payload');
    expect(updateResponse.body.tenant_id).toBe(tenantId);

    // Verify the tenant_id wasn't changed
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/farms/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.body.tenant_id).toBe(tenantId);
  });

  afterAll(async () => {
    if (farmId) {
      await request(app.getHttpServer())
        .delete(`${baseUrl}/farm/farms/${farmId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ tenantId });
    }

    await app.close();
  });
});
