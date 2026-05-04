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

describeAuthenticatedFlow('User-Tenants Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let userId: string;

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

  const resolveUserId = async (authToken: string) => {
    const profileResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/auth/me`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(profileResponse.status).toBe(200);
    return profileResponse.body.id as string;
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
        'Nenhum tenant disponível para execução do fluxo e2e de user-tenants',
      );
    }

    tenantId = resolvedTenantId;
    userId = await resolveUserId(accessToken);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list users by tenant', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/user-tenants/by-tenant/${tenantId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should list tenants by user', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/user-tenants/by-user/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should list available users for the tenant', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/user-tenants/available-users/${tenantId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
