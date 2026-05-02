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

describeAuthenticatedFlow('Field Notes Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let noteId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de field-notes',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Field Notes E2E Farm ${uniqueSuffix}`,
        state: 'GO',
        city: 'Rio Verde',
        totalAreaHa: 150,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  it('should create a field note and list notes with filters', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/field-notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        title: `E2E Note ${uniqueSuffix}`,
        type: 'observation',
        description: 'Observação criada via e2e',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    noteId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/field-notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toBeDefined();
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();
    expect(listResponse.body.meta.total).toBeDefined();
  });

  it('should get field note details and update it', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/field-notes/${noteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(noteId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/field-notes/${noteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        title: `E2E Note Updated ${uniqueSuffix}`,
        description: 'Atualizado via e2e',
        severity: 'low',
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(noteId);
  });

  it('should filter notes by type and severity', async () => {
    const pestNoteResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/field-notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        title: `E2E Pest Note ${uniqueSuffix}`,
        type: 'pest',
        severity: 'medium',
        organismName: 'Spodoptera frugiperda',
        infestationPct: 15,
      });

    expectSuccessStatus(pestNoteResponse.status);

    const filteredResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/field-notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId, type: 'pest', severity: 'medium' });

    expect(filteredResponse.status).toBe(200);
    expect(Array.isArray(filteredResponse.body.data)).toBe(true);
  });

  it('should resolve a field note', async () => {
    const resolveResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/field-notes/${noteId}/resolve`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(resolveResponse.status);
    expect(resolveResponse.body.resolved).toBe(true);
  });

  it('should return field notes stats', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/field-notes/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ farmId, tenantId });

    expect(statsResponse.status).toBe(200);
  });

  it('should delete a field note', async () => {
    const deleteResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/farm/field-notes/${noteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(deleteResponse.status);

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/field-notes/${noteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(404);
  });

  it('should reject requests without authentication', async () => {
    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/field-notes`)
      .query({ tenantId });

    expect(listResponse.status).toBe(401);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/field-notes`)
      .send({ tenantId, farmId, title: 'Unauthorized' });

    expect(createResponse.status).toBe(401);
  });
});
