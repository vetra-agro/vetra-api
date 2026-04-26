import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const getService = (adminClient: any) => {
    const supabaseProvider = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as any;

    return new UsersService(supabaseProvider);
  };

  it('should return users list from profiles', async () => {
    const users = [{ id: 'u1', email: 'user@example.com' }];

    const adminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: users, error: null }),
        }),
      }),
    };

    const service = getService(adminClient);

    await expect(service.findAll()).resolves.toEqual(users);
  });

  it('should throw conflict when profile email already exists', async () => {
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: { id: 'existing-user-id' },
                }),
              }),
            }),
          };
        }

        return {};
      }),
      auth: {
        admin: {
          createUser: jest.fn(),
        },
      },
    };

    const service = getService(adminClient);

    await expect(
      service.create({
        fullName: 'Marcelo',
        email: 'marcelo_s_almeida@hotmail.com',
        password: 'dev1234!',
        role: 'viewer' as any,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('should throw conflict when auth provider reports duplicated email', async () => {
    const adminClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: null,
                }),
              }),
            }),
          };
        }

        return {};
      }),
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'User already registered' },
          }),
        },
      },
    };

    const service = getService(adminClient);

    await expect(
      service.create({
        fullName: 'Marcelo',
        email: 'marcelo_s_almeida@hotmail.com',
        password: 'dev1234!',
        role: 'viewer' as any,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('should retry create user without role metadata on database trigger error', async () => {
    const createUser = jest
      .fn()
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Database error creating new user' },
      })
      .mockResolvedValueOnce({
        data: { user: { id: 'user-fallback-id' } },
        error: null,
      });

    const adminClient = {
      from: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      })),
      auth: {
        admin: {
          createUser,
        },
      },
    };

    const service = getService(adminClient);
    jest
      .spyOn(service as any, 'waitForProfile')
      .mockResolvedValue({ id: 'user-fallback-id' });
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'user-fallback-id' } as any);

    await expect(
      service.create({
        fullName: 'Mega Man',
        email: 'mega@1.com',
        password: 'mega@123!',
        role: 'owner' as any,
      }),
    ).resolves.toEqual({ id: 'user-fallback-id' });

    expect(createUser).toHaveBeenCalledTimes(2);
    expect(createUser).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        user_metadata: { full_name: 'Mega Man' },
      }),
    );
    expect(createUser).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        email: 'mega@1.com',
        password: 'mega@123!',
      }),
    );
  });

  it('should recover orphan auth user when profile does not exist', async () => {
    const createUser = jest.fn();
    const listUsers = jest.fn().mockResolvedValue({
      data: {
        users: [
          {
            id: 'orphan-auth-id',
            email: 'orphan@vetra.com',
          },
        ],
      },
      error: null,
    });

    const adminClient = {
      from: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      })),
      auth: {
        admin: {
          createUser,
          listUsers,
        },
      },
    };

    const service = getService(adminClient);
    jest
      .spyOn(service as any, 'waitForProfile')
      .mockResolvedValue({ id: 'orphan-auth-id' });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'orphan-auth-id' } as any);

    await expect(
      service.create({
        fullName: 'Orphan User',
        email: 'orphan@vetra.com',
        password: 'orphan@123',
        role: 'manager' as any,
      }),
    ).resolves.toEqual({ id: 'orphan-auth-id' });

    expect(createUser).not.toHaveBeenCalled();
    expect(listUsers).toHaveBeenCalled();
  });

  it('should change password successfully', async () => {
    const updateUserById = jest.fn().mockResolvedValue({ error: null });

    const adminClient = {
      auth: {
        admin: {
          updateUserById,
        },
      },
      from: jest.fn(),
    };

    const service = getService(adminClient);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'user-id' } as any);

    await expect(
      service.changePassword('user-id', 'NovaSenha@123'),
    ).resolves.toEqual({
      message: 'Senha alterada com sucesso',
    });

    expect(updateUserById).toHaveBeenCalledWith('user-id', {
      password: 'NovaSenha@123',
    });
  });
});
