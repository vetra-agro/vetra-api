import { PartialType } from '@nestjs/swagger';
import { CreatePartnerDto } from './create-partner.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum PartnerStatus { ACTIVE='active', INACTIVE='inactive', BLOCKED='blocked' }

export class UpdatePartnerDto extends PartialType(CreatePartnerDto) {
  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional() @IsEnum(PartnerStatus)
  status?: PartnerStatus;
}
