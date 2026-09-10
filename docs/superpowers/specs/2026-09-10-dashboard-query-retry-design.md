# Dashboard Query Retry Design

## Goal

Avoid delaying dashboard permission errors while preserving retries for transient failures.

## Design

Configure the shared dashboard `QueryClient` with a retry predicate. Permanent client errors, including `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, and `NOT_FOUND`, end immediately. Rate limiting, server errors, timeouts, and network failures retain the existing maximum of three retries.

## Scope

The policy applies to every dashboard query. Mutations retain their current behavior.

## Verification

Unit tests will prove that `FORBIDDEN` is not retried, while an internal server error is retried until the normal retry limit.
