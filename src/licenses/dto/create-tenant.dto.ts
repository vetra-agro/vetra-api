import { IsString, IsEmail, IsEnum, IsOptional, IsInt, IsArray, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LicensePlan { START='start', GROWTH='growth', PRO='pro', ENTERPRISE='enterprise' }

export class CreateTenantDto {
  @ApiProperty({ example: 'Fazenda Santa Fé Ltda' })
  @IsString() name: string;

  @ApiProperty({ enum: LicensePlan })
  @IsEnum(LicensePlan) plan: LicensePlan;

  @ApiPropertyOptional({ example: '12.345.678/0001-90' })
  @IsOptional() @IsString() document?: string;

  @ApiPropertyOptional({ example: 'contato@fazendastaffe.com.br' })
  @IsOptional() @IsEmail() email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;

  @ApiPropertyOptional({ description: 'Override: máximo de usuários' })
  @IsOptional() @IsInt() @Min(1) maxUsers?: number;

  @ApiPropertyOptional({ description: 'Override: máximo de fazendas' })
  @IsOptional() @IsInt() maxFarms?: number;

  @ApiPropertyOptional({ description: 'Override: módulos ativos' })
  @IsOptional() @IsArray() @IsString({ each: true }) modules?: string[];

  @ApiPropertyOptional({ description: 'Dias de trial (padrão: 14)', default: 14 })
  @IsOptional() @IsInt() @Min(1) trialDays?: number;
}
