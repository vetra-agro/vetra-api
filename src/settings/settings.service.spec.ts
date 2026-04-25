import { NotFoundException } from '@nestjs/common';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new SettingsService(supabaseProvider);
  };

  it('should merge defaults and tenant overrides in getAll', async () => {
    const defaults = [
      {
        id: 'd1',
        key: 'notif_email_port',
        group_name: 'notification',
        default_value: '587',
      },
      {
        id: 'd2',
        key: 'notif_email_sender',
        group_name: 'notification',
        default_value: 'sender@example.com',
      },
    ];
    const overrides = [
      {
        id: 'o1',
        key: 'notif_email_port',
        value: '2525',
      },
    ];

    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: defaults }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: overrides }),
          }),
        }),
    };

    const service = getService(adminClient);
    const result = await service.getAll('tenant-1');

    expect(result.notification).toHaveLength(2);
    expect(result.notification[0]).toEqual(
      expect.objectContaining({
        key: 'notif_email_port',
        value: '2525',
        id: 'o1',
      }),
    );
    expect(result.notification[1]).toEqual(
      expect.objectContaining({
        key: 'notif_email_sender',
        value: 'sender@example.com',
      }),
    );
  });

  it('should return tenant value or fallback default in get', async () => {
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: { default_value: 'smtp.example.com' },
                }),
              }),
            }),
          }),
        }),
    };

    const service = getService(adminClient);
    const value = await service.get('tenant-1', 'notif_email_smtp');

    expect(value).toBe('smtp.example.com');
  });

  it('should throw not found when setting unknown key', async () => {
    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          is: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
    };

    const service = getService(adminClient);

    await expect(
      service.set('tenant-1', 'unknown_key', 'v'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should upsert tenant setting in set', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 's1',
        tenant_id: 'tenant-1',
        key: 'notif_email_port',
        value: '2525',
      },
      error: null,
    });
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: 'def-1',
                    key: 'notif_email_port',
                    type: 'number',
                    is_required: false,
                    group_name: 'notification',
                    label: 'SMTP Port',
                  },
                }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          upsert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single }),
          }),
        }),
    };

    const service = getService(adminClient);
    const result = await service.set(
      'tenant-1',
      'notif_email_port',
      '2525',
      'user-1',
    );

    expect(result).toEqual({
      id: 's1',
      tenant_id: 'tenant-1',
      key: 'notif_email_port',
      value: '2525',
    });
  });

  it('should return succeeded/failed counters in setBatch', async () => {
    const service = getService({ from: jest.fn() });
    jest
      .spyOn(service, 'set')
      .mockResolvedValueOnce({ id: 'ok-1' } as any)
      .mockRejectedValueOnce(new Error('falha 1'))
      .mockResolvedValueOnce({ id: 'ok-2' } as any);

    const result = await service.setBatch(
      'tenant-1',
      [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
        { key: 'c', value: '3' },
      ],
      'user-1',
    );

    expect(result).toEqual({
      succeeded: 2,
      failed: 1,
      errors: ['falha 1'],
    });
  });

  it('should reset one key and all settings', async () => {
    const deleteEqKey = jest
      .fn()
      .mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
    const deleteEqAllFinal = jest.fn().mockResolvedValue({ error: null });
    const deleteEqAll = jest.fn().mockReturnValue({ eq: deleteEqAllFinal });

    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          delete: jest.fn().mockReturnValue({ eq: deleteEqKey }),
        })
        .mockReturnValueOnce({
          delete: jest.fn().mockReturnValue({ eq: deleteEqAll }),
        }),
    };

    const service = getService(adminClient);

    await expect(
      service.reset('tenant-1', 'notif_email_port'),
    ).resolves.toEqual({
      key: 'notif_email_port',
      reset: true,
    });

    await expect(service.resetAll('tenant-1')).resolves.toEqual({
      reset: true,
      message: 'Configurações restauradas para os padrões',
    });
  });

  it('should test smtp with configured and missing values', async () => {
    const service = getService({ from: jest.fn() });

    jest
      .spyOn(service, 'get')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('587')
      .mockResolvedValueOnce('user@example.com')
      .mockResolvedValueOnce('sender@example.com');

    await expect(service.testSmtp('tenant-1')).resolves.toEqual({
      success: false,
      message: 'Configure o servidor SMTP primeiro',
    });

    jest
      .spyOn(service, 'get')
      .mockResolvedValueOnce('smtp.example.com')
      .mockResolvedValueOnce('587')
      .mockResolvedValueOnce('user@example.com')
      .mockResolvedValueOnce('sender@example.com');

    await expect(service.testSmtp('tenant-1')).resolves.toEqual({
      success: true,
      message: 'Conexão SMTP testada: smtp.example.com:587 (user@example.com)',
      sender: 'sender@example.com',
    });
  });
});
