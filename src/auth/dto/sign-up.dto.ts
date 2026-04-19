import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignUpDto {
  @ApiProperty({ example: 'João da Silva' })
  @IsString()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: 'joao@fazenda.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senhaForte123!' })
  @IsString()
  @MinLength(8)
  password: string;
}
