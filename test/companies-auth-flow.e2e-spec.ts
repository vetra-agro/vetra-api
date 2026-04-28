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

describeAuthenticatedFlow('Companies Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const baseUrl = '/api/v1';

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

  it('should return companies stats', async () => {
    const statsResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/companies/stats`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.total_companies).toBeDefined();
    expect(statsResponse.body.by_plan).toBeDefined();
  });

  it('should list companies and get details when available', async () => {
    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/companies`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ search: '' });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);

    const firstCompany = (
      listResponse.body as Array<{ tenant_id?: string }>
    )[0];
    if (!firstCompany?.tenant_id) return;

    const detailResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/companies/${firstCompany.tenant_id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.tenant_id).toBe(firstCompany.tenant_id);
    expect(Array.isArray(detailResponse.body.users)).toBe(true);
    expect(Array.isArray(detailResponse.body.farms)).toBe(true);
    expect(Array.isArray(detailResponse.body.history)).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });
});
