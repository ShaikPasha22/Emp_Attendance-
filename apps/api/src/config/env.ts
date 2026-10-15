import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JOB_SECRET: z.string().min(16, 'JOB_SECRET must be at least 16 characters'),
  PROXY_SECRET: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  EMAIL_PROVIDER: z.enum(['console', 'brevo', 'resend']).default('console'),
  EMAIL_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Attendance Portal <no-reply@example.com>'),
  SENTRY_DSN: z.string().default(''),
  /** Reverse geocoding for punch addresses: free OpenStreetMap Nominatim by default. */
  GEOCODER: z.enum(['nominatim', 'locationiq', 'geoapify', 'none']).default('nominatim'),
  GEOCODER_API_KEY: z.string().default(''),
  /** Contact email sent to Nominatim (required by its usage policy). */
  GEOCODER_CONTACT_EMAIL: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const e = parsed.data;
if (e.NODE_ENV === 'production') {
  const weak = (s: string) => s.startsWith('change-me');
  if (weak(e.JWT_SECRET) || weak(e.JOB_SECRET)) {
    console.error('Refusing to start: replace the default JWT_SECRET / JOB_SECRET in production.');
    process.exit(1);
  }
  if ((e.GEOCODER === 'locationiq' || e.GEOCODER === 'geoapify') && !e.GEOCODER_API_KEY) {
    console.error(`GEOCODER_API_KEY is required when GEOCODER is "${e.GEOCODER}".`);
    process.exit(1);
  }
  if (e.EMAIL_PROVIDER !== 'console' && !e.EMAIL_API_KEY) {
    console.error('EMAIL_API_KEY is required when EMAIL_PROVIDER is not "console".');
    process.exit(1);
  }
}

export const env = { ...e, isProd: e.NODE_ENV === 'production', isTest: e.NODE_ENV === 'test' };
