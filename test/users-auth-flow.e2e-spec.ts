import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';

const e2eUserEmail = process.env.E2E_USER_EMAIL;
const e2eUserPassword = process.env.E2E_USER_PASSWORD;
const e2eUserNewPassword = process.env.E2E_USER_NEW_PASSWORD;

const runAuthenticatedFlow =
  Boolean(e2eUserEmail) &&
  Boolean(e2eUserPassword) &&
  Boolean(e2eUserNewPassword);

const describeAuthenticatedFlow = runAuthenticatedFlow
  ? describe
  : describe.skip;

function expectSuccessStatus(status: number) {
  expect([200, 201]).toContain(status);
}

describeAuthenticatedFlow('Users Auth Flow (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let userId: string;

  const baseUrl = '/api/v1';

  const signIn = async (email: string, password: string) => {
    const response = await request(app.getHttpServer())
      .post(`${baseUrl}/auth/sign-in`)
      .send({ email, password });

    expectSuccessStatus(response.status);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user?.id).toBeDefined();

    return response.body as {
      accessToken: string;
      user: { id: string; email: string };
    };
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
  });

  it('should sign in and list users', async () => {
    const signInResponse = await signIn(e2eUserEmail!, e2eUserPassword!);
    accessToken = signInResponse.accessToken;
    userId = signInResponse.user.id;

    const listResponse = await request(app.getHttpServer())
      .get(`${baseUrl}/admin/users`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
  });

  it('should return conflict when creating user with duplicated email', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        fullName: 'E2E Duplicated User',
        email: e2eUserEmail,
        password: e2eUserPassword,
        role: 'viewer',
      });

    expect(createResponse.status).toBe(409);
  });

  it('should change password and require re-login with the new password', async () => {
    const changePasswordResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/users/${userId}/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ newPassword: e2eUserNewPassword });

    expectSuccessStatus(changePasswordResponse.status);
    expect(changePasswordResponse.body.message).toBe(
      'Senha alterada com sucesso',
    );

    const oldTokenResetResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(oldTokenResetResponse.status).toBe(401);

    const reSignInResponse = await signIn(e2eUserEmail!, e2eUserNewPassword!);
    accessToken = reSignInResponse.accessToken;

    const resetResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${accessToken}`);

    expectSuccessStatus(resetResponse.status);
    expect(resetResponse.body.message).toBe('Link de recuperação gerado');
  });

  it('should restore the original password for idempotent runs', async () => {
    const restoreResponse = await request(app.getHttpServer())
      .post(`${baseUrl}/admin/users/${userId}/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ newPassword: e2eUserPassword });

    expectSuccessStatus(restoreResponse.status);

    const signInRestoredResponse = await signIn(
      e2eUserEmail!,
      e2eUserPassword!,
    );
    accessToken = signInRestoredResponse.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });
});
