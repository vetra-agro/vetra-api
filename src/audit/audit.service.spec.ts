import { AuditService } from './audit.service';

describe('AuditService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new AuditService(supabaseProvider);
  };

  it('should log audit events without throwing', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const adminClient = {
      from: jest.fn().mockReturnValue({ insert }),
    };

    const service = getService(adminClient);

    await expect(
      service.log({
        userId: 'user-1',
        eventType: 'license_changed',
        module: 'licenses',
        description: 'Licenca atualizada',
        success: false,
        errorMessage: 'falha externa',
      }),
    ).resolves.toBeUndefined();

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        event_type: 'license_changed',
        module: 'licenses',
        description: 'Licenca atualizada',
        success: false,
        error_message: 'falha externa',
      }),
    );
  });

  it('should extract the first forwarded ip when available', () => {
    const service = getService({ from: jest.fn() });

    const ip = service.extractIp({
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any);

    expect(ip).toBe('10.0.0.1');
  });

  it('should return paginated logs and meta from findAll', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [{ id: 'log-1', description: 'registro' }],
        count: 1,
        error: null,
      }),
    };
    const adminClient = {
      from: jest.fn().mockReturnValue(chain),
    };

    const service = getService(adminClient);
    const result = await service.findAll({ page: 2, limit: 10 });

    expect(result).toEqual({
      data: [{ id: 'log-1', description: 'registro' }],
      meta: {
        total: 1,
        page: 2,
        limit: 10,
        pages: 1,
      },
    });
  });

  it('should return one audit log by id', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'log-1', event_type: 'login_success' },
      error: null,
    });
    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValue({ single }),
      }),
    };

    const service = getService(adminClient);

    await expect(service.findOne('log-1')).resolves.toEqual({
      id: 'log-1',
      event_type: 'login_success',
    });
  });

  it('should return access logs with total', async () => {
    const limit = jest.fn().mockResolvedValue({
      data: [{ id: 'access-1', event_type: 'login_success' }],
      count: 1,
      error: null,
    });
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          range: jest
            .fn()
            .mockResolvedValue({ data: [], count: 0, error: null }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({ limit }),
          }),
        }),
    };

    const service = getService(adminClient);

    await expect(service.getAccessLogs({ limit: 25 })).resolves.toEqual({
      data: [{ id: 'access-1', event_type: 'login_success' }],
      total: 1,
    });
  });

  it('should calculate audit stats for 24h and 30d', async () => {
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue({
            data: [
              { event_type: 'login_success', success: true, module: 'auth' },
              { event_type: 'login_failed', success: false, module: 'auth' },
              {
                event_type: 'record_updated',
                success: true,
                module: 'licenses',
              },
            ],
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue({
            data: [
              { event_type: 'login_success', success: true, module: 'auth' },
              {
                event_type: 'record_updated',
                success: true,
                module: 'licenses',
              },
              {
                event_type: 'record_deleted',
                success: false,
                module: 'licenses',
              },
            ],
          }),
        }),
    };

    const service = getService(adminClient);
    const result = await service.getStats();

    expect(result).toEqual({
      last24h: {
        total: 3,
        logins: 1,
        loginsFailed: 1,
        operations: 1,
        errors: 1,
      },
      last30d: {
        total: 3,
        byModule: {
          auth: 1,
          licenses: 2,
        },
        byEventType: {
          login_success: 1,
          record_updated: 1,
          record_deleted: 1,
        },
        errorRate: 33,
      },
    });
  });

  it('should export logs as csv', async () => {
    const service = getService({ from: jest.fn() });
    jest.spyOn(service, 'findAll').mockResolvedValue({
      data: [
        {
          created_at: '2026-04-25T12:00:00.000Z',
          user_name: 'Marcelo',
          user_email: 'marcelo@example.com',
          user_role: 'owner',
          module: 'licenses',
          event_type: 'license_changed',
          description: 'Plano atualizado',
          entity_label: 'Tenant A',
          success: true,
          ip_address: '127.0.0.1',
        },
      ],
      meta: {
        total: 1,
        page: 1,
        limit: 5000,
        pages: 1,
      },
    });

    const csv = await service.exportCsv({ module: 'licenses' });

    expect(csv).toContain('módulo');
    expect(csv).toContain('licenses');
    expect(csv).toContain('Plano atualizado');
    expect(csv).toContain('Tenant A');
  });
});
