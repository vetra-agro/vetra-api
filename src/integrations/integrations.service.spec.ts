import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new IntegrationsService(supabaseProvider);
  };

  const buildSettingsClient = (rows: any[]) => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        or: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  });

  // ── getAll ────────────────────────────────────────────────────────────────

  it('should return all integrations with unconfigured status when no settings', async () => {
    const service = getService(buildSettingsClient([]));
    const result = await service.getAll('tenant-1');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    for (const intg of result) {
      expect(intg.configured).toBe(false);
      expect(intg.status).toBe('unconfigured');
      expect(intg.fields).toBeDefined();
    }
  });

  it('should mark integration as configured when all required fields are set', async () => {
    const settings = [
      { tenant_id: 'tenant-1', key: 'int_maps_provider', value: 'maptiler', default_value: null, options: null },
      { tenant_id: 'tenant-1', key: 'int_maps_key', value: 'abc123', default_value: null, options: null },
    ];

    const service = getService(buildSettingsClient(settings));
    const result = await service.getAll('tenant-1');

    const maps = result.find((i) => i.key === 'maps');
    expect(maps?.configured).toBe(true);
    expect(maps?.enabled).toBe(true);
    expect(maps?.status).toBe('ok');
  });

  it('should give tenant setting priority over default', async () => {
    const settings = [
      { tenant_id: null, key: 'int_weather_key', value: 'default-key', default_value: null, options: null },
      { tenant_id: 'tenant-1', key: 'int_weather_key', value: 'tenant-key', default_value: null, options: null },
    ];

    const service = getService(buildSettingsClient(settings));
    const result = await service.getAll('tenant-1');

    const weather = result.find((i) => i.key === 'weather');
    const field = weather?.fields.find((f) => f.key === 'int_weather_key');
    expect(field?.value).toBe('tenant-key');
  });

  it('should fall back to default_value when tenant value is absent', async () => {
    const settings = [
      { tenant_id: null, key: 'int_weather_key', value: null, default_value: 'fallback-key', options: null },
    ];

    const service = getService(buildSettingsClient(settings));
    const result = await service.getAll('tenant-1');

    const weather = result.find((i) => i.key === 'weather');
    const field = weather?.fields.find((f) => f.key === 'int_weather_key');
    expect(field?.value).toBe('fallback-key');
  });

  it('should parse JSON options string when options is a string', async () => {
    const settings = [
      {
        tenant_id: 'tenant-1',
        key: 'int_maps_provider',
        value: 'maptiler',
        default_value: null,
        options: '[{"value":"maptiler","label":"MapTiler"}]',
      },
    ];

    const service = getService(buildSettingsClient(settings));
    const result = await service.getAll('tenant-1');

    const maps = result.find((i) => i.key === 'maps');
    const field = maps?.fields.find((f) => f.key === 'int_maps_provider');
    expect(Array.isArray((field as any).options)).toBe(true);
    expect((field as any).options[0].value).toBe('maptiler');
  });

  // ── saveIntegration ───────────────────────────────────────────────────────

  it('should upsert settings rows when saving a valid integration', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const adminClient = {
      from: jest.fn().mockReturnValue({ upsert }),
    };

    const service = getService(adminClient);
    const result = await service.saveIntegration(
      'tenant-1',
      'weather',
      { int_weather_key: 'my-key' },
      'user-1',
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: 'tenant-1',
          key: 'int_weather_key',
          value: 'my-key',
          updated_by: 'user-1',
        }),
      ]),
      { onConflict: 'tenant_id,key' },
    );
    expect(result).toEqual({ saved: 1 });
  });

  it('should throw when saving unknown integration key', async () => {
    const service = getService({ from: jest.fn() });

    await expect(
      service.saveIntegration('tenant-1', 'unknown', {}),
    ).rejects.toThrow('Integração não encontrada');
  });

  it('should throw when upsert returns an error', async () => {
    const adminClient = {
      from: jest.fn().mockReturnValue({
        upsert: jest.fn().mockResolvedValue({ error: { message: 'db error' } }),
      }),
    };

    const service = getService(adminClient);

    await expect(
      service.saveIntegration('tenant-1', 'weather', { int_weather_key: 'k' }),
    ).rejects.toThrow('db error');
  });

  // ── testIntegration ───────────────────────────────────────────────────────

  it('should return not found when integration key is unknown', async () => {
    const service = getService(buildSettingsClient([]));
    const result = await service.testIntegration('tenant-1', 'unknown');

    expect(result).toEqual({ success: false, message: 'Integração não encontrada' });
  });

  it('should return unconfigured when required fields are missing', async () => {
    const service = getService(buildSettingsClient([]));
    const result = await service.testIntegration('tenant-1', 'weather');

    expect(result).toEqual({ success: false, message: 'Integração não configurada' });
  });

  it('should return saved message for integrations without live test (storage)', async () => {
    const settings = [
      {
        tenant_id: 'tenant-1',
        key: 'int_storage_provider',
        value: 'supabase',
        default_value: null,
        options: null,
      },
    ];

    const service = getService(buildSettingsClient(settings));
    const result = await service.testIntegration('tenant-1', 'storage');

    expect(result).toEqual({
      success: true,
      message: 'Configuração salva — teste manual necessário',
    });
  });
});
