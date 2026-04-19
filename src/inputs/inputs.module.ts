import { Module } from '@nestjs/common';
import { InputsController } from './inputs.controller';
import { InputsService } from './inputs.service';

@Module({
  controllers: [InputsController],
  providers: [InputsService],
})
export class InputsModule {}
