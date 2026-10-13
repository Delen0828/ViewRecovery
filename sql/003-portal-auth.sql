-- Better Auth's credential/session schema, isolated from experiment records.
CREATE SCHEMA IF NOT EXISTS portal_auth;
CREATE TABLE IF NOT EXISTS portal_auth."user" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  username text UNIQUE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  "participantId" text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS portal_auth.session (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES portal_auth."user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON portal_auth.session("userId");
CREATE TABLE IF NOT EXISTS portal_auth.account (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES portal_auth."user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON portal_auth.account("userId");
CREATE TABLE IF NOT EXISTS portal_auth.verification (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON portal_auth.verification(identifier);
CREATE TABLE IF NOT EXISTS portal_auth."rateLimit" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
