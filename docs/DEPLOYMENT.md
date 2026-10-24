# Deployment

Deploy the web app as a static Vite build and deploy the API, ML service, PostgreSQL and object storage as separate services. The API and ML service both need private networking; only the API and web UI should be internet-facing.

Required runtime variables are documented in `.env.example`. Run Prisma migrations during release, then run health checks:

```text
GET /healthz
GET /api/v1/healthz
GET /docs  (ML service)
```

Use a managed PostgreSQL backup policy before production. The included Docker Compose file is for local development only and uses development credentials.
