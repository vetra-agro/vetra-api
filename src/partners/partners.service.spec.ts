import { ConflictException, NotFoundException } from '@nestjs/common';
import { PartnersService } from './partners.service';

describe('PartnersService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new PartnersService(supabaseProvider);
  };

  it('should return paginated partners from findAll', async () => {
    const range = jest.fn().mockResolvedValue({
      data: [{ id: 'p1', name: 'Parceiro 1' }],
      count: 1,
      error: null,
    });
    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range,
      }),
    };

    const service = getService(adminClient);
    const result = await service.findAll({ page: 1, limit: 10 });

    expect(result).toEqual({
      data: [{ id: 'p1', name: 'Parceiro 1' }],
      meta: { total: 1, page: 1, limit: 10, pages: 1 },
    });
  });

  it('should return one partner with contacts', async () => {
    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'p1', name: 'Parceiro 1' },
              error: null,
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnValue({
            order: jest
              .fn()
              .mockResolvedValue({ data: [{ id: 'c1', name: 'Contato 1' }] }),
          }),
        }),
    };

    const service = getService(adminClient);
    const result = await service.findOne('p1');

    expect(result).toEqual({
      id: 'p1',
      name: 'Parceiro 1',
      contacts: [{ id: 'c1', name: 'Contato 1' }],
    });
  });

  it('should throw not found when findOne does not find partner', async () => {
    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValue({
          single: jest
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'nf' } }),
        }),
      }),
    };

    const service = getService(adminClient);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should throw conflict when creating partner with duplicate document', async () => {
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'partners') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest
                  .fn()
                  .mockResolvedValue({ data: { id: 'p1' } }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const service = getService(adminClient);

    await expect(
      service.create(
        {
          types: ['client'] as any,
          personType: 'legal' as any,
          name: 'Parceiro Duplicado',
          document: '12.345.678/0001-90',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('should create partner and sanitize document', async () => {
    const insertSingle = jest.fn().mockResolvedValue({
      data: { id: 'p2', name: 'Novo Parceiro', document: '12345678000190' },
      error: null,
    });
    const insert = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: insertSingle }),
    });
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'partners') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
            insert,
          };
        }
        return {};
      }),
    };

    const service = getService(adminClient);
    const result = await service.create(
      {
        types: ['supplier'] as any,
        personType: 'legal' as any,
        name: 'Novo Parceiro',
        document: '12.345.678/0001-90',
      },
      'user-1',
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Novo Parceiro',
        document: '12345678000190',
        created_by: 'user-1',
      }),
    );
    expect(result).toEqual({
      id: 'p2',
      name: 'Novo Parceiro',
      document: '12345678000190',
    });
  });

  it('should update partner status using setStatus', async () => {
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'partners_summary') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'p3', name: 'Parceiro 3' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'partner_contacts') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          };
        }
        if (table === 'partners') {
          return {
            update: jest.fn().mockReturnValue({ eq: updateEq }),
          };
        }
        return {};
      }),
    };

    const service = getService(adminClient);
    const result = await service.setStatus('p3', 'blocked');

    expect(updateEq).toHaveBeenCalledWith('id', 'p3');
    expect(result).toEqual({ id: 'p3', status: 'blocked' });
  });

  it('should add and remove partner contact', async () => {
    const insertSingle = jest.fn().mockResolvedValue({
      data: { id: 'c2', name: 'Contato 2' },
      error: null,
    });
    const deleteEqPartner = jest.fn().mockResolvedValue({ error: null });

    const adminClient = {
      from: jest
        .fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { id: 'p4', name: 'Parceiro 4' },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        })
        .mockReturnValueOnce({
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: insertSingle }),
          }),
        })
        .mockReturnValueOnce({
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ eq: deleteEqPartner }),
          }),
        }),
    };

    const service = getService(adminClient);

    const contact = await service.addContact('p4', {
      name: 'Contato 2',
      email: 'contato@example.com',
    });

    const removed = await service.removeContact('p4', 'c2');

    expect(contact).toEqual({ id: 'c2', name: 'Contato 2' });
    expect(deleteEqPartner).toHaveBeenCalledWith('partner_id', 'p4');
    expect(removed).toEqual({ message: 'Contato removido' });
  });

  it('should return stats grouped by type and status', async () => {
    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: [
            {
              types: ['client', 'supplier'],
              status: 'active',
              person_type: 'legal',
            },
            { types: ['client'], status: 'inactive', person_type: 'natural' },
            { types: ['carrier'], status: 'blocked', person_type: 'legal' },
          ],
        }),
      }),
    };

    const service = getService(adminClient);
    const result = await service.getStats();

    expect(result).toEqual({
      total: 3,
      active: 1,
      inactive: 1,
      blocked: 1,
      legal: 2,
      natural: 1,
      byType: {
        client: 2,
        supplier: 1,
        carrier: 1,
      },
    });
  });
});
