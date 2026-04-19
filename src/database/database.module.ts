import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseProvider } from './supabase.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SupabaseProvider],
  exports: [SupabaseProvider],
})
export class DatabaseModule {}
