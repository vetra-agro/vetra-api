import { Module } from "@nestjs/common";
import { UserTenantsController } from "./user-tenants.controller";
import { UserTenantsService } from "./user-tenants.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [UserTenantsController],
  providers: [UserTenantsService],
  exports: [UserTenantsService],
})
export class UserTenantsModule {}
