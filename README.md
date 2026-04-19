# 🌱 Vetra API

ERP Agro — API backend do sistema Vetra de gestão de fazendas.

## Stack

- **Runtime**: Node.js 20 + TypeScript
- **Framework**: NestJS 11
- **Banco**: Supabase (PostgreSQL + PostGIS)
- **Auth**: Supabase Auth + JWT (Passport)
- **Docs**: Swagger/OpenAPI em `/docs`
- **Deploy**: Render.com (PoC) → AWS EKS (produção)

## Início rápido

```bash
# 1. Clonar e instalar
git clone https://github.com/seu-usuario/vetra-api
cd vetra-api
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais do Supabase

# 3. Rodar a migration no Supabase SQL Editor
# Cole o conteúdo de supabase/migrations/20240101000000_initial_schema.sql

# 4. Subir em modo dev
npm run start:dev
```

## Endpoints principais

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/v1/health | Health check |
| POST | /api/v1/auth/sign-up | Criar conta |
| POST | /api/v1/auth/sign-in | Login |
| GET | /api/v1/farms | Listar fazendas |
| POST | /api/v1/farms | Criar fazenda |
| GET | /api/v1/fields?farmId=... | Listar talhões |
| GET | /api/v1/maps/fields/geojson?farmId=... | Talhões como GeoJSON |
| GET | /api/v1/financial/:farmId/summary | Resumo financeiro |
| GET | /api/v1/inputs/low-stock?farmId=... | Estoque crítico |

Documentação completa: `http://localhost:3000/docs`

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

- `SUPABASE_URL` — URL do projeto no Supabase
- `SUPABASE_ANON_KEY` — chave pública (anon)
- `SUPABASE_SERVICE_ROLE_KEY` — chave de serviço (admin)
- `JWT_SECRET` — segredo JWT (use o mesmo do Supabase JWT secret)

## Deploy no Render (PoC)

1. Crie um **Web Service** no [Render](https://render.com)
2. Conecte este repositório GitHub
3. Configure as variáveis de ambiente nas Settings do serviço
4. Adicione `RENDER_SERVICE_ID` e `RENDER_DEPLOY_KEY` nos Secrets do GitHub
5. Push na branch `main` triggera o deploy automaticamente

## Arquitetura de módulos

```
src/
├── auth/          # Autenticação via Supabase Auth + JWT
├── farms/         # CRUD de fazendas
├── fields/        # Talhões com suporte a GeoJSON
├── inputs/        # Estoque de insumos
├── financial/     # Transações e resumo financeiro
├── team/          # Gestão de equipe/funcionários
├── maps/          # Endpoints geoespaciais (GeoJSON)
├── database/      # SupabaseProvider global
└── common/        # Guards, interceptors, decorators
```
