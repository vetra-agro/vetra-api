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
