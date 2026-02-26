# VampApi

Backend API for the VAMP (Vessel Asset Management Platform). Express.js + Prisma + PostgreSQL.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL and JWT secret

# Run database migrations
npm run db:migrate

# (Optional) Seed the database
npm run db:seed

# Start development server
npm run dev
```

The API runs on `http://localhost:3001` by default.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm test` | Run tests |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed the database |
| `npm run db:studio` | Open Prisma Studio (DB browser) |

## Project Structure

```
src/
  config/       # Environment, auth, database config
  constants/    # Permissions, roles
  middleware/    # Auth, validation, error handling, permissions
  routes/       # Express route handlers (one file per resource)
  schemas/      # Zod validation schemas (one file per resource)
  services/     # Business logic (one file per resource)
  app.ts        # Express app setup
  index.ts      # Server entry point
  signaling.ts  # Socket.IO for WebRTC video collaboration
prisma/
  schema.prisma # Database schema
  migrations/   # Migration history
  seed.ts       # Database seeder
```

## Adding a New Feature

1. Create `src/schemas/feature.schema.ts` - Zod validation
2. Create `src/services/feature.service.ts` - Business logic
3. Create `src/routes/feature.routes.ts` - HTTP endpoints
4. Register the routes in `src/app.ts`
5. If new DB tables needed, update `prisma/schema.prisma` and run `npm run db:migrate`

## API Endpoints

All endpoints are prefixed with `/api/v1`.

- `POST /auth/register` - Register
- `POST /auth/login` - Login
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout
- `GET /auth/me` - Current user profile
- `GET /vessels` - List vessels
- `GET /work-orders` - List work orders
- `GET /inspections` - List inspections
- `GET /dashboard/overview` - Dashboard stats
- `GET /health` - Health check

## Environment Variables

See `.env.example` for the full list. Required:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Minimum 32 characters
- `APP_URL` - Frontend URL (for CORS)
