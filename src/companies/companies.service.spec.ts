import { NotFoundException } from '@nestjs/common';
import { CompaniesService } from './companies.service';

describe('CompaniesService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new CompaniesService(supabaseProvider);
  };

  it('should return companies list with users_count and farms_count', async () => {
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'tenant_license_status') {
          return {
            select: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: [
                  {
                    tenant_id: 't1',
                    tenant_name: 'Tenant 1',
                    status: 'active',
                    plan: 'start',
                  },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ count: 3, error: null }),
            }),
          };
        }

        if (table === 'farms') {
          return {
            select: jest.fn().mockResolvedValue({ count: 2, error: null }),
          };
        }

        return {};
      }),
    };

    const service = getService(adminClient);
    const result = await service.findAll();

    expect(result).toEqual([
      expect.objectContaining({
        tenant_id: 't1',
        users_count: 3,
        farms_count: 2,
      }),
    ]);
  });

  it('should return one company with users, farms and history', async () => {
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { tenant_id: 't1', tenant_name: 'Tenant 1' },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'u1',
                    full_name: 'User 1',
                    email: 'u1@example.com',
                  },
                ],
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'f1',
                  name: 'Farm 1',
                },
              ],
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [{ id: 'h1', action: 'renew' }],
                }),
              }),
            }),
          }),
        }),
    };

    const service = getService(adminClient);
    const result = await service.findOne('t1');

    expect(result).toEqual(
      expect.objectContaining({
        tenant_id: 't1',
        users: [expect.objectContaining({ id: 'u1' })],
        farms: [expect.objectContaining({ id: 'f1' })],
        history: [expect.objectContaining({ id: 'h1' })],
      }),
    );
  });

  it('should throw not found when company is missing', async () => {
    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'nf' } }),
          }),
        }),
      }),
    };

    const service = getService(adminClient);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should update company data', async () => {
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table !== 'tenants') return {};

        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 't1', name: 'Tenant Updated' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }),
    };

    const service = getService(adminClient);
    const result = await service.update('t1', { name: 'Tenant Updated' });

    expect(result).toEqual({ id: 't1', name: 'Tenant Updated' });
  });

  it('should return aggregated company stats', async () => {
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({
            data: [
              { status: 'active', plan: 'start' },
              { status: 'trial', plan: 'growth' },
              { status: 'active', plan: 'enterprise' },
            ],
            error: null,
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [{ active: true }, { active: true }], count: 2 }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: [{ id: 'f1' }, { id: 'f2' }], error: null }),
        }),
    };

    const service = getService(adminClient);
    const stats = await service.getStats();

    expect(stats).toEqual({
      total_companies: 3,
      active_companies: 2,
      trial_companies: 1,
      total_users: 2,
      total_farms: 2,
      by_plan: {
        start: 1,
        growth: 1,
        pro: 0,
        enterprise: 1,
      },
    });
  });
});
