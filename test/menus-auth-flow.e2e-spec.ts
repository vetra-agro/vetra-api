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

describeAuthenticatedFlow('Menus Auth Flow (e2e)', () => {
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

  afterAll(async () => {
    await app.close();
  });

  it('should list all modules', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/menus`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should get full ACL', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/menus/acl`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('should get menu for role admin', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/menus/role/admin`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });
});
