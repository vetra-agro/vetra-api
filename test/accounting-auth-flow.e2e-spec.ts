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

describeAuthenticatedFlow('Accounting Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let accountId: string;
  let entryId: string;
  let assetId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de accounting',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Accounting E2E Farm ${uniqueSuffix}`,
        state: 'GO',
        city: 'Rio Verde',
        totalAreaHa: 100,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return accounting stats', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/accounting/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total_assets).toBeDefined();
    expect(statsResponse.body.posted_entries).toBeDefined();
  });

  it('should list, create and update a chart of accounts entry', async () => {
    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/accounting/accounts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/accounting/accounts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        code: `4.1.${uniqueSuffix.slice(-4)}`,
        name: `Custo de Produção E2E ${uniqueSuffix}`,
        nature: 'debit',
        groupType: 'cogs',
        isAnalytic: true,
        acceptsEntries: true,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    accountId = createResponse.body.id as string;

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/accounting/accounts/${accountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Custo de Produção E2E Atualizado ${uniqueSuffix}`,
        active: true,
      });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(accountId);
  });

  it('should create, list, post and reverse an accounting entry', async () => {
    const debitAccountId = accountId;

    // Busca uma conta de crédito (natureza credit) para balancear o lançamento
    const accountsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/accounting/accounts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(accountsResponse.status).toBe(200);
    const creditAccount = (
      accountsResponse.body as Array<{ id: string; nature: string }>
    ).find((a) => a.nature === 'credit');

    let creditAccountId: string;

    if (!creditAccount) {
      // Cria uma conta de crédito caso não exista
      const createCreditResponse = await request(app.getHttpServer())
        .post(`${baseUrl}/financial/accounting/accounts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          tenantId,
          code: `1.1.${uniqueSuffix.slice(-4)}`,
          name: `Caixa E2E ${uniqueSuffix}`,
          nature: 'credit',
          groupType: 'receita_bruta',
          isAnalytic: true,
          acceptsEntries: true,
        });
      expectSuccessStatus(createCreditResponse.status);
      creditAccountId = createCreditResponse.body.id as string;
    } else {
      creditAccountId = creditAccount.id;
    }

    const createEntryResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/accounting/entries`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        entryDate: '2026-05-01',
        description: `Lançamento E2E ${uniqueSuffix}`,
        items: [
          {
            accountId: debitAccountId,
            debitAmount: 1000,
            creditAmount: 0,
            description: 'Débito E2E',
          },
          {
            accountId: creditAccountId,
            debitAmount: 0,
            creditAmount: 1000,
            description: 'Crédito E2E',
          },
        ],
      });

    expectSuccessStatus(createEntryResponse.status);
    expect(createEntryResponse.body.id).toBeDefined();
    entryId = createEntryResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/accounting/entries`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, dateFrom: '2026-01-01', dateTo: '2026-12-31' });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();

    const postResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/financial/accounting/entries/${entryId}/post`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(postResponse.status);
    expect(postResponse.body.status).toBe('posted');

    const reverseResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/accounting/entries/${entryId}/reverse`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ description: `Estorno E2E ${uniqueSuffix}` });

    expectSuccessStatus(reverseResponse.status);
    expect(reverseResponse.body.id).toBeDefined();
  });

  it('should get DRE for a period', async () => {
    const dreResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/accounting/dre`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({
        tenantId,
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        farmId,
      });

    expect(dreResponse.status).toBe(200);
    expect(dreResponse.body.summary).toBeDefined();
    expect(dreResponse.body.period).toBeDefined();
  });

  it('should create, list and update an asset', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/accounting/assets`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        accountId,
        name: `Trator E2E ${uniqueSuffix}`,
        category: 'machinery',
        acquisitionDate: '2026-01-15',
        acquisitionValue: 180000,
        depreciationMethod: 'straight_line',
        usefulLifeMonths: 120,
        residualValue: 18000,
        notes: 'Criado via e2e',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    assetId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/accounting/assets`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (a) => a.id === assetId,
      ),
    ).toBe(true);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/accounting/assets/${assetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notes: 'Atualizado via e2e' });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(assetId);
  });

  it('should depreciate a single asset and run depreciate-all', async () => {
    const year = 2026;
    const month = 5;

    const depOneResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/accounting/assets/${assetId}/depreciate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ tenantId, year, month });

    expectSuccessStatus(depOneResponse.status);
    expect(depOneResponse.body.depreciation_amt).toBeDefined();

    const depAllResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/accounting/assets/depreciate-all`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ tenantId, year, month: month + 1 });

    expectSuccessStatus(depAllResponse.status);
    expect(Array.isArray(depAllResponse.body)).toBe(true);
  });
});
