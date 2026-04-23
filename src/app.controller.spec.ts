import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return app health payload', () => {
      const response = appController.health();

      expect(response.status).toBe('ok');
      expect(response.app).toBe('vetra-api');
      expect(response.version).toBe('0.1.0');
      expect(typeof response.timestamp).toBe('string');
    });
  });
});
