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

describeAuthenticatedFlow('Partners Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let partnerId: string;
  let contactId: string;

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

  it('should create partner and list partners', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/partners`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        types: ['supplier'],
        personType: 'legal',
        name: `E2E Partner ${uniqueSuffix}`,
        document: `12.345.678/0001-${uniqueSuffix.slice(-2)}`,
        email: `partner.${uniqueSuffix}@example.com`,
      });

    expectSuccessStatus(createResponse.status);
    expect(createResponse.body.id).toBeDefined();
    partnerId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/partners`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ search: uniqueSuffix, page: 1, limit: 20 });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.meta).toBeDefined();
  });

  it('should update partner, change status, manage contact and fetch details', async () => {
    const updateResponse = await request(app.getHttpServer())
      .put(`${baseUrl}/admin/partners/${partnerId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tradeName: `E2E Trade ${uniqueSuffix}`,
        notes: 'Atualizado via e2e',
      });

    expectSuccessStatus(updateResponse.status);

    const statusResponse = await request(app.getHttpServer())
      .patch(`${baseUrl}/admin/partners/${partnerId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'inactive' });

    expectSuccessStatus(statusResponse.status);
    expect(statusResponse.body.status).toBe('inactive');

    const addContactResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/partners/${partnerId}/contacts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Contact ${uniqueSuffix}`,
        email: `contact.${uniqueSuffix}@example.com`,
        isPrimary: true,
      });

    expectSuccessStatus(addContactResponse.status);
    expect(addContactResponse.body.id).toBeDefined();
    contactId = addContactResponse.body.id as string;

    const detailsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/partners/${partnerId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detailsResponse.status).toBe(200);
    expect(detailsResponse.body.id).toBe(partnerId);
    expect(Array.isArray(detailsResponse.body.contacts)).toBe(true);

    const removeContactResponse = await request(app.getHttpServer())
      .delete(`${baseUrl}/admin/partners/${partnerId}/contacts/${contactId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(removeContactResponse.status);
    expect(removeContactResponse.body.message).toBe('Contato removido');
  });

  it('should return partners stats', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/partners/stats`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total).toBeDefined();
    expect(statsResponse.body.byType).toBeDefined();
  });

  afterAll(async () => {
    if (partnerId) {
      await request(app.getHttpServer())
        .delete(`${baseUrl}/admin/partners/${partnerId}`)
        .set('Authorization', `Bearer ${accessToken}`);
    }

    await app.close();
  });
});
