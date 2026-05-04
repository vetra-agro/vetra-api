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

describeAuthenticatedFlow('Team Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let workerId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de team',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Team E2E Farm ${uniqueSuffix}`,
        state: 'BA',
        city: 'Luis Eduardo Magalhães',
        totalAreaHa: 200,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should add a worker and list team for the farm', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/team/${farmId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `José E2E ${uniqueSuffix}`,
        role: 'operator',
        monthly_wage: 2500,
        phone: '11999990000',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    workerId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/team`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (w) => w.id === workerId,
      ),
    ).toBe(true);
  });

  it('should delete the worker', async () => {
    const deleteResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/team/${workerId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(deleteResponse.status);
  });
});
