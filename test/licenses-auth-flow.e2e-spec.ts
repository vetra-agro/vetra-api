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

describeAuthenticatedFlow('Licenses Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let createdTenantId: string;

  const baseUrl = '/api/v1';
  const uniqueSuffix = Date.now().toString();

  const signIn = async (email: string, password: string) => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/sign-in`)
      .send({ email, password });

    expectSuccessStatus(response.status);
    expect(response.body.accessToken).toBeDefined();

    return response.body as { accessToken: string };
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list available plans', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/licenses/plans`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should get license stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/licenses/stats`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('should list tenants', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/licenses/tenants`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ search: uniqueSuffix });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should list expiring-soon licenses', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/licenses/expiring-soon`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should create a tenant with trial license', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/licenses/tenants`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `E2E Tenant ${uniqueSuffix}`,
        plan: 'start',
        email: `tenant.${uniqueSuffix}@example.com`,
        city: 'São Paulo',
        state: 'SP',
        trialDays: 14,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    createdTenantId = createResponse.body.id as string;
  });

  it('should get tenant detail and history', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/licenses/tenants/${createdTenantId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(createdTenantId);

    const historyResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/licenses/tenants/${createdTenantId}/history`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(historyResponse.status).toBe(200);
    expect(Array.isArray(historyResponse.body)).toBe(true);
  });

  it('should suspend and reactivate a tenant license', async () => {
    const suspendResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/admin/licenses/tenants/${createdTenantId}/suspend`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(suspendResponse.status);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/admin/licenses/tenants/${createdTenantId}/reactivate`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(reactivateResponse.status);
  });
});
