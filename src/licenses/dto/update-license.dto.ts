import { IsString, IsEnum, IsOptional, IsInt, IsArray, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum LicensePlan   { START='start', GROWTH='growth', PRO='pro', ENTERPRISE='enterprise' }
export enum LicenseStatus { ACTIVE='active', TRIAL='trial', SUSPENDED='suspended', EXPIRED='expired', CANCELLED='cancelled' }

export class UpdateLicenseDto {
  @ApiPropertyOptional({ enum: LicensePlan })
  @IsOptional() @IsEnum(LicensePlan) plan?: LicensePlan;

  @ApiPropertyOptional({ enum: LicenseStatus })
  @IsOptional() @IsEnum(LicenseStatus) status?: LicenseStatus;

  @ApiPropertyOptional() @IsOptional() @IsInt() maxUsers?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxFarms?: number;

  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) modules?: string[];

  @ApiPropertyOptional({ example: '2025-12-31' })
  @IsOptional() @IsDateString() expiresAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
