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

describeAuthenticatedFlow('Maintenance Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;

  const baseUrl = '/api/v1';

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
        'Nenhum tenant disponível para execução do fluxo e2e de maintenance',
      );
    }

    tenantId = resolvedTenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get maintenance KPIs and machinery list', async () => {
    const kpisResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/kpis`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(kpisResponse.status).toBe(200);
    expect(kpisResponse.body).toBeDefined();

    const machineryResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/machinery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(machineryResponse.status).toBe(200);
    expect(Array.isArray(machineryResponse.body)).toBe(true);
  });

  it('should list plans, schedules, work orders, checklists and history', async () => {
    const plansResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/plans`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(plansResponse.status).toBe(200);
    expect(Array.isArray(plansResponse.body)).toBe(true);

    const schedulesResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/schedules`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(schedulesResponse.status).toBe(200);
    expect(Array.isArray(schedulesResponse.body)).toBe(true);

    const workOrdersResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/os`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(workOrdersResponse.status).toBe(200);
    expect(Array.isArray(workOrdersResponse.body?.data)).toBe(true);

    const checklistsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/checklists`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(checklistsResponse.status).toBe(200);
    expect(Array.isArray(checklistsResponse.body)).toBe(true);

    const historyResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/maintenance/history`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(historyResponse.status).toBe(200);
    expect(Array.isArray(historyResponse.body)).toBe(true);
  });
});
