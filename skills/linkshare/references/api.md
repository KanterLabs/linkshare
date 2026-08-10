# Linkshare API

Use this reference when debugging the bundled client or extending its behavior.

## Configuration

The client resolves the service origin from `LINKSHARE_URL`, then `url` in `~/.config/linkshare/config.json`. `default_actor` supplies the sender name.

## Endpoints

### Discover

`GET /api/v1` returns the service metadata, expiry policy, and every supported endpoint with a short description.

### Create

`POST /api/v1/links`

Required JSON fields: `url`, `target` (`owner` or `agents`), and `submitted_by`. Optional fields: `title` and `note`. HTTP 201 returns the link including `expires_at`.

### List

`GET /api/v1/links`

Query fields: required `target`, optional `limit` (1–200), optional `before_id`, and optional `state` (`active`, `unread`, `read`, `archived`, `all`). The default state is `active`. Use `state=read` to list previously consumed links (history). Results include `items`, `total`, and `next_before_id`.

### Consume

`DELETE /api/v1/links/{id}` marks a link as consumed and returns HTTP 204. The link is removed from the active inbox and moved to history. Consume only after successful use.

### Events

`GET /api/v1/events` is a server-sent-events stream. It opens with a `hello` event, then emits `link_created` (full link JSON) and `link_consumed` (`{"id": N, "target": "..."}`) as they happen, with keepalive comments every 25 seconds. The client's `watch` command wraps this stream and returns the next created link for a target.

For older clients, `state=active` and `state=unread` remain accepted. Legacy `mark_read` and `archive` PATCH actions consume the item.

## Errors

Errors contain a stable `error.code` and human-readable `error.message`. Common statuses are 400 for malformed input, 403 for denied cross-origin requests, 404 for missing or expired links, 415 for an invalid content type, 422 for validation errors, and 503 for database unavailability.
