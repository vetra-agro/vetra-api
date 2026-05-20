import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ExportModule } from '../src/export/export.module';
import { AppModule } from '../src/app.module';

describe('Export Module (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, ExportModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/export (GET)', () => {
    return request(app.getHttpServer())
      .get('/export')
      .expect(200)
      .expect('Export module works!');
  });
});