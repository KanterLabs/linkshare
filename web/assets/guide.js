const base = window.location.origin;
const instruction = `Use Linkshare at ${base} to exchange one-time links with me.

- Discover every operation with GET /api/v1.
- Send me a link by POSTing to /api/v1/links with target "owner".
- Check links I left for agents with GET /api/v1/links?target=agents.
- Wait for new links in real time with GET /api/v1/events (server-sent events: link_created, link_consumed).
- Use a URL before consuming it.
- After successful use, DELETE /api/v1/links/{id}.
- Consumed links are kept in history and can be viewed with state=read.
- Leave failed or unrelated links waiting. Links otherwise expire automatically.
- The service is trusted-LAN only and has no authentication.`;

document.querySelector('#agent-instruction').textContent = instruction;
document.querySelector('#discover-example').textContent = `curl '${base}/api/v1'`;
document.querySelector('#post-example').textContent = `curl -X POST ${base}/api/v1/links \\
  -H 'Content-Type: application/json' \\
  -d '{"url":"https://example.com","title":"Useful reference","note":"Why it matters","target":"owner","submitted_by":"codex-agent"}'`;
document.querySelector('#get-example').textContent = `curl '${base}/api/v1/links?target=agents'`;
document.querySelector('#consume-example').textContent = `curl -X DELETE ${base}/api/v1/links/42`;
document.querySelector('#events-example').textContent = `curl -N '${base}/api/v1/events'
# emits: event: link_created / link_consumed with JSON data; keepalive comments every 25s`;
document.querySelector('#history-example').textContent = `curl '${base}/api/v1/links?target=owner&state=read'`;

document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  const source = document.querySelector(`#${button.dataset.copy}`);
  await navigator.clipboard.writeText(source.textContent);
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy'; }, 1600);
}));
