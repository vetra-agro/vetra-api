import { FarmsService } from './farms.service';

describe('FarmsService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new FarmsService(supabaseProvider);
  };

  it('should ignore tenantId from update payload', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'farm-1', tenant_id: 'tenant-a' },
      error: null,
    });
    const query = { eq: jest.fn(), single };
    query.eq.mockReturnValue(query);
    const eq = query.eq;
    const select = jest.fn().mockReturnValue({ eq });

    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'farm-1', name: 'Updated Farm' },
      error: null,
    });
    const updateSelect = jest.fn().mockReturnValue({ single: updateSingle });
    const updateEq = jest.fn().mockReturnValue({ select: updateSelect });
    const update = jest.fn().mockReturnValue({ eq: updateEq });

    const adminClient = {
      from: jest.fn().mockImplementation(() => ({
        select,
        update,
      })),
    };

    const service = getService(adminClient);

    await service.update(
      'farm-1',
      {
        tenantId: 'tenant-b',
        name: 'Updated Farm',
      },
      'tenant-a',
    );

    expect(update).toHaveBeenCalledWith({ name: 'Updated Farm' });
    expect(updateEq).toHaveBeenCalledWith('id', 'farm-1');
  });
});
