import { SeasonsService } from './seasons.service';

describe('SeasonsService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new SeasonsService(supabaseProvider);
  };

  it('should ignore tenantId and farmId from update payload', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'season-1', tenant_id: 'tenant-a', farm_id: 'farm-a' },
      error: null,
    });

    const query = { eq: jest.fn(), single };
    query.eq.mockReturnValue(query);
    const select = jest.fn().mockReturnValue({ eq: query.eq });

    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'season-1', name: 'Updated Season' },
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
      'season-1',
      {
        tenantId: 'tenant-b',
        farmId: 'farm-b',
        name: 'Updated Season',
      } as any,
      'tenant-a',
    );

    expect(update).toHaveBeenCalledWith({ name: 'Updated Season' });
    expect(updateEq).toHaveBeenCalledWith('id', 'season-1');
  });
});
