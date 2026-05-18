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

describeAuthenticatedFlow('Logistics Auth Flow (e2e)', () => {
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
        'Nenhum tenant disponível para execução do fluxo e2e de logistics',
      );
    }

    tenantId = resolvedTenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get logistics stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
  });

  it('should list carriers, drivers and vehicles for the tenant', async () => {
    const carriersResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/carriers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(carriersResponse.status).toBe(200);
    expect(Array.isArray(carriersResponse.body)).toBe(true);

    const driversResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/drivers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(driversResponse.status).toBe(200);
    expect(Array.isArray(driversResponse.body)).toBe(true);

    const vehiclesResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/vehicles`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(vehiclesResponse.status).toBe(200);
    expect(Array.isArray(vehiclesResponse.body)).toBe(true);
  });

  it('should list freight orders, manifests and contract costs', async () => {
    const freightResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/freight`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(freightResponse.status).toBe(200);
    expect(
      Array.isArray(freightResponse.body) || Array.isArray(freightResponse.body?.data),
    ).toBe(true);

    const manifestsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/manifests`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(manifestsResponse.status).toBe(200);
    expect(Array.isArray(manifestsResponse.body)).toBe(true);

    const costResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/logistics/cost`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(costResponse.status).toBe(200);
  });
});
