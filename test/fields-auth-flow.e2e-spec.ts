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

describeAuthenticatedFlow('Fields Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let fieldId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de fields',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Fields E2E Farm ${uniqueSuffix}`,
        state: 'MT',
        city: 'Sorriso',
        totalAreaHa: 300,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a field and list fields for the farm', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/fields`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        farmId,
        tenantId,
        name: `Talhão E2E ${uniqueSuffix}`,
        areaHa: 50,
        status: 'active',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    fieldId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fields`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ farmId, tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (f) => f.id === fieldId,
      ),
    ).toBe(true);
  });

  it('should get field details and update it', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fields/${fieldId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(fieldId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/fields/${fieldId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ notes: 'Atualizado via e2e' });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(fieldId);
  });

  it('should get field stats for the farm', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/fields/stats/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(statsResponse.status).toBe(200);
  });

  it('should deactivate and reactivate a field', async () => {
    const deactivateResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/fields/${fieldId}/deactivate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(deactivateResponse.status);

    const activateResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/fields/${fieldId}/activate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(activateResponse.status);
  });

  it('should delete the field', async () => {
    const deleteResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/farm/fields/${fieldId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(deleteResponse.status);
  });
});
