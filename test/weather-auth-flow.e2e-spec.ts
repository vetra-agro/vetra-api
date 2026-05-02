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

describeAuthenticatedFlow('Weather Auth Flow (e2e)', () => {
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
        'Nenhum tenant disponível para execução do fluxo e2e de weather',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Weather E2E Farm ${uniqueSuffix}`,
        state: 'MT',
        city: 'Sorriso',
        totalAreaHa: 200,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  it('should return latest weather readings for tenant', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/latest`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should return current weather for farm or error when not configured', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/current/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect([200, 400]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body.temp_c).toBeDefined();
      expect(response.body.humidity_pct).toBeDefined();
      expect(response.body.read_at).toBeDefined();
    }
  });

  it('should return forecast for farm or error when not configured', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/forecast/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect([200, 400]).toContain(response.status);

    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('should return weather history for farm', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/history/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, days: 7 });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should reject requests without authentication', async () => {
    const latestResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/latest`)
      .query({ tenantId });

    expect(latestResponse.status).toBe(401);

    const currentResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/current/${farmId}`)
      .query({ tenantId });

    expect(currentResponse.status).toBe(401);

    const forecastResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/forecast/${farmId}`)
      .query({ tenantId });

    expect(forecastResponse.status).toBe(401);

    const historyResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/weather/history/${farmId}`)
      .query({ tenantId });

    expect(historyResponse.status).toBe(401);
  });
});
