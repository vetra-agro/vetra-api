import { Module } from '@nestjs/common';
import { AclController } from './acl.controller';
import { AclService } from './acl.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AclController],
  providers: [AclService],
  exports: [AclService],
})
export class AclModule {}
