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

describeAuthenticatedFlow('Settings Auth Flow (e2e)', () => {
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
        'Nenhum tenant disponível para execução do fluxo e2e de settings',
      );
    }

    tenantId = resolvedTenantId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get all settings grouped by category', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/settings`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(response.status).toBe(200);
  });

  it('should set and get a specific setting', async () => {
    const setResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/admin/settings/company_name`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ value: 'Vetra E2E Ltda' });

    expectSuccessStatus(setResponse.status);

    const getResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/settings/company_name`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(getResponse.status).toBe(200);
  });

  it('should update settings in batch', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/settings/batch`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        entries: [
          { key: 'company_name', value: 'Vetra E2E Ltda' },
          { key: 'timezone', value: 'America/Sao_Paulo' },
        ],
      });

    expectSuccessStatus(response.status);
  });
});
