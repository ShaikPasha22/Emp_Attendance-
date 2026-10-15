// Safe defaults so modules that read env can be imported in tests. Integration tests use the TEST database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/attendance_local_test';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-1234567890';
process.env.JOB_SECRET ??= 'test-job-secret-123456';
process.env.APP_URL ??= 'http://localhost:5173';
process.env.EMAIL_PROVIDER = 'console';
process.env.GEOCODER = 'none';
