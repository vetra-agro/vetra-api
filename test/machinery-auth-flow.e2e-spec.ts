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

describeAuthenticatedFlow('Machinery Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let machineryId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de machinery',
      );
    }

    tenantId = resolvedTenantId;
  });

  it('should create machinery and list with filters', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/machinery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `E2E Tractor ${uniqueSuffix}`,
        type: 'tractor',
        status: 'active',
        brand: 'John Deere',
        model: '6M',
        fuelType: 'diesel',
        enginePowerHp: 150,
        hourmeterCurrent: 1200,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    machineryId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/machinery`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, search: uniqueSuffix });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (m) => m.id === machineryId,
      ),
    ).toBe(true);
  });

  it('should get machinery details, update, and update meters', async () => {
    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/machinery/${machineryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(machineryId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/farm/machinery/${machineryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        brand: 'Case IH',
        notes: 'Atualizado via e2e',
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(machineryId);

    const metersResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/machinery/${machineryId}/meters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ hourmeterCurrent: 1350 });

    expectSuccessStatus(metersResponse.status);
    expect(metersResponse.body.id).toBe(machineryId);
  });

  it('should update status and return stats', async () => {
    const statusResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/farm/machinery/${machineryId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ status: 'maintenance' });

    expectSuccessStatus(statusResponse.status);
    expect(statusResponse.body.status).toBe('maintenance');

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/farm/machinery/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body).toBeDefined();
  });

  afterAll(async () => {
    if (machineryId) {
      await request(app.getHttpServer())
        .delete(`${baseUrl}/farm/machinery/${machineryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ tenantId });
    }

    await app.close();
  });
});
