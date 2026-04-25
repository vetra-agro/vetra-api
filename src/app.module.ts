import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { FarmsModule } from './farms/farms.module';
import { FieldsModule } from './fields/fields.module';
import { InputsModule } from './inputs/inputs.module';
import { FinancialModule } from './financial/financial.module';
import { TeamModule } from './team/team.module';
import { MapsModule } from './maps/maps.module';
import { UsersModule } from './users/users.module';
import { MenusModule } from './menus/menus.module';
import { AclModule } from './acl/acl.module';
import { LicensesModule } from './licenses/licenses.module';
import { AuditModule } from './audit/audit.module';
import { PartnersModule } from './partners/partners.module';

@Module({
  imports: [
    // ── Config global ───────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Rate limiting ───────────────────────────
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // ── Core modules ───────────────────────────
    DatabaseModule,
    AuthModule,

    // ── Feature modules ─────────────────────────
    AuditModule,
    FarmsModule,
    FieldsModule,
    InputsModule,
    FinancialModule,
    TeamModule,
    MapsModule,
    UsersModule,
    MenusModule,
    AclModule,
    LicensesModule,
    PartnersModule,    
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
