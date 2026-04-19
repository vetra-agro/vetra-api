import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseProvider {
  private readonly client: SupabaseClient;
  private readonly adminClient: SupabaseClient;

  constructor(private configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');
    const serviceKey = this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    // Client público (respeitando RLS)
    this.client = createClient(url, anonKey);

    // Client admin (bypass RLS — usar com cautela)
    this.adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Client com RLS ativo — use na maioria dos casos */
  getClient(): SupabaseClient {
    return this.client;
  }

  /** Client service_role — bypass RLS, somente para operações administrativas */
  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }

  /** Client autenticado com JWT do usuário logado */
  getAuthenticatedClient(accessToken: string): SupabaseClient {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const anonKey = this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');
    return createClient(url, anonKey, {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
  }
}
