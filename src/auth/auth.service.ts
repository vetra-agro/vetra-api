import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { SupabaseProvider } from '../database/supabase.provider';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';

@Injectable()
export class AuthService {
  constructor(private supabase: SupabaseProvider) {}

  async signUp(dto: SignUpDto) {
    const { data, error } = await this.supabase.getClient().auth.signUp({
      email: dto.email,
      password: dto.password,
      options: { data: { full_name: dto.fullName, role: 'owner' } },
    });
    if (error) throw new ConflictException(error.message);
    return { user: data.user, session: data.session };
  }

  async signIn(dto: SignInDto) {
    const { data, error } = await this.supabase.getClient().auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: data.user.user_metadata?.full_name,
        role: data.user.user_metadata?.role,
      },
    };
  }

  async signOut(accessToken: string) {
    const client = this.supabase.getAuthenticatedClient(accessToken);
    await client.auth.signOut();
    return { message: 'Sessão encerrada com sucesso' };
  }

  async validateToken(token: string) {
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  }
}
