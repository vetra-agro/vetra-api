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

describeAuthenticatedFlow('Financial Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let tenantId: string;
  let farmId: string;
  let bankAccountId: string;
  let payableId: string;
  let receivableId: string;
  let costCenterId: string;
  let creditPartnerId: string;
  let creditLimitId: string;
  let collectionCaseId: string;
  let forexOperationId: string;
  let forexContractId: string;

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
        'Nenhum tenant disponível para execução do fluxo e2e de financial',
      );
    }

    tenantId = resolvedTenantId;

    const createFarmResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/farm/farms`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        name: `Financial E2E Farm ${uniqueSuffix}`,
        state: 'GO',
        city: 'Rio Verde',
        totalAreaHa: 250,
      });

    expectSuccessStatus(createFarmResponse.status);
    farmId = createFarmResponse.body.id as string;

    const createPartnerResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/partners`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        types: ['customer'],
        personType: 'legal',
        name: `Credit E2E Partner ${uniqueSuffix}`,
        document: `98.765.432/0001-${uniqueSuffix.slice(-2)}`,
        email: `credit.${uniqueSuffix}@example.com`,
      });

    expectSuccessStatus(createPartnerResponse.status);
    creditPartnerId = createPartnerResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a transaction and list transactions', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/${farmId}/transactions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'income',
        description: `Venda de Soja E2E ${uniqueSuffix}`,
        amount: 20000,
        date: '2025-06-01',
        category: 'Venda',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/${farmId}/transactions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ from: '2025-01-01', to: '2025-12-31' });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
  });

  it('should get financial summary for the farm', async () => {
    const summaryResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/${farmId}/summary`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(summaryResponse.status).toBe(200);
  });

  it('should create, list and update a bank account', async () => {
    const bankListResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/banks/list`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(bankListResponse.status).toBe(200);
    expect(Array.isArray(bankListResponse.body)).toBe(true);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/banks`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        name: `Conta E2E ${uniqueSuffix}`,
        bankName: 'Banco do Brasil',
        bankCode: '001',
        agency: '1234',
        accountNumber: `56789-${uniqueSuffix.slice(-1)}`,
        accountType: 'checking',
        currentBalance: 5000,
        initialBalance: 5000,
        isDefault: true,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    bankAccountId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/banks`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (account) => account.id === bankAccountId,
      ),
    ).toBe(true);

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/banks/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total_accounts).toBeDefined();

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/banks/${bankAccountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ notes: 'Atualizada via e2e' });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(bankAccountId);
  });

  it('should create, list, pay and remove a payable account', async () => {
    const categoriesResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/payable/categories`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(categoriesResponse.status).toBe(200);
    expect(Array.isArray(categoriesResponse.body)).toBe(true);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/payable`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        bankAccountId,
        description: `Conta a pagar E2E ${uniqueSuffix}`,
        amount: 1200,
        dueDate: '2025-07-10',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    payableId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/payable`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/payable/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total).toBeDefined();

    const payResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/financial/payable/${payableId}/pay`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        amountPaid: 1200,
        paymentDate: '2025-07-10',
        paymentMethod: 'pix',
        bankAccountId,
      });

    expectSuccessStatus(payResponse.status);

    const removeResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/financial/payable/${payableId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(removeResponse.status);
  });

  it('should create, list, receive and remove a receivable account', async () => {
    const categoriesResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/receivable/categories`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(categoriesResponse.status).toBe(200);
    expect(Array.isArray(categoriesResponse.body)).toBe(true);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/receivable`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        bankAccountId,
        description: `Conta a receber E2E ${uniqueSuffix}`,
        amount: 3400,
        dueDate: '2025-08-15',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    receivableId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/receivable`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/receivable/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total).toBeDefined();

    const receiveResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/financial/receivable/${receivableId}/receive`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({
        amountReceived: 3400,
        receiptDate: '2025-08-15',
        paymentMethod: 'pix',
        bankAccountId,
      });

    expectSuccessStatus(receiveResponse.status);

    const removeResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/financial/receivable/${receivableId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(removeResponse.status);
  });

  it('should create, list, update and remove a cost center', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/cost-centers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        name: `Centro de Custo E2E ${uniqueSuffix}`,
        type: 'expense',
        description: 'Criado via e2e',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    costCenterId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/cost-centers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      (listResponse.body as Array<{ id?: string }>).some(
        (cc) => cc.id === costCenterId,
      ),
    ).toBe(true);

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/cost-centers/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);

    const breakdownResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/cost-centers/breakdown`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, dateFrom: '2025-01-01', dateTo: '2025-12-31' });

    expect(breakdownResponse.status).toBe(200);

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/cost-centers/${costCenterId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(costCenterId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/cost-centers/${costCenterId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ description: 'Atualizado via e2e' });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(costCenterId);

    const removeResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/financial/cost-centers/${costCenterId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expectSuccessStatus(removeResponse.status);
  });

  it('should create and manage credit limits', async () => {
    const upsertResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/credit/limits`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        partnerId: creditPartnerId,
        creditLimit: 50000,
        paymentTermDays: 30,
        interestRateMo: 1.5,
        fineRate: 2,
        status: 'active',
      });

    expectSuccessStatus(upsertResponse.status);
    expect(upsertResponse.body.id).toBeDefined();
    creditLimitId = upsertResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/credit/limits`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/credit/limits/${creditLimitId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/credit/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total_partners_with_limit).toBeDefined();

    const agingResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/credit/aging`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(agingResponse.status).toBe(200);

    const statusResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/financial/credit/limits/${creditLimitId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ status: 'suspended' });

    expectSuccessStatus(statusResponse.status);
  });

  it('should create, list, update and add contact to a collection case', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/credit/cases`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        partnerId: creditPartnerId,
        creditLimitId,
        totalDebt: 5000,
        totalInterest: 150,
        totalFine: 100,
        dueSince: '2025-03-01',
        notes: 'Caso criado via e2e',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    collectionCaseId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/credit/cases`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/credit/cases/${collectionCaseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(collectionCaseId);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/credit/cases/${collectionCaseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId })
      .send({ notes: 'Atualizado via e2e', nextContactAt: '2025-08-01' });

    expectSuccessStatus(updateResponse.status);

    const contactResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/credit/contacts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        caseId: collectionCaseId,
        tenantId,
        contactType: 'call',
        contactedAt: new Date().toISOString(),
        summary: 'Ligação de cobrança via e2e',
        nextDate: '2025-08-10',
      });

    expectSuccessStatus(contactResponse.status);
    expect(contactResponse.body.id).toBeDefined();
  });

  it('should get forex rate and manage operations', async () => {
    const rateResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/forex/rate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ currency: 'USD' });

    expect(rateResponse.status).toBe(200);

    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/forex/operations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        operationType: 'spot',
        direction: 'sell',
        currency: 'USD',
        foreignAmount: 10000,
        contractedRate: 5.25,
        contractedAt: '2025-05-01',
        dueDate: '2025-09-01',
        bankName: 'Banco do Brasil',
        notes: 'Operação forex criada via e2e',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    forexOperationId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/forex/operations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();

    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/forex/stats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId });

    expect(statsResponse.status).toBe(200);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/forex/operations/${forexOperationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notes: 'Atualizado via e2e' });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(forexOperationId);

    const settleResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/financial/forex/operations/${forexOperationId}/settle`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        settlementRate: 5.30,
        settlementDate: '2025-09-01',
      });

    expectSuccessStatus(settleResponse.status);
    expect(settleResponse.body.status).toBe('settled');

    const removeResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/financial/forex/operations/${forexOperationId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(removeResponse.status);
  });

  it('should create, list and update forex contracts', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/financial/forex/contracts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        farmId,
        currency: 'USD',
        totalForeignAmount: 50000,
        contractedRate: 5.20,
        deliveryStart: '2025-10-01',
        deliveryEnd: '2025-12-31',
        bankName: 'Santander',
        notes: 'Contrato forex criado via e2e',
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    forexContractId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/forex/contracts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ tenantId, farmId });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);

    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/financial/forex/contracts/${forexContractId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notes: 'Atualizado via e2e' });

    expectSuccessStatus(updateResponse.status);
    expect(updateResponse.body.id).toBe(forexContractId);

    const linksResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/financial/forex/contracts/${forexContractId}/links`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(linksResponse.status).toBe(200);
  });
});
