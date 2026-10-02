# New Application Bootstrap

Use this guide when starting a new application from this context.

> En este proyecto, el bootstrap (`bootstrap-application`) se limita a la infraestructura base. La autenticación descrita en las secciones 4, 5 y 7 (Better Auth, primer administrador, rutas protegidas y shell autenticado) la implementa el cambio `add-user-access`.

## 1. Create The Repository

Copy the context kit into the new project:

```bash
git clone --depth 1 https://github.com/Elvis-WDev/CognitiveStack.git context-template
rsync -av --exclude='.git' context-template/ path/to/your-project/
rm -rf context-template
```

The kit is:

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CLAUDE.md`
- `.agents/skills/`
- `.claude/`
- `openspec/`
- `docs/`
- `.github/`
- `.codex/README.md`

Then adapt it before asking an agent for changes:

- Replace `{{PROJECT_NAME}}` in `AGENTS.md`.
- Replace the verification commands in `AGENTS.md` when the project exposes different script names.
- Adapt every document to the architecture the project actually has, not the one it may get later.

Then initialize the application code using the selected stack.

## 2. Package Manager

Enable Corepack and use pnpm only:

```bash
corepack enable
corepack pnpm install
```

## 3. OpenSpec

The kit ships OpenSpec already initialized for Codex, Claude Code, and GitHub Copilot, with
`openspec/config.yaml` bridging it to these documents. Each developer prepares their machine
once:

```bash
corepack pnpm add --global @fission-ai/openspec
openspec config set profile custom
openspec config set workflows '["propose","explore","apply","update","sync","archive","verify"]'
openspec update
```

`openspec update` regenerates the generated skills for the installed CLI version. To support
another agent, add it with `openspec init --tools <id>`; existing files stay untouched. See
`docs/quality/change-lifecycle.md` for the lifecycle.

## 4. Backend Baseline

Create a TypeScript Express API with:

- Environment validation through Zod.
- Better Auth configured before protected routes.
- Prisma connected to PostgreSQL.
- Layered folders for domain, use cases, infrastructure, and HTTP.
- Health endpoint.
- Global error handler.
- Typed external API clients using Axios when needed.

## 5. Frontend Baseline

Create a Next.js frontend with:

- Tailwind CSS.
- shadcn/ui.
- lucide-react icons.
- React Hook Form.
- Zod validation.
- Typed API helper.
- Auth-aware app shell.

## 6. Database Baseline

Use PostgreSQL and Prisma migrations:

- Define `DATABASE_URL`.
- Run initial migration.
- Generate Prisma Client.
- Document schema changes in `docs/generated/`.

## 7. Auth Baseline

Use Better Auth:

- Configure secret and trusted origins.
- Seed or create the first admin user only when needed.
- Protect API routes with auth middleware.
- Keep registration disabled unless the product requires it.

## 8. Deployment Baseline

Prepare Docker files when code exists:

- API container.
- Frontend container.
- Remote PostgreSQL in production.
- Health checks.
- No database data deletion on redeploy.

## 9. Documentation Baseline

Before implementing features:

- Complete `docs/product/overview.md`.
- Capture behavior in `openspec/specs/` through the first OpenSpec changes.
- Update `ARCHITECTURE.md` for project-specific boundaries.
- Create ADRs for deviations from this stack.

