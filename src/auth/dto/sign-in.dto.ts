import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignInDto {
  @ApiProperty({ example: 'joao@fazenda.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senhaForte123!' })
  @IsString()
  @MinLength(8)
  password: string;
}
