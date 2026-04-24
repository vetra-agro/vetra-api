import { AclService } from './acl.service';

describe('AclService', () => {
  const buildChain = (overrides: Record<string, jest.Mock> = {}) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    delete: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  });

  const getService = (fromImpl?: (table: string) => any, rpcResult?: any) => {
    const defaultChain = buildChain();
    const adminClient = {
      from: jest.fn().mockImplementation(fromImpl ?? (() => defaultChain)),
      rpc: jest.fn().mockResolvedValue(rpcResult ?? { error: null }),
    };
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return { service: new AclService(supabaseProvider), adminClient };
  };

  // ── getMatrix ────────────────────────────────────────────────────────────

  it('should build permission matrix indexed by role → module → action', async () => {
    const rows = [
      { role: 'owner', module_key: 'farm', action: 'view', allowed: true },
      { role: 'owner', module_key: 'farm', action: 'edit', allowed: false },
      { role: 'viewer', module_key: 'farm', action: 'view', allowed: true },
    ];

    const chain = buildChain({
      order: jest.fn().mockReturnThis(),
    });
    chain.order
      .mockReturnValueOnce(chain)
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ data: rows, error: null });

    const { service } = getService(() => chain);
    const matrix = await service.getMatrix();

    expect(matrix['owner']['farm']['view']).toBe(true);
    expect(matrix['owner']['farm']['edit']).toBe(false);
    expect(matrix['viewer']['farm']['view']).toBe(true);
  });

  it('should throw when getMatrix returns an error', async () => {
    const chain = buildChain({
      order: jest.fn().mockReturnValueOnce({
        order: jest.fn().mockReturnValueOnce({
          order: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'db error' },
          }),
        }),
      }),
    });

    const { service } = getService(() => chain);

    await expect(service.getMatrix()).rejects.toThrow('db error');
  });

  // ── getByRole ────────────────────────────────────────────────────────────

  it('should return permissions grouped by module for a role', async () => {
    const rows = [
      { module_key: 'financial', action: 'view', allowed: true },
      { module_key: 'financial', action: 'edit', allowed: false },
    ];

    const chain = buildChain({
      order: jest.fn().mockReturnThis(),
    });
    chain.select = jest.fn().mockReturnThis();
    chain.eq = jest.fn().mockReturnThis();
    chain.order
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ data: rows, error: null });

    const { service } = getService(() => chain);
    const result = await service.getByRole('manager');

    expect(result['financial']['view']).toBe(true);
    expect(result['financial']['edit']).toBe(false);
  });

  // ── updatePermission ─────────────────────────────────────────────────────

  it('should upsert and return the updated permission', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const { service } = getService(() => ({ upsert }));

    const result = await service.updatePermission(
      'operator',
      'farm',
      'view',
      true,
      'user-123',
    );

    expect(upsert).toHaveBeenCalledWith(
      {
        role: 'operator',
        module_key: 'farm',
        action: 'view',
        allowed: true,
        updated_by: 'user-123',
      },
      { onConflict: 'role,module_key,action' },
    );
    expect(result).toEqual({
      role: 'operator',
      moduleKey: 'farm',
      action: 'view',
      allowed: true,
    });
  });

  it('should throw when upsert fails on updatePermission', async () => {
    const { service } = getService(() => ({
      upsert: jest
        .fn()
        .mockResolvedValue({ error: { message: 'upsert fail' } }),
    }));

    await expect(
      service.updatePermission('viewer', 'farm', 'edit', false),
    ).rejects.toThrow('upsert fail');
  });

  // ── updateRolePermissions ─────────────────────────────────────────────────

  it('should upsert all rows and return the count', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const { service } = getService(() => ({ upsert }));

    const permissions = [
      { moduleKey: 'farm', action: 'view' as const, allowed: true },
      { moduleKey: 'farm', action: 'edit' as const, allowed: false },
    ];

    const result = await service.updateRolePermissions(
      'accountant',
      permissions,
    );

    expect(upsert).toHaveBeenCalledWith(
      [
        {
          role: 'accountant',
          module_key: 'farm',
          action: 'view',
          allowed: true,
          updated_by: undefined,
        },
        {
          role: 'accountant',
          module_key: 'farm',
          action: 'edit',
          allowed: false,
          updated_by: undefined,
        },
      ],
      { onConflict: 'role,module_key,action' },
    );
    expect(result).toEqual({ updated: 2 });
  });

  // ── copyRole ──────────────────────────────────────────────────────────────

  it('should copy permissions from one role to another', async () => {
    const sourceRows = [{ module_key: 'farm', action: 'view', allowed: true }];

    const upsert = jest.fn().mockResolvedValue({ error: null });

    let callIndex = 0;
    const { service } = getService(() => {
      callIndex++;
      if (callIndex === 1) {
        // getByRole: from().select().eq().order().order()
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnValueOnce({
            order: jest
              .fn()
              .mockResolvedValue({ data: sourceRows, error: null }),
          }),
        };
      }
      return { upsert };
    });

    const result = await service.copyRole('viewer', 'operator', 'admin-id');

    expect(upsert).toHaveBeenCalled();
    expect(result).toEqual({ copied: 1, from: 'viewer', to: 'operator' });
  });

  // ── resetRole ─────────────────────────────────────────────────────────────

  it('should delete permissions and call reset rpc', async () => {
    const deleteEq = jest.fn().mockResolvedValue({ error: null });
    const rpc = jest.fn().mockResolvedValue({ error: null });

    const adminClient = {
      from: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnValue({ eq: deleteEq }),
      }),
      rpc,
    };
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;
    const service = new AclService(supabaseProvider);

    const result = await service.resetRole('operator');

    expect(deleteEq).toHaveBeenCalledWith('role', 'operator');
    expect(rpc).toHaveBeenCalledWith('reset_role_acl', { p_role: 'operator' });
    expect(result).toEqual({ reset: true, role: 'operator' });
  });

  it('should throw when delete fails on resetRole', async () => {
    const adminClient = {
      from: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnValue({
          eq: jest
            .fn()
            .mockResolvedValue({ error: { message: 'delete fail' } }),
        }),
      }),
      rpc: jest.fn(),
    };
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;
    const service = new AclService(supabaseProvider);

    await expect(service.resetRole('viewer')).rejects.toThrow('delete fail');
  });

  // ── check ─────────────────────────────────────────────────────────────────

  it('should return true when permission is allowed', async () => {
    const { service } = getService(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({ data: { allowed: true }, error: null }),
    }));

    await expect(service.check('owner', 'farm', 'delete')).resolves.toBe(true);
  });

  it('should return false when permission is denied', async () => {
    const { service } = getService(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({ data: { allowed: false }, error: null }),
    }));

    await expect(service.check('viewer', 'farm', 'delete')).resolves.toBe(
      false,
    );
  });

  it('should return false when permission row does not exist', async () => {
    const { service } = getService(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }));

    await expect(service.check('viewer', 'farm', 'admin')).resolves.toBe(false);
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  it('should return full history when no role filter is given', async () => {
    const history = [
      { role: 'owner', module_key: 'farm', action: 'edit', allowed: true },
    ];

    const { service } = getService(() => ({
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: history, error: null }),
    }));

    await expect(service.getHistory()).resolves.toEqual(history);
  });

  it('should filter history by role when role is provided', async () => {
    const history = [
      {
        role: 'manager',
        module_key: 'financial',
        action: 'view',
        allowed: true,
      },
    ];

    const eq = jest.fn().mockResolvedValue({ data: history, error: null });

    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue({ eq }),
      }),
      rpc: jest.fn(),
    };
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;
    const svc = new AclService(supabaseProvider);

    const result = await svc.getHistory('manager');

    expect(eq).toHaveBeenCalledWith('role', 'manager');
    expect(result).toEqual(history);
  });
});
