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

describeAuthenticatedFlow('ACL Auth Flow (e2e)', () => {
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

  it('should get the full ACL matrix', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/acl/matrix`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('should get permissions for the admin role', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/acl/admin`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('should get ACL history', async () => {
    const response = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/acl/history`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('should update a single permission', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${baseUrl}/admin/acl/operator/farms/read`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ allowed: true });

    expectSuccessStatus(response.status);
  });

  it('should update permissions in batch for a role', async () => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/acl/operator/batch`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        permissions: [
          { moduleKey: 'farms', action: 'read', allowed: true },
          { moduleKey: 'farms', action: 'write', allowed: false },
        ],
      });

    expectSuccessStatus(response.status);
  });
});
