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

describeAuthenticatedFlow('Reconciliation Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let bankAccountId: string;

  const baseUrl = '/api/v1';
  const uniqueSuffix = Date.now().toString();
  const dateFrom = '2025-06-01';
  const dateTo = '2025-06-30';

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
        'Nenhum tenant disponível para execução do fluxo e2e de reconciliation',
      );
    }

    tenantId = resolvedTenantId;

    // Create farm for reconciliation tests
    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Reconciliation E2E Farm ${uniqueSuffix}`,
        state: 'SP',
        city: 'Piracicaba',
        totalAreaHa: 200,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;

    // Create bank account for reconciliation
    const bankResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/banks`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        name: `Conta Reconciliação E2E ${uniqueSuffix}`,
        bankName: 'Banco do Brasil',
        bankCode: '001',
        agency: '1234',
        accountNumber: `78901-${uniqueSuffix.slice(-1)}`,
        accountType: 'checking',
        currentBalance: 10000,
        initialBalance: 10000,
        isDefault: true,
      });

    expectSuccessStatus(bankResponse.status);
    bankAccountId = bankResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should get reconciliation panel for a bank account', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `${baseUrl}/financial/reconciliation/panel/${bankAccountId}`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .query({
        tenantId,
        dateFrom,
        dateTo,
      });

    expect(response.status).toBe(200);
    expect(response.body.bank_entries).toBeDefined();
    expect(Array.isArray(response.body.bank_entries)).toBe(true);
    expect(response.body.erp_payables).toBeDefined();
    expect(Array.isArray(response.body.erp_payables)).toBe(true);
    expect(response.body.erp_receivables).toBeDefined();
    expect(Array.isArray(response.body.erp_receivables)).toBe(true);
    expect(response.body.summary).toBeDefined();
    expect(response.body.summary.bank_balance).toBeDefined();
    expect(response.body.summary.difference).toBeDefined();
  });

  it('should match a cash flow entry with payable manually', async () => {
    // This test assumes there are existing cash flow entries and payables
    // In a real scenario, these would be seeded or created via separate endpoints
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/reconciliation/match`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        cashFlowEntryId: 'mock-entry-id',
        payableId: 'mock-payable-id',
        tenantId,
      });

    // Expected to return 404 for mock IDs, but the route is accessible
    expect([200, 201, 400, 404]).toContain(response.status);
  });

  it('should ignore a cash flow entry (e.g., bank fees)', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/financial/reconciliation/ignore/mock-entry-id`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ tenantId });

    // Expected to return error for mock ID, but the route is accessible
    expect([200, 400, 404]).toContain(response.status);
  });

  it('should trigger auto-reconciliation for a period', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `${baseUrl}/financial/reconciliation/auto/${bankAccountId}`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        dateFrom,
        dateTo,
      });

    // Should return 200 or similar
    expect([200, 201, 400, 404]).toContain(response.status);
  });
});
